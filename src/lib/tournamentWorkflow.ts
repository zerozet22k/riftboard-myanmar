import type mongoose from "mongoose";
import { recordIntegrationEvent } from "@/lib/integrationEvents";
import { getMatchById } from "@/lib/riot";
import type { TournamentDoc } from "@/models/tournament";
import type { TournamentMatchDoc } from "@/models/tournamentMatch";
import { TournamentMatch } from "@/models/tournamentMatch";
import { TournamentTeam } from "@/models/tournamentTeam";
import type { TournamentResultSource } from "@/lib/tournaments";

type TournamentLean = TournamentDoc & { _id: mongoose.Types.ObjectId };
type MatchDocument = mongoose.Document<unknown, object, TournamentMatchDoc> &
  TournamentMatchDoc & { _id: mongoose.Types.ObjectId };

type RiotMatchParticipant = {
  puuid?: string;
  win?: boolean;
};

type RiotMatchPayload = {
  metadata?: {
    matchId?: string;
  };
  info?: {
    participants?: RiotMatchParticipant[];
  };
};

function asRiotMatchPayload(value: unknown) {
  if (!value || typeof value !== "object") return {} as RiotMatchPayload;
  return value as RiotMatchPayload;
}

function participantArray(value: RiotMatchPayload) {
  return Array.isArray(value.info?.participants) ? value.info.participants : [];
}

export function firstPayloadString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function extractTournamentCodeFromPayload(payload: unknown) {
  const source = payload as Record<string, unknown>;
  return firstPayloadString([
    source?.shortCode,
    source?.tournamentCode,
    source?.code,
    source?.shortcode,
  ]);
}

export function extractLinkedMatchId(value: unknown) {
  const source = value as Record<string, unknown>;
  return firstPayloadString([
    source?.matchId,
    source?.gameId,
    source?.gameID,
    source?.id,
  ]);
}

function scoreForWinner(match: MatchDocument, winnerTeamId: string) {
  const teamAId = match.teamAId ? String(match.teamAId) : null;
  return {
    scoreA: winnerTeamId === teamAId ? 1 : 0,
    scoreB: winnerTeamId === teamAId ? 0 : 1,
  };
}

export async function applyTournamentMatchOutcome(params: {
  tournament: TournamentLean;
  match: MatchDocument;
  winnerTeamId: string;
  resultSource: TournamentResultSource;
  note?: string | null;
  linkedMatchId?: string | null;
  scoreA?: number;
  scoreB?: number;
  callbackPayload?: unknown;
}) {
  const { tournament, match } = params;
  const winnerId = String(params.winnerTeamId);
  const teamAId = match.teamAId ? String(match.teamAId) : null;
  const teamBId = match.teamBId ? String(match.teamBId) : null;

  if (winnerId !== teamAId && winnerId !== teamBId) {
    throw new Error("Winner must be one of the two teams in this match");
  }

  if (match.status === "completed" && match.winnerTeamId && String(match.winnerTeamId) === winnerId) {
    return { ok: true, alreadyCompleted: true as const };
  }

  const loserId = winnerId === teamAId ? teamBId : teamAId;
  const winnerSeed = winnerId === teamAId ? match.teamASeed ?? null : match.teamBSeed ?? null;
  const fallbackScore = scoreForWinner(match, winnerId);

  match.winnerTeamId = winnerId as unknown as mongoose.Types.ObjectId;
  match.loserTeamId = loserId ? (loserId as unknown as mongoose.Types.ObjectId) : null;
  match.status = "completed";
  match.resultSource = params.resultSource;
  match.note = params.note?.trim() || match.note;
  match.linkedMatchId = params.linkedMatchId ?? match.linkedMatchId ?? null;
  match.completedAt = new Date();
  match.scoreA = params.scoreA ?? fallbackScore.scoreA;
  match.scoreB = params.scoreB ?? fallbackScore.scoreB;
  if (params.callbackPayload !== undefined) {
    match.lastCallbackAt = new Date();
    match.lastCallbackPayload = params.callbackPayload;
  }
  await match.save();

  if (loserId) {
    await TournamentTeam.updateOne(
      { _id: loserId },
      { $set: { status: "eliminated", checkedIn: true } }
    );
  }

  if (match.advanceToRound && match.advanceToSlot && match.advanceToSide) {
    const updatePath = match.advanceToSide === "A" ? "teamAId" : "teamBId";
    const updateSeedPath = match.advanceToSide === "A" ? "teamASeed" : "teamBSeed";

    const nextMatch = await TournamentMatch.findOne({
      tournamentId: tournament._id,
      round: match.advanceToRound,
      slot: match.advanceToSlot,
    });

    if (nextMatch?._id) {
      nextMatch.set(updatePath, winnerId);
      nextMatch.set(updateSeedPath, winnerSeed);
      nextMatch.status = nextMatch.teamAId && nextMatch.teamBId ? "ready" : "pending";
      await nextMatch.save();
    }

    await TournamentTeam.updateOne({ _id: winnerId }, { $set: { status: "active", checkedIn: true } });
  } else {
    await TournamentTeam.updateOne({ _id: winnerId }, { $set: { status: "winner", checkedIn: true } });
    tournament.status = "completed";
    await (tournament as unknown as { save: () => Promise<unknown> }).save();
    await recordIntegrationEvent({
      eventType: "tournament_completed",
      aggregateType: "tournament",
      aggregateId: String(tournament._id),
      tournamentId: tournament._id,
      payload: {
        tournamentId: String(tournament._id),
        slug: tournament.slug,
        winnerTeamId: winnerId,
      },
    });
  }

  await recordIntegrationEvent({
    eventType: "match_completed",
    aggregateType: "match",
    aggregateId: String(match._id),
    tournamentId: tournament._id,
    payload: {
      tournamentId: String(tournament._id),
      matchId: String(match._id),
      round: match.round,
      slot: match.slot,
      winnerTeamId: winnerId,
      loserTeamId: loserId,
      resultSource: params.resultSource,
      linkedMatchId: match.linkedMatchId ?? null,
    },
  });

  return { ok: true, alreadyCompleted: false as const };
}

async function determineWinnerFromRiotMatch(params: {
  match: MatchDocument;
  riotMatch: unknown;
}) {
  const payload = asRiotMatchPayload(params.riotMatch);
  const participants = participantArray(payload);
  if (!participants.length) {
    throw new Error("Riot match payload did not include participants");
  }

  const [teamA, teamB] = await Promise.all([
    params.match.teamAId
      ? TournamentTeam.findById(params.match.teamAId, { roster: 1, name: 1 }).lean()
      : null,
    params.match.teamBId
      ? TournamentTeam.findById(params.match.teamBId, { roster: 1, name: 1 }).lean()
      : null,
  ]);

  const teamAPuuids = new Set(
    Array.isArray(teamA?.roster) ? teamA.roster.map((entry) => String(entry.puuid ?? "").trim()).filter(Boolean) : []
  );
  const teamBPuuids = new Set(
    Array.isArray(teamB?.roster) ? teamB.roster.map((entry) => String(entry.puuid ?? "").trim()).filter(Boolean) : []
  );

  let teamAWins = 0;
  let teamBWins = 0;

  for (const participant of participants) {
    const puuid = String(participant?.puuid ?? "").trim();
    if (!puuid) continue;
    if (teamAPuuids.has(puuid) && participant.win) teamAWins += 1;
    if (teamBPuuids.has(puuid) && participant.win) teamBWins += 1;
  }

  const teamAId = params.match.teamAId ? String(params.match.teamAId) : null;
  const teamBId = params.match.teamBId ? String(params.match.teamBId) : null;

  if (teamAWins > teamBWins && teamAId) {
    return { winnerTeamId: teamAId, scoreA: 1, scoreB: 0 };
  }

  if (teamBWins > teamAWins && teamBId) {
    return { winnerTeamId: teamBId, scoreA: 0, scoreB: 1 };
  }

  throw new Error("Could not determine a winning roster from Riot match data");
}

export async function syncTournamentMatchFromRiot(params: {
  tournament: TournamentLean;
  match: MatchDocument;
  linkedMatchId: string;
  resultSource: Extract<TournamentResultSource, "callback" | "sync">;
  callbackPayload?: unknown;
}) {
  const riotMatch = await getMatchById(params.linkedMatchId, params.tournament.matchRegion);
  const winner = await determineWinnerFromRiotMatch({ match: params.match, riotMatch });

  return applyTournamentMatchOutcome({
    tournament: params.tournament,
    match: params.match,
    winnerTeamId: winner.winnerTeamId,
    resultSource: params.resultSource,
    linkedMatchId: params.linkedMatchId,
    scoreA: winner.scoreA,
    scoreB: winner.scoreB,
    callbackPayload: params.callbackPayload,
    note:
      params.resultSource === "callback"
        ? "Result completed via Riot tournament callback."
        : "Result synchronized from Riot tournament data.",
  });
}
