// src/components/MatchHistory.tsx
"use client";

import { useState } from "react";

export type MatchRow = {
    _id: string;
    matchId: string;
    queueId: number | null;
    gameCreation: number | null;
    gameDuration: number | null;

    championId: number | null;
    win: boolean | null;

    kills: number | null;
    deaths: number | null;
    assists: number | null;

    cs: number | null;
    gold: number | null;

    items: number[];
    summonerSpells: number[];
};

function queueName(queueId: number | null) {
    if (queueId == null) return "Unknown";
    return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

const QUEUE_NAMES: Record<number, string> = {
    // Ranked
    420: "Ranked Solo/Duo",
    440: "Ranked Flex",
    700: "Clash",

    // Normal SR
    400: "Normal Draft",
    430: "Normal Blind",
    490: "Quickplay",

    // ARAM + rotating
    450: "ARAM",
    900: "ARURF",
    1010: "URF",
    1020: "One for All",
    1300: "Nexus Blitz",
    1400: "Ultimate Spellbook",

    // Bot games
    830: "Co-op vs AI (Intro)",
    840: "Co-op vs AI (Beginner)",
    850: "Co-op vs AI (Intermediate)",

    // Arena / special (these come and go; harmless if unused)
    1700: "Arena",
    1710: "Arena",
    1720: "Arena",

    // TFT (if you ever store these)
    1090: "TFT (Normal)",
    1100: "TFT (Ranked)",
    1110: "TFT (Tutorial)",
    1130: "TFT (Hyper Roll)",
    1160: "TFT (Double Up)",
};

const CHAMP_ICON_BASE =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

function matchesUrl(gameName: string, tagLine: string, limit: number, cursor?: string | null) {
    const gn = String(gameName ?? "").trim();
    const tl = String(tagLine ?? "").trim().toLowerCase();
    const base = `/api/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}/matches`;

    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    qs.set("autosync", "1");
    if (cursor) qs.set("cursor", cursor);

    return `${base}?${qs.toString()}`;
}


export default function MatchHistory({
    gameName,
    tagLine,
    ddragonVersion,
    initialMatches,
    initialCursor,
}: {
    gameName: string;
    tagLine: string;
    ddragonVersion: string;
    initialMatches: MatchRow[];
    initialCursor: string | null;
}) {
    const [items, setItems] = useState<MatchRow[]>(initialMatches);
    const [cursor, setCursor] = useState<string | null>(initialCursor);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function loadMore() {
        if (!cursor || loading) return;

        const gn = String(gameName ?? "").trim();
        const tl = String(tagLine ?? "").trim().toLowerCase();
        if (!gn || !tl) {
            setErr("Missing gameName/tagLine");
            return;
        }

        setLoading(true);
        setErr(null);

        try {
            const res = await fetch(matchesUrl(gn, tl, 10, cursor), { cache: "no-store" });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j?.ok) throw new Error(j?.error ?? `Failed (${res.status})`);

            setItems((prev) => [...prev, ...(Array.isArray(j.matches) ? j.matches : [])]);
            setCursor(j.nextCursor ?? null);
        } catch (e: any) {
            setErr(e?.message ?? "Load failed");
        } finally {
            setLoading(false);
        }
    }

    const empty = items.length === 0;

    return (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6 space-y-4">
            {empty ? (
                <div className="text-sm text-zinc-400">No matches yet. Hit Refresh to sync some.</div>
            ) : (
                <div className="space-y-3">
                    {items.map((m) => {
                        const icon = m.championId != null ? `${CHAMP_ICON_BASE}/${m.championId}.png` : null;

                        const k = m.kills ?? 0;
                        const d = m.deaths ?? 0;
                        const a = m.assists ?? 0;
                        const kda = d === 0 ? `${k + a}.00` : ((k + a) / d).toFixed(2);

                        const win = m.win === true;
                        const time = m.gameCreation ? new Date(m.gameCreation).toLocaleString() : "—";

                        return (
                            <div key={m._id} className="rounded-2xl border border-zinc-800 bg-zinc-950/25 p-3 sm:p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        {icon ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={icon} alt="Champion" className="h-12 w-12 rounded-2xl" />
                                        ) : (
                                            <div className="h-12 w-12 rounded-2xl border border-zinc-800 bg-zinc-900/40" />
                                        )}

                                        <div className="leading-tight">
                                            <div className="text-sm text-zinc-400">{queueName(m.queueId)}</div>
                                            <div className="text-base font-semibold">
                                                {win ? "Win" : "Loss"}{" "}
                                                <span className="text-zinc-500 font-normal">•</span>{" "}
                                                <span className="text-zinc-300 tabular-nums">
                                                    {k}/{d}/{a} ({kda})
                                                </span>
                                            </div>
                                            <div className="text-xs text-zinc-500">{time}</div>
                                        </div>
                                    </div>

                                    <div className="text-right text-xs text-zinc-500 tabular-nums">
                                        <div>CS: {m.cs ?? "—"}</div>
                                        <div>Gold: {m.gold != null ? m.gold.toLocaleString() : "—"}</div>
                                    </div>
                                </div>

                                {/* Items */}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {m.items?.length ? (
                                        m.items.slice(0, 7).map((id, idx) => {
                                            const url = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`;
                                            return (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    key={`${m._id}-${id}-${idx}`}
                                                    src={url}
                                                    alt={`Item ${id}`}
                                                    title={`Item ${id}`}
                                                    className="h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900/30"
                                                    loading="lazy"
                                                />
                                            );
                                        })
                                    ) : (
                                        <div className="text-xs text-zinc-500">No items captured.</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {err && <div className="text-sm text-red-300">{err}</div>}

            <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-500">
                    Showing <span className="text-zinc-300">{items.length}</span> matches
                </div>

                <button
                    onClick={loadMore}
                    disabled={!cursor || loading}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm disabled:opacity-40"
                >
                    {loading ? "Loading…" : cursor ? "Load more" : "No more"}
                </button>
            </div>
        </div>
    );
}
