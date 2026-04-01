"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function TournamentCreateForm({ hostCodeRequired }: { hostCodeRequired: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [organizerContact, setOrganizerContact] = useState("");
  const [platform, setPlatform] = useState("sg2");
  const [teamSize, setTeamSize] = useState("5");
  const [maxTeams, setMaxTeams] = useState("8");
  const [bestOf, setBestOf] = useState("1");
  const [startsAt, setStartsAt] = useState("");
  const [registrationClosesAt, setRegistrationClosesAt] = useState("");
  const [hostCode, setHostCode] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/tournaments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            slug,
            description,
            organizerName,
            organizerContact,
            platform,
            teamSize,
            maxTeams,
            bestOf,
            startsAt,
            registrationClosesAt,
            hostCode,
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `Create failed (${res.status})`);
          return;
        }

        if (typeof data?.managePath === "string") {
          router.push(data.managePath);
          router.refresh();
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Create failed");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[28px] bg-zinc-900/35 p-5 ring-1 ring-white/5 sm:p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Tournament name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
            placeholder="RiftBoard Yangon Cup"
            required
          />
        </label>

        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Slug</div>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
            placeholder="Optional"
          />
        </label>
      </div>

      <label className="space-y-1.5 text-sm">
        <div className="text-zinc-400">Description</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[110px] w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          placeholder="Share the format, rules, start time, and Discord details."
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Organizer name</div>
          <input
            value={organizerName}
            onChange={(e) => setOrganizerName(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
            placeholder="Zet"
          />
        </label>

        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Organizer contact</div>
          <input
            value={organizerContact}
            onChange={(e) => setOrganizerContact(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
            placeholder="Discord, Facebook, or contact note"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Platform</div>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          >
            <option value="sg2">SG2</option>
            <option value="th2">TH2</option>
            <option value="ph2">PH2</option>
            <option value="vn2">VN2</option>
            <option value="tw2">TW2</option>
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Team size</div>
          <select
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          >
            <option value="5">5v5</option>
            <option value="1">1v1</option>
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Max teams</div>
          <select
            value={maxTeams}
            onChange={(e) => setMaxTeams(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          >
            <option value="4">4</option>
            <option value="8">8</option>
            <option value="16">16</option>
            <option value="32">32</option>
          </select>
        </label>

        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Best of</div>
          <select
            value={bestOf}
            onChange={(e) => setBestOf(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          >
            <option value="1">BO1</option>
            <option value="3">BO3</option>
            <option value="5">BO5</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Starts at</div>
          <input
            type="datetime-local"
            step="60"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          />
        </label>

        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Registration closes</div>
          <input
            type="datetime-local"
            step="60"
            value={registrationClosesAt}
            onChange={(e) => setRegistrationClosesAt(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
          />
        </label>
      </div>

      {hostCodeRequired ? (
        <label className="space-y-1.5 text-sm">
          <div className="text-zinc-400">Tournament organizer code(Contact if you need one)</div>
          <input
            value={hostCode}
            onChange={(e) => setHostCode(e.target.value)}
            className="w-full rounded-2xl bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
            placeholder="Enter the community code"
            required
          />
          <div className="text-xs text-zinc-500">
            Use the same community code that protects leaderboard submissions.
          </div>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <button
          type="submit"
          disabled={pending}
          className="rounded-2xl bg-emerald-500/90 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create tournament"}
        </button>
        <div className="text-sm text-zinc-500">
          You&apos;ll get a secret manage link right away after creating it.
        </div>
      </div>

      {error ? <div className="text-sm text-red-300">{error}</div> : null}
    </form>
  );
}
