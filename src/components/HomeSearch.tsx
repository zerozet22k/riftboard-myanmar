"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const RANK_ICON_BASE =
    "https://raw.communitydragon.org/15.6/plugins/rcp-fe-lol-shared-components/global/default";

const PROFILE_ICON_BASE =
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons";

function tierIconUrl(tier?: string | null) {
    if (!tier) return `${RANK_ICON_BASE}/normal.png`;
    return `${RANK_ICON_BASE}/${String(tier).toLowerCase()}.png`;
}

function profileIconUrl(profileIconId?: number | null) {
    if (profileIconId == null || !Number.isFinite(Number(profileIconId))) return null;
    return `${PROFILE_ICON_BASE}/${Number(profileIconId)}.jpg`;
}

type SearchResult = {
    id: string;
    name: string;
    path: string;
    platform?: string | null;

    profileIconId?: number | null;

    soloTier?: string | null;
    soloDivision?: string | null;
    soloLp?: number | null;

    soloWins?: number | null;
    soloLosses?: number | null;
    soloWr?: number | null;
};

function normTier(tier?: string | null) {
    return tier ? String(tier).toUpperCase() : null;
}
function normDiv(div?: string | null) {
    return div ? String(div).toUpperCase() : null;
}

function rankLabel(tier?: string | null, div?: string | null) {
    if (!tier) return "UNRANKED";
    const t = normTier(tier);
    const d = normDiv(div);
    return d ? `${t} ${d}` : `${t}`;
}

function lpLabel(lp?: number | null) {
    if (lp == null || !Number.isFinite(Number(lp))) return null;
    return `${Number(lp).toLocaleString()} LP`;
}

function wlLabel(w?: number | null, l?: number | null) {
    if (w == null || l == null) return null;
    return `${w}-${l}`;
}

function wrLabel(wr?: number | null) {
    if (wr == null || !Number.isFinite(Number(wr))) return null;
    return `${Math.round(Number(wr))}%`;
}

function Pill({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span
            className={
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-none tabular-nums " +
                className
            }
        >
            {children}
        </span>
    );
}

export default function HomeSearch() {
    const router = useRouter();

    const wrapRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState<SearchResult[]>([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);

    const trimmed = q.trim();
    const showMenu = open && trimmed.length >= 2;

    useEffect(() => {
        function onDown(e: MouseEvent) {
            const el = wrapRef.current;
            if (!el) return;
            if (!el.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    useEffect(() => {
        abortRef.current?.abort();
        abortRef.current = null;

        if (trimmed.length < 2) {
            setItems([]);
            setLoading(false);
            setActive(0);
            return;
        }

        setLoading(true);
        const ac = new AbortController();
        abortRef.current = ac;

        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/p/search?q=${encodeURIComponent(trimmed)}`, {
                    signal: ac.signal,
                    cache: "no-store",
                });

                const data = (await res.json().catch(() => ({}))) as {
                    ok?: boolean;
                    items?: SearchResult[];
                };

                if (!ac.signal.aborted) {
                    const arr = Array.isArray(data.items) ? data.items : [];
                    const safe = arr.filter((x) => typeof x?.path === "string" && x.path.startsWith("/p/"));
                    setItems(safe);
                    setActive(0);
                    setOpen(true);
                }
            } catch {
                if (!ac.signal.aborted) setItems([]);
            } finally {
                if (!ac.signal.aborted) setLoading(false);
            }
        }, 200);

        return () => clearTimeout(t);
    }, [trimmed]);

    const canGo = Boolean(items[0]?.path);

    function go(it: SearchResult | undefined) {
        const href = it?.path;
        if (!href) return;
        setOpen(false);
        router.push(href);
    }

    const topHint = useMemo(() => {
        if (trimmed.length < 2) return "Type at least 2 characters…";
        if (loading) return "Searching…";
        if (!items.length) return "No results.";
        return null;
    }, [trimmed.length, loading, items.length]);

    return (
        <div ref={wrapRef} className="relative">
            <div className="flex items-center gap-2">
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onFocus={() => setOpen(true)}
                    onKeyDown={(e) => {
                        if (!showMenu && e.key !== "Escape") return;

                        if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setActive((i) => {
                                const max = Math.max(0, items.length - 1);
                                return Math.min(max, i + 1);
                            });
                        }
                        if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setActive((i) => Math.max(0, i - 1));
                        }
                        if (e.key === "Enter") {
                            e.preventDefault();
                            if (items.length === 1) go(items[0]);
                            else go(items[active]);
                        }
                        if (e.key === "Escape") setOpen(false);
                    }}
                    placeholder='Search players (e.g. "HideOnBush#KR1")'
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm outline-none focus:border-zinc-600"
                />

                <button
                    disabled={!canGo}
                    onClick={() => go(items[0])}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm disabled:opacity-40 hover:bg-zinc-900/40"
                >
                    Open
                </button>
            </div>

            {showMenu && (
                <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 backdrop-blur">
                    {/* Header */}
                    <div className="px-4 py-3 text-sm font-semibold text-zinc-200 border-b border-zinc-800">
                        Summoner Profiles
                    </div>

                    {topHint && (
                        <div className="px-4 py-3 text-xs text-zinc-400 border-b border-zinc-800">
                            {topHint}
                        </div>
                    )}

                    <div className="max-h-[360px] overflow-auto divide-y divide-zinc-800">
                        {!loading &&
                            items.map((it, idx) => {
                                const activeRow = idx === active;

                                // split name into game + tag
                                const raw = String(it.name ?? "");
                                const hash = raw.lastIndexOf("#");
                                const gameName = hash > 0 ? raw.slice(0, hash) : raw;
                                const tagLine = hash > 0 ? raw.slice(hash + 1) : "";

                                const tier = it.soloTier ?? null;
                                const div = it.soloDivision ?? null;
                                const lp = typeof it.soloLp === "number" ? it.soloLp : null;

                                const line2 =
                                    tier
                                        ? `${String(tier).toUpperCase()}${div ? ` ${String(div).toUpperCase()}` : ""}${lp != null ? ` - ${lp}LP` : ""
                                        }`
                                        : "UNRANKED";

                                const pIcon = profileIconUrl(it.profileIconId ?? null);

                                // highlight match in gameName
                                const ql = trimmed.toLowerCase();
                                const gnLower = gameName.toLowerCase();
                                const m = ql ? gnLower.indexOf(ql) : -1;

                                const nameNode =
                                    m >= 0 && ql.length > 0 ? (
                                        <>
                                            {gameName.slice(0, m)}
                                            <span className="text-red-400">{gameName.slice(m, m + ql.length)}</span>
                                            {gameName.slice(m + ql.length)}
                                        </>
                                    ) : (
                                        gameName
                                    );

                                return (
                                    <button
                                        key={it.id}
                                        onMouseEnter={() => setActive(idx)}
                                        onClick={() => go(it)}
                                        className={
                                            "w-full px-4 py-3 text-left transition outline-none " +
                                            (activeRow ? "bg-white/5" : "hover:bg-white/5")
                                        }
                                    >
                                        <div className="flex items-center gap-3">
                                            {/* HARD-CLAMPED avatar (never grows) */}
                                            <div
                                                style={{ width: 44, height: 44 }}
                                                className="flex-none rounded-full overflow-hidden border border-zinc-800 bg-zinc-900/40"
                                            >
                                                {pIcon ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={pIcon}
                                                        alt=""
                                                        className="block w-full h-full object-cover"
                                                        loading="lazy"
                                                        onError={(e) => {
                                                            const img = e.currentTarget;
                                                            if (img.dataset.fallback === "1") return;
                                                            img.dataset.fallback = "1";
                                                            img.src = String(img.src).replace(/\.jpg$/i, ".png");
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full" />
                                                )}
                                            </div>

                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-zinc-100 truncate">
                                                    {nameNode}
                                                    {tagLine ? <span className="text-zinc-400 font-normal"> #{tagLine}</span> : null}
                                                </div>

                                                <div className="text-sm text-zinc-500 truncate">{line2}</div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}

                    </div>
                </div>
            )}

        </div>
    );
}
