import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { Player } from "@/models/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { gameName: string; tagLine: string };

function safeDecode(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

export async function POST(_req: Request, { params }: { params: Promise<Params> }) {
  try {
    const { gameName, tagLine } = await params;
    const gameNameRaw = safeDecode(gameName).trim();
    const tagLineRaw = safeDecode(tagLine).trim();
    if (!gameNameRaw || !tagLineRaw) {
      return NextResponse.json({ ok: false, error: "Missing Riot ID" }, { status: 400 });
    }

    await dbConnect();
    const player = await Player.findOne(
      buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
      { _id: 1, lastRefreshAt: 1 }
    ).lean();
    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      refreshed: false,
      automatic: true,
      lastRefreshAt: player.lastRefreshAt ?? null,
      message: "RiftBoard updates Riot data through its protected background scheduler.",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Refresh check failed" },
      { status: 500 }
    );
  }
}
