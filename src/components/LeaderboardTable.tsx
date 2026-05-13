"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LeaderboardPager, LeaderboardSearchBar } from "@/components/LeaderboardControls";
import ProfileAvatar from "@/components/ProfileAvatar";
import RankEmblem from "@/components/RankEmblem";
import { formatNumber, formatRelativeTime } from "@/lib/displayTime";

const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

type ChampSummary = { id: number; name: string };

let champNameMapPromise: Promise<Record<string, string>> | null = null;

function getChampNameMap() {
  if (champNameMapPromise) return champNameMapPromise;

  champNameMapPromise = fetch(CHAMP_SUMMARY_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load champion summary (${response.status})`);
      return response.json() as Promise<ChampSummary[]>;
    })
    .then((list) => {
      const map: Record<string, string> = {};
      for (const champion of list) map[String(champion.id)] = champion.name;
      return map;
    })
    .catch((error) => {
      champNameMapPromise = null;
      throw error;
    });

  return champNameMapPromise;
}

type Main = {
  championId: number | string | null;
  name: string | null;
  points: number | null;
};

type RecentMain = {
  championId: number;
  games: number;
  winrate: number;
};

type RecentLane = {
  name: string;
  games: number;
  percent: number;
};

type RecentQueueSummary = {
  games: number;
  winrate: number;
  lanes: RecentLane[];
  mains: RecentMain[];
};

export type LeaderboardRow = {
  id: string;
  href?: string;
  gameName?: string;
  tagLine?: string;
  name: string;
  platform?: string;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  updatedAt?: string | null;
  tier: string | null;
  div: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  wr?: number | null;
  key?: number;
  peakTier?: string | null;
  peakDiv?: string | null;
  peakLp?: number | null;
  flexTier: string | null;
  flexDiv: string | null;
  flexLp: number | null;
  flexWins: number | null;
  flexLosses: number | null;
  flexWr?: number | null;
  flexKey?: number;
  peakFlexTier?: string | null;
  peakFlexDiv?: string | null;
  peakFlexLp?: number | null;
  mains?: Main[];
  recentSolo?: RecentQueueSummary | null;
  recentFlex?: RecentQueueSummary | null;
};

type PreparedRow = LeaderboardRow & {
  __soloKey: number;
  __flexKey: number;
  __soloWr: number | null;
  __flexWr: number | null;
  __mainsTop3: Main[];
};

type SortCol = "soloRank" | "flexRank" | "player";
type SortState = { col: SortCol; dir: "asc" | "desc" };
type RankFilter = "all" | "anyRanked" | "soloRanked" | "flexRanked";

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
  const tierScore = tier ? TIER_ORDER[String(tier).toUpperCase()] : undefined;
  if (tierScore === undefined) return -1;
  const divisionScore = div ? DIV_ORDER[String(div).toUpperCase()] ?? 0 : 0;
  const lpScore = Number.isFinite(Number(lp)) ? Number(lp) : 0;
  return tierScore * 100000 + divisionScore * 1000 + lpScore;
}

function winrate(wins?: number | null, losses?: number | null) {
  if (wins == null || losses == null) return null;
  const total = wins + losses;
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function topMains(mains?: Main[]) {
  const list = Array.isArray(mains) ? [...mains] : [];
  list.sort((left, right) => (right.points ?? -1) - (left.points ?? -1));
  return list.slice(0, 3);
}

function profileHref(row: LeaderboardRow) {
  if (row.href) return row.href;
  const gameName = String(row.gameName ?? "").trim();
  const tagLine = String(row.tagLine ?? "").trim().toLowerCase();
  if (gameName && tagLine) return `/p/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

  const raw = String(row.name ?? "");
  const hash = raw.lastIndexOf("#");
  if (hash > 0) {
    const namePart = raw.slice(0, hash).trim();
    const tagPart = raw.slice(hash + 1).trim().toLowerCase();
    if (namePart && tagPart) {
      return `/p/${encodeURIComponent(namePart)}/${encodeURIComponent(tagPart)}`;
    }
  }

  return "/leaderboard";
}

function shortNumber(value?: number | null) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) < 1000) return formatNumber(numeric);

  const units = ["K", "M", "B"];
  let scaled = Math.abs(numeric);
  let unitIndex = -1;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex++;
  }

  const rounded = Math.round(scaled);
  const prefix = numeric < 0 ? "-" : "";
  return `${prefix}${rounded}${units[unitIndex] ?? ""}`;
}

function parseUpdatedTs(iso?: string | null) {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function relTime(iso: string | null | undefined) {
  const timestamp = parseUpdatedTs(iso);
  if (!timestamp) return "--";
  return formatRelativeTime(timestamp, Date.now()) ?? "--";
}

function prettyRank(tier?: string | null, div?: string | null) {
  if (!tier) return "UNRANKED";
  return `${String(tier).toUpperCase()}${div ? ` ${String(div).toUpperCase()}` : ""}`;
}

function champIconUrl(championId: number | string | null) {
  if (championId == null) return null;
  return `${CHAMP_ICON_BASE}/${String(championId)}.png`;
}

function compareString(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareNumber(left: number, right: number) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-none ${className}`}>
      {children}
    </span>
  );
}

function HeaderCell({
  col,
  children,
  className = "",
  sort,
  onToggle,
}: {
  col: SortCol;
  children: ReactNode;
  className?: string;
  sort: SortState;
  onToggle: (col: SortCol) => void;
}) {
  const active = sort.col === col;
  const arrow = !active ? "" : sort.dir === "asc" ? "^" : "v";

  return (
    <th
      className={`cursor-pointer select-none p-4 text-left hover:text-zinc-100 ${className}`}
      onClick={() => onToggle(col)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-2">
        {children}
        <span className="text-zinc-500">{arrow}</span>
      </span>
    </th>
  );
}

function MainsStrip({
  mains,
  champNames,
}: {
  mains: Main[];
  champNames: Record<string, string>;
}) {
  if (!mains.length) {
    return <span className="text-sm text-zinc-500">No mains yet</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mains.map((main, index) => {
        const icon = champIconUrl(main.championId);
        const championName =
          main.name ?? (main.championId != null ? champNames[String(main.championId)] : null) ?? "Unknown";
        const shortPoints = shortNumber(main.points);
        const fullPoints = main.points != null ? formatNumber(main.points) : null;

        return (
          <span
            key={`${main.championId ?? "unknown"}-${index}`}
            title={fullPoints ? `${championName}: ${fullPoints} pts` : championName}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950/50 text-xs text-zinc-200 ring-1 ring-white/5"
          >
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt={championName} className="h-8 w-8 rounded-lg" loading="lazy" />
            ) : null}
            {shortPoints ? (
              <span className="absolute -bottom-1 -right-1 rounded bg-zinc-950/95 px-1 text-[9px] leading-3 text-zinc-300 ring-1 ring-white/10">
                {shortPoints}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function LaneIcon({ lane }: { lane: string }) {
  const normalized = lane.toLowerCase();
  const assetName =
    normalized === "support"
      ? "support"
      : normalized === "bot"
        ? "bot"
        : normalized === "mid"
          ? "mid"
          : normalized === "jungle"
            ? "jungle"
            : "top";
  const title = `${lane} lane`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://raw.communitydragon.org/11.15/plugins/rcp-be-lol-game-data/global/default/assets/ranked/positions/rankposition_gold-${assetName}.png`}
      alt={title}
      title={title}
      className="h-4 w-4"
      loading="lazy"
    />
  );
}

function RecentQueueStrip({
  summary,
  champNames,
}: {
  summary?: RecentQueueSummary | null;
  champNames: Record<string, string>;
}) {
  if (!summary || summary.games === 0) {
    return (
      <div className="mt-1.5 text-xs text-zinc-500">
        No recent games saved
      </div>
    );
  }

  return (
    <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
      <div className="shrink-0">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">L{summary.games}</div>
        <div className="text-sm font-semibold tabular-nums text-zinc-100">{summary.winrate}%</div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {summary.mains.length ? (
          <div className="flex min-w-0 items-center gap-1">
            {summary.mains.map((main) => {
              const championName = champNames[String(main.championId)] ?? `Champion ${main.championId}`;
              return (
                <span
                  key={main.championId}
                  title={`${championName}: ${main.games} games, ${main.winrate}% WR`}
                  className="relative inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-950/55 text-[11px] text-zinc-300"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={champIconUrl(main.championId) ?? ""} alt={championName} className="h-6 w-6 rounded-md" loading="lazy" />
                  <span className="absolute -bottom-1 -right-1 rounded bg-zinc-950/95 px-1 text-[8px] leading-3 text-zinc-300">
                    {main.games}
                  </span>
                </span>
              );
            })}
          </div>
        ) : null}

        {summary.lanes.length ? (
          <div className="flex shrink-0 items-center gap-1">
            {summary.lanes.map((lane) => (
              <span
                key={lane.name}
                className="relative inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-950/55"
                title={`${lane.name}: ${lane.games} games, ${lane.percent}% of recent queue games`}
              >
                <LaneIcon lane={lane.name} />
                <span className="absolute -bottom-1 -right-1 rounded bg-zinc-950/95 px-1 text-[8px] leading-3 text-zinc-300">
                  {lane.percent}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QueueCell({
  tier,
  div,
  lp,
  wins,
  losses,
  wr,
  peakTier,
  peakDiv,
  peakLp,
  labelRanked,
  labelUnranked,
  recent,
  champNames,
}: {
  tier: string | null;
  div: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  wr: number | null;
  peakTier: string | null;
  peakDiv: string | null;
  peakLp: number | null;
  labelRanked: string;
  labelUnranked: string;
  recent?: RecentQueueSummary | null;
  champNames: Record<string, string>;
}) {
  const currentRanked = !!tier;
  const peakRanked = !!peakTier;
  const peakText = peakRanked
    ? `Peak: ${prettyRank(peakTier, peakDiv)}${peakLp != null ? ` ${formatNumber(peakLp)} LP` : ""}`
    : "Peak: no peak saved yet";

  return (
    <div title={peakText}>
      <div className="rounded-xl bg-zinc-950/24 px-3 py-2.5">
        <div className="flex items-start gap-3">
        <div className="rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-white/5">
            <RankEmblem
              tier={tier}
              className="h-9 w-9 shrink-0"
              alt={tier ? `${tier} emblem` : "Unranked emblem"}
            />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-zinc-100">{prettyRank(tier, div)}</div>
            {currentRanked && lp != null ? (
              <Pill className="border-zinc-700 bg-zinc-900/80 text-zinc-200">
                {formatNumber(lp)} LP
              </Pill>
            ) : null}
          </div>

          <div className="mt-1 text-xs tabular-nums text-zinc-400">
            {wins != null && losses != null ? `${wins}-${losses}` : "--"} / {wr != null ? `${wr}%` : "--"}
          </div>

          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">
            {currentRanked ? labelRanked : labelUnranked}
          </div>
        </div>

        </div>
        <RecentQueueStrip summary={recent} champNames={champNames} />
      </div>
    </div>
  );
}

export default function LeaderboardTable({
  initialRows,
}: {
  initialRows: LeaderboardRow[];
}) {
  const [sort, setSort] = useState<SortState>({ col: "soloRank", dir: "desc" });
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [rankFilter, setRankFilter] = useState<RankFilter>("all");
  const [champNames, setChampNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;

    getChampNameMap()
      .then((map) => {
        if (active) setChampNames(map);
      })
      .catch((error) => {
        console.warn("Failed to load champion names:", error);
      });

    return () => {
      active = false;
    };
  }, []);

  const prepared = useMemo<PreparedRow[]>(
    () =>
      initialRows.map((row) => ({
        ...row,
        __soloKey: typeof row.key === "number" ? row.key : rankKey(row.tier, row.div, row.lp),
        __flexKey:
          typeof row.flexKey === "number" ? row.flexKey : rankKey(row.flexTier, row.flexDiv, row.flexLp),
        __soloWr: row.wr ?? winrate(row.wins, row.losses),
        __flexWr: row.flexWr ?? winrate(row.flexWins, row.flexLosses),
        __mainsTop3: topMains(row.mains),
      })),
    [initialRows]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return prepared.filter((row) => {
      if (normalizedQuery && !row.name.toLowerCase().includes(normalizedQuery)) {
        return false;
      }

      const soloRanked = !!row.tier;
      const flexRanked = !!row.flexTier;

      if (rankFilter === "anyRanked") return soloRanked || flexRanked;
      if (rankFilter === "soloRanked") return soloRanked;
      if (rankFilter === "flexRanked") return flexRanked;
      return true;
    });
  }, [prepared, query, rankFilter]);

  const sorted = useMemo(() => {
    const indexed = filtered.map((row, index) => ({ row, index }));

    indexed.sort((left, right) => {
      let comparison = 0;

      if (sort.col === "soloRank") {
        comparison = compareNumber(left.row.__soloKey, right.row.__soloKey);
      } else if (sort.col === "flexRank") {
        comparison = compareNumber(left.row.__flexKey, right.row.__flexKey);
      } else {
        comparison = compareString(left.row.name, right.row.name);
      }

      if (sort.dir === "desc") comparison = -comparison;
      return comparison || left.index - right.index;
    });

    return indexed.map((entry) => entry.row);
  }, [filtered, sort]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pages);
  const slice = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  function toggle(col: SortCol) {
    setPage(1);
    setSort((current) => {
      if (current.col !== col) return { col, dir: "desc" };
      return { col, dir: current.dir === "desc" ? "asc" : "desc" };
    });
  }

  const startShown = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endShown = Math.min(total, (safePage - 1) * pageSize + slice.length);
  const goPrevious = () => setPage((current) => Math.max(1, current - 1));
  const goNext = () => setPage((current) => Math.min(pages, current + 1));

  return (
    <div className="space-y-4">
      <LeaderboardSearchBar
        value={query}
        onChange={(nextQuery) => {
          setPage(1);
          setQuery(nextQuery);
        }}
        helper={
          <>
            Showing <span className="text-zinc-200">{startShown}</span>-<span className="text-zinc-200">{endShown}</span> of{" "}
            <span className="text-zinc-200">{total}</span>
          </>
        }
      >
        <select
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm sm:w-auto"
          value={rankFilter}
          onChange={(event) => {
            setPage(1);
            setRankFilter(event.target.value as RankFilter);
          }}
        >
          <option value="all">All</option>
          <option value="anyRanked">Any ranked</option>
          <option value="soloRanked">Solo ranked</option>
          <option value="flexRanked">Flex ranked</option>
        </select>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-400">Rows</span>
          <select
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm"
            value={pageSize}
            onChange={(event) => {
              setPage(1);
              setPageSize(Number(event.target.value));
            }}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm disabled:opacity-40"
              onClick={goPrevious}
              disabled={safePage === 1}
            >
              Prev
            </button>

            <span className="text-sm text-zinc-400">
              Page <span className="text-zinc-200">{safePage}</span> / <span className="text-zinc-200">{pages}</span>
            </span>

            <button
              type="button"
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm disabled:opacity-40"
              onClick={goNext}
              disabled={safePage === pages}
            >
              Next
            </button>
          </div>
        </div>
      </LeaderboardSearchBar>

      <div className="space-y-3 xl:hidden">
        {slice.map((row, index) => {
          const absoluteIndex = (safePage - 1) * pageSize + index + 1;

          return (
            <article key={row.id} className="rounded-[24px] bg-zinc-900/22 p-4">
              <div className="flex items-start gap-3">
                <ProfileAvatar
                  iconId={row.profileIconId ?? null}
                  alt={`${row.name} profile icon`}
                  className="h-16 w-16 shrink-0"
                  level={row.summonerLevel ?? null}
                />

                <div className="min-w-0 flex-1">
                  <div className="text-xs tabular-nums text-zinc-500">#{absoluteIndex}</div>
                  <Link href={profileHref(row)} className="line-clamp-2 text-lg font-semibold hover:underline underline-offset-4">
                    {row.name}
                  </Link>
                  <div className="mt-1 text-xs text-zinc-500">
                    {row.platform ? <span>{row.platform}</span> : null}
                    {row.platform ? <span> / </span> : null}
                    Updated: <span className="text-zinc-400">{relTime(row.updatedAt ?? null)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <MainsStrip mains={row.__mainsTop3} champNames={champNames} />
              </div>

              <div className="mt-4 grid gap-3">
                <QueueCell
                  tier={row.tier}
                  div={row.div}
                  lp={row.lp}
                  wins={row.wins}
                  losses={row.losses}
                  wr={row.__soloWr}
                  peakTier={row.peakTier ?? null}
                  peakDiv={row.peakDiv ?? null}
                  peakLp={row.peakLp ?? null}
                  labelRanked="Ranked Solo"
                  labelUnranked="No solo rank"
                  recent={row.recentSolo ?? null}
                  champNames={champNames}
                />

                <QueueCell
                  tier={row.flexTier}
                  div={row.flexDiv}
                  lp={row.flexLp}
                  wins={row.flexWins}
                  losses={row.flexLosses}
                  wr={row.__flexWr}
                  peakTier={row.peakFlexTier ?? null}
                  peakDiv={row.peakFlexDiv ?? null}
                  peakLp={row.peakFlexLp ?? null}
                  labelRanked="Ranked Flex"
                  labelUnranked="No flex rank"
                  recent={row.recentFlex ?? null}
                  champNames={champNames}
                />
              </div>
            </article>
          );
        })}

        {!slice.length ? (
          <div className="rounded-[24px] bg-zinc-900/22 p-6 text-zinc-400">No players.</div>
        ) : null}
      </div>

      <div className="hidden overflow-x-auto rounded-[24px] bg-zinc-900/22 xl:block">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 border-b border-white/8 bg-zinc-950/85 backdrop-blur">
            <tr className="text-zinc-300">
              <th className="w-14 p-4 text-left">#</th>
              <HeaderCell col="player" className="min-w-[320px]" sort={sort} onToggle={toggle}>
                Player
              </HeaderCell>
              <th className="min-w-[280px] p-4 text-left">Mains</th>
              <HeaderCell col="soloRank" className="min-w-[320px]" sort={sort} onToggle={toggle}>
                Solo
              </HeaderCell>
              <HeaderCell col="flexRank" className="min-w-[320px]" sort={sort} onToggle={toggle}>
                Flex
              </HeaderCell>
            </tr>
          </thead>

          <tbody>
            {slice.map((row, index) => {
              const absoluteIndex = (safePage - 1) * pageSize + index + 1;

              return (
                <tr key={row.id} className="border-b border-white/6 align-top hover:bg-white/5">
                  <td className="p-4 tabular-nums text-zinc-500">{absoluteIndex}</td>

                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <ProfileAvatar
                        iconId={row.profileIconId ?? null}
                        alt={`${row.name} profile icon`}
                        className="h-14 w-14 shrink-0"
                        level={row.summonerLevel ?? null}
                      />

                      <div className="min-w-0">
                        <Link href={profileHref(row)} className="font-semibold hover:underline underline-offset-4">
                          {row.name}
                        </Link>
                        <div className="mt-1 text-xs text-zinc-500">
                          {row.platform ? <span>{row.platform}</span> : null}
                          {row.platform ? <span> / </span> : null}
                          Updated: <span className="text-zinc-400">{relTime(row.updatedAt ?? null)}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="p-4">
                    <MainsStrip mains={row.__mainsTop3} champNames={champNames} />
                  </td>

                  <td className="p-4">
                    <QueueCell
                      tier={row.tier}
                      div={row.div}
                      lp={row.lp}
                      wins={row.wins}
                      losses={row.losses}
                      wr={row.__soloWr}
                      peakTier={row.peakTier ?? null}
                      peakDiv={row.peakDiv ?? null}
                      peakLp={row.peakLp ?? null}
                      labelRanked="Ranked Solo"
                      labelUnranked="No solo rank"
                      recent={row.recentSolo ?? null}
                      champNames={champNames}
                    />
                  </td>

                  <td className="p-4">
                    <QueueCell
                      tier={row.flexTier}
                      div={row.flexDiv}
                      lp={row.flexLp}
                      wins={row.flexWins}
                      losses={row.flexLosses}
                      wr={row.__flexWr}
                      peakTier={row.peakFlexTier ?? null}
                      peakDiv={row.peakFlexDiv ?? null}
                      peakLp={row.peakFlexLp ?? null}
                      labelRanked="Ranked Flex"
                      labelUnranked="No flex rank"
                      recent={row.recentFlex ?? null}
                      champNames={champNames}
                    />
                  </td>
                </tr>
              );
            })}

            {!slice.length ? (
              <tr>
                <td className="p-8 text-zinc-400" colSpan={5}>
                  No players.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <LeaderboardPager
        start={startShown}
        end={endShown}
        total={total}
        page={safePage}
        pages={pages}
        onPrevious={goPrevious}
        onNext={goNext}
      />
    </div>
  );
}
