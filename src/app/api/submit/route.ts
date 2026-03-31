// app/api/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { revalidatePath } from "next/cache";
import { refreshPlayerById } from "@/lib/refresh";
import { mergePlayers } from "@/lib/playerMerge";
import {
  canonicalPlayerPath,
  normalizeRiotIdPart,
  syncCanonicalRiotId,
} from "@/lib/playerIdentity";

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
type RefreshResult = {
  _skipped?: boolean;
  _nextRefreshAt?: string;
  _cooldownSecondsLeft?: number;
  _refreshError?: string;
};

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

    const gameNameNorm = normalizeRiotIdPart(gameName);
    const tagLineNorm = normalizeRiotIdPart(tagLine);
    const now = new Date();

    const [existingByPuuid, existingByRiotId] = await Promise.all([
      Player.findOne({ puuid }),
      Player.findOne({ gameNameNorm, tagLineNorm }),
    ]);

    let doc = existingByPuuid ?? existingByRiotId;
    let mergedByPuuid = false;

    if (existingByPuuid && existingByRiotId && String(existingByPuuid._id) !== String(existingByRiotId._id)) {
      doc = await mergePlayers(String(existingByPuuid._id), String(existingByRiotId._id));
      mergedByPuuid = true;
    } else if (existingByPuuid) {
      mergedByPuuid = !existingByRiotId || String(existingByPuuid._id) === String(existingByRiotId._id);
    }

    const existed = !!doc;
    const previousPath =
      doc?.gameName && doc?.tagLine ? canonicalPlayerPath(doc.gameName, doc.tagLine) : null;

    if (!doc) {
      doc = new Player({
        gameName,
        tagLine,
        platform: "auto",
        puuid,
        leaderboard: {
          group: "burmese",
          status: "approved",
          requestedAt: now,
          approvedAt: now,
        },
      });
    }

    const { renamed } = syncCanonicalRiotId(doc, gameName, tagLine, now);

    doc.puuid = puuid;
    doc.platform = doc.platform || "auto";
    doc.leaderboard = {
      ...(doc.leaderboard ?? {}),
      group: "burmese",
      status: "approved",
      requestedAt: doc.leaderboard?.requestedAt ?? now,
      approvedAt: now,
    };

    await doc.save();

    let refreshOut: RefreshResult | null = null;
    try {
      refreshOut = (await refreshPlayerById(String(doc._id), {
        force: true,
        fullMastery: false,
        syncMatches: true,
        matchesCount: 10,
      })) as RefreshResult;
    } catch (e: unknown) {
      refreshOut = { _refreshError: e instanceof Error ? e.message : "Refresh failed" };
    }

    revalidatePath("/");
    revalidatePath("/leaderboard");

    const canonicalPath = canonicalPlayerPath(doc.gameName, doc.tagLine);

    if (renamed && previousPath && previousPath !== canonicalPath) {
      revalidatePath(previousPath);
    }

    revalidatePath(canonicalPath);

    return NextResponse.json({
      ok: true,
      existed,
      renamed,
      mergedByPuuid,
      playerId: String(doc._id),
      canonicalPath,
      leaderboard: {
        group: doc.leaderboard?.group ?? "burmese",
        status: doc.leaderboard?.status ?? "approved",
      },
      refreshed: !!refreshOut && !refreshOut._skipped && !refreshOut._refreshError,
      skipped: !!refreshOut && !!refreshOut._skipped,
      nextRefreshAt: refreshOut?._nextRefreshAt ?? null,
      cooldownSecondsLeft: refreshOut?._cooldownSecondsLeft ?? null,
      refreshError: refreshOut?._refreshError ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error" },
      { status: 500 }
    );
  }
}
