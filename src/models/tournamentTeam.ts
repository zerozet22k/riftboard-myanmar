import mongoose, { Schema } from "mongoose";
import type { TournamentRosterEntry, TournamentTeamStatus } from "@/lib/tournaments";

export type TournamentTeamDoc = {
  tournamentId: mongoose.Types.ObjectId;
  name: string;
  nameNorm: string;
  contactDiscord?: string;
  roster: TournamentRosterEntry[];
  status: TournamentTeamStatus;
  checkedIn?: boolean;
  seed?: number | null;
};

const TournamentRosterSchema = new Schema<TournamentRosterEntry>(
  {
    gameName: { type: String, required: true, trim: true },
    tagLine: { type: String, required: true, trim: true },
    puuid: { type: String, trim: true },
    isCaptain: { type: Boolean, default: false },
    gameNameNorm: { type: String, required: true, trim: true, lowercase: true },
    tagLineNorm: { type: String, required: true, trim: true, lowercase: true },
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
      enum: ["registered", "checked_in", "active", "eliminated", "winner", "dropped"],
      default: "registered",
    },
    checkedIn: { type: Boolean, default: false },
    seed: { type: Number, default: null },
  },
  { timestamps: true }
);

TournamentTeamSchema.index({ tournamentId: 1, nameNorm: 1 }, { unique: true });
TournamentTeamSchema.index({ tournamentId: 1, "roster.puuid": 1 });
TournamentTeamSchema.index({ tournamentId: 1, status: 1, seed: 1, createdAt: 1 });

export const TournamentTeam =
  (mongoose.models.TournamentTeam as mongoose.Model<TournamentTeamDoc>) ??
  mongoose.model<TournamentTeamDoc>("TournamentTeam", TournamentTeamSchema);
