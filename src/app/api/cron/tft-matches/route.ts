import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { refreshAllPlayers } from "@/lib/refresh";
import { getSchedulerTokens } from "@/lib/runtimeConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = Math.max(1, Math.min(200, Number(process.env.TFT_MATCH_CRON_LIMIT ?? 50) || 50));
const DEFAULT_DELAY_MS = Math.max(0, Math.min(5000, Number(process.env.TFT_MATCH_CRON_DELAY_MS ?? 900) || 900));
const DEFAULT_MATCHES_COUNT = Math.max(1, Math.min(100, Number(process.env.TFT_MATCH_CRON_MATCHES_COUNT ?? 20) || 20));

function getToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return new URL(req.url).searchParams.get("key")?.trim() || "";
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

function numParam(url: URL, key: string, def?: number) {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function boolParam(url: URL, key: string, def = false) {
  const raw = url.searchParams.get(key);
  if (raw == null) return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

export async function GET(req: NextRequest) {
  try {
    assertCronAuth(req);

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(200, numParam(url, "limit", DEFAULT_LIMIT)!));
    const delayMs = Math.max(0, Math.min(5000, numParam(url, "delayMs", DEFAULT_DELAY_MS)!));
    const cooldownMs = numParam(url, "cooldownMs", undefined);
    const force = boolParam(url, "force", false);
    const matchesCount = Math.max(1, Math.min(100, numParam(url, "matchesCount", DEFAULT_MATCHES_COUNT)!));

    const result = await refreshAllPlayers({
      leaderboardOnly: true,
      leaderboardGroup: "burmese",
      leaderboardStatus: "approved",
      limit,
      delayMs,
      cooldownMs,
      force,
      syncMatches: false,
      syncTftMatches: true,
      matchesCount,
    });

    revalidatePath("/tft");

    return NextResponse.json({ ok: true, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ ok: false, error: msg }, { status: msg === "Unauthorized" ? 401 : 500 });
  }
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
