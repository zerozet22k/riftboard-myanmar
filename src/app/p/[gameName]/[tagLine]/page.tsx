import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import MatchHistory, { type MatchRow } from "@/components/MatchHistory";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileCommentsSection from "@/components/ProfileCommentsSection";
import ProfileRefreshButton from "@/components/ProfileRefreshButton";
import RankEmblem from "@/components/RankEmblem";
import { getLatestDdragonVersion } from "@/lib/ddragon";
import {
  formatFullDateTime,
  formatMetaDateTime as formatDisplayMetaDateTime,
  formatNumber,
} from "@/lib/displayTime";
import { getOptionalDiscordSession } from "@/lib/discordSession";
import { approvedCommunityLeaderboardQuery } from "@/lib/communityLeaderboard";
import { analyzeMatchPerformance, matchPerformanceToneClass, type MatchPerformanceBadge } from "@/lib/matchAnalysis";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import {
  serializeProfileComment,
  type ProfileCommentView,
  type StoredProfileComment,
} from "@/lib/profileComments";
import { bestRankSnapshot } from "@/lib/rank";
import {
  absoluteUrl,
  getSiteBannerUrl,
  getSiteOpenGraphImages,
  organizationSchemaId,
  SITE_NAME,
  websiteSchemaId,
} from "@/lib/seo";
import { Player } from "@/models/player";
import { ProfileComment } from "@/models/profileComment";
import { PlayerMatch } from "@/models/playerMatch";
import { RankEntry } from "@/models/rankEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

type RouteParams = { gameName: string; tagLine: string };

type PeakRankLike = {
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
  wins?: number | null;
  losses?: number | null;
  fetchedAt?: Date | string | null;
};

type PlayerView = {
  _id: unknown;
  gameName: string;
  tagLine: string;
  platform?: string | null;
  matchRegion?: string | null;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  lastRefreshAt?: Date | null;
  masterySyncedAt?: Date | null;
  solo?: PeakRankLike | null;
  flex?: PeakRankLike | null;
  mains?: Array<{
    championId?: number | null;
    championPoints?: number | null;
  }> | null;
};

type LeaderboardRankView = {
  _id: unknown;
  gameName?: string | null;
  tagLine?: string | null;
  solo?: PeakRankLike | null;
  flex?: PeakRankLike | null;
};

type RankHistoryRow = PeakRankLike & {
  queue: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";
};

type MatchDoc = {
  _id: unknown;
  matchId: string;
  queueId?: number | null;
  gameCreation?: number | null;
  gameDuration?: number | null;
  championId?: number | null;
  teamId?: number | null;
  teamPosition?: string | null;
  primaryStyle?: number | null;
  primaryRune?: number | null;
  subStyle?: number | null;
  win?: boolean | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  largestMultiKill?: number | null;
  doubleKills?: number | null;
  tripleKills?: number | null;
  quadraKills?: number | null;
  pentaKills?: number | null;
  largestKillingSpree?: number | null;
  cs?: number | null;
  gold?: number | null;
  items?: unknown[];
  summonerSpells?: unknown[];
};

type ChampionSummaryEntry = { id?: number; name?: string };

type RecentQueueSummary = {
  games: number;
  wins: number;
  winrate: number | null;
  avgKda: number | null;
  results: Array<{ matchId: string; win: boolean | null; championId: number | null }>;
  mainRoles: Array<{ role: string; games: number; winrate: number | null }>;
  champions: Array<{ championId: number; games: number; winrate: number | null }>;
  badges: MatchPerformanceBadge[];
};

type LadderRanks = {
  solo: number | null;
  flex: number | null;
  soloTotal: number;
  flexTotal: number;
};

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

function isoOrNull(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function rankLine(tier?: string | null, division?: string | null, lp?: number | null) {
  if (!tier) return "UNRANKED";
  const tierText = String(tier).toUpperCase();
  const divisionText = division ? ` ${String(division).toUpperCase()}` : "";
  const lpText = lp != null && Number.isFinite(Number(lp)) ? ` - ${Number(lp)} LP` : "";
  return `${tierText}${divisionText}${lpText}`;
}

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

function rankKey(tier?: string | null, division?: string | null, lp?: number | null) {
  const tierValue = tier ? TIER_ORDER[String(tier).toUpperCase()] : undefined;
  if (tierValue === undefined) return -1;
  const divisionValue = division ? (DIV_ORDER[String(division).toUpperCase()] ?? 0) : 0;
  const lpValue = Number.isFinite(Number(lp)) ? Number(lp) : 0;
  return tierValue * 100000 + divisionValue * 1000 + lpValue;
}

function peakRankFromHistory(history: PeakRankLike[], current: PeakRankLike | null | undefined) {
  if (history.length) return bestRankSnapshot(history);
  if (current?.tier) return current;
  return null;
}

function peakSeenLabel(snapshot?: PeakRankLike | null) {
  return formatFullDateTime(snapshot?.fetchedAt ?? null);
}

function cursorFromLast(last: MatchDoc | undefined) {
  if (!last || typeof last.gameCreation !== "number") return null;
  const payload = { gc: last.gameCreation, id: String(last._id), matchId: String(last.matchId ?? "") };
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getChampNameMap() {
  const response = await fetch(CHAMP_SUMMARY_URL, {
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!response.ok) return {} as Record<string, string>;

  const payload = (await response.json()) as ChampionSummaryEntry[];
  const map: Record<string, string> = {};
  for (const champion of payload) {
    if (champion?.id == null || !champion?.name) continue;
    map[String(champion.id)] = champion.name;
  }
  return map;
}

function champIconUrl(championId: number | null | undefined) {
  if (championId == null) return null;
  return `${CHAMP_ICON_BASE}/${championId}.png`;
}

function roleAssetName(role: string) {
  const normalized = role.toUpperCase();
  if (normalized === "UTILITY" || normalized === "SUP") return "support";
  if (normalized === "BOTTOM" || normalized === "BOT") return "bot";
  if (normalized === "MIDDLE" || normalized === "MID") return "mid";
  if (normalized === "JUNGLE") return "jungle";
  return "top";
}

function roleLabel(role: string) {
  const normalized = role.toUpperCase();
  if (normalized === "UTILITY") return "Support";
  if (normalized === "BOTTOM") return "Bot";
  if (normalized === "MIDDLE") return "Mid";
  if (normalized === "JUNGLE") return "Jungle";
  if (normalized === "TOP") return "Top";
  return normalized || "Unknown";
}

function roleIconUrl(role: string) {
  return `https://raw.communitydragon.org/11.15/plugins/rcp-be-lol-game-data/global/default/assets/ranked/positions/rankposition_gold-${roleAssetName(role)}.png`;
}

function pct(wins: number, games: number) {
  if (!games) return null;
  return Math.round((wins / games) * 100);
}

function scoreFromBadges(badges: MatchPerformanceBadge[]) {
  const scoreBadge = badges.find((badge) => badge.kind === "score");
  const match = scoreBadge?.label.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function signatureChampionFromRecent(
  matches: MatchDoc[],
  mains: PlayerView["mains"],
) {
  const rows = new Map<number, { games: number; wins: number; scoreTotal: number }>();

  for (const match of matches.slice(0, 20)) {
    if (typeof match.championId !== "number") continue;
    const current = rows.get(match.championId) ?? { games: 0, wins: 0, scoreTotal: 0 };
    current.games += 1;
    if (match.win === true) current.wins += 1;
    current.scoreTotal += scoreFromBadges(analyzeMatchPerformance({
      queueId: typeof match.queueId === "number" ? match.queueId : null,
      gameDuration: typeof match.gameDuration === "number" ? match.gameDuration : null,
      teamPosition: typeof match.teamPosition === "string" ? match.teamPosition : null,
      win: typeof match.win === "boolean" ? match.win : null,
      kills: typeof match.kills === "number" ? match.kills : null,
      deaths: typeof match.deaths === "number" ? match.deaths : null,
      assists: typeof match.assists === "number" ? match.assists : null,
      largestMultiKill: typeof match.largestMultiKill === "number" ? match.largestMultiKill : null,
      doubleKills: typeof match.doubleKills === "number" ? match.doubleKills : null,
      tripleKills: typeof match.tripleKills === "number" ? match.tripleKills : null,
      quadraKills: typeof match.quadraKills === "number" ? match.quadraKills : null,
      pentaKills: typeof match.pentaKills === "number" ? match.pentaKills : null,
      cs: typeof match.cs === "number" ? match.cs : null,
      gold: typeof match.gold === "number" ? match.gold : null,
    }));
    rows.set(match.championId, current);
  }

  const bestRecent = [...rows.entries()]
    .map(([championId, row]) => {
      const winrate = row.wins / row.games;
      const averageScore = row.scoreTotal / row.games;
      return {
        championId,
        games: row.games,
        wins: row.wins,
        averageScore,
        reason:
          row.games >= 3
            ? `${row.games} games - ${Math.round(winrate * 100)}% WR - ${Math.round(averageScore)} score`
            : `${row.games} ${row.games === 1 ? "game" : "games"} - ${Math.round(averageScore)} score`,
        key: averageScore + row.games * 7 + winrate * 18 + (row.games >= 3 ? 10 : 0),
      };
    })
    .sort((left, right) => right.key - left.key)[0];

  if (bestRecent) return bestRecent;

  const mastery = Array.isArray(mains) ? mains[0] : null;
  return typeof mastery?.championId === "number"
    ? {
        championId: mastery.championId,
        games: 0,
        wins: 0,
        averageScore: 0,
        reason: `${formatNumber(mastery.championPoints)} mastery points`,
        key: 0,
      }
    : null;
}

function ladderRanks(players: LeaderboardRankView[], playerId: unknown): LadderRanks {
  const id = String(playerId);
  const soloRows = players
    .filter((row) => row.solo?.tier)
    .map((row) => ({ id: String(row._id), key: rankKey(row.solo?.tier, row.solo?.division, row.solo?.lp) }))
    .sort((left, right) => right.key - left.key || left.id.localeCompare(right.id));
  const flexRows = players
    .filter((row) => row.flex?.tier)
    .map((row) => ({ id: String(row._id), key: rankKey(row.flex?.tier, row.flex?.division, row.flex?.lp) }))
    .sort((left, right) => right.key - left.key || left.id.localeCompare(right.id));
  const soloIndex = soloRows.findIndex((row) => row.id === id);
  const flexIndex = flexRows.findIndex((row) => row.id === id);

  return {
    solo: soloIndex >= 0 ? soloIndex + 1 : null,
    flex: flexIndex >= 0 ? flexIndex + 1 : null,
    soloTotal: soloRows.length,
    flexTotal: flexRows.length,
  };
}

function recentQueueSummary(matches: MatchDoc[], queueId: number): RecentQueueSummary | null {
  const window = matches.filter((match) => match.queueId === queueId).slice(0, 20);
  if (!window.length) return null;

  const wins = window.filter((match) => match.win === true).length;
  const roleMap = new Map<string, { games: number; wins: number }>();
  const champMap = new Map<number, { games: number; wins: number }>();
  let kdaTotal = 0;

  for (const match of window) {
    const role = String(match.teamPosition ?? "").toUpperCase();
    if (role && role !== "NONE" && role !== "INVALID") {
      const current = roleMap.get(role) ?? { games: 0, wins: 0 };
      current.games += 1;
      if (match.win === true) current.wins += 1;
      roleMap.set(role, current);
    }

    if (typeof match.championId === "number") {
      const current = champMap.get(match.championId) ?? { games: 0, wins: 0 };
      current.games += 1;
      if (match.win === true) current.wins += 1;
      champMap.set(match.championId, current);
    }

    const kills = match.kills ?? 0;
    const deaths = match.deaths ?? 0;
    const assists = match.assists ?? 0;
    kdaTotal += deaths === 0 ? kills + assists : (kills + assists) / Math.max(1, deaths);
  }

  const badges = analyzeMatchPerformance({
    gameDuration: Math.round(window.reduce((sum, match) => sum + (match.gameDuration ?? 0), 0) / window.length),
    teamPosition: [...roleMap.entries()].sort((a, b) => b[1].games - a[1].games)[0]?.[0] ?? null,
    win: wins / window.length >= 0.5,
    kills: Math.round(window.reduce((sum, match) => sum + (match.kills ?? 0), 0) / window.length),
    deaths: Math.round(window.reduce((sum, match) => sum + (match.deaths ?? 0), 0) / window.length),
    assists: Math.round(window.reduce((sum, match) => sum + (match.assists ?? 0), 0) / window.length),
    cs: Math.round(window.reduce((sum, match) => sum + (match.cs ?? 0), 0) / window.length),
    gold: Math.round(window.reduce((sum, match) => sum + (match.gold ?? 0), 0) / window.length),
  }).slice(0, 2);

  return {
    games: window.length,
    wins,
    winrate: pct(wins, window.length),
    avgKda: kdaTotal / window.length,
    results: window.map((match) => ({
      matchId: String(match.matchId),
      win: typeof match.win === "boolean" ? match.win : null,
      championId: typeof match.championId === "number" ? match.championId : null,
    })),
    mainRoles: [...roleMap.entries()]
      .map(([role, row]) => ({ role, games: row.games, winrate: pct(row.wins, row.games) }))
      .sort((left, right) => right.games - left.games || (right.winrate ?? 0) - (left.winrate ?? 0))
      .slice(0, 2),
    champions: [...champMap.entries()]
      .map(([championId, row]) => ({ championId, games: row.games, winrate: pct(row.wins, row.games) }))
      .sort((left, right) => right.games - left.games || (right.winrate ?? 0) - (left.winrate ?? 0))
      .slice(0, 4),
    badges,
  };
}

function playerMetaDescription(player: Pick<PlayerView, "gameName" | "tagLine" | "solo" | "flex">) {
  const soloLine = rankLine(player.solo?.tier ?? null, player.solo?.division ?? null, player.solo?.lp ?? null);
  const flexLine = rankLine(player.flex?.tier ?? null, player.flex?.division ?? null, player.flex?.lp ?? null);
  return `${player.gameName}#${player.tagLine} League profile on RiftBoard Myanmar. Solo/Duo ${soloLine}; Flex ${flexLine}. View rank, match history, Riftboard scores, and champion mastery.`;
}

export async function generateMetadata({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}): Promise<Metadata> {
  const resolved = (await params) as Partial<RouteParams>;
  const gameNameRaw = safeDecode(resolved.gameName).trim();
  const tagLineRaw = safeDecode(resolved.tagLine).trim().toLowerCase();

  if (!gameNameRaw || !tagLineRaw) {
    return {
      title: "Player Profile",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  await dbConnect();

  const player = (await Player.findOne(
    {
      ...buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
      "leaderboard.status": "approved",
    },
    {
      gameName: 1,
      tagLine: 1,
      solo: 1,
      flex: 1,
    }
  ).lean()) as Pick<PlayerView, "gameName" | "tagLine" | "solo" | "flex"> | null;

  if (!player?.gameName || !player.tagLine) {
    return {
      title: "Player Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const canonicalPath = canonicalPlayerPath(player.gameName, player.tagLine);
  const description = playerMetaDescription(player);
  const riotId = `${player.gameName}#${player.tagLine}`;
  const title = `${riotId} LoL Profile`;

  return {
    title,
    description,
    keywords: [
      riotId,
      `${player.gameName} ${player.tagLine}`,
      `${riotId} RiftBoard Myanmar`,
      `${riotId} League of Legends`,
      `${riotId} match history`,
      `${riotId} champion mastery`,
    ],
    alternates: {
      canonical: canonicalPath,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "profile",
      url: absoluteUrl(canonicalPath),
      title,
      description,
      siteName: SITE_NAME,
      images: getSiteOpenGraphImages(),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: getSiteOpenGraphImages().map((image) => image.url),
    },
  };
}

export default async function PlayerProfilePage({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}) {
  const resolved = (await params) as Partial<RouteParams>;
  const gameNameRaw = safeDecode(resolved.gameName).trim();
  const tagLineRaw = safeDecode(resolved.tagLine).trim().toLowerCase();

  if (!gameNameRaw || !tagLineRaw) notFound();

  await dbConnect();

  const player = (await Player.findOne(
    {
      ...buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
      "leaderboard.status": "approved",
    },
    {
      gameName: 1,
      tagLine: 1,
      platform: 1,
      matchRegion: 1,
      profileIconId: 1,
      summonerLevel: 1,
      lastRefreshAt: 1,
      masterySyncedAt: 1,
      solo: 1,
      flex: 1,
      mains: 1,
    }
  ).lean()) as PlayerView | null;

  if (!player?._id) notFound();

  const canonicalGameName = player.gameName.trim();
  const canonicalTagLineLower = player.tagLine.trim().toLowerCase();
  const canonicalPath = canonicalPlayerPath(canonicalGameName, canonicalTagLineLower);

  if (gameNameRaw !== canonicalGameName || tagLineRaw !== canonicalTagLineLower) {
    redirect(canonicalPath);
  }

  const [ddVer, champNames, rankHistory, matchDocs, viewer, commentDocs, leaderboardPlayers] = await Promise.all([
    getLatestDdragonVersion(),
    getChampNameMap(),
    RankEntry.find(
      {
        playerId: player._id,
        queue: { $in: ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] },
      },
      { queue: 1, tier: 1, division: 1, lp: 1, wins: 1, losses: 1, fetchedAt: 1 }
    )
      .sort({ fetchedAt: -1 })
      .lean() as Promise<RankHistoryRow[]>,
    PlayerMatch.find(
      { playerId: player._id },
      {
        matchId: 1,
        queueId: 1,
        gameCreation: 1,
        gameDuration: 1,
        championId: 1,
        teamId: 1,
        teamPosition: 1,
        primaryStyle: 1,
        primaryRune: 1,
        subStyle: 1,
        win: 1,
        kills: 1,
        deaths: 1,
        assists: 1,
        largestMultiKill: 1,
        doubleKills: 1,
        tripleKills: 1,
        quadraKills: 1,
        pentaKills: 1,
        largestKillingSpree: 1,
        cs: 1,
        gold: 1,
        items: 1,
        summonerSpells: 1,
      }
    )
      .sort({ gameCreation: -1, _id: -1 })
      .limit(40)
      .lean() as Promise<MatchDoc[]>,
    getOptionalDiscordSession(),
    ProfileComment.find(
      { profilePlayerId: player._id },
      {
        authorDiscordUsername: 1,
        authorGameName: 1,
        authorTagLine: 1,
        body: 1,
        createdAt: 1,
      }
    )
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean() as Promise<StoredProfileComment[]>,
    Player.find(
      approvedCommunityLeaderboardQuery(),
      { gameName: 1, tagLine: 1, solo: 1, flex: 1 }
    ).lean() as Promise<LeaderboardRankView[]>,
  ]);

  const initialMatchDocs = matchDocs.slice(0, 10);
  const initialMatches: MatchRow[] = initialMatchDocs.map((match) => ({
    _id: String(match._id),
    matchId: String(match.matchId),
    queueId: typeof match.queueId === "number" ? match.queueId : null,
    gameCreation: typeof match.gameCreation === "number" ? match.gameCreation : null,
    gameDuration: typeof match.gameDuration === "number" ? match.gameDuration : null,
    championId: typeof match.championId === "number" ? match.championId : null,
    teamId: typeof match.teamId === "number" ? match.teamId : null,
    teamPosition: typeof match.teamPosition === "string" ? match.teamPosition : null,
    primaryStyle: typeof match.primaryStyle === "number" ? match.primaryStyle : null,
    primaryRune: typeof match.primaryRune === "number" ? match.primaryRune : null,
    subStyle: typeof match.subStyle === "number" ? match.subStyle : null,
    win: typeof match.win === "boolean" ? match.win : null,
    kills: typeof match.kills === "number" ? match.kills : null,
    deaths: typeof match.deaths === "number" ? match.deaths : null,
    assists: typeof match.assists === "number" ? match.assists : null,
    largestMultiKill: typeof match.largestMultiKill === "number" ? match.largestMultiKill : null,
    doubleKills: typeof match.doubleKills === "number" ? match.doubleKills : null,
    tripleKills: typeof match.tripleKills === "number" ? match.tripleKills : null,
    quadraKills: typeof match.quadraKills === "number" ? match.quadraKills : null,
    pentaKills: typeof match.pentaKills === "number" ? match.pentaKills : null,
    largestKillingSpree: typeof match.largestKillingSpree === "number" ? match.largestKillingSpree : null,
    cs: typeof match.cs === "number" ? match.cs : null,
    gold: typeof match.gold === "number" ? match.gold : null,
    items: Array.isArray(match.items)
      ? match.items.filter((value): value is number => typeof value === "number")
      : [],
    summonerSpells: Array.isArray(match.summonerSpells)
      ? match.summonerSpells.filter((value): value is number => typeof value === "number")
      : [],
  }));

  const solo = player.solo ?? {};
  const flex = player.flex ?? {};
  const soloPeak = peakRankFromHistory(
    rankHistory.filter((entry) => entry.queue === "RANKED_SOLO_5x5"),
    solo
  );
  const flexPeak = peakRankFromHistory(
    rankHistory.filter((entry) => entry.queue === "RANKED_FLEX_SR"),
    flex
  );
  const soloRecent = recentQueueSummary(matchDocs, 420);
  const flexRecent = recentQueueSummary(matchDocs, 440);
  const ladder = ladderRanks(leaderboardPlayers, player._id);
  // eslint-disable-next-line react-hooks/purity
  const renderedAtMs = Date.now();

  const nameShown = `${player.gameName}#${player.tagLine}`;
  const lastUpdatedShort =
    formatDisplayMetaDateTime(player.lastRefreshAt) ??
    formatDisplayMetaDateTime(isoOrNull(player.solo?.fetchedAt)) ??
    formatDisplayMetaDateTime(isoOrNull(player.flex?.fetchedAt));
  const masteryUpdatedShort = formatDisplayMetaDateTime(player.masterySyncedAt);
  const masteryPath = `${canonicalPath}/mastery`;
  const tftProfilePath = `/tft/p/${encodeURIComponent(canonicalGameName)}/${encodeURIComponent(canonicalTagLineLower)}`;
  const profileUrl = absoluteUrl(canonicalPath);
  const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(profileUrl)}`;
  const signatureChampion = signatureChampionFromRecent(matchDocs, player.mains);
  const signatureChampionId = signatureChampion?.championId ?? null;
  const signatureChampionName = signatureChampionId != null ? champNames[String(signatureChampionId)] ?? `Champion ${signatureChampionId}` : null;
  const signatureChampionIcon = champIconUrl(signatureChampionId);
  const initialCursor = cursorFromLast(initialMatchDocs[initialMatchDocs.length - 1]);
  const initialComments: ProfileCommentView[] = commentDocs.map(serializeProfileComment);
  const profileJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: absoluteUrl(canonicalPath),
    name: nameShown,
    alternateName: [
      nameShown,
      `${player.gameName} ${player.tagLine}`,
      `${player.gameName} / ${player.tagLine}`,
    ],
    identifier: nameShown,
    description: playerMetaDescription(player),
    image: [getSiteBannerUrl()],
    isPartOf: {
      "@id": websiteSchemaId(),
    },
    publisher: {
      "@id": organizationSchemaId(),
    },
    mainEntity: {
      "@type": "Thing",
      name: nameShown,
      alternateName: [`${player.gameName} ${player.tagLine}`, `${player.gameName} / ${player.tagLine}`],
      identifier: nameShown,
    },
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(30,41,59,0.42),transparent_34%),radial-gradient(circle_at_18%_18%,rgba(16,185,129,0.14),transparent_22%),#09090b] text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(profileJsonLd) }}
      />
      <div className="mx-auto w-full max-w-[1400px] space-y-3 px-4 py-3 sm:px-5 sm:py-4 lg:px-6">
        <section className="relative overflow-hidden rounded-[24px] bg-zinc-950/62 p-4 ring-1 ring-white/5 sm:p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.14),transparent_26%)]" />

          <div className="relative grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
              <ProfileAvatar
                iconId={player.profileIconId ?? null}
                ddragonVersion={ddVer}
                alt={`${nameShown} profile icon`}
                className="h-[72px] w-[72px] shrink-0 sm:h-[88px] sm:w-[88px]"
                level={player.summonerLevel ?? null}
              />

              <div className="min-w-0 space-y-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[2rem]">
                      {nameShown}
                    </h1>
                    <Pill className="border-zinc-700 bg-zinc-900/70 text-zinc-300">
                      {String(player.platform ?? "auto").toUpperCase()}
                    </Pill>
                    <Pill className="border-zinc-700 bg-zinc-900/70 text-zinc-400">
                      Match region {String(player.matchRegion ?? "--").toUpperCase()}
                    </Pill>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1">
                      <RankEmblem tier={solo.tier ?? null} className="h-4 w-4 shrink-0" alt="" />
                      <span>{rankLine(solo.tier ?? null, solo.division ?? null, solo.lp ?? null)}</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-zinc-900/45 px-3 py-1 text-zinc-400">
                      <RankEmblem tier={flex.tier ?? null} className="h-4 w-4 shrink-0" alt="" />
                      <span>{rankLine(flex.tier ?? null, flex.division ?? null, flex.lp ?? null)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-2.5">
                  <StatTile
                    label="Solo ladder"
                    value={ladder.solo != null ? `#${formatNumber(ladder.solo)}` : "--"}
                    title={ladder.solo != null ? `${ladder.solo} of ${ladder.soloTotal} ranked Solo players` : undefined}
                  />
                  <StatTile
                    label="Flex ladder"
                    value={ladder.flex != null ? `#${formatNumber(ladder.flex)}` : "--"}
                    title={ladder.flex != null ? `${ladder.flex} of ${ladder.flexTotal} ranked Flex players` : undefined}
                  />
                  <MetaInfoButton
                    lastUpdated={lastUpdatedShort}
                    masteryUpdated={masteryUpdatedShort}
                  />
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href={canonicalPath}
                    aria-current="page"
                    className="rounded-xl bg-emerald-500/12 px-3.5 py-2 text-sm font-medium text-emerald-100 ring-1 ring-emerald-300/20"
                  >
                    LoL profile
                  </Link>
                  <Link
                    href={tftProfilePath}
                    className="rounded-xl bg-zinc-950/42 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                  >
                    TFT profile
                  </Link>
                  <Link
                    href="/leaderboard"
                    className="rounded-xl bg-zinc-950/42 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                  >
                    LoL leaderboard
                  </Link>
                  <a
                    href={facebookShareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl bg-zinc-950/42 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                  >
                    Share Facebook
                  </a>
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2">
              <div className="flex justify-start xl:justify-end">
                <ProfileRefreshButton gameName={canonicalGameName} tagLine={canonicalTagLineLower} />
              </div>
              <HeroQueueSummary
                title="Current ladder"
                primaryLabel="Solo"
                primaryLine={rankLine(solo.tier ?? null, solo.division ?? null, solo.lp ?? null)}
                primaryTier={solo.tier ?? null}
                primaryRank={ladder.solo}
                secondaryLabel="Flex"
                secondaryLine={rankLine(flex.tier ?? null, flex.division ?? null, flex.lp ?? null)}
                secondaryTier={flex.tier ?? null}
                secondaryRank={ladder.flex}
              />
              <MainChampionCard
                name={signatureChampionName}
                icon={signatureChampionIcon}
                detail={signatureChampion?.reason ?? null}
                masteryPath={masteryPath}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <RankCard
              title="Ranked Solo"
              tier={solo.tier ?? null}
              division={solo.division ?? null}
              lp={solo.lp ?? null}
              wins={solo.wins ?? null}
              losses={solo.losses ?? null}
              peak={soloPeak}
              recent={soloRecent}
              champNames={champNames}
            />
            <RankCard
              title="Ranked Flex"
              tier={flex.tier ?? null}
              division={flex.division ?? null}
              lp={flex.lp ?? null}
              wins={flex.wins ?? null}
              losses={flex.losses ?? null}
              peak={flexPeak}
              recent={flexRecent}
              champNames={champNames}
            />
            <ProfileCommentsSection
              gameName={canonicalGameName}
              tagLine={canonicalTagLineLower}
              profilePath={canonicalPath}
              initialComments={initialComments}
              viewer={
                viewer
                  ? {
                      discordUsername: viewer.discordUsername,
                      gameName: viewer.gameName,
                      tagLine: viewer.tagLine,
                      isProfileOwner: viewer.playerId === String(player._id),
                    }
                  : null
              }
            />
          </aside>

          <div className="space-y-4">
            <section className="rounded-[22px] bg-zinc-900/18 p-4 ring-1 ring-white/5 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Champion pool
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">
                    Main champions
                  </div>
                  <div className="mt-2 text-sm text-zinc-400">
                    Stored from your latest mastery sync and used on the leaderboard too.
                  </div>
                </div>
                <Link
                  href={masteryPath}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-white/5"
                >
                  View all mastery
                </Link>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {Array.isArray(player.mains) && player.mains.length ? (
                  player.mains.slice(0, 3).map((main, index) => {
                    const championId = typeof main?.championId === "number" ? main.championId : null;
                    const championName = championId != null ? champNames[String(championId)] : null;
                    const points = typeof main?.championPoints === "number" ? main.championPoints : null;
                    const icon = champIconUrl(championId);

                    return (
                      <div
                        key={`${championId ?? "unknown"}-${index}`}
                        className="rounded-[16px] bg-zinc-950/36 p-3"
                        title={
                          championName
                            ? `${championName} (#${championId})`
                            : championId != null
                              ? `Champion #${championId}`
                              : "Champion"
                        }
                      >
                        <div className="flex items-center gap-3">
                          {icon ? (
                            <img
                              src={icon}
                              alt={championName ?? "Champion"}
                              className="h-9 w-9 rounded-lg"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-lg bg-zinc-900/40" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-100">
                              {championName ?? (championId != null ? `#${championId}` : "--")}
                            </div>
                            <div className="mt-1 text-sm tabular-nums text-zinc-400">
                              {formatNumber(points) ?? "--"} pts
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-3xl bg-zinc-950/40 p-5 text-sm text-zinc-500 ring-1 ring-white/5 md:col-span-3">
                    No mastery data yet.
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Recent games
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">
                    Match history
                  </div>
                </div>
              </div>
              <MatchHistory
                gameName={canonicalGameName}
                tagLine={canonicalTagLineLower}
                ddragonVersion={ddVer}
                initialMatches={initialMatches}
                initialCursor={initialCursor}
                renderedAtMs={renderedAtMs}
                profileSoloRank={{
                  tier: solo.tier ?? null,
                  division: solo.division ?? null,
                  lp: solo.lp ?? null,
                }}
                profileFlexRank={{
                  tier: flex.tier ?? null,
                  division: flex.division ?? null,
                  lp: flex.lp ?? null,
                }}
              />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function winrate(wins: number | null, losses: number | null) {
  if (wins == null || losses == null) return null;
  const total = wins + losses;
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={"inline-flex items-center rounded-full border px-2.5 py-1 text-xs tabular-nums " + className}>
      {children}
    </span>
  );
}

function StatTile({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-[104px] rounded-xl bg-zinc-900/18 px-3 py-2" title={title}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm text-zinc-200">{value}</div>
    </div>
  );
}

function MetaInfoButton({
  lastUpdated,
  masteryUpdated,
}: {
  lastUpdated: string | null;
  masteryUpdated: string | null;
}) {
  return (
    <details className="group relative">
      <summary
        aria-label="Show private sync info"
        className="flex h-9 w-9 list-none items-center justify-center rounded-full bg-zinc-900/22 text-sm font-semibold text-zinc-300 ring-1 ring-white/5 transition hover:bg-white/5"
      >
        i
      </summary>
      <div className="absolute left-0 top-[calc(100%+10px)] z-20 w-[220px] rounded-2xl bg-zinc-950/96 p-3 text-sm text-zinc-300 shadow-[0_18px_50px_rgba(0,0,0,0.35)] ring-1 ring-white/8 sm:left-auto sm:right-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Private sync info</div>
        <div className="mt-2 space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Profile</div>
            <div className="mt-1 text-sm text-zinc-100">{lastUpdated ?? "--"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Mastery</div>
            <div className="mt-1 text-sm text-zinc-100">{masteryUpdated ?? "Not synced yet"}</div>
          </div>
        </div>
      </div>
    </details>
  );
}

function HeroQueueSummary({
  title,
  primaryLabel,
  primaryLine,
  primaryTier,
  primaryRank,
  secondaryLabel,
  secondaryLine,
  secondaryTier,
  secondaryRank,
}: {
  title: string;
  primaryLabel: string;
  primaryLine: string;
  primaryTier: string | null;
  primaryRank: number | null;
  secondaryLabel: string;
  secondaryLine: string;
  secondaryTier: string | null;
  secondaryRank: number | null;
}) {
  return (
    <div className="rounded-[18px] bg-zinc-900/20 p-2.5 ring-1 ring-white/5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{title}</div>

      <div className="mt-2 space-y-1.5">
        <HeroQueueSummaryRow label={primaryLabel} line={primaryLine} tier={primaryTier} rank={primaryRank} />
        <HeroQueueSummaryRow label={secondaryLabel} line={secondaryLine} tier={secondaryTier} rank={secondaryRank} />
      </div>
    </div>
  );
}

function HeroQueueSummaryRow({
  label,
  line,
  tier,
  rank,
}: {
  label: string;
  line: string;
  tier: string | null;
  rank: number | null;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-zinc-950/34 px-2.5 py-2">
      <RankEmblem tier={tier} className="h-7 w-7 shrink-0" alt="" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          <span>{label}</span>
          {rank != null ? <span className="tracking-normal text-zinc-300">#{rank}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-xs font-medium text-zinc-100">{line}</div>
      </div>
    </div>
  );
}

function MainChampionCard({
  name,
  icon,
  detail,
  masteryPath,
}: {
  name: string | null;
  icon: string | null;
  detail: string | null;
  masteryPath: string;
}) {
  if (!name && !icon) return null;

  return (
    <Link href={masteryPath} className="flex items-center gap-3 rounded-[18px] bg-zinc-900/20 p-2.5 ring-1 ring-white/5 transition hover:bg-white/5">
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt={name ?? "Main champion"} className="h-10 w-10 rounded-xl" loading="lazy" />
      ) : (
        <div className="h-10 w-10 rounded-xl bg-zinc-950/40" />
      )}
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Signature pick</div>
        <div className="mt-0.5 truncate text-sm font-semibold text-zinc-100">{name ?? "--"}</div>
        <div className="mt-0.5 truncate text-xs tabular-nums text-zinc-500">{detail ?? "Recent performance pick"}</div>
      </div>
    </Link>
  );
}

function RankCard({
  title,
  tier,
  division,
  lp,
  wins,
  losses,
  peak,
  recent,
  champNames,
}: {
  title: string;
  tier: string | null;
  division: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  peak: PeakRankLike | null;
  recent: RecentQueueSummary | null;
  champNames: Record<string, string>;
}) {
  const wr = winrate(wins, losses);
  const wl = wins != null && losses != null ? `${wins}-${losses}` : "--";
  const currentLine = rankLine(tier, division, lp);
  const peakLine = peak ? rankLine(peak.tier ?? null, peak.division ?? null, peak.lp ?? null) : null;
  const peakSeen = peakSeenLabel(peak);
  const peakTitle = peakLine
    ? `Peak rank: ${peakLine}${peakSeen ? `, recorded ${peakSeen}` : ""}`
    : "Peak rank: not enough history yet";

  return (
    <div className="overflow-hidden rounded-[20px] bg-zinc-900/18 p-4 ring-1 ring-white/5" title={peakTitle}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{title}</div>

      <div className="mt-3 flex items-start gap-3">
        <div className="rounded-[18px] bg-zinc-950/40 p-2 ring-1 ring-white/5">
          <RankEmblem
            tier={tier}
            className="h-12 w-12 shrink-0"
            alt={tier ? `${tier} emblem` : "Unranked emblem"}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold tracking-tight text-zinc-50">{currentLine}</div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-400">
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Record</span>
              <div className="mt-1 tabular-nums text-zinc-100">{wl}</div>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Win rate</span>
              <div className="mt-1 tabular-nums text-zinc-100">{wr != null ? `${wr}%` : "--"}</div>
            </div>
          </div>
        </div>
      </div>

      <RecentQueueCard summary={recent} champNames={champNames} />
    </div>
  );
}

function RecentQueueCard({
  summary,
  champNames,
}: {
  summary: RecentQueueSummary | null;
  champNames: Record<string, string>;
}) {
  if (!summary) {
    return (
      <div className="mt-3 rounded-[16px] bg-zinc-950/24 px-3 py-2 text-xs text-zinc-500">
        No recent ranked games stored yet.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-[16px] bg-zinc-950/24 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Last {summary.games}</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-50">
            {summary.winrate != null ? `${summary.winrate}% WR` : "--"}
          </div>
          <div className="mt-0.5 text-xs tabular-nums text-zinc-500">
            {summary.wins}-{summary.games - summary.wins} / {summary.avgKda != null ? `${summary.avgKda.toFixed(2)} KDA` : "--"}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {summary.champions.map((champion) => {
            const name = champNames[String(champion.championId)] ?? `Champion ${champion.championId}`;
            const icon = champIconUrl(champion.championId);
            return (
              <span
                key={champion.championId}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950/55"
                title={`${name}: ${champion.games} games${champion.winrate != null ? `, ${champion.winrate}% WR` : ""}`}
              >
                {icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={icon} alt={name} className="h-8 w-8 rounded-lg" loading="lazy" />
                ) : null}
                <span className="absolute -bottom-1 -right-1 rounded bg-zinc-950/95 px-1 text-[8px] leading-3 text-zinc-300">
                  {champion.games}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <div className="flex w-full flex-wrap gap-1">
          {summary.results.map((result, index) => {
            const label = result.win === true ? "W" : result.win === false ? "L" : "-";
            const championName = result.championId != null ? champNames[String(result.championId)] ?? `Champion ${result.championId}` : "Unknown champion";
            return (
              <span
                key={`${result.matchId}-${index}`}
                className={
                  "inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold tabular-nums " +
                  (result.win === true
                    ? "bg-emerald-400/16 text-emerald-100 ring-1 ring-emerald-300/20"
                    : result.win === false
                      ? "bg-rose-400/14 text-rose-100 ring-1 ring-rose-300/18"
                      : "bg-zinc-900/60 text-zinc-500 ring-1 ring-white/5")
                }
                title={`${label} vs ${championName}`}
              >
                {label}
              </span>
            );
          })}
        </div>

        {summary.mainRoles.map((role) => (
          <span
            key={role.role}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900/46 px-2 py-1 text-[11px] tabular-nums text-zinc-300"
            title={`${roleLabel(role.role)}: ${role.games} games${role.winrate != null ? `, ${role.winrate}% WR` : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={roleIconUrl(role.role)} alt={roleLabel(role.role)} className="h-4 w-4" loading="lazy" />
            {role.games}
          </span>
        ))}

        {summary.badges.map((badge) => (
          <span
            key={`${badge.kind}-${badge.label}`}
            className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] leading-none ${matchPerformanceToneClass(badge.tone)} ${
              badge.kind === "score" || badge.kind === "verdict" ? "font-semibold" : ""
            }`}
            title={badge.title}
          >
            {badge.label}
          </span>
        ))}
      </div>
    </div>
  );
}
