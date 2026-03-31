import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";
import MatchHistory, { type MatchRow } from "@/components/MatchHistory";
import ProfileRefreshButton from "@/components/ProfileRefreshButton";
import RankEmblem from "@/components/RankEmblem";
import { getLatestDdragonVersion } from "@/lib/ddragon";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CommunityDragon (id -> name + icons by id)
const CHAMP_SUMMARY_URL =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
const CHAMP_ICON_BASE =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

type RouteParams = { gameName: string; tagLine: string };

function safeDecode(seg: unknown) {
    try {
        return decodeURIComponent(String(seg ?? ""));
    } catch {
        return String(seg ?? "");
    }
}

function isoOrNull(d: any): string | null {
    if (!d) return null;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function cursorFromLast(last: any): string | null {
    if (!last) return null;
    const gameCreation = typeof last.gameCreation === "number" ? last.gameCreation : null;
    if (gameCreation == null) return null;

    const payload = { gc: gameCreation, id: String(last._id) };

    return Buffer.from(JSON.stringify(payload))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

async function getChampNameMap(): Promise<Record<string, string>> {
    const res = await fetch(CHAMP_SUMMARY_URL, {
        next: { revalidate: 60 * 60 * 24 }, // 24h
    });
    if (!res.ok) return {};
    const list = (await res.json()) as Array<{ id: number; name: string }>;
    const map: Record<string, string> = {};
    for (const c of list) map[String(c.id)] = c.name;
    return map;
}

function champIconUrl(championId: number | null) {
    if (championId == null) return null;
    return `${CHAMP_ICON_BASE}/${String(championId)}.png`;
}

type LastUpdated = string | null | undefined;
function formatLastUpdatedISO(v: LastUpdated) {
    if (!v) return null;
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) return v;

    const d = new Date(ms);

    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(d);
}
function rankLine(tier?: string | null, div?: string | null, lp?: number | null) {
    if (!tier) return "UNRANKED";
    const t = String(tier).toUpperCase();
    const d = div ? ` ${String(div).toUpperCase()}` : "";
    const l = lp != null && Number.isFinite(Number(lp)) ? ` - ${Number(lp)}LP` : "";
    return `${t}${d}${l}`;
}

export default async function PlayerProfilePage({
    params,
}: {
    params: RouteParams | Promise<RouteParams>;
}) {
    const p = (await params) as Partial<RouteParams>;

    const gameNameRaw = safeDecode(p?.gameName).trim();
    const tagLineRaw = safeDecode(p?.tagLine).trim().toLowerCase();
    if (!gameNameRaw || !tagLineRaw) notFound();

    await dbConnect();

    const player: any = await Player.findOne(
        buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
        {
            gameName: 1,
            tagLine: 1,
            platform: 1,
            matchRegion: 1,
            profileIconId: 1,
            summonerLevel: 1,
            lastRefreshAt: 1,
            solo: 1,
            flex: 1,
            mains: 1,
        }
    ).lean();

    if (!player) notFound();

    const canonicalGameName = String(player.gameName ?? "").trim();
    const canonicalTagLineLower = String(player.tagLine ?? "").trim().toLowerCase();
    const canonicalPath = canonicalPlayerPath(canonicalGameName, canonicalTagLineLower);

    if (gameNameRaw !== canonicalGameName || tagLineRaw !== canonicalTagLineLower) {
        redirect(canonicalPath);
    }

    const [ddVer, champNames] = await Promise.all([getLatestDdragonVersion(), getChampNameMap()]);

    const matchDocs = await PlayerMatch.find(
        { playerId: player._id },
        {
            matchId: 1,
            queueId: 1,
            gameCreation: 1,
            gameDuration: 1,

            championId: 1,
            teamId: 1,
            teamPosition: 1,

            primaryStyle: 1,
            primaryRune: 1,
            subStyle: 1,

            win: 1,
            kills: 1,
            deaths: 1,
            assists: 1,
            cs: 1,
            gold: 1,
            items: 1,
            summonerSpells: 1,
        }
    )
        .sort({ gameCreation: -1, _id: -1 })
        .limit(10)
        .lean();

    const initialMatches: MatchRow[] = matchDocs.map((m: any) => ({
        _id: String(m._id),
        matchId: String(m.matchId),
        queueId: typeof m.queueId === "number" ? m.queueId : null,
        gameCreation: typeof m.gameCreation === "number" ? m.gameCreation : null,
        gameDuration: typeof m.gameDuration === "number" ? m.gameDuration : null,

        championId: typeof m.championId === "number" ? m.championId : null,
        teamId: typeof m.teamId === "number" ? m.teamId : null,
        teamPosition: typeof m.teamPosition === "string" ? m.teamPosition : null,

        primaryStyle: typeof m.primaryStyle === "number" ? m.primaryStyle : null,
        primaryRune: typeof m.primaryRune === "number" ? m.primaryRune : null,
        subStyle: typeof m.subStyle === "number" ? m.subStyle : null,

        win: typeof m.win === "boolean" ? m.win : null,
        kills: typeof m.kills === "number" ? m.kills : null,
        deaths: typeof m.deaths === "number" ? m.deaths : null,
        assists: typeof m.assists === "number" ? m.assists : null,
        cs: typeof m.cs === "number" ? m.cs : null,
        gold: typeof m.gold === "number" ? m.gold : null,
        items: Array.isArray(m.items) ? m.items.filter((x: any) => typeof x === "number") : [],
        summonerSpells: Array.isArray(m.summonerSpells)
            ? m.summonerSpells.filter((x: any) => typeof x === "number")
            : [],
    }));

    const initialCursor = cursorFromLast(matchDocs[matchDocs.length - 1]);

    const profileIcon =
        typeof player.profileIconId === "number"
            ? `https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/profileicon/${player.profileIconId}.png`
            : null;

    const nameShown = `${player.gameName}#${player.tagLine}`;
    const lastUpdated =
        formatLastUpdatedISO(isoOrNull(player.lastRefreshAt) ?? isoOrNull(player.solo?.fetchedAt) ?? isoOrNull(player.flex?.fetchedAt));

    const solo = player.solo ?? {};
    const flex = player.flex ?? {};

    return (
        <main className="min-h-screen bg-zinc-950 text-zinc-100">
            <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
                <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                        <div className="h-16 w-16 rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden shrink-0">
                            {profileIcon ? (
                                <img src={profileIcon} alt="Profile icon" className="h-full w-full object-cover" />
                            ) : (
                                <div className="h-full w-full" />
                            )}
                        </div>
                        <div className="space-y-1">
                            <div className="text-2xl font-semibold tracking-tight">{nameShown}</div>

                            <div className="flex items-center gap-2 text-sm text-zinc-400">
                                <RankEmblem tier={solo.tier ?? null} className="h-5 w-5 shrink-0" alt="" />
                                <span className="text-zinc-300">{rankLine(solo.tier ?? null, solo.division ?? null, solo.lp ?? null)}</span>
                            </div>
                            <div className="text-sm text-zinc-400">
                                Level: <span className="text-zinc-200">{player.summonerLevel ?? "—"}</span>{" "}
                                <span className="text-zinc-600">•</span>{" "}
                                Platform: <span className="text-zinc-200">{String(player.platform ?? "auto").toUpperCase()}</span>{" "}
                                <span className="text-zinc-600">•</span>{" "}
                                Match region: <span className="text-zinc-200">{String(player.matchRegion ?? "—").toUpperCase()}</span>
                            </div>

                            <div className="text-xs text-zinc-500">
                                Last updated: <span className="text-zinc-300">{lastUpdated ?? "—"}</span>
                            </div>

                            <div className="pt-1 flex items-center gap-3 text-sm">
                                <Link
                                    href="/leaderboard"
                                    className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-2 text-sm hover:bg-zinc-900/60"
                                >
                                    Open leaderboard
                                </Link>
                                <Link
                                    href="/"
                                    className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-2 text-sm hover:bg-zinc-900/60"
                                >
                                    Go back to home
                                </Link>
                            </div>
                        </div>
                    </div>
                    <ProfileRefreshButton gameName={canonicalGameName} tagLine={canonicalTagLineLower} />
                </header>

                <section className="grid gap-4 sm:grid-cols-2">
                    <RankCard
                        title="Ranked Solo"
                        tier={solo.tier ?? null}
                        div={solo.division ?? null}
                        lp={solo.lp ?? null}
                        wins={solo.wins ?? null}
                        losses={solo.losses ?? null}
                    />
                    <RankCard
                        title="Ranked Flex"
                        tier={flex.tier ?? null}
                        div={flex.division ?? null}
                        lp={flex.lp ?? null}
                        wins={flex.wins ?? null}
                        losses={flex.losses ?? null}
                    />
                </section>

                <section className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6">
                    <div className="text-lg font-semibold">Top champions</div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        {Array.isArray(player.mains) && player.mains.length ? (
                            player.mains.slice(0, 3).map((m: any, idx: number) => {
                                const champId = typeof m?.championId === "number" ? m.championId : null;
                                const icon = champIconUrl(champId);
                                const name = champId != null ? champNames[String(champId)] : null;
                                const points = typeof m?.championPoints === "number" ? m.championPoints : null;

                                return (
                                    <span
                                        key={idx}
                                        className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-sm"
                                        title={name ? `${name} (#${champId})` : champId != null ? `Champion #${champId}` : "Champion"}
                                    >
                                        {icon ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={icon} alt={name ?? "Champion"} className="h-6 w-6 rounded-full" />
                                        ) : null}

                                        <span className="text-zinc-200">{name ?? (champId != null ? `#${champId}` : "—")}</span>

                                        <span className="text-zinc-500 tabular-nums">{points != null ? points.toLocaleString() : "—"} pts</span>
                                    </span>
                                );
                            })
                        ) : (
                            <div className="text-sm text-zinc-500">No mastery data yet.</div>
                        )}
                    </div>
                </section>

                <section className="space-y-3">
                    <div className="text-lg font-semibold">Match history</div>

                    <MatchHistory
                        gameName={canonicalGameName}
                        tagLine={canonicalTagLineLower}
                        ddragonVersion={ddVer}
                        initialMatches={initialMatches}
                        initialCursor={initialCursor}
                    />
                </section>
            </div>
        </main>
    );
}

function winrate(w: number | null, l: number | null) {
    if (w == null || l == null) return null;
    const total = w + l;
    if (!total) return 0;
    return Math.round((w / total) * 100);
}

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return <span className={"inline-flex items-center rounded-full border px-2.5 py-1 text-xs tabular-nums " + className}>{children}</span>;
}

function RankCard({
    title,
    tier,
    div,
    lp,
    wins,
    losses,
}: {
    title: string;
    tier: string | null;
    div: string | null;
    lp: number | null;
    wins: number | null;
    losses: number | null;
}) {
    const wr = winrate(wins, losses);
    const wl = wins != null && losses != null ? `${wins}-${losses}` : "—";
    const wrText = wr != null ? `${wr}%` : "—";

    const tierText = tier ? String(tier).toUpperCase() : "UNRANKED";
    const divText = tier && div ? String(div).toUpperCase() : null;

    return (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6">
            <div className="text-sm text-zinc-400">{title}</div>
            <div className="mt-3 flex items-center gap-4">
                <RankEmblem
                    tier={tier}
                    className="h-14 w-14 shrink-0"
                    alt={tier ? `${tier} emblem` : "Unranked emblem"}
                />

                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Pill className="border-zinc-800 bg-zinc-950/40 text-zinc-200">
                            {tierText} {divText} {lp != null ? `${Number(lp).toLocaleString()} LP` : "— LP"}
                        </Pill>
                    </div>

                    <div className="mt-2 text-sm text-zinc-400 tabular-nums">
                        {wl} <span className="text-zinc-600">•</span> {wrText}
                    </div>
                </div>
            </div>
        </div>
    );
}
