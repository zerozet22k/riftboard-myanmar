import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSessionFromRequest } from "@/lib/adminSession";
import { refreshAllPlayers } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toBool(value: unknown) {
  return value === true || value === "1" || value === "true";
}

function toInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

export async function POST(req: NextRequest) {
  try {
    if (!hasAdminSessionFromRequest(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await refreshAllPlayers({
      leaderboardOnly: true,
      leaderboardGroup: "burmese",
      leaderboardStatus: "approved",
      limit: toInt(body.limit, 15, 1, 200),
      delayMs: toInt(body.delayMs, 900, 0, 5000),
      matchesCount: toInt(body.matchesCount, 20, 1, 100),
      force: toBool(body.force),
      syncMatches: toBool(body.syncMatches),
      syncTftMatches: toBool(body.syncTftMatches),
    });

    revalidatePath("/");
    revalidatePath("/leaderboard");
    revalidatePath("/tft");

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
