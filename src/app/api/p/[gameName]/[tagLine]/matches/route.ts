import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { Match } from "@/models/match";
import { PlayerMatch } from "@/models/playerMatch";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";

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

function safeNum(v: any) {
  return typeof v === "number" ? v : null;
}

function safeBool(v: any) {
  return typeof v === "boolean" ? v : null;
}

function safeStr(v: any) {
  return typeof v === "string" ? v : null;
}

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

function makeCursorFromDoc(last: any): string | null {
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

function extractPlayerRowFromMatch(matchId: string, matchRegion: string, playerId: any, puuid: string, match: any) {
  const info = match?.info;
  const participants = Array.isArray(info?.participants) ? info.participants : [];
  const me = participants.find((p: any) => String(p?.puuid ?? "") === puuid) ?? null;
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

  const summonerSpells = [safeNum(me?.summoner1Id), safeNum(me?.summoner2Id)].filter(
    (x): x is number => typeof x === "number" && x > 0
  );

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

  const have = new Set(existing.map((x: any) => String(x.matchId)));
  const newIds = ids.filter((id) => !have.has(id));

  if (newIds.length === 0) return 0;

  const now = new Date();
  const matches = await mapLimit(newIds, 3, async (id) => {
    const match = await riotFetchJson<any>(`${base}/lol/match/v5/matches/${encodeURIComponent(id)}`);
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

    return { id, match };
  });

  const ops = matches
    .map(({ id, match }) => extractPlayerRowFromMatch(id, routing, playerId, puuid, match))
    .filter(Boolean)
    .map((doc: any) => ({
      updateOne: {
        filter: { playerId: doc.playerId, matchId: doc.matchId },
        update: { $set: doc },
        upsert: true,
      },
    }));

  if (ops.length) {
    await PlayerMatch.bulkWrite(ops, { ordered: false });
  }

  return ops.length;
}

type Params = { gameName: string; tagLine: string };
const TOP_MATCH_AUTOSYNC_STALE_MS = 6 * 60 * 60 * 1000;

function newestMatchIsStale(docs: any[]) {
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

    const player: any = await Player.findOne(
      buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
      { _id: 1, puuid: 1, riotPuuid: 1, matchRegion: 1, raw: 1 }
    ).lean();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));
    const puuid = String(player.puuid ?? player.riotPuuid ?? player.raw?.puuid ?? "").trim() || null;
    const matchRegion = String(player.matchRegion ?? player.raw?.matchRegion ?? "sea")
      .trim()
      .toLowerCase();

    function buildFilter() {
      const filter: any = { playerId };

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

    async function queryPage() {
      return PlayerMatch.find(
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
        .lean();
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

    const matches = page.map((m: any) => ({
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
      items: Array.isArray(m.items) ? m.items.filter((x: any) => typeof x === "number") : [],
      summonerSpells: Array.isArray(m.summonerSpells)
        ? m.summonerSpells.filter((x: any) => typeof x === "number")
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
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 });
  }
}
