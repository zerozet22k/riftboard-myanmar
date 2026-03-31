"use client";

import { useMemo, useState } from "react";

export type MasteryRow = {
  championId: number;
  championName: string;
  championLevel: number | null;
  championPoints: number | null;
  lastPlayTime: number | null;
  chestGranted: boolean | null;
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
  return typeof value === "number" ? value.toLocaleString() : "--";
}

function lastPlayedText(lastPlayTime: number | null) {
  if (!lastPlayTime) return "--";
  const date = new Date(lastPlayTime);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
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
    <section className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-zinc-800/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-zinc-100">Champion mastery</div>
          <div className="mt-1 text-sm text-zinc-400">
            Stored Riot mastery entries for this tracked player.
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
        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          This mastery list may be stale. Refresh the player profile to pull the latest Riot data.
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="mt-4 text-sm text-zinc-500">No stored mastery rows match this search yet.</div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map((row) => (
            <article
              key={row.championId}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <img
                    src={`${CHAMP_ICON_BASE}/${row.championId}.png`}
                    alt={row.championName}
                    className="h-14 w-14 rounded-2xl border border-zinc-800 bg-zinc-900/40"
                    loading="lazy"
                  />
                  <div>
                    <div className="text-base font-semibold text-zinc-100">{row.championName}</div>
                    <div className="mt-1 text-sm text-zinc-400">
                      Mastery {numberOrDash(row.championLevel)} / {numberOrDash(row.championPoints)} pts
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Last played: <span className="text-zinc-300">{lastPlayedText(row.lastPlayTime)}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Chest</div>
                    <div>{row.chestGranted ? "Granted" : "Not granted"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Tokens</div>
                    <div>{numberOrDash(row.tokensEarned)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Since last level</div>
                    <div>{numberOrDash(row.championPointsSinceLastLevel)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Until next level</div>
                    <div>{numberOrDash(row.championPointsUntilNextLevel)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Marks needed</div>
                    <div>{numberOrDash(row.markRequiredForNextLevel)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Season milestone</div>
                    <div>{numberOrDash(row.championSeasonMilestone)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Champion ID</div>
                    <div>{row.championId}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Stored at</div>
                    <div>{row.fetchedAt ? new Date(row.fetchedAt).toLocaleString() : "--"}</div>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
