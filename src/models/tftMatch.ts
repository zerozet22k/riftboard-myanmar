import mongoose, { Schema } from "mongoose";

export type TftMatchDoc = {
  matchId: string;
  region: string;
  queueId?: number;
  gameDatetime?: number;
  gameLength?: number;
  setNumber?: number;
  raw?: any;
  fetchedAt: Date;
};

const TftMatchSchema = new Schema<TftMatchDoc>(
  {
    matchId: { type: String, required: true, trim: true, unique: true },
    region: { type: String, required: true, lowercase: true, trim: true, index: true },
    queueId: Number,
    gameDatetime: Number,
    gameLength: Number,
    setNumber: Number,
    raw: Schema.Types.Mixed,
    fetchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

TftMatchSchema.index({ region: 1, gameDatetime: -1 });

export const TftMatch =
  (mongoose.models.TftMatch as mongoose.Model<TftMatchDoc>) ??
  mongoose.model<TftMatchDoc>("TftMatch", TftMatchSchema);
