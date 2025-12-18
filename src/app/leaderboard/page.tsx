
import Link from "next/link";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import AutoUIRefresh from "@/components/AutoUIRefresh";
import LeaderboardTable, { type LeaderboardRow } from "@/components/LeaderboardTable";
import RefreshButton from "@/components/RefreshButton";
import { refreshLeaderboardAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIER_ORDER: Record<string, number> = {
    CHALLENGER: 9,
    GRANDMASTER: 8,
    MASTER: 7,
    DIAMOND: 6,
    EMERALD: 5,
    PLATINUM: 4,
    GOLD: 3,
    SILVER: 2,
    BRONZE: 1,
    IRON: 0,
};

const DIV_ORDER: Record<string, number> = { I: 4, II: 3, III: 2, IV: 1 };

function rankKey(tier?: string | null, div?: string | null, lp?: number | null) {
    const t = tier ? TIER_ORDER[String(tier).toUpperCase()] : undefined;
    if (t === undefined) return -1;
    const d = div ? (DIV_ORDER[String(div).toUpperCase()] ?? 0) : 0;
    const points = Number.isFinite(Number(lp)) ? Number(lp) : 0;
    return t * 100000 + d * 1000 + points;
}

function winrate(w?: number | null, l?: number | null) {
    if (w == null || l == null) return null;
    const total = w + l;
    if (!total) return 0;
    return Math.round((w / total) * 100);
}

function topMains(p: any) {
    const src = Array.isArray(p.mains) ? p.mains : [];
    const mapped = src
        .map((x: any) => ({
            championId: x?.championId ?? null,
            points: x?.championPoints ?? null,
        }))
        .filter((m: any) => m.championId != null);

    mapped.sort((a: any, b: any) => (b.points ?? -1) - (a.points ?? -1));
    return mapped.slice(0, 3);
}

function lastUpdatedIso(p: any): string | null {
    const d = p?.lastRefreshAt ?? p?.solo?.fetchedAt ?? p?.flex?.fetchedAt ?? null;
    if (!d) return null;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function pHref(gameName: string, tagLine: string) {
    const gn = String(gameName ?? "").trim();
    const tl = String(tagLine ?? "").trim().toLowerCase();
    return `/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}`;
}

export default async function LeaderboardPage() {
    await dbConnect();


    const q: any = {
        "leaderboard.status": "approved",
        $or: [
            { "leaderboard.group": "burmese" },
            { "leaderboard.group": null },
            { leaderboard: { $exists: false } },
        ],
    };

    const players = await Player.find(
        q,
        {
            gameName: 1,
            tagLine: 1,
            platform: 1,
            solo: 1,
            flex: 1,
            mains: 1,
            lastRefreshAt: 1,
            updatedAt: 1,
        }
    ).lean();

    const rows: LeaderboardRow[] = players.map((p: any) => {
        const gameName = String(p.gameName ?? "").trim();
        const tagLineRaw = String(p.tagLine ?? "").trim();
        const tagLineLower = tagLineRaw.toLowerCase();
        const href = pHref(gameName, tagLineLower);

        const solo = p.solo || {};
        const flex = p.flex || {};

        const soloTier = solo.tier ?? null;
        const soloDiv = solo.division ?? null;
        const soloLp = solo.lp ?? null;

        const flexTier = flex.tier ?? null;
        const flexDiv = flex.division ?? null;
        const flexLp = flex.lp ?? null;

        return {
            id: String(p._id),


            gameName,
            tagLine: tagLineLower,
            href,

            name: `${gameName}#${tagLineRaw}`,
            platform: String(p.platform ?? "auto").toUpperCase(),
            updatedAt: lastUpdatedIso(p),


            tier: soloTier,
            div: soloDiv,
            lp: soloLp,
            wins: solo.wins ?? null,
            losses: solo.losses ?? null,
            wr: winrate(solo.wins ?? null, solo.losses ?? null),
            key: rankKey(soloTier, soloDiv, soloLp),


            flexTier,
            flexDiv,
            flexLp,
            flexWins: flex.wins ?? null,
            flexLosses: flex.losses ?? null,
            flexWr: winrate(flex.wins ?? null, flex.losses ?? null),
            flexKey: rankKey(flexTier, flexDiv, flexLp),

            mains: topMains(p),
        };
    });

    const rankedSolo = rows.filter((r) => r.tier).length;
    const rankedFlex = rows.filter((r) => r.flexTier).length;

    return (
        <main className="min-h-screen bg-zinc-950 text-zinc-100">
            <AutoUIRefresh everyMs={15000} />

            <div className="mx-auto max-w-full p-4 sm:p-6 space-y-6">
                <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-2">
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Leaderboard</h1>
                        <p className="text-sm text-zinc-400">
                            Add yourself at{" "}
                            <Link className="font-mono underline underline-offset-4 hover:text-zinc-200" href="/submit">
                                /submit
                            </Link>
                            .
                        </p>
                    </div>

                    <div className="flex flex-col sm:items-end gap-2">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                                Players: <span className="text-zinc-200">{rows.length}</span>
                            </span>
                            <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                                Solo ranked: <span className="text-zinc-200">{rankedSolo}</span>
                            </span>
                            <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                                Flex ranked: <span className="text-zinc-200">{rankedFlex}</span>
                            </span>
                        </div>

                        <RefreshButton action={refreshLeaderboardAction} />
                    </div>
                </header>

                <LeaderboardTable initialRows={rows} />
            </div>
        </main>
    );
}
