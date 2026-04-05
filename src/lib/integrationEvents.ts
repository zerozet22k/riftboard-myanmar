import type mongoose from "mongoose";
import type { IntegrationEventType } from "@/models/integrationEvent";
import { IntegrationEvent } from "@/models/integrationEvent";

export async function recordIntegrationEvent(input: {
  eventType: IntegrationEventType;
  aggregateType: "tournament" | "match" | "team";
  aggregateId: string;
  tournamentId?: mongoose.Types.ObjectId | string | null;
  payload?: Record<string, unknown>;
}) {
  await IntegrationEvent.create({
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: String(input.aggregateId),
    tournamentId: input.tournamentId ?? null,
    payload: input.payload ?? {},
    status: "pending",
  });
}
