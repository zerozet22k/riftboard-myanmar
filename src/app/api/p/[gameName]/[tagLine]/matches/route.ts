import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { Match } from "@/models/match";
import { PlayerMatch } from "@/models/playerMatch";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import {
  ensureMatchDetailsForHistoryRows,
  hydrateTrackedPlayerMatchesFromRaw,
} from "@/lib/lolMatchHydration";
import { prunePlayerMatches } from "@/lib/matchRetention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

function safeNum(v: unknown) {
  return typeof v === "number" ? v : null;
}

function safeBool(v: unknown) {
  return typeof v === "boolean" ? v : null;
}

function safeStr(v: unknown) {
  return typeof v === "string" ? v : null;
}

type RiotParticipantRaw = {
  puuid?: string;
  championId?: number;
  teamId?: number;
  teamPosition?: string;
  win?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  largestMultiKill?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  largestKillingSpree?: number;
  goldEarned?: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  perks?: {
    styles?: Array<{
      style?: number;
      selections?: Array<{ perk?: number }>;
    }>;
  };
};

type RiotMatchRaw = {
  info?: {
    queueId?: number;
    gameCreation?: number;
    gameDuration?: number;
    participants?: RiotParticipantRaw[];
  };
};

type PlayerLookup = {
  _id?: unknown;
  puuid?: string | null;
  riotPuuid?: string | null;
  matchRegion?: string | null;
  raw?: {
    puuid?: string | null;
    matchRegion?: string | null;
  } | null;
};

type PlayerMatchRow = {
  _id?: unknown;
  matchId?: string | null;
  region?: string | null;
  queueId?: number | null;
  gameCreation?: number | null;
  gameDuration?: number | null;
  championId?: number | null;
  teamId?: number | null;
  teamPosition?: string | null;
  primaryStyle?: number | null;
  primaryRune?: number | null;
  subStyle?: number | null;
  win?: boolean | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  largestMultiKill?: number | null;
  doubleKills?: number | null;
  tripleKills?: number | null;
  quadraKills?: number | null;
  pentaKills?: number | null;
  largestKillingSpree?: number | null;
  cs?: number | null;
  gold?: number | null;
  items?: unknown[];
  summonerSpells?: unknown[];
};

type PlayerMatchFilter = {
  playerId: mongoose.Types.ObjectId;
  $or?: Array<{
    gameCreation?: number | { $lt: number };
    _id?: { $lt: mongoose.Types.ObjectId };
  }>;
};

function b64urlDecodeToString(input: string) {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64").toString("utf8");
}

function parseCursor(cursor: string | null): { gc: number; id: string; matchId: string | null } | null {
  if (!cursor) return null;
  try {
    const obj = JSON.parse(b64urlDecodeToString(cursor));
    const gc = Number(obj?.gc);
    const id = String(obj?.id ?? "");
    const matchId = String(obj?.matchId ?? "").trim() || null;
    if (!Number.isFinite(gc) || !id) return null;
    return { gc, id, matchId };
  } catch {
    return null;
  }
}

function makeCursorFromDoc(last: PlayerMatchRow | null | undefined): string | null {
  if (!last) return null;
  const gc = typeof last.gameCreation === "number" ? last.gameCreation : null;
  if (gc == null) return null;

  const payload = { gc, id: String(last._id), matchId: String(last.matchId ?? "") };
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function matchRoutingFromPlayerRegion(v: unknown): "americas" | "asia" | "europe" | "sea" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "sea") return "sea";
  if (s === "asia") return "asia";
  if (s === "europe") return "europe";
  if (s === "americas") return "americas";

  if (s === "sg2" || s === "th2" || s === "vn2" || s === "ph2" || s === "tw2" || s === "oc1") return "sea";
  if (s === "kr" || s === "jp1") return "asia";
  if (s === "euw1" || s === "eun1" || s === "tr1" || s === "ru") return "europe";
  if (s === "na1" || s === "br1" || s === "la1" || s === "la2") return "americas";

  return "sea";
}

async function riotFetchJson<T>(url: string): Promise<T> {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error("Missing RIOT_API_KEY");

  const r = await fetch(url, {
    headers: { "X-Riot-Token": key },
    cache: "no-store",
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Riot ${r.status}: ${text || "request failed"}`);
  }

  return (await r.json()) as T;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return out;
}

function extractPlayerRowFromMatch(
  matchId: string,
  matchRegion: string,
  playerId: mongoose.Types.ObjectId,
  puuid: string,
  match: RiotMatchRaw
) {
  const info = match?.info;
  const participants = Array.isArray(info?.participants) ? info.participants : [];
  const me = participants.find((p) => String(p?.puuid ?? "") === puuid) ?? null;
  if (!me) return null;

  const perks = me?.perks ?? {};
  const styles = Array.isArray(perks?.styles) ? perks.styles : [];
  const primaryStyle = safeNum(styles?.[0]?.style);
  const primaryRune = safeNum(styles?.[0]?.selections?.[0]?.perk);
  const subStyle = safeNum(styles?.[1]?.style);

  const items = [
    safeNum(me?.item0),
    safeNum(me?.item1),
    safeNum(me?.item2),
    safeNum(me?.item3),
    safeNum(me?.item4),
    safeNum(me?.item5),
    safeNum(me?.item6),
  ].filter((x): x is number => typeof x === "number" && x > 0);

  const summonerSpells = [safeNum(me?.summoner1Id), safeNum(me?.summoner2Id)].filter((x): x is number => x != null && x > 0);

  const cs =
    (typeof me?.totalMinionsKilled === "number" ? me.totalMinionsKilled : 0) +
    (typeof me?.neutralMinionsKilled === "number" ? me.neutralMinionsKilled : 0);

  return {
    playerId,
    matchId,
    region: matchRegion,
    fetchedAt: new Date(),
    queueId: safeNum(info?.queueId),
    gameCreation: safeNum(info?.gameCreation),
    gameDuration: safeNum(info?.gameDuration),
    championId: safeNum(me?.championId),
    teamId: safeNum(me?.teamId),
    teamPosition: safeStr(me?.teamPosition),
    primaryStyle,
    primaryRune,
    subStyle,
    win: safeBool(me?.win),
    kills: safeNum(me?.kills),
    deaths: safeNum(me?.deaths),
    assists: safeNum(me?.assists),
    largestMultiKill: safeNum(me?.largestMultiKill),
    doubleKills: safeNum(me?.doubleKills),
    tripleKills: safeNum(me?.tripleKills),
    quadraKills: safeNum(me?.quadraKills),
    pentaKills: safeNum(me?.pentaKills),
    largestKillingSpree: safeNum(me?.largestKillingSpree),
    cs: Number.isFinite(cs) ? cs : null,
    gold: safeNum(me?.goldEarned),
    items,
    summonerSpells,
  };
}

async function syncOlderMatchesFromRiot(opts: {
  playerId: mongoose.Types.ObjectId;
  puuid: string;
  matchRegion: string;
  batch: number;
  afterMatchId?: string | null;
}): Promise<number> {
  const { playerId, puuid, matchRegion, batch, afterMatchId } = opts;

  const routing = matchRoutingFromPlayerRegion(matchRegion);
  const base = `https://${routing}.api.riotgames.com`;
  let ids: string[] = [];

  if (afterMatchId) {
    const scanCount = Math.max(20, Math.min(100, batch * 2));

    for (let start = 0; start < 1000; start += scanCount) {
      const pageIds = await riotFetchJson<string[]>(
        `${base}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${scanCount}`
      );

      if (!Array.isArray(pageIds) || pageIds.length === 0) break;

      const anchorIndex = pageIds.indexOf(afterMatchId);
      if (anchorIndex >= 0) {
        ids = pageIds.slice(anchorIndex + 1, anchorIndex + 1 + batch);
        break;
      }

      if (pageIds.length < scanCount) break;
    }
  } else {
    ids = await riotFetchJson<string[]>(
      `${base}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${batch}`
    );
  }

  if (!Array.isArray(ids) || ids.length === 0) return 0;

  const existing = await PlayerMatch.find(
    { playerId, matchId: { $in: ids } },
    { matchId: 1 }
  ).lean();

  const have = new Set(existing.map((x: { matchId?: unknown }) => String(x.matchId)));
  const newIds = ids.filter((id) => !have.has(id));

  if (newIds.length === 0) return 0;

  const now = new Date();
  const matches = await mapLimit(newIds, 3, async (id) => {
    const match = await riotFetchJson<RiotMatchRaw>(`${base}/lol/match/v5/matches/${encodeURIComponent(id)}`);
    const info = match?.info ?? {};

    await Match.updateOne(
      { matchId: id },
      {
        $set: {
          region: routing,
          queueId: safeNum(info.queueId),
          gameCreation: safeNum(info.gameCreation),
          gameDuration: safeNum(info.gameDuration),
          raw: match,
          fetchedAt: now,
        },
        $setOnInsert: { matchId: id },
      },
      { upsert: true }
    );

    await hydrateTrackedPlayerMatchesFromRaw({
      matchId: id,
      region: routing,
      raw: match,
    });

    return { id, match };
  });

  const docs = matches
    .map(({ id, match }) => extractPlayerRowFromMatch(id, routing, playerId, puuid, match))
    .filter((doc): doc is NonNullable<ReturnType<typeof extractPlayerRowFromMatch>> => doc != null);

  const ops = docs.map((doc) => ({
      updateOne: {
        filter: { playerId: doc.playerId, matchId: doc.matchId },
        update: { $set: doc },
        upsert: true,
      },
    }));

  if (ops.length) {
    await PlayerMatch.bulkWrite(ops as unknown as Parameters<typeof PlayerMatch.bulkWrite>[0], {
      ordered: false,
    });
  }
  await prunePlayerMatches(playerId);

  return ops.length;
}

type Params = { gameName: string; tagLine: string };
const TOP_MATCH_AUTOSYNC_STALE_MS = 6 * 60 * 60 * 1000;

function newestMatchIsStale(docs: PlayerMatchRow[]) {
  const newest = docs[0]?.gameCreation;
  if (typeof newest !== "number" || !Number.isFinite(newest)) return true;
  return Date.now() - newest > TOP_MATCH_AUTOSYNC_STALE_MS;
}

export async function GET(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const { gameName, tagLine } = await params;

    const gameNameRaw = safeDecode(gameName).trim();
    const tagLineRaw = safeDecode(tagLine).trim().toLowerCase();

    const gameNameNorm = norm(gameNameRaw);
    const tagLineNorm = norm(tagLineRaw);

    if (!gameNameNorm || !tagLineNorm) {
      return NextResponse.json({ ok: false, error: "Missing params" }, { status: 400 });
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? url.searchParams.get("count") ?? 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));
    const autosync = url.searchParams.get("autosync") === "1";
    const cursor = parseCursor(url.searchParams.get("cursor"));

    await dbConnect();

    const player = (await Player.findOne(
      buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
      { _id: 1, puuid: 1, riotPuuid: 1, matchRegion: 1, raw: 1 }
    ).lean()) as PlayerLookup | null;

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));
    const puuid = String(player.puuid ?? player.riotPuuid ?? player.raw?.puuid ?? "").trim() || null;
    const matchRegion = String(player.matchRegion ?? player.raw?.matchRegion ?? "sea")
      .trim()
      .toLowerCase();

    function buildFilter() {
      const filter: PlayerMatchFilter = { playerId };

      if (cursor) {
        let oid: mongoose.Types.ObjectId | null = null;
        try {
          oid = new mongoose.Types.ObjectId(cursor.id);
        } catch {
          oid = null;
        }

        filter.$or = [
          { gameCreation: { $lt: cursor.gc } },
          ...(oid ? [{ gameCreation: cursor.gc, _id: { $lt: oid } }] : []),
        ];
      }

      return filter;
    }

    async function queryPage(): Promise<PlayerMatchRow[]> {
      return (await PlayerMatch.find(
        buildFilter(),
        {
          matchId: 1,
          region: 1,
          queueId: 1,
          gameCreation: 1,
          gameDuration: 1,
          championId: 1,
          teamId: 1,
          teamPosition: 1,
          primaryStyle: 1,
          primaryRune: 1,
          subStyle: 1,
          win: 1,
          kills: 1,
          deaths: 1,
          assists: 1,
          largestMultiKill: 1,
          doubleKills: 1,
          tripleKills: 1,
          quadraKills: 1,
          pentaKills: 1,
          largestKillingSpree: 1,
          cs: 1,
          gold: 1,
          items: 1,
          summonerSpells: 1,
        }
      )
        .sort({ gameCreation: -1, _id: -1 })
        .limit(limit + 1)
        .lean()) as PlayerMatchRow[];
    }

    let inserted = 0;
    let docs = await queryPage();

    const shouldAutosyncTop = autosync && !cursor && newestMatchIsStale(docs);
    const shouldAutosyncOlder = autosync && !!cursor && docs.length <= limit;

    if (shouldAutosyncTop || shouldAutosyncOlder) {
      if (!puuid) {
        return NextResponse.json(
          { ok: false, error: "Player missing puuid (needed for autosync)" },
          { status: 400 }
        );
      }

      inserted = await syncOlderMatchesFromRiot({
        playerId,
        puuid,
        matchRegion,
        batch: limit,
        afterMatchId: shouldAutosyncOlder ? cursor?.matchId ?? null : null,
      });

      if (inserted > 0) {
        docs = await queryPage();
      }
    }

    const pageHydration = await ensureMatchDetailsForHistoryRows({
      rows: docs.slice(0, limit),
      matchRegion,
      maxFetch: Math.min(limit, 10),
    });

    if (pageHydration.fetched > 0) {
      docs = await queryPage();
    }

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor =
      page.length === 0
        ? null
        : hasMore
          ? makeCursorFromDoc(page[page.length - 1])
          : autosync && inserted > 0
            ? makeCursorFromDoc(page[page.length - 1])
            : null;

    const matches = page.map((m) => ({
      _id: String(m._id),
      matchId: String(m.matchId ?? ""),
      region: safeStr(m.region),
      queueId: safeNum(m.queueId),
      gameCreation: safeNum(m.gameCreation),
      gameDuration: safeNum(m.gameDuration),
      championId: safeNum(m.championId),
      teamId: safeNum(m.teamId),
      teamPosition: safeStr(m.teamPosition),
      primaryStyle: safeNum(m.primaryStyle),
      primaryRune: safeNum(m.primaryRune),
      subStyle: safeNum(m.subStyle),
      win: safeBool(m.win),
      kills: safeNum(m.kills),
      deaths: safeNum(m.deaths),
      assists: safeNum(m.assists),
      largestMultiKill: safeNum(m.largestMultiKill),
      doubleKills: safeNum(m.doubleKills),
      tripleKills: safeNum(m.tripleKills),
      quadraKills: safeNum(m.quadraKills),
      pentaKills: safeNum(m.pentaKills),
      largestKillingSpree: safeNum(m.largestKillingSpree),
      cs: safeNum(m.cs),
      gold: safeNum(m.gold),
      items: Array.isArray(m.items) ? m.items.filter((x): x is number => typeof x === "number") : [],
      summonerSpells: Array.isArray(m.summonerSpells)
        ? m.summonerSpells.filter((x): x is number => typeof x === "number")
        : [],
    }));

    const total = await PlayerMatch.countDocuments({ playerId });

    return NextResponse.json({
      ok: true,
      total,
      count: matches.length,
      inserted,
      matches,
      nextCursor,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
