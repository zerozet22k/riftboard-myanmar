"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import ProfileAvatar from "@/components/ProfileAvatar";
import RankEmblem from "@/components/RankEmblem";

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
  if (Math.abs(numeric) < 1000) return numeric.toLocaleString();

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

function relTime(iso?: string | null) {
  const timestamp = parseUpdatedTs(iso);
  if (!timestamp) return "--";

  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
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
        const fullPoints = main.points != null ? Number(main.points).toLocaleString() : null;

        return (
          <span
            key={`${main.championId ?? "unknown"}-${index}`}
            title={fullPoints ? `${championName}: ${fullPoints} pts` : championName}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-950/50 px-3 py-1.5 text-xs text-zinc-200 ring-1 ring-white/5"
          >
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt={championName} className="h-5 w-5 rounded-full" loading="lazy" />
            ) : null}
            <span className="max-w-[140px] truncate">{championName}</span>
            {shortPoints ? <span className="tabular-nums text-zinc-400">{shortPoints}</span> : null}
          </span>
        );
      })}
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
}) {
  const currentRanked = !!tier;
  const peakRanked = !!peakTier;

  return (
    <div className="grid gap-2">
      <div className="rounded-2xl bg-zinc-950/35 p-3 ring-1 ring-white/5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-zinc-950/70 p-2 ring-1 ring-white/5">
            <RankEmblem
              tier={tier}
              className="h-11 w-11 shrink-0"
              alt={tier ? `${tier} emblem` : "Unranked emblem"}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-zinc-100">{prettyRank(tier, div)}</div>
              {currentRanked && lp != null ? (
                <Pill className="border-zinc-700 bg-zinc-900/80 text-zinc-200">
                  {Number(lp).toLocaleString()} LP
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
      </div>

      <div className="rounded-2xl bg-zinc-950/25 p-3 ring-1 ring-white/5">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-zinc-950/70 p-2 ring-1 ring-white/5">
            <RankEmblem
              tier={peakTier}
              className="h-8 w-8 shrink-0"
              alt={peakTier ? `${peakTier} peak emblem` : "Peak emblem"}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Peak</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={"text-sm font-medium " + (peakRanked ? "text-zinc-100" : "text-zinc-500")}>
                {peakRanked ? prettyRank(peakTier, peakDiv) : "No peak saved"}
              </span>
            {peakRanked && peakLp != null ? (
              <Pill className="border-zinc-700 bg-zinc-900/80 text-zinc-300">
                {Number(peakLp).toLocaleString()} LP
              </Pill>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LeaderboardTable({ initialRows }: { initialRows: LeaderboardRow[] }) {
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-2">
          <div className="text-sm text-zinc-400">
            Showing <span className="text-zinc-200">{startShown}</span>-<span className="text-zinc-200">{endShown}</span> of{" "}
            <span className="text-zinc-200">{total}</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={query}
              onChange={(event) => {
                setPage(1);
                setQuery(event.target.value);
              }}
              placeholder="Search name#tag..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600 sm:w-72"
            />

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
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
              onClick={() => setPage((current) => Math.max(1, current - 1))}
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
              onClick={() => setPage((current) => Math.min(pages, current + 1))}
              disabled={safePage === pages}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 xl:hidden">
        {slice.map((row, index) => {
          const absoluteIndex = (safePage - 1) * pageSize + index + 1;

          return (
            <article key={row.id} className="rounded-3xl bg-zinc-900/30 p-4 ring-1 ring-white/5">
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
                />
              </div>
            </article>
          );
        })}

        {!slice.length ? (
          <div className="rounded-3xl bg-zinc-900/30 p-6 text-zinc-400 ring-1 ring-white/5">No players.</div>
        ) : null}
      </div>

      <div className="hidden overflow-x-auto rounded-3xl bg-zinc-900/30 ring-1 ring-white/5 xl:block">
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
    </div>
  );
}
