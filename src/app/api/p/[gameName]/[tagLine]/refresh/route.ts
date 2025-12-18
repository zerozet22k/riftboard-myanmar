import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { refreshPlayerById } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

function toBool(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function toInt(v: any, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export async function POST(
  req: NextRequest,
  ctx: {
    params:
      | { gameName: string; tagLine: string }
      | Promise<{ gameName: string; tagLine: string }>;
  }
) {
  try {
    const params = await ctx.params;

    const gameNameRaw = safeDecode(params?.gameName);
    const tagLineRaw = safeDecode(params?.tagLine);

    const gameNameNorm = norm(gameNameRaw);
    const tagLineNorm = norm(tagLineRaw);

    if (!gameNameNorm || !tagLineNorm) {
      return NextResponse.json({ ok: false, error: "Missing name/tag" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));

    const syncMatches = toBool(body?.syncMatches);
    const fullMastery = toBool(body?.fullMastery);

    // keep it sane
    const matchesCount = Math.max(1, Math.min(100, toInt(body?.matchesCount, 10)));

    // optional override for cooldown if you want it
    const force = toBool(body?.force);

    await dbConnect();

    const player = await Player.findOne(
      { gameNameNorm, tagLineNorm },
      { _id: 1, gameName: 1, tagLine: 1 }
    ).lean();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const out = await refreshPlayerById(String(player._id), {
      force,
      syncMatches,
      matchesCount,
      fullMastery, 
    });

    const canonicalPath = `/p/${encodeURIComponent(String(player.gameName))}/${encodeURIComponent(
      String(player.tagLine).toLowerCase()
    )}`;

    revalidatePath(canonicalPath);
    revalidatePath("/leaderboard");
    revalidatePath("/");

    return NextResponse.json({ ok: true, player: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 });
  }
}
