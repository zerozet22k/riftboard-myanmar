import mongoose, { Schema } from "mongoose";

export type IntegrationEventType =
  | "team_registered"
  | "team_checked_in"
  | "bracket_locked"
  | "match_code_ready"
  | "match_completed"
  | "tournament_completed";

export type IntegrationEventDoc = {
  eventType: IntegrationEventType;
  aggregateType: "tournament" | "match" | "team";
  aggregateId: string;
  tournamentId?: mongoose.Types.ObjectId | null;
  payload: Record<string, unknown>;
  status: "pending";
};

const IntegrationEventSchema = new Schema<IntegrationEventDoc>(
  {
    eventType: {
      type: String,
      enum: [
        "team_registered",
        "team_checked_in",
        "bracket_locked",
        "match_code_ready",
        "match_completed",
        "tournament_completed",
      ],
      required: true,
    },
    aggregateType: { type: String, enum: ["tournament", "match", "team"], required: true },
    aggregateId: { type: String, required: true, trim: true },
    tournamentId: { type: Schema.Types.ObjectId, ref: "Tournament", default: null, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending"], default: "pending" },
  },
  { timestamps: true }
);

IntegrationEventSchema.index({ status: 1, createdAt: 1 });
IntegrationEventSchema.index({ eventType: 1, createdAt: -1 });

export const IntegrationEvent =
  (mongoose.models.IntegrationEvent as mongoose.Model<IntegrationEventDoc>) ??
  mongoose.model<IntegrationEventDoc>("IntegrationEvent", IntegrationEventSchema);
