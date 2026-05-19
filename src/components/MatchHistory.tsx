"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import MatchDetailsPanel, { type MatchDetailsResponse } from "@/components/MatchDetailsPanel";
import { formatCompactDateTime, formatNumber, formatRelativeTime } from "@/lib/displayTime";
import { bestHighEloRead, highEloCardClass, type RankLike } from "@/lib/highElo";
import { analyzeMatchPerformance, csPerMinute, matchPerformanceToneClass, type MatchPerformanceBadge } from "@/lib/matchAnalysis";

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
  largestMultiKill?: number | null;
  doubleKills?: number | null;
  tripleKills?: number | null;
  quadraKills?: number | null;
  pentaKills?: number | null;
  largestKillingSpree?: number | null;
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

type DetailsParticipant = NonNullable<MatchDetailsResponse["teams"]>["blue"][number];
type QueueFilter = "all" | "solo" | "flex" | "arena" | "aram" | "normal" | "other";
type ProfileRank = NonNullable<RankLike>;

const QUEUE_NAMES: Record<number, string> = {
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  700: "Clash",
  720: "ARAM Clash",
  400: "Normal Draft",
  430: "Normal Blind",
  480: "Swiftplay",
  490: "Quickplay",
  450: "ARAM",
  900: "ARURF",
  1010: "URF",
  1020: "One for All",
  1300: "Nexus Blitz",
  1400: "Ultimate Spellbook",
  1900: "Pick URF",
  2300: "Brawl",
  2400: "ARAM: Mayhem",
  830: "Co-op vs AI (Intro)",
  840: "Co-op vs AI (Beginner)",
  850: "Co-op vs AI (Intermediate)",
  870: "Co-op vs AI (Intro)",
  880: "Co-op vs AI (Beginner)",
  890: "Co-op vs AI (Intermediate)",
  1700: "Arena",
  1710: "Arena",
  1720: "Arena",
  1750: "Arena",
  1090: "TFT (Normal)",
  1100: "TFT (Ranked)",
  1110: "TFT (Tutorial)",
  1130: "TFT (Hyper Roll)",
  1160: "TFT (Double Up)",
};

const ARENA_QUEUES = new Set([1700, 1710, 1720, 1750]);
const ARAM_QUEUES = new Set([65, 67, 72, 73, 78, 100, 300, 450, 720, 920, 2400]);
const NORMAL_QUEUES = new Set([400, 430, 480, 490]);
const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";
const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";

function queueName(queueId: number | null) {
  if (queueId == null) return "Unknown";
  return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

function queueFilterFor(queueId: number | null): Exclude<QueueFilter, "all"> {
  if (queueId === 420) return "solo";
  if (queueId === 440) return "flex";
  if (queueId != null && ARENA_QUEUES.has(queueId)) return "arena";
  if (queueId != null && ARAM_QUEUES.has(queueId)) return "aram";
  if (queueId != null && NORMAL_QUEUES.has(queueId)) return "normal";
  return "other";
}

function queueFilterLabel(filter: QueueFilter) {
  if (filter === "all") return "All";
  if (filter === "solo") return "Solo/Duo";
  if (filter === "flex") return "Flex";
  if (filter === "arena") return "Arena";
  if (filter === "aram") return "ARAM";
  if (filter === "normal") return "Normals";
  return "Other";
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

function shouldRefreshTopMatches(matches: MatchRow[], renderedAtMs: number) {
  const newest = matches[0]?.gameCreation;
  if (typeof newest !== "number" || !Number.isFinite(newest)) return true;
  const renderedAt = Number.isFinite(renderedAtMs) ? renderedAtMs : Date.now();
  return renderedAt - newest > 6 * 60 * 60 * 1000;
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

function formatRankForAi(snapshot: DetailsParticipant["solo"] | null | undefined) {
  if (!snapshot?.tier) return "UNRANKED";
  const tier = String(snapshot.tier).toUpperCase();
  const division = snapshot.division ? ` ${String(snapshot.division).toUpperCase()}` : "";
  const lp = snapshot.lp != null ? ` ${formatNumber(snapshot.lp)} LP` : "";
  return `${tier}${division}${lp}`.trim();
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

function normalizedRole(teamPosition?: string | null) {
  return prettyPos(teamPosition) ?? "";
}

function laneOpponentFor(participant: DetailsParticipant, opponents: DetailsParticipant[]) {
  const role = normalizedRole(participant.teamPosition);
  if (!role) return null;
  return opponents.find((opponent) => normalizedRole(opponent.teamPosition) === role) ?? null;
}

function highEloForMatch(queueId: number | null, solo: ProfileRank, flex: ProfileRank) {
  if (queueId === 420) return bestHighEloRead(solo);
  if (queueId === 440) return bestHighEloRead(flex);
  return bestHighEloRead(solo, flex);
}

function highEloForDetails(details: MatchDetailsResponse | undefined) {
  if (!details?.teams) return null;
  return bestHighEloRead(
    ...[...details.teams.blue, ...details.teams.red].flatMap((participant) => [participant.solo, participant.flex]),
  );
}

function positionAssetName(position: string) {
  const normalized = position.toUpperCase();
  if (normalized === "SUP" || normalized === "UTILITY") return "support";
  if (normalized === "BOT" || normalized === "BOTTOM") return "bot";
  if (normalized === "MID" || normalized === "MIDDLE") return "mid";
  if (normalized === "JUNGLE") return "jungle";
  return "top";
}

function PositionIcon({ position }: { position: string }) {
  const title =
    position === "SUP"
      ? "Support lane"
      : position === "BOT"
        ? "Bot lane"
        : position === "MID"
          ? "Mid lane"
          : `${position} lane`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://raw.communitydragon.org/11.15/plugins/rcp-be-lol-game-data/global/default/assets/ranked/positions/rankposition_gold-${positionAssetName(position)}.png`}
      alt={title}
      title={title}
      className="h-5 w-5"
      loading="lazy"
    />
  );
}

function Pill({ children, className = "", title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none tabular-nums " +
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
      className="h-6 w-6 rounded-md border border-zinc-800 bg-zinc-900/30"
      loading="lazy"
    />
  );
}

function RuneIcon({ rune, title }: { rune: RuneInfo | null; title: string }) {
  if (!rune?.icon) {
    return <div className="h-6 w-6 rounded-md border border-zinc-800 bg-zinc-900/30" />;
  }
  return (
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`}
      alt={rune.name || title}
      title={rune.name || title}
      className="h-6 w-6 rounded-md border border-zinc-800 bg-zinc-900/30"
      loading="lazy"
    />
  );
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-950/28 px-2 py-1">
      <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <span className="text-xs font-medium tabular-nums text-zinc-100">{value}</span>
    </div>
  );
}

function PerformanceBadges({ badges }: { badges: MatchPerformanceBadge[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {badges.map((badge) => (
        <Pill
          key={`${badge.kind}-${badge.label}`}
          className={`${matchPerformanceToneClass(badge.tone)} ${
            badge.kind === "score" || badge.kind === "verdict" ? "font-semibold" : ""
          }`}
          title={badge.title}
        >
          {badge.label}
        </Pill>
      ))}
    </div>
  );
}

function readableItems(ids: number[], itemMap: Record<string, ItemInfo>) {
  return ids.slice(0, 7).map((id) => ({
    id,
    name: itemMap[String(id)]?.name ?? `Item ${id}`,
  }));
}

function badgeColor(tone: MatchPerformanceBadge["tone"]) {
  if (tone === "rainbow") {
    return {
      name: "rainbow",
      accent: "#f472b6",
      text: "#ffffff",
      gradient: "linear-gradient(90deg, #f472b6, #facc15, #34d399, #60a5fa, #a855f7)",
    };
  }
  if (tone === "gold") return { name: "gold", accent: "#facc15", text: "#fef9c3" };
  if (tone === "silver") return { name: "silver", accent: "#e4e4e7", text: "#fafafa" };
  if (tone === "bronze") return { name: "bronze", accent: "#b45309", text: "#fed7aa" };
  if (tone === "elite") return { name: "emerald", accent: "#34d399", text: "#d1fae5" };
  if (tone === "good") return { name: "cyan", accent: "#22d3ee", text: "#cffafe" };
  if (tone === "warn") return { name: "yellow", accent: "#facc15", text: "#fef3c7" };
  if (tone === "bad") return { name: "orange", accent: "#fb923c", text: "#ffedd5" };
  if (tone === "awful") return { name: "red", accent: "#f87171", text: "#fee2e2" };
  return { name: "neutral", accent: "#71717a", text: "#d4d4d8" };
}

function readableBadges(badges: MatchPerformanceBadge[]) {
  return badges.map((badge) => ({
    label: badge.label,
    kind: badge.kind,
    tier: badge.tone,
    color: badgeColor(badge.tone),
    note: badge.title,
  }));
}

function serializeParticipantForAi(
  participant: DetailsParticipant,
  opponents: DetailsParticipant[],
  matchDuration: number | null | undefined,
  queueId: number | null | undefined,
  itemMap: Record<string, ItemInfo>,
  champMap: Record<string, string>,
) {
  const kills = participant.kills ?? 0;
  const deaths = participant.deaths ?? 0;
  const assists = participant.assists ?? 0;
  const kda = deaths === 0 ? kills + assists : Number(((kills + assists) / deaths).toFixed(2));
  const opponent = laneOpponentFor(participant, opponents);
  const badges = analyzeMatchPerformance({
    ...participant,
    gameDuration: matchDuration ?? null,
    queueId,
    laneOpponent: opponent
      ? {
          kills: opponent.kills,
          deaths: opponent.deaths,
          assists: opponent.assists,
          cs: opponent.cs,
          gold: opponent.gold,
          damage: opponent.damage,
        }
      : null,
  });

  return {
    player: participant.riotId ?? participant.summonerName ?? "Unknown player",
    isMe: participant.isMe,
    champion: participant.championId != null ? champMap[String(participant.championId)] ?? `Champion ${participant.championId}` : null,
    role: prettyPos(participant.teamPosition) ?? participant.teamPosition,
    result: participant.win === true ? "win" : participant.win === false ? "loss" : null,
    kdaLine: `${kills}/${deaths}/${assists}`,
    kda,
    damage: participant.damage ?? null,
    visionScore: participant.visionScore ?? null,
    wards: {
      placed: participant.wardsPlaced ?? null,
      killed: participant.wardsKilled ?? null,
    },
    cs: participant.cs ?? null,
    csPerMinute: csPerMinute(participant.cs, matchDuration)?.toFixed(1) ?? null,
    gold: participant.gold ?? null,
    soloRank: formatRankForAi(participant.solo),
    flexRank: formatRankForAi(participant.flex),
    items: readableItems(participant.items, itemMap),
    riftboard: readableBadges(badges),
  };
}

function serializeMatchForAi(
  match: MatchRow,
  details: MatchDetailsResponse | undefined,
  itemMap: Record<string, ItemInfo>,
  champMap: Record<string, string>,
) {
  const kills = match.kills ?? 0;
  const deaths = match.deaths ?? 0;
  const assists = match.assists ?? 0;
  const badges = analyzeMatchPerformance(match);
  const matchDuration = details?.match?.gameDuration ?? match.gameDuration ?? null;
  const teams = details?.teams;

  return {
    copiedFor: "AI brag / match review",
    player: `${match.championId != null ? champMap[String(match.championId)] ?? `Champion ${match.championId}` : "Unknown champion"} game by profile owner`,
    match: {
      id: match.matchId,
      queue: queueName(match.queueId),
      result: match.win === true ? "victory" : match.win === false ? "defeat" : null,
      duration: fmtDuration(match.gameDuration ?? null),
      playedAt: match.gameCreation ? new Date(match.gameCreation).toISOString() : null,
      side: sideLabel(match.teamId ?? null),
      role: prettyPos(match.teamPosition ?? null),
    },
    performance: {
      champion: match.championId != null ? champMap[String(match.championId)] ?? `Champion ${match.championId}` : null,
      kdaLine: `${kills}/${deaths}/${assists}`,
      cs: match.cs ?? null,
      csPerMinute: csPerMinute(match.cs, match.gameDuration ?? null)?.toFixed(1) ?? null,
      gold: match.gold ?? null,
      items: readableItems(match.items, itemMap),
      riftboard: readableBadges(badges),
    },
    teams: teams
      ? {
          blue: teams.blue.map((participant) =>
            serializeParticipantForAi(participant, teams.red, matchDuration, details.match?.queueId ?? match.queueId, itemMap, champMap),
          ),
          red: teams.red.map((participant) =>
            serializeParticipantForAi(participant, teams.blue, matchDuration, details.match?.queueId ?? match.queueId, itemMap, champMap),
          ),
        }
      : null,
  };
}

export default function MatchHistory({
  gameName,
  tagLine,
  ddragonVersion,
  initialMatches,
  initialCursor,
  renderedAtMs,
  profileSoloRank,
  profileFlexRank,
}: {
  gameName: string;
  tagLine: string;
  ddragonVersion: string;
  initialMatches: MatchRow[];
  initialCursor: string | null;
  renderedAtMs: number;
  profileSoloRank: ProfileRank;
  profileFlexRank: ProfileRank;
}) {
  const [items, setItems] = useState<MatchRow[]>(initialMatches);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [detailsByMatchId, setDetailsByMatchId] = useState<Record<string, MatchDetailsResponse>>({});
  const [autoDetailIds, setAutoDetailIds] = useState<Record<string, true>>({});
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
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
    setQueueFilter("all");
  }, [initialMatches, initialCursor, gameName, tagLine]);

  useEffect(() => {
    setOpenMatchId(null);
    setDetailLoadingId(null);
    setDetailErrors({});
    setDetailsByMatchId({});
    setAutoDetailIds({});
  }, [gameName, tagLine]);

  useEffect(() => {
    if (!shouldRefreshTopMatches(initialMatches, renderedAtMs)) return;

    let alive = true;
    setLoading(true);
    setErr(null);

    fetch(matchesUrl(gameName, tagLine, 10), { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          matches?: MatchRow[];
          nextCursor?: string | null;
        };
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error ?? `Failed (${response.status})`);
        }
        if (!alive) return;
        setItems(Array.isArray(json.matches) ? json.matches : []);
        setCursor(json.nextCursor ?? null);
      })
      .catch((error) => {
        if (alive) setErr(error instanceof Error ? error.message : "Sync failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [gameName, tagLine, initialMatches, renderedAtMs]);

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

  async function fetchMatchDetails(matchId: string) {
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
      return json;
    } catch (error) {
      setDetailErrors((previous) => ({
        ...previous,
        [matchId]: error instanceof Error ? error.message : "Failed to load match details",
      }));
    } finally {
      setDetailLoadingId((current) => (current === matchId ? null : current));
    }
  }

  async function toggleDetails(matchId: string) {
    if (openMatchId === matchId) {
      setOpenMatchId(null);
      return;
    }

    setOpenMatchId(matchId);
    await fetchMatchDetails(matchId);
  }

  async function copy(text: string, copiedKey?: string) {
    try {
      await navigator.clipboard.writeText(text);
      if (copiedKey) {
        setCopiedId(copiedKey);
        window.setTimeout(() => {
          setCopiedId((current) => (current === copiedKey ? null : current));
        }, 1600);
      }
    } catch {}
  }

  async function copyMatchForAi(match: MatchRow) {
    const key = `match:${match.matchId}`;
    setCopyingId(key);
    try {
      const details = detailsByMatchId[match.matchId] ?? (await fetchMatchDetails(match.matchId));
      await copy(
        JSON.stringify(serializeMatchForAi(match, details, itemMap, champMap), null, 2),
        key,
      );
    } finally {
      setCopyingId((current) => (current === key ? null : current));
    }
  }

  async function copyShownHistoryForAi() {
    const key = "shown-history";
    setCopyingId(key);
    try {
      await copy(
        JSON.stringify(
          {
            copiedFor: "AI brag / recent match history review",
            profile: `${gameName}#${tagLine}`,
            filter: queueFilterLabel(queueFilter),
            shownMatches: visibleItems.map((match) =>
              serializeMatchForAi(match, detailsByMatchId[match.matchId], itemMap, champMap),
            ),
          },
          null,
          2,
        ),
        key,
      );
    } finally {
      setCopyingId((current) => (current === key ? null : current));
    }
  }

  const empty = items.length === 0;
  const queueCounts = useMemo(() => {
    const counts: Record<QueueFilter, number> = {
      all: items.length,
      solo: 0,
      flex: 0,
      arena: 0,
      aram: 0,
      normal: 0,
      other: 0,
    };

    for (const match of items) {
      counts[queueFilterFor(match.queueId)] += 1;
    }

    return counts;
  }, [items]);
  const filterOptions = useMemo(
    () =>
      (["all", "solo", "flex", "arena", "aram", "normal", "other"] as QueueFilter[]).filter(
        (filter) => filter === "all" || queueCounts[filter] > 0,
      ),
    [queueCounts],
  );
  const visibleItems = useMemo(
    () =>
      queueFilter === "all"
        ? items
        : items.filter((match) => queueFilterFor(match.queueId) === queueFilter),
    [items, queueFilter],
  );
  const visibleMatchIdKey = useMemo(
    () => visibleItems.slice(0, 10).map((match) => match.matchId).join("|"),
    [visibleItems],
  );

  useEffect(() => {
    const ids = visibleMatchIdKey.split("|").filter(Boolean);
    const missingIds = ids.filter((id) => !detailsByMatchId[id] && !autoDetailIds[id]);
    if (!missingIds.length) return;

    let alive = true;
    setAutoDetailIds((previous) => {
      const next = { ...previous };
      for (const id of missingIds) next[id] = true;
      return next;
    });

    for (const matchId of missingIds) {
      fetch(matchDetailsUrl(gameName, tagLine, matchId), { cache: "no-store" })
        .then(async (response) => {
          const json = (await response.json().catch(() => ({}))) as MatchDetailsResponse;
          if (!response.ok || !json?.ok || !alive) return;
          setDetailsByMatchId((previous) => (previous[matchId] ? previous : { ...previous, [matchId]: json }));
        })
        .catch(() => {});
    }

    return () => {
      alive = false;
    };
  }, [autoDetailIds, detailsByMatchId, gameName, tagLine, visibleMatchIdKey]);

  const shownCount = visibleItems.length;

  return (
    <div className="space-y-2">
      {empty ? (
        <div className="text-sm text-zinc-400">No matches yet. Hit Refresh to sync some.</div>
      ) : (
        <div className="space-y-3">
          <div className="x-scroll-area -mx-1 px-1 pb-1">
            <div className="flex min-w-max items-center gap-1">
              {filterOptions.map((filter) => {
                const active = filter === queueFilter;
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setQueueFilter(filter)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
                        : "border-white/8 bg-zinc-950/30 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                    }`}
                  >
                    <span>{queueFilterLabel(filter)}</span>
                    <span className={active ? "text-emerald-100/70" : "text-zinc-600"}>
                      {queueCounts[filter]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {visibleItems.map((match) => {
            const champIcon =
              match.championId != null ? `${CHAMP_ICON_BASE}/${match.championId}.png` : null;
            const champName = match.championId != null ? champMap[String(match.championId)] : null;
            const kills = match.kills ?? 0;
            const deaths = match.deaths ?? 0;
            const assists = match.assists ?? 0;
            const kda = deaths === 0 ? `${kills + assists}.00` : ((kills + assists) / deaths).toFixed(2);
            const win = match.win === true;
            const playedStr = formatCompactDateTime(match.gameCreation ?? null) ?? "--";
            const ago = formatRelativeTime(match.gameCreation ?? null, renderedAtMs);
            const duration = fmtDuration(match.gameDuration ?? null);
            const isArena = match.queueId != null && ARENA_QUEUES.has(match.queueId);
            const side = !isArena ? sideLabel(match.teamId ?? null) : null;
            const position = !isArena ? prettyPos(match.teamPosition ?? null) : null;
            const spellA = match.summonerSpells[0] ?? null;
            const spellB = match.summonerSpells[1] ?? null;
            const spellAInfo = spellA != null ? spellMap[String(spellA)] ?? null : null;
            const spellBInfo = spellB != null ? spellMap[String(spellB)] ?? null : null;
            const primaryRune =
              match.primaryRune != null ? runeMap[String(match.primaryRune)] ?? null : null;
            const subStyle = match.subStyle != null ? styleMap[String(match.subStyle)] ?? null : null;
            const isOpen = openMatchId === match.matchId;
            const badges = analyzeMatchPerformance(match);
            const highElo =
              highEloForDetails(detailsByMatchId[match.matchId]) ??
              highEloForMatch(match.queueId, profileSoloRank, profileFlexRank);

            return (
              <article
                key={match._id}
                className={`relative overflow-hidden rounded-[18px] ${
                  highElo ? highEloCardClass(highElo) : win ? "bg-blue-500/[0.035]" : "bg-red-500/[0.035]"
                }`}
              >
                {highElo ? (
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                ) : null}
                <div className="space-y-2 p-2.5 sm:p-3 lg:hidden">
                  <div
                    className={
                      "rounded-[16px] px-0 py-0 " +
                      (win
                        ? "text-blue-200"
                        : "text-red-200")
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className={win ? "font-semibold text-blue-300" : "font-semibold text-red-300"}>
                        {win ? "Victory" : "Defeat"}
                      </span>
                      <span className="text-zinc-500">{duration}</span>
                    </div>
                    <div className="mt-1.5 text-xs text-zinc-200">{queueName(match.queueId)}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">{ago ?? "Unknown time"}</div>
                  </div>

                  <div className="flex items-start gap-3">
                    {champIcon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={champIcon}
                        alt={champName ?? "Champion"}
                        className="h-12 w-12 rounded-[14px] bg-zinc-900/40 ring-1 ring-white/6"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-[14px] bg-zinc-900/40 ring-1 ring-white/6" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold tracking-tight text-zinc-50 sm:text-[15px]">
                        {champName ?? "Unknown champion"}
                      </div>
                        {position ? (
                          <Pill className="border-transparent bg-zinc-900/60 px-1 text-zinc-300" title={`${position} lane`}>
                            <PositionIcon position={position} />
                          </Pill>
                        ) : null}
                        {side ? (
                          <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">{side}</Pill>
                        ) : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {spellAInfo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
                            alt={spellAInfo.name}
                            title={spellAInfo.name}
                            className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6" />
                        )}
                        {spellBInfo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
                            alt={spellBInfo.name}
                            title={spellBInfo.name}
                            className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6" />
                        )}
                        <RuneIcon rune={primaryRune} title="Primary rune" />
                        <RuneIcon rune={subStyle} title="Secondary style" />
                      </div>

                      <div className="mt-1 text-sm font-semibold tabular-nums text-zinc-100">
                        {kills} / {deaths} / {assists}
                      </div>
                      <div className="mt-0.5 text-xs tabular-nums text-zinc-400">{kda} KDA</div>
                      <div className="mt-1 text-[11px] text-zinc-500">{playedStr}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mx-2">
                    <MetricTile label="Score" value={`${kills}/${deaths}/${assists}`} />
                    <MetricTile label="KDA" value={kda} />
                    <MetricTile label="CS" value={match.cs ?? "--"} />
                    <MetricTile
                      label="Gold"
                      value={formatNumber(match.gold) ?? "--"}
                    />
                  </div>

                  <div className="rounded-xl bg-zinc-950/22 p-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Read</div>
                    <PerformanceBadges badges={badges} />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
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

                  <div className="grid gap-1.5 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => toggleDetails(match.matchId)}
                      className="rounded-lg bg-zinc-900/45 px-2.5 py-1.5 text-[11px] font-medium text-zinc-100 transition hover:bg-white/5"
                    >
                      {isOpen ? "Hide details" : "Open details"}
                    </button>

                    <button
                      type="button"
                      onClick={() => copy(match.matchId, `id:${match.matchId}`)}
                      className="rounded-lg bg-zinc-950/35 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:bg-white/5"
                    >
                      {copiedId === `id:${match.matchId}` ? "Copied ID" : "Copy match ID"}
                    </button>

                    <button
                      type="button"
                      onClick={() => copyMatchForAi(match)}
                      disabled={copyingId === `match:${match.matchId}`}
                      className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-100 ring-1 ring-emerald-400/15 transition hover:bg-emerald-400/15 disabled:opacity-50"
                    >
                      {copyingId === `match:${match.matchId}`
                        ? "Copying..."
                        : copiedId === `match:${match.matchId}`
                          ? "Copied JSON"
                          : "Copy AI JSON"}
                    </button>
                  </div>
                </div>

                <div className="hidden gap-2 p-2.5 sm:p-3 lg:grid lg:grid-cols-[84px_minmax(0,1.1fr)_108px_130px_112px_minmax(0,160px)_118px] lg:items-center">
                  <div
                    className={
                      "min-w-0 rounded-[16px] px-0 py-0 " +
                      (win
                        ? "text-blue-200"
                        : "text-red-200")
                    }
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span className={win ? "font-semibold text-blue-300" : "font-semibold text-red-300"}>
                        {win ? "Victory" : "Defeat"}
                      </span>
                      <span className="text-zinc-500">{duration}</span>
                    </div>
                    <div className="mt-1.5 text-xs text-zinc-200">{queueName(match.queueId)}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">{ago ?? "Unknown time"}</div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-2">
                      {champIcon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={champIcon}
                          alt={champName ?? "Champion"}
                          className="h-10 w-10 rounded-[12px] bg-zinc-900/40 ring-1 ring-white/6"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-[12px] bg-zinc-900/40 ring-1 ring-white/6" />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[13px] font-semibold tracking-tight text-zinc-50">
                            {champName ?? "Unknown champion"}
                          </div>
                          {position ? (
                            <Pill className="border-transparent bg-zinc-900/60 px-1 text-zinc-300" title={`${position} lane`}>
                              <PositionIcon position={position} />
                            </Pill>
                          ) : null}
                          {side ? (
                            <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">{side}</Pill>
                          ) : null}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {spellAInfo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
                              alt={spellAInfo.name}
                              title={spellAInfo.name}
                              className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6" />
                          )}
                          {spellBInfo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
                              alt={spellBInfo.name}
                              title={spellBInfo.name}
                              className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-5 w-5 rounded-md bg-zinc-900/30 ring-1 ring-white/6" />
                          )}
                          <RuneIcon rune={primaryRune} title="Primary rune" />
                          <RuneIcon rune={subStyle} title="Secondary style" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold tabular-nums text-zinc-100">
                      {kills} / {deaths} / {assists}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-zinc-400">{kda} KDA</div>
                    <div className="mt-1 text-[11px] text-zinc-500">{playedStr}</div>
                  </div>

                  <div className="min-w-0">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Analysis</div>
                    <PerformanceBadges badges={badges} />
                  </div>

                  <div className="flex flex-wrap gap-1.5 lg:flex-col lg:items-start">
                    <MetricTile label="CS" value={match.cs ?? "--"} />
                    <MetricTile
                      label="Gold"
                      value={formatNumber(match.gold) ?? "--"}
                    />
                  </div>

                  <div className="flex min-w-0 flex-wrap justify-start gap-1.5">
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

                  <div className="flex flex-wrap gap-1.5 lg:flex-col lg:items-stretch">
                    <button
                      type="button"
                      onClick={() => toggleDetails(match.matchId)}
                      className="rounded-lg bg-zinc-900/40 px-2 py-1.5 text-[10px] font-medium text-zinc-100 transition hover:bg-white/5"
                    >
                      {isOpen ? "Hide details" : "Open details"}
                    </button>

                    <button
                      type="button"
                      onClick={() => copy(match.matchId, `id:${match.matchId}`)}
                      className="rounded-lg bg-zinc-950/28 px-2 py-1.5 text-[10px] text-zinc-300 transition hover:bg-white/5"
                    >
                      {copiedId === `id:${match.matchId}` ? "Copied ID" : "Copy match ID"}
                    </button>

                    <button
                      type="button"
                      onClick={() => copyMatchForAi(match)}
                      disabled={copyingId === `match:${match.matchId}`}
                      className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[10px] font-medium text-emerald-100 ring-1 ring-emerald-400/15 transition hover:bg-emerald-400/15 disabled:opacity-50"
                    >
                      {copyingId === `match:${match.matchId}`
                        ? "Copying..."
                        : copiedId === `match:${match.matchId}`
                          ? "Copied JSON"
                          : "Copy AI JSON"}
                    </button>
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

          {!visibleItems.length ? (
            <div className="rounded-2xl bg-zinc-950/30 px-4 py-6 text-sm text-zinc-500">
              No {queueFilterLabel(queueFilter).toLowerCase()} games in the loaded match list.
            </div>
          ) : null}
        </div>
      )}
      {err ? <div className="text-sm text-red-300">{err}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="text-xs text-zinc-500">
          Showing <span className="text-zinc-300">{shownCount}</span> matches
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyShownHistoryForAi}
            disabled={!items.length || copyingId === "shown-history"}
            className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-40"
          >
            {copyingId === "shown-history"
              ? "Copying..."
              : copiedId === "shown-history"
                ? "Copied JSON"
                : "Copy shown JSON"}
          </button>
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
    </div>
  );
}
