"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TournamentBracketTeam } from "@/components/TournamentBracket";

type ManageTournament = {
  id: string;
  slug: string;
  name: string;
  path: string;
  status: string;
  statusLabel: string;
  teamSize: number;
  maxTeams: number;
  bestOf: number;
  complianceStatus: string;
  riotApiState: string;
  riotTournamentApiEnabled: boolean;
};

type ManageTeam = TournamentBracketTeam & {
  status: string;
  verificationMode: string | null;
  checkedIn: boolean;
  contactDiscord: string | null;
  roster: Array<{
    discordUserId: string | null;
    discordUsername: string | null;
    gameName: string;
    tagLine: string;
    isCaptain: boolean;
    inviteStatus: string;
  }>;
};

type ManageMatch = {
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
  resultSource: string | null;
  linkedMatchId: string | null;
  note: string | null;
};

function normalizeGeneratedCodes(input: unknown) {
  if (!Array.isArray(input)) return [] as Array<{ round: number; slot: number; code: string }>;

  const normalized: Array<{ round: number; slot: number; code: string }> = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { round?: unknown; slot?: unknown; code?: unknown };
    if (typeof candidate.code !== "string") continue;
    normalized.push({
      round: Number(candidate.round ?? 0),
      slot: Number(candidate.slot ?? 0),
      code: candidate.code,
    });
  }
  return normalized;
}

function rosterStatusText(team: ManageTeam) {
  if (team.verificationMode !== "discord_verified") return "legacy blocked";
  if (team.status === "forming") {
    const pending = team.roster.filter((member) => member.inviteStatus === "pending").length;
    return pending ? `forming • ${pending} pending` : "forming";
  }
  return team.status;
}

export default function TournamentManagePanel({
  tournament,
  teams,
  matches,
  manageToken,
}: {
  tournament: ManageTournament;
  teams: ManageTeam[];
  matches: ManageMatch[];
  bracketTeams: TournamentBracketTeam[];
  manageToken: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [generatedCodes, setGeneratedCodes] = useState<Array<{ round: number; slot: number; code: string }>>([]);
  const [seedInputs, setSeedInputs] = useState<Record<string, string>>(
    Object.fromEntries(teams.map((team) => [team.id, team.seed != null ? String(team.seed) : ""]))
  );
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
      setError(null);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  function getPublicTournamentUrl() {
    return `${window.location.origin}${tournament.path}`;
  }

  function buildMatchShareText(round: number, slot: number, code: string) {
    return [
      `${tournament.slug.toUpperCase()} - Round ${round} Match ${slot}`,
      `Tournament Code: ${code}`,
      "Open the LoL client and use Join Tournament Code.",
      `Public Tournament Page: ${getPublicTournamentUrl()}`,
    ].join("\n");
  }

  function setSuccessMessage(action: string, data: unknown) {
    const source = data as { generated?: number; linkedMatchId?: string | null };
    if (action === "open_registration") return "Registration is now open.";
    if (action === "open_check_in") return "Check-in stage is now open.";
    if (action === "set_team_check_in") return "Team check-in updated.";
    if (action === "save_seeds") return "Seeds saved.";
    if (action === "lock_bracket") return "Bracket locked.";
    if (action === "provision_riot") return "Riot tournament resources are provisioned.";
    if (action === "generate_next_round_codes") {
      return `Generated ${source.generated ?? 0} Riot match code${source.generated === 1 ? "" : "s"}.`;
    }
    if (action === "sync_match") {
      return source.linkedMatchId
        ? `Match sync completed. Riot match id: ${source.linkedMatchId}.`
        : "Audit completed. Riot match id is not available yet.";
    }
    if (action === "adjudicate_match") return "Manual exception ruling saved.";
    return "Action completed.";
  }

  function runAction(payload: Record<string, unknown>) {
    setError(null);
    setMessage(null);
    setGeneratedCodes([]);

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

        if (payload.action === "generate_next_round_codes") {
          setGeneratedCodes(normalizeGeneratedCodes(data?.generatedCodes));
        }

        setMessage(setSuccessMessage(String(payload.action ?? ""), data));
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  function saveSeeds() {
    const checkedInTeams = teams.filter(
      (team) => team.checkedIn && team.verificationMode === "discord_verified" && team.status !== "forming"
    );
    const seeds = checkedInTeams.map((team) => ({
      teamId: team.id,
      seed: Number(seedInputs[team.id] ?? 0),
    }));

    if (seeds.some((entry) => !Number.isInteger(entry.seed) || entry.seed < 1)) {
      setError("Every checked-in team needs a numeric seed before saving.");
      return;
    }

    runAction({ action: "save_seeds", seeds });
  }

  const checkedInCount = teams.filter(
    (team) => team.checkedIn && team.verificationMode === "discord_verified"
  ).length;
  const activeParticipants = checkedInCount * tournament.teamSize;
  const teamMap = new Map(teams.map((team) => [team.id, team]));

  return (
    <div className="space-y-6 rounded-[28px] bg-zinc-900/30 p-5 ring-1 ring-white/5">
      <section className="grid gap-4 lg:grid-cols-4">
        <StatCard label="Workflow" value={tournament.statusLabel} />
        <StatCard label="Checked-in teams" value={`${checkedInCount}/${tournament.maxTeams}`} />
        <StatCard label="Active participants" value={String(activeParticipants)} />
        <StatCard
          label="Riot"
          value={tournament.riotApiState === "provisioned" ? "Provisioned" : tournament.riotApiState}
        />
      </section>

      <section className="rounded-[24px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
        <div className="flex flex-wrap items-center gap-3">
          {tournament.status === "draft" ? (
            <ActionButton pending={pending} onClick={() => runAction({ action: "open_registration" })}>
              Open registration
            </ActionButton>
          ) : null}

          {(tournament.status === "draft" || tournament.status === "registration") ? (
            <ActionButton pending={pending} onClick={() => runAction({ action: "open_check_in" })}>
              Open check-in
            </ActionButton>
          ) : null}

          {tournament.status === "check_in" ? (
            <>
              <ActionButton pending={pending} onClick={saveSeeds}>
                Save seeds
              </ActionButton>
              <ActionButton pending={pending} onClick={() => runAction({ action: "lock_bracket" })}>
                Lock bracket
              </ActionButton>
            </>
          ) : null}

          {["seeded", "live", "completed"].includes(tournament.status) ? (
            <ActionButton pending={pending} onClick={() => runAction({ action: "provision_riot" })}>
              {tournament.riotApiState === "provisioned" ? "Recheck Riot provisioning" : "Provision Riot"}
            </ActionButton>
          ) : null}

          {["seeded", "live"].includes(tournament.status) ? (
            <ActionButton pending={pending} onClick={() => runAction({ action: "generate_next_round_codes" })}>
              Generate next round codes
            </ActionButton>
          ) : null}

          <GhostButton
            pending={pending}
            onClick={() =>
              copyText(
                `${window.location.origin}${tournament.path}/manage?token=${manageToken}`,
                "Manage link copied."
              )
            }
          >
            Copy manage link
          </GhostButton>
          <GhostButton pending={pending} onClick={() => copyText(getPublicTournamentUrl(), "Public link copied.")}>
            Copy public link
          </GhostButton>
        </div>

        <div className="mt-4 text-sm text-zinc-400">
          Compliance: {tournament.complianceStatus}. Riot Tournament API:{" "}
          {tournament.riotTournamentApiEnabled ? "enabled" : "disabled"}.
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="rounded-[24px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
          <div className="mb-4 text-lg font-semibold text-zinc-100">Teams and seeding</div>
          <div className="space-y-3">
            {teams.length ? (
              teams.map((team) => (
                <div key={team.id} className="rounded-[20px] bg-zinc-900/55 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-100">{team.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {rosterStatusText(team)} • {team.checkedIn ? "checked in" : "not checked in"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={seedInputs[team.id] ?? ""}
                        onChange={(e) =>
                          setSeedInputs((current) => ({ ...current, [team.id]: e.target.value }))
                        }
                        disabled={
                          pending ||
                          tournament.status !== "check_in" ||
                          !team.checkedIn ||
                          team.verificationMode !== "discord_verified" ||
                          team.status === "forming"
                        }
                        className="w-20 rounded-xl bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none ring-1 ring-white/10 disabled:opacity-50"
                        placeholder="Seed"
                      />
                      {tournament.status === "check_in" ? (
                        <button
                          type="button"
                          disabled={
                            pending ||
                            team.verificationMode !== "discord_verified" ||
                            team.status === "forming"
                          }
                          onClick={() =>
                            runAction({
                              action: "set_team_check_in",
                              teamId: team.id,
                              checkedIn: !team.checkedIn,
                            })
                          }
                          className={
                            "rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-40 " +
                            (team.checkedIn
                              ? "bg-zinc-100 text-black hover:bg-white"
                              : "border border-white/10 text-zinc-200 hover:bg-white/5")
                          }
                        >
                          {team.checkedIn ? "Undo check-in" : "Check in"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-sm text-zinc-400">
                    {team.roster.map((member, index) => (
                      <div key={`${team.id}-${member.gameName}-${member.tagLine}-${index}`}>
                        {member.gameName}#{member.tagLine}
                        {member.isCaptain ? " (Captain)" : ""}
                        {!member.isCaptain ? ` • ${member.inviteStatus}` : ""}
                      </div>
                    ))}
                    {team.contactDiscord ? (
                      <div className="text-xs text-zinc-500">Contact: {team.contactDiscord}</div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-500">No teams registered yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-[24px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
          <div className="mb-4 text-lg font-semibold text-zinc-100">Match operations</div>
          <div className="space-y-3">
            {matches.length ? (
              matches.map((match) => {
                const teamA = match.teamAId ? teamMap.get(match.teamAId) ?? null : null;
                const teamB = match.teamBId ? teamMap.get(match.teamBId) ?? null : null;
                const note = notes[match.id] ?? "";

                return (
                  <div key={match.id} className="rounded-[20px] bg-zinc-900/55 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">
                          Round {match.round} • Match {match.slot}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {match.tournamentCode ? `Tournament code ${match.tournamentCode}` : "No Riot code yet"}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Result source: {match.resultSource ?? "pending"}
                          {match.linkedMatchId ? ` • Riot match ${match.linkedMatchId}` : ""}
                        </div>
                      </div>
                      <div className="text-xs text-zinc-500">{match.status}</div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <ManageTeamLine
                        name={teamA?.name ?? "TBD"}
                        seed={match.teamASeed}
                        winner={match.winnerTeamId === match.teamAId}
                        score={match.scoreA}
                      />
                      <ManageTeamLine
                        name={teamB?.name ?? "TBD"}
                        seed={match.teamBSeed}
                        winner={match.winnerTeamId === match.teamBId}
                        score={match.scoreB}
                      />
                    </div>

                    {match.note ? <div className="mt-3 text-xs text-zinc-500">{match.note}</div> : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {match.tournamentCode ? (
                        <>
                          <GhostButton
                            pending={pending}
                            onClick={() =>
                              copyText(
                                buildMatchShareText(match.round, match.slot, match.tournamentCode as string),
                                `Player instructions copied for Round ${match.round} Match ${match.slot}.`
                              )
                            }
                          >
                            Copy player instructions
                          </GhostButton>
                          <GhostButton
                            pending={pending}
                            onClick={() => runAction({ action: "sync_match", matchId: match.id })}
                          >
                            Audit / sync
                          </GhostButton>
                        </>
                      ) : null}
                    </div>

                    {match.status !== "completed" && teamA && teamB ? (
                      <div className="mt-4 rounded-[18px] bg-zinc-950/65 p-3 ring-1 ring-white/6">
                        <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                          Manual exception ruling
                        </div>
                        <textarea
                          value={note}
                          onChange={(e) => setNotes((current) => ({ ...current, [match.id]: e.target.value }))}
                          className="mt-3 min-h-[84px] w-full rounded-2xl bg-zinc-900/70 px-3 py-3 text-sm text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
                          placeholder="Required note for admin intervention, no-show, remake ruling, or other exception."
                          disabled={pending}
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ActionButton
                            pending={pending || !note.trim()}
                            onClick={() =>
                              runAction({
                                action: "adjudicate_match",
                                matchId: match.id,
                                winnerTeamId: teamA.id,
                                note,
                              })
                            }
                          >
                            {teamA.name} wins
                          </ActionButton>
                          <ActionButton
                            pending={pending || !note.trim()}
                            onClick={() =>
                              runAction({
                                action: "adjudicate_match",
                                matchId: match.id,
                                winnerTeamId: teamB.id,
                                note,
                              })
                            }
                          >
                            {teamB.name} wins
                          </ActionButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-zinc-500">No matches yet. Lock the bracket first.</div>
            )}
          </div>
        </div>
      </section>

      {generatedCodes.length ? (
        <div className="rounded-2xl bg-zinc-950/60 p-4 ring-1 ring-white/8">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Generated Riot codes
          </div>
          <div className="space-y-1.5 text-sm">
            {generatedCodes.map((item) => (
              <div key={`${item.round}-${item.slot}-${item.code}`} className="flex items-center justify-between gap-3">
                <span className="text-zinc-300">
                  Round {item.round} Match {item.slot}
                </span>
                <code className="rounded-lg bg-zinc-900 px-2 py-1 font-mono text-zinc-100">{item.code}</code>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message ? <div className="text-sm text-emerald-300">{message}</div> : null}
      {error ? <div className="text-sm text-red-300">{error}</div> : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
      <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-zinc-100">{value}</div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  pending,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="rounded-2xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  pending,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-zinc-200 transition hover:bg-white/5 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function ManageTeamLine({
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
        <div className="text-[11px] text-zinc-500">{seed ? `Seed ${seed}` : "Seed pending"}</div>
      </div>
      <div className="text-base font-semibold tabular-nums">{score}</div>
    </div>
  );
}
