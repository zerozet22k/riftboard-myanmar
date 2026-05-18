
import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(s: string) {
    return String(s ?? "").trim().toLowerCase();
}

function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRiotIdLoose(input: string) {
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

function winrate(w?: number | null, l?: number | null) {
    if (w == null || l == null) return null;
    const total = w + l;
    if (!total) return 0;
    return Math.round((w / total) * 100);
}

type SearchPlayerRow = {
    _id?: unknown;
    gameName?: unknown;
    tagLine?: unknown;
    platform?: unknown;
    profileIconId?: unknown;
    solo?: Record<string, unknown> | null;
    flex?: Record<string, unknown> | null;
    tft?: Record<string, unknown> | null;
};

function toItem(p: SearchPlayerRow) {
    const gameName = String(p?.gameName ?? "").trim();
    const tagLine = String(p?.tagLine ?? "").trim();
    const tagLower = tagLine.toLowerCase();

    const solo = p?.solo ?? {};
    const flex = p?.flex ?? {};
    const tft = p?.tft ?? {};

    const soloWins = typeof solo?.wins === "number" ? solo.wins : null;
    const soloLosses = typeof solo?.losses === "number" ? solo.losses : null;

    const flexWins = typeof flex?.wins === "number" ? flex.wins : null;
    const flexLosses = typeof flex?.losses === "number" ? flex.losses : null;

    return {
        id: String(p?._id),
        name: `${gameName}#${tagLine}`,
        gameName,
        tagLine,
        path: `/p/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLower)}`,
        tftPath: `/tft/p/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLower)}`,

        platform: p?.platform ? String(p.platform).toUpperCase() : null,

        profileIconId: typeof p?.profileIconId === "number" ? p.profileIconId : null,

        soloTier: solo?.tier ?? null,
        soloDivision: solo?.division ?? null,
        soloLp: typeof solo?.lp === "number" ? solo.lp : null,
        soloWins,
        soloLosses,
        soloWr: winrate(soloWins, soloLosses),


        flexTier: flex?.tier ?? null,
        flexDivision: flex?.division ?? null,
        flexLp: typeof flex?.lp === "number" ? flex.lp : null,
        flexWins,
        flexLosses,
        flexWr: winrate(flexWins, flexLosses),

        tftTier: tft?.tier ?? null,
        tftDivision: tft?.division ?? null,
        tftLp: typeof tft?.lp === "number" ? tft.lp : null,
    };
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const qRaw = url.searchParams.get("q") ?? "";
    const q = qRaw.trim();

    if (q.length < 2) return NextResponse.json({ ok: true, items: [] });

    await dbConnect();

    const projection = {
        gameName: 1,
        tagLine: 1,
        platform: 1,
        profileIconId: 1,
        solo: 1,
        flex: 1,
        tft: 1,
        updatedAt: 1,
        lastRefreshAt: 1,
    } as const;


    const parsed = parseRiotIdLoose(q);
    if (parsed) {
        const exact = await Player.find(buildPlayerLookupQuery(parsed.gameName, parsed.tagLine), projection)
            .limit(10)
            .lean();

        return NextResponse.json({ ok: true, items: exact.map(toItem) });
    }


    const qNorm = normalize(q);
    const rxNorm = new RegExp(escapeRegex(qNorm), "i");
    const rxRaw = new RegExp(escapeRegex(q), "i");

    const found = await Player.find(
        {
            $or: [
                { gameName: rxRaw },
                { tagLine: rxRaw },
                { summonerName: rxRaw },
                { gameNameNorm: rxNorm },
                { tagLineNorm: rxNorm },
                { "riotIdAliases.gameName": rxRaw },
                { "riotIdAliases.tagLine": rxRaw },
                { "riotIdAliases.gameNameNorm": rxNorm },
                { "riotIdAliases.tagLineNorm": rxNorm },
            ],
        },
        projection
    )
        .sort({ updatedAt: -1, lastRefreshAt: -1, _id: -1 })
        .limit(10)
        .lean();

    return NextResponse.json({ ok: true, items: found.map(toItem) });
}
