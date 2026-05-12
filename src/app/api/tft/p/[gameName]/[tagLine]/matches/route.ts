/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { getTftMatchById, getTftMatchIdsByPuuid, platformToMatchRegion } from "@/lib/riot";
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

function b64urlDecodeToString(input: string) {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64").toString("utf8");
}

function parseCursor(cursor: string | null): { gd: number; id: string; matchId: string | null } | null {
  if (!cursor) return null;
  try {
    const obj = JSON.parse(b64urlDecodeToString(cursor));
    const gd = Number(obj?.gd);
    const id = String(obj?.id ?? "");
    const matchId = String(obj?.matchId ?? "").trim() || null;
    if (!Number.isFinite(gd) || !id) return null;
    return { gd, id, matchId };
  } catch {
    return null;
  }
}

function makeCursorFromDoc(last: any): string | null {
  if (!last || typeof last.gameDatetime !== "number") return null;
  const payload = { gd: last.gameDatetime, id: String(last._id), matchId: String(last.matchId ?? "") };
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

function extractTftRow(matchId: string, region: string, playerId: mongoose.Types.ObjectId, puuid: string, match: any) {
  const info = match?.info ?? {};
  const participants: any[] = Array.isArray(info.participants) ? info.participants : [];
  const me = participants.find((participant) => String(participant?.puuid ?? "").toLowerCase() === puuid.toLowerCase());
  if (!me) return null;

  return {
    playerId,
    matchId,
    region,
    fetchedAt: new Date(),
    queueId: safeNum(info.queue_id),
    gameDatetime: safeNum(info.game_datetime),
    gameLength: safeNum(info.game_length),
    setNumber: safeNum(info.tft_set_number),
    placement: safeNum(me.placement),
    level: safeNum(me.level),
    lastRound: safeNum(me.last_round),
    playersEliminated: safeNum(me.players_eliminated),
    totalDamageToPlayers: safeNum(me.total_damage_to_players),
    goldLeft: safeNum(me.gold_left),
    timeEliminated: safeNum(me.time_eliminated),
    companionContentId: safeStr(me.companion?.content_ID),
    augments: Array.isArray(me.augments)
      ? me.augments.filter((augment: unknown): augment is string => typeof augment === "string")
      : [],
    traits: Array.isArray(me.traits) ? me.traits.map(simplifyTrait) : [],
    units: Array.isArray(me.units) ? me.units.map(simplifyUnit) : [],
  };
}

async function syncOlderTftMatches(opts: {
  playerId: mongoose.Types.ObjectId;
  puuid: string;
  matchRegion: string;
  batch: number;
  afterMatchId?: string | null;
}) {
  const { playerId, puuid, matchRegion, batch, afterMatchId } = opts;
  let ids: string[] = [];

  if (afterMatchId) {
    const scanCount = Math.max(20, Math.min(100, batch * 2));
    for (let start = 0; start < 1000; start += scanCount) {
      const pageIds = await getTftMatchIdsByPuuid({ puuid, matchRegion, start, count: scanCount });
      if (!Array.isArray(pageIds) || pageIds.length === 0) break;
      const anchorIndex = pageIds.indexOf(afterMatchId);
      if (anchorIndex >= 0) {
        ids = pageIds.slice(anchorIndex + 1, anchorIndex + 1 + batch);
        break;
      }
      if (pageIds.length < scanCount) break;
    }
  } else {
    ids = await getTftMatchIdsByPuuid({ puuid, matchRegion, start: 0, count: batch });
  }

  if (!Array.isArray(ids) || ids.length === 0) return 0;

  const existing = await TftPlayerMatch.find({ playerId, matchId: { $in: ids } }, { matchId: 1 }).lean();
  const have = new Set(existing.map((x: any) => String(x.matchId)));
  const newIds = ids.filter((id) => !have.has(id));
  if (!newIds.length) return 0;

  const now = new Date();
  const matches = await mapLimit(newIds, 3, async (id) => {
    let payload: any | null = null;
    const cached = await TftMatch.findOne({ matchId: id }, { raw: 1 }).lean();
    payload = (cached as any)?.raw ?? null;
    if (!payload) {
      payload = await getTftMatchById(id, matchRegion);
      const info = payload?.info ?? {};
      await TftMatch.updateOne(
        { matchId: id },
        {
          $set: {
            region: matchRegion,
            queueId: safeNum(info.queue_id),
            gameDatetime: safeNum(info.game_datetime),
            gameLength: safeNum(info.game_length),
            setNumber: safeNum(info.tft_set_number),
            raw: payload,
            fetchedAt: now,
          },
          $setOnInsert: { matchId: id },
        },
        { upsert: true }
      );
    }
    return { id, payload };
  });

  const ops = matches
    .map(({ id, payload }) => extractTftRow(id, matchRegion, playerId, puuid, payload))
    .filter(Boolean)
    .map((doc: any) => ({
      updateOne: {
        filter: { playerId: doc.playerId, matchId: doc.matchId },
        update: { $set: doc },
        upsert: true,
      },
    }));

  if (ops.length) await TftPlayerMatch.bulkWrite(ops, { ordered: false });
  return ops.length;
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
  return participants.map(serializeParticipant).sort((left, right) => (left.placement ?? 99) - (right.placement ?? 99));
}

export async function GET(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const { gameName, tagLine } = await params;
    const gameNameRaw = safeDecode(gameName).trim();
    const tagLineRaw = safeDecode(tagLine).trim().toLowerCase();
    if (!gameNameRaw || !tagLineRaw) {
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
      { _id: 1, tftPuuid: 1, puuid: 1, platform: 1, matchRegion: 1 }
    ).lean();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));
    const puuid = String(player.tftPuuid ?? player.puuid ?? "").trim();
    const matchRegion = String(player.matchRegion ?? platformToMatchRegion(String(player.platform ?? "sg2")))
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
          { gameDatetime: { $lt: cursor.gd } },
          ...(oid ? [{ gameDatetime: cursor.gd, _id: { $lt: oid } }] : []),
        ];
      }
      return filter;
    }

    async function queryPage() {
      return TftPlayerMatch.find(buildFilter())
        .sort({ gameDatetime: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
    }

    let inserted = 0;
    let docs = await queryPage();

    if (autosync && docs.length <= limit) {
      if (!puuid) {
        return NextResponse.json({ ok: false, error: "Player missing TFT puuid" }, { status: 400 });
      }
      inserted = await syncOlderTftMatches({
        playerId,
        puuid,
        matchRegion,
        batch: limit,
        afterMatchId: cursor?.matchId ?? null,
      });
      if (inserted > 0) docs = await queryPage();
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

    const total = await TftPlayerMatch.countDocuments({ playerId });

    const rawMatches = await TftMatch.find(
      { matchId: { $in: page.map((match: any) => String(match.matchId ?? "")).filter(Boolean) } },
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

    return NextResponse.json({
      ok: true,
      total,
      count: page.length,
      inserted,
      matches,
      nextCursor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
