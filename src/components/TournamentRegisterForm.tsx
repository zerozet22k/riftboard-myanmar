"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function TournamentRegisterForm({
  slug,
  teamSize,
  disabled,
}: {
  slug: string;
  teamSize: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [teamName, setTeamName] = useState("");
  const [captainRiotId, setCaptainRiotId] = useState("");
  const [rosterText, setRosterText] = useState("");
  const [contactDiscord, setContactDiscord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/tournaments/${encodeURIComponent(slug)}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamName,
            captainRiotId,
            rosterText,
            contactDiscord,
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `Registration failed (${res.status})`);
          return;
        }

        setTeamName("");
        setCaptainRiotId("");
        setRosterText("");
        setContactDiscord("");
        setMessage("Team registered. Refreshing bracket...");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Registration failed");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-[26px] bg-zinc-900/30 p-5 ring-1 ring-white/5">
      <div>
        <div className="text-lg font-semibold text-zinc-100">Register your team</div>
        <div className="mt-1 text-sm text-zinc-500">
          Captain first. This event is set to {teamSize} player{teamSize === 1 ? "" : "s"} per team.
        </div>
      </div>

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
        <div className="text-zinc-400">Captain Riot ID</div>
        <input
          value={captainRiotId}
          onChange={(e) => setCaptainRiotId(e.target.value)}
          placeholder="Name#TAG"
          className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          required
          disabled={pending || disabled}
        />
      </label>

      {teamSize > 1 ? (
        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Other roster Riot IDs</div>
          <textarea
            value={rosterText}
            onChange={(e) => setRosterText(e.target.value)}
            placeholder={"One Riot ID per line\nPlayerTwo#SG2\nPlayerThree#SG2"}
            className="min-h-[120px] w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
            disabled={pending || disabled}
          />
        </label>
      ) : null}

      <label className="space-y-1.5 text-sm">
        <div className="text-zinc-400">Discord or contact note</div>
        <input
          value={contactDiscord}
          onChange={(e) => setContactDiscord(e.target.value)}
          className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          placeholder="discord.gg/... or @name"
          disabled={pending || disabled}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <button
          type="submit"
          disabled={pending || disabled}
          className="rounded-2xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-60"
        >
          {pending ? "Registering..." : "Join tournament"}
        </button>
        {disabled ? <div className="text-sm text-zinc-500">Registration is closed.</div> : null}
      </div>

      {message ? <div className="text-sm text-emerald-300">{message}</div> : null}
      {error ? <div className="text-sm text-red-300">{error}</div> : null}
    </form>
  );
}
