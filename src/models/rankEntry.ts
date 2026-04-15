// models/rankEntry.ts
import mongoose, { Schema } from "mongoose";

export const LOL_QUEUES = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] as const;
export const TFT_QUEUES = ["RANKED_TFT"] as const;
export const RANK_QUEUES = [...LOL_QUEUES, ...TFT_QUEUES] as const;
export type LolQueue = (typeof LOL_QUEUES)[number];
export type RankQueue = (typeof RANK_QUEUES)[number];

export type RankEntryDoc = {
  playerId: mongoose.Types.ObjectId;
  queue: RankQueue;

  tier?: string;
  division?: string;
  lp?: number;
  wins?: number;
  losses?: number;

  fetchedAt: Date;
};

const RankEntrySchema = new Schema<RankEntryDoc>(
  {
    playerId: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
    queue: { type: String, required: true, trim: true, index: true, enum: [...RANK_QUEUES] },

    tier: { type: String, trim: true },
    division: { type: String, trim: true },
    lp: Number,
    wins: Number,
    losses: Number,

    fetchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

RankEntrySchema.index({ playerId: 1, queue: 1, fetchedAt: -1 });
RankEntrySchema.index({ playerId: 1, fetchedAt: -1 });

export const RankEntry =
  (mongoose.models.RankEntry as mongoose.Model<RankEntryDoc>) ??
  mongoose.model<RankEntryDoc>("RankEntry", RankEntrySchema);
