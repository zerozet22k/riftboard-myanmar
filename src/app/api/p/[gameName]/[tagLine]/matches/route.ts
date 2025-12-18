import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";

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

function safeStr(v: any) {
  return typeof v === "string" ? v : null;
}
function safeNum(v: any) {
  return typeof v === "number" ? v : null;
}
function safeBool(v: any) {
  return typeof v === "boolean" ? v : null;
}

type Params = { gameName: string; tagLine: string };

export async function GET(req: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const { gameName, tagLine } = await params;

    const gameNameRaw = safeDecode(gameName);
    const tagLineRaw = safeDecode(tagLine);

    const gameNameNorm = norm(gameNameRaw);
    const tagLineNorm = norm(tagLineRaw);

    if (!gameNameNorm || !tagLineNorm) {
      return NextResponse.json({ ok: false, error: "Missing params" }, { status: 400 });
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? url.searchParams.get("count") ?? 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));

    await dbConnect();

    const player: any = await Player.findOne(
      { gameNameNorm, tagLineNorm },
      { _id: 1 }
    ).lean();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));

    const rows = await PlayerMatch.find(
      { playerId },
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
      .sort({ gameCreation: -1 })
      .limit(limit)
      .lean();

    return NextResponse.json({
      ok: true,
      count: rows.length,
      rows: rows.map((m: any) => ({
        _id: String(m._id),
        matchId: safeStr(m.matchId),
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
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 });
  }
}
