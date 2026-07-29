import mongoose, { type ClientSession } from "mongoose";
import { DiscordLink, type DiscordLinkDoc } from "@/models/discordLink";
import { LiveGamePost } from "@/models/liveGamePost";
import { Player, type PlayerDoc, type RankSnapshot } from "@/models/player";
import { PlayerMastery, type PlayerMasteryDoc } from "@/models/playerMastery";
import { PlayerMatch, type PlayerMatchDoc } from "@/models/playerMatch";
import { ProfileComment } from "@/models/profileComment";
import { RankEntry } from "@/models/rankEntry";
import { TftPlayerMatch, type TftPlayerMatchDoc } from "@/models/tftPlayerMatch";
import { TournamentTeam } from "@/models/tournamentTeam";
import {
  makeRiotIdAlias,
  normalizeRiotIdAliases,
  sameRiotId,
} from "@/lib/playerIdentity";

type SnapshotLike = RankSnapshot | null | undefined;
type MergeId = mongoose.Types.ObjectId;
type AliasCarrier = {
  gameName?: unknown;
  tagLine?: unknown;
  riotIdAliases?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
};
type StoredPlayerMatchDoc = PlayerMatchDoc & { _id?: unknown };
type StoredPlayerMasteryDoc = PlayerMasteryDoc & { _id?: unknown };
type StoredTftPlayerMatchDoc = TftPlayerMatchDoc & { _id?: unknown };
type StoredDiscordLinkDoc = DiscordLinkDoc & {
  _id: mongoose.Types.ObjectId;
  createdAt?: unknown;
  updatedAt?: unknown;
  __v?: unknown;
};
type MatchSync = NonNullable<PlayerDoc["matchSync"]>;
type TftMatchSync = NonNullable<PlayerDoc["tftMatchSync"]>;
type RankRefresh = NonNullable<PlayerDoc["rankRefresh"]>;

function dateValue(value: unknown) {
  if (value instanceof Date) return new Date(value);
  if (typeof value === "number") return new Date(value);
  return new Date(String(value ?? ""));
}

function newerDate(a: unknown, b: unknown) {
  const da = dateValue(a);
  const db = dateValue(b);
  const aValid = !Number.isNaN(da.getTime());
  const bValid = !Number.isNaN(db.getTime());

  if (!aValid) return bValid ? db : null;
  if (!bValid) return da;
  return da.getTime() >= db.getTime() ? da : db;
}

function mergeRankSnapshot(primary: SnapshotLike, duplicate: SnapshotLike): RankSnapshot {
  const primaryFetchedAt = new Date(String(primary?.fetchedAt ?? ""));
  const duplicateFetchedAt = new Date(String(duplicate?.fetchedAt ?? ""));

  if (Number.isNaN(primaryFetchedAt.getTime())) return duplicate ?? primary ?? {};
  if (Number.isNaN(duplicateFetchedAt.getTime())) return primary ?? duplicate ?? {};

  return duplicateFetchedAt.getTime() > primaryFetchedAt.getTime()
    ? duplicate ?? primary ?? {}
    : primary ?? duplicate ?? {};
}

function latestTftSyncActivity(sync: TftMatchSync | null | undefined) {
  return newerDate(sync?.lastAttemptAt, sync?.lastSyncAt);
}

function newerState<T>(
  primary: T | null | undefined,
  duplicate: T | null | undefined,
  primaryDate: unknown,
  duplicateDate: unknown
) {
  const primaryAt = newerDate(primaryDate, null);
  const duplicateAt = newerDate(duplicateDate, null);
  if (!primary) return duplicate;
  if (!duplicate) return primary;
  if (!primaryAt) return duplicateAt ? duplicate : primary;
  if (!duplicateAt) return primary;
  return duplicateAt.getTime() > primaryAt.getTime() ? duplicate : primary;
}

function mergeMatchSync(
  primary: MatchSync | null | undefined,
  duplicate: MatchSync | null | undefined
): MatchSync {
  const recentState = newerState(
    primary,
    duplicate,
    primary?.lastSyncAt,
    duplicate?.lastSyncAt
  );
  const otherRecentState = recentState === duplicate ? primary : duplicate;
  const backfillState = newerState(
    primary,
    duplicate,
    primary?.backfillLastSyncAt,
    duplicate?.backfillLastSyncAt
  );
  const otherBackfillState = backfillState === duplicate ? primary : duplicate;

  return {
    enabled: primary?.enabled ?? duplicate?.enabled ?? true,
    lastSyncAt:
      newerDate(primary?.lastSyncAt, duplicate?.lastSyncAt) ??
      primary?.lastSyncAt ??
      duplicate?.lastSyncAt,
    recentRequested:
      recentState?.recentRequested ?? otherRecentState?.recentRequested,
    recentWritten: recentState?.recentWritten ?? otherRecentState?.recentWritten,
    backfillLastSyncAt:
      newerDate(primary?.backfillLastSyncAt, duplicate?.backfillLastSyncAt) ??
      primary?.backfillLastSyncAt ??
      duplicate?.backfillLastSyncAt,
    backfillStart: backfillState?.backfillStart ?? otherBackfillState?.backfillStart,
    backfillRequested:
      backfillState?.backfillRequested ?? otherBackfillState?.backfillRequested,
    backfillWritten:
      backfillState?.backfillWritten ?? otherBackfillState?.backfillWritten,
    backfillExhausted:
      backfillState?.backfillExhausted ?? otherBackfillState?.backfillExhausted,
  };
}

function mergeTftMatchSync(
  primary: TftMatchSync | null | undefined,
  duplicate: TftMatchSync | null | undefined
): TftMatchSync {
  const primaryActivity = latestTftSyncActivity(primary);
  const duplicateActivity = latestTftSyncActivity(duplicate);
  const duplicateIsNewer =
    (!primary && !!duplicate) ||
    (!primaryActivity && !!duplicateActivity) ||
    (!!primaryActivity &&
      !!duplicateActivity &&
      duplicateActivity.getTime() > primaryActivity.getTime());
  const latestState = duplicateIsNewer ? duplicate : primary ?? duplicate;

  return {
    enabled: primary?.enabled ?? duplicate?.enabled ?? true,
    lastSyncAt:
      newerDate(primary?.lastSyncAt, duplicate?.lastSyncAt) ??
      primary?.lastSyncAt ??
      duplicate?.lastSyncAt,
    lastAttemptAt:
      newerDate(primary?.lastAttemptAt, duplicate?.lastAttemptAt) ??
      primary?.lastAttemptAt ??
      duplicate?.lastAttemptAt,
    retryAfterAt: latestState?.retryAfterAt,
    lastError: latestState?.lastError,
    lastErrorCode: latestState?.lastErrorCode,
    lastErrorStage: latestState?.lastErrorStage,
    consecutiveFailures: latestState?.consecutiveFailures,
  };
}

function mergeRankRefresh(
  primary: RankRefresh | null | undefined,
  duplicate: RankRefresh | null | undefined
): RankRefresh {
  const primaryRequestedAt = newerDate(primary?.requestedAt, null);
  const duplicateRequestedAt = newerDate(duplicate?.requestedAt, null);
  const requestedAt =
    primaryRequestedAt && duplicateRequestedAt
      ? primaryRequestedAt.getTime() <= duplicateRequestedAt.getTime()
        ? primaryRequestedAt
        : duplicateRequestedAt
      : primaryRequestedAt ?? duplicateRequestedAt ?? undefined;
  const latestState = newerState(
    primary,
    duplicate,
    newerDate(primary?.lastAttemptAt, primary?.completedAt),
    newerDate(duplicate?.lastAttemptAt, duplicate?.completedAt)
  );

  return {
    requestedAt,
    startedAt:
      newerDate(primary?.startedAt, duplicate?.startedAt) ??
      primary?.startedAt ??
      duplicate?.startedAt,
    completedAt:
      newerDate(primary?.completedAt, duplicate?.completedAt) ??
      primary?.completedAt ??
      duplicate?.completedAt,
    lastAttemptAt:
      newerDate(primary?.lastAttemptAt, duplicate?.lastAttemptAt) ??
      primary?.lastAttemptAt ??
      duplicate?.lastAttemptAt,
    retryAfterAt: latestState?.retryAfterAt,
    lastError: latestState?.lastError,
  };
}

function mergeAliases(primary: AliasCarrier, duplicate: AliasCarrier) {
  const canonical = {
    gameName: primary?.gameName,
    tagLine: primary?.tagLine,
  };

  const seed = [
    ...(Array.isArray(primary?.riotIdAliases) ? primary.riotIdAliases : []),
    ...(Array.isArray(duplicate?.riotIdAliases) ? duplicate.riotIdAliases : []),
  ];

  const duplicateCanonical = makeRiotIdAlias(
    duplicate?.gameName,
    duplicate?.tagLine,
    newerDate(duplicate?.updatedAt, duplicate?.createdAt) ?? new Date()
  );

  if (duplicateCanonical && !sameRiotId(duplicateCanonical, canonical)) {
    seed.push(duplicateCanonical);
  }

  return normalizeRiotIdAliases(seed, canonical);
}

async function mergePlayerMatchDocs(
  primaryId: MergeId,
  duplicateId: MergeId,
  session: ClientSession
) {
  const docs = await PlayerMatch.find({ playerId: duplicateId })
    .session(session)
    .lean<StoredPlayerMatchDoc[]>();
  if (!docs.length) return;

  await PlayerMatch.bulkWrite(
    docs.map((item) => {
      const doc = { ...item };
      delete doc._id;

      return {
        updateOne: {
          filter: { playerId: primaryId, matchId: doc.matchId },
          update: { $setOnInsert: { ...doc, playerId: primaryId } },
          upsert: true,
        },
      };
    }),
    { ordered: false, session }
  );

  await PlayerMatch.deleteMany({ playerId: duplicateId }).session(session);
}

async function mergePlayerMasteryDocs(
  primaryId: MergeId,
  duplicateId: MergeId,
  session: ClientSession
) {
  const docs = await PlayerMastery.find({ playerId: duplicateId })
    .session(session)
    .lean<StoredPlayerMasteryDoc[]>();
  if (!docs.length) return;

  await PlayerMastery.bulkWrite(
    docs.map((item) => {
      const doc = { ...item };
      delete doc._id;

      return {
        updateOne: {
          filter: { playerId: primaryId, championId: doc.championId },
          update: { $setOnInsert: { ...doc, playerId: primaryId } },
          upsert: true,
        },
      };
    }),
    { ordered: false, session }
  );

  await PlayerMastery.deleteMany({ playerId: duplicateId }).session(session);
}

async function mergeTftPlayerMatchDocs(
  primaryId: MergeId,
  duplicateId: MergeId,
  session: ClientSession
) {
  const docs = await TftPlayerMatch.find({ playerId: duplicateId })
    .session(session)
    .lean<StoredTftPlayerMatchDoc[]>();
  if (!docs.length) return;

  const primaryDocs = await TftPlayerMatch.find(
    {
      playerId: primaryId,
      matchId: { $in: docs.map((doc) => doc.matchId) },
    },
    { matchId: 1, fetchedAt: 1, gameDatetime: 1 }
  )
    .session(session)
    .lean<StoredTftPlayerMatchDoc[]>();
  const primaryByMatchId = new Map(primaryDocs.map((doc) => [doc.matchId, doc]));

  await TftPlayerMatch.bulkWrite(
    docs.map((item) => {
      const doc = { ...item };
      delete doc._id;

      const existing = primaryByMatchId.get(doc.matchId);
      const existingFreshness = newerDate(existing?.fetchedAt, existing?.gameDatetime);
      const duplicateFreshness = newerDate(doc.fetchedAt, doc.gameDatetime);
      const duplicateIsNewer =
        !existing ||
        (!existingFreshness && !!duplicateFreshness) ||
        (!!existingFreshness &&
          !!duplicateFreshness &&
          duplicateFreshness.getTime() > existingFreshness.getTime());

      return {
        updateOne: {
          filter: { playerId: primaryId, matchId: doc.matchId },
          update: duplicateIsNewer
            ? { $set: { ...doc, playerId: primaryId } }
            : { $setOnInsert: { ...doc, playerId: primaryId } },
          upsert: true,
        },
      };
    }),
    { ordered: false, session }
  );

  await TftPlayerMatch.deleteMany({ playerId: duplicateId }).session(session);
}

function isVerifiedDiscordLink(link: StoredDiscordLinkDoc) {
  return link.verifiedBinding === true;
}

function preferredDiscordLink(
  primary: StoredDiscordLinkDoc,
  duplicate: StoredDiscordLinkDoc
) {
  if (isVerifiedDiscordLink(primary) !== isVerifiedDiscordLink(duplicate)) {
    return isVerifiedDiscordLink(duplicate) ? duplicate : primary;
  }

  const primaryUpdatedAt = newerDate(primary.updatedAt, primary.createdAt);
  const duplicateUpdatedAt = newerDate(duplicate.updatedAt, duplicate.createdAt);
  if (!primaryUpdatedAt) return duplicateUpdatedAt ? duplicate : primary;
  if (!duplicateUpdatedAt) return primary;
  return duplicateUpdatedAt.getTime() > primaryUpdatedAt.getTime() ? duplicate : primary;
}

function discordLinkFields(
  link: StoredDiscordLinkDoc,
  primaryId: MergeId,
  gameName: string,
  tagLine: string
) {
  const fields = { ...link } as Omit<StoredDiscordLinkDoc, "_id"> & {
    _id?: unknown;
    playerId: MergeId;
    createdAt?: unknown;
    updatedAt?: unknown;
    __v?: unknown;
  };
  delete fields._id;
  delete fields.createdAt;
  delete fields.updatedAt;
  delete fields.__v;
  fields.playerId = primaryId;
  fields.gameName = gameName;
  fields.tagLine = tagLine;
  return fields;
}

async function assertDiscordLinkOwnershipIsCompatible(
  primaryId: MergeId,
  duplicateId: MergeId,
  session: ClientSession
) {
  const verifiedOwners = await DiscordLink.distinct("discordUserId", {
    playerId: { $in: [primaryId, duplicateId] },
    verifiedBinding: true,
  }).session(session);
  if (new Set(verifiedOwners.map((owner) => String(owner).trim())).size > 1) {
    throw new Error(
      "Cannot merge players linked to different verified Discord accounts"
    );
  }
}

async function mergeDiscordLinks(
  primaryId: MergeId,
  duplicateId: MergeId,
  gameName: string,
  tagLine: string,
  session: ClientSession
) {
  const primaryLinks = await DiscordLink.find({ playerId: primaryId })
    .session(session)
    .lean<StoredDiscordLinkDoc[]>();
  const duplicateLinks = await DiscordLink.find({ playerId: duplicateId })
    .session(session)
    .lean<StoredDiscordLinkDoc[]>();
  const primaryByDiscordUserId = new Map(
    primaryLinks.map((link) => [link.discordUserId, link])
  );

  for (const duplicateLink of duplicateLinks) {
    const existing = primaryByDiscordUserId.get(duplicateLink.discordUserId);
    if (!existing) {
      await DiscordLink.updateOne(
        { _id: duplicateLink._id, playerId: duplicateId },
        {
          $set: {
            playerId: primaryId,
            gameName,
            tagLine,
          },
        },
        { session }
      );
      primaryByDiscordUserId.set(duplicateLink.discordUserId, {
        ...duplicateLink,
        playerId: primaryId,
        gameName,
        tagLine,
      });
      continue;
    }

    const preferred = preferredDiscordLink(existing, duplicateLink);
    const verifiedLinks = [existing, duplicateLink].filter(isVerifiedDiscordLink);
    const shouldRemainPrimary = verifiedLinks.length
      ? verifiedLinks.some((link) => link.isPrimary === true)
      : existing.isPrimary === true || duplicateLink.isPrimary === true;
    const mergedFields = discordLinkFields(
      preferred,
      primaryId,
      gameName,
      tagLine
    );
    mergedFields.isPrimary = shouldRemainPrimary;

    const demoteDuplicatePrimary =
      duplicateLink.verifiedBinding === true &&
      duplicateLink.isPrimary === true &&
      shouldRemainPrimary;
    if (demoteDuplicatePrimary) {
      await DiscordLink.updateOne(
        { _id: duplicateLink._id, playerId: duplicateId },
        { $set: { isPrimary: false } },
        { session }
      );
    }

    try {
      await DiscordLink.updateOne(
        { _id: existing._id, playerId: primaryId },
        { $set: mergedFields },
        { session }
      );
    } catch (error) {
      if (demoteDuplicatePrimary) {
        await DiscordLink.updateOne(
          { _id: duplicateLink._id, playerId: duplicateId },
          { $set: { isPrimary: true } },
          { session }
        ).catch(() => null);
      }
      throw error;
    }
    await DiscordLink.deleteOne(
      { _id: duplicateLink._id, playerId: duplicateId },
      { session }
    );
  }

  await DiscordLink.updateMany(
    { playerId: primaryId },
    { $set: { gameName, tagLine } },
    { session }
  );
}

async function mergePlayerReferences(
  primaryId: MergeId,
  duplicateId: MergeId,
  session: ClientSession
) {
  await ProfileComment.updateMany(
    { profilePlayerId: duplicateId },
    { $set: { profilePlayerId: primaryId } },
    { session }
  );
  await TournamentTeam.updateMany(
    { "roster.playerId": String(duplicateId) },
    { $set: { "roster.$[member].playerId": String(primaryId) } },
    {
      arrayFilters: [{ "member.playerId": String(duplicateId) }],
      session,
    }
  );
  await LiveGamePost.updateMany(
    { playerIds: duplicateId },
    { $addToSet: { playerIds: primaryId } },
    { session }
  );
  await LiveGamePost.updateMany(
    { playerIds: duplicateId },
    { $pull: { playerIds: duplicateId } },
    { session }
  );
}

export async function mergePlayers(primaryId: string, duplicateId: string) {
  if (primaryId === duplicateId) {
    const existing = await Player.findById(primaryId);
    if (!existing) throw new Error("Player not found");
    return existing;
  }

  const session = await mongoose.startSession();
  try {
    const merged = await session.withTransaction(async () => {
      const primary = await Player.findById(primaryId).session(session);
      const duplicate = await Player.findById(duplicateId).session(session);

      if (!primary || !duplicate) throw new Error("Player merge target not found");
      if (!primary.puuid && duplicate.puuid) {
        throw new Error(
          "Player merge primary must own the durable Riot identity"
        );
      }
      await assertDiscordLinkOwnershipIsCompatible(
        primary._id,
        duplicate._id,
        session
      );

      primary.riotIdAliases = mergeAliases(primary, duplicate);
      primary.platform = primary.platform || duplicate.platform;
      primary.matchRegion = primary.matchRegion || duplicate.matchRegion;
      primary.tftPuuid = primary.tftPuuid || duplicate.tftPuuid;
      // summonerId is unique. Do not transfer it between Player documents
      // inside the transaction; the refresh immediately re-resolves it after
      // the duplicate row has committed as deleted.
      primary.profileIconId = primary.profileIconId ?? duplicate.profileIconId;
      primary.summonerName = primary.summonerName || duplicate.summonerName;
      primary.summonerLevel = primary.summonerLevel ?? duplicate.summonerLevel;
      primary.revisionDate = primary.revisionDate ?? duplicate.revisionDate;

      const lastRefreshAt = newerDate(primary.lastRefreshAt, duplicate.lastRefreshAt);
      if (lastRefreshAt) primary.lastRefreshAt = lastRefreshAt;

      primary.solo = mergeRankSnapshot(primary.solo, duplicate.solo);
      primary.flex = mergeRankSnapshot(primary.flex, duplicate.flex);
      primary.tft = mergeRankSnapshot(primary.tft, duplicate.tft);

      const primaryMasteryAt = newerDate(primary.masterySyncedAt, null);
      const duplicateMasteryAt = newerDate(duplicate.masterySyncedAt, null);
      const duplicateHasNewerMastery =
        (!primaryMasteryAt && !!duplicateMasteryAt) ||
        (!!primaryMasteryAt &&
          !!duplicateMasteryAt &&
          duplicateMasteryAt.getTime() > primaryMasteryAt.getTime());

      if (
        (!Array.isArray(primary.mains) || !primary.mains.length) ||
        duplicateHasNewerMastery
      ) {
        primary.mains = duplicate.mains;
        primary.masterySyncedAt = duplicate.masterySyncedAt;
      }

      primary.leaderboard = {
        group: primary.leaderboard?.group ?? duplicate.leaderboard?.group ?? null,
        status: primary.leaderboard?.status ?? duplicate.leaderboard?.status ?? null,
        requestedAt:
          newerDate(
            primary.leaderboard?.requestedAt,
            duplicate.leaderboard?.requestedAt
          ) ??
          primary.leaderboard?.requestedAt ??
          duplicate.leaderboard?.requestedAt,
        approvedAt:
          newerDate(
            primary.leaderboard?.approvedAt,
            duplicate.leaderboard?.approvedAt
          ) ??
          primary.leaderboard?.approvedAt ??
          duplicate.leaderboard?.approvedAt,
        note: primary.leaderboard?.note ?? duplicate.leaderboard?.note,
      };

      primary.matchSync = mergeMatchSync(primary.matchSync, duplicate.matchSync);
      primary.rankRefresh = mergeRankRefresh(
        primary.rankRefresh,
        duplicate.rankRefresh
      );
      primary.tftMatchSync = mergeTftMatchSync(
        primary.tftMatchSync,
        duplicate.tftMatchSync
      );

      primary.track = {
        lol: primary.track?.lol ?? duplicate.track?.lol ?? true,
        tft: primary.track?.tft ?? duplicate.track?.tft ?? true,
      };

      await primary.validate();

      await RankEntry.updateMany(
        { playerId: duplicate._id },
        { $set: { playerId: primary._id } },
        { session }
      );
      await mergePlayerMasteryDocs(primary._id, duplicate._id, session);
      await mergePlayerMatchDocs(primary._id, duplicate._id, session);
      await mergeTftPlayerMatchDocs(primary._id, duplicate._id, session);
      await mergePlayerReferences(primary._id, duplicate._id, session);
      await mergeDiscordLinks(
        primary._id,
        duplicate._id,
        primary.gameName,
        primary.tagLine,
        session
      );

      await duplicate.deleteOne({ session });
      await primary.save({ session });
      return primary;
    });

    if (!merged) throw new Error("Player merge transaction did not complete");
    merged.$session(null);
    return merged;
  } finally {
    await session.endSession();
  }
}
