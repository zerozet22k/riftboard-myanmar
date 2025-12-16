import mongoose, { Schema, type HydratedDocument } from "mongoose";

type RankSnapshot = {
  tier?: string;
  division?: string;
  lp?: number;
  wins?: number;
  losses?: number;
  fetchedAt?: Date;
};

type MainChampion = {
  championId: number;
  championName?: string;
  championPoints?: number;
  updatedAt?: Date;
};

export type PlayerDoc = {
  gameName: string;
  tagLine: string;
  gameNameNorm: string;
  tagLineNorm: string;
  platform: string;
  puuid?: string;
  summonerId?: string;
  profileIconId?: number;

  // ✅ last time we successfully refreshed this player from Riot
  lastRefreshAt?: Date;

  solo: RankSnapshot;
  flex: RankSnapshot;

  // ✅ top mastery champs (store max 3)
  mains?: MainChampion[];
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
    championPoints: { type: Number },
    updatedAt: { type: Date },
  },
  { _id: false }
);

const PlayerSchema = new Schema<PlayerDoc>(
  {
    gameName: { type: String, required: true, trim: true },
    tagLine: { type: String, required: true, trim: true },

    gameNameNorm: { type: String, required: true, lowercase: true, trim: true, select: false },
    tagLineNorm: { type: String, required: true, lowercase: true, trim: true, select: false },

    platform: { type: String, lowercase: true, trim: true, default: "auto" },

    puuid: { type: String, unique: true, sparse: true },
    summonerId: { type: String, unique: true, sparse: true },
    profileIconId: Number,

    lastRefreshAt: Date,

    solo: { type: RankSnapshotSchema, default: () => ({}) },
    flex: { type: RankSnapshotSchema, default: () => ({}) },

    mains: { type: [MainChampionSchema], default: () => [] },
  },
  { timestamps: true }
);

PlayerSchema.pre("validate", function (this: HydratedDocument<PlayerDoc>) {
  this.gameNameNorm = String(this.gameName ?? "").trim().toLowerCase();
  this.tagLineNorm = String(this.tagLine ?? "").trim().toLowerCase();
});

PlayerSchema.index({ gameNameNorm: 1, tagLineNorm: 1 }, { unique: true });

export const Player =
  (mongoose.models.Player as mongoose.Model<PlayerDoc>) ??
  mongoose.model<PlayerDoc>("Player", PlayerSchema);
