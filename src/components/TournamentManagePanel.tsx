"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { TournamentBracketMatch, TournamentBracketTeam } from "@/components/TournamentBracket";

type ManageTournament = {
  slug: string;
  path: string;
};

export default function TournamentManagePanel({
  tournament,
  teams,
  matches,
  manageToken,
}: {
  tournament: ManageTournament;
  teams: TournamentBracketTeam[];
  matches: TournamentBracketMatch[];
  manageToken: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  function runAction(payload: Record<string, unknown>) {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/tournaments/${encodeURIComponent(tournament.slug)}/manage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: manageToken, ...payload }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `Action failed (${res.status})`);
          return;
        }

        if (payload.action === "seed_bracket") setMessage("Bracket generated.");
        if (payload.action === "generate_codes") setMessage("Lobby codes generated.");
        if (payload.action === "report_result") setMessage("Match result saved.");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  return (
    <div className="space-y-5 rounded-[28px] bg-zinc-900/30 p-5 ring-1 ring-white/5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => runAction({ action: "seed_bracket" })}
          className="rounded-2xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
        >
          Seed bracket
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => runAction({ action: "generate_codes" })}
          className="rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-60"
        >
          Generate round codes
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}${tournament.path}/manage?token=${manageToken}`);
            setMessage("Manage link copied.");
          }}
          className="rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-zinc-200 transition hover:bg-white/5 disabled:opacity-60"
        >
          Copy manage link
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {matches.map((match) => {
          const teamA = match.teamAId ? teamMap.get(match.teamAId) ?? null : null;
          const teamB = match.teamBId ? teamMap.get(match.teamBId) ?? null : null;

          return (
            <div key={match.id} className="rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">
                    Round {match.round} • Match {match.slot}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {match.tournamentCode ? `Lobby code ${match.tournamentCode}` : "No code yet"}
                  </div>
                </div>
                <div className="text-xs text-zinc-500">{match.status}</div>
              </div>

              <div className="mt-4 space-y-2">
                <ManageTeamLine
                  team={teamA}
                  score={match.scoreA}
                  winner={match.winnerTeamId === match.teamAId}
                  onPick={
                    teamA
                      ? () =>
                          runAction({
                            action: "report_result",
                            matchId: match.id,
                            winnerTeamId: teamA.id,
                          })
                      : undefined
                  }
                  disabled={pending || !teamA || !teamB || match.status === "completed"}
                />
                <ManageTeamLine
                  team={teamB}
                  score={match.scoreB}
                  winner={match.winnerTeamId === match.teamBId}
                  onPick={
                    teamB
                      ? () =>
                          runAction({
                            action: "report_result",
                            matchId: match.id,
                            winnerTeamId: teamB.id,
                          })
                      : undefined
                  }
                  disabled={pending || !teamA || !teamB || match.status === "completed"}
                />
              </div>
            </div>
          );
        })}
      </div>

      {message ? <div className="text-sm text-emerald-300">{message}</div> : null}
      {error ? <div className="text-sm text-red-300">{error}</div> : null}
    </div>
  );
}

function ManageTeamLine({
  team,
  score,
  winner,
  onPick,
  disabled,
}: {
  team: TournamentBracketTeam | null;
  score: number;
  winner: boolean;
  onPick?: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-900/55 px-3 py-2.5">
      <div className="min-w-0">
        <div className={"truncate text-sm font-medium " + (winner ? "text-zinc-50" : "text-zinc-300")}>
          {team?.name ?? "TBD"}
        </div>
        <div className="text-[11px] text-zinc-500">{team?.seed ? `Seed ${team.seed}` : "No seed yet"}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-base font-semibold tabular-nums text-zinc-100">{score}</div>
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/5 disabled:opacity-40"
        >
          Win
        </button>
      </div>
    </div>
  );
}
