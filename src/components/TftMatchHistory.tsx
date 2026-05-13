"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCompactDateTime, formatNumber, formatRelativeTime } from "@/lib/displayTime";
import { analyzeTftPlaystyle, type TftPlaystyleSummary } from "@/lib/tftPlaystyle";

type IconAsset = {
  id: string;
  displayName: string;
  iconUrl: string | null;
};

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
  augments: Array<string | IconAsset>;
  traits: Array<{
    name?: string | null;
    numUnits?: number | null;
    style?: number | null;
    tierCurrent?: number | null;
    tierTotal?: number | null;
    displayName?: string | null;
    iconUrl?: string | null;
  }>;
  units: Array<{
    characterId?: string | null;
    name?: string | null;
    rarity?: number | null;
    tier?: number | null;
    itemNames?: string[];
    displayName?: string | null;
    iconUrl?: string | null;
    itemIcons?: IconAsset[];
  }>;
  participants?: Array<{
    puuid?: string | null;
    riotIdGameName?: string | null;
    riotIdTagline?: string | null;
    placement?: number | null;
    level?: number | null;
    lastRound?: number | null;
    playersEliminated?: number | null;
    totalDamageToPlayers?: number | null;
    goldLeft?: number | null;
    augments: Array<string | IconAsset>;
    traits: TftMatchRow["traits"];
    units: TftMatchRow["units"];
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
  if (placement === 1) return "border-amber-300/70 bg-amber-300/[0.06] text-amber-200";
  if (placement != null && placement <= 4) return "border-sky-300/45 bg-sky-400/[0.04] text-sky-200";
  if (placement != null) return "border-zinc-700 bg-zinc-900/26 text-zinc-300";
  return "border-zinc-800 bg-zinc-900/20 text-zinc-400";
}

function rarityBorder(rarity: number | null | undefined) {
  const value = typeof rarity === "number" ? rarity : -1;
  if (value >= 6) return "border-yellow-300";
  if (value >= 4) return "border-fuchsia-400";
  if (value >= 3) return "border-violet-400";
  if (value >= 2) return "border-sky-400";
  if (value >= 1) return "border-emerald-400";
  return "border-zinc-600";
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

function assetLabel(asset: string | IconAsset) {
  return typeof asset === "string" ? labelFromId(asset) : asset.displayName || labelFromId(asset.id);
}

function assetIcon(asset: string | IconAsset) {
  return typeof asset === "string" ? null : asset.iconUrl;
}

function riotIdLabel(participant: NonNullable<TftMatchRow["participants"]>[number], index: number) {
  const gameName = String(participant.riotIdGameName ?? "").trim();
  const tagLine = String(participant.riotIdTagline ?? "").trim();
  if (gameName && tagLine) return `${gameName}#${tagLine}`;
  if (gameName) return gameName;
  return `Player ${index + 1}`;
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
    <div className="rounded-lg bg-zinc-950/32 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-medium tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}

function playstyleSidePercent(axis: TftPlaystyleSummary["axes"][number]) {
  if (axis.label === "Balanced") return 50;
  return Math.round(axis.value >= 50 ? axis.value : 100 - axis.value);
}

function retryableCommunityDragonUrl(src: string) {
  if (!/^https:\/\/raw\.communitydragon\.org\//i.test(src) || /[?&]rb_retry=/.test(src)) return null;
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}rb_retry=${Date.now()}`;
}

function IconImage({ src, alt, className }: { src: string | null | undefined; alt: string; className: string }) {
  const [retrySrc, setRetrySrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const baseSrc = src ?? null;
  const currentSrc = retrySrc && baseSrc && retrySrc.startsWith(baseSrc) ? retrySrc : baseSrc;

  if (!currentSrc || failedSrc === baseSrc) {
    return (
      <span className={`${className} inline-flex items-center justify-center bg-zinc-800 text-[10px] font-semibold text-zinc-400`}>
        {alt.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        const retryUrl = currentSrc === baseSrc ? retryableCommunityDragonUrl(currentSrc) : null;
        if (retryUrl && retryUrl !== retrySrc) {
          setRetrySrc(retryUrl);
          return;
        }
        setFailedSrc(baseSrc);
      }}
    />
  );
}

function UnitStars({ tier }: { tier: number | null | undefined }) {
  const count = typeof tier === "number" && tier > 0 ? Math.min(3, tier) : 0;
  if (!count) return <span className="text-[10px] text-zinc-600">--</span>;
  return (
    <span className="absolute -top-3 left-1/2 flex -translate-x-1/2 text-[12px] leading-none text-sky-200 drop-shadow">
      {"★".repeat(count)}
    </span>
  );
}

function computeSummary(matches: TftMatchRow[]) {
  const window = matches.slice(0, 20);
  const placements = window.map((match) => match.placement).filter((value): value is number => typeof value === "number");
  const counts = Array.from({ length: 8 }, (_, index) => placements.filter((place) => place === index + 1).length);
  const avgPlace = placements.length ? placements.reduce((sum, place) => sum + place, 0) / placements.length : null;
  const top4Rate = placements.length ? (placements.filter((place) => place <= 4).length / placements.length) * 100 : null;
  const winRate = placements.length ? (placements.filter((place) => place === 1).length / placements.length) * 100 : null;

  const playstyle = analyzeTftPlaystyle(window);

  return {
    window,
    placements,
    counts,
    avgPlace,
    top4Rate,
    winRate,
    playstyle,
  };
}

function SummaryPanel({ matches }: { matches: TftMatchRow[] }) {
  const summary = useMemo(() => computeSummary(matches), [matches]);
  const carryUnits = useMemo(() => {
    const seen = new Set<string>();
    return summary.window
      .flatMap((match) => match.units ?? [])
      .filter((unit) => unit?.iconUrl || unit?.displayName || unit?.characterId)
      .sort((left, right) => (right.tier ?? 0) - (left.tier ?? 0) || (right.itemNames?.length ?? 0) - (left.itemNames?.length ?? 0))
      .filter((unit) => {
        const key = String(unit.characterId ?? unit.displayName ?? unit.name ?? "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [summary.window]);

  if (!matches.length) return null;

  return (
    <section className="rounded-lg bg-zinc-900/28 px-3 py-2.5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-[120px]">
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Last 20</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-zinc-50">
            {summary.top4Rate != null ? `${Math.round(summary.top4Rate)}% WR` : "--"}
          </div>
          <div className="mt-1 text-xs tabular-nums text-zinc-500">
            Avg {summary.avgPlace != null ? summary.avgPlace.toFixed(2) : "--"} / 1st {summary.winRate != null ? `${Math.round(summary.winRate)}%` : "--"}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {summary.window.slice(0, 20).map((match, index) => (
            <span
              key={`${match._id}-placement-chip-${index}`}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${placementTone(match.placement)}`}
              title={formatCompactDateTime(match.gameDatetime ?? null) ?? undefined}
            >
              {match.placement ?? "-"}
            </span>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1">
            {carryUnits.map((unit, index) => (
              <span
                key={`${unit.characterId ?? unit.displayName ?? "unit"}-${index}`}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950/50"
                title={unit.displayName ?? unit.name ?? unit.characterId ?? "Unit"}
              >
                <IconImage src={unit.iconUrl} alt={unit.displayName ?? "Unit"} className="h-8 w-8 rounded-lg object-cover" />
                {unit.tier ? (
                  <span className="absolute -bottom-1 -right-1 rounded bg-zinc-950/95 px-1 text-[8px] leading-3 text-zinc-300">
                    {unit.tier}
                  </span>
                ) : null}
              </span>
            ))}
          </div>

          <div className="hidden items-center gap-1 sm:flex">
            {summary.playstyle.axes.slice(0, 2).map((axis) => (
              <span
                key={`${axis.left}-${axis.right}`}
                className="rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[11px] font-medium tabular-nums text-amber-100"
                title={`${axis.left} / ${axis.right}`}
              >
                {axis.icon} {playstyleSidePercent(axis)}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MatchDetails({ match }: { match: TftMatchRow }) {
  const participants = Array.isArray(match.participants) && match.participants.length ? match.participants : null;

  if (participants) {
    return (
      <div className="border-t border-white/6 bg-zinc-950/22 px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-zinc-100">Match detail</div>
          <div className="text-xs text-zinc-500">{match.matchId || "--"}</div>
        </div>
        <div className="space-y-2">
          {participants.map((participant, participantIndex) => {
            const playerLabel = riotIdLabel(participant, participantIndex);
            const topTraits = [...participant.traits]
              .filter((trait) => (trait.tierCurrent ?? 0) > 0 || (trait.style ?? 0) > 0)
              .sort((left, right) => (right.style ?? 0) - (left.style ?? 0) || (right.numUnits ?? 0) - (left.numUnits ?? 0))
              .slice(0, 8);
            const units = [...participant.units]
              .sort(
                (left, right) =>
                  (right.tier ?? 0) - (left.tier ?? 0) ||
                  (right.itemNames?.length ?? 0) - (left.itemNames?.length ?? 0) ||
                  (right.rarity ?? 0) - (left.rarity ?? 0)
              )
              .slice(0, 10);

            return (
              <div
                key={`${match._id}-participant-${participant.puuid ?? "unknown"}-${participantIndex}`}
                className="grid gap-3 rounded-lg bg-zinc-900/42 p-3 ring-1 ring-white/5 lg:grid-cols-[56px_190px_minmax(0,1fr)] lg:items-center"
              >
                <div className={`text-2xl font-semibold tabular-nums ${participant.placement === 1 ? "text-amber-200" : participant.placement != null && participant.placement <= 4 ? "text-sky-200" : "text-zinc-400"}`}>
                  {participant.placement ?? "--"}
                </div>

                <div>
                  <div className="truncate text-sm font-semibold text-zinc-100" title={playerLabel}>
                    {playerLabel}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs tabular-nums">
                    <div>
                      <div className="text-zinc-500">Damage</div>
                      <div className="font-semibold text-rose-200">{formatNumber(participant.totalDamageToPlayers) ?? "--"}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Gold</div>
                      <div className="font-semibold text-amber-200">{participant.goldLeft ?? "--"}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Level</div>
                      <div className="font-semibold text-zinc-200">{participant.level ?? "--"}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Round</div>
                      <div className="font-semibold text-zinc-200">{participant.lastRound ?? "--"}</div>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {topTraits.map((trait, index) => {
                      const label = trait.displayName ?? labelFromId(trait.name);
                      return (
                        <span
                          key={`${match._id}-participant-${participantIndex}-trait-${trait.name ?? label}-${index}`}
                          className="inline-flex max-w-[140px] items-center gap-1.5 rounded-md border border-white/8 bg-zinc-950/34 px-2 py-1 text-[11px] text-zinc-200"
                          title={label}
                        >
                          <IconImage src={trait.iconUrl} alt={label} className="h-4 w-4 shrink-0 rounded-sm object-cover" />
                          <span className="truncate">{label}</span>
                          {trait.numUnits ? <span className="text-amber-200">{trait.numUnits}</span> : null}
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {units.map((unit, index) => {
                      const label = unit.displayName ?? labelFromId(unit.characterId ?? unit.name);
                      const unitKey = `${match._id}-participant-${participantIndex}-unit-${unit.characterId ?? unit.name ?? "unknown"}-${unit.tier ?? "x"}-${index}`;
                      return (
                        <div key={unitKey} className="w-[54px]">
                          <div className={`relative h-12 w-12 rounded-md border-2 ${rarityBorder(unit.rarity)} bg-zinc-950 shadow-sm`}>
                            <UnitStars tier={unit.tier} />
                            <IconImage src={unit.iconUrl} alt={label} className="h-full w-full rounded-[4px] object-cover" />
                          </div>
                          <div className="mt-1 flex h-4 gap-0.5">
                            {(unit.itemIcons?.length
                              ? unit.itemIcons
                              : (unit.itemNames ?? []).map((item) => ({ id: item, displayName: labelFromId(item), iconUrl: null })))
                              .slice(0, 3)
                              .map((item, itemIndex) => (
                                <IconImage
                                  key={`${unitKey}-item-${item.id}-${itemIndex}`}
                                  src={item.iconUrl}
                                  alt={item.displayName}
                                  className="h-4 w-4 rounded-sm object-cover ring-1 ring-black/40"
                                />
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {participant.augments.length ? (
                      participant.augments.map((augment, index) => {
                        const label = assetLabel(augment);
                        return (
                          <span
                            key={`${match._id}-participant-${participantIndex}-augment-${typeof augment === "string" ? augment : augment.id}-${index}`}
                            className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-amber-400/15 bg-amber-400/8 px-2 py-1 text-[11px] text-amber-100"
                            title={label}
                          >
                            <IconImage src={assetIcon(augment)} alt={label} className="h-4 w-4 shrink-0 rounded object-cover" />
                            <span className="truncate">{label}</span>
                          </span>
                        );
                      })
                    ) : (
                      <span className="rounded-md border border-zinc-800 bg-zinc-950/34 px-2 py-1 text-[11px] text-zinc-500">
                        Augments unavailable in Riot match data
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-white/6 bg-zinc-950/22 px-3 py-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Full board</div>
            <div className="mt-3 flex flex-wrap gap-3">
              {match.units.length ? (
                match.units.map((unit, index) => {
                  const label = unit.displayName ?? labelFromId(unit.characterId ?? unit.name);
                  const unitKey = `${match._id}-detail-unit-${unit.characterId ?? unit.name ?? "unknown"}-${unit.tier ?? "x"}-${unit.itemNames?.join(".") ?? ""}-${index}`;
                  return (
                    <div key={unitKey} className="w-[76px]">
                      <div className={`relative h-14 w-14 rounded-md border-2 ${rarityBorder(unit.rarity)} bg-zinc-950 shadow-sm`}>
                        <UnitStars tier={unit.tier} />
                        <IconImage src={unit.iconUrl} alt={label} className="h-full w-full rounded-[4px] object-cover" />
                      </div>
                      <div className="mt-1 truncate text-[11px] text-zinc-300" title={label}>
                        {label}
                      </div>
                      <div className="mt-1 flex h-4 gap-0.5">
                        {(unit.itemIcons?.length
                          ? unit.itemIcons
                          : (unit.itemNames ?? []).map((item) => ({ id: item, displayName: labelFromId(item), iconUrl: null })))
                          .slice(0, 3)
                          .map((item, itemIndex) => (
                            <IconImage
                              key={`${unitKey}-item-${item.id}-${itemIndex}`}
                              src={item.iconUrl}
                              alt={item.displayName}
                              className="h-4 w-4 rounded-sm object-cover ring-1 ring-black/40"
                            />
                          ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-zinc-500">No units captured.</div>
              )}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Traits</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {match.traits.length ? (
                match.traits.map((trait, index) => {
                  const label = trait.displayName ?? labelFromId(trait.name);
                  return (
                    <span
                      key={`${match._id}-detail-trait-${trait.name ?? label}-${index}`}
                      className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-white/8 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-200"
                      title={label}
                    >
                      <IconImage src={trait.iconUrl} alt={label} className="h-4 w-4 shrink-0 rounded-sm object-cover" />
                      <span className="truncate">{label}</span>
                      {trait.numUnits ? <span className="text-amber-200">{trait.numUnits}</span> : null}
                    </span>
                  );
                })
              ) : (
                <span className="text-xs text-zinc-500">No traits captured.</span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Augments</div>
            <div className="mt-2 space-y-2">
              {match.augments.length ? (
                match.augments.map((augment, index) => {
                  const label = assetLabel(augment);
                  return (
                    <div
                      key={`${match._id}-detail-augment-${typeof augment === "string" ? augment : augment.id}-${index}`}
                      className="flex items-center gap-2 rounded-md border border-amber-400/15 bg-amber-400/8 px-2 py-1.5 text-xs text-amber-100"
                      title={label}
                    >
                      <IconImage src={assetIcon(augment)} alt={label} className="h-6 w-6 shrink-0 rounded object-cover" />
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-zinc-500">No augments captured.</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Placement" value={match.placement ?? "--"} />
            <MiniStat label="Queue" value={queueName(match.queueId)} />
            <MiniStat label="Length" value={formatSeconds(match.gameLength)} />
            <MiniStat label="Date" value={formatCompactDateTime(match.gameDatetime ?? null) ?? "--"} />
            <MiniStat label="Damage" value={formatNumber(match.totalDamageToPlayers) ?? "--"} />
            <MiniStat label="Gold" value={match.goldLeft ?? "--"} />
            <MiniStat label="Level" value={match.level ?? "--"} />
            <MiniStat label="Round" value={match.lastRound ?? "--"} />
          </div>

          <div className="truncate rounded-lg bg-zinc-950/32 px-3 py-2 text-[11px] text-zinc-500" title={match.matchId}>
            Match ID <span className="text-zinc-300">{match.matchId || "--"}</span>
          </div>
        </div>
      </div>
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
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [autoSyncTried, setAutoSyncTried] = useState(false);

  useEffect(() => {
    setItems(initialMatches);
    setCursor(initialCursor);
    setErr(null);
    setLoading(false);
    setExpandedMatchId(null);
    setAutoSyncTried(false);
  }, [initialMatches, initialCursor, gameName, tagLine]);

  useEffect(() => {
    if (items.length || loading || autoSyncTried) return;

    let cancelled = false;
    setAutoSyncTried(true);
    setLoading(true);
    setErr(null);

    fetch(matchesUrl(gameName, tagLine, 20), { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          matches?: TftMatchRow[];
          nextCursor?: string | null;
        };
        if (!response.ok || !json?.ok) throw new Error(json?.error ?? `Failed (${response.status})`);
        if (cancelled) return;
        setItems(Array.isArray(json.matches) ? json.matches : []);
        setCursor(json.nextCursor ?? null);
      })
      .catch((error) => {
        if (!cancelled) setErr(error instanceof Error ? error.message : "TFT match sync failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [autoSyncTried, gameName, items.length, loading, tagLine]);

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
      <SummaryPanel matches={items.slice(0, 20)} />

      {items.length ? (
        items.map((match) => {
          const topTraits = [...match.traits]
            .filter((trait) => (trait.tierCurrent ?? 0) > 0 || (trait.style ?? 0) > 0)
            .sort((left, right) => (right.style ?? 0) - (left.style ?? 0) || (right.numUnits ?? 0) - (left.numUnits ?? 0))
            .slice(0, 8);
          const topUnits = [...match.units]
            .sort(
              (left, right) =>
                (right.tier ?? 0) - (left.tier ?? 0) ||
                (right.itemNames?.length ?? 0) - (left.itemNames?.length ?? 0) ||
                (right.rarity ?? 0) - (left.rarity ?? 0)
            )
            .slice(0, 10);
          const expanded = expandedMatchId === match._id;

          return (
            <article key={match._id} className="overflow-hidden rounded-lg bg-zinc-900/28 ring-1 ring-white/5">
              <div className="grid gap-3 border-l-4 border-zinc-700 p-3 sm:grid-cols-[90px_120px_minmax(0,1fr)_230px] sm:items-center">
                <div className="flex items-start gap-3 sm:block">
                  <div className={`text-3xl font-semibold tabular-nums ${match.placement === 1 ? "text-amber-200" : match.placement != null && match.placement <= 4 ? "text-sky-200" : "text-zinc-400"}`}>
                    {match.placement ?? "--"}
                  </div>
                  <div>
                    <div className="mt-1 text-sm font-medium text-zinc-100">{queueName(match.queueId)}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {formatRelativeTime(match.gameDatetime ?? null, renderedAtMs) ?? "Unknown time"}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">{formatSeconds(match.gameLength)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm tabular-nums">
                  <div>
                    <div className="text-[11px] text-zinc-500">Damage</div>
                    <div className="font-semibold text-rose-200">{formatNumber(match.totalDamageToPlayers) ?? "--"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500">Gold</div>
                    <div className="font-semibold text-amber-200">{match.goldLeft ?? "--"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500">Level</div>
                    <div className="font-semibold text-zinc-200">{match.level ?? "--"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500">Round</div>
                    <div className="font-semibold text-zinc-200">{match.lastRound ?? "--"}</div>
                  </div>
                </div>

                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {topTraits.length ? (
                      topTraits.map((trait, index) => {
                        const label = trait.displayName ?? labelFromId(trait.name);
                        return (
                          <span
                            key={`${match._id}-trait-${trait.name ?? label}-${index}`}
                            className="inline-flex max-w-[150px] items-center gap-1.5 rounded-md border border-white/8 bg-zinc-950/34 px-2 py-1 text-[11px] text-zinc-200"
                            title={label}
                          >
                            <IconImage src={trait.iconUrl} alt={label} className="h-4 w-4 shrink-0 rounded-sm object-cover" />
                            <span className="truncate">{label}</span>
                            {trait.numUnits ? <span className="text-amber-200">{trait.numUnits}</span> : null}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-xs text-zinc-500">No active traits captured.</span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {topUnits.length ? (
                      topUnits.map((unit, index) => {
                        const label = unit.displayName ?? labelFromId(unit.characterId ?? unit.name);
                        const unitKey = `${match._id}-unit-${unit.characterId ?? unit.name ?? "unknown"}-${unit.tier ?? "x"}-${unit.itemNames?.join(".") ?? ""}-${index}`;
                        return (
                          <div key={unitKey} className="w-[58px]">
                            <div className={`relative h-[52px] w-[52px] rounded-md border-2 ${rarityBorder(unit.rarity)} bg-zinc-950 shadow-sm`}>
                              <UnitStars tier={unit.tier} />
                              <IconImage src={unit.iconUrl} alt={label} className="h-full w-full rounded-[4px] object-cover" />
                            </div>
                            <div className="mt-1 flex h-4 gap-0.5">
                              {(unit.itemIcons?.length ? unit.itemIcons : (unit.itemNames ?? []).map((item) => ({ id: item, displayName: labelFromId(item), iconUrl: null })))
                                .slice(0, 3)
                                .map((item, itemIndex) => (
                                  <IconImage
                                    key={`${unitKey}-item-${item.id}-${itemIndex}`}
                                    src={item.iconUrl}
                                    alt={item.displayName}
                                    className="h-4 w-4 rounded-sm object-cover ring-1 ring-black/40"
                                  />
                                ))}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-zinc-500">No units captured.</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 xl:grid-cols-2">
                  <MiniStat label="Elims" value={match.playersEliminated ?? "--"} />
                  <MiniStat label="Set" value={match.setNumber ?? "--"} />
                  <MiniStat label="Date" value={formatCompactDateTime(match.gameDatetime ?? null) ?? "--"} />
                  <MiniStat label="Match" value={match.matchId ? match.matchId.slice(-6) : "--"} />
                  <button
                    type="button"
                    onClick={() => setExpandedMatchId(expanded ? null : match._id)}
                    className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/5 sm:col-span-1 xl:col-span-2"
                    aria-expanded={expanded}
                  >
                    {expanded ? "Hide details" : "Match details"}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-white/6 px-3 py-2">
                {match.augments.slice(0, 3).map((augment, index) => {
                  const label = assetLabel(augment);
                  return (
                    <span
                      key={`${match._id}-augment-${typeof augment === "string" ? augment : augment.id}-${index}`}
                      className="inline-flex max-w-[220px] items-center gap-2 rounded-md border border-amber-400/20 bg-amber-400/8 px-2 py-1 text-[11px] text-amber-100"
                      title={label}
                    >
                      <IconImage src={assetIcon(augment)} alt={label} className="h-5 w-5 shrink-0 rounded object-cover" />
                      <span className="truncate">{label}</span>
                    </span>
                  );
                })}
              </div>
              {expanded ? <MatchDetails match={match} /> : null}
            </article>
          );
        })
      ) : (
        <div className="rounded-lg bg-zinc-900/18 p-5 text-sm text-zinc-400 ring-1 ring-white/5">
          {loading ? "Syncing recent TFT games..." : "No TFT matches yet. Hit Refresh to sync recent TFT games."}
          {err ? <div className="mt-2 text-xs text-red-300">{err}</div> : null}
        </div>
      )}

      {err && items.length ? <div className="text-sm text-red-300">{err}</div> : null}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-xs text-zinc-500">
          Showing <span className="text-zinc-300">{shownCount}</span> TFT matches
        </div>
        <button
          type="button"
          onClick={loadMore}
          disabled={!cursor || loading}
          className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {loading ? "Loading..." : cursor ? "Load more" : "No more"}
        </button>
      </div>
    </div>
  );
}
