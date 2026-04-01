import crypto from "node:crypto";
import type { Types } from "mongoose";

export type TournamentFormat = "single_elimination";
export type TournamentStatus = "registration" | "live" | "completed";
export type TournamentTeamStatus =
  | "registered"
  | "checked_in"
  | "active"
  | "eliminated"
  | "winner"
  | "dropped";
export type TournamentMatchStatus = "pending" | "ready" | "code_ready" | "completed";
export type BracketSide = "A" | "B";

export type TournamentRosterEntryInput = {
  gameName: string;
  tagLine: string;
  puuid?: string | null;
  isCaptain?: boolean;
};

export type TournamentRosterEntry = TournamentRosterEntryInput & {
  puuid?: string;
  gameNameNorm: string;
  tagLineNorm: string;
};

export type BracketSeedTeam = {
  id: string;
  seed: number;
};

export type BracketMatchSeed = {
  round: number;
  slot: number;
  bestOf: number;
  teamAId: Types.ObjectId | null;
  teamBId: Types.ObjectId | null;
  teamASeed: number | null;
  teamBSeed: number | null;
  winnerTeamId: Types.ObjectId | null;
  loserTeamId: Types.ObjectId | null;
  status: TournamentMatchStatus;
  note?: string;
  advanceToRound: number | null;
  advanceToSlot: number | null;
  advanceToSide: BracketSide | null;
  scoreA: number;
  scoreB: number;
};

export function slugifyTournamentName(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function parseRiotId(input: string) {
  const raw = String(input ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s*\/\s*/g, "#")
    .replace(/\s*#\s*/g, "#")
    .replace(/#+/g, "#")
    .trim();

  if (!raw) return null;

  if (raw.includes("#")) {
    const idx = raw.lastIndexOf("#");
    const gameName = raw.slice(0, idx).trim();
    const tagLine = raw.slice(idx + 1).trim();
    return gameName && tagLine ? { gameName, tagLine } : null;
  }

  const match = raw.match(/^(.*\S)\s+(\S+)$/);
  if (!match) return null;
  return {
    gameName: match[1].trim(),
    tagLine: match[2].trim(),
  };
}

export function normalizeRiotText(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

export function makeRosterEntry(input: TournamentRosterEntryInput): TournamentRosterEntry {
  return {
    gameName: String(input.gameName ?? "").trim(),
    tagLine: String(input.tagLine ?? "").trim(),
    puuid: input.puuid ? String(input.puuid).trim() : undefined,
    isCaptain: !!input.isCaptain,
    gameNameNorm: normalizeRiotText(input.gameName),
    tagLineNorm: normalizeRiotText(input.tagLine),
  };
}

export function parseRosterLines(text: string) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function nextPowerOfTwo(input: number) {
  let value = 1;
  while (value < input) value *= 2;
  return value;
}

function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  const previous = seedOrder(size / 2);
  const out: number[] = [];
  for (const seed of previous) {
    out.push(seed);
    out.push(size + 1 - seed);
  }
  return out;
}

export function nextMatchPointer(round: number, slot: number, totalRounds: number) {
  if (round >= totalRounds) {
    return { round: null, slot: null, side: null as BracketSide | null };
  }

  return {
    round: round + 1,
    slot: Math.ceil(slot / 2),
    side: slot % 2 === 1 ? ("A" as const) : ("B" as const),
  };
}

function asObjectId(value: string) {
  return value as unknown as Types.ObjectId;
}

export function buildSingleElimBracket(teams: BracketSeedTeam[], bestOf: number) {
  const activeTeams = [...teams].sort((a, b) => a.seed - b.seed);
  const bracketSize = nextPowerOfTwo(Math.max(2, activeTeams.length));
  const totalRounds = Math.log2(bracketSize);
  const positions = seedOrder(bracketSize);
  const seededSlots = positions.map((seed) => activeTeams.find((team) => team.seed === seed) ?? null);
  const matches: BracketMatchSeed[] = [];

  for (let round = 1; round <= totalRounds; round++) {
    const matchCount = bracketSize / 2 ** round;
    for (let slot = 1; slot <= matchCount; slot++) {
      const advance = nextMatchPointer(round, slot, totalRounds);

      let teamAId: Types.ObjectId | null = null;
      let teamBId: Types.ObjectId | null = null;
      let teamASeed: number | null = null;
      let teamBSeed: number | null = null;

      if (round === 1) {
        const left = seededSlots[(slot - 1) * 2] ?? null;
        const right = seededSlots[(slot - 1) * 2 + 1] ?? null;
        teamAId = left ? asObjectId(left.id) : null;
        teamBId = right ? asObjectId(right.id) : null;
        teamASeed = left?.seed ?? null;
        teamBSeed = right?.seed ?? null;
      }

      matches.push({
        round,
        slot,
        bestOf,
        teamAId,
        teamBId,
        teamASeed,
        teamBSeed,
        winnerTeamId: null,
        loserTeamId: null,
        status: teamAId && teamBId ? "ready" : "pending",
        note: undefined,
        advanceToRound: advance.round,
        advanceToSlot: advance.slot,
        advanceToSide: advance.side,
        scoreA: 0,
        scoreB: 0,
      });
    }
  }

  for (const match of matches.filter((entry) => entry.round === 1)) {
    if (!!match.teamAId === !!match.teamBId) continue;

    match.winnerTeamId = match.teamAId ?? match.teamBId;
    match.loserTeamId = null;
    match.status = "completed";
    match.note = "BYE";
    match.scoreA = match.teamAId ? 1 : 0;
    match.scoreB = match.teamBId ? 1 : 0;

    if (match.advanceToRound && match.advanceToSlot && match.advanceToSide && match.winnerTeamId) {
      const next = matches.find(
        (entry) => entry.round === match.advanceToRound && entry.slot === match.advanceToSlot
      );

      if (next) {
        if (match.advanceToSide === "A") next.teamAId = match.winnerTeamId;
        if (match.advanceToSide === "B") next.teamBId = match.winnerTeamId;
        next.status = next.teamAId && next.teamBId ? "ready" : "pending";
      }
    }
  }

  return { bracketSize, totalRounds, matches };
}

export function shortRoundLabel(round: number, totalRounds: number) {
  if (round === totalRounds) return "Final";
  if (round === totalRounds - 1) return "Semi-final";
  if (round === totalRounds - 2) return "Quarter-final";
  return `Round ${round}`;
}

export function displayMatchStatus(status: TournamentMatchStatus) {
  if (status === "code_ready") return "Lobby code ready";
  if (status === "completed") return "Completed";
  if (status === "ready") return "Ready";
  return "Pending";
}
