// src/lib/refresh.ts
import type { HydratedDocument, Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Player, type PlayerDoc, type RankSnapshot } from "@/models/player";
import { RankEntry, RANK_QUEUES, type RankQueue } from "@/models/rankEntry";
import { PlayerMastery } from "@/models/playerMastery";
import { Match } from "@/models/match";
import { PlayerMatch } from "@/models/playerMatch";
import { TftMatch } from "@/models/tftMatch";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";
import { DiscordLink } from "@/models/discordLink";
import {
  getAccountByPuuid,
  findSeaPlatformByPuuid,
  getLeagueEntriesByPuuid,
  getPuuidByRiotId,
  getSummonerByPuuid,
  getChampionMasteriesByPuuid,
  getMatchIdsByPuuid,
  getMatchById,
  getTftMatchIdsByPuuid,
  getTftMatchById,
  findTftLeagueEntriesByPuuid,
  hasTftApiKey,
  hasSeparateTftApiKey,
  platformToMatchRegion,
  isRiot404,
  isRiot429,
  isRiotDecryptingBadRequest,
  type RiotAccount,
  type Summoner,
} from "@/lib/riot";
import { normalizeRiotIdPart, syncCanonicalRiotId } from "@/lib/playerIdentity";
import { mergePlayers } from "@/lib/playerMerge";
import {
  canMergeRiotIdentities,
  hasStoredRiotIdentity,
  isTftRetryBackoffActive,
} from "@/lib/riotIdentityPolicy.mjs";
import { approvedCommunityLeaderboardQuery } from "@/lib/communityLeaderboard";
import {
  PLAYER_MATCH_RETENTION_LIMIT,
  prunePlayerMatches,
  pruneTftPlayerMatches,
} from "@/lib/matchRetention";
import {
  latestLolRankFetchAt,
  markPlayerRankRefreshCompleted,
  markPlayerRankRefreshFailed,
  markPlayerRankRefreshSchedulerFailed,
  markPlayerRankRefreshStarted,
  markPlayerRankRefreshSucceeded,
} from "@/lib/rankRefresh";

const SOLO = "RANKED_SOLO_5x5";
const FLEX = "RANKED_FLEX_SR";
const TFT = "RANKED_TFT";

type PlayerDocument = HydratedDocument<PlayerDoc>;
type RankComparable = Pick<RankSnapshot, "tier" | "division" | "lp" | "wins" | "losses">;
class RiotIdentityConflictError extends Error {}

export type RefreshPlayerResult = PlayerDoc & {
  _id: Types.ObjectId;
  _skipped?: boolean;
  _cooldownSecondsLeft?: number;
  _nextRefreshAt?: string;
};

type LolMatchParticipant = {
  puuid?: string;
  championId?: number;
  teamId?: number;
  teamPosition?: string;
  win?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  largestMultiKill?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  largestKillingSpree?: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  goldEarned?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  perks?: {
    styles?: Array<{
      style?: number;
      selections?: Array<{ perk?: number }>;
    }>;
  };
};

type LolMatchPayload = {
  info?: {
    queueId?: number;
    gameCreation?: number;
    gameDuration?: number;
    participants?: LolMatchParticipant[];
  };
};

type TftRawUnit = {
  character_id?: unknown;
  name?: unknown;
  rarity?: unknown;
  tier?: unknown;
  itemNames?: unknown;
};

type TftRawTrait = {
  name?: unknown;
  num_units?: unknown;
  style?: unknown;
  tier_current?: unknown;
  tier_total?: unknown;
};

type TftRawParticipant = {
  puuid?: string;
  placement?: unknown;
  level?: unknown;
  last_round?: unknown;
  players_eliminated?: unknown;
  total_damage_to_players?: unknown;
  gold_left?: unknown;
  time_eliminated?: unknown;
  companion?: { content_ID?: unknown };
  augments?: unknown;
  traits?: TftRawTrait[];
  units?: TftRawUnit[];
};

type TftMatchPayload = {
  info?: {
    queue_id?: unknown;
    game_datetime?: unknown;
    game_length?: unknown;
    tft_set_number?: unknown;
    participants?: TftRawParticipant[];
  };
};

function asLolMatchPayload(value: unknown): LolMatchPayload {
  return value && typeof value === "object" ? (value as LolMatchPayload) : {};
}

function asTftMatchPayload(value: unknown): TftMatchPayload {
  return value && typeof value === "object" ? (value as TftMatchPayload) : {};
}

function subdocumentValue<T extends object>(value: T | null | undefined): T {
  if (!value) return {} as T;
  const subdocument = value as T & { toObject?: () => T };
  return typeof subdocument.toObject === "function" ? subdocument.toObject() : value;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = index++;
      out[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return out;
}

function errToString(e: unknown) {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isRateLimit(e: unknown) {
  const status = (e as { status?: unknown } | null)?.status;
  return isRiot429(e) || status === 429;
}

function rateLimitWaitMs(e: unknown, fallbackMs = 2000) {
  const ra = (e as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof ra === "number" && ra > 0 ? ra : fallbackMs;
}

function classifyTftFailure(e: unknown) {
  const status = (e as { status?: unknown } | null)?.status;
  if (
    e instanceof RiotIdentityConflictError ||
    isRiot404(e) ||
    isRiotDecryptingBadRequest(e)
  ) {
    return { code: "stale_identity", retryMs: 6 * 60 * 60 * 1000 };
  }
  if (status === 401 || status === 403) {
    return { code: "auth_invalid", retryMs: 60 * 60 * 1000 };
  }
  if (typeof status === "number" && status >= 500) {
    return { code: "riot_upstream", retryMs: 60 * 60 * 1000 };
  }
  if (e instanceof TypeError) {
    return { code: "network", retryMs: 60 * 60 * 1000 };
  }
  return { code: "unknown", retryMs: 60 * 60 * 1000 };
}

function setTftFailure(
  player: PlayerDocument,
  now: Date,
  message: string,
  e: unknown,
  stage: "identity" | "matches"
) {
  const current = subdocumentValue(player.tftMatchSync);
  const { code, retryMs } = classifyTftFailure(e);
  const failures = Math.max(0, Number(current.consecutiveFailures ?? 0) || 0);
  player.tftMatchSync = {
    ...current,
    lastAttemptAt: now,
    retryAfterAt: new Date(now.getTime() + retryMs),
    lastError: message,
    lastErrorCode: code,
    lastErrorStage: stage,
    consecutiveFailures: failures + 1,
  };
}

function clearTftFailure(player: PlayerDocument) {
  const current = subdocumentValue(player.tftMatchSync);
  player.tftMatchSync = {
    ...current,
    retryAfterAt: undefined,
    lastError: undefined,
    lastErrorCode: undefined,
    lastErrorStage: undefined,
    consecutiveFailures: 0,
  };
}

function normalize(s: string) {
  return s.trim().toLowerCase();
}

const COOLDOWN_MS = 2 * 60 * 1000;

// ✅ Riot matchlist supports up to 100 per request
const MAX_MATCH_SYNC_COUNT = 100;
const MATCH_SYNC_CONCURRENCY = 1;

function lastSuccessfulRefreshAt(
  p: PlayerDoc,
  opts?: {
    syncLolProfile?: boolean;
    syncTftMatches?: boolean;
  }
): Date | null {
  const candidates: Date[] = [];
  if (opts?.syncLolProfile !== false) {
    const rankFetchedAt = latestLolRankFetchAt(p);
    if (rankFetchedAt) candidates.push(rankFetchedAt);
  }
  if (opts?.syncTftMatches === true && p.tft?.fetchedAt instanceof Date) {
    candidates.push(new Date(p.tft.fetchedAt));
  }
  if (
    candidates.length === 0 &&
    opts?.syncLolProfile === false &&
    opts?.syncTftMatches !== true &&
    p.lastRefreshAt instanceof Date
  ) {
    candidates.push(new Date(p.lastRefreshAt));
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return candidates[0];
}

function changedRank(a: RankComparable | null, b: RankComparable) {
  if (!a) return true;
  return (
    (a.tier ?? null) !== (b.tier ?? null) ||
    (a.division ?? null) !== (b.division ?? null) ||
    (a.lp ?? null) !== (b.lp ?? null) ||
    (a.wins ?? null) !== (b.wins ?? null) ||
    (a.losses ?? null) !== (b.losses ?? null)
  );
}

async function insertRankIfChanged(input: {
  playerId: Types.ObjectId;
  queue: string;
  tier?: string;
  division?: string;
  lp?: number;
  wins?: number;
  losses?: number;
  fetchedAt: Date;
}) {
  if (!(RANK_QUEUES as readonly string[]).includes(input.queue)) return;
  const queue = input.queue as RankQueue;

  const prev = await RankEntry.findOne({ playerId: input.playerId, queue })
    .sort({ fetchedAt: -1 })
    .lean();

  if (changedRank(prev, input)) {
    await RankEntry.create({ ...input, queue });
  }
}

function extractPlayerMatchSummary(match: LolMatchPayload, puuid: string) {
  const info = match?.info ?? {};
  const participants: LolMatchParticipant[] = Array.isArray(info.participants) ? info.participants : [];
  const me = participants.find((p) => String(p?.puuid ?? "").toLowerCase() === puuid.toLowerCase());

  const items = me
    ? [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6]
      .map((x) => (typeof x === "number" ? x : 0))
      .filter((x) => x !== 0)
    : [];

  const summonerSpells = me
    ? [me.summoner1Id, me.summoner2Id].filter((x): x is number => typeof x === "number")
    : [];

  const cs =
    me && (typeof me.totalMinionsKilled === "number" || typeof me.neutralMinionsKilled === "number")
      ? (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0)
      : undefined;

  return {
    queueId: typeof info.queueId === "number" ? info.queueId : undefined,
    gameCreation: typeof info.gameCreation === "number" ? info.gameCreation : undefined,
    gameDuration: typeof info.gameDuration === "number" ? info.gameDuration : undefined,

    championId: typeof me?.championId === "number" ? me.championId : undefined,
    teamId: typeof me?.teamId === "number" ? me.teamId : undefined,

    teamPosition: typeof me?.teamPosition === "string" ? me.teamPosition : undefined, // ✅ ADD

    win: typeof me?.win === "boolean" ? me.win : undefined,

    kills: typeof me?.kills === "number" ? me.kills : undefined,
    deaths: typeof me?.deaths === "number" ? me.deaths : undefined,
    assists: typeof me?.assists === "number" ? me.assists : undefined,
    largestMultiKill: typeof me?.largestMultiKill === "number" ? me.largestMultiKill : undefined,
    doubleKills: typeof me?.doubleKills === "number" ? me.doubleKills : undefined,
    tripleKills: typeof me?.tripleKills === "number" ? me.tripleKills : undefined,
    quadraKills: typeof me?.quadraKills === "number" ? me.quadraKills : undefined,
    pentaKills: typeof me?.pentaKills === "number" ? me.pentaKills : undefined,
    largestKillingSpree: typeof me?.largestKillingSpree === "number" ? me.largestKillingSpree : undefined,

    cs,
    gold: typeof me?.goldEarned === "number" ? me.goldEarned : undefined,

    items,
    summonerSpells,

    primaryStyle: typeof me?.perks?.styles?.[0]?.style === "number" ? me.perks.styles[0].style : undefined,
    primaryRune:
      typeof me?.perks?.styles?.[0]?.selections?.[0]?.perk === "number"
        ? me.perks.styles[0].selections[0].perk
        : undefined,
    subStyle: typeof me?.perks?.styles?.[1]?.style === "number" ? me.perks.styles[1].style : undefined,
  };
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function simplifyTftUnit(unit: TftRawUnit) {
  return {
    characterId: safeString(unit?.character_id),
    name: safeString(unit?.name),
    rarity: safeNumber(unit?.rarity),
    tier: safeNumber(unit?.tier),
    itemNames: Array.isArray(unit?.itemNames)
      ? unit.itemNames.filter((item: unknown): item is string => typeof item === "string")
      : [],
  };
}

function simplifyTftTrait(trait: TftRawTrait) {
  return {
    name: safeString(trait?.name),
    numUnits: safeNumber(trait?.num_units),
    style: safeNumber(trait?.style),
    tierCurrent: safeNumber(trait?.tier_current),
    tierTotal: safeNumber(trait?.tier_total),
  };
}

function extractTftPlayerMatchSummary(match: TftMatchPayload, puuid: string) {
  const info = match?.info ?? {};
  const participants: TftRawParticipant[] = Array.isArray(info.participants) ? info.participants : [];
  const me = participants.find((p) => String(p?.puuid ?? "").toLowerCase() === puuid.toLowerCase());
  if (!me) return null;

  return {
    queueId: safeNumber(info.queue_id),
    gameDatetime: safeNumber(info.game_datetime),
    gameLength: safeNumber(info.game_length),
    setNumber: safeNumber(info.tft_set_number),
    placement: safeNumber(me.placement),
    level: safeNumber(me.level),
    lastRound: safeNumber(me.last_round),
    playersEliminated: safeNumber(me.players_eliminated),
    totalDamageToPlayers: safeNumber(me.total_damage_to_players),
    goldLeft: safeNumber(me.gold_left),
    timeEliminated: safeNumber(me.time_eliminated),
    companionContentId: safeString(me.companion?.content_ID),
    augments: Array.isArray(me.augments)
      ? me.augments.filter((augment: unknown): augment is string => typeof augment === "string")
      : [],
    traits: Array.isArray(me.traits) ? me.traits.map(simplifyTftTrait) : [],
    units: Array.isArray(me.units) ? me.units.map(simplifyTftUnit) : [],
  };
}

async function syncFullMastery(player: PlayerDocument, platform: string, puuid: string, now: Date) {
  const all = await getChampionMasteriesByPuuid(platform, puuid);
  if (!Array.isArray(all) || all.length === 0) return;

  // ✅ FIX: include playerId/championId on insert so upsert is guaranteed correct
  await PlayerMastery.bulkWrite(
    all.map((m) => ({
      updateOne: {
        filter: { playerId: player._id, championId: m.championId },
        update: {
          $set: {
            puuid,
            championLevel: m.championLevel,
            championPoints: m.championPoints,
            lastPlayTime: m.lastPlayTime,
            chestGranted: m.chestGranted,
            tokensEarned: m.tokensEarned,
            championPointsSinceLastLevel: m.championPointsSinceLastLevel,
            championPointsUntilNextLevel: m.championPointsUntilNextLevel,
            markRequiredForNextLevel: m.markRequiredForNextLevel,
            championSeasonMilestone: m.championSeasonMilestone,
            fetchedAt: now,
          },
          $setOnInsert: {
            playerId: player._id,
            championId: m.championId,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  // store top 3 on Player for fast leaderboard/profile header
  const top = all.slice(0, 3).map((m) => ({
    championId: m.championId,
    championPoints: m.championPoints,
    updatedAt: now,
  }));
  player.mains = top;
  player.masterySyncedAt = now;
}

async function syncMatchIdsForPlayer(params: {
  player: PlayerDocument;
  puuid: string;
  matchRegion: string;
  ids: string[];
  now: Date;
}) {
  const { player, puuid, matchRegion, ids, now } = params;
  if (!Array.isArray(ids) || ids.length === 0) return { requested: 0, written: 0 };

  const uniqueIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (!uniqueIds.length) return { requested: 0, written: 0 };

  const existing = await Match.find({ matchId: { $in: uniqueIds } }, { matchId: 1 }).lean();
  const have = new Set(existing.map((x) => x.matchId));
  let written = 0;

  await mapLimit(uniqueIds, MATCH_SYNC_CONCURRENCY, async (matchId) => {
    try {
      let payload: LolMatchPayload | null = null;

      if (have.has(matchId)) {
        const doc = await Match.findOne(
          { matchId },
          { raw: 1, region: 1, queueId: 1, gameCreation: 1, gameDuration: 1 }
        ).lean();

        payload = doc?.raw == null ? null : asLolMatchPayload(doc.raw);
      }

      if (!payload) {
        payload = asLolMatchPayload(await getMatchById(matchId, matchRegion));

        const info = payload?.info ?? {};
        const queueId = typeof info.queueId === "number" ? info.queueId : undefined;
        const gameCreation = typeof info.gameCreation === "number" ? info.gameCreation : undefined;
        const gameDuration = typeof info.gameDuration === "number" ? info.gameDuration : undefined;

        await Match.updateOne(
          { matchId },
          {
            $set: {
              region: matchRegion,
              queueId,
              gameCreation,
              gameDuration,
              raw: payload,
              fetchedAt: now,
            },
            $setOnInsert: { matchId },
          },
          { upsert: true }
        );
      }

      const summary = extractPlayerMatchSummary(payload, puuid);

      await PlayerMatch.updateOne(
        { playerId: player._id, matchId },
        {
          $set: {
            playerId: player._id,
            matchId,
            region: matchRegion,

            queueId: summary.queueId,
            gameCreation: summary.gameCreation,
            gameDuration: summary.gameDuration,

            championId: summary.championId,
            teamId: summary.teamId,
            teamPosition: summary.teamPosition,
            win: summary.win,

            kills: summary.kills,
            deaths: summary.deaths,
            assists: summary.assists,
            largestMultiKill: summary.largestMultiKill,
            doubleKills: summary.doubleKills,
            tripleKills: summary.tripleKills,
            quadraKills: summary.quadraKills,
            pentaKills: summary.pentaKills,
            largestKillingSpree: summary.largestKillingSpree,

            cs: summary.cs,
            gold: summary.gold,

            items: summary.items,
            summonerSpells: summary.summonerSpells,

            primaryStyle: summary.primaryStyle,
            primaryRune: summary.primaryRune,
            subStyle: summary.subStyle,

            fetchedAt: now,
          },
        },
        { upsert: true }
      );
      written++;
    } catch (e) {
      if (isRateLimit(e)) throw e;
      console.error(`LoL match sync failed for ${matchId}:`, e);
    }
  });

  await prunePlayerMatches(player._id);

  return { requested: uniqueIds.length, written };
}

async function syncRecentMatches(params: {
  player: PlayerDocument;
  puuid: string;
  matchRegion: string;
  count: number;
  backfillCount?: number;
}) {
  const { player, puuid, matchRegion, count } = params;
  const backfillCount = Math.max(0, Math.min(MAX_MATCH_SYNC_COUNT, Number(params.backfillCount ?? 0) || 0));
  const now = new Date();

  const ids = await getMatchIdsByPuuid({ puuid, matchRegion, start: 0, count });
  if (!Array.isArray(ids) || ids.length === 0) {
    player.matchSync = {
      ...(player.matchSync ?? {}),
      lastSyncAt: now,
      backfillLastSyncAt: backfillCount > 0 ? now : player.matchSync?.backfillLastSyncAt,
      backfillRequested: 0,
      backfillWritten: 0,
      backfillExhausted: backfillCount > 0 ? true : player.matchSync?.backfillExhausted,
    };
    await player.save();
    return;
  }

  const recent = await syncMatchIdsForPlayer({ player, puuid, matchRegion, ids, now });
  let backfill = { requested: 0, written: 0, start: 0 };

  if (backfillCount > 0) {
    try {
      const storedCount = await PlayerMatch.countDocuments({ playerId: player._id });
      const start = Math.max(count, storedCount);
      const remainingCapacity = Math.max(0, PLAYER_MATCH_RETENTION_LIMIT - start);
      const safeBackfillCount = Math.min(backfillCount, remainingCapacity);
      if (safeBackfillCount > 0) {
        const olderIds = await getMatchIdsByPuuid({
          puuid,
          matchRegion,
          start,
          count: safeBackfillCount,
        });
        const synced = await syncMatchIdsForPlayer({ player, puuid, matchRegion, ids: olderIds, now });
        backfill = { ...synced, start };
      } else {
        backfill = { requested: 0, written: 0, start };
      }
    } catch (e) {
      if (isRateLimit(e)) throw e;
      console.error("LoL match backfill failed:", e);
    }
  }

  player.matchSync = {
    ...(player.matchSync ?? {}),
    lastSyncAt: now,
    recentRequested: recent.requested,
    recentWritten: recent.written,
    backfillLastSyncAt: backfillCount > 0 ? now : player.matchSync?.backfillLastSyncAt,
    backfillStart: backfill.start,
    backfillRequested: backfill.requested,
    backfillWritten: backfill.written,
    backfillExhausted: backfillCount > 0 ? backfill.requested === 0 : player.matchSync?.backfillExhausted,
  };
  await player.save();
}

async function syncRecentTftMatches(params: {
  player: PlayerDocument;
  puuid: string;
  matchRegion: string;
  count: number;
}) {
  const { player, puuid, matchRegion, count } = params;
  const now = new Date();

  const ids = await getTftMatchIdsByPuuid({ puuid, matchRegion, start: 0, count });
  if (!Array.isArray(ids) || ids.length === 0) {
    player.tftMatchSync = {
      ...subdocumentValue(player.tftMatchSync),
      lastSyncAt: now,
      lastAttemptAt: now,
      retryAfterAt: undefined,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorStage: undefined,
      consecutiveFailures: 0,
    };
    await player.save();
    return;
  }

  const existing = await TftMatch.find({ matchId: { $in: ids } }, { matchId: 1 }).lean();
  const have = new Set(existing.map((x) => x.matchId));
  let failedFetches = 0;
  let writtenSummaries = 0;

  await mapLimit(ids, MATCH_SYNC_CONCURRENCY, async (matchId) => {
    try {
      let payload: TftMatchPayload | null = null;

      if (have.has(matchId)) {
        const doc = await TftMatch.findOne(
          { matchId },
          { raw: 1, region: 1, queueId: 1, gameDatetime: 1, gameLength: 1 }
        ).lean();
        payload = doc?.raw == null ? null : asTftMatchPayload(doc.raw);
      }

      if (!payload) {
        payload = asTftMatchPayload(await getTftMatchById(matchId, matchRegion));
        const info = payload?.info ?? {};

        await TftMatch.updateOne(
          { matchId },
          {
            $set: {
              region: matchRegion,
              queueId: safeNumber(info.queue_id),
              gameDatetime: safeNumber(info.game_datetime),
              gameLength: safeNumber(info.game_length),
              setNumber: safeNumber(info.tft_set_number),
              raw: payload,
              fetchedAt: now,
            },
            $setOnInsert: { matchId },
          },
          { upsert: true }
        );
      }

      const summary = extractTftPlayerMatchSummary(payload, puuid);
      if (!summary) return;

      await TftPlayerMatch.updateOne(
        { playerId: player._id, matchId },
        {
          $set: {
            playerId: player._id,
            matchId,
            region: matchRegion,
            ...summary,
            fetchedAt: now,
          },
        },
        { upsert: true }
      );
      writtenSummaries++;
    } catch (e) {
      failedFetches++;
      if (isRateLimit(e)) throw e;
      console.error(`TFT match sync failed for ${matchId}:`, e);
    }
  });

  if (failedFetches >= ids.length) {
    throw new Error("TFT match sync failed for all recent matches");
  }
  if (writtenSummaries === 0) {
    throw new Error("TFT match sync found matches, but none matched this player's TFT puuid");
  }

  await pruneTftPlayerMatches(player._id);

  player.tftMatchSync = {
    ...subdocumentValue(player.tftMatchSync),
    lastSyncAt: now,
    lastAttemptAt: now,
    retryAfterAt: undefined,
    lastError: undefined,
    lastErrorCode: undefined,
    lastErrorStage: undefined,
    consecutiveFailures: 0,
  };
  await player.save();
}

export async function refreshPlayerById(
  playerId: string,
  opts?: {
    force?: boolean;
    cooldownMs?: number;
    strictCooldown?: boolean;

    syncMatches?: boolean;
    matchesCount?: number;
    matchBackfillCount?: number;

    fullMastery?: boolean;
    syncMastery?: boolean;
    syncTftMatches?: boolean;
    syncLolProfile?: boolean;
  }
): Promise<RefreshPlayerResult> {
  await dbConnect();

  let player = await Player.findById(playerId);
  if (!player) throw new Error("Player not found");
  let rankRefreshPlayerId = player._id;
  let rankRefreshRequestedAt = player.rankRefresh?.requestedAt;
  await markPlayerRankRefreshStarted(
    rankRefreshPlayerId,
    rankRefreshRequestedAt
  );

  const cooldownMs = opts?.cooldownMs ?? COOLDOWN_MS;
  let tftRetryBlocked = isTftRetryBackoffActive(
    player.tftMatchSync?.retryAfterAt,
    { force: opts?.force }
  );

  if (!opts?.force) {
    const last = lastSuccessfulRefreshAt(player, opts);
    if (last) {
      const now = Date.now();
      const age = now - last.getTime();
      const wantsTftMatchSync =
        opts?.strictCooldown !== true &&
        opts?.syncTftMatches === true &&
        hasTftApiKey() &&
        player?.tftMatchSync?.enabled !== false &&
        !tftRetryBlocked;
      const wantsLolMatchSync =
        opts?.strictCooldown !== true &&
        opts?.syncMatches === true &&
        player?.matchSync?.enabled !== false;
      let shouldBypassCooldownForLolMatches = false;
      let shouldBypassCooldownForTftMatches = false;

      if (wantsLolMatchSync) {
        const lastMatchSync = player.matchSync?.lastSyncAt
          ? new Date(player.matchSync.lastSyncAt).getTime()
          : 0;
        const hasStoredMatches = await PlayerMatch.exists({ playerId: player._id });
        shouldBypassCooldownForLolMatches =
          !hasStoredMatches ||
          !Number.isFinite(lastMatchSync) ||
          now - lastMatchSync >= cooldownMs;
      }

      if (wantsTftMatchSync) {
        const lastTftMatchSync = player.tftMatchSync?.lastSyncAt
          ? new Date(player.tftMatchSync.lastSyncAt).getTime()
          : 0;
        const hasStoredTftMatches = await TftPlayerMatch.exists({ playerId: player._id });
        shouldBypassCooldownForTftMatches =
          !hasStoredTftMatches ||
          !Number.isFinite(lastTftMatchSync) ||
          now - lastTftMatchSync >= cooldownMs;
      }

      if (age < cooldownMs) {
        const canBypassForMatchSync =
          opts?.strictCooldown !== true &&
          (shouldBypassCooldownForLolMatches || shouldBypassCooldownForTftMatches);
        if (!canBypassForMatchSync) {
          const next = new Date(last.getTime() + cooldownMs);
          await markPlayerRankRefreshCompleted(
            rankRefreshPlayerId,
            rankRefreshRequestedAt,
            last
          );
          return {
            ...player.toObject(),
            _skipped: true,
            _cooldownSecondsLeft: Math.ceil((cooldownMs - age) / 1000),
            _nextRefreshAt: next.toISOString(),
          };
        }
      }
    }
  }

  const now = new Date();

  let puuid = String(player.puuid ?? "").trim();
  let canonicalIdentityFailure: unknown = null;
  let canonicalIdentity: {
    puuid: string;
    gameName: string;
    tagLine: string;
  } | null = null;
  try {
    let account: RiotAccount;
    const anchoredByPuuid = hasStoredRiotIdentity(puuid);
    if (anchoredByPuuid) {
      // The PUUID is the durable identity. Looking up a saved Riot ID first can
      // silently rebind a profile if an old name is later reused.
      account = await getAccountByPuuid(puuid);
    } else {
      const accountFromRiotId = await getPuuidByRiotId(
        player.gameName,
        player.tagLine
      );
      const candidatePuuid = String(accountFromRiotId?.puuid ?? "").trim();
      if (!candidatePuuid) {
        throw new Error("Riot returned an empty LoL PUUID");
      }
      account =
        accountFromRiotId.gameName && accountFromRiotId.tagLine
          ? accountFromRiotId
          : await getAccountByPuuid(candidatePuuid);
    }

    const returnedPuuid = String(account?.puuid ?? "").trim();
    if (anchoredByPuuid && returnedPuuid && returnedPuuid !== puuid) {
      throw new RiotIdentityConflictError(
        "Riot returned a different durable identity for this tracked account."
      );
    }
    const canonicalPuuid = anchoredByPuuid
      ? puuid
      : returnedPuuid;
    if (!canonicalPuuid || !account?.gameName || !account?.tagLine) {
      throw new Error("Riot returned an incomplete account identity");
    }

    canonicalIdentity = {
      puuid: canonicalPuuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
    };
  } catch (e) {
    if (isRateLimit(e)) throw e;
    if (e instanceof RiotIdentityConflictError) throw e;
    if (!puuid) throw e;
    canonicalIdentityFailure = e;
    console.error("Account sync failed:", e);
  }

  if (canonicalIdentity) {
    const currentGameNameNorm = normalizeRiotIdPart(canonicalIdentity.gameName);
    const currentTagLineNorm = normalizeRiotIdPart(canonicalIdentity.tagLine);
    const identityCollision = await Player.findOne({
      _id: { $ne: player._id },
      $or: [
        {
          gameNameNorm: currentGameNameNorm,
          tagLineNorm: currentTagLineNorm,
        },
        {
          riotIdAliases: {
            $elemMatch: {
              gameNameNorm: currentGameNameNorm,
              tagLineNorm: currentTagLineNorm,
            },
          },
        },
        { puuid: canonicalIdentity.puuid },
      ],
    }).select({ _id: 1, puuid: 1 });

    if (identityCollision) {
      if (
        !canMergeRiotIdentities(
          canonicalIdentity.puuid,
          identityCollision.puuid
        )
      ) {
        throw new RiotIdentityConflictError(
          "The current Riot identity conflicts with another tracked account."
        );
      }
      const collisionOwnsCanonicalIdentity =
        String(identityCollision.puuid ?? "").trim() ===
        canonicalIdentity.puuid;
      player = collisionOwnsCanonicalIdentity
        ? await mergePlayers(
            String(identityCollision._id),
            String(player._id)
          )
        : await mergePlayers(
            String(player._id),
            String(identityCollision._id)
          );
      rankRefreshPlayerId = player._id;
      rankRefreshRequestedAt = player.rankRefresh?.requestedAt;
      tftRetryBlocked = isTftRetryBackoffActive(
        player.tftMatchSync?.retryAfterAt,
        { force: opts?.force }
      );
    }

    const identityBefore = `${player.gameName}#${player.tagLine}`;
    syncCanonicalRiotId(
      player,
      canonicalIdentity.gameName,
      canonicalIdentity.tagLine,
      now
    );
    player.puuid = canonicalIdentity.puuid;
    puuid = canonicalIdentity.puuid;
    await player.save();

    try {
      await DiscordLink.updateMany(
        {
          playerId: player._id,
          $or: [
            { gameName: { $ne: player.gameName } },
            { tagLine: { $ne: player.tagLine } },
          ],
        },
        { $set: { gameName: player.gameName, tagLine: player.tagLine } }
      );
    } catch (e) {
      console.error("Discord-linked Riot ID sync failed:", e);
    }

    if (identityBefore !== `${player.gameName}#${player.tagLine}`) {
      console.info(
        `Riot ID updated: ${identityBefore} -> ${player.gameName}#${player.tagLine}`
      );
    }
  }

  const wantsTftProfileSync =
    opts?.syncTftMatches === true &&
    hasTftApiKey();
  let tftProfileFailure: unknown = null;
  let tftPuuid = "";
  if (wantsTftProfileSync) {
    // This is the scheduler's TFT attempt timestamp, including rank-only work
    // while match history is in backoff. Keeping it current prevents one
    // broken profile from staying at the front of every batch.
    player.tftMatchSync = {
      ...subdocumentValue(player.tftMatchSync),
      lastAttemptAt: now,
    };
    await player.save();

    if (canonicalIdentityFailure) {
      tftProfileFailure = canonicalIdentityFailure;
      setTftFailure(
        player,
        now,
        canonicalIdentityFailure instanceof RiotIdentityConflictError
          ? canonicalIdentityFailure.message
          : `Could not verify the current Riot identity for ${player.gameName}#${player.tagLine}.`,
        canonicalIdentityFailure,
        "identity"
      );
      await player.save();
    } else if (hasSeparateTftApiKey()) {
      try {
        // Riot can encrypt PUUIDs differently for different API-key scopes.
        // Resolve the TFT identity from the current canonical Riot ID instead
        // of reusing the LoL-scoped PUUID saved on the player.
        const tftAccount = await getPuuidByRiotId(
          player.gameName,
          player.tagLine,
          "tft"
        );
        tftPuuid = String(tftAccount?.puuid ?? "").trim();
        if (!tftPuuid) {
          throw new Error("Riot returned an empty TFT PUUID");
        }
        const tftIdentityChanged =
          String(player.tftPuuid ?? "").trim() !== tftPuuid;
        player.tftPuuid = tftPuuid;
        const recoveredIdentity =
          player.tftMatchSync?.lastErrorStage === "identity";
        if (recoveredIdentity) {
          clearTftFailure(player);
          tftRetryBlocked = false;
        }
        if (tftIdentityChanged || recoveredIdentity) {
          await player.save();
        }
      } catch (e) {
        if (isRateLimit(e)) throw e;
        tftProfileFailure = e;
        // A saved value may predate separate TFT-key support and may simply be
        // a copied LoL PUUID, so do not send it to TFT endpoints as a fallback.
        if (String(player.tftPuuid ?? "").trim() === puuid) {
          player.tftPuuid = undefined;
        }
        setTftFailure(
          player,
          now,
          `Could not resolve the TFT identity for ${player.gameName}#${player.tagLine}.`,
          e,
          "identity"
        );
        await player.save();
        console.error(
          `TFT identity sync failed for ${player.gameName}#${player.tagLine}:`,
          e
        );
      }
    } else {
      // With no dedicated TFT key (or the same key for both products), Riot's
      // PUUID scope is shared and the historical behavior remains valid.
      tftPuuid = puuid;
      player.tftPuuid = puuid;
      if (player.tftMatchSync?.lastErrorStage === "identity") {
        clearTftFailure(player);
        tftRetryBlocked = false;
        await player.save();
      }
    }
  }

  let platform = String(player.platform || "auto").toLowerCase().trim();
  let summoner: Summoner;

  try {
    if (platform !== "auto") {
      summoner = await getSummonerByPuuid(platform, puuid);
    } else {
      const found = await findSeaPlatformByPuuid(puuid);
      platform = found.platform;
      summoner = found.summoner;
      player.platform = platform;
      await player.save();
    }
  } catch (e) {
    if (platform !== "auto" && isRiot404(e)) {
      const found = await findSeaPlatformByPuuid(puuid);
      platform = found.platform;
      summoner = found.summoner;
      player.platform = platform;
      await player.save();
    } else {
      throw e;
    }
  }

  player.summonerId = summoner.id;
  player.profileIconId = summoner.profileIconId;
  player.summonerName = summoner.name;
  player.summonerLevel = summoner.summonerLevel;
  player.revisionDate = summoner.revisionDate;

  const matchRegion = player.matchRegion ?? platformToMatchRegion(platform);
  player.matchRegion = matchRegion;

  const syncLolProfile = opts?.syncLolProfile !== false;
  const entries = syncLolProfile ? await getLeagueEntriesByPuuid(platform, puuid) : [];
  if (syncLolProfile) {
    const solo = entries.find((e) => e.queueType === SOLO);
    const flex = entries.find((e) => e.queueType === FLEX);

    player.solo = solo
      ? { tier: solo.tier, division: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses, fetchedAt: now }
      : { fetchedAt: now };

    player.flex = flex
      ? { tier: flex.tier, division: flex.rank, lp: flex.leaguePoints, wins: flex.wins, losses: flex.losses, fetchedAt: now }
      : { fetchedAt: now };
  }

  if (wantsTftProfileSync && tftPuuid) {
    try {
      const foundTftLeague = await findTftLeagueEntriesByPuuid(tftPuuid, platform);
      const { entries: tftEntries } = foundTftLeague;
      const tft = tftEntries.find((entry) => entry.queueType === TFT);

      player.tft = tft
        ? {
            tier: tft.tier,
            division: tft.rank,
            lp: tft.leaguePoints,
            wins: tft.wins,
            losses: tft.losses,
            fetchedAt: now,
          }
        : { fetchedAt: now };

      if (tft) {
        await insertRankIfChanged({
          playerId: player._id,
          queue: TFT,
          tier: tft.tier,
          division: tft.rank,
          lp: tft.leaguePoints,
          wins: tft.wins,
          losses: tft.losses,
          fetchedAt: now,
        });
      }
    } catch (e) {
      if (isRateLimit(e)) throw e;
      tftProfileFailure = e;
      console.error("TFT rank sync failed:", e);
      // Do not wipe a previously saved TFT rank just because Riot rejected one
      // lookup. A valid unranked account returns HTTP 200 with an empty array;
      // lookup failures must not masquerade as that successful result.
    }
  }

  // ✅ FIX: don’t silently swallow mastery write errors anymore
  if (syncLolProfile && opts?.syncMastery !== false) {
    try {
      if (opts?.fullMastery) {
        await syncFullMastery(player, platform, puuid, now);
      } else {
        const top = await getChampionMasteriesByPuuid(platform, puuid);
        if (Array.isArray(top)) {
          const mains = top.slice(0, 3).map((m) => ({
            championId: m.championId,
            championPoints: m.championPoints,
            updatedAt: now,
          }));
          player.mains = mains;
          player.masterySyncedAt = now;
        }
      }
    } catch (e) {
      if (isRateLimit(e)) throw e;
      console.error("Mastery sync failed:", e);
    }
  }

  player.lastRefreshAt = now;
  await player.save();
  if (syncLolProfile) {
    await markPlayerRankRefreshSucceeded(player._id, now);
  }

  for (const e of entries) {
    await insertRankIfChanged({
      playerId: player._id,
      queue: e.queueType,
      tier: e.tier,
      division: e.rank,
      lp: e.leaguePoints,
      wins: e.wins,
      losses: e.losses,
      fetchedAt: now,
    });
  }
  if (syncLolProfile) {
    await markPlayerRankRefreshCompleted(
      rankRefreshPlayerId,
      rankRefreshRequestedAt,
      now
    );
  }

  const syncMatches = opts?.syncMatches === true && player?.matchSync?.enabled !== false;
  if (syncMatches) {
    await syncRecentMatches({
      player,
      puuid,
      matchRegion,
      count: Math.max(1, Math.min(MAX_MATCH_SYNC_COUNT, Number(opts?.matchesCount ?? 10) || 10)),
      backfillCount: Math.max(0, Math.min(MAX_MATCH_SYNC_COUNT, Number(opts?.matchBackfillCount ?? 0) || 0)),
    });
  }

  const syncTftMatches =
    wantsTftProfileSync &&
    !tftRetryBlocked &&
    player?.tftMatchSync?.enabled !== false;
  if (syncTftMatches) {
    if (tftPuuid) {
      try {
        await syncRecentTftMatches({
          player,
          puuid: tftPuuid,
          matchRegion,
          count: Math.max(1, Math.min(MAX_MATCH_SYNC_COUNT, Number(opts?.matchesCount ?? 10) || 10)),
        });
      } catch (e) {
        if (isRateLimit(e)) throw e;
        const expectedIdentityFailure =
          isRiotDecryptingBadRequest(e) || isRiot404(e);
        if (expectedIdentityFailure) {
          console.warn(
            "TFT match sync skipped because Riot rejected this TFT puuid:",
            errToString(e)
          );
        } else {
          console.error("TFT match sync failed:", e);
        }
        setTftFailure(
          player,
          now,
          expectedIdentityFailure
            ? "Riot could not return TFT match history for this account yet."
            : "TFT match refresh failed; it will retry after a cooldown.",
          e,
          "matches"
        );
        await player.save();
        if (!expectedIdentityFailure) throw e;
      }
    }
  }

  if (tftProfileFailure) throw tftProfileFailure;

  return player.toObject();
}

export async function refreshAllPlayers(opts?: {
  limit?: number;

  leaderboardOnly?: boolean;
  leaderboardGroup?: string;
  leaderboardStatus?: "approved" | "pending" | "rejected";

  delayMs?: number;
  force?: boolean;
  cooldownMs?: number;
  syncMatches?: boolean;
  syncTftMatches?: boolean;
  syncLolProfile?: boolean;
  syncMastery?: boolean;
  includeRequestedRanks?: boolean;
  matchesCount?: number;
  matchBackfillCount?: number;
}) {
  await dbConnect();

  const limit = opts?.limit ?? 20;
  const delayMs = opts?.delayMs ?? 1100;

  const q: Record<string, unknown> = {};
  if (opts?.leaderboardOnly) {
    Object.assign(q, {
      ...approvedCommunityLeaderboardQuery(
        opts?.leaderboardGroup ?? "burmese"
      ),
      "leaderboard.status": opts?.leaderboardStatus ?? "approved",
    });
  }
  if (opts?.syncLolProfile !== false) {
    q["track.lol"] = { $ne: false };
    q.$nor = [
      { "rankRefresh.retryAfterAt": { $gt: new Date() } },
    ];
  } else if (opts?.syncTftMatches === true) {
    q["track.tft"] = { $ne: false };
  }

  const playerSort: [string, 1 | -1][] =
    opts?.syncLolProfile !== false
      ? [
          ["solo.fetchedAt", 1],
          ["flex.fetchedAt", 1],
          ...(opts?.syncMatches === true &&
          Number(opts?.matchBackfillCount ?? 0) > 0
            ? ([["matchSync.backfillLastSyncAt", 1]] as [string, 1][])
            : []),
          ...(opts?.syncMatches === true
            ? ([["matchSync.lastSyncAt", 1]] as [string, 1][])
            : []),
          ["updatedAt", 1],
        ]
      : opts?.syncTftMatches === true
        ? [
            ["tftMatchSync.lastAttemptAt", 1],
            ["tft.fetchedAt", 1],
            ["updatedAt", 1],
          ]
        : [["updatedAt", 1]];

  const playerProjection = {
    _id: 1,
    gameName: 1,
    tagLine: 1,
    lastRefreshAt: 1,
    solo: 1,
    flex: 1,
    rankRefresh: 1,
    matchSync: 1,
    tftMatchSync: 1,
  } as const;

  let players;
  if (
    opts?.leaderboardOnly &&
    opts?.includeRequestedRanks &&
    opts?.syncLolProfile !== false
  ) {
    const queuedPlayers = await Player.find(
      {
        "rankRefresh.requestedAt": { $type: "date" },
        "track.lol": { $ne: false },
      },
      playerProjection
    )
      .sort({ "rankRefresh.requestedAt": 1, updatedAt: 1 })
      .limit(limit)
      .lean();

    const remaining = limit - queuedPlayers.length;
    if (remaining <= 0) {
      players = queuedPlayers;
    } else {
      const regularQuery: Record<string, unknown> = { ...q };
      if (queuedPlayers.length > 0) {
        regularQuery._id = {
          $nin: queuedPlayers.map((player) => player._id),
        };
      }
      const regularPlayers = await Player.find(
        regularQuery,
        playerProjection
      )
        .sort(playerSort)
        .limit(remaining)
        .lean();
      players = [...queuedPlayers, ...regularPlayers];
    }
  } else {
    players = await Player.find(q, playerProjection)
      .sort(playerSort)
      .limit(limit)
      .lean();
  }

  const errors: { playerId: string; name?: string; error: string }[] = [];
  const playersSummary: { playerId: string; name?: string; status: "ok" | "skipped" | "failed" }[] = [];
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let rateLimited = false;
  let retryAfterMs: number | undefined;

  for (const p of players) {
    try {
      const out = await refreshPlayerById(String(p._id), {
        force: opts?.force || Boolean(p.rankRefresh?.requestedAt),
        cooldownMs: opts?.cooldownMs,
        syncMatches: opts?.syncMatches === true,
        syncTftMatches: opts?.syncTftMatches === true,
        syncLolProfile: opts?.syncLolProfile,
        syncMastery: opts?.syncMastery,
        matchesCount: opts?.matchesCount,
        matchBackfillCount: opts?.matchBackfillCount,
        fullMastery: false,
      });

      if ("_skipped" in out && out._skipped) {
        skipped++;
        playersSummary.push({
          playerId: String(p._id),
          name: `${p.gameName}#${p.tagLine}`,
          status: "skipped",
        });
        continue;
      }

      ok++;
      playersSummary.push({
        playerId: String(p._id),
        name: `${p.gameName}#${p.tagLine}`,
        status: "ok",
      });
      if (delayMs) await sleep(delayMs);
    } catch (e) {
      if (isRateLimit(e)) {
        rateLimited = true;
        retryAfterMs = rateLimitWaitMs(e, 120_000);
      } else if (p.rankRefresh?.requestedAt) {
        await markPlayerRankRefreshFailed(
          p._id,
          p.rankRefresh.requestedAt,
          e
        ).catch(() => undefined);
      } else if (opts?.syncLolProfile !== false) {
        await markPlayerRankRefreshSchedulerFailed(p._id, e).catch(
          () => undefined
        );
      }
      fail++;
      errors.push({
        playerId: String(p._id),
        name: `${p.gameName}#${p.tagLine}`,
        error: errToString(e),
      });
      playersSummary.push({
        playerId: String(p._id),
        name: `${p.gameName}#${p.tagLine}`,
        status: "failed",
      });
      if (rateLimited) break;
    }
  }

  return {
    ok,
    fail,
    skipped,
    errors,
    players: playersSummary,
    scanned: playersSummary.length,
    rateLimited,
    retryAfterMs,
  };
}

export async function upsertAndRefreshByRiotId(
  input: { gameName: string; tagLine: string },
  opts?: {
    force?: boolean;
    cooldownMs?: number;

    syncMatches?: boolean;
    matchesCount?: number;
    matchBackfillCount?: number;

    fullMastery?: boolean;
  }
) {
  await dbConnect();

  const gameName = input.gameName.trim();
  const tagLine = input.tagLine.trim();

  const gameNameNorm = normalize(gameName);
  const tagLineNorm = normalize(tagLine);

  const p = await Player.findOneAndUpdate(
    { gameNameNorm, tagLineNorm },
    {
      $set: { gameName, tagLine },
      $setOnInsert: { gameNameNorm, tagLineNorm, platform: "auto" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (!p) throw new Error("Player upsert failed");
  return refreshPlayerById(String(p._id), opts);
}
