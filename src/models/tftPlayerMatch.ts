import mongoose, { Schema } from "mongoose";

export type TftUnit = {
  characterId?: string;
  name?: string;
  rarity?: number;
  tier?: number;
  itemNames?: string[];
};

export type TftTrait = {
  name?: string;
  numUnits?: number;
  style?: number;
  tierCurrent?: number;
  tierTotal?: number;
};

export type TftPlayerMatchDoc = {
  playerId: mongoose.Types.ObjectId;
  matchId: string;
  region?: string;
  queueId?: number;
  gameDatetime?: number;
  gameLength?: number;
  setNumber?: number;
  placement?: number;
  level?: number;
  lastRound?: number;
  playersEliminated?: number;
  totalDamageToPlayers?: number;
  goldLeft?: number;
  timeEliminated?: number;
  companionContentId?: string;
  augments?: string[];
  traits?: TftTrait[];
  units?: TftUnit[];
  fetchedAt?: Date;
};

const TftUnitSchema = new Schema<TftUnit>(
  {
    characterId: { type: String, trim: true },
    name: { type: String, trim: true },
    rarity: Number,
    tier: Number,
    itemNames: { type: [String], default: () => [] },
  },
  { _id: false }
);

const TftTraitSchema = new Schema<TftTrait>(
  {
    name: { type: String, trim: true },
    numUnits: Number,
    style: Number,
    tierCurrent: Number,
    tierTotal: Number,
  },
  { _id: false }
);

const TftPlayerMatchSchema = new Schema<TftPlayerMatchDoc>(
  {
    playerId: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
    matchId: { type: String, required: true, trim: true, index: true },
    region: { type: String, lowercase: true, trim: true },
    queueId: Number,
    gameDatetime: Number,
    gameLength: Number,
    setNumber: Number,
    placement: Number,
    level: Number,
    lastRound: Number,
    playersEliminated: Number,
    totalDamageToPlayers: Number,
    goldLeft: Number,
    timeEliminated: Number,
    companionContentId: { type: String, trim: true },
    augments: { type: [String], default: () => [] },
    traits: { type: [TftTraitSchema], default: () => [] },
    units: { type: [TftUnitSchema], default: () => [] },
    fetchedAt: Date,
  },
  { timestamps: false }
);

TftPlayerMatchSchema.index({ playerId: 1, matchId: 1 }, { unique: true });
TftPlayerMatchSchema.index({ playerId: 1, gameDatetime: -1 });

export const TftPlayerMatch =
  (mongoose.models.TftPlayerMatch as mongoose.Model<TftPlayerMatchDoc>) ??
  mongoose.model<TftPlayerMatchDoc>("TftPlayerMatch", TftPlayerMatchSchema);
