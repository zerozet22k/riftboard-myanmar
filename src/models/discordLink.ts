import mongoose, { Schema } from "mongoose";

export type DiscordLinkDoc = {
  discordUserId: string;
  discordUsername?: string | null;
  playerId: mongoose.Types.ObjectId;
  isPrimary?: boolean;
  gameName: string;
  tagLine: string;
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt?: Date | null;
  verifiedBinding?: boolean;
  verificationSource?: "legacy_manual" | "discord_connections" | "riot_rso" | null;
  lastVerifiedAt?: Date | null;
  lastVerifiedGuildId?: string | null;
  proofConnectionType?: string | null;
  proofConnectionLabel?: string | null;
  communityAccessCodeHash?: string | null;
  communityAccessGrantedAt?: Date | null;
  metadataSnapshot?: Record<string, unknown> | null;
  guildRankRoleTier?: string | null;
  guildRankRoleName?: string | null;
  guildRankRolesSnapshot?: Record<string, string | null> | null;
  guildRankRolesSyncedAt?: Date | null;
  lastSyncedAt?: Date | null;
};

const DiscordLinkSchema = new Schema<DiscordLinkDoc>(
  {
    discordUserId: { type: String, required: true, trim: true, index: true },
    discordUsername: { type: String, trim: true, default: null },
    playerId: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
    isPrimary: { type: Boolean, default: false, index: true },
    gameName: { type: String, required: true, trim: true },
    tagLine: { type: String, required: true, trim: true },
    accessTokenEnc: { type: String, required: true, trim: true },
    refreshTokenEnc: { type: String, trim: true, default: null },
    tokenType: { type: String, required: true, trim: true, default: "Bearer" },
    scopes: { type: [String], default: () => [] },
    expiresAt: { type: Date, default: null },
    verifiedBinding: { type: Boolean, default: false },
    verificationSource: {
      type: String,
      enum: ["legacy_manual", "discord_connections", "riot_rso", null],
      default: "legacy_manual",
    },
    lastVerifiedAt: { type: Date, default: null },
    lastVerifiedGuildId: { type: String, trim: true, default: null },
    proofConnectionType: { type: String, trim: true, default: null },
    proofConnectionLabel: { type: String, trim: true, default: null },
    communityAccessCodeHash: { type: String, trim: true, default: null },
    communityAccessGrantedAt: { type: Date, default: null },
    metadataSnapshot: { type: Schema.Types.Mixed, default: null },
    guildRankRoleTier: { type: String, trim: true, default: null },
    guildRankRoleName: { type: String, trim: true, default: null },
    guildRankRolesSnapshot: { type: Schema.Types.Mixed, default: null },
    guildRankRolesSyncedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

DiscordLinkSchema.index({ discordUserId: 1, isPrimary: -1, updatedAt: -1 });
DiscordLinkSchema.index({ discordUserId: 1, playerId: 1 }, { unique: true });
DiscordLinkSchema.index({ playerId: 1, updatedAt: -1 });

export const DiscordLink =
  (mongoose.models.DiscordLink as mongoose.Model<DiscordLinkDoc>) ??
  mongoose.model<DiscordLinkDoc>("DiscordLink", DiscordLinkSchema);
