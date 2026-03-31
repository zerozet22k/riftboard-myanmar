import mongoose from "mongoose";
import { Player, type RankSnapshot } from "@/models/player";
import { PlayerMastery, type PlayerMasteryDoc } from "@/models/playerMastery";
import { PlayerMatch, type PlayerMatchDoc } from "@/models/playerMatch";
import { RankEntry } from "@/models/rankEntry";
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

function newerDate(a: unknown, b: unknown) {
  const da = new Date(String(a ?? ""));
  const db = new Date(String(b ?? ""));
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

async function mergePlayerMatchDocs(primaryId: MergeId, duplicateId: MergeId) {
  const docs = await PlayerMatch.find({ playerId: duplicateId }).lean<StoredPlayerMatchDoc[]>();
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
    { ordered: false }
  );

  await PlayerMatch.deleteMany({ playerId: duplicateId });
}

async function mergePlayerMasteryDocs(primaryId: MergeId, duplicateId: MergeId) {
  const docs = await PlayerMastery.find({ playerId: duplicateId }).lean<StoredPlayerMasteryDoc[]>();
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
    { ordered: false }
  );

  await PlayerMastery.deleteMany({ playerId: duplicateId });
}

export async function mergePlayers(primaryId: string, duplicateId: string) {
  if (primaryId === duplicateId) {
    const existing = await Player.findById(primaryId);
    if (!existing) throw new Error("Player not found");
    return existing;
  }

  const [primary, duplicate] = await Promise.all([
    Player.findById(primaryId),
    Player.findById(duplicateId),
  ]);

  if (!primary || !duplicate) throw new Error("Player merge target not found");

  primary.riotIdAliases = mergeAliases(primary, duplicate);
  primary.platform = primary.platform || duplicate.platform;
  primary.matchRegion = primary.matchRegion || duplicate.matchRegion;
  primary.puuid = primary.puuid || duplicate.puuid;
  primary.summonerId = primary.summonerId || duplicate.summonerId;
  primary.profileIconId = primary.profileIconId ?? duplicate.profileIconId;
  primary.summonerName = primary.summonerName || duplicate.summonerName;
  primary.summonerLevel = primary.summonerLevel ?? duplicate.summonerLevel;
  primary.revisionDate = primary.revisionDate ?? duplicate.revisionDate;

  const lastRefreshAt = newerDate(primary.lastRefreshAt, duplicate.lastRefreshAt);
  if (lastRefreshAt) primary.lastRefreshAt = lastRefreshAt;

  primary.solo = mergeRankSnapshot(primary.solo, duplicate.solo);
  primary.flex = mergeRankSnapshot(primary.flex, duplicate.flex);

  const primaryMasteryAt = newerDate(primary.masterySyncedAt, null);
  const duplicateMasteryAt = newerDate(duplicate.masterySyncedAt, null);
  const duplicateHasNewerMastery =
    (!primaryMasteryAt && !!duplicateMasteryAt) ||
    (!!primaryMasteryAt &&
      !!duplicateMasteryAt &&
      duplicateMasteryAt.getTime() > primaryMasteryAt.getTime());

  if ((!Array.isArray(primary.mains) || !primary.mains.length) || duplicateHasNewerMastery) {
    primary.mains = duplicate.mains;
    primary.masterySyncedAt = duplicate.masterySyncedAt;
  }

  primary.leaderboard = {
    group: primary.leaderboard?.group ?? duplicate.leaderboard?.group ?? null,
    status: primary.leaderboard?.status ?? duplicate.leaderboard?.status ?? null,
    requestedAt:
      newerDate(primary.leaderboard?.requestedAt, duplicate.leaderboard?.requestedAt) ??
      primary.leaderboard?.requestedAt ??
      duplicate.leaderboard?.requestedAt,
    approvedAt:
      newerDate(primary.leaderboard?.approvedAt, duplicate.leaderboard?.approvedAt) ??
      primary.leaderboard?.approvedAt ??
      duplicate.leaderboard?.approvedAt,
    note: primary.leaderboard?.note ?? duplicate.leaderboard?.note,
  };

  primary.matchSync = {
    enabled: primary.matchSync?.enabled ?? duplicate.matchSync?.enabled ?? true,
    lastSyncAt:
      newerDate(primary.matchSync?.lastSyncAt, duplicate.matchSync?.lastSyncAt) ??
      primary.matchSync?.lastSyncAt ??
      duplicate.matchSync?.lastSyncAt,
  };

  primary.track = {
    lol: primary.track?.lol ?? duplicate.track?.lol ?? true,
    tft: primary.track?.tft ?? duplicate.track?.tft ?? false,
  };

  await Promise.all([
    RankEntry.updateMany({ playerId: duplicate._id }, { $set: { playerId: primary._id } }),
    mergePlayerMasteryDocs(primary._id, duplicate._id),
    mergePlayerMatchDocs(primary._id, duplicate._id),
  ]);

  await duplicate.deleteOne();
  await primary.save();

  return primary;
}
