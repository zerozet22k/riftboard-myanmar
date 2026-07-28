import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSessionFromRequest } from "@/lib/adminSession";
import { refreshAllPlayers } from "@/lib/refresh";
import {
  acquireSchedulerLease,
  deferSchedulerLease,
  releaseSchedulerLease,
} from "@/lib/schedulerLease";

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
  let lease: Awaited<ReturnType<typeof acquireSchedulerLease>> = null;
  try {
    if (!hasAdminSessionFromRequest(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    lease = await acquireSchedulerLease("riot-api-refresh");
    if (!lease) {
      return NextResponse.json(
        { ok: false, error: "Another refresh job is already running." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const normalResult = await refreshAllPlayers({
      leaderboardOnly: true,
      leaderboardGroup: "burmese",
      leaderboardStatus: "approved",
      limit: toInt(body.limit, 5, 1, 25),
      delayMs: toInt(body.delayMs, 1500, 0, 5000),
      matchesCount: toInt(body.matchesCount, 5, 1, 20),
      matchBackfillCount: toInt(body.matchBackfillCount, 0, 0, 20),
      force: toBool(body.force),
      syncMatches: toBool(body.syncMatches),
      syncTftMatches: false,
    });
    const tftResult = toBool(body.syncTftMatches) && !normalResult.rateLimited
      ? await refreshAllPlayers({
          leaderboardOnly: true,
          leaderboardGroup: "burmese",
          leaderboardStatus: "approved",
          limit: toInt(body.limit, 5, 1, 25),
          delayMs: toInt(body.delayMs, 1500, 0, 5000),
          matchesCount: toInt(body.matchesCount, 5, 1, 20),
          force: toBool(body.force),
          syncMatches: false,
          syncTftMatches: true,
          syncLolProfile: false,
        })
      : null;

    const result = {
      ok: normalResult.ok + (tftResult?.ok ?? 0),
      fail: normalResult.fail + (tftResult?.fail ?? 0),
      skipped: normalResult.skipped + (tftResult?.skipped ?? 0),
      scanned: normalResult.scanned + (tftResult?.scanned ?? 0),
      rateLimited: normalResult.rateLimited || (tftResult?.rateLimited ?? false),
      retryAfterMs: normalResult.retryAfterMs ?? tftResult?.retryAfterMs,
      errors: [
        ...normalResult.errors.map((error) => ({ ...error, phase: "normal" })),
        ...(tftResult?.errors.map((error) => ({ ...error, phase: "tft" })) ?? []),
      ],
      phases: {
        normal: normalResult,
        tft: tftResult,
      },
    };

    revalidatePath("/");
    revalidatePath("/leaderboard");
    revalidatePath("/tft");

    if (result.rateLimited) {
      const retryAfterSeconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 120_000) / 1000));
      await deferSchedulerLease(lease, retryAfterSeconds * 1000);
      lease = null;
      return NextResponse.json(
        { ok: false, error: "Riot rate limit reached; this batch stopped safely.", result },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Refresh failed" },
      { status: 500 }
    );
  } finally {
    if (lease) await releaseSchedulerLease(lease).catch(() => undefined);
  }
}
