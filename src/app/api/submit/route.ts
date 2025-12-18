// app/api/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { revalidatePath } from "next/cache";
import { refreshPlayerById } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SubmitSchema = z
  .object({
    riotId: z.string().trim().optional(),
    gameName: z.string().trim().min(2).max(16).optional(),
    tagLine: z.string().trim().min(2).max(10).optional(),
    code: z.string().trim().optional(),
  })
  .refine((v) => (v.gameName && v.tagLine) || v.riotId, {
    message: "Missing Riot ID",
  });

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function parseRiotId(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s*\/\s*/g, "#")
    .replace(/\s*#\s*/g, "#")
    .replace(/#+/g, "#")
    .trim();

  if (cleaned.includes("#")) {
    const i = cleaned.lastIndexOf("#");
    const gameName = cleaned.slice(0, i).trim();
    const tagLine = cleaned.slice(i + 1).trim();
    return gameName && tagLine ? { gameName, tagLine } : null;
  }

  const m = cleaned.match(/^(.*\S)\s+(\S+)$/);
  if (!m) return null;
  return { gameName: m[1].trim(), tagLine: m[2].trim() };
}

const RIOT_API_KEY = process.env.RIOT_API_KEY?.trim() || "";
const ACCOUNT_REGIONS = ["asia", "europe", "americas"] as const;

type RiotAccountDto = { puuid: string; gameName: string; tagLine: string };

async function resolveAccountAnyRegion(gameName: string, tagLine: string) {
  if (!RIOT_API_KEY) throw new Error("Missing RIOT_API_KEY in .env");

  const gn = encodeURIComponent(gameName);
  const tl = encodeURIComponent(tagLine);

  for (const region of ACCOUNT_REGIONS) {
    const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gn}/${tl}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Riot-Token": RIOT_API_KEY },
      cache: "no-store",
    });

    if (res.status === 404) continue;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Riot Account API ${res.status}: ${text || res.statusText}`);
    }

    const account = (await res.json()) as RiotAccountDto;
    return { region, account };
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const parsed = SubmitSchema.safeParse({
      riotId: body.riotId,
      gameName: body.gameName,
      tagLine: body.tagLine,
      code: String(body.code ?? "").trim() || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }

    const requiredCode = process.env.SUBMIT_CODE?.trim();
    if (requiredCode && parsed.data.code !== requiredCode) {
      return NextResponse.json({ ok: false, error: "Wrong code" }, { status: 401 });
    }

    let gameName = (parsed.data.gameName || "").trim();
    let tagLine = (parsed.data.tagLine || "").trim();

    if ((!gameName || !tagLine) && parsed.data.riotId) {
      const p = parseRiotId(parsed.data.riotId);
      if (!p) {
        return NextResponse.json({ ok: false, error: "Invalid Riot ID format" }, { status: 400 });
      }
      gameName = p.gameName;
      tagLine = p.tagLine;
    }

    if (!gameName || !tagLine) {
      return NextResponse.json({ ok: false, error: "Missing gameName/tagLine" }, { status: 400 });
    }

    const resolved = await resolveAccountAnyRegion(gameName, tagLine);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: "Riot ID not found" }, { status: 404 });
    }

    gameName = resolved.account.gameName;
    tagLine = resolved.account.tagLine;
    const puuid = resolved.account.puuid;

    await dbConnect();

    const gameNameNorm = normalize(gameName);
    const tagLineNorm = normalize(tagLine);
    const now = new Date();

    const existing = await Player.findOne(
      { gameNameNorm, tagLineNorm },
      { _id: 1, leaderboard: 1 }
    ).lean();

    const doc = await Player.findOneAndUpdate(
      { gameNameNorm, tagLineNorm },
      {
        $set: {
          gameName,
          tagLine,
          puuid,

          "leaderboard.group": "burmese",
          "leaderboard.status": "approved",
          "leaderboard.approvedAt": now,
        },
        $setOnInsert: {
          gameNameNorm,
          tagLineNorm,
          platform: "auto",
          "leaderboard.requestedAt": now, 
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    let refreshOut: any = null;
    try {
      refreshOut = await refreshPlayerById(String(doc._id), {
        force: true,
        fullMastery: false,
        syncMatches: true,
        matchesCount: 10,
      });
    } catch (e: any) {
      refreshOut = { _refreshError: e?.message ?? "Refresh failed" };
    }

    revalidatePath("/");
    revalidatePath("/leaderboard");

    revalidatePath(
      `/p/${encodeURIComponent(String(doc.gameName))}/${encodeURIComponent(String(doc.tagLine).toLowerCase())}`
    );

    return NextResponse.json({
      ok: true,
      existed: !!existing,
      playerId: String(doc._id),
      leaderboard: {
        group: (doc as any)?.leaderboard?.group ?? "burmese",
        status: (doc as any)?.leaderboard?.status ?? "approved",
      },
      refreshed: !!refreshOut && !refreshOut._skipped && !refreshOut._refreshError,
      skipped: !!refreshOut && !!refreshOut._skipped,
      nextRefreshAt: refreshOut?._nextRefreshAt ?? null,
      cooldownSecondsLeft: refreshOut?._cooldownSecondsLeft ?? null,
      refreshError: refreshOut?._refreshError ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 });
  }
}
