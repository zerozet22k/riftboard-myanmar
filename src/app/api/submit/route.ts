import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  grantStoredCommunityAccessForDiscordUser,
  hasCommunityAccessFromRequest,
  hasStoredCommunityAccessForDiscordUser,
  setCommunityAccessCookie,
} from "@/lib/communityAccess";
import { dbConnect } from "@/lib/mongodb";
import { canonicalPlayerPath } from "@/lib/playerIdentity";
import { refreshPlayerById } from "@/lib/refresh";
import { requireDiscordSessionFromRequest } from "@/lib/discordSession";
import { getCommunityJoinCodes } from "@/lib/runtimeConfig";
import { Player } from "@/models/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SubmitSchema = z.object({
  code: z.string().trim().optional(),
});

type RefreshResult = {
  _skipped?: boolean;
  _nextRefreshAt?: string;
  _cooldownSecondsLeft?: number;
  _refreshError?: string;
};

export async function POST(req: NextRequest) {
  try {
    const session = await requireDiscordSessionFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const parsed = SubmitSchema.safeParse({
      code: String(body.code ?? "").trim() || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }

    const requiredCodes = getCommunityJoinCodes();
    const unlockedBrowser = hasCommunityAccessFromRequest(req);
    const unlockedAccount = await hasStoredCommunityAccessForDiscordUser(session.discordUserId);
    const providedCode = String(parsed.data.code ?? "").trim();
    const acceptedCode = requiredCodes.includes(providedCode);
    if (requiredCodes.length && !unlockedBrowser && !unlockedAccount && !acceptedCode) {
      return NextResponse.json({ ok: false, error: "Wrong community code" }, { status: 401 });
    }

    await dbConnect();

    const player = await Player.findById(session.playerId);
    if (!player?._id) {
      return NextResponse.json(
        { ok: false, error: "Your verified Riftboard profile could not be found." },
        { status: 404 }
      );
    }

    const now = new Date();
    player.leaderboard = {
      ...(player.leaderboard ?? {}),
      group: "burmese",
      status: "approved",
      requestedAt: player.leaderboard?.requestedAt ?? now,
      approvedAt: now,
    };
    await player.save();

    let refreshOut: RefreshResult | null = null;
    try {
      refreshOut = (await refreshPlayerById(String(player._id), {
        force: true,
        fullMastery: false,
        syncMatches: true,
        matchesCount: 10,
      })) as RefreshResult;
    } catch (error) {
      refreshOut = { _refreshError: error instanceof Error ? error.message : "Refresh failed" };
    }

    revalidatePath("/");
    revalidatePath("/leaderboard");

    const canonicalPath = canonicalPlayerPath(player.gameName, player.tagLine);
    revalidatePath(canonicalPath);

    const response = NextResponse.json({
      ok: true,
      playerId: String(player._id),
      canonicalPath,
      leaderboard: {
        group: player.leaderboard?.group ?? "burmese",
        status: player.leaderboard?.status ?? "approved",
      },
      refreshed: !!refreshOut && !refreshOut._skipped && !refreshOut._refreshError,
      skipped: !!refreshOut && !!refreshOut._skipped,
      nextRefreshAt: refreshOut?._nextRefreshAt ?? null,
      cooldownSecondsLeft: refreshOut?._cooldownSecondsLeft ?? null,
      refreshError: refreshOut?._refreshError ?? null,
    });

    if (acceptedCode) {
      await grantStoredCommunityAccessForDiscordUser(session.discordUserId);
      setCommunityAccessCookie(response, req.nextUrl.protocol === "https:");
    } else if (!unlockedBrowser && unlockedAccount) {
      setCommunityAccessCookie(response, req.nextUrl.protocol === "https:");
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    const status = /Connect Discord/i.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
