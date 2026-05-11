import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { refreshPlayerById } from "@/lib/refresh";
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

export async function POST(req: Request, { params }: { params: Promise<Params> }) {
  try {
    const { gameName, tagLine } = await params;
    const gameNameRaw = safeDecode(gameName).trim();
    const tagLineRaw = safeDecode(tagLine).trim().toLowerCase();
    const body = (await req.json().catch(() => ({}))) as {
      force?: boolean;
      syncTftMatches?: boolean;
      matchesCount?: number;
    };

    if (!gameNameRaw || !tagLineRaw) {
      return NextResponse.json({ ok: false, error: "Missing Riot ID" }, { status: 400 });
    }

    await dbConnect();

    const player = await Player.findOne(buildPlayerLookupQuery(gameNameRaw, tagLineRaw), { _id: 1 }).lean();
    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const refreshed = await refreshPlayerById(String(player._id), {
      force: body.force === true,
      syncTftMatches: body.syncTftMatches !== false,
      matchesCount: Math.max(1, Math.min(50, Number(body.matchesCount ?? 10) || 10)),
    });

    return NextResponse.json({ ok: true, player: refreshed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
