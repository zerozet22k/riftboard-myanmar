import { NextRequest, NextResponse } from "next/server";
import { publishLiveGamesToDiscord } from "@/lib/liveGames";
import { getSchedulerTokens } from "@/lib/runtimeConfig";
import {
  acquireSchedulerLease,
  deferSchedulerLease,
  releaseSchedulerLease,
} from "@/lib/schedulerLease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.nextUrl.searchParams.get("key")?.trim() || "";
}

function isLocalDevRequest(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  const hostname = req.nextUrl.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return isLoopback;
}

function assertCronAuth(req: NextRequest) {
  if (isLocalDevRequest(req)) return;

  const allowed = getSchedulerTokens();
  if (!allowed.length) throw new Error("Missing SCHEDULER_TOKEN, CRON_SECRET, or CRON_KEY in environment");
  const token = getToken(req);
  if (!token || !allowed.includes(token)) throw new Error("Unauthorized");
}

function intParam(req: NextRequest, key: string, fallback: number, min: number, max: number) {
  const value = Number(req.nextUrl.searchParams.get(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function GET(req: NextRequest) {
  let lease: Awaited<ReturnType<typeof acquireSchedulerLease>> = null;
  try {
    assertCronAuth(req);
    lease = await acquireSchedulerLease("riot-api-refresh");
    if (!lease) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "Another refresh job is already running." },
        { status: 202, headers: { "Retry-After": "60" } }
      );
    }
    const live = await publishLiveGamesToDiscord({
      channelId: req.nextUrl.searchParams.get("channelId") || undefined,
      limit: intParam(req, "limit", 10, 1, 25),
      delayMs: intParam(req, "delayMs", 1500, 1200, 5000),
    });
    const result = {
      ok: live.posted,
      fail: live.errors.length,
      skipped: live.skipped + Math.max(0, live.checked - live.active),
      scanned: live.checked,
      errors: live.errors.map((error) => ({ error })),
      players: [],
      live,
    };

    const rateLimited = live.errors.some((error) => /429|rate limit/i.test(error));
    if (rateLimited) {
      await deferSchedulerLease(lease, 120_000);
      lease = null;
      return NextResponse.json(
        { ok: false, error: "Riot rate limit reached; live polling stopped safely.", result },
        { status: 429, headers: { "Retry-After": "120" } }
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live game publish failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : 500 }
    );
  } finally {
    if (lease) await releaseSchedulerLease(lease).catch(() => undefined);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
