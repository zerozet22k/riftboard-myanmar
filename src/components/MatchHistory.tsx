"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import MatchDetailsPanel, { type MatchDetailsResponse } from "@/components/MatchDetailsPanel";

export type MatchRow = {
  _id: string;
  matchId: string;
  queueId: number | null;
  gameCreation: number | null;
  gameDuration: number | null;
  championId: number | null;
  teamId?: number | null;
  teamPosition?: string | null;
  primaryStyle?: number | null;
  primaryRune?: number | null;
  subStyle?: number | null;
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  cs: number | null;
  gold: number | null;
  items: number[];
  summonerSpells: number[];
};

type ItemInfo = { name: string; plaintext?: string; gold?: number };
type SpellInfo = { name: string; iconFull: string };
type RuneInfo = { name: string; icon: string };

type DDragonItemResponse = {
  data?: Record<string, { name?: string; plaintext?: string; gold?: { total?: number } }>;
};

type DDragonSpellResponse = {
  data?: Record<string, { key?: string; name?: string; image?: { full?: string } }>;
};

type ChampionSummaryEntry = { id?: number; name?: string };

type RuneReforgedStyle = {
  id?: number;
  name?: string;
  icon?: string;
  slots?: Array<{ runes?: Array<{ id?: number; name?: string; icon?: string }> }>;
};

const QUEUE_NAMES: Record<number, string> = {
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  700: "Clash",
  400: "Normal Draft",
  430: "Normal Blind",
  490: "Quickplay",
  450: "ARAM",
  900: "ARURF",
  1010: "URF",
  1020: "One for All",
  1300: "Nexus Blitz",
  1400: "Ultimate Spellbook",
  830: "Co-op vs AI (Intro)",
  840: "Co-op vs AI (Beginner)",
  850: "Co-op vs AI (Intermediate)",
  1700: "Arena",
  1710: "Arena",
  1720: "Arena",
  1090: "TFT (Normal)",
  1100: "TFT (Ranked)",
  1110: "TFT (Tutorial)",
  1130: "TFT (Hyper Roll)",
  1160: "TFT (Double Up)",
};

const ARENA_QUEUES = new Set([1700, 1710, 1720]);
const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";
const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";

function queueName(queueId: number | null) {
  if (queueId == null) return "Unknown";
  return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

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

function matchDetailsUrl(gameName: string, tagLine: string, matchId: string) {
  const gn = String(gameName ?? "").trim();
  const tl = String(tagLine ?? "").trim().toLowerCase();
  return `/api/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}/matches/${encodeURIComponent(matchId)}`;
}

function fmtDuration(sec: number | null) {
  if (sec == null || !Number.isFinite(sec)) return "--";
  const totalSeconds = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function fmtAgo(epochMs: number | null) {
  if (!epochMs || !Number.isFinite(epochMs)) return null;
  const delta = Date.now() - epochMs;
  if (delta < 0) return null;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function sideLabel(teamId?: number | null) {
  if (teamId === 100) return "BLUE SIDE";
  if (teamId === 200) return "RED SIDE";
  return null;
}

function prettyPos(teamPosition?: string | null) {
  const position = String(teamPosition ?? "").toUpperCase().trim();
  if (!position || position === "NONE" || position === "INVALID") return null;
  if (position === "UTILITY") return "SUP";
  if (position === "MIDDLE") return "MID";
  if (position === "BOTTOM") return "BOT";
  return position;
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
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

function ItemIcon({ id, url, info }: { id: number; url: string; info: ItemInfo | null }) {
  const title = info?.name ? info.name : `Item ${id}`;
  return (
    <img
      src={url}
      alt={title}
      title={title}
      className="h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900/30"
      loading="lazy"
    />
  );
}

function RuneIcon({ rune, title }: { rune: RuneInfo | null; title: string }) {
  if (!rune?.icon) {
    return <div className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30" />;
  }
  return (
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`}
      alt={rune.name || title}
      title={rune.name || title}
      className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30"
      loading="lazy"
    />
  );
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-zinc-950/45 px-3 py-2 ring-1 ring-white/5">
      <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <span className="text-sm font-medium tabular-nums text-zinc-100">{value}</span>
    </div>
  );
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
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [detailsByMatchId, setDetailsByMatchId] = useState<Record<string, MatchDetailsResponse>>({});
  const [itemMap, setItemMap] = useState<Record<string, ItemInfo>>({});
  const [spellMap, setSpellMap] = useState<Record<string, SpellInfo>>({});
  const [champMap, setChampMap] = useState<Record<string, string>>({});
  const [runeMap, setRuneMap] = useState<Record<string, RuneInfo>>({});
  const [styleMap, setStyleMap] = useState<Record<string, RuneInfo>>({});

  useEffect(() => {
    setItems(initialMatches);
    setCursor(initialCursor);
    setErr(null);
    setLoading(false);
  }, [initialMatches, initialCursor, gameName, tagLine]);

  useEffect(() => {
    setOpenMatchId(null);
    setDetailLoadingId(null);
    setDetailErrors({});
    setDetailsByMatchId({});
  }, [gameName, tagLine]);

  useEffect(() => {
    let alive = true;

    fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/item.json`, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        const payload = json as DDragonItemResponse | null;
        if (!alive || !payload?.data) return;
        const nextMap: Record<string, ItemInfo> = {};
        for (const [id, value] of Object.entries(payload.data)) {
          nextMap[id] = {
            name: String(value?.name ?? `Item ${id}`),
            plaintext: typeof value?.plaintext === "string" ? value.plaintext : undefined,
            gold: typeof value?.gold?.total === "number" ? value.gold.total : undefined,
          };
        }
        setItemMap(nextMap);
      })
      .catch(() => {});

    fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/summoner.json`, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        const payload = json as DDragonSpellResponse | null;
        if (!alive || !payload?.data) return;
        const nextMap: Record<string, SpellInfo> = {};
        for (const value of Object.values(payload.data)) {
          const key = String(value?.key ?? "");
          const iconFull = String(value?.image?.full ?? "");
          if (!key || !iconFull) continue;
          nextMap[key] = { name: String(value?.name ?? `Spell ${key}`), iconFull };
        }
        setSpellMap(nextMap);
      })
      .catch(() => {});

    fetch(CHAMP_SUMMARY_URL, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        const payload = json as ChampionSummaryEntry[] | null;
        if (!alive || !Array.isArray(payload)) return;
        const nextMap: Record<string, string> = {};
        for (const champion of payload) {
          if (champion?.id == null || !champion?.name) continue;
          nextMap[String(champion.id)] = champion.name;
        }
        setChampMap(nextMap);
      })
      .catch(() => {});

    fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/runesReforged.json`, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        const payload = json as RuneReforgedStyle[] | null;
        if (!alive || !Array.isArray(payload)) return;
        const nextRuneMap: Record<string, RuneInfo> = {};
        const nextStyleMap: Record<string, RuneInfo> = {};
        for (const style of payload) {
          if (style?.id != null && style?.icon) {
            nextStyleMap[String(style.id)] = {
              name: String(style?.name ?? `Style ${style.id}`),
              icon: String(style.icon),
            };
          }
          for (const slot of style?.slots ?? []) {
            for (const rune of slot?.runes ?? []) {
              if (rune?.id == null || !rune?.icon) continue;
              nextRuneMap[String(rune.id)] = {
                name: String(rune?.name ?? `Rune ${rune.id}`),
                icon: String(rune.icon),
              };
            }
          }
        }
        setRuneMap(nextRuneMap);
        setStyleMap(nextStyleMap);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [ddragonVersion]);

  async function loadMore() {
    if (!cursor || loading) return;

    setLoading(true);
    setErr(null);

    try {
      const response = await fetch(matchesUrl(gameName, tagLine, 10, cursor), { cache: "no-store" });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        matches?: MatchRow[];
        nextCursor?: string | null;
      };

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? `Failed (${response.status})`);
      }

      setItems((previous) => [...previous, ...(Array.isArray(json.matches) ? json.matches : [])]);
      setCursor(json.nextCursor ?? null);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function toggleDetails(matchId: string) {
    if (openMatchId === matchId) {
      setOpenMatchId(null);
      return;
    }

    setOpenMatchId(matchId);
    if (detailsByMatchId[matchId] || detailLoadingId === matchId) return;

    setDetailLoadingId(matchId);
    setDetailErrors((previous) => {
      const next = { ...previous };
      delete next[matchId];
      return next;
    });

    try {
      const response = await fetch(matchDetailsUrl(gameName, tagLine, matchId), { cache: "no-store" });
      const json = (await response.json().catch(() => ({}))) as MatchDetailsResponse;

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error ?? `Failed (${response.status})`);
      }

      setDetailsByMatchId((previous) => ({ ...previous, [matchId]: json }));
    } catch (error) {
      setDetailErrors((previous) => ({
        ...previous,
        [matchId]: error instanceof Error ? error.message : "Failed to load match details",
      }));
    } finally {
      setDetailLoadingId((current) => (current === matchId ? null : current));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  const empty = items.length === 0;
  const shownCount = useMemo(() => items.length, [items.length]);

  return (
    <div className="space-y-4 rounded-[30px] bg-zinc-900/25 p-4 ring-1 ring-white/5 sm:p-5 lg:p-6">
      {empty ? (
        <div className="text-sm text-zinc-400">No matches yet. Hit Refresh to sync some.</div>
      ) : (
        <div className="space-y-3">
          {items.map((match) => {
            const champIcon =
              match.championId != null ? `${CHAMP_ICON_BASE}/${match.championId}.png` : null;
            const champName = match.championId != null ? champMap[String(match.championId)] : null;
            const kills = match.kills ?? 0;
            const deaths = match.deaths ?? 0;
            const assists = match.assists ?? 0;
            const kda = deaths === 0 ? `${kills + assists}.00` : ((kills + assists) / deaths).toFixed(2);
            const win = match.win === true;
            const playedAt = match.gameCreation ? new Date(match.gameCreation) : null;
            const playedStr = playedAt ? playedAt.toLocaleString() : "--";
            const ago = fmtAgo(match.gameCreation ?? null);
            const duration = fmtDuration(match.gameDuration ?? null);
            const isArena = match.queueId != null && ARENA_QUEUES.has(match.queueId);
            const side = !isArena ? sideLabel(match.teamId ?? null) : null;
            const position = !isArena ? prettyPos(match.teamPosition ?? null) : null;
            const resultPill = win
              ? "border-blue-500/30 bg-blue-500/10 text-blue-200"
              : "border-red-500/30 bg-red-500/10 text-red-200";
            const spellA = match.summonerSpells[0] ?? null;
            const spellB = match.summonerSpells[1] ?? null;
            const spellAInfo = spellA != null ? spellMap[String(spellA)] ?? null : null;
            const spellBInfo = spellB != null ? spellMap[String(spellB)] ?? null : null;
            const primaryRune =
              match.primaryRune != null ? runeMap[String(match.primaryRune)] ?? null : null;
            const subStyle = match.subStyle != null ? styleMap[String(match.subStyle)] ?? null : null;
            const isOpen = openMatchId === match.matchId;

            return (
              <article
                key={match._id}
                className={
                  `overflow-hidden rounded-[28px] ring-1 ring-white/5 ` +
                  `${win ? "bg-blue-500/[0.04]" : "bg-red-500/[0.04]"}`
                }
              >
                <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[180px_minmax(0,1fr)]">
                  <div
                    className={
                      "rounded-[24px] px-4 py-4 ring-1 ring-inset " +
                      (win
                        ? "bg-blue-500/10 ring-blue-400/20"
                        : "bg-red-500/10 ring-red-400/20")
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill className={resultPill}>{win ? "Victory" : "Defeat"}</Pill>
                      <Pill className="border-zinc-800 bg-black/15 text-zinc-300">{duration}</Pill>
                    </div>
                    <div className="mt-3 text-sm font-medium text-zinc-100">{queueName(match.queueId)}</div>
                    <div className="mt-1 text-xs text-zinc-400">{playedStr}</div>
                    <div className="mt-1 text-xs text-zinc-500">{ago ?? "Unknown time"}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {position ? (
                        <Pill className="border-zinc-800 bg-zinc-950/30 text-zinc-200">{position}</Pill>
                      ) : null}
                      {side ? (
                        <Pill className="border-zinc-800 bg-zinc-950/30 text-zinc-300">{side}</Pill>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-w-0 rounded-[24px] bg-zinc-950/25 p-4 sm:p-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start gap-4">
                          {champIcon ? (
                            <img
                              src={champIcon}
                              alt={champName ?? "Champion"}
                              className="h-16 w-16 rounded-[22px] border border-zinc-800 bg-zinc-900/40"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-16 w-16 rounded-[22px] border border-zinc-800 bg-zinc-900/40" />
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-xl font-semibold tracking-tight text-zinc-50">
                                {champName ?? "Unknown champion"}
                              </div>
                              {position ? (
                                <Pill className="border-transparent bg-zinc-900/60 text-zinc-300">{position}</Pill>
                              ) : null}
                              {side ? (
                                <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">{side}</Pill>
                              ) : null}
                              <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">{duration}</Pill>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <div className="text-lg font-semibold tabular-nums text-zinc-100">
                                {kills}/{deaths}/{assists}
                              </div>
                              <div className="text-sm tabular-nums text-zinc-400">{kda} KDA</div>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                              <span>{queueName(match.queueId)}</span>
                              <span className="text-zinc-700">/</span>
                              <span>{playedStr}</span>
                              {ago ? <span className="text-zinc-700">/</span> : null}
                              {ago ? <span>{ago}</span> : null}
                            </div>

                            <div className="mt-2 text-xs text-zinc-500">
                              Match ID <span className="text-zinc-400">{match.matchId}</span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
                          {spellAInfo ? (
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
                              alt={spellAInfo.name}
                              title={spellAInfo.name}
                              className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30" />
                          )}
                          {spellBInfo ? (
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
                              alt={spellBInfo.name}
                              title={spellBInfo.name}
                              className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30" />
                          )}

                          <div className="h-8 w-px bg-white/8" />

                          <RuneIcon rune={primaryRune} title="Primary rune" />
                          <RuneIcon rune={subStyle} title="Secondary style" />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <MetricTile label="Score" value={`${kills}/${deaths}/${assists}`} />
                          <MetricTile label="KDA" value={kda} />
                          <MetricTile label="CS" value={match.cs ?? "--"} />
                          <MetricTile
                            label="Gold"
                            value={match.gold != null ? match.gold.toLocaleString() : "--"}
                          />
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {match.items.length ? (
                            match.items.slice(0, 7).map((id, index) => {
                              const url = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`;
                              return (
                                <ItemIcon
                                  key={`${match._id}-${id}-${index}`}
                                  id={id}
                                  url={url}
                                  info={itemMap[String(id)] ?? null}
                                />
                              );
                            })
                          ) : (
                            <div className="text-xs text-zinc-500">No items captured.</div>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2 xl:w-[220px] xl:flex-col xl:items-stretch xl:border-l xl:border-white/8 xl:pl-5">
                        <button
                          type="button"
                          onClick={() => toggleDetails(match.matchId)}
                          className="rounded-2xl bg-zinc-900/80 px-4 py-3 text-sm font-medium text-zinc-100 ring-1 ring-white/8 transition hover:bg-white/5"
                        >
                          {isOpen ? "Hide team details" : "Open team details"}
                        </button>

                        <button
                          type="button"
                          onClick={() => copy(match.matchId)}
                          className="rounded-2xl bg-zinc-950/60 px-4 py-3 text-sm text-zinc-300 ring-1 ring-white/5 transition hover:bg-white/5"
                        >
                          Copy match ID
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {isOpen ? (
                  <MatchDetailsPanel
                    matchId={match.matchId}
                    details={detailsByMatchId[match.matchId]}
                    loading={detailLoadingId === match.matchId}
                    error={detailErrors[match.matchId]}
                    ddragonVersion={ddragonVersion}
                    itemMap={itemMap}
                    spellMap={spellMap}
                    champMap={champMap}
                    runeMap={runeMap}
                    styleMap={styleMap}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      {err ? <div className="text-sm text-red-300">{err}</div> : null}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-zinc-500">
          Showing <span className="text-zinc-300">{shownCount}</span> matches
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
