import mongoose, { Schema } from "mongoose";

export type LiveGamePostDoc = {
  channelId: string;
  platform: string;
  gameId: number;
  playerIds: mongoose.Types.ObjectId[];
  riotIds: string[];
  messageId?: string | null;
  postedAt?: Date | null;
  lastSeenAt: Date;
  error?: string | null;
};

const LiveGamePostSchema = new Schema<LiveGamePostDoc>(
  {
    channelId: { type: String, required: true, trim: true },
    platform: { type: String, required: true, lowercase: true, trim: true },
    gameId: { type: Number, required: true },
    playerIds: { type: [Schema.Types.ObjectId], ref: "Player", default: () => [] },
    riotIds: { type: [String], default: () => [] },
    messageId: { type: String, trim: true, default: null },
    postedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    error: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

LiveGamePostSchema.index({ channelId: 1, platform: 1, gameId: 1 }, { unique: true });
LiveGamePostSchema.index({ lastSeenAt: -1 });

export const LiveGamePost =
  (mongoose.models.LiveGamePost as mongoose.Model<LiveGamePostDoc>) ??
  mongoose.model<LiveGamePostDoc>("LiveGamePost", LiveGamePostSchema);
