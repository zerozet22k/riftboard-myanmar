import mongoose from "mongoose";
import { prunePlayerMatches } from "@/lib/matchRetention";
import { getMatchById } from "@/lib/riot";
import { Match } from "@/models/match";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";

type MatchParticipantRaw = {
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
  goldEarned?: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  perks?: {
    styles?: Array<{
      style?: number;
      selections?: Array<{ perk?: number }>;
    }>;
  };
};

type MatchInfoRaw = {
  participants?: MatchParticipantRaw[];
  queueId?: number;
  gameCreation?: number;
  gameDuration?: number;
};

type StoredMatchRaw = { info?: MatchInfoRaw } | null | undefined;

function safeNum(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeBool(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function safeStr(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function playerMatchDocFromRaw(params: {
  matchId: string;
  region: string;
  playerId: mongoose.Types.ObjectId;
  puuid: string | null | undefined;
  raw: StoredMatchRaw;
}) {
  const info = params.raw?.info ?? {};
  const participantsRaw = Array.isArray(info.participants) ? info.participants : [];
  const me = participantsRaw.find(
    (participant) =>
      params.puuid &&
      typeof participant?.puuid === "string" &&
      participant.puuid.toLowerCase() === params.puuid.toLowerCase()
  );
  if (!me) return null;

  const styles = Array.isArray(me.perks?.styles) ? me.perks.styles : [];
  const items = [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6].filter(
    (value): value is number => typeof value === "number" && value > 0
  );
  const summonerSpells = [me.summoner1Id, me.summoner2Id].filter(
    (value): value is number => typeof value === "number" && value > 0
  );
  const cs =
    (typeof me.totalMinionsKilled === "number" ? me.totalMinionsKilled : 0) +
    (typeof me.neutralMinionsKilled === "number" ? me.neutralMinionsKilled : 0);

  return {
    playerId: params.playerId,
    matchId: params.matchId,
    region: params.region,
    queueId: safeNum(info.queueId),
    gameCreation: safeNum(info.gameCreation),
    gameDuration: safeNum(info.gameDuration),
    championId: safeNum(me.championId),
    teamId: safeNum(me.teamId),
    teamPosition: safeStr(me.teamPosition),
    primaryStyle: safeNum(styles[0]?.style),
    primaryRune: safeNum(styles[0]?.selections?.[0]?.perk),
    subStyle: safeNum(styles[1]?.style),
    win: safeBool(me.win),
    kills: safeNum(me.kills),
    deaths: safeNum(me.deaths),
    assists: safeNum(me.assists),
    largestMultiKill: safeNum(me.largestMultiKill),
    doubleKills: safeNum(me.doubleKills),
    tripleKills: safeNum(me.tripleKills),
    quadraKills: safeNum(me.quadraKills),
    pentaKills: safeNum(me.pentaKills),
    largestKillingSpree: safeNum(me.largestKillingSpree),
    cs: Number.isFinite(cs) ? cs : undefined,
    gold: safeNum(me.goldEarned),
    items,
    summonerSpells,
    fetchedAt: new Date(),
  };
}

export async function hydrateTrackedPlayerMatchesFromRaw(params: {
  matchId: string;
  region: string;
  raw: StoredMatchRaw;
}) {
  const info = params.raw?.info ?? {};
  const participantsRaw = Array.isArray(info.participants) ? info.participants : [];
  const puuids = [
    ...new Set(
      participantsRaw
        .map((participant) => safeStr(participant.puuid))
        .filter((puuid): puuid is string => !!puuid)
    ),
  ];

  if (!puuids.length) return 0;

  const trackedPlayers = (await Player.find(
    { puuid: { $in: puuids } },
    { _id: 1, puuid: 1 }
  ).lean()) as Array<{ _id: unknown; puuid?: string | null }>;

  const ops = trackedPlayers
    .map((trackedPlayer) => {
      const playerId = new mongoose.Types.ObjectId(String(trackedPlayer._id));
      const doc = playerMatchDocFromRaw({
        matchId: params.matchId,
        region: params.region,
        playerId,
        puuid: trackedPlayer.puuid,
        raw: params.raw,
      });

      if (!doc) return null;

      return {
        updateOne: {
          filter: { playerId, matchId: params.matchId },
          update: { $set: doc },
          upsert: true,
        },
      };
    })
    .filter((op): op is NonNullable<typeof op> => op != null);

  if (!ops.length) return 0;

  await PlayerMatch.bulkWrite(ops as unknown as Parameters<typeof PlayerMatch.bulkWrite>[0], {
    ordered: false,
  });
  await Promise.all(trackedPlayers.map((player) => prunePlayerMatches(player._id)));
  return ops.length;
}

export async function ensureMatchDetailStored(params: { matchId: string; matchRegion: string }) {
  const matchId = String(params.matchId ?? "").trim();
  if (!matchId) return null;

  const existing = (await Match.findOne(
    { matchId },
    { matchId: 1, region: 1, queueId: 1, gameCreation: 1, gameDuration: 1, raw: 1 }
  ).lean()) as {
    matchId: string;
    region?: string | null;
    queueId?: number | null;
    gameCreation?: number | null;
    gameDuration?: number | null;
    raw?: StoredMatchRaw;
  } | null;

  if (existing?.raw?.info) {
    await hydrateTrackedPlayerMatchesFromRaw({
      matchId,
      region: safeStr(existing.region) ?? params.matchRegion,
      raw: existing.raw,
    });
    return existing;
  }

  const raw = (await getMatchById(matchId, params.matchRegion)) as StoredMatchRaw;
  const info = raw?.info ?? {};
  const now = new Date();

  await Match.updateOne(
    { matchId },
    {
      $set: {
        region: params.matchRegion,
        queueId: safeNum(info.queueId),
        gameCreation: safeNum(info.gameCreation),
        gameDuration: safeNum(info.gameDuration),
        raw,
        fetchedAt: now,
      },
      $setOnInsert: { matchId },
    },
    { upsert: true }
  );

  await hydrateTrackedPlayerMatchesFromRaw({
    matchId,
    region: params.matchRegion,
    raw,
  });

  return {
    matchId,
    region: params.matchRegion,
    queueId: safeNum(info.queueId),
    gameCreation: safeNum(info.gameCreation),
    gameDuration: safeNum(info.gameDuration),
    raw,
  };
}

export async function ensureMatchDetailsForHistoryRows(params: {
  rows: Array<{ matchId?: unknown }>;
  matchRegion: string;
  maxFetch?: number;
}) {
  const ids = [
    ...new Set(params.rows.map((row) => String(row.matchId ?? "").trim()).filter(Boolean)),
  ];
  if (!ids.length) return { checked: 0, fetched: 0 };

  const existing = await Match.find({ matchId: { $in: ids } }, { matchId: 1, raw: 1 }).lean();
  const detailById = new Map(existing.map((match) => [String(match.matchId), !!match.raw?.info]));
  const missingIds = ids.filter((id) => !detailById.get(id)).slice(0, params.maxFetch ?? 10);
  let fetched = 0;

  for (const matchId of missingIds) {
    try {
      const stored = await ensureMatchDetailStored({ matchId, matchRegion: params.matchRegion });
      if (stored?.raw?.info) fetched += 1;
    } catch {
      // Keep match history usable even if Riot rate-limits or one old match is unavailable.
    }
  }

  return { checked: ids.length, fetched };
}
