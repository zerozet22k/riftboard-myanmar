import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TournamentBracket, {
  type TournamentBracketMatch,
  type TournamentBracketTeam,
} from "@/components/TournamentBracket";
import TournamentManagePanel from "@/components/TournamentManagePanel";
import { dbConnect } from "@/lib/mongodb";
import { isRiotTournamentApiEnabled } from "@/lib/runtimeConfig";
import { displayTournamentStatus, hashToken } from "@/lib/tournaments";
import { Tournament } from "@/models/tournament";
import { TournamentMatch } from "@/models/tournamentMatch";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Manage Tournament",
  robots: {
    index: false,
    follow: false,
  },
};

type RouteParams = { slug: string };

export default async function TournamentManagePage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const token = String(sp.token ?? "").trim();
  await dbConnect();

  const tournament = await Tournament.findOne(
    { slug: String(slug).trim().toLowerCase() },
    {
      name: 1,
      slug: 1,
      status: 1,
      teamSize: 1,
      maxTeams: 1,
      bestOf: 1,
      complianceStatus: 1,
      riotApiState: 1,
      manageTokenHash: 1,
    }
  )
    .select("+manageTokenHash")
    .lean();

  if (!tournament?._id) notFound();

  if (!token || tournament.manageTokenHash !== hashToken(token)) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto flex min-h-screen max-w-[720px] items-center px-4 py-8">
          <div className="w-full rounded-[32px] bg-zinc-900/30 p-8 text-center ring-1 ring-white/5">
            <div className="text-2xl font-semibold text-zinc-50">Organizer access required</div>
            <div className="mt-3 text-sm text-zinc-400">
              Open this page using the secret manage link you got when the tournament was created.
            </div>
            <div className="mt-6">
              <Link href={`/tournaments/${slug}`} className="text-sm text-zinc-300 transition hover:text-white">
                Open public tournament page
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const [teams, matches] = await Promise.all([
    TournamentTeam.find(
      { tournamentId: tournament._id },
      {
        name: 1,
        seed: 1,
        status: 1,
        verificationMode: 1,
        checkedIn: 1,
        contactDiscord: 1,
        roster: 1,
      }
    )
      .sort({ seed: 1, createdAt: 1 })
      .lean(),
    TournamentMatch.find(
      { tournamentId: tournament._id },
      {
        round: 1,
        slot: 1,
        bestOf: 1,
        status: 1,
        teamAId: 1,
        teamBId: 1,
        teamASeed: 1,
        teamBSeed: 1,
        winnerTeamId: 1,
        scoreA: 1,
        scoreB: 1,
        tournamentCode: 1,
        resultSource: 1,
        linkedMatchId: 1,
        note: 1,
      }
    )
      .sort({ round: 1, slot: 1 })
      .lean(),
  ]);

  const bracketTeams: TournamentBracketTeam[] = teams.map((team) => ({
    id: String(team._id),
    name: team.name,
    seed: typeof team.seed === "number" ? team.seed : null,
  }));

  const manageTeams = teams.map((team) => ({
    id: String(team._id),
    name: team.name,
    seed: typeof team.seed === "number" ? team.seed : null,
    status: team.status,
    verificationMode: team.verificationMode ?? null,
    checkedIn: !!team.checkedIn,
    contactDiscord: team.contactDiscord ?? null,
    roster: Array.isArray(team.roster)
      ? team.roster.map((entry) => ({
          discordUserId: entry.discordUserId ? String(entry.discordUserId) : null,
          discordUsername: entry.discordUsername ?? null,
          gameName: entry.gameName,
          tagLine: entry.tagLine,
          isCaptain: !!entry.isCaptain,
          inviteStatus: entry.inviteStatus ?? "accepted",
        }))
      : [],
  }));

  const bracketMatches: TournamentBracketMatch[] = matches.map((match) => ({
    id: String(match._id),
    round: match.round,
    slot: match.slot,
    bestOf: match.bestOf ?? 1,
    status: match.status,
    teamAId: match.teamAId ? String(match.teamAId) : null,
    teamBId: match.teamBId ? String(match.teamBId) : null,
    teamASeed: typeof match.teamASeed === "number" ? match.teamASeed : null,
    teamBSeed: typeof match.teamBSeed === "number" ? match.teamBSeed : null,
    winnerTeamId: match.winnerTeamId ? String(match.winnerTeamId) : null,
    scoreA: match.scoreA ?? 0,
    scoreB: match.scoreB ?? 0,
    tournamentCode: match.tournamentCode ?? null,
  }));

  const manageMatches = matches.map((match) => ({
    id: String(match._id),
    round: match.round,
    slot: match.slot,
    bestOf: match.bestOf ?? 1,
    status: match.status,
    teamAId: match.teamAId ? String(match.teamAId) : null,
    teamBId: match.teamBId ? String(match.teamBId) : null,
    teamASeed: typeof match.teamASeed === "number" ? match.teamASeed : null,
    teamBSeed: typeof match.teamBSeed === "number" ? match.teamBSeed : null,
    winnerTeamId: match.winnerTeamId ? String(match.winnerTeamId) : null,
    scoreA: match.scoreA ?? 0,
    scoreB: match.scoreB ?? 0,
    tournamentCode: match.tournamentCode ?? null,
    resultSource: typeof match.resultSource === "string" ? match.resultSource : null,
    linkedMatchId: typeof match.linkedMatchId === "string" ? match.linkedMatchId : null,
    note: typeof match.note === "string" ? match.note : null,
  }));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="space-y-3">
          <Link href={`/tournaments/${slug}`} className="text-sm text-zinc-400 transition hover:text-zinc-200">
            Back to public tournament page
          </Link>
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Organizer</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-50">
              Manage {tournament.name}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Current stage: {displayTournamentStatus(tournament.status as never)}. Run the draft,
              registration, check-in, seeding, Riot provisioning, and exception handling from here.
            </p>
          </div>
        </header>

        <TournamentManagePanel
          key={`${tournament.status}-${teams
            .map(
              (team) =>
                `${String(team._id)}:${team.seed ?? ""}:${team.checkedIn ? 1 : 0}:${team.status}:${team.verificationMode ?? ""}`
            )
            .join("|")}-${matches.map((match) => `${String(match._id)}:${match.status}:${match.tournamentCode ?? ""}`).join("|")}`}
          tournament={{
            id: String(tournament._id),
            slug: tournament.slug,
            name: tournament.name,
            path: `/tournaments/${tournament.slug}`,
            status: tournament.status,
            statusLabel: displayTournamentStatus(tournament.status as never),
            teamSize: tournament.teamSize ?? 5,
            maxTeams: tournament.maxTeams ?? 0,
            bestOf: tournament.bestOf ?? 1,
            complianceStatus: tournament.complianceStatus ?? "eligible",
            riotApiState: tournament.riotApiState ?? "disabled",
            riotTournamentApiEnabled: isRiotTournamentApiEnabled(),
          }}
          teams={manageTeams}
          matches={manageMatches}
          bracketTeams={bracketTeams}
          manageToken={token}
        />

        <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6">
          <div className="mb-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Live bracket</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-50">Preview</div>
          </div>
          {bracketMatches.length ? (
            <TournamentBracket matches={bracketMatches} teams={bracketTeams} />
          ) : (
            <div className="text-sm text-zinc-500">No bracket yet. Check in teams and lock seeds first.</div>
          )}
        </section>
      </div>
    </main>
  );
}
