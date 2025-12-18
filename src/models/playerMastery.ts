// models/playerMastery.ts
import mongoose, { Schema } from "mongoose";

export type PlayerMasteryDoc = {
  playerId: mongoose.Types.ObjectId;
  puuid?: string;

  championId: number;

  championLevel?: number;
  championPoints?: number;

  lastPlayTime?: number;

  chestGranted?: boolean;
  tokensEarned?: number;

  championPointsSinceLastLevel?: number;
  championPointsUntilNextLevel?: number;
  markRequiredForNextLevel?: number;
  championSeasonMilestone?: number;

  fetchedAt: Date;
};

const PlayerMasterySchema = new Schema<PlayerMasteryDoc>(
  {
    playerId: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
    puuid: { type: String, index: true },

    championId: { type: Number, required: true },

    championLevel: Number,
    championPoints: Number,

    lastPlayTime: Number,

    chestGranted: Boolean,
    tokensEarned: Number,

    championPointsSinceLastLevel: Number,
    championPointsUntilNextLevel: Number,
    markRequiredForNextLevel: Number,
    championSeasonMilestone: Number,

    fetchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

PlayerMasterySchema.index({ playerId: 1, championId: 1 }, { unique: true });
PlayerMasterySchema.index({ playerId: 1, championPoints: -1 });

export const PlayerMastery =
  (mongoose.models.PlayerMastery as mongoose.Model<PlayerMasteryDoc>) ??
  mongoose.model<PlayerMasteryDoc>("PlayerMastery", PlayerMasterySchema);
