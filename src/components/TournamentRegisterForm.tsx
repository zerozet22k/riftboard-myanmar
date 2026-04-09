"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Viewer = {
  discordUserId: string;
  discordUsername: string | null;
  gameName: string;
  tagLine: string;
};

type ViewerRosterEntry = {
  discordUserId: string | null;
  discordUsername: string | null;
  gameName: string;
  tagLine: string;
  isCaptain: boolean;
  inviteStatus: string;
};

type ViewerTeam = {
  id: string;
  name: string;
  status: string;
  verificationMode: string | null;
  isCaptain: boolean;
  viewerInviteStatus: string | null;
  contactDiscord: string | null;
  roster: ViewerRosterEntry[];
};

type SearchResult = {
  discordUserId: string;
  discordUsername: string | null;
  playerId: string;
  gameName: string;
  tagLine: string;
  riotId: string;
};

async function safeJson(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function inviteStatusLabel(status: string) {
  if (status === "accepted") return "Accepted";
  if (status === "pending") return "Pending";
  if (status === "declined") return "Declined";
  return status;
}

export default function TournamentRegisterForm({
  slug,
  teamSize,
  disabled,
  statusLabel,
  joinCodeRequired,
  viewer,
  viewerTeam,
}: {
  slug: string;
  teamSize: number;
  disabled: boolean;
  statusLabel?: string;
  joinCodeRequired: boolean;
  viewer: Viewer | null;
  viewerTeam: ViewerTeam | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [teamName, setTeamName] = useState("");
  const [contactDiscord, setContactDiscord] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function refreshWithMessage(nextMessage: string) {
    setMessage(nextMessage);
    setError(null);
    router.refresh();
  }

  function createTeam(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!viewer) return;

    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/tournaments/${encodeURIComponent(slug)}/teams`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamName,
            contactDiscord: contactDiscord.trim() || undefined,
            code: joinCode.trim() || undefined,
          }),
        });

        const data = await safeJson(res);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `Could not create team (${res.status})`);
          return;
        }

        setTeamName("");
        setContactDiscord("");
        setJoinCode("");
        refreshWithMessage(data?.message ?? "Team created.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create team");
      }
    });
  }

  async function searchLinkedPlayers() {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/discord/linked-players?q=${encodeURIComponent(searchQuery)}`);
      const data = await safeJson(res);
      if (!res.ok || data?.ok === false) {
        setError(data?.error ?? `Search failed (${res.status})`);
        setSearchResults([]);
        return;
      }

      const items = Array.isArray(data?.items) ? (data.items as SearchResult[]) : [];
      setSearchResults(
        items.filter((item) => item.discordUserId !== viewer?.discordUserId)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function invitePlayer(playerId: string) {
    if (!viewerTeam) return;

    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/tournaments/${encodeURIComponent(slug)}/teams/${encodeURIComponent(viewerTeam.id)}/invite`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId }),
          }
        );

        const data = await safeJson(res);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `Invite failed (${res.status})`);
          return;
        }

        setSearchQuery("");
        setSearchResults([]);
        refreshWithMessage("Invite sent.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invite failed");
      }
    });
  }

  function respondToInvite(action: "accept" | "decline") {
    if (!viewerTeam) return;

    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/tournaments/${encodeURIComponent(slug)}/teams/${encodeURIComponent(viewerTeam.id)}/${action}`,
          { method: "POST" }
        );

        const data = await safeJson(res);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `${action} failed (${res.status})`);
          return;
        }

        refreshWithMessage(data?.message ?? (action === "accept" ? "Invite accepted." : "Invite declined."));
      } catch (err) {
        setError(err instanceof Error ? err.message : `${action} failed`);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-[26px] bg-zinc-900/30 p-5 ring-1 ring-white/5">
      <div>
        <div className="text-lg font-semibold text-zinc-100">Verified team registration</div>
        <div className="mt-1 text-sm text-zinc-500">
          Discord-proven accounts only. This event is set to {teamSize} player
          {teamSize === 1 ? "" : "s"} per team.
        </div>
        {statusLabel ? <div className="mt-1 text-xs text-zinc-600">Tournament status: {statusLabel}</div> : null}
      </div>

      {!viewer ? (
        <div className="rounded-[22px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
          <div className="text-sm text-zinc-300">
            Connect Discord before joining this tournament. Manual Riot roster entry is disabled.
          </div>
          <form action="/api/discord/oauth/start" method="GET" className="mt-4">
            <input type="hidden" name="returnTo" value={`/tournaments/${slug}`} />
            <button
              type="submit"
              className="inline-flex rounded-2xl bg-emerald-500/90 px-4 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
            >
              Connect Discord
            </button>
          </form>
        </div>
      ) : viewerTeam ? (
        <div className="space-y-4">
          <div className="rounded-[22px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-zinc-100">{viewerTeam.name}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                  {viewerTeam.status}
                  {viewerTeam.verificationMode !== "discord_verified" ? " • Legacy blocked" : ""}
                </div>
              </div>
              {viewerTeam.contactDiscord ? (
                <div className="text-xs text-zinc-500">{viewerTeam.contactDiscord}</div>
              ) : null}
            </div>

            <div className="mt-4 space-y-2">
              {viewerTeam.roster.map((member) => (
                <div
                  key={`${member.discordUserId ?? "legacy"}-${member.gameName}-${member.tagLine}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-900/55 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate text-zinc-100">
                      {member.gameName}#{member.tagLine}
                      {member.isCaptain ? " (Captain)" : ""}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {member.discordUsername ?? member.discordUserId ?? "Legacy member"}
                    </div>
                  </div>
                  <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                    {inviteStatusLabel(member.inviteStatus)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {viewerTeam.viewerInviteStatus === "pending" && !viewerTeam.isCaptain ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => respondToInvite("accept")}
                disabled={pending || disabled}
                className="rounded-2xl bg-emerald-500/90 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
              >
                Accept invite
              </button>
              <button
                type="button"
                onClick={() => respondToInvite("decline")}
                disabled={pending || disabled}
                className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-zinc-200 transition hover:bg-white/5 disabled:opacity-60"
              >
                Decline invite
              </button>
            </div>
          ) : null}

          {viewerTeam.isCaptain && viewerTeam.status === "forming" && teamSize > 1 && !disabled ? (
            <div className="rounded-[22px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
              <div className="text-sm font-semibold text-zinc-100">Invite verified teammates</div>
              <div className="mt-1 text-xs text-zinc-500">
                Search linked Riftboard members. They must accept the invite themselves before the team counts.
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Riot ID or Discord name"
                  className="w-full rounded-2xl bg-zinc-900/70 px-4 py-3 text-sm text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
                  disabled={pending}
                />
                <button
                  type="button"
                  onClick={searchLinkedPlayers}
                  disabled={pending || searching || searchQuery.trim().length < 2}
                  className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-200 transition hover:bg-white/5 disabled:opacity-60"
                >
                  {searching ? "Searching..." : "Search"}
                </button>
              </div>

              {searchResults.length ? (
                <div className="mt-4 space-y-2">
                  {searchResults.map((item) => (
                    <div
                      key={`${item.discordUserId}-${item.playerId}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-zinc-900/55 px-3 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium text-zinc-100">{item.riotId}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {item.discordUsername ?? item.discordUserId}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => invitePlayer(item.playerId)}
                        disabled={pending}
                        className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
                      >
                        Invite
                      </button>
                    </div>
                  ))}
                </div>
              ) : searchQuery.trim().length >= 2 && !searching ? (
                <div className="mt-4 text-sm text-zinc-500">No verified members matched that search.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={createTeam} className="space-y-3">
          <label className="space-y-1.5 text-sm">
            <div className="text-zinc-400">Team name</div>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
              required
              disabled={pending || disabled}
            />
          </label>

          <label className="space-y-1.5 text-sm">
            <div className="text-zinc-400">Discord or contact note</div>
            <input
              value={contactDiscord}
              onChange={(e) => setContactDiscord(e.target.value)}
              className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
              placeholder={viewer.discordUsername ?? "@discord-name"}
              disabled={pending || disabled}
            />
          </label>

          {joinCodeRequired ? (
            <label className="space-y-1.5 text-sm">
              <div className="text-zinc-400">Community code</div>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
                placeholder="Enter community code"
                required
                disabled={pending || disabled}
              />
            </label>
          ) : null}

          <div className="rounded-[22px] bg-zinc-950/50 p-4 ring-1 ring-white/6 text-sm text-zinc-400">
            Captain account:{" "}
            <span className="text-zinc-200">
              {viewer.gameName}#{viewer.tagLine}
            </span>
            . {teamSize === 1 ? "This will register you directly." : "After creating the team, invite verified teammates and wait for them to accept."}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              type="submit"
              disabled={pending || disabled}
              className="rounded-2xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-60"
            >
              {pending ? "Submitting..." : teamSize === 1 ? "Register myself" : "Create team"}
            </button>
            {disabled ? <div className="text-sm text-zinc-500">Registration is closed right now.</div> : null}
          </div>
        </form>
      )}

      {message ? <div className="text-sm text-emerald-300">{message}</div> : null}
      {error ? <div className="text-sm text-red-300">{error}</div> : null}
    </div>
  );
}
