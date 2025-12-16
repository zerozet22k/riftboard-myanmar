import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshAllPlayers, refreshPlayerById, upsertAndRefreshByRiotId } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "all" | "playerId" | "riotId";


async function runAction(action: Action, params: any) {
  const force = !!params.force;
  const cooldownMs = params.cooldownMs != null ? Number(params.cooldownMs) : undefined;

  if (action === "all") {
    const delayMs = params.delayMs != null ? Number(params.delayMs) : 1100;
    const result = await refreshAllPlayers({ delayMs, force, cooldownMs });
    return { ok: true as const, action, result };
  }

  if (action === "playerId") {
    const playerId = String(params.playerId ?? "").trim();
    if (!playerId) return { ok: false as const, status: 400, error: "Missing playerId" };
    const player = await refreshPlayerById(playerId, { force, cooldownMs });
    return { ok: true as const, action, player };
  }

  if (action === "riotId") {
    const gameName = String(params.gameName ?? "").trim();
    const tagLine = String(params.tagLine ?? "").trim();
    if (!gameName || !tagLine) {
      return { ok: false as const, status: 400, error: "Missing gameName/tagLine" };
    }
    const player = await upsertAndRefreshByRiotId({ gameName, tagLine }, { force, cooldownMs });
    return { ok: true as const, action, player };
  }

  return { ok: false as const, status: 400, error: "Unknown action" };
}

export async function POST(req: NextRequest) {
  try {


    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "all") as Action;

    const out = await runAction(action, body);
    if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: out.status });

    revalidatePath("/");
    return NextResponse.json(out);
  } catch (e: any) {
    const msg = e?.message ?? "Error";
    return NextResponse.json(
      { ok: false, error: msg },
      { status: msg === "Unauthorized" ? 401 : 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {


    const url = new URL(req.url);

    const actionParam = url.searchParams.get("action")?.trim() as Action | null;
    const playerId = url.searchParams.get("playerId")?.trim();
    const gameName = url.searchParams.get("gameName")?.trim();
    const tagLine = url.searchParams.get("tagLine")?.trim();

    const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
    const cooldownMsParam = url.searchParams.get("cooldownMs");
    const cooldownMs = cooldownMsParam != null ? Number(cooldownMsParam) : undefined;

    const action: Action =
      actionParam ?? (playerId ? "playerId" : gameName && tagLine ? "riotId" : "all");

    const out = await runAction(action, { playerId, gameName, tagLine, force, cooldownMs });
    if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: out.status });

    revalidatePath("/");
    return NextResponse.json(out);
  } catch (e: any) {
    const msg = e?.message ?? "Error";
    return NextResponse.json(
      { ok: false, error: msg },
      { status: msg === "Unauthorized" ? 401 : 500 }
    );
  }
}
