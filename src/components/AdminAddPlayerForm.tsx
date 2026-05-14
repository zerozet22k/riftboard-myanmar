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

type RemovedPlayer = {
  gameName: string;
  tagLine: string;
  deleted: {
    player: number;
    matches: number;
    rankEntries: number;
    masteryRows: number;
    profileComments: number;
    discordLinks: number;
  };
};

type AdminStats = {
  trackedPlayers: number;
  discordLinks: number;
  tftPlayersWithMatches: number;
  tftApiConfigured: boolean;
  recentDiscordLinks: Array<{
    discordUserId: string;
    discordUsername: string | null;
    gameName: string;
    tagLine: string;
    verifiedBinding: boolean;
    verificationSource: string | null;
    lastSyncedAt: string | null;
  }>;
};

type AdminRefreshResult = {
  ok: number;
  fail: number;
  skipped: number;
  scanned: number;
  errors?: Array<{ name?: string; error?: string }>;
};

type BoundDiscordLink = {
  discordUserId: string;
  discordUsername: string | null;
  gameName: string;
  tagLine: string;
  refreshWarning?: string | null;
  roleSyncError: string | null;
};

function cleanRiotIdPart(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .trim();
}

function parseRiotIdInput(value: string) {
  const raw = cleanRiotIdPart(value)
    .replace(/\s*\/\s*/g, "#")
    .replace(/\s*#\s*/g, "#")
    .replace(/#+/g, "#");
  const index = raw.lastIndexOf("#");
  if (index <= 0) return null;
  const gameName = cleanRiotIdPart(raw.slice(0, index));
  const tagLine = cleanRiotIdPart(raw.slice(index + 1));
  return gameName && tagLine ? { gameName, tagLine } : null;
}

function riotIdLabel(gameName: unknown, tagLine: unknown) {
  return `${cleanRiotIdPart(gameName)}#${cleanRiotIdPart(tagLine)}`;
}

function verificationLabel(source: string | null, verified: boolean) {
  if (!verified) return "unverified";
  if (source === "riot_rso") return "RSO";
  if (source === "discord_connections") return "Discord";
  if (source === "legacy_manual") return "Admin";
  return "verified";
}

export default function AdminAddPlayerForm({ stats }: { stats: AdminStats }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [riotId, setRiotId] = useState("");
  const [removeRiotId, setRemoveRiotId] = useState("");
  const [discordUserId, setDiscordUserId] = useState("");
  const [discordUsername, setDiscordUsername] = useState("");
  const [discordRiotId, setDiscordRiotId] = useState("");
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bindingDiscord, setBindingDiscord] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<AdminRefreshResult | null>(null);
  const [added, setAdded] = useState<AddedPlayer[]>([]);
  const [removed, setRemoved] = useState<RemovedPlayer[]>([]);
  const [boundLinks, setBoundLinks] = useState<BoundDiscordLink[]>([]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedRiotId = parseRiotIdInput(riotId);
    if (!parsedRiotId) {
      setError("Enter Riot ID as GameName#TagLine");
      return;
    }

    const { gameName, tagLine } = parsedRiotId;
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

  async function handleRemove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedRiotId = parseRiotIdInput(removeRiotId);
    if (!parsedRiotId) {
      setError("Enter Riot ID as GameName#TagLine");
      return;
    }

    const { gameName, tagLine } = parsedRiotId;
    setRemoving(true);

    try {
      const response = await fetch("/api/admin/remove-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameName, tagLine }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.error || "Failed to remove player");
        return;
      }

      setRemoved((current) => [
        {
          gameName: data.gameName,
          tagLine: data.tagLine,
          deleted: {
            player: Number(data.deleted?.player ?? 0),
            matches: Number(data.deleted?.matches ?? 0),
            rankEntries: Number(data.deleted?.rankEntries ?? 0),
            masteryRows: Number(data.deleted?.masteryRows ?? 0),
            profileComments: Number(data.deleted?.profileComments ?? 0),
            discordLinks: Number(data.deleted?.discordLinks ?? 0),
          },
        },
        ...current,
      ]);
      setRemoveRiotId("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setRemoving(false);
    }
  }

  async function handleRefreshNow() {
    setRefreshing(true);
    setError(null);
    setRefreshResult(null);

    try {
      const response = await fetch("/api/admin/refresh-leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: 15,
          delayMs: 900,
          matchesCount: 20,
          syncMatches: true,
          syncTftMatches: true,
          force: false,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.error || "Refresh failed");
        return;
      }
      setRefreshResult(data.result);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleBindDiscord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedRiotId = parseRiotIdInput(discordRiotId);
    if (!discordUserId.trim() || !parsedRiotId) {
      setError("Enter Discord user ID and Riot ID");
      return;
    }

    setBindingDiscord(true);
    try {
      const response = await fetch("/api/admin/bind-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordUserId,
          discordUsername,
          riotId: `${parsedRiotId.gameName}#${parsedRiotId.tagLine}`,
          syncRoles: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.error || "Discord bind failed");
        return;
      }

      setBoundLinks((current) => [data.link, ...current]);
      setDiscordUserId("");
      setDiscordUsername("");
      setDiscordRiotId("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBindingDiscord(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-foreground">RiftBoard admin</h1>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded border border-neutral-300 px-3 py-2 text-xs text-foreground transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {loggingOut ? "Leaving..." : "Lock"}
          </button>
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          <AdminStat label="Tracked" value={stats.trackedPlayers} />
          <AdminStat label="Discord links" value={stats.discordLinks} />
          <AdminStat label="TFT histories" value={stats.tftPlayersWithMatches} />
          <AdminStat label="TFT API" value={stats.tftApiConfigured ? "Configured" : "Missing"} tone={stats.tftApiConfigured ? "good" : "bad"} />
        </section>

        <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Refresh runner</h2>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Same job as the tray app: 15 players, 900ms delay, LoL + TFT match sync, 20 matches.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefreshNow}
              disabled={refreshing}
              className="rounded bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-black dark:hover:bg-neutral-300"
            >
              {refreshing ? "Refreshing..." : "Run refresh now"}
            </button>
          </div>
          {refreshResult ? (
            <div className="mt-3 rounded bg-neutral-50 p-3 text-sm text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
              ok {refreshResult.ok}, failed {refreshResult.fail}, skipped {refreshResult.skipped}, scanned {refreshResult.scanned}
              {refreshResult.errors?.length ? (
                <ul className="mt-2 space-y-1 text-xs text-red-500">
                  {refreshResult.errors.slice(0, 3).map((item, index) => (
                    <li key={`${item.name ?? "error"}-${index}`}>{item.name ? `${item.name}: ` : ""}{item.error}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Players</h2>
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

        <form onSubmit={handleRemove} className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="GameName#TagLine"
            value={removeRiotId}
            onChange={(event) => setRemoveRiotId(event.target.value)}
            disabled={removing}
            className="flex-1 rounded border border-red-300 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-red-900"
          />
          <button
            type="submit"
            disabled={removing || !removeRiotId.trim()}
            className="rounded bg-red-700 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:opacity-50 dark:bg-red-800 dark:hover:bg-red-700"
          >
            {removing ? "Removing..." : "Remove"}
          </button>
        </form>
        </section>

        <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-foreground">Recent Discord links</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Discord binding should still happen through OAuth so role sync has valid tokens.
          </p>
          <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
            {stats.recentDiscordLinks.length ? stats.recentDiscordLinks.map((link) => (
              <li key={`${link.discordUserId}-${link.gameName}-${link.tagLine}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{riotIdLabel(link.gameName, link.tagLine)}</div>
                  <div className="truncate text-xs text-neutral-500">{link.discordUsername ?? link.discordUserId}</div>
                </div>
                <span className={`rounded px-2 py-1 text-xs ${link.verifiedBinding ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                  {verificationLabel(link.verificationSource, link.verifiedBinding)}
                </span>
              </li>
            )) : (
              <li className="py-2 text-sm text-neutral-500">No Discord links yet.</li>
            )}
          </ul>
        </section>

        <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-foreground">Manual Discord bind</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Paste a Discord numeric user ID. You can paste it with the username too, like 1255434368717951019 thanag36412.
          </p>
          <form onSubmit={handleBindDiscord} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
            <input
              type="text"
              placeholder="Discord user ID"
              value={discordUserId}
              onChange={(event) => setDiscordUserId(event.target.value)}
              disabled={bindingDiscord}
              className="rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
            />
            <input
              type="text"
              placeholder="Discord username optional"
              value={discordUsername}
              onChange={(event) => setDiscordUsername(event.target.value)}
              disabled={bindingDiscord}
              className="rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
            />
            <input
              type="text"
              placeholder="GameName#TagLine"
              value={discordRiotId}
              onChange={(event) => setDiscordRiotId(event.target.value)}
              disabled={bindingDiscord}
              className="rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
            />
            <button
              type="submit"
              disabled={bindingDiscord || !discordUserId.trim() || !discordRiotId.trim()}
              className="rounded bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-black dark:hover:bg-neutral-300"
            >
              {bindingDiscord ? "Binding..." : "Bind"}
            </button>
          </form>
          {boundLinks.length ? (
            <ul className="mt-3 space-y-2">
              {boundLinks.map((link, index) => (
                <li key={`${link.discordUserId}-${index}`} className="rounded border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                  <div className="font-medium text-foreground">
                    {link.discordUsername ?? link.discordUserId} {"->"} {riotIdLabel(link.gameName, link.tagLine)}
                  </div>
                  <div className={`mt-1 text-xs ${link.roleSyncError ? "text-amber-500" : "text-green-600 dark:text-green-400"}`}>
                    {link.roleSyncError ? `Bound, but role sync failed: ${link.roleSyncError}` : "Bound and server roles synced"}
                  </div>
                  {link.refreshWarning ? (
                    <div className="mt-1 text-xs text-amber-500">
                      Bound using stored player. Refresh warning: {link.refreshWarning}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

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
                  {riotIdLabel(player.gameName, player.tagLine)}
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

        {removed.length ? (
          <ul className="mt-6 space-y-2">
            {removed.map((player, index) => (
              <li
                key={`${player.gameName}#${player.tagLine}-${index}`}
                className="rounded border border-red-200 px-3 py-2 text-sm dark:border-red-900"
              >
                <div className="font-medium text-red-700 dark:text-red-300">
                  Removed {riotIdLabel(player.gameName, player.tagLine)}
                </div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Deleted: player {player.deleted.player}, matches {player.deleted.matches}, rank {player.deleted.rankEntries}, mastery {player.deleted.masteryRows}, comments {player.deleted.profileComments}, discord links {player.deleted.discordLinks}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function AdminStat({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" }) {
  const toneClass =
    tone === "good"
      ? "text-green-600 dark:text-green-400"
      : tone === "bad"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";
  return (
    <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
