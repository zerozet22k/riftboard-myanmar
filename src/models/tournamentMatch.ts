import mongoose, { Schema } from "mongoose";
import type { BracketSide, TournamentMatchStatus, TournamentResultSource } from "@/lib/tournaments";

export type TournamentMatchDoc = {
  tournamentId: mongoose.Types.ObjectId;
  round: number;
  slot: number;
  bestOf: number;
  teamAId?: mongoose.Types.ObjectId | null;
  teamBId?: mongoose.Types.ObjectId | null;
  teamASeed?: number | null;
  teamBSeed?: number | null;
  winnerTeamId?: mongoose.Types.ObjectId | null;
  loserTeamId?: mongoose.Types.ObjectId | null;
  status: TournamentMatchStatus;
  scoreA?: number;
  scoreB?: number;
  note?: string;
  tournamentCode?: string | null;
  codeMetadata?: string | null;
  codeGeneratedAt?: Date | null;
  linkedMatchId?: string | null;
  resultSource?: TournamentResultSource | null;
  completedAt?: Date | null;
  advanceToRound?: number | null;
  advanceToSlot?: number | null;
  advanceToSide?: BracketSide | null;
  callbackCount?: number;
  lastCallbackAt?: Date | null;
  lastCallbackPayload?: unknown;
};

const TournamentMatchSchema = new Schema<TournamentMatchDoc>(
  {
    tournamentId: { type: Schema.Types.ObjectId, ref: "Tournament", required: true, index: true },
    round: { type: Number, required: true },
    slot: { type: Number, required: true },
    bestOf: { type: Number, required: true, default: 1 },
    teamAId: { type: Schema.Types.ObjectId, ref: "TournamentTeam", default: null },
    teamBId: { type: Schema.Types.ObjectId, ref: "TournamentTeam", default: null },
    teamASeed: { type: Number, default: null },
    teamBSeed: { type: Number, default: null },
    winnerTeamId: { type: Schema.Types.ObjectId, ref: "TournamentTeam", default: null },
    loserTeamId: { type: Schema.Types.ObjectId, ref: "TournamentTeam", default: null },
    status: {
      type: String,
      enum: ["pending", "ready", "code_ready", "completed"],
      default: "pending",
    },
    scoreA: { type: Number, default: 0 },
    scoreB: { type: Number, default: 0 },
    note: { type: String, trim: true },
    tournamentCode: { type: String, trim: true, default: null },
    codeMetadata: { type: String, trim: true, default: null },
    codeGeneratedAt: { type: Date, default: null },
    linkedMatchId: { type: String, trim: true, default: null },
    resultSource: { type: String, enum: ["callback", "sync", "manual", null], default: null },
    completedAt: { type: Date, default: null },
    advanceToRound: { type: Number, default: null },
    advanceToSlot: { type: Number, default: null },
    advanceToSide: { type: String, enum: ["A", "B", null], default: null },
    callbackCount: { type: Number, default: 0 },
    lastCallbackAt: { type: Date, default: null },
    lastCallbackPayload: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

TournamentMatchSchema.index({ tournamentId: 1, round: 1, slot: 1 }, { unique: true });
TournamentMatchSchema.index({ tournamentId: 1, status: 1, round: 1, slot: 1 });
TournamentMatchSchema.index({ tournamentId: 1, tournamentCode: 1 }, { unique: true, sparse: true });

export const TournamentMatch =
  (mongoose.models.TournamentMatch as mongoose.Model<TournamentMatchDoc>) ??
  mongoose.model<TournamentMatchDoc>("TournamentMatch", TournamentMatchSchema);
