// app/api/cron/leaderboard/route.ts
import { NextRequest, NextResponse } from "next/server";
import { refreshAllPlayers } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string {
    const auth = req.headers.get("authorization") || "";
    if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
    return new URL(req.url).searchParams.get("key")?.trim() || "";
}

function assertCronAuth(req: NextRequest) {
    const required = process.env.CRON_KEY?.trim();
    if (!required) throw new Error("Missing CRON_KEY in .env");
    const token = getToken(req);
    if (!token || token !== required) throw new Error("Unauthorized");
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

        const limit = Math.max(1, Math.min(200, numParam(url, "limit", 20)!));
        const delayMs = Math.max(0, Math.min(5000, numParam(url, "delayMs", 900)!));
        const cooldownMs = numParam(url, "cooldownMs", undefined);
        const force = boolParam(url, "force", false);

        const result = await refreshAllPlayers({
            leaderboardOnly: true,
            leaderboardGroup: "burmese",
            leaderboardStatus: "approved",
            limit,
            delayMs,
            cooldownMs,
            force,
        });

        return NextResponse.json({ ok: true, result });
    } catch (e: any) {
        const msg = e?.message ?? "Error";
        return NextResponse.json(
            { ok: false, error: msg },
            { status: msg === "Unauthorized" ? 401 : 500 }
        );
    }
}

// lock it down: no POST
export async function POST() {
    return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
