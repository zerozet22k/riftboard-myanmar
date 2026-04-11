import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminSessionFromRequest, isValidAdminCode } from "@/lib/adminSession";
import { dbConnect } from "@/lib/mongodb";
import { normalizeRiotIdPart, canonicalPlayerPath } from "@/lib/playerIdentity";
import { refreshPlayerById } from "@/lib/refresh";
import { Player } from "@/models/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AddPlayerSchema = z.object({
  secret: z.string().trim().min(1).optional(),
  gameName: z.string().trim().min(1),
  tagLine: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = AddPlayerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }

    const isAuthorized =
      hasAdminSessionFromRequest(req) || isValidAdminCode(parsed.data.secret ?? null);
    if (!isAuthorized) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { gameName, tagLine } = parsed.data;
    const gameNameNorm = normalizeRiotIdPart(gameName);
    const tagLineNorm = normalizeRiotIdPart(tagLine);

    await dbConnect();

    let player = await Player.findOne({ gameNameNorm, tagLineNorm });
    const now = new Date();

    if (!player) {
      player = new Player({
        gameName: gameName.trim(),
        tagLine: tagLine.trim(),
        platform: "auto",
        solo: {},
        flex: {},
      });
    }

    player.leaderboard = {
      ...(player.leaderboard ?? {}),
      group: "burmese",
      status: "approved",
      requestedAt: player.leaderboard?.requestedAt ?? now,
      approvedAt: now,
    };
    await player.save();

    let refreshError: string | null = null;
    try {
      await refreshPlayerById(String(player._id), {
        force: true,
        fullMastery: false,
        syncMatches: true,
        matchesCount: 10,
      });
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "Refresh failed";
    }

    // Reload after refresh to get updated fields
    player = await Player.findById(player._id);

    const canonicalPath = canonicalPlayerPath(
      player?.gameName ?? gameName,
      player?.tagLine ?? tagLine
    );

    revalidatePath("/");
    revalidatePath("/leaderboard");
    revalidatePath(canonicalPath);

    return NextResponse.json({
      ok: true,
      playerId: String(player?._id),
      canonicalPath,
      gameName: player?.gameName ?? gameName,
      tagLine: player?.tagLine ?? tagLine,
      refreshError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
