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

// handles: "Hide on bush#KR1", "Hide on bush KR1", "Hide on bush / KR1"
function parseRiotId(input: string) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    const cleaned = raw
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s*\/\s*/g, "#")
        .replace(/\s*#\s*/g, "#")
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

        await dbConnect();

        const gameNameNorm = normalize(gameName);
        const tagLineNorm = normalize(tagLine);

        const existing = await Player.findOne({ gameNameNorm, tagLineNorm }, { _id: 1 }).lean();

        const doc = await Player.findOneAndUpdate(
            { gameNameNorm, tagLineNorm },
            {
                $set: { gameName, tagLine },
                $setOnInsert: { gameNameNorm, tagLineNorm, platform: "auto" },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // refresh right after submit (cooldown respected)
        let refreshOut: any = null;
        try {
            refreshOut = await refreshPlayerById(String(doc._id));
        } catch (e: any) {
            refreshOut = { _refreshError: e?.message ?? "Refresh failed" };
        }

        revalidatePath("/");

        return NextResponse.json({
            ok: true,
            existed: !!existing,
            playerId: String(doc._id),
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
