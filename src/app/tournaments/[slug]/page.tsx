import Link from "next/link";
import { notFound } from "next/navigation";
import TournamentBracket, {
  type TournamentBracketMatch,
  type TournamentBracketTeam,
} from "@/components/TournamentBracket";
import TournamentRegisterForm from "@/components/TournamentRegisterForm";
import { formatCompactDateTime } from "@/lib/displayTime";
import { dbConnect } from "@/lib/mongodb";
import { Tournament } from "@/models/tournament";
import { TournamentMatch } from "@/models/tournamentMatch";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { slug: string };

function formatWhen(value: Date | string | null | undefined) {
  return formatCompactDateTime(value) ?? "TBA";
}

export default async function TournamentPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const resolved = await params;
  const now = new Date();
  await dbConnect();

  const tournament = await Tournament.findOne(
    { slug: String(resolved.slug).trim().toLowerCase() },
    {
      name: 1,
      slug: 1,
      description: 1,
      organizerName: 1,
      organizerContact: 1,
      platform: 1,
      teamSize: 1,
      maxTeams: 1,
      bestOf: 1,
      status: 1,
      startsAt: 1,
      registrationClosesAt: 1,
    }
  ).lean();

  if (!tournament?._id) notFound();

  const [teams, matches] = await Promise.all([
    TournamentTeam.find(
      { tournamentId: tournament._id },
      {
        name: 1,
        seed: 1,
        status: 1,
        roster: 1,
        contactDiscord: 1,
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

  const registrationClosed =
    tournament.status !== "registration" ||
    (!!tournament.registrationClosesAt &&
      new Date(tournament.registrationClosesAt).getTime() < now.getTime()) ||
    teams.length >= (tournament.maxTeams ?? 0);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="rounded-[32px] bg-zinc-900/30 p-5 ring-1 ring-white/5 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <Link href="/tournaments" className="text-sm text-zinc-400 transition hover:text-zinc-200">
                Back to tournaments
              </Link>
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Community tournament</div>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-50">{tournament.name}</h1>
                <p className="mt-3 max-w-3xl text-sm text-zinc-400">
                  {tournament.description?.trim() || "A Burmese-friendly custom lobby event."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                {String(tournament.platform ?? "sg2").toUpperCase()}
              </span>
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                {tournament.teamSize}v{tournament.teamSize}
              </span>
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                BO{tournament.bestOf ?? 1}
              </span>
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                {tournament.status}
              </span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-sm text-zinc-500">
            <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
              Teams {teams.length}/{tournament.maxTeams}
            </span>
            <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
              Starts {formatWhen(tournament.startsAt)}
            </span>
            <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
              Register until {formatWhen(tournament.registrationClosesAt)}
            </span>
            {tournament.organizerContact ? (
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                Contact {tournament.organizerContact}
              </span>
            ) : null}
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_360px]">
          <section className="space-y-6">
            <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6">
              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Bracket</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-50">Single elimination</div>
              </div>
              {bracketMatches.length ? (
                <TournamentBracket matches={bracketMatches} teams={bracketTeams} />
              ) : (
                <div className="text-sm text-zinc-500">
                  The organizer hasn&apos;t seeded the bracket yet.
                </div>
              )}
            </section>

            <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6">
              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Teams</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-50">Registered squads</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {teams.length ? (
                  teams.map((team) => (
                    <div key={String(team._id)} className="rounded-[24px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-zinc-100">{team.name}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {team.seed ? `Seed ${team.seed}` : "Unseeded"} • {team.status}
                          </div>
                        </div>
                        {team.contactDiscord ? (
                          <div className="text-xs text-zinc-500">{team.contactDiscord}</div>
                        ) : null}
                      </div>

                      <div className="mt-4 space-y-2">
                        {Array.isArray(team.roster) && team.roster.length ? (
                          team.roster.map((member, index) => (
                            <div key={`${member.gameNameNorm}-${member.tagLineNorm}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                              <div className="truncate text-zinc-200">
                                {member.gameName}#{member.tagLine}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                                {member.isCaptain ? "Captain" : "Roster"}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-zinc-500">No roster saved.</div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-500">No teams have signed up yet.</div>
                )}
              </div>
            </section>
          </section>

          <aside className="space-y-6">
            <TournamentRegisterForm
              slug={tournament.slug}
              teamSize={tournament.teamSize ?? 5}
              disabled={registrationClosed}
            />

            <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5">
              <div className="text-lg font-semibold text-zinc-100">Format</div>
              <div className="mt-3 space-y-2 text-sm text-zinc-400">
                <div>Single elimination bracket</div>
                <div>Custom lobby tournament codes per match</div>
                <div>{tournament.teamSize} players per team</div>
                <div>Best-of-{tournament.bestOf}</div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
