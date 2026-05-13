import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { refreshPlayerById } from "@/lib/refresh";
import { hasTftApiKey } from "@/lib/riot";
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

function friendlyRefreshError(error: unknown) {
  const message = error instanceof Error ? error.message : "Refresh failed";
  if (/Exception decrypting|Bad Request/i.test(message)) {
    return "Riot could not return TFT match history for this account yet. No recent matches were saved.";
  }
  if (/403|Forbidden/i.test(message)) {
    return "Riot rejected the TFT API key. Update RIOT_TFT_API_KEY or RIOT_API_KEY.";
  }
  if (/404|not found/i.test(message)) {
    return "No TFT player or match history was found for this Riot ID.";
  }
  return message;
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

    if (body.syncTftMatches !== false && !hasTftApiKey()) {
      return NextResponse.json(
        { ok: false, error: "Missing RIOT_TFT_API_KEY or RIOT_API_KEY; TFT match history cannot sync." },
        { status: 500 }
      );
    }

    await dbConnect();

    const player = await Player.findOne(buildPlayerLookupQuery(gameNameRaw, tagLineRaw), { _id: 1 }).lean();
    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const refreshed = await refreshPlayerById(String(player._id), {
      force: body.force === true,
      syncTftMatches: body.syncTftMatches !== false,
      matchesCount: Math.max(1, Math.min(50, Number(body.matchesCount ?? 20) || 20)),
    });

    return NextResponse.json({ ok: true, player: refreshed });
  } catch (error) {
    return NextResponse.json({ ok: false, error: friendlyRefreshError(error) }, { status: 500 });
  }
}
