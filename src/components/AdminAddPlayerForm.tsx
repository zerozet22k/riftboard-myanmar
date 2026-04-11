"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type AddedPlayer = {
  gameName: string;
  tagLine: string;
  canonicalPath: string;
  refreshError: string | null;
};

export default function AdminAddPlayerForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [riotId, setRiotId] = useState("");
  const [pending, setPending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedPlayer[]>([]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parts = riotId.trim().split("#");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError("Enter Riot ID as GameName#TagLine");
      return;
    }

    const [gameName, tagLine] = parts;
    setPending(true);

    try {
      const response = await fetch("/api/admin/add-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameName, tagLine }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.error || "Failed to add player");
        return;
      }

      setAdded((current) => [
        {
          gameName: data.gameName,
          tagLine: data.tagLine,
          canonicalPath: data.canonicalPath,
          refreshError: data.refreshError,
        },
        ...current,
      ]);
      setRiotId("");
      inputRef.current?.focus();
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setError(null);

    try {
      await fetch("/api/admin/session", { method: "DELETE" });
      router.refresh();
    } catch {
      setError("Could not end admin session");
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 pt-20">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-foreground">Add Player</h1>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded border border-neutral-300 px-3 py-2 text-xs text-foreground transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {loggingOut ? "Leaving..." : "Lock"}
          </button>
        </div>

        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="GameName#TagLine"
            value={riotId}
            onChange={(event) => setRiotId(event.target.value)}
            autoFocus
            disabled={pending}
            className="flex-1 rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
          />
          <button
            type="submit"
            disabled={pending || !riotId.trim()}
            className="rounded bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-black dark:hover:bg-neutral-300"
          >
            {pending ? "Adding..." : "Add"}
          </button>
        </form>

        {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}

        {added.length ? (
          <ul className="mt-6 space-y-2">
            {added.map((player, index) => (
              <li
                key={`${player.canonicalPath}-${index}`}
                className="flex items-center justify-between gap-3 rounded border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
              >
                <Link
                  href={player.canonicalPath}
                  className="truncate text-blue-600 hover:underline dark:text-blue-400"
                >
                  {player.gameName}#{player.tagLine}
                </Link>
                {player.refreshError ? (
                  <span className="text-right text-xs text-amber-500">{player.refreshError}</span>
                ) : (
                  <span className="text-xs text-green-600 dark:text-green-400">Synced</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
