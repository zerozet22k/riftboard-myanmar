import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
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

function parseCursor(cursor: string | null): { gc: number; id: string } | null {
  if (!cursor) return null;
  try {
    const obj = JSON.parse(b64urlDecodeToString(cursor));
    const gc = Number(obj?.gc);
    const id = String(obj?.id ?? "");
    if (!Number.isFinite(gc) || !id) return null;
    return { gc, id };
  } catch {
    return null;
  }
}

function makeCursorFromDoc(last: any): string | null {
  if (!last) return null;
  const gc = typeof last.gameCreation === "number" ? last.gameCreation : null;
  if (gc == null) return null;

  const payload = { gc, id: String(last._id) };
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// --- Riot helpers ---
function matchRoutingFromPlayerRegion(v: unknown): "americas" | "asia" | "europe" | "sea" {
  const s = String(v ?? "").trim().toLowerCase();
  // if you store SEA/sea -> ok
  if (s === "sea") return "sea";
  if (s === "asia") return "asia";
  if (s === "europe") return "europe";
  if (s === "americas") return "americas";

  // if you store platform-ish values, map them:
  if (s === "sg2" || s === "th2" || s === "vn2" || s === "ph2" || s === "tw2" || s === "oc1") return "sea";
  if (s === "kr" || s === "jp1") return "asia";
  if (s === "euw1" || s === "eun1" || s === "tr1" || s === "ru") return "europe";
  if (s === "na1" || s === "br1" || s === "la1" || s === "la2") return "americas";

  // default to sea for your setup
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
    safeNum(me?.item0), safeNum(me?.item1), safeNum(me?.item2),
    safeNum(me?.item3), safeNum(me?.item4), safeNum(me?.item5),
    safeNum(me?.item6),
  ].filter((x): x is number => typeof x === "number" && x > 0);

  const summonerSpells = [safeNum(me?.summoner1Id), safeNum(me?.summoner2Id)]
    .filter((x): x is number => typeof x === "number" && x > 0);

  const cs =
    (typeof me?.totalMinionsKilled === "number" ? me.totalMinionsKilled : 0) +
    (typeof me?.neutralMinionsKilled === "number" ? me.neutralMinionsKilled : 0);

  return {
    playerId,
    matchId,
    region: matchRegion,

    fetchedAt: new Date(),

    queueId: safeNum(info?.queueId),
    gameCreation: safeNum(info?.gameCreation), // ms
    gameDuration: safeNum(info?.gameDuration), // sec

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
}): Promise<number> {
  const { playerId, puuid, matchRegion, batch } = opts;

  const routing = matchRoutingFromPlayerRegion(matchRegion);
  const base = `https://${routing}.api.riotgames.com`;

  // Use current DB count as start offset (works as long as you’ve been inserting from newest -> older)
  const existingCount = await PlayerMatch.countDocuments({ playerId });

  // Retry a couple times in case of duplicates / mismatched offset
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = existingCount + attempt * batch;

    const ids = await riotFetchJson<string[]>(
      `${base}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${batch}`
    );

    if (!Array.isArray(ids) || ids.length === 0) return 0;

    const existing = await PlayerMatch.find(
      { playerId, matchId: { $in: ids } },
      { matchId: 1 }
    ).lean();

    const have = new Set(existing.map((x: any) => String(x.matchId)));
    const newIds = ids.filter((id) => !have.has(id));

    if (newIds.length === 0) continue;

    const matches = await mapLimit(newIds, 3, async (id) => {
      const match = await riotFetchJson<any>(`${base}/lol/match/v5/matches/${encodeURIComponent(id)}`);
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

    if (ops.length) await PlayerMatch.bulkWrite(ops, { ordered: false });

    return ops.length;
  }

  return 0;
}

type Params = { gameName: string; tagLine: string };

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

    const puuid =
      String(player.puuid ?? player.riotPuuid ?? player.raw?.puuid ?? "").trim() || null;

    const matchRegion =
      String(player.matchRegion ?? player.raw?.matchRegion ?? "sea").trim().toLowerCase();

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
      const docs = await PlayerMatch.find(
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
          cs: 1,
          gold: 1,
          items: 1,
          summonerSpells: 1,
        }
      )
        .sort({ gameCreation: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

      return docs;
    }

    let inserted = 0;
    let docs = await queryPage();

    // If we hit DB end and autosync is requested, fetch older matches from Riot and try again
    if (autosync && docs.length <= limit) {
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
        batch: Math.max(20, limit * 3),
      });

      if (inserted > 0) {
        docs = await queryPage();
      }
    }

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;

    // IMPORTANT:
    // If autosync=1 and we’re at DB end, keep a cursor so the user can click again,
    // unless Riot inserted nothing (likely remote end).
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
      inserted,     // how many we pulled from Riot this request
      matches,
      nextCursor,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 });
  }
}
