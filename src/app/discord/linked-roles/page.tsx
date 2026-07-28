import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import AccountHubPostAction from "@/components/AccountHubPostAction";
import {
  hasCommunityAccessCookieValue,
  hasStoredCommunityAccessForDiscordUser,
} from "@/lib/communityAccess";
import {
  getOptionalDiscordSession,
  normalizeReturnTo,
  readPendingDiscordBindCookieValue,
} from "@/lib/discordSession";
import { dbConnect } from "@/lib/mongodb";
import { canonicalPlayerPath } from "@/lib/playerIdentity";
import {
  getCommunityDiscordUrl,
  isCommunityCodeRequired,
} from "@/lib/runtimeConfig";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";

export const metadata: Metadata = {
  title: "Linked accounts",
  description: "Manage the Discord and Riot accounts connected to RiftBoard.",
  robots: {
    index: false,
    follow: false,
  },
};

type NoticeTone = "emerald" | "red" | "sky";

type LinkedAccountRow = {
  linkId: string;
  riotId: string;
  profileHref: string;
  platform: string;
  rank: string;
  verification: string;
  isRoleAccount: boolean;
  syncedAt: Date | string | null;
};

type LeanLink = {
  _id: unknown;
  playerId: unknown;
  gameName?: string;
  tagLine?: string;
  verificationSource?: string | null;
  isPrimary?: boolean;
  lastSyncedAt?: Date | string | null;
  guildRankRolesSyncedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type LeanPlayer = {
  _id: unknown;
  platform?: string | null;
  solo?: {
    tier?: string | null;
    division?: string | null;
    lp?: number | null;
  } | null;
};

function noticeText(status?: string, message?: string, riotId?: string) {
  if (status === "connected") {
    return {
      tone: "emerald",
      text: "You are signed in with Discord. Add a Riot account when you are ready.",
    } as const;
  }

  if (status === "linked") {
    const roleWarning =
      message === "discord-role-sync-failed"
        ? " The account is connected, but its Discord roles still need another sync."
        : "";
    return {
      tone: "emerald",
      text: riotId
        ? `${riotId} is now connected to your Discord account.${roleWarning}`
        : `Your Riot account is connected.${roleWarning}`,
    } as const;
  }

  if (status === "choose") {
    return {
      tone: "sky",
      text: "Discord is connected. Choose which Riot account you want to add.",
    } as const;
  }

  if (status === "updated") {
    const syncWarning =
      message === "primary-account-updated-role-sync-failed"
        ? " The role account changed, but Discord role sync needs another try."
        : message === "primary-account-updated-role-sync-partial"
          ? " The role account changed, but part of Discord role sync needs another try."
          : "";
    return {
      tone: "emerald",
      text: `Your role account was updated.${syncWarning}`,
    } as const;
  }

  if (status === "unlinked") {
    const syncWarning =
      message === "riot-account-unlinked-role-sync-failed"
        ? " Your remaining role account still needs a Discord role sync."
        : message === "riot-account-unlinked-role-sync-partial"
          ? " Part of the Discord role update still needs another try."
          : message === "riot-account-unlinked-role-clear-failed"
            ? " The account was removed, but its old Discord roles still need to be cleared."
            : message === "riot-account-unlinked-role-clear-partial"
              ? " The account was removed, but part of its old Discord role state still needs cleanup."
          : "";
    return {
      tone: "emerald",
      text: riotId
        ? `${riotId} was removed from your Discord account.${syncWarning}`
        : `The Riot account was removed.${syncWarning}`,
    } as const;
  }

  if (status === "synced") {
    const syncDetail =
      message === "discord-role-sync-partial"
        ? " Some server roles still need another try."
        : message === "discord-guild-role-synced"
          ? " Your server rank role is up to date."
          : " Your linked role and server rank role are up to date.";
    return {
      tone: "emerald",
      text: `Discord role sync finished.${syncDetail}`,
    } as const;
  }

  if (status === "signed-out") {
    return {
      tone: "emerald",
      text: "You are signed out. Your connected accounts were not removed.",
    } as const;
  }

  if (status === "cancelled") {
    return {
      tone: "sky",
      text: "Riot account setup was cancelled. Your Discord account is still connected.",
    } as const;
  }

  if (status !== "error") return null;

  const friendly: Record<string, string> = {
    "missing-oauth-state": "Discord sign-in could not be resumed. Start again from this page.",
    "invalid-oauth-state": "Discord sign-in did not match this browser. Start again from this page.",
    "oauth-state-expired": "That account setup expired. Start it again from this page.",
    "community-code-required": "Enter the community code before using private community features.",
    "wrong-community-code": "That community code was not accepted. Check it and try again.",
    "confirm-riot-ownership": "Confirm that the Riot account belongs to you before adding it.",
    "no-riot-connection": "No verified Riot account was found on Discord. Use Riot Sign On instead.",
    "missing-discord-session": "Your Discord session expired. Sign in again.",
    "session-ticket-invalid": "Discord sign-in expired before the session was saved. Continue with Discord again.",
    "session-completion-failed": "Discord sign-in finished, but RiftBoard could not save the session. Try again.",
    "missing-rso-state": "Riot sign-in expired. Start Add Riot account again.",
    "invalid-rso-state": "Riot sign-in did not match this browser. Start Add Riot account again.",
    "guild-membership-required": "Join the RiftBoard Discord server before signing in.",
    "invalid-riot-candidate": "That Riot account is no longer available. Start the connection again.",
    "discord-role-sync-failed": "The account is connected, but role sync failed. Reconnect Discord, then try again.",
    "linked-account-not-found": "That Riot account is no longer connected to your Discord account.",
    "primary-account-required": "Only the Riot account used for roles can sync Discord roles.",
    "primary-account-update-failed": "The role account could not be changed. Try again.",
    "discord-unlink-failed": "The Riot account could not be removed. Try again.",
    "riot-account-already-linked": "That Riot account is already connected to another Discord account.",
    "riot-id-puuid-conflict": "Riot returned an account identity that conflicts with saved data. Contact an administrator.",
  };

  const text =
    (message ? friendly[message] : null) ??
    (message?.startsWith("Discord authorization")
      ? "Discord sign-in was cancelled or denied."
      : message?.startsWith("Riot authorization")
        ? "Riot sign-in was cancelled or denied."
        : message?.startsWith("Missing env:")
          ? "Account sign-in is temporarily unavailable."
          : "We could not complete that account request. Try again.");

  return { tone: "red", text } as const;
}

function Notice({ tone, text }: { tone: NoticeTone; text: string }) {
  const className =
    tone === "emerald"
      ? "border-emerald-400/20 bg-emerald-400/8 text-emerald-100"
      : tone === "sky"
        ? "border-sky-400/20 bg-sky-400/8 text-sky-100"
        : "border-red-400/20 bg-red-400/8 text-red-100";

  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${className}`}
    >
      {text}
    </div>
  );
}

function displayRank(player?: LeanPlayer) {
  const tier = String(player?.solo?.tier ?? "").trim().toUpperCase();
  if (!tier) return "Solo unranked";

  const division = String(player?.solo?.division ?? "").trim().toUpperCase();
  const lp =
    typeof player?.solo?.lp === "number" && Number.isFinite(player.solo.lp)
      ? `${player.solo.lp} LP`
      : "";
  return [tier, division, lp].filter(Boolean).join(" ");
}

function verificationLabel(source?: string | null) {
  if (source === "riot_rso") return "Verified by Riot";
  if (source === "discord_connections") return "Verified through Discord";
  return "Added by RiftBoard staff";
}

function formatSyncDate(value: Date | string | null) {
  if (!value) return "Not synced yet";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";

  return `Synced ${new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Yangon",
  }).format(date)}`;
}

async function loadLinkedAccounts(discordUserId: string): Promise<LinkedAccountRow[]> {
  await dbConnect();
  const links = (await DiscordLink.find(
    {
      discordUserId,
      verifiedBinding: true,
    },
    {
      _id: 1,
      playerId: 1,
      gameName: 1,
      tagLine: 1,
      verificationSource: 1,
      isPrimary: 1,
      lastSyncedAt: 1,
      guildRankRolesSyncedAt: 1,
      updatedAt: 1,
    }
  )
    .sort({ isPrimary: -1, updatedAt: -1, _id: -1 })
    .lean()) as unknown as LeanLink[];

  const playerIds = links.map((link) => link.playerId).filter(Boolean);
  const players = playerIds.length
    ? ((await Player.find(
        { _id: { $in: playerIds } },
        { _id: 1, platform: 1, solo: 1 }
      ).lean()) as unknown as LeanPlayer[])
    : [];
  const playerById = new Map(players.map((player) => [String(player._id), player]));

  return links.map((link) => {
    const gameName = String(link.gameName ?? "").trim();
    const tagLine = String(link.tagLine ?? "").trim();
    const player = playerById.get(String(link.playerId));
    return {
      linkId: String(link._id),
      riotId: `${gameName}#${tagLine}`,
      profileHref: canonicalPlayerPath(gameName, tagLine),
      platform: String(player?.platform ?? "").trim().toUpperCase() || "AUTO",
      rank: displayRank(player),
      verification: verificationLabel(link.verificationSource),
      isRoleAccount: link.isPrimary === true,
      syncedAt:
        link.guildRankRolesSyncedAt ??
        link.lastSyncedAt ??
        null,
    };
  });
}

function DiscordAvatar({ username }: { username: string }) {
  const initial = Array.from(username.trim())[0]?.toUpperCase() ?? "D";
  return (
    <div
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-400/15 text-lg font-semibold text-indigo-200 ring-1 ring-indigo-300/20"
    >
      {initial}
    </div>
  );
}

function RiotAccountRow({ account }: { account: LinkedAccountRow }) {
  return (
    <div className="px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={account.profileHref}
              className="truncate text-base font-semibold text-zinc-50 transition hover:text-emerald-200"
            >
              {account.riotId}
            </Link>
            {account.isRoleAccount ? (
              <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                Used for roles
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
            <span>{account.platform}</span>
            <span aria-hidden="true" className="text-zinc-700">·</span>
            <span>{account.rank}</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {account.verification} · {formatSyncDate(account.syncedAt)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={account.profileHref}
            className="inline-flex min-h-10 items-center rounded-xl px-3.5 py-2 text-sm font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
          >
            Open profile
          </Link>
          {account.isRoleAccount ? (
            <AccountHubPostAction
              action="/api/discord/bind/sync"
              fields={{ linkId: account.linkId }}
              label="Sync roles"
              pendingLabel="Syncing..."
            />
          ) : (
            <AccountHubPostAction
              action="/api/discord/bind/primary"
              fields={{ linkId: account.linkId }}
              label="Use for roles"
              pendingLabel="Updating..."
            />
          )}
          <AccountHubPostAction
            action="/api/discord/bind/remove"
            fields={{ linkId: account.linkId }}
            label="Remove"
            pendingLabel="Removing..."
            confirmMessage={`Remove ${account.riotId} from your Discord account?`}
            variant="danger"
          />
        </div>
      </div>
    </div>
  );
}

function RiotConnectButton({
  label = "Add Riot account",
  returnTo = "/discord/linked-roles",
}: {
  label?: string;
  returnTo?: string;
}) {
  return (
    <form action="/api/riot/oauth/start" method="GET">
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="bindDiscord" value="1" />
      <input type="hidden" name="switch" value="1" />
      <button
        type="submit"
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300"
      >
        {label}
      </button>
    </form>
  );
}

export default async function DiscordLinkedRolesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    message?: string;
    riotId?: string;
    returnTo?: string;
  }>;
}) {
  const [{ status, message, riotId, returnTo }, store, viewer] = await Promise.all([
    searchParams,
    cookies(),
    getOptionalDiscordSession(),
  ]);
  const pendingCookie = readPendingDiscordBindCookieValue(
    store.get("discord_pending_bind")?.value
  );
  const pending =
    pendingCookie &&
    (!viewer?.discordUserId ||
      pendingCookie.discordUserId === viewer.discordUserId)
      ? pendingCookie
      : null;
  const browserUnlocked = hasCommunityAccessCookieValue(
    store.get("community_access")?.value
  );
  const storedUnlocked = viewer?.discordUserId
    ? await hasStoredCommunityAccessForDiscordUser(viewer.discordUserId)
    : false;
  const communityUnlocked = browserUnlocked || storedUnlocked;
  const communityCodeRequired = isCommunityCodeRequired();
  const communityDiscordUrl = getCommunityDiscordUrl();
  const canShowDiscordInvite =
    Boolean(communityDiscordUrl) &&
    (!communityCodeRequired || communityUnlocked);
  const linkedAccounts = viewer?.discordUserId
    ? await loadLinkedAccounts(viewer.discordUserId)
    : [];
  const notice =
    status === "connected" && !viewer
      ? ({
          tone: "red",
          text: "Discord sign-in finished, but this browser did not keep the session. Continue with Discord again.",
        } as const)
      : noticeText(status, message, riotId);
  const nextReturnTo = normalizeReturnTo(returnTo);
  const discordName =
    viewer?.discordUsername ??
    pending?.discordUsername ??
    viewer?.discordUserId ??
    pending?.discordUserId ??
    "Discord account";

  return (
    <main className="min-h-[calc(100vh-5rem)] text-zinc-100">
      <div className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="mb-7">
          <Link
            href="/"
            className="text-sm text-zinc-500 transition hover:text-zinc-200"
          >
            ← Back to leaderboard
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            Linked accounts
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
            Sign in with Discord, then connect the Riot accounts you use on RiftBoard.
          </p>
        </header>

        {notice ? (
          <div className="mb-5">
            <Notice tone={notice.tone} text={notice.text} />
          </div>
        ) : null}

        {pending ? (
          <section className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-900/35 shadow-2xl shadow-black/20">
            <div className="border-b border-white/8 px-5 py-6 sm:px-6">
              <div className="flex items-center gap-4">
                <DiscordAvatar username={discordName} />
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                    Signed in with Discord
                  </div>
                  <div className="mt-1 truncate text-lg font-semibold text-zinc-50">
                    {discordName}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-6 sm:px-6">
              <h2 className="text-xl font-semibold text-zinc-50">
                Connect a Riot account
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                This Riot account will be added under your Discord login and used for rank roles.
              </p>
            </div>

            {pending.candidates.length ? (
              <div className="divide-y divide-white/8 border-y border-white/8">
                {pending.candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                  >
                    <div>
                      <div className="font-semibold text-zinc-100">
                        {candidate.riotId}
                      </div>
                      <div className="mt-1 text-sm text-zinc-500">
                        Verified Discord connection
                      </div>
                    </div>
                    <AccountHubPostAction
                      action="/api/discord/bind/confirm"
                      fields={{
                        candidateId: candidate.id,
                        confirmOwnership: "yes",
                      }}
                      label="Add this account"
                      pendingLabel="Connecting..."
                      confirmMessage={`Confirm that ${candidate.riotId} belongs to you?`}
                      variant="primary"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-y border-white/8 px-5 py-5 sm:px-6">
                <p className="text-sm leading-6 text-zinc-400">
                  Discord did not provide a verified Riot connection. Sign in with Riot to add one.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 px-5 py-5 sm:px-6">
              <form action="/api/riot/oauth/start" method="GET">
                <input
                  type="hidden"
                  name="returnTo"
                  value={pending.returnTo || "/discord/linked-roles"}
                />
                <input type="hidden" name="bindDiscord" value="1" />
                <input type="hidden" name="switch" value="1" />
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                >
                  Use another Riot account
                </button>
              </form>
              <AccountHubPostAction
                action="/api/discord/bind/cancel"
                label={viewer ? "Skip for now" : "Cancel setup"}
                pendingLabel="Closing..."
                variant="quiet"
              />
            </div>
          </section>
        ) : viewer ? (
          <section className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-900/35 shadow-2xl shadow-black/20">
            <div className="px-5 py-6 sm:px-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <DiscordAvatar username={discordName} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-lg font-semibold text-zinc-50">
                        {discordName}
                      </div>
                      <span className="rounded-full bg-indigo-400/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 ring-1 ring-indigo-300/15">
                        Discord login
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      This Discord account owns the Riot connections below.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action="/api/discord/oauth/start" method="GET">
                    <input
                      type="hidden"
                      name="returnTo"
                      value="/discord/linked-roles"
                    />
                    <button
                      type="submit"
                      className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
                    >
                      Reconnect Discord
                    </button>
                  </form>
                  <AccountHubPostAction
                    action="/api/discord/session/logout"
                    label="Sign out"
                    pendingLabel="Signing out..."
                    variant="quiet"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2 text-xs text-zinc-400">
                <span className="rounded-full border border-white/8 bg-black/15 px-3 py-1.5">
                  Discord connected
                </span>
                <span className="rounded-full border border-white/8 bg-black/15 px-3 py-1.5">
                  {linkedAccounts.length} Riot {linkedAccounts.length === 1 ? "account" : "accounts"}
                </span>
                {communityCodeRequired ? (
                  <span className="rounded-full border border-white/8 bg-black/15 px-3 py-1.5">
                    Community access {communityUnlocked ? "active" : "locked"}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="border-t border-white/8">
              <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 className="font-semibold text-zinc-50">Riot accounts</h2>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
                    One account supplies your default rank and Discord roles. You can change it anytime.
                  </p>
                </div>
                <RiotConnectButton returnTo={nextReturnTo} />
              </div>

              {linkedAccounts.length ? (
                <div className="divide-y divide-white/8 border-t border-white/8">
                  {linkedAccounts.map((account) => (
                    <RiotAccountRow key={account.linkId} account={account} />
                  ))}
                </div>
              ) : (
                <div className="border-t border-white/8 px-5 py-8 text-center sm:px-6">
                  <div className="text-sm font-medium text-zinc-200">
                    No Riot accounts connected
                  </div>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
                    Add your Riot account to appear in tournaments, open your player profile, and sync rank roles.
                  </p>
                  <div className="mt-4 flex justify-center">
                    <RiotConnectButton
                      label="Connect Riot account"
                      returnTo={nextReturnTo}
                    />
                  </div>
                </div>
              )}
            </div>

            {communityCodeRequired ? (
              <div className="border-t border-white/8 px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold text-zinc-50">Community access</div>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      {communityUnlocked
                        ? "Private community features are available for this Discord account."
                        : "Enter your member code once to unlock private community features."}
                    </p>
                  </div>
                  {communityUnlocked ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-300/15">
                        Active
                      </span>
                      {canShowDiscordInvite ? (
                        <Link
                          href={communityDiscordUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-10 items-center rounded-xl border border-white/10 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/5"
                        >
                          Open Discord
                        </Link>
                      ) : null}
                    </div>
                  ) : (
                    <form
                      action="/api/community/access"
                      method="POST"
                      className="flex w-full max-w-sm gap-2 sm:w-auto"
                    >
                      <input
                        type="hidden"
                        name="returnTo"
                        value={nextReturnTo}
                      />
                      <label className="sr-only" htmlFor="community-code">
                        Community code
                      </label>
                      <input
                        id="community-code"
                        name="code"
                        type="password"
                        placeholder="Community code"
                        autoComplete="off"
                        required
                        className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/30"
                      />
                      <button
                        type="submit"
                        className="min-h-10 rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300"
                      >
                        Unlock
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ) : canShowDiscordInvite ? (
              <div className="border-t border-white/8 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-zinc-50">RiftBoard Discord</div>
                    <div className="mt-1 text-sm text-zinc-500">
                      Join the community server for events and rank roles.
                    </div>
                  </div>
                  <Link
                    href={communityDiscordUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 items-center rounded-xl border border-white/10 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/5"
                  >
                    Open Discord
                  </Link>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-900/35 px-5 py-10 text-center shadow-2xl shadow-black/20 sm:px-10 sm:py-14">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-400/15 text-xl font-semibold text-indigo-200 ring-1 ring-indigo-300/20">
              D
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-zinc-50">
              Sign in with Discord
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-zinc-400 sm:text-base">
              Your Discord login is your RiftBoard account. After signing in, you can connect and manage any Riot accounts you own.
            </p>
            <form action="/api/discord/oauth/start" method="GET" className="mt-6">
              <input type="hidden" name="returnTo" value={nextReturnTo} />
              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-indigo-300"
              >
                Continue with Discord
              </button>
            </form>
            {canShowDiscordInvite ? (
              <div className="mt-5 text-sm text-zinc-500">
                Not in the server yet?{" "}
                <Link
                  href={communityDiscordUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 underline decoration-white/20 underline-offset-4 transition hover:text-white"
                >
                  Join the RiftBoard Discord
                </Link>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
