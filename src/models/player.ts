
import mongoose, { Schema, type HydratedDocument } from "mongoose";
import type { RiotIdAliasEntry } from "@/lib/playerIdentity";

export type RankSnapshot = {
  tier?: string;
  division?: string;
  lp?: number;
  wins?: number;
  losses?: number;
  fetchedAt?: Date;
};

export type MainChampion = {
  championId: number;
  championName?: string;
  championPoints?: number;
  updatedAt?: Date;
};

export type LeaderboardInfo = {
  group?: string | null;
  status?: "approved" | "pending" | "rejected" | null;
  requestedAt?: Date;
  approvedAt?: Date;
  note?: string;
};

export type RiotIdAlias = RiotIdAliasEntry;

export type PlayerDoc = {
  gameName: string;
  tagLine: string;
  gameNameNorm: string;
  tagLineNorm: string;
  riotIdAliases?: RiotIdAlias[];

  platform: string;
  matchRegion?: string;

  puuid?: string;
  summonerId?: string;
  profileIconId?: number;


  summonerName?: string;
  summonerLevel?: number;
  revisionDate?: number;

  lastRefreshAt?: Date;

  solo: RankSnapshot;
  flex: RankSnapshot;
  tft: RankSnapshot;


  mains?: MainChampion[];
  masterySyncedAt?: Date;

  leaderboard?: LeaderboardInfo;


  matchSync?: {
    enabled?: boolean;
    lastSyncAt?: Date;
  };

  track?: {
    lol?: boolean;
    tft?: boolean;
  };
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

const MainChampionSchema = new Schema<MainChampion>(
  {
    championId: { type: Number, required: true },
    championName: { type: String, trim: true },
    championPoints: Number,
    updatedAt: Date,
  },
  { _id: false }
);

const LeaderboardSchema = new Schema<LeaderboardInfo>(
  {
    group: { type: String, trim: true, default: null },
    status: { type: String, enum: ["approved", "pending", "rejected", null], default: null },
    requestedAt: Date,
    approvedAt: Date,
    note: { type: String, trim: true },
  },
  { _id: false }
);

const RiotIdAliasSchema = new Schema<RiotIdAlias>(
  {
    gameName: { type: String, required: true, trim: true },
    tagLine: { type: String, required: true, trim: true },
    gameNameNorm: { type: String, required: true, lowercase: true, trim: true },
    tagLineNorm: { type: String, required: true, lowercase: true, trim: true },
    observedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const PlayerSchema = new Schema<PlayerDoc>(
  {
    gameName: { type: String, required: true, trim: true },
    tagLine: { type: String, required: true, trim: true },

    gameNameNorm: { type: String, required: true, lowercase: true, trim: true, select: false },
    tagLineNorm: { type: String, required: true, lowercase: true, trim: true, select: false },
    riotIdAliases: { type: [RiotIdAliasSchema], default: () => [] },

    platform: { type: String, lowercase: true, trim: true, default: "auto" },
    matchRegion: { type: String, lowercase: true, trim: true },

    puuid: { type: String, unique: true, sparse: true },
    summonerId: { type: String, unique: true, sparse: true },
    profileIconId: Number,

    summonerName: { type: String, trim: true },
    summonerLevel: Number,
    revisionDate: Number,

    lastRefreshAt: Date,

    solo: { type: RankSnapshotSchema, default: () => ({}) },
    flex: { type: RankSnapshotSchema, default: () => ({}) },
    tft: { type: RankSnapshotSchema, default: () => ({}) },

    mains: { type: [MainChampionSchema], default: () => [] },
    masterySyncedAt: Date,

    leaderboard: { type: LeaderboardSchema, default: () => ({ group: null, status: null }) },

    matchSync: {
      enabled: { type: Boolean, default: true },
      lastSyncAt: Date,
    },

    track: {
      lol: { type: Boolean, default: true },
      tft: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

PlayerSchema.pre("validate", function (this: HydratedDocument<PlayerDoc>) {
  this.gameNameNorm = String(this.gameName ?? "").trim().toLowerCase();
  this.tagLineNorm = String(this.tagLine ?? "").trim().toLowerCase();
});


PlayerSchema.index({ gameNameNorm: 1, tagLineNorm: 1 }, { unique: true });
PlayerSchema.index({ "riotIdAliases.gameNameNorm": 1, "riotIdAliases.tagLineNorm": 1 });


PlayerSchema.index({ "leaderboard.group": 1, "leaderboard.status": 1, updatedAt: -1 });


PlayerSchema.index({ gameName: 1, tagLine: 1 });


PlayerSchema.index({ lastRefreshAt: 1 });

export const Player =
  (mongoose.models.Player as mongoose.Model<PlayerDoc>) ??
  mongoose.model<PlayerDoc>("Player", PlayerSchema);
