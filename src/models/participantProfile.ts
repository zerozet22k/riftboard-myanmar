import mongoose, { Schema } from "mongoose";
import type { RankSnapshot } from "@/models/player";

export type ParticipantProfileDoc = {
  puuid: string;
  gameName?: string;
  tagLine?: string;
  platform?: string;
  profileIconId?: number;
  summonerLevel?: number;
  solo?: RankSnapshot;
  flex?: RankSnapshot;
  source?: "match-history" | "live-game" | "manual";
  origin?: "myanmar" | "foreigner" | "unknown";
  riftboardPlayer?: boolean;
  lastSeenAt?: Date;
  lastRankFetchAt?: Date;
};

const RankSnapshotSchema = new Schema<RankSnapshot>(
  {
    tier: { type: String, trim: true },
    division: { type: String, trim: true },
    lp: Number,
    wins: Number,
    losses: Number,
    fetchedAt: Date,
  },
  { _id: false }
);

const ParticipantProfileSchema = new Schema<ParticipantProfileDoc>(
  {
    puuid: { type: String, required: true, unique: true, trim: true, index: true },
    gameName: { type: String, trim: true },
    tagLine: { type: String, trim: true },
    platform: { type: String, lowercase: true, trim: true },
    profileIconId: Number,
    summonerLevel: Number,
    solo: { type: RankSnapshotSchema, default: () => ({}) },
    flex: { type: RankSnapshotSchema, default: () => ({}) },
    source: { type: String, enum: ["match-history", "live-game", "manual"], default: "match-history" },
    origin: { type: String, enum: ["myanmar", "foreigner", "unknown"], default: "unknown" },
    riftboardPlayer: { type: Boolean, default: false },
    lastSeenAt: Date,
    lastRankFetchAt: Date,
  },
  { timestamps: true }
);

ParticipantProfileSchema.index({ lastSeenAt: -1 });
ParticipantProfileSchema.index({ lastRankFetchAt: -1 });
ParticipantProfileSchema.index({ gameName: 1, tagLine: 1 });
ParticipantProfileSchema.index({ source: 1, origin: 1, riftboardPlayer: 1 });

export const ParticipantProfile =
  (mongoose.models.ParticipantProfile as mongoose.Model<ParticipantProfileDoc>) ??
  mongoose.model<ParticipantProfileDoc>("ParticipantProfile", ParticipantProfileSchema);
