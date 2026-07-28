import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { gameName: string; tagLine: string };

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

function safeDecode(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

function safeNum(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeStr(value: unknown) {
  return typeof value === "string" ? value : null;
}

function safeBool(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function decodeCursor(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function parseCursor(cursor: string | null): { gc: number; id: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(decodeCursor(cursor));
    const gc = Number(value?.gc);
    const id = String(value?.id ?? "");
    if (!Number.isFinite(gc) || !mongoose.Types.ObjectId.isValid(id)) return null;
    return { gc, id };
  } catch {
    return null;
  }
}

function makeCursor(last: PlayerMatchRow | null | undefined) {
  if (!last || typeof last.gameCreation !== "number" || !Number.isFinite(last.gameCreation)) {
    return null;
  }

  return Buffer.from(
    JSON.stringify({
      gc: last.gameCreation,
      id: String(last._id),
      matchId: String(last.matchId ?? ""),
    })
  ).toString("base64url");
}

export async function GET(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const { gameName, tagLine } = await params;
    const gameNameRaw = safeDecode(gameName).trim();
    const tagLineRaw = safeDecode(tagLine).trim().toLowerCase();
    if (!gameNameRaw || !tagLineRaw) {
      return NextResponse.json({ ok: false, error: "Missing params" }, { status: 400 });
    }

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? req.nextUrl.searchParams.get("count") ?? 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20));
    const cursor = parseCursor(req.nextUrl.searchParams.get("cursor"));

    await dbConnect();

    const player = await Player.findOne(buildPlayerLookupQuery(gameNameRaw, tagLineRaw), { _id: 1 }).lean();
    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));
    const filter: PlayerMatchFilter = { playerId };
    if (cursor) {
      const cursorId = new mongoose.Types.ObjectId(cursor.id);
      filter.$or = [
        { gameCreation: { $lt: cursor.gc } },
        { gameCreation: cursor.gc, _id: { $lt: cursorId } },
      ];
    }

    const docs = (await PlayerMatch.find(
      filter,
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

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const matches = page.map((match) => ({
      _id: String(match._id),
      matchId: String(match.matchId ?? ""),
      region: safeStr(match.region),
      queueId: safeNum(match.queueId),
      gameCreation: safeNum(match.gameCreation),
      gameDuration: safeNum(match.gameDuration),
      championId: safeNum(match.championId),
      teamId: safeNum(match.teamId),
      teamPosition: safeStr(match.teamPosition),
      primaryStyle: safeNum(match.primaryStyle),
      primaryRune: safeNum(match.primaryRune),
      subStyle: safeNum(match.subStyle),
      win: safeBool(match.win),
      kills: safeNum(match.kills),
      deaths: safeNum(match.deaths),
      assists: safeNum(match.assists),
      largestMultiKill: safeNum(match.largestMultiKill),
      doubleKills: safeNum(match.doubleKills),
      tripleKills: safeNum(match.tripleKills),
      quadraKills: safeNum(match.quadraKills),
      pentaKills: safeNum(match.pentaKills),
      largestKillingSpree: safeNum(match.largestKillingSpree),
      cs: safeNum(match.cs),
      gold: safeNum(match.gold),
      items: Array.isArray(match.items)
        ? match.items.filter((value): value is number => typeof value === "number")
        : [],
      summonerSpells: Array.isArray(match.summonerSpells)
        ? match.summonerSpells.filter((value): value is number => typeof value === "number")
        : [],
    }));

    const total = await PlayerMatch.countDocuments({ playerId });
    return NextResponse.json({
      ok: true,
      total,
      count: matches.length,
      inserted: 0,
      matches,
      nextCursor: hasMore ? makeCursor(page[page.length - 1]) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
