import mongoose from "mongoose";
import { Match } from "@/models/match";
import { PlayerMatch } from "@/models/playerMatch";
import { TftMatch } from "@/models/tftMatch";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";

export const PLAYER_MATCH_RETENTION_LIMIT = 50;

type PlayerIdLike = mongoose.Types.ObjectId | string | unknown;

function toObjectId(value: PlayerIdLike) {
  const raw = String(value ?? "").trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

export async function prunePlayerMatches(playerIdLike: PlayerIdLike, limit = PLAYER_MATCH_RETENTION_LIMIT) {
  const playerId = toObjectId(playerIdLike);
  if (!playerId || limit <= 0) return { deleted: 0 };

  const keepers = await PlayerMatch.find({ playerId }, { _id: 1 })
    .sort({ gameCreation: -1, _id: -1 })
    .limit(limit)
    .lean();
  const keepIds = keepers.map((doc) => doc._id);
  const result = await PlayerMatch.deleteMany({
    playerId,
    ...(keepIds.length ? { _id: { $nin: keepIds } } : {}),
  });

  return { deleted: result.deletedCount ?? 0 };
}

export async function pruneTftPlayerMatches(playerIdLike: PlayerIdLike, limit = PLAYER_MATCH_RETENTION_LIMIT) {
  const playerId = toObjectId(playerIdLike);
  if (!playerId || limit <= 0) return { deleted: 0 };

  const keepers = await TftPlayerMatch.find({ playerId }, { _id: 1 })
    .sort({ gameDatetime: -1, _id: -1 })
    .limit(limit)
    .lean();
  const keepIds = keepers.map((doc) => doc._id);
  const result = await TftPlayerMatch.deleteMany({
    playerId,
    ...(keepIds.length ? { _id: { $nin: keepIds } } : {}),
  });

  return { deleted: result.deletedCount ?? 0 };
}

export async function pruneUnreferencedMatchDetails() {
  const [lolReferenced, tftReferenced] = await Promise.all([
    PlayerMatch.distinct("matchId"),
    TftPlayerMatch.distinct("matchId"),
  ]);

  const [lol, tft] = await Promise.all([
    Match.deleteMany({ matchId: { $nin: lolReferenced } }),
    TftMatch.deleteMany({ matchId: { $nin: tftReferenced } }),
  ]);

  return {
    lolDeleted: lol.deletedCount ?? 0,
    tftDeleted: tft.deletedCount ?? 0,
  };
}
