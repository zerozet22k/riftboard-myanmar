import mongoose, { Schema } from "mongoose";

export type DiscordAccountDoc = {
  discordUserId: string;
  discordUsername?: string | null;
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt?: Date | null;
  lastVerifiedAt?: Date | null;
  lastVerifiedGuildId?: string | null;
  communityAccessCodeHash?: string | null;
  communityAccessGrantedAt?: Date | null;
};

const DiscordAccountSchema = new Schema<DiscordAccountDoc>(
  {
    discordUserId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    discordUsername: { type: String, trim: true, default: null },
    accessTokenEnc: { type: String, required: true, trim: true },
    refreshTokenEnc: { type: String, trim: true, default: null },
    tokenType: { type: String, required: true, trim: true, default: "Bearer" },
    scopes: { type: [String], default: () => [] },
    expiresAt: { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null },
    lastVerifiedGuildId: { type: String, trim: true, default: null },
    communityAccessCodeHash: { type: String, trim: true, default: null },
    communityAccessGrantedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const DiscordAccount =
  (mongoose.models.DiscordAccount as mongoose.Model<DiscordAccountDoc>) ??
  mongoose.model<DiscordAccountDoc>("DiscordAccount", DiscordAccountSchema);
