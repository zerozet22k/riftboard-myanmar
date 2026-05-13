// src/lib/refresh.ts
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { RankEntry, RANK_QUEUES } from "@/models/rankEntry";
import { PlayerMastery } from "@/models/playerMastery";
import { Match } from "@/models/match";
import { PlayerMatch } from "@/models/playerMatch";
import { TftMatch } from "@/models/tftMatch";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";
import {
  getAccountByPuuid,
  findSeaPlatformByPuuid,
  getLeagueEntriesByPuuid,
  getPuuidByRiotId,
  getSummonerByPuuid,
  getChampionMasteriesByPuuid,
  getMatchIdsByPuuid,
  getMatchById,
  getTftMatchIdsByPuuid,
  getTftMatchById,
  findTftLeagueEntriesByPuuid,
  hasTftApiKey,
  platformToMatchRegion,
  isRiot404,
  isRiot429,
} from "@/lib/riot";
import { normalizeRiotIdPart, syncCanonicalRiotId } from "@/lib/playerIdentity";
import { mergePlayers } from "@/lib/playerMerge";
import { approvedCommunityLeaderboardQuery } from "@/lib/communityLeaderboard";

const SOLO = "RANKED_SOLO_5x5";
const FLEX = "RANKED_FLEX_SR";
const TFT = "RANKED_TFT";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = index++;
      out[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return out;
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
  return isRiot429(e) || (typeof (e as any)?.status === "number" && (e as any).status === 429);
}

function rateLimitWaitMs(e: unknown, fallbackMs = 2000) {
  const ra = (e as any)?.retryAfterMs;
  return typeof ra === "number" && ra > 0 ? ra : fallbackMs;
}

function isRiotDecryptingBadRequest(e: unknown) {
  const message = errToString(e);
  return /decrypt/i.test(message) && /400|Bad Request/i.test(message);
}

function normalize(s: string) {
  return s.trim().toLowerCase();
}

const COOLDOWN_MS = 2 * 60 * 1000;

// ✅ Riot matchlist supports up to 100 per request
const MAX_MATCH_SYNC_COUNT = 100;
const MATCH_SYNC_CONCURRENCY = 3;

function lastSuccessfulRefreshAt(p: any): Date | null {
  const candidates = [p?.lastRefreshAt, p?.solo?.fetchedAt, p?.flex?.fetchedAt, p?.tft?.fetchedAt]
    .filter(Boolean)
    .map((d: any) => new Date(d));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return candidates[0];
}

function changedRank(a: any | null, b: any) {
  if (!a) return true;
  return (
    (a.tier ?? null) !== (b.tier ?? null) ||
    (a.division ?? null) !== (b.division ?? null) ||
    (a.lp ?? null) !== (b.lp ?? null) ||
    (a.wins ?? null) !== (b.wins ?? null) ||
    (a.losses ?? null) !== (b.losses ?? null)
  );
}

async function insertRankIfChanged(input: {
  playerId: any;
  queue: string;
  tier?: string;
  division?: string;
  lp?: number;
  wins?: number;
  losses?: number;
  fetchedAt: Date;
}) {
  if (!RANK_QUEUES.includes(input.queue as any)) return;

  const prev = await RankEntry.findOne({ playerId: input.playerId, queue: input.queue })
    .sort({ fetchedAt: -1 })
    .lean();

  if (changedRank(prev, input)) {
    await RankEntry.create(input);
  }
}

function extractPlayerMatchSummary(match: any, puuid: string) {
  const info = match?.info ?? {};
  const participants: any[] = Array.isArray(info.participants) ? info.participants : [];
  const me = participants.find((p) => String(p?.puuid ?? "").toLowerCase() === puuid.toLowerCase());

  const items = me
    ? [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6]
      .map((x) => (typeof x === "number" ? x : 0))
      .filter((x) => x !== 0)
    : [];

  const summonerSpells = me ? [me.summoner1Id, me.summoner2Id].filter((x: any) => typeof x === "number") : [];

  const cs =
    me && (typeof me.totalMinionsKilled === "number" || typeof me.neutralMinionsKilled === "number")
      ? (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0)
      : undefined;

  return {
    queueId: typeof info.queueId === "number" ? info.queueId : undefined,
    gameCreation: typeof info.gameCreation === "number" ? info.gameCreation : undefined,
    gameDuration: typeof info.gameDuration === "number" ? info.gameDuration : undefined,

    championId: typeof me?.championId === "number" ? me.championId : undefined,
    teamId: typeof me?.teamId === "number" ? me.teamId : undefined,

    teamPosition: typeof me?.teamPosition === "string" ? me.teamPosition : undefined, // ✅ ADD

    win: typeof me?.win === "boolean" ? me.win : undefined,

    kills: typeof me?.kills === "number" ? me.kills : undefined,
    deaths: typeof me?.deaths === "number" ? me.deaths : undefined,
    assists: typeof me?.assists === "number" ? me.assists : undefined,
    largestMultiKill: typeof me?.largestMultiKill === "number" ? me.largestMultiKill : undefined,
    doubleKills: typeof me?.doubleKills === "number" ? me.doubleKills : undefined,
    tripleKills: typeof me?.tripleKills === "number" ? me.tripleKills : undefined,
    quadraKills: typeof me?.quadraKills === "number" ? me.quadraKills : undefined,
    pentaKills: typeof me?.pentaKills === "number" ? me.pentaKills : undefined,
    largestKillingSpree: typeof me?.largestKillingSpree === "number" ? me.largestKillingSpree : undefined,

    cs,
    gold: typeof me?.goldEarned === "number" ? me.goldEarned : undefined,

    items,
    summonerSpells,

    primaryStyle: typeof me?.perks?.styles?.[0]?.style === "number" ? me.perks.styles[0].style : undefined,
    primaryRune:
      typeof me?.perks?.styles?.[0]?.selections?.[0]?.perk === "number"
        ? me.perks.styles[0].selections[0].perk
        : undefined,
    subStyle: typeof me?.perks?.styles?.[1]?.style === "number" ? me.perks.styles[1].style : undefined,
  };
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function simplifyTftUnit(unit: any) {
  return {
    characterId: safeString(unit?.character_id),
    name: safeString(unit?.name),
    rarity: safeNumber(unit?.rarity),
    tier: safeNumber(unit?.tier),
    itemNames: Array.isArray(unit?.itemNames)
      ? unit.itemNames.filter((item: unknown): item is string => typeof item === "string")
      : [],
  };
}

function simplifyTftTrait(trait: any) {
  return {
    name: safeString(trait?.name),
    numUnits: safeNumber(trait?.num_units),
    style: safeNumber(trait?.style),
    tierCurrent: safeNumber(trait?.tier_current),
    tierTotal: safeNumber(trait?.tier_total),
  };
}

function extractTftPlayerMatchSummary(match: any, puuid: string) {
  const info = match?.info ?? {};
  const participants: any[] = Array.isArray(info.participants) ? info.participants : [];
  const me = participants.find((p) => String(p?.puuid ?? "").toLowerCase() === puuid.toLowerCase());
  if (!me) return null;

  return {
    queueId: safeNumber(info.queue_id),
    gameDatetime: safeNumber(info.game_datetime),
    gameLength: safeNumber(info.game_length),
    setNumber: safeNumber(info.tft_set_number),
    placement: safeNumber(me.placement),
    level: safeNumber(me.level),
    lastRound: safeNumber(me.last_round),
    playersEliminated: safeNumber(me.players_eliminated),
    totalDamageToPlayers: safeNumber(me.total_damage_to_players),
    goldLeft: safeNumber(me.gold_left),
    timeEliminated: safeNumber(me.time_eliminated),
    companionContentId: safeString(me.companion?.content_ID),
    augments: Array.isArray(me.augments)
      ? me.augments.filter((augment: unknown): augment is string => typeof augment === "string")
      : [],
    traits: Array.isArray(me.traits) ? me.traits.map(simplifyTftTrait) : [],
    units: Array.isArray(me.units) ? me.units.map(simplifyTftUnit) : [],
  };
}

async function syncFullMastery(player: any, platform: string, puuid: string, now: Date) {
  const all = await getChampionMasteriesByPuuid(platform, puuid);
  if (!Array.isArray(all) || all.length === 0) return;

  // ✅ FIX: include playerId/championId on insert so upsert is guaranteed correct
  await PlayerMastery.bulkWrite(
    all.map((m) => ({
      updateOne: {
        filter: { playerId: player._id, championId: m.championId },
        update: {
          $set: {
            puuid,
            championLevel: m.championLevel,
            championPoints: m.championPoints,
            lastPlayTime: m.lastPlayTime,
            chestGranted: m.chestGranted,
            tokensEarned: m.tokensEarned,
            championPointsSinceLastLevel: m.championPointsSinceLastLevel,
            championPointsUntilNextLevel: m.championPointsUntilNextLevel,
            markRequiredForNextLevel: m.markRequiredForNextLevel,
            championSeasonMilestone: m.championSeasonMilestone,
            fetchedAt: now,
          },
          $setOnInsert: {
            playerId: player._id,
            championId: m.championId,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  // store top 3 on Player for fast leaderboard/profile header
  const top = all.slice(0, 3).map((m) => ({
    championId: m.championId,
    championPoints: m.championPoints,
    updatedAt: now,
  }));
  player.mains = top;
  player.masterySyncedAt = now;
}

async function syncRecentMatches(params: { player: any; puuid: string; matchRegion: string; count: number }) {
  const { player, puuid, matchRegion, count } = params;
  const now = new Date();

  const ids = await getMatchIdsByPuuid({ puuid, matchRegion, start: 0, count });
  if (!Array.isArray(ids) || ids.length === 0) {
    player.matchSync = { ...(player.matchSync ?? {}), lastSyncAt: now };
    await player.save();
    return;
  }

  const existing = await Match.find({ matchId: { $in: ids } }, { matchId: 1 }).lean();
  const have = new Set(existing.map((x: any) => x.matchId));

  await mapLimit(ids, MATCH_SYNC_CONCURRENCY, async (matchId) => {
    try {
      let payload: any | null = null;

      if (have.has(matchId)) {
        const doc = await Match.findOne(
          { matchId },
          { raw: 1, region: 1, queueId: 1, gameCreation: 1, gameDuration: 1 }
        ).lean();

        payload = (doc as any)?.raw ?? null;
      }

      if (!payload) {
        payload = await getMatchById(matchId, matchRegion);

        const info = payload?.info ?? {};
        const queueId = typeof info.queueId === "number" ? info.queueId : undefined;
        const gameCreation = typeof info.gameCreation === "number" ? info.gameCreation : undefined;
        const gameDuration = typeof info.gameDuration === "number" ? info.gameDuration : undefined;

        await Match.updateOne(
          { matchId },
          {
            $set: {
              region: matchRegion,
              queueId,
              gameCreation,
              gameDuration,
              raw: payload,
              fetchedAt: now,
            },
            $setOnInsert: { matchId },
          },
          { upsert: true }
        );
      }

      const summary = extractPlayerMatchSummary(payload, puuid);

      await PlayerMatch.updateOne(
        { playerId: player._id, matchId },
        {
          $set: {
            playerId: player._id,
            matchId,
            region: matchRegion,

            queueId: summary.queueId,
            gameCreation: summary.gameCreation,
            gameDuration: summary.gameDuration,

            championId: summary.championId,
            teamId: summary.teamId,
            teamPosition: summary.teamPosition,
            win: summary.win,

            kills: summary.kills,
            deaths: summary.deaths,
            assists: summary.assists,
            largestMultiKill: summary.largestMultiKill,
            doubleKills: summary.doubleKills,
            tripleKills: summary.tripleKills,
            quadraKills: summary.quadraKills,
            pentaKills: summary.pentaKills,
            largestKillingSpree: summary.largestKillingSpree,

            cs: summary.cs,
            gold: summary.gold,

            items: summary.items,
            summonerSpells: summary.summonerSpells,

            primaryStyle: summary.primaryStyle,
            primaryRune: summary.primaryRune,
            subStyle: summary.subStyle,

            fetchedAt: now,
          },
        },
        { upsert: true }
      );
    } catch (e) {
      if (isRateLimit(e)) await sleep(rateLimitWaitMs(e, 2500));
    }
  });

  player.matchSync = { ...(player.matchSync ?? {}), lastSyncAt: now };
  await player.save();
}

async function syncRecentTftMatches(params: { player: any; puuid: string; matchRegion: string; count: number }) {
  const { player, puuid, matchRegion, count } = params;
  const now = new Date();

  const ids = await getTftMatchIdsByPuuid({ puuid, matchRegion, start: 0, count });
  if (!Array.isArray(ids) || ids.length === 0) {
    player.tftMatchSync = { ...(player.tftMatchSync ?? {}), lastSyncAt: now };
    await player.save();
    return;
  }

  const existing = await TftMatch.find({ matchId: { $in: ids } }, { matchId: 1 }).lean();
  const have = new Set(existing.map((x: any) => x.matchId));
  let failedFetches = 0;
  let writtenSummaries = 0;

  await mapLimit(ids, MATCH_SYNC_CONCURRENCY, async (matchId) => {
    try {
      let payload: any | null = null;

      if (have.has(matchId)) {
        const doc = await TftMatch.findOne(
          { matchId },
          { raw: 1, region: 1, queueId: 1, gameDatetime: 1, gameLength: 1 }
        ).lean();
        payload = (doc as any)?.raw ?? null;
      }

      if (!payload) {
        payload = await getTftMatchById(matchId, matchRegion);
        const info = payload?.info ?? {};

        await TftMatch.updateOne(
          { matchId },
          {
            $set: {
              region: matchRegion,
              queueId: safeNumber(info.queue_id),
              gameDatetime: safeNumber(info.game_datetime),
              gameLength: safeNumber(info.game_length),
              setNumber: safeNumber(info.tft_set_number),
              raw: payload,
              fetchedAt: now,
            },
            $setOnInsert: { matchId },
          },
          { upsert: true }
        );
      }

      const summary = extractTftPlayerMatchSummary(payload, puuid);
      if (!summary) return;

      await TftPlayerMatch.updateOne(
        { playerId: player._id, matchId },
        {
          $set: {
            playerId: player._id,
            matchId,
            region: matchRegion,
            ...summary,
            fetchedAt: now,
          },
        },
        { upsert: true }
      );
      writtenSummaries++;
    } catch (e) {
      failedFetches++;
      if (isRateLimit(e)) await sleep(rateLimitWaitMs(e, 2500));
      else console.error(`TFT match sync failed for ${matchId}:`, e);
    }
  });

  if (failedFetches >= ids.length) {
    throw new Error("TFT match sync failed for all recent matches");
  }
  if (writtenSummaries === 0) {
    throw new Error("TFT match sync found matches, but none matched this player's TFT puuid");
  }

  player.tftMatchSync = { ...(player.tftMatchSync ?? {}), lastSyncAt: now };
  await player.save();
}

export async function refreshPlayerById(
  playerId: string,
  opts?: {
    force?: boolean;
    cooldownMs?: number;

    syncMatches?: boolean;
    matchesCount?: number;

    fullMastery?: boolean;
    syncTftMatches?: boolean;
  }
) {
  await dbConnect();

  let player: any = await Player.findById(playerId);
  if (!player) throw new Error("Player not found");

  const cooldownMs = opts?.cooldownMs ?? COOLDOWN_MS;

  if (!opts?.force) {
    const last = lastSuccessfulRefreshAt(player);
    if (last) {
      const now = Date.now();
      const age = now - last.getTime();
      const wantsTftMatchSync =
        opts?.syncTftMatches === true &&
        hasTftApiKey() &&
        player?.tftMatchSync?.enabled !== false;
      let shouldBypassCooldownForTftMatches = false;

      if (wantsTftMatchSync) {
        const lastTftMatchSync = player.tftMatchSync?.lastSyncAt
          ? new Date(player.tftMatchSync.lastSyncAt).getTime()
          : 0;
        const hasStoredTftMatches = await TftPlayerMatch.exists({ playerId: player._id });
        shouldBypassCooldownForTftMatches =
          !hasStoredTftMatches ||
          !Number.isFinite(lastTftMatchSync) ||
          now - lastTftMatchSync >= cooldownMs;
      }

      if (age < cooldownMs) {
        if (shouldBypassCooldownForTftMatches) {
          // Continue the refresh so a rank-only update does not block initial TFT match history.
        } else {
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
  }

  const now = new Date();

  let puuid = String(player.puuid ?? "").trim();
  try {
    const acct = await getPuuidByRiotId(player.gameName, player.tagLine);
    if (acct?.puuid && acct.puuid !== puuid) {
      puuid = acct.puuid;
      player.puuid = puuid;
      player.tftPuuid = acct.puuid;
      await player.save();
    }
  } catch (e) {
    if (!puuid) throw e;
    console.error("Riot ID PUUID sync failed:", e);
  }

  try {
    const account = await getAccountByPuuid(puuid);
    if (account?.gameName && account?.tagLine) {
      const currentGameNameNorm = normalizeRiotIdPart(account.gameName);
      const currentTagLineNorm = normalizeRiotIdPart(account.tagLine);
      const duplicate = await Player.findOne({
        gameNameNorm: currentGameNameNorm,
        tagLineNorm: currentTagLineNorm,
      });

      if (duplicate && String(duplicate._id) !== String(player._id)) {
        player = await mergePlayers(String(duplicate._id), String(player._id));
        const fresh = await Player.findById(player._id);
        if (!fresh) throw new Error("Player merge target disappeared during refresh");
        player = fresh;
        puuid = player.puuid || puuid;
      }

      syncCanonicalRiotId(player, account.gameName, account.tagLine, now);
    }
  } catch (e) {
    console.error("Account sync failed:", e);
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

  player.summonerId = summoner.id;
  player.profileIconId = summoner.profileIconId;
  player.summonerName = summoner.name;
  player.summonerLevel = summoner.summonerLevel;
  player.revisionDate = summoner.revisionDate;

  const matchRegion = player.matchRegion ?? platformToMatchRegion(platform);
  player.matchRegion = matchRegion;

  const entries = await getLeagueEntriesByPuuid(platform, puuid);
  const solo = entries.find((e) => e.queueType === SOLO);
  const flex = entries.find((e) => e.queueType === FLEX);

  player.solo = solo
    ? { tier: solo.tier, division: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses, fetchedAt: now }
    : { fetchedAt: now };

  player.flex = flex
    ? { tier: flex.tier, division: flex.rank, lp: flex.leaguePoints, wins: flex.wins, losses: flex.losses, fetchedAt: now }
    : { fetchedAt: now };

  if (hasTftApiKey()) {
    try {
      let tftPuuid = String(player.tftPuuid ?? "").trim();
      try {
        const tftAccount = await getPuuidByRiotId(player.gameName, player.tagLine, "tft");
        if (tftAccount?.puuid && tftAccount.puuid !== tftPuuid) {
          tftPuuid = tftAccount.puuid;
          player.tftPuuid = tftPuuid;
        }
      } catch (e) {
        if (!tftPuuid) throw e;
      }

      let foundTftLeague;
      try {
        foundTftLeague = await findTftLeagueEntriesByPuuid(tftPuuid, platform);
      } catch (e) {
        if (!isRiotDecryptingBadRequest(e)) throw e;
        const tftAccount = await getPuuidByRiotId(player.gameName, player.tagLine, "tft");
        tftPuuid = tftAccount.puuid;
        player.tftPuuid = tftPuuid;
        foundTftLeague = await findTftLeagueEntriesByPuuid(tftPuuid, platform);
      }
      const { entries: tftEntries } = foundTftLeague;
      const tft = tftEntries.find((entry) => entry.queueType === TFT);

      player.tft = tft
        ? {
            tier: tft.tier,
            division: tft.rank,
            lp: tft.leaguePoints,
            wins: tft.wins,
            losses: tft.losses,
            fetchedAt: now,
          }
        : { fetchedAt: now };

      if (tft) {
        await insertRankIfChanged({
          playerId: player._id,
          queue: TFT,
          tier: tft.tier,
          division: tft.rank,
          lp: tft.leaguePoints,
          wins: tft.wins,
          losses: tft.losses,
          fetchedAt: now,
        });
      }
    } catch (e) {
      if (!isRiot404(e)) {
        console.error("TFT sync failed:", e);
      }
      // Do not wipe a previously saved TFT rank just because Riot rejected one
      // auxiliary TFT lookup. Match history and active-shard calls can fail
      // independently from the player's actual ranked state.
      player.tft = {
        ...(player.tft?.toObject ? player.tft.toObject() : player.tft ?? {}),
        fetchedAt: player.tft?.fetchedAt ?? now,
      };
    }
  }

  // ✅ FIX: don’t silently swallow mastery write errors anymore
  try {
    if (opts?.fullMastery) {
      await syncFullMastery(player, platform, puuid, now);
    } else {
      const top = await getChampionMasteriesByPuuid(platform, puuid);
      if (Array.isArray(top)) {
        const mains = top.slice(0, 3).map((m) => ({
          championId: m.championId,
          championPoints: m.championPoints,
          updatedAt: now,
        }));
        player.mains = mains;
        player.masterySyncedAt = now;
      }
    }
  } catch (e) {
    console.error("Mastery sync failed:", e);
  }

  player.lastRefreshAt = now;
  await player.save();

  for (const e of entries) {
    await insertRankIfChanged({
      playerId: player._id,
      queue: e.queueType,
      tier: e.tier,
      division: e.rank,
      lp: e.leaguePoints,
      wins: e.wins,
      losses: e.losses,
      fetchedAt: now,
    });
  }

  const syncMatches = opts?.syncMatches === true && player?.matchSync?.enabled !== false;
  if (syncMatches) {
    await syncRecentMatches({
      player,
      puuid,
      matchRegion,
      count: Math.max(1, Math.min(MAX_MATCH_SYNC_COUNT, Number(opts?.matchesCount ?? 10) || 10)),
    });
  }

  const syncTftMatches =
    opts?.syncTftMatches === true &&
    hasTftApiKey() &&
    player?.tftMatchSync?.enabled !== false;
  if (syncTftMatches) {
    const tftPuuid = String(player.tftPuuid ?? puuid ?? "").trim();
    if (tftPuuid) {
      await syncRecentTftMatches({
        player,
        puuid: tftPuuid,
        matchRegion,
        count: Math.max(1, Math.min(MAX_MATCH_SYNC_COUNT, Number(opts?.matchesCount ?? 10) || 10)),
      });
    }
  }

  return player.toObject();
}

export async function refreshAllPlayers(opts?: {
  limit?: number;

  leaderboardOnly?: boolean;
  leaderboardGroup?: string;
  leaderboardStatus?: "approved" | "pending" | "rejected";

  delayMs?: number;
  force?: boolean;
  cooldownMs?: number;
  syncMatches?: boolean;
  syncTftMatches?: boolean;
  matchesCount?: number;
}) {
  await dbConnect();

  const limit = opts?.limit ?? 20;
  const delayMs = opts?.delayMs ?? 1100;

  const q: any = {};
  if (opts?.leaderboardOnly) {
    Object.assign(q, approvedCommunityLeaderboardQuery(opts?.leaderboardGroup ?? "burmese"));
    q["leaderboard.status"] = opts?.leaderboardStatus ?? "approved";
  }

  const playerSort: [string, 1][] =
    opts?.syncTftMatches === true
      ? [["tftMatchSync.lastSyncAt", 1], ["lastRefreshAt", 1], ["updatedAt", 1]]
      : [["lastRefreshAt", 1], ["updatedAt", 1]];

  const players = await Player.find(q, {
    _id: 1,
    gameName: 1,
    tagLine: 1,
    lastRefreshAt: 1,
    tftMatchSync: 1,
  })
    .sort(playerSort)
    .limit(limit)
    .lean();

  const errors: { playerId: string; name?: string; error: string }[] = [];
  const playersSummary: { playerId: string; name?: string; status: "ok" | "skipped" | "failed" }[] = [];
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const p of players) {
    try {
      const out: any = await refreshPlayerById(String(p._id), {
        force: opts?.force,
        cooldownMs: opts?.cooldownMs,
        syncMatches: opts?.syncMatches === true,
        syncTftMatches: opts?.syncTftMatches === true,
        matchesCount: opts?.matchesCount,
        fullMastery: false,
      });

      if (out?._skipped) {
        skipped++;
        playersSummary.push({
          playerId: String(p._id),
          name: `${p.gameName}#${p.tagLine}`,
          status: "skipped",
        });
        continue;
      }

      ok++;
      playersSummary.push({
        playerId: String(p._id),
        name: `${p.gameName}#${p.tagLine}`,
        status: "ok",
      });
      if (delayMs) await sleep(delayMs);
    } catch (e) {
      if (isRateLimit(e)) await sleep(rateLimitWaitMs(e, 3000));
      fail++;
      errors.push({
        playerId: String(p._id),
        name: `${p.gameName}#${p.tagLine}`,
        error: errToString(e),
      });
      playersSummary.push({
        playerId: String(p._id),
        name: `${p.gameName}#${p.tagLine}`,
        status: "failed",
      });
    }
  }

  return { ok, fail, skipped, errors, players: playersSummary, scanned: players.length };
}

export async function upsertAndRefreshByRiotId(
  input: { gameName: string; tagLine: string },
  opts?: {
    force?: boolean;
    cooldownMs?: number;

    syncMatches?: boolean;
    matchesCount?: number;

    fullMastery?: boolean;
  }
) {
  await dbConnect();

  const gameName = input.gameName.trim();
  const tagLine = input.tagLine.trim();

  const gameNameNorm = normalize(gameName);
  const tagLineNorm = normalize(tagLine);

  const p: any = await Player.findOneAndUpdate(
    { gameNameNorm, tagLineNorm },
    {
      $set: { gameName, tagLine },
      $setOnInsert: { gameNameNorm, tagLineNorm, platform: "auto" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return refreshPlayerById(String(p._id), opts);
}
