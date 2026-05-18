"use client";

import { useMemo, useState } from "react";
import { formatFullDateTime, formatNumber } from "@/lib/displayTime";

export type MasteryRow = {
  championId: number;
  championName: string;
  championLevel: number | null;
  championPoints: number | null;
  lastPlayTime: number | null;
  tokensEarned: number | null;
  championPointsSinceLastLevel: number | null;
  championPointsUntilNextLevel: number | null;
  markRequiredForNextLevel: number | null;
  championSeasonMilestone: number | null;
  fetchedAt: string | null;
};

const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

function numberOrDash(value: number | null | undefined) {
  return typeof value === "number" ? (formatNumber(value) ?? "--") : "--";
}

function lastPlayedText(lastPlayTime: number | null) {
  return formatFullDateTime(lastPlayTime) ?? "--";
}

function compactDate(lastPlayTime: number | null) {
  if (!lastPlayTime) return "--";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(lastPlayTime));
}

function progressPercent(row: MasteryRow) {
  const since = row.championPointsSinceLastLevel;
  const until = row.championPointsUntilNextLevel;
  if (typeof since !== "number" || typeof until !== "number") return null;
  const total = since + Math.max(0, until);
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((since / total) * 100)));
}

function masteryTone(level: number | null) {
  if ((level ?? 0) >= 20) return "from-fuchsia-500/18 via-amber-400/10 to-cyan-400/12 ring-fuchsia-300/20";
  if ((level ?? 0) >= 10) return "from-amber-400/16 via-zinc-950/20 to-emerald-400/10 ring-amber-300/18";
  if ((level ?? 0) >= 5) return "from-sky-400/14 via-zinc-950/20 to-violet-400/10 ring-sky-300/14";
  return "from-zinc-800/42 via-zinc-950/20 to-zinc-900/28 ring-white/8";
}

export default function MasteryTable({
  rows,
  lastSyncedLabel,
  stale,
}: {
  rows: MasteryRow[];
  lastSyncedLabel: string | null;
  stale: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("points");

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const base = rows.filter((row) => {
      if (!normalizedQuery) return true;
      return (
        row.championName.toLowerCase().includes(normalizedQuery) ||
        String(row.championId).includes(normalizedQuery)
      );
    });

    return [...base].sort((left, right) => {
      if (sort === "name") {
        return left.championName.localeCompare(right.championName);
      }
      if (sort === "level") {
        return (right.championLevel ?? -1) - (left.championLevel ?? -1) ||
          (right.championPoints ?? -1) - (left.championPoints ?? -1);
      }
      if (sort === "lastPlayed") {
        return (right.lastPlayTime ?? -1) - (left.lastPlayTime ?? -1);
      }
      return (right.championPoints ?? -1) - (left.championPoints ?? -1);
    });
  }, [query, rows, sort]);

  return (
    <section className="rounded-[24px] bg-zinc-900/22 p-4 sm:p-5">
      <div className="flex flex-col gap-3 border-b border-zinc-800/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-zinc-100">Champion mastery</div>
          <div className="mt-1 text-sm text-zinc-400">
            Collection view for levels, points, marks, and recent champion activity.
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Last mastery sync: <span className="text-zinc-300">{lastSyncedLabel ?? "--"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search champion"
            className="rounded-2xl border border-zinc-800 bg-zinc-950/50 px-4 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="rounded-2xl border border-zinc-800 bg-zinc-950/50 px-4 py-2 text-sm text-zinc-100 outline-none"
          >
            <option value="points">Sort by points</option>
            <option value="level">Sort by level</option>
            <option value="lastPlayed">Sort by last played</option>
            <option value="name">Sort by champion</option>
          </select>
        </div>
      </div>

      {stale ? (
        <div className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          This mastery list may be stale. Refresh the player profile to pull the latest Riot data.
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="mt-4 text-sm text-zinc-500">No stored mastery rows match this search yet.</div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => {
            const progress = progressPercent(row);
            const marksNeeded = row.markRequiredForNextLevel;
            const milestone = row.championSeasonMilestone;
            const untilNext =
              typeof row.championPointsUntilNextLevel === "number"
                ? Math.max(0, row.championPointsUntilNextLevel)
                : null;
            return (
            <article
              key={row.championId}
              className={`overflow-hidden rounded-[18px] bg-gradient-to-br ${masteryTone(row.championLevel)} p-3.5 ring-1`}
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <img
                    src={`${CHAMP_ICON_BASE}/${row.championId}.png`}
                    alt={row.championName}
                    className="h-14 w-14 rounded-2xl bg-zinc-900/40 ring-1 ring-white/10"
                    loading="lazy"
                  />
                  <div className="absolute -bottom-1 -right-1 rounded-lg bg-zinc-950 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-100 ring-1 ring-white/10">
                    M{numberOrDash(row.championLevel)}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-100">{row.championName}</div>
                      <div className="mt-1 text-sm tabular-nums text-zinc-300">
                        {numberOrDash(row.championPoints)} pts
                      </div>
                    </div>
                    <div
                      className="shrink-0 rounded-lg bg-zinc-950/50 px-2 py-1 text-right text-[11px] text-zinc-400"
                      title={lastPlayedText(row.lastPlayTime)}
                    >
                      {compactDate(row.lastPlayTime)}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Level progress</span>
                      <span>{progress == null ? "--" : `${progress}%`}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-950/70">
                      <div
                        className="h-full rounded-full bg-zinc-100"
                        style={{ width: `${progress ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-zinc-950/38 px-2 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Marks</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-200">
                        {numberOrDash(marksNeeded)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-zinc-950/38 px-2 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Tokens</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-200">
                        {numberOrDash(row.tokensEarned)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-zinc-950/38 px-2 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Season</div>
                      <div className="mt-0.5 text-sm font-semibold text-zinc-200">
                        {numberOrDash(milestone)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{numberOrDash(row.championPointsSinceLastLevel)} earned</span>
                    <span>{numberOrDash(untilNext)} to next</span>
                  </div>
                </div>
              </div>
            </article>
          );
          })}
        </div>
      )}
    </section>
  );
}
