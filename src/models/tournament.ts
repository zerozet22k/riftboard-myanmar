import mongoose, { Schema, type HydratedDocument } from "mongoose";
import type {
  TournamentComplianceStatus,
  TournamentFormat,
  TournamentRiotState,
  TournamentStatus,
} from "@/lib/tournaments";

export type TournamentDoc = {
  name: string;
  slug: string;
  description?: string;
  publicRulesText?: string;
  organizerName?: string;
  organizerContact?: string;
  platform: string;
  matchRegion: string;
  format: TournamentFormat;
  teamSize: number;
  maxTeams: number;
  bestOf: number;
  startsAt?: Date | null;
  registrationClosesAt?: Date | null;
  checkInOpensAt?: Date | null;
  checkInClosesAt?: Date | null;
  status: TournamentStatus;
  complianceStatus: TournamentComplianceStatus;
  riotApiState: TournamentRiotState;
  policyAcknowledgedAt?: Date | null;
  policyAcknowledgedBy?: string | null;
  riotProviderId?: number | null;
  riotTournamentId?: number | null;
  riotProvisionedAt?: Date | null;
  riotLastError?: string | null;
  callbackToken: string;
  manageTokenHash: string;
  bracketGeneratedAt?: Date | null;
  bracketSize?: number | null;
  seedsLockedAt?: Date | null;
};

const TournamentSchema = new Schema<TournamentDoc>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    description: { type: String, trim: true },
    publicRulesText: { type: String, trim: true },
    organizerName: { type: String, trim: true },
    organizerContact: { type: String, trim: true },
    platform: { type: String, required: true, trim: true, lowercase: true, default: "sg2" },
    matchRegion: { type: String, required: true, trim: true, lowercase: true, default: "sea" },
    format: { type: String, enum: ["single_elimination"], default: "single_elimination" },
    teamSize: { type: Number, min: 1, max: 5, default: 5 },
    maxTeams: { type: Number, min: 2, max: 64, default: 8 },
    bestOf: { type: Number, min: 1, max: 5, default: 1 },
    startsAt: { type: Date, default: null },
    registrationClosesAt: { type: Date, default: null },
    checkInOpensAt: { type: Date, default: null },
    checkInClosesAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["draft", "registration", "check_in", "seeded", "live", "completed"],
      default: "draft",
    },
    complianceStatus: {
      type: String,
      enum: ["eligible", "blocked"],
      default: "eligible",
    },
    riotApiState: {
      type: String,
      enum: ["disabled", "not_provisioned", "provisioned"],
      default: "disabled",
    },
    policyAcknowledgedAt: { type: Date, default: null },
    policyAcknowledgedBy: { type: String, trim: true, default: null },
    riotProviderId: { type: Number, default: null },
    riotTournamentId: { type: Number, default: null },
    riotProvisionedAt: { type: Date, default: null },
    riotLastError: { type: String, trim: true, default: null },
    callbackToken: { type: String, required: true, trim: true },
    manageTokenHash: { type: String, required: true, trim: true, select: false },
    bracketGeneratedAt: { type: Date, default: null },
    bracketSize: { type: Number, default: null },
    seedsLockedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TournamentSchema.pre("validate", function (this: HydratedDocument<TournamentDoc>) {
  this.slug = String(this.slug ?? "").trim().toLowerCase();
  this.platform = String(this.platform ?? "sg2").trim().toLowerCase();
  this.matchRegion = String(this.matchRegion ?? "sea").trim().toLowerCase();
});

TournamentSchema.index({ status: 1, startsAt: 1, createdAt: -1 });
TournamentSchema.index({ complianceStatus: 1, status: 1, createdAt: -1 });

export const Tournament =
  (mongoose.models.Tournament as mongoose.Model<TournamentDoc>) ??
  mongoose.model<TournamentDoc>("Tournament", TournamentSchema);
