import type { TournamentRosterEntry, TournamentTeamVerificationMode } from "@/lib/tournaments";
import { acceptedRosterEntries, activeRosterEntries, pendingRosterEntries } from "@/lib/tournaments";

export function acceptedRosterCount(roster: TournamentRosterEntry[] | null | undefined) {
  return acceptedRosterEntries(roster).length;
}

export function activeRosterCount(roster: TournamentRosterEntry[] | null | undefined) {
  return activeRosterEntries(roster).length;
}

export function pendingRosterCount(roster: TournamentRosterEntry[] | null | undefined) {
  return pendingRosterEntries(roster).length;
}

export function teamReadyForRegistration(
  roster: TournamentRosterEntry[] | null | undefined,
  teamSize: number,
  verificationMode?: TournamentTeamVerificationMode | null
) {
  return (
    verificationMode === "discord_verified" &&
    acceptedRosterCount(roster) === teamSize &&
    activeRosterCount(roster) === teamSize &&
    pendingRosterCount(roster) === 0
  );
}

export function findRosterMemberByDiscordUserId(
  roster: TournamentRosterEntry[] | null | undefined,
  discordUserId: string
) {
  return (Array.isArray(roster) ? roster : []).find(
    (entry) => String(entry.discordUserId ?? "").trim() === String(discordUserId).trim()
  );
}
