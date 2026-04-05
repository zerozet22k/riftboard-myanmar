import mongoose, { Schema } from "mongoose";

export type TournamentProviderDoc = {
  platform: string;
  callbackBaseUrl: string;
  apiKeyHash: string;
  providerId: number;
};

const TournamentProviderSchema = new Schema<TournamentProviderDoc>(
  {
    platform: { type: String, required: true, trim: true, lowercase: true },
    callbackBaseUrl: { type: String, required: true, trim: true },
    apiKeyHash: { type: String, required: true, trim: true },
    providerId: { type: Number, required: true },
  },
  { timestamps: true }
);

TournamentProviderSchema.index(
  { platform: 1, callbackBaseUrl: 1, apiKeyHash: 1 },
  { unique: true }
);

export const TournamentProvider =
  (mongoose.models.TournamentProvider as mongoose.Model<TournamentProviderDoc>) ??
  mongoose.model<TournamentProviderDoc>("TournamentProvider", TournamentProviderSchema);
