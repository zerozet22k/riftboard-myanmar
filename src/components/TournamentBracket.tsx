import { displayMatchStatus, shortRoundLabel } from "@/lib/tournaments";

export type TournamentBracketTeam = {
  id: string;
  name: string;
  seed: number | null;
};

export type TournamentBracketMatch = {
  id: string;
  round: number;
  slot: number;
  bestOf: number;
  status: string;
  teamAId: string | null;
  teamBId: string | null;
  teamASeed: number | null;
  teamBSeed: number | null;
  winnerTeamId: string | null;
  scoreA: number;
  scoreB: number;
  tournamentCode: string | null;
};

export default function TournamentBracket({
  matches,
  teams,
}: {
  matches: TournamentBracketMatch[];
  teams: TournamentBracketTeam[];
}) {
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const totalRounds = matches.reduce((max, match) => Math.max(max, match.round), 0);
  const rounds = Array.from({ length: totalRounds }, (_, index) => index + 1).map((round) => ({
    round,
    title: shortRoundLabel(round, totalRounds),
    matches: matches.filter((match) => match.round === round),
  }));

  return (
    <div className="x-scroll-area pb-2">
      <div className="grid min-w-[760px] gap-4 lg:grid-cols-4">
        {rounds.map((round) => (
          <section key={round.round} className="space-y-3 rounded-[24px] bg-zinc-900/20 p-4 ring-1 ring-white/5">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Round {round.round}</div>
              <div className="mt-1 text-lg font-semibold text-zinc-100">{round.title}</div>
            </div>

            <div className="space-y-3">
              {round.matches.map((match) => {
                const teamA = match.teamAId ? teamMap.get(match.teamAId) ?? null : null;
                const teamB = match.teamBId ? teamMap.get(match.teamBId) ?? null : null;

                return (
                  <div key={match.id} className="rounded-[20px] bg-zinc-950/55 p-3 ring-1 ring-white/6">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-zinc-100">Match {match.slot}</div>
                      <div className="text-[11px] text-zinc-500">{displayMatchStatus(match.status as never)}</div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <BracketTeamLine
                        name={teamA?.name ?? "TBD"}
                        seed={match.teamASeed}
                        winner={match.winnerTeamId === match.teamAId}
                        score={match.scoreA}
                      />
                      <BracketTeamLine
                        name={teamB?.name ?? "TBD"}
                        seed={match.teamBSeed}
                        winner={match.winnerTeamId === match.teamBId}
                        score={match.scoreB}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                      <span>BO{match.bestOf}</span>
                      {match.tournamentCode ? <span className="font-mono text-zinc-400">{match.tournamentCode}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function BracketTeamLine({
  name,
  seed,
  winner,
  score,
}: {
  name: string;
  seed: number | null;
  winner: boolean;
  score: number;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm " +
        (winner ? "bg-emerald-500/10 text-zinc-100" : "bg-zinc-900/55 text-zinc-300")
      }
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="text-[11px] text-zinc-500">{seed ? `Seed ${seed}` : "BYE / TBD"}</div>
      </div>
      <div className="text-base font-semibold tabular-nums">{score}</div>
    </div>
  );
}
