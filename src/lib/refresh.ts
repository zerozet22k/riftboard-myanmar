import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { RankEntry } from "@/models/rankEntry";
import {
  findSeaPlatformByPuuid,
  getLeagueEntriesByPuuid,
  getPuuidByRiotId,
  getSummonerByPuuid,
  getTopChampionMasteriesByPuuid,
  isRiot404,
} from "@/lib/riot";

const SOLO = "RANKED_SOLO_5x5";
const FLEX = "RANKED_FLEX_SR";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errToString(e: unknown) {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isRateLimit(e: unknown) {
  const msg = errToString(e).toLowerCase();
  return msg.includes("riot api 429") || msg.includes(" 429") || msg.includes("rate limit");
}

function normalize(s: string) {
  return s.trim().toLowerCase();
}

const COOLDOWN_MS = 60 * 60 * 1000;

function lastSuccessfulRefreshAt(p: any): Date | null {
  const candidates = [p?.lastRefreshAt, p?.solo?.fetchedAt, p?.flex?.fetchedAt]
    .filter(Boolean)
    .map((d: any) => new Date(d));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return candidates[0];
}
async function riotJson(platform: string, path: string) {
  const token = process.env.RIOT_API_KEY?.trim();
  if (!token) throw new Error("Missing RIOT_API_KEY in .env");

  const url = `https://${platform}.api.riotgames.com${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-Riot-Token": token },
    cache: "no-store",
  });
  console.log(`Riot API ${res.status} ${res.statusText} - ${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = `Riot API ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`;
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export async function refreshPlayerById(
  playerId: string,
  opts?: { force?: boolean; cooldownMs?: number }
) {
  await dbConnect();

  const player = await Player.findById(playerId);
  if (!player) throw new Error("Player not found");

  const cooldownMs = opts?.cooldownMs ?? COOLDOWN_MS;

  if (!opts?.force) {
    const last = lastSuccessfulRefreshAt(player);
    if (last) {
      const now = Date.now();
      const age = now - last.getTime();
      if (age < cooldownMs) {
        const next = new Date(last.getTime() + cooldownMs);
        return {
          ...player.toObject(),
          _skipped: true,
          _cooldownSecondsLeft: Math.ceil((cooldownMs - age) / 1000),
          _nextRefreshAt: next.toISOString(),
        };
      }
    }
  }

  let puuid = player.puuid as string | undefined;

  if (!puuid) {
    const acct = await getPuuidByRiotId(player.gameName, player.tagLine);
    puuid = acct.puuid;
    player.puuid = puuid;
    await player.save();
  }

  let platform = String(player.platform || "auto").toLowerCase().trim();
  let summoner: any;

  try {
    if (platform !== "auto") {
      summoner = await getSummonerByPuuid(platform, puuid);
    } else {
      const found = await findSeaPlatformByPuuid(puuid);
      platform = found.platform;
      summoner = found.summoner;
      player.platform = platform;
      await player.save();
    }
  } catch (e) {
    if (platform !== "auto" && isRiot404(e)) {
      const found = await findSeaPlatformByPuuid(puuid);
      platform = found.platform;
      summoner = found.summoner;
      player.platform = platform;
      await player.save();
    } else {
      throw e;
    }
  }

  const entries = await getLeagueEntriesByPuuid(platform, puuid);
  const solo = entries.find((e) => e.queueType === SOLO);
  const flex = entries.find((e) => e.queueType === FLEX);
  const now = new Date();

  player.summonerId = summoner.id;
  player.profileIconId = summoner.profileIconId;

  player.solo = solo
    ? {
      tier: solo.tier,
      division: solo.rank,
      lp: solo.leaguePoints,
      wins: solo.wins,
      losses: solo.losses,
      fetchedAt: now,
    }
    : { fetchedAt: now };

  player.flex = flex
    ? {
      tier: flex.tier,
      division: flex.rank,
      lp: flex.leaguePoints,
      wins: flex.wins,
      losses: flex.losses,
      fetchedAt: now,
    }
    : { fetchedAt: now };

  try {
    const top = await getTopChampionMasteriesByPuuid(platform, puuid, 3);
    (player as any).mains = top;
  } catch (e) {
  }
  player.lastRefreshAt = now;

  await player.save();

  if (entries.length) {
    await RankEntry.insertMany(
      entries.map((e) => ({
        playerId: player._id,
        queue: e.queueType,
        tier: e.tier,
        division: e.rank,
        lp: e.leaguePoints,
        wins: e.wins,
        losses: e.losses,
        fetchedAt: now,
      }))
    );
  }

  return player.toObject();
}

export async function refreshAllPlayers(opts?: {
  delayMs?: number;
  force?: boolean;
  cooldownMs?: number;
}) {
  await dbConnect();

  const players = await Player.find({}, { _id: 1, gameName: 1, tagLine: 1 }).lean();
  const delayMs = opts?.delayMs ?? 1100;

  const errors: { playerId: string; name?: string; error: string }[] = [];
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const p of players) {
    try {
      const out: any = await refreshPlayerById(String(p._id), {
        force: opts?.force,
        cooldownMs: opts?.cooldownMs,
      });

      if (out?._skipped) {
        skipped++;
        continue;
      }

      ok++;
      if (delayMs) await sleep(delayMs);
    } catch (e) {
      if (isRateLimit(e)) await sleep(5000);
      fail++;
      errors.push({
        playerId: String(p._id),
        name: `${p.gameName}#${p.tagLine}`,
        error: errToString(e),
      });
    }
  }

  return { ok, fail, skipped, errors };
}

export async function upsertAndRefreshByRiotId(
  input: { gameName: string; tagLine: string },
  opts?: { force?: boolean; cooldownMs?: number }
) {
  await dbConnect();

  const gameName = input.gameName.trim();
  const tagLine = input.tagLine.trim();

  const gameNameNorm = normalize(gameName);
  const tagLineNorm = normalize(tagLine);

  const p = await Player.findOneAndUpdate(
    { gameNameNorm, tagLineNorm },
    {
      $set: { gameName, tagLine },
      $setOnInsert: { gameNameNorm, tagLineNorm, platform: "auto" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return refreshPlayerById(String(p._id), opts);
}
