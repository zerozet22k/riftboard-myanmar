"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";

type ChampSummary = { id: number; name: string };

let _champNameMapPromise: Promise<Record<string, string>> | null = null;

function getChampNameMap(): Promise<Record<string, string>> {
  if (_champNameMapPromise) return _champNameMapPromise;

  _champNameMapPromise = fetch(CHAMP_SUMMARY_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load champion summary (${r.status})`);
      return r.json() as Promise<ChampSummary[]>;
    })
    .then((list) => {
      const map: Record<string, string> = {};
      for (const c of list) map[String(c.id)] = c.name;
      return map;
    })
    .catch((e) => {
      _champNameMapPromise = null; // allow retry
      throw e;
    });

  return _champNameMapPromise;
}

type Main = {
  championId: number | string | null;
  name: string | null;
  points: number | null;
};

type Row = {
  id: string;
  name: string;

  // you can still send platform from server, we just ignore it:
  platform?: string;

  // SOLO
  tier: string | null;
  div: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  wr?: number | null;
  key?: number;

  // FLEX
  flexTier: string | null;
  flexDiv: string | null;
  flexLp: number | null;
  flexWins: number | null;
  flexLosses: number | null;
  flexWr?: number | null;
  flexKey?: number;

  // MAINS
  mains?: Main[];
};

type PreparedRow = Row & {
  __soloKey: number;
  __flexKey: number;
  __soloWr: number | null;
  __flexWr: number | null;
  __mainsTop3: Main[];
};

const RANK_ICON_BASE =
  "https://raw.communitydragon.org/15.6/plugins/rcp-fe-lol-shared-components/global/default";

const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

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

function topMains(mains?: Main[]) {
  const src = Array.isArray(mains) ? mains : [];
  const sorted = [...src].sort((a, b) => (b.points ?? -1) - (a.points ?? -1));
  return sorted.slice(0, 3);
}

function champIconUrl(championId: number | string | null) {
  if (championId == null) return null;
  return `${CHAMP_ICON_BASE}/${String(championId)}.png`;
}

function tierToIcon(tier?: string | null) {
  if (!tier) return `${RANK_ICON_BASE}/normal.png`;
  return `${RANK_ICON_BASE}/${String(tier).toLowerCase()}.png`;
}

function prettyRank(tier?: string | null, div?: string | null) {
  if (!tier) return "UNRANKED";
  return `${String(tier).toUpperCase()}${div ? ` ${String(div).toUpperCase()}` : ""}`;
}

type SortCol = "soloRank" | "flexRank" | "player";
type SortState = { col: SortCol; dir: "asc" | "desc" };

function cmpStr(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function cmpNum(a: number, b: number) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function QueueCell({
  tier,
  div,
  lp,
  wins,
  losses,
  wr,
  labelRanked,
  labelUnranked,
}: {
  tier: string | null;
  div: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  wr: number | null;
  labelRanked: string;
  labelUnranked: string;
}) {
  const hasLp = lp != null && Number.isFinite(Number(lp));
  const wl = wins != null && losses != null ? `${wins}-${losses}` : "-";
  const wrText = wr != null ? `${wr}%` : "-";

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <img
        src={tierToIcon(tier)}
        alt={tier ? `${tier} emblem` : "Unranked"}
        className="h-8 w-8 sm:h-10 sm:w-10 shrink-0"
        loading="lazy"
      />

      <div className="leading-tight">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{prettyRank(tier, div)}</div>

          {tier && hasLp && (
            <span className="rounded-full border border-zinc-800 bg-zinc-950/40 px-2.5 py-0.5 text-xs sm:text-sm text-zinc-200 tabular-nums">
              {Number(lp).toLocaleString()} LP
            </span>
          )}
        </div>

        <div className="text-xs sm:text-sm text-zinc-400 tabular-nums">
          {wl} {" • "} {wrText}
        </div>

        <div className="text-xs text-zinc-500">{tier ? labelRanked : labelUnranked}</div>
      </div>
    </div>
  );
}

export default function PlayersTable({ initialRows }: { initialRows: Row[] }) {
  const [sort, setSort] = useState<SortState>({ col: "soloRank", dir: "desc" });
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  // championId -> champion name
  const [champNames, setChampNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;

    getChampNameMap()
      .then((m) => {
        if (alive) setChampNames(m);
      })
      .catch((e) => {
        console.warn("Failed to load champion names:", e);
      });

    return () => {
      alive = false;
    };
  }, []);

  const prepared = useMemo<PreparedRow[]>(() => {
    return initialRows.map((r) => {
      const soloKey = typeof r.key === "number" ? r.key : rankKey(r.tier, r.div, r.lp);
      const flexKey =
        typeof r.flexKey === "number" ? r.flexKey : rankKey(r.flexTier, r.flexDiv, r.flexLp);

      const soloWr = r.wr ?? winrate(r.wins, r.losses);
      const flexWr = r.flexWr ?? winrate(r.flexWins, r.flexLosses);

      return {
        ...r,
        __soloKey: soloKey,
        __flexKey: flexKey,
        __soloWr: soloWr,
        __flexWr: flexWr,
        __mainsTop3: topMains(r.mains),
      };
    });
  }, [initialRows]);

  const sorted = useMemo(() => {
    const arr = prepared.map((r, idx) => ({ r, idx })); // stable sort

    arr.sort((A, B) => {
      const a = A.r;
      const b = B.r;

      let c = 0;
      switch (sort.col) {
        case "soloRank":
          c = cmpNum(a.__soloKey, b.__soloKey);
          break;
        case "flexRank":
          c = cmpNum(a.__flexKey, b.__flexKey);
          break;
        case "player":
          c = cmpStr(a.name, b.name);
          break;
      }

      if (sort.dir === "desc") c = -c;
      return c || A.idx - B.idx;
    });

    return arr.map((x) => x.r);
  }, [prepared, sort]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pages);

  const slice = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  function toggle(col: SortCol) {
    setPage(1);
    setSort((prev) => {
      if (prev.col !== col) return { col, dir: "desc" };
      return { col, dir: prev.dir === "desc" ? "asc" : "desc" };
    });
  }

  function Th({
    col,
    children,
    className = "",
  }: {
    col: SortCol;
    children: ReactNode;
    className?: string;
  }) {
    const active = sort.col === col;
    const arrow = !active ? "" : sort.dir === "asc" ? " ▲" : " ▼";

    return (
      <th
        onClick={() => toggle(col)}
        className={"text-left p-4 select-none cursor-pointer hover:text-zinc-100 " + className}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        title="Click to sort"
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <span className="text-zinc-500">{arrow}</span>
        </span>
      </th>
    );
  }

  const startShown = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endShown = Math.min(total, (safePage - 1) * pageSize + slice.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-zinc-400">
          Showing <span className="text-zinc-200">{startShown}</span>–{" "}
          <span className="text-zinc-200">{endShown}</span> of{" "}
          <span className="text-zinc-200">{total}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">Rows</span>
          <select
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm"
            value={pageSize}
            onChange={(e) => {
              setPage(1);
              setPageSize(Number(e.target.value));
            }}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <div className="ml-2 inline-flex items-center gap-2">
            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
            >
              Prev
            </button>

            <span className="text-sm text-zinc-400">
              Page <span className="text-zinc-200">{safePage}</span> /{" "}
              <span className="text-zinc-200">{pages}</span>
            </span>

            <button
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={safePage === pages}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE (sm <): cards */}
      <div className="sm:hidden space-y-3">
        {slice.map((r, i) => {
          const absoluteIndex = (safePage - 1) * pageSize + i + 1;

          return (
            <div
              key={r.id}
              className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3"
            >
              <div>
                <div className="text-xs text-zinc-500 tabular-nums">#{absoluteIndex}</div>
                <div className="text-lg font-semibold">{r.name}</div>
              </div>

              {/* MAINS */}
              {r.__mainsTop3.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {r.__mainsTop3.map((m, idx) => {
                    const icon = champIconUrl(m.championId);
                    const fromMap = m.championId != null ? champNames[String(m.championId)] : null;

                    const label =
                      m.name ?? fromMap ?? (m.championId != null ? `#${m.championId}` : "Unknown");

                    const title =
                      m.points != null
                        ? `${label}: ${Number(m.points).toLocaleString()} pts`
                        : `${label}: (points later)`;

                    return (
                      <span
                        key={idx}
                        title={title}
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs text-zinc-200"
                      >
                        {icon && (
                          <img
                            src={icon}
                            alt={label}
                            className="h-5 w-5 rounded-full"
                            loading="lazy"
                          />
                        )}
                        <span className="max-w-[170px] truncate">{label}</span>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-zinc-500">No mains yet</div>
              )}

              {/* SOLO + FLEX */}
              <div className="grid gap-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3">
                  <QueueCell
                    tier={r.tier}
                    div={r.div}
                    lp={r.lp}
                    wins={r.wins}
                    losses={r.losses}
                    wr={r.__soloWr}
                    labelRanked="Ranked Solo"
                    labelUnranked="No solo rank"
                  />
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3">
                  <QueueCell
                    tier={r.flexTier}
                    div={r.flexDiv}
                    lp={r.flexLp}
                    wins={r.flexWins}
                    losses={r.flexLosses}
                    wr={r.__flexWr}
                    labelRanked="Ranked Flex"
                    labelUnranked="No flex rank"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {slice.length === 0 && (
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6 text-zinc-400">
            No players.
          </div>
        )}
      </div>

      {/* TABLET/DESKTOP (sm+): table */}
      <div className="hidden sm:block overflow-x-auto rounded-3xl border border-zinc-800 bg-zinc-900/30">
        <table className="min-w-full text-base">
          <thead className="sticky top-0 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
            <tr className="text-zinc-300">
              <th className="text-left p-4 w-14">#</th>

              <Th col="player" className="min-w-[320px]">
                Player
              </Th>

              <th className="text-left p-4 min-w-[260px]">Mains</th>

              <Th col="soloRank" className="min-w-[360px]">
                Solo
              </Th>

              <Th col="flexRank" className="min-w-[360px]">
                Flex
              </Th>
            </tr>
          </thead>

          <tbody>
            {slice.map((r, i) => {
              const absoluteIndex = (safePage - 1) * pageSize + i + 1;

              return (
                <tr
                  key={r.id}
                  className="border-b border-zinc-800 last:border-b-0 hover:bg-white/5"
                >
                  <td className="p-4 text-zinc-400 tabular-nums">{absoluteIndex}</td>

                  <td className="p-4">
                    <div className="font-semibold">{r.name}</div>
                  </td>

                  {/* MAINS COLUMN */}
                  <td className="p-4">
                    {r.__mainsTop3.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {r.__mainsTop3.map((m, idx) => {
                          const icon = champIconUrl(m.championId);
                          const fromMap =
                            m.championId != null ? champNames[String(m.championId)] : null;

                          const label =
                            m.name ??
                            fromMap ??
                            (m.championId != null ? `#${m.championId}` : "Unknown");

                          const title =
                            m.points != null
                              ? `${label}: ${Number(m.points).toLocaleString()} pts`
                              : `${label}: (points later)`;

                          return (
                            <span
                              key={idx}
                              title={title}
                              className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-sm text-zinc-200"
                            >
                              {icon && (
                                <img
                                  src={icon}
                                  alt={label}
                                  className="h-6 w-6 rounded-full"
                                  loading="lazy"
                                />
                              )}
                              <span className="max-w-[140px] truncate">{label}</span>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-500">—</span>
                    )}
                  </td>

                  <td className="p-4">
                    <QueueCell
                      tier={r.tier}
                      div={r.div}
                      lp={r.lp}
                      wins={r.wins}
                      losses={r.losses}
                      wr={r.__soloWr}
                      labelRanked="Ranked Solo"
                      labelUnranked="No solo rank"
                    />
                  </td>

                  <td className="p-4">
                    <QueueCell
                      tier={r.flexTier}
                      div={r.flexDiv}
                      lp={r.flexLp}
                      wins={r.flexWins}
                      losses={r.flexLosses}
                      wr={r.__flexWr}
                      labelRanked="Ranked Flex"
                      labelUnranked="No flex rank"
                    />
                  </td>
                </tr>
              );
            })}

            {slice.length === 0 && (
              <tr>
                <td className="p-8 text-base text-zinc-400" colSpan={5}>
                  No players.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
