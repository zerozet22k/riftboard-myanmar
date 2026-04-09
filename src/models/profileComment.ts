import mongoose, { Schema } from "mongoose";

export type ProfileCommentDoc = {
  profilePlayerId: mongoose.Types.ObjectId;
  authorDiscordUserId: string;
  authorDiscordUsername: string;
  authorGameName: string;
  authorTagLine: string;
  body: string;
  createdAt?: Date;
};

const ProfileCommentSchema = new Schema<ProfileCommentDoc>(
  {
    profilePlayerId: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
    authorDiscordUserId: { type: String, required: true, trim: true },
    authorDiscordUsername: { type: String, required: true, trim: true },
    authorGameName: { type: String, required: true, trim: true },
    authorTagLine: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

ProfileCommentSchema.index({ profilePlayerId: 1, createdAt: -1 });
ProfileCommentSchema.index({ authorDiscordUserId: 1 });

export const ProfileComment =
  (mongoose.models.ProfileComment as mongoose.Model<ProfileCommentDoc>) ??
  mongoose.model<ProfileCommentDoc>("ProfileComment", ProfileCommentSchema);
