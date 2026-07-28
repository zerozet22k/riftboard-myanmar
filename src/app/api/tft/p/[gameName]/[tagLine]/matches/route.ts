/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { hydrateTftMatches } from "@/lib/tftAssets";
import { Player } from "@/models/player";
import { TftMatch } from "@/models/tftMatch";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Dict = Record<string, unknown>;
type Params = { gameName: string; tagLine: string };

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

function decodeCursor(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function parseCursor(cursor: string | null): { gd: number; id: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(decodeCursor(cursor));
    const gd = Number(value?.gd);
    const id = String(value?.id ?? "");
    if (!Number.isFinite(gd) || !mongoose.Types.ObjectId.isValid(id)) return null;
    return { gd, id };
  } catch {
    return null;
  }
}

function makeCursor(last: any) {
  if (!last || typeof last.gameDatetime !== "number" || !Number.isFinite(last.gameDatetime)) {
    return null;
  }

  return Buffer.from(
    JSON.stringify({
      gd: last.gameDatetime,
      id: String(last._id),
      matchId: String(last.matchId ?? ""),
    })
  ).toString("base64url");
}

function simplifyUnit(unit: any) {
  return {
    characterId: safeStr(unit?.character_id),
    name: safeStr(unit?.name),
    rarity: safeNum(unit?.rarity),
    tier: safeNum(unit?.tier),
    itemNames: Array.isArray(unit?.itemNames)
      ? unit.itemNames.filter((item: unknown): item is string => typeof item === "string")
      : [],
  };
}

function simplifyTrait(trait: any) {
  return {
    name: safeStr(trait?.name),
    numUnits: safeNum(trait?.num_units),
    style: safeNum(trait?.style),
    tierCurrent: safeNum(trait?.tier_current),
    tierTotal: safeNum(trait?.tier_total),
  };
}

function serializeMatch(match: Dict & { _id?: unknown }) {
  return {
    _id: String(match._id),
    matchId: String(match.matchId ?? ""),
    region: safeStr(match.region),
    queueId: safeNum(match.queueId),
    gameDatetime: safeNum(match.gameDatetime),
    gameLength: safeNum(match.gameLength),
    setNumber: safeNum(match.setNumber),
    placement: safeNum(match.placement),
    level: safeNum(match.level),
    lastRound: safeNum(match.lastRound),
    playersEliminated: safeNum(match.playersEliminated),
    totalDamageToPlayers: safeNum(match.totalDamageToPlayers),
    goldLeft: safeNum(match.goldLeft),
    timeEliminated: safeNum(match.timeEliminated),
    augments: Array.isArray(match.augments)
      ? match.augments.filter((value: unknown): value is string => typeof value === "string")
      : [],
    traits: Array.isArray(match.traits) ? match.traits : [],
    units: Array.isArray(match.units) ? match.units : [],
  };
}

function serializeParticipant(participant: unknown) {
  const row = participant && typeof participant === "object" ? (participant as Record<string, unknown>) : {};
  return {
    puuid: safeStr(row.puuid),
    riotIdGameName: safeStr(row.riotIdGameName),
    riotIdTagline: safeStr(row.riotIdTagline),
    placement: safeNum(row.placement),
    level: safeNum(row.level),
    lastRound: safeNum(row.last_round),
    playersEliminated: safeNum(row.players_eliminated),
    totalDamageToPlayers: safeNum(row.total_damage_to_players),
    goldLeft: safeNum(row.gold_left),
    augments: Array.isArray(row.augments)
      ? row.augments.filter((value): value is string => typeof value === "string")
      : [],
    traits: Array.isArray(row.traits) ? row.traits.map(simplifyTrait) : [],
    units: Array.isArray(row.units) ? row.units.map(simplifyUnit) : [],
  };
}

function serializeParticipants(raw: unknown) {
  const payload = raw && typeof raw === "object" ? (raw as { info?: { participants?: unknown[] } }) : {};
  const participants = Array.isArray(payload.info?.participants) ? payload.info.participants : [];
  return participants
    .map(serializeParticipant)
    .sort((left, right) => (left.placement ?? 99) - (right.placement ?? 99));
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
    const filter: any = { playerId };
    if (cursor) {
      const cursorId = new mongoose.Types.ObjectId(cursor.id);
      filter.$or = [
        { gameDatetime: { $lt: cursor.gd } },
        { gameDatetime: cursor.gd, _id: { $lt: cursorId } },
      ];
    }

    const docs = await TftPlayerMatch.find(filter)
      .sort({ gameDatetime: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;

    const rawMatches = await TftMatch.find(
      { matchId: { $in: page.map((match) => String(match.matchId ?? "")).filter(Boolean) } },
      { matchId: 1, raw: 1 }
    ).lean();
    const rawByMatchId = new Map(rawMatches.map((match: any) => [String(match.matchId ?? ""), match.raw]));
    const serialized = page.map((match) => {
      const row = serializeMatch(match);
      return {
        ...row,
        participants: serializeParticipants(rawByMatchId.get(row.matchId)),
      };
    });
    const matches = await hydrateTftMatches(serialized);
    const total = await TftPlayerMatch.countDocuments({ playerId });

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
