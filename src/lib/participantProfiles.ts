import { buildOpggSummonerUrl } from "@/lib/opgg";
import {
  getAccountByPuuid,
  getLeagueEntriesByPuuid,
  getSummonerByPuuid,
} from "@/lib/riot";
import { ParticipantProfile, type ParticipantProfileDoc } from "@/models/participantProfile";
import type { RankSnapshot } from "@/models/player";

const SOLO_QUEUE = "RANKED_SOLO_5x5";
const FLEX_QUEUE = "RANKED_FLEX_SR";

export const PARTICIPANT_PROFILE_STALE_MS = 24 * 60 * 60 * 1000;

export type MatchParticipantSeed = {
  puuid: string | null;
  isMe: boolean;
  riotId: string | null;
  summonerName: string | null;
  championId: number | null;
  teamId: number | null;
  teamPosition: string | null;
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  cs: number | null;
  gold: number | null;
  summonerSpells: number[];
  items: number[];
};

export type EnrichedMatchParticipant = MatchParticipantSeed & {
  gameName: string | null;
  tagLine: string | null;
  platform: string | null;
  profileIconId: number | null;
  summonerLevel: number | null;
  solo: RankSnapshot | null;
  flex: RankSnapshot | null;
  opggUrl: string | null;
  lastSeenAt: string | null;
  lastRankFetchAt: string | null;
  rankSource: "self" | "live" | "cache" | "none";
  rankStale: boolean;
};

type TrackedSelfProfile = {
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: string;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  solo?: RankSnapshot | null;
  flex?: RankSnapshot | null;
};

function safeDate(value: unknown) {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoOrNull(value: unknown) {
  const d = safeDate(value);
  return d ? d.toISOString() : null;
}

function normalizePuuid(value: unknown) {
  return String(value ?? "").trim();
}

function splitRiotId(riotId: string | null) {
  const raw = String(riotId ?? "").trim();
  const hash = raw.lastIndexOf("#");
  if (hash <= 0) return { gameName: null, tagLine: null };

  const gameName = raw.slice(0, hash).trim();
  const tagLine = raw.slice(hash + 1).trim();
  return {
    gameName: gameName || null,
    tagLine: tagLine || null,
  };
}

function rankSnapshotFromEntries(
  entries: Array<{
    queueType: string;
    tier: string;
    rank: string;
    leaguePoints: number;
    wins: number;
    losses: number;
  }>,
  queueType: string,
  now: Date
): RankSnapshot {
  const found = entries.find((entry) => entry.queueType === queueType);
  if (!found) return { fetchedAt: now };

  return {
    tier: found.tier,
    division: found.rank,
    lp: found.leaguePoints,
    wins: found.wins,
    losses: found.losses,
    fetchedAt: now,
  };
}

function isSnapshotRanked(snapshot: RankSnapshot | null | undefined) {
  return !!snapshot?.tier;
}

function cacheIsStale(profile: ParticipantProfileDoc | null | undefined, now: Date) {
  const lastFetched = safeDate(profile?.lastRankFetchAt ?? profile?.solo?.fetchedAt ?? profile?.flex?.fetchedAt);
  if (!lastFetched) return true;
  return now.getTime() - lastFetched.getTime() > PARTICIPANT_PROFILE_STALE_MS;
}

function profileToOutput(
  seed: MatchParticipantSeed,
  profile: ParticipantProfileDoc | null | undefined,
  rankSource: EnrichedMatchParticipant["rankSource"],
  rankStale: boolean
): EnrichedMatchParticipant {
  const fallbackRiotId = splitRiotId(seed.riotId);
  const gameName = profile?.gameName ?? fallbackRiotId.gameName;
  const tagLine = profile?.tagLine ?? fallbackRiotId.tagLine;
  const platform = profile?.platform ?? null;

  const solo = profile?.solo && (isSnapshotRanked(profile.solo) || profile.solo.fetchedAt) ? profile.solo : null;
  const flex = profile?.flex && (isSnapshotRanked(profile.flex) || profile.flex.fetchedAt) ? profile.flex : null;

  return {
    ...seed,
    gameName,
    tagLine,
    platform,
    profileIconId: profile?.profileIconId ?? null,
    summonerLevel: profile?.summonerLevel ?? null,
    solo,
    flex,
    opggUrl: buildOpggSummonerUrl(platform, gameName, tagLine),
    lastSeenAt: isoOrNull(profile?.lastSeenAt),
    lastRankFetchAt: isoOrNull(profile?.lastRankFetchAt),
    rankSource,
    rankStale,
  };
}

async function runWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  work: (item: TInput) => Promise<TOutput>
) {
  const results: TOutput[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await work(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker()));
  return results;
}

async function upsertParticipantProfile(
  puuid: string,
  updates: Partial<ParticipantProfileDoc>
) {
  const safeUpdates: Partial<ParticipantProfileDoc> = { ...updates };
  delete safeUpdates.puuid;
  await ParticipantProfile.updateOne(
    { puuid },
    {
      $set: safeUpdates,
      $setOnInsert: { puuid },
    },
    { upsert: true }
  );
}

async function fetchLiveParticipantProfile(
  puuid: string,
  platform: string,
  fallbackGameName: string | null,
  fallbackTagLine: string | null
) {
  const now = new Date();

  const [accountResult, summonerResult, entriesResult] = await Promise.allSettled([
    getAccountByPuuid(puuid),
    getSummonerByPuuid(platform, puuid),
    getLeagueEntriesByPuuid(platform, puuid),
  ]);

  const account =
    accountResult.status === "fulfilled"
      ? accountResult.value
      : { gameName: fallbackGameName ?? undefined, tagLine: fallbackTagLine ?? undefined };

  const summoner = summonerResult.status === "fulfilled" ? summonerResult.value : null;
  const entries = entriesResult.status === "fulfilled" ? entriesResult.value : [];

  const solo = rankSnapshotFromEntries(entries, SOLO_QUEUE, now);
  const flex = rankSnapshotFromEntries(entries, FLEX_QUEUE, now);

  const payload: ParticipantProfileDoc = {
    puuid,
    gameName: account.gameName ?? fallbackGameName ?? undefined,
    tagLine: account.tagLine ?? fallbackTagLine ?? undefined,
    platform,
    profileIconId: summoner?.profileIconId,
    summonerLevel: summoner?.summonerLevel,
    solo,
    flex,
    lastSeenAt: now,
    lastRankFetchAt: now,
  };

  await upsertParticipantProfile(puuid, payload);
  return payload;
}

export async function enrichMatchParticipants(params: {
  participants: MatchParticipantSeed[];
  platform: string | null;
  trackedSelf?: TrackedSelfProfile | null;
}) {
  const { participants, platform, trackedSelf } = params;
  const now = new Date();
  const puuids = Array.from(
    new Set(participants.map((participant) => normalizePuuid(participant.puuid)).filter(Boolean))
  );

  const existingProfiles = await ParticipantProfile.find({ puuid: { $in: puuids } }).lean();
  const profileMap = new Map(existingProfiles.map((profile) => [profile.puuid, profile]));

  return runWithConcurrency(participants, 2, async (participant) => {
    const puuid = normalizePuuid(participant.puuid);
    const existing = puuid ? profileMap.get(puuid) ?? null : null;
    const fallbackRiotId = splitRiotId(participant.riotId);

    if (!puuid) {
      return profileToOutput(participant, null, "none", true);
    }

    if (trackedSelf && puuid === normalizePuuid(trackedSelf.puuid)) {
      const selfProfile: ParticipantProfileDoc = {
        puuid,
        gameName: trackedSelf.gameName,
        tagLine: trackedSelf.tagLine,
        platform: trackedSelf.platform,
        profileIconId: trackedSelf.profileIconId ?? undefined,
        summonerLevel: trackedSelf.summonerLevel ?? undefined,
        solo: trackedSelf.solo ?? { fetchedAt: now },
        flex: trackedSelf.flex ?? { fetchedAt: now },
        lastSeenAt: now,
        lastRankFetchAt: safeDate(
          trackedSelf.solo?.fetchedAt ?? trackedSelf.flex?.fetchedAt ?? now
        ) ?? now,
      };

      await upsertParticipantProfile(puuid, selfProfile);
      return profileToOutput(participant, selfProfile, "self", false);
    }

    if (!platform) {
      if (existing) {
        await upsertParticipantProfile(puuid, { lastSeenAt: now });
        return profileToOutput(participant, { ...existing, lastSeenAt: now }, "cache", true);
      }
      return profileToOutput(participant, null, "none", true);
    }

    const needsLiveRefresh =
      !existing ||
      existing.platform !== platform ||
      cacheIsStale(existing, now) ||
      !existing.gameName ||
      !existing.tagLine;

    if (needsLiveRefresh) {
      try {
        const liveProfile = await fetchLiveParticipantProfile(
          puuid,
          platform,
          fallbackRiotId.gameName,
          fallbackRiotId.tagLine
        );
        return profileToOutput(participant, liveProfile, "live", false);
      } catch {
        if (existing) {
          const fallbackProfile = { ...existing, lastSeenAt: now };
          await upsertParticipantProfile(puuid, { lastSeenAt: now });
          return profileToOutput(participant, fallbackProfile, "cache", true);
        }
      }
    }

    if (existing) {
      const cachedProfile = { ...existing, lastSeenAt: now };
      await upsertParticipantProfile(puuid, { lastSeenAt: now });
      return profileToOutput(participant, cachedProfile, "cache", cacheIsStale(existing, now));
    }

    const seededProfile: ParticipantProfileDoc = {
      puuid,
      gameName: fallbackRiotId.gameName ?? undefined,
      tagLine: fallbackRiotId.tagLine ?? undefined,
      platform,
      lastSeenAt: now,
    };
    await upsertParticipantProfile(puuid, seededProfile);
    return profileToOutput(participant, seededProfile, "none", true);
  });
}
