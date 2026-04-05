import mongoose, { Schema } from "mongoose";
import type {
  TournamentInviteStatus,
  TournamentRosterEntry,
  TournamentTeamStatus,
  TournamentTeamVerificationMode,
} from "@/lib/tournaments";

export type TournamentTeamDoc = {
  tournamentId: mongoose.Types.ObjectId;
  name: string;
  nameNorm: string;
  contactDiscord?: string;
  roster: TournamentRosterEntry[];
  status: TournamentTeamStatus;
  verificationMode?: TournamentTeamVerificationMode | null;
  checkedIn?: boolean;
  checkedInAt?: Date | null;
  seed?: number | null;
};

const TournamentRosterSchema = new Schema<TournamentRosterEntry>(
  {
    gameName: { type: String, required: true, trim: true },
    tagLine: { type: String, required: true, trim: true },
    puuid: { type: String, trim: true },
    playerId: { type: Schema.Types.ObjectId, ref: "Player", default: null },
    discordUserId: { type: String, trim: true, default: null },
    discordUsername: { type: String, trim: true, default: null },
    isCaptain: { type: Boolean, default: false },
    gameNameNorm: { type: String, required: true, trim: true, lowercase: true },
    tagLineNorm: { type: String, required: true, trim: true, lowercase: true },
    inviteStatus: {
      type: String,
      enum: ["accepted", "pending", "declined"] satisfies TournamentInviteStatus[],
      default: "accepted",
    },
    invitedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
  },
  { _id: false }
);

const TournamentTeamSchema = new Schema<TournamentTeamDoc>(
  {
    tournamentId: { type: Schema.Types.ObjectId, ref: "Tournament", required: true, index: true },
    name: { type: String, required: true, trim: true },
    nameNorm: { type: String, required: true, trim: true, lowercase: true },
    contactDiscord: { type: String, trim: true },
    roster: { type: [TournamentRosterSchema], default: () => [] },
    status: {
      type: String,
      enum: ["forming", "registered", "checked_in", "active", "eliminated", "winner", "dropped"],
      default: "forming",
    },
    verificationMode: {
      type: String,
      enum: ["legacy_manual", "discord_verified", null] satisfies Array<TournamentTeamVerificationMode | null>,
      default: "legacy_manual",
    },
    checkedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date, default: null },
    seed: { type: Number, default: null },
  },
  { timestamps: true }
);

TournamentTeamSchema.index({ tournamentId: 1, nameNorm: 1 }, { unique: true });
TournamentTeamSchema.index({ tournamentId: 1, "roster.puuid": 1 });
TournamentTeamSchema.index({ tournamentId: 1, "roster.discordUserId": 1 });
TournamentTeamSchema.index({ tournamentId: 1, verificationMode: 1, status: 1, createdAt: 1 });
TournamentTeamSchema.index({ tournamentId: 1, checkedIn: 1, seed: 1, createdAt: 1 });
TournamentTeamSchema.index({ tournamentId: 1, status: 1, seed: 1, createdAt: 1 });

export const TournamentTeam =
  (mongoose.models.TournamentTeam as mongoose.Model<TournamentTeamDoc>) ??
  mongoose.model<TournamentTeamDoc>("TournamentTeam", TournamentTeamSchema);
