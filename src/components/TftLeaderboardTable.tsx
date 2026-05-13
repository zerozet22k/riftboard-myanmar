"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNumber, formatRelativeTime } from "@/lib/displayTime";
import { analyzeTftPlaystyle, type TftPlaystyleSummary } from "@/lib/tftPlaystyle";
import { LeaderboardPager, LeaderboardSearchBar } from "@/components/LeaderboardControls";
import ProfileAvatar from "@/components/ProfileAvatar";
import RankEmblem from "@/components/RankEmblem";

export type TftLeaderboardRow = {
  id: string;
  name: string;
  href: string;
  platform: string;
  profileIconId: number | null;
  summonerLevel: number | null;
  updatedAt: string | null;
  tier: string | null;
  div: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  wr: number | null;
  key: number;
  recentMatches: Array<{
    gameDatetime?: number | null;
    level?: number | null;
    goldLeft?: number | null;
    totalDamageToPlayers?: number | null;
    units?: Array<{
      characterId?: string | null;
      name?: string | null;
      rarity?: number | null;
      tier?: number | null;
      itemNames?: string[];
    }>;
  }>;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
type RankFilter = "all" | "ranked" | "unranked";

function prettyRank(tier?: string | null, div?: string | null) {
  if (!tier) return "UNRANKED";
  return `${String(tier).toUpperCase()}${div ? ` ${String(div).toUpperCase()}` : ""}`;
}

function relativeUpdated(iso: string | null, renderedAt: number) {
  if (!iso) return "--";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatRelativeTime(ms, renderedAt) ?? "--" : "--";
}

function badgeTone(tone: TftPlaystyleSummary["badges"][number]["tone"]) {
  if (tone === "sky") return "border-sky-300/25 bg-sky-300/10 text-sky-100";
  if (tone === "amber") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (tone === "rose") return "border-rose-300/25 bg-rose-300/10 text-rose-100";
  return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
}

function axisTone(index: number): TftPlaystyleSummary["badges"][number]["tone"] {
  if (index === 0) return "sky";
  if (index === 1) return "amber";
  if (index === 2) return "rose";
  return "emerald";
}

function playstyleSidePercent(axis: TftPlaystyleSummary["axes"][number]) {
  if (axis.label === "Balanced") return 50;
  return Math.round(axis.value >= 50 ? axis.value : 100 - axis.value);
}

function playstyleDisplayLabel(axis: TftPlaystyleSummary["axes"][number]) {
  return axis.label === "Balanced" ? `${axis.left}/${axis.right}` : axis.label;
}

function PlaystylePills({ playstyle }: { playstyle: TftPlaystyleSummary | null }) {
  if (!playstyle) {
    return (
      <span className="inline-flex items-center rounded-md border border-zinc-700/70 bg-zinc-950/35 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
        Sync pending
      </span>
    );
  }

  return (
    <div className="grid max-w-[280px] grid-cols-2 gap-1.5">
      {playstyle.axes.map((axis, index) => (
        <span
          key={`${axis.left}-${axis.right}`}
          className={`inline-flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[11px] font-medium ${badgeTone(axisTone(index))}`}
          title={`${axis.left} / ${axis.right}`}
        >
          <span className="min-w-0 truncate">{playstyleDisplayLabel(axis)}</span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums">{playstyleSidePercent(axis)}%</span>
        </span>
      ))}
    </div>
  );
}

export default function TftLeaderboardTable({ rows, renderedAt }: { rows: TftLeaderboardRow[]; renderedAt: number }) {
  const [query, setQuery] = useState("");
  const [rankFilter, setRankFilter] = useState<RankFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rankFiltered = rows.filter((row) => {
      if (rankFilter === "ranked") return Boolean(row.tier);
      if (rankFilter === "unranked") return !row.tier;
      return true;
    });
    const source = normalized
      ? rankFiltered.filter(
          (row) =>
            row.name.toLowerCase().includes(normalized) ||
            row.platform.toLowerCase().includes(normalized) ||
            prettyRank(row.tier, row.div).toLowerCase().includes(normalized)
        )
      : rankFiltered;

    return source.map((row) => ({
      ...row,
      playstyle: row.recentMatches.length ? analyzeTftPlaystyle(row.recentMatches) : null,
    }));
  }, [rows, query, rankFilter]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const startIndex = (safePage - 1) * pageSize;
  const slice = filtered.slice(startIndex, startIndex + pageSize);
  const startShown = total === 0 ? 0 : startIndex + 1;
  const endShown = Math.min(total, startIndex + slice.length);
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
          <option value="ranked">Ranked</option>
          <option value="unranked">Unranked</option>
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
            {PAGE_SIZE_OPTIONS.map((size) => (
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
        {slice.map((row, index) => (
          <article key={row.id} className="rounded-[24px] bg-zinc-900/22 p-4 ring-1 ring-white/5">
            <div className="flex items-start gap-3">
              <ProfileAvatar iconId={row.profileIconId} alt={`${row.name} profile icon`} className="h-16 w-16 shrink-0" level={row.summonerLevel} />
              <div className="min-w-0 flex-1">
                <div className="text-xs tabular-nums text-zinc-500">#{startIndex + index + 1}</div>
                <Link href={row.href} className="line-clamp-2 text-lg font-semibold hover:underline underline-offset-4">
                  {row.name}
                </Link>
                <div className="mt-1 text-xs text-zinc-500">
                  {row.platform} / Updated <span className="text-zinc-300">{relativeUpdated(row.updatedAt, renderedAt)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-[22px] bg-zinc-950/40 p-3">
              <div className="rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-white/5">
                <RankEmblem tier={row.tier} className="h-10 w-10 shrink-0" alt={row.tier ? `${row.tier} emblem` : "Unranked emblem"} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-100">{prettyRank(row.tier, row.div)}</div>
                <div className="mt-1 text-xs text-zinc-400">{row.lp != null ? `${formatNumber(row.lp)} LP` : "--"}</div>
              </div>
              <div className="text-right text-xs tabular-nums text-zinc-400">
                <div>{row.wins != null && row.losses != null ? `${row.wins}-${row.losses}` : "--"}</div>
                <div>{row.wr != null ? `${row.wr}% WR` : "--"}</div>
              </div>
            </div>

            <div className="mt-3 rounded-[18px] bg-zinc-950/30 p-3">
              <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Playstyle</div>
              <PlaystylePills playstyle={row.playstyle} />
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-[24px] bg-zinc-900/22 ring-1 ring-white/5 xl:block">
        <table className="min-w-full text-sm">
          <thead className="border-b border-white/8 bg-zinc-950/85 text-zinc-300">
            <tr>
              <th className="w-14 p-4 text-left">#</th>
              <th className="min-w-[320px] p-4 text-left">Player</th>
              <th className="min-w-[260px] p-4 text-left">Rank</th>
              <th className="min-w-[160px] p-4 text-left">Record</th>
              <th className="min-w-[260px] p-4 text-left">Playstyle</th>
              <th className="min-w-[160px] p-4 text-left">Updated</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((row, index) => (
              <tr key={row.id} className="border-b border-white/6 align-top hover:bg-white/5">
                <td className="p-4 tabular-nums text-zinc-500">{startIndex + index + 1}</td>
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <ProfileAvatar iconId={row.profileIconId} alt={`${row.name} profile icon`} className="h-14 w-14 shrink-0" level={row.summonerLevel} />
                    <div className="min-w-0">
                      <Link href={row.href} className="font-semibold hover:underline underline-offset-4">
                        {row.name}
                      </Link>
                      <div className="mt-1 text-xs text-zinc-500">{row.platform}</div>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-white/5">
                      <RankEmblem tier={row.tier} className="h-9 w-9 shrink-0" alt={row.tier ? `${row.tier} emblem` : "Unranked emblem"} />
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-100">{prettyRank(row.tier, row.div)}</div>
                      <div className="mt-1 text-xs text-zinc-400">{row.lp != null ? `${formatNumber(row.lp)} LP` : "--"}</div>
                    </div>
                  </div>
                </td>
                <td className="p-4 text-zinc-300">
                  <div className="tabular-nums">{row.wins != null && row.losses != null ? `${row.wins}-${row.losses}` : "--"}</div>
                  <div className="mt-1 text-xs text-zinc-500">{row.wr != null ? `${row.wr}% WR` : "--"}</div>
                </td>
                <td className="p-4"><PlaystylePills playstyle={row.playstyle} /></td>
                <td className="p-4 text-zinc-400">{relativeUpdated(row.updatedAt, renderedAt)}</td>
              </tr>
            ))}
            {!slice.length ? (
              <tr>
                <td className="p-8 text-zinc-400" colSpan={6}>No players.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <LeaderboardPager start={startShown} end={endShown} total={total} page={safePage} pages={pages} onPrevious={goPrevious} onNext={goNext} />
    </div>
  );
}
