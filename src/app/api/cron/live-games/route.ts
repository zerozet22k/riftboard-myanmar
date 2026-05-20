import { NextRequest, NextResponse } from "next/server";
import { publishLiveGamesToDiscord } from "@/lib/liveGames";
import { getSchedulerTokens } from "@/lib/runtimeConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.nextUrl.searchParams.get("key")?.trim() || "";
}

function isLocalDevRequest(req: NextRequest) {
  const hostname = req.nextUrl.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return isLoopback && process.env.VERCEL !== "1";
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
  try {
    assertCronAuth(req);
    const result = await publishLiveGamesToDiscord({
      channelId: req.nextUrl.searchParams.get("channelId") || undefined,
      limit: intParam(req, "limit", 200, 1, 200),
      delayMs: intParam(req, "delayMs", 350, 0, 5000),
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live game publish failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
