"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCompactDateTime, formatNumber, formatRelativeTime } from "@/lib/displayTime";

export type TftMatchRow = {
  _id: string;
  matchId: string;
  queueId: number | null;
  gameDatetime: number | null;
  gameLength: number | null;
  setNumber: number | null;
  placement: number | null;
  level: number | null;
  lastRound: number | null;
  playersEliminated: number | null;
  totalDamageToPlayers: number | null;
  goldLeft: number | null;
  augments: string[];
  traits: Array<{
    name?: string | null;
    numUnits?: number | null;
    style?: number | null;
    tierCurrent?: number | null;
    tierTotal?: number | null;
  }>;
  units: Array<{
    characterId?: string | null;
    name?: string | null;
    rarity?: number | null;
    tier?: number | null;
    itemNames?: string[];
  }>;
};

const QUEUE_NAMES: Record<number, string> = {
  1090: "Normal",
  1100: "Ranked",
  1110: "Tutorial",
  1130: "Hyper Roll",
  1160: "Double Up",
};

function queueName(queueId: number | null) {
  if (queueId == null) return "Unknown";
  return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

function placementTone(placement: number | null) {
  if (placement != null && placement <= 4) return "text-blue-300 bg-blue-500/[0.04]";
  if (placement != null) return "text-red-300 bg-red-500/[0.04]";
  return "text-zinc-300 bg-zinc-900/20";
}

function formatSeconds(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function labelFromId(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "--";
  return raw
    .replace(/^TFT\d+_/i, "")
    .replace(/^Set\d+_/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function matchesUrl(gameName: string, tagLine: string, limit: number, cursor?: string | null) {
  const gn = String(gameName ?? "").trim();
  const tl = String(tagLine ?? "").trim().toLowerCase();
  const base = `/api/tft/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}/matches`;
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("autosync", "1");
  if (cursor) qs.set("cursor", cursor);
  return `${base}?${qs.toString()}`;
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-zinc-950/28 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-medium tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}

export default function TftMatchHistory({
  gameName,
  tagLine,
  initialMatches,
  initialCursor,
  renderedAtMs,
}: {
  gameName: string;
  tagLine: string;
  initialMatches: TftMatchRow[];
  initialCursor: string | null;
  renderedAtMs: number;
}) {
  const [items, setItems] = useState<TftMatchRow[]>(initialMatches);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialMatches);
    setCursor(initialCursor);
    setErr(null);
    setLoading(false);
  }, [initialMatches, initialCursor, gameName, tagLine]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setErr(null);

    try {
      const response = await fetch(matchesUrl(gameName, tagLine, 10, cursor), { cache: "no-store" });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        matches?: TftMatchRow[];
        nextCursor?: string | null;
      };

      if (!response.ok || !json?.ok) throw new Error(json?.error ?? `Failed (${response.status})`);
      setItems((previous) => [...previous, ...(Array.isArray(json.matches) ? json.matches : [])]);
      setCursor(json.nextCursor ?? null);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  const shownCount = useMemo(() => items.length, [items.length]);

  return (
    <div className="space-y-3">
      {items.length ? (
        items.map((match) => {
          const topTraits = [...match.traits]
            .filter((trait) => (trait.tierCurrent ?? 0) > 0 || (trait.style ?? 0) > 0)
            .sort((left, right) => (right.style ?? 0) - (left.style ?? 0) || (right.numUnits ?? 0) - (left.numUnits ?? 0))
            .slice(0, 5);
          const topUnits = [...match.units]
            .sort((left, right) => (right.tier ?? 0) - (left.tier ?? 0) || (right.rarity ?? 0) - (left.rarity ?? 0))
            .slice(0, 8);

          return (
            <article
              key={match._id}
              className={`overflow-hidden rounded-[18px] p-3 ring-1 ring-white/5 ${placementTone(match.placement)}`}
            >
              <div className="grid gap-3 xl:grid-cols-[120px_minmax(0,1fr)_260px] xl:items-center">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {match.placement != null ? `#${match.placement}` : "--"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-300">{queueName(match.queueId)}</div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    {formatRelativeTime(match.gameDatetime ?? null, renderedAtMs) ?? "Unknown time"}
                  </div>
                </div>

                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {topTraits.length ? (
                      topTraits.map((trait, index) => (
                        <span
                          key={`${match._id}-trait-${trait.name ?? index}`}
                          className="rounded-full bg-zinc-950/30 px-2.5 py-1 text-xs text-zinc-200"
                        >
                          {labelFromId(trait.name)} {trait.numUnits ? `(${trait.numUnits})` : ""}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-zinc-500">No active traits captured.</span>
                    )}
                  </div>

                  <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                    {topUnits.length ? (
                      topUnits.map((unit, index) => (
                        <div key={`${match._id}-unit-${unit.characterId ?? index}`} className="rounded-xl bg-zinc-950/22 px-2.5 py-2">
                          <div className="truncate text-xs font-medium text-zinc-100">
                            {labelFromId(unit.characterId ?? unit.name)}
                          </div>
                          <div className="mt-1 text-[11px] tabular-nums text-zinc-500">
                            {unit.tier ? `${unit.tier} star` : "--"} / {unit.itemNames?.length ?? 0} items
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-zinc-500 sm:col-span-2 xl:col-span-4">No units captured.</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Level" value={match.level ?? "--"} />
                  <MiniStat label="Round" value={match.lastRound ?? "--"} />
                  <MiniStat label="Damage" value={formatNumber(match.totalDamageToPlayers) ?? "--"} />
                  <MiniStat label="Length" value={formatSeconds(match.gameLength)} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/6 pt-3 text-[11px] text-zinc-500">
                <span>{formatCompactDateTime(match.gameDatetime ?? null) ?? "--"}</span>
                <span>Set {match.setNumber ?? "--"}</span>
                <span>Gold left {match.goldLeft ?? "--"}</span>
                <span>Eliminated {match.playersEliminated ?? "--"}</span>
                {match.augments.slice(0, 3).map((augment) => (
                  <span key={`${match._id}-${augment}`} className="text-zinc-400">
                    {labelFromId(augment)}
                  </span>
                ))}
              </div>
            </article>
          );
        })
      ) : (
        <div className="rounded-[18px] bg-zinc-900/18 p-5 text-sm text-zinc-400 ring-1 ring-white/5">
          No TFT matches yet. Hit Refresh to sync recent TFT games.
        </div>
      )}

      {err ? <div className="text-sm text-red-300">{err}</div> : null}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-xs text-zinc-500">
          Showing <span className="text-zinc-300">{shownCount}</span> TFT matches
        </div>
        <button
          type="button"
          onClick={loadMore}
          disabled={!cursor || loading}
          className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {loading ? "Loading..." : cursor ? "Load more" : "No more"}
        </button>
      </div>
    </div>
  );
}
