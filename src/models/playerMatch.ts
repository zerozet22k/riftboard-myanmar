// models/playerMatch.ts
import mongoose, { Schema } from "mongoose";

export type PlayerMatchDoc = {
  playerId: mongoose.Types.ObjectId;
  matchId: string; // Match.matchId
  region?: string;

  queueId?: number;
  gameCreation?: number;
  gameDuration?: number;

  championId?: number;
  teamId?: number;
  win?: boolean;

  kills?: number;
  deaths?: number;
  assists?: number;

  cs?: number;
  gold?: number;

  items?: number[];
  summonerSpells?: number[];

  primaryStyle?: number;
  primaryRune?: number;
  subStyle?: number;

  fetchedAt?: Date;
};

const PlayerMatchSchema = new Schema<PlayerMatchDoc>(
  {
    playerId: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
    matchId: { type: String, required: true, trim: true, index: true },
    region: { type: String, lowercase: true, trim: true },

    queueId: Number,
    gameCreation: Number,
    gameDuration: Number,

    championId: Number,
    teamId: Number,
    win: Boolean,

    kills: Number,
    deaths: Number,
    assists: Number,

    cs: Number,
    gold: Number,

    items: { type: [Number], default: () => [] },
    summonerSpells: { type: [Number], default: () => [] },

    primaryStyle: Number,
    primaryRune: Number,
    subStyle: Number,

    fetchedAt: Date,
  },
  { timestamps: false }
);

PlayerMatchSchema.index({ playerId: 1, matchId: 1 }, { unique: true });
PlayerMatchSchema.index({ playerId: 1, gameCreation: -1 });

export const PlayerMatch =
  (mongoose.models.PlayerMatch as mongoose.Model<PlayerMatchDoc>) ??
  mongoose.model<PlayerMatchDoc>("PlayerMatch", PlayerMatchSchema);
