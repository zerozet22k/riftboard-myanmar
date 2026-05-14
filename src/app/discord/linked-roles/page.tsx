import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import {
  hasCommunityAccessCookieValue,
  hasStoredCommunityAccessForDiscordUser,
} from "@/lib/communityAccess";
import {
  getOptionalDiscordSession,
  normalizeReturnTo,
  readPendingDiscordBindCookieValue,
} from "@/lib/discordSession";
import {
  getCommunityDiscordUrl,
} from "@/lib/runtimeConfig";
import { dbConnect } from "@/lib/mongodb";
import { DiscordLink } from "@/models/discordLink";

export const metadata: Metadata = {
  title: "Discord Access",
  description: "Connect Discord and unlock Burma-only community access for your linked Riot account.",
  robots: {
    index: false,
    follow: false,
  },
};

function messageText(status?: string, message?: string, riotId?: string) {
  if (status === "linked") {
    return {
      tone: "emerald",
      text:
        message === "community-code-required"
          ? riotId
            ? `Discord linked successfully for ${riotId}. Enter your private community code once to unlock community actions for this Discord account.`
            : "Discord linked successfully. Enter your private community code once to unlock community actions for this Discord account."
          : riotId
            ? `Discord linked successfully for ${riotId}. Riftboard now trusts that Riot account only until you explicitly re-link.${message === "discord-role-sync-failed" ? " Discord role sync still needs a retry." : ""}`
            : `Discord linked successfully.${message === "discord-role-sync-failed" ? " Discord role sync still needs a retry." : ""}`,
    } as const;
  }

  if (status === "choose") {
    return {
      tone: "sky",
      text: "Verify the Riot account below before Riftboard saves this link.",
    } as const;
  }

  if (status === "unlinked") {
    return {
      tone: "emerald",
      text: "The linked Riot account was removed from this Discord profile. You can reconnect anytime.",
    } as const;
  }

  if (status === "error") {
    const friendly =
      message === "missing-oauth-state"
        ? "The Discord OAuth flow was incomplete. Start again from this page."
        : message === "invalid-oauth-state"
          ? "Discord OAuth state did not match. Start the link flow again."
          : message === "oauth-state-expired"
            ? "Your Discord OAuth session expired. Start the link flow again."
            : message === "community-code-required"
              ? "Enter your private community code first to unlock Discord access for this browser."
              : message === "wrong-community-code"
                ? "That community code was not accepted. Check it and try again."
            : message === "confirm-riot-ownership"
              ? "Confirm that this Riot account is yours before finishing the link."
          : message === "no-riot-connection"
              ? "Discord did not return a Riot account connection. Sign in with Riot below to verify the account directly."
              : message === "missing-discord-session"
                ? "Your Discord session expired. Connect Discord again."
                : message === "missing-rso-state"
                  ? "The Riot sign-in flow expired or started without the needed state. Try Add Riot account again."
                  : message === "invalid-rso-state"
                    ? "Riot sign-in state did not match. Try Add Riot account again."
                    : message?.startsWith("Missing env: RSO_CLIENT_SECRET")
                      ? "Riot Sign On is not fully configured yet. Add RSO_CLIENT_SECRET in Vercel, then redeploy."
            : message === "guild-membership-required"
                ? "You must join the configured Discord server before binding your Riot account."
                : message === "invalid-riot-candidate"
                  ? "That Riot candidate is no longer available. Restart the Discord link flow."
                  : message === "discord-role-sync-failed"
                    ? "Your account was linked, but Discord role syncing did not fully finish yet. Run the refresh command later."
                    : message || "Something went wrong while linking your Discord account.";

    return { tone: "red", text: friendly } as const;
  }

  return null;
}

function Notice({
  tone,
  text,
}: {
  tone: "emerald" | "red" | "sky";
  text: string;
}) {
  const className =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/20"
      : tone === "sky"
        ? "bg-sky-500/10 text-sky-200 ring-sky-500/20"
        : "bg-red-500/10 text-red-200 ring-red-500/20";

  return <section className={`rounded-[24px] px-5 py-4 text-sm ring-1 ${className}`}>{text}</section>;
}

export default async function DiscordLinkedRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; message?: string; riotId?: string; returnTo?: string }>;
}) {
  const [{ status, message, riotId, returnTo }, store, viewer] = await Promise.all([
    searchParams,
    cookies(),
    getOptionalDiscordSession(),
  ]);
  const browserUnlocked = hasCommunityAccessCookieValue(store.get("community_access")?.value);
  const storedUnlocked = viewer?.discordUserId
    ? await hasStoredCommunityAccessForDiscordUser(viewer.discordUserId)
    : false;
  const communityUnlocked = browserUnlocked || storedUnlocked;
  const communityDiscordUrl = getCommunityDiscordUrl();
  const pending = readPendingDiscordBindCookieValue(store.get("discord_pending_bind")?.value);
  const notice = messageText(status, message, riotId);
  const nextReturnTo = normalizeReturnTo(returnTo);
  const linkedAccounts = viewer
    ? await (async () => {
        await dbConnect();
        const links = await DiscordLink.find(
          { discordUserId: viewer.discordUserId, verifiedBinding: true },
          { gameName: 1, tagLine: 1, verificationSource: 1, isPrimary: 1, updatedAt: 1 }
        )
          .sort({ isPrimary: -1, updatedAt: -1 })
          .lean();

        return links.map((link) => ({
          gameName: String(link.gameName ?? ""),
          tagLine: String(link.tagLine ?? ""),
          verificationSource: String(link.verificationSource ?? ""),
          isPrimary: link.isPrimary === true,
        }));
      })()
    : [];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[980px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-[30px] bg-zinc-900/30 p-6 ring-1 ring-white/5 sm:p-8">
          <Link href="/" className="text-sm text-zinc-400 transition hover:text-zinc-200">
            Back to leaderboard
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-50">Account hub</h1>
        </header>

        {notice ? <Notice tone={notice.tone} text={notice.text} /> : null}

        <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6">
          <div className="text-xl font-semibold text-zinc-50">
            {viewer ? "Connected" : "Connect Discord"}
          </div>

            {!viewer && communityUnlocked && communityDiscordUrl ? (
              <div className="mt-5">
                <Link
                  href={communityDiscordUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
                >
                  Open Discord invite
                </Link>
              </div>
            ) : null}

            {viewer ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-[24px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
                  <div className="text-sm text-zinc-400">Discord</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-100">
                    {viewer.discordUsername ?? viewer.discordUserId}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <form action="/api/riot/oauth/start" method="GET">
                      <input type="hidden" name="returnTo" value="/discord/linked-roles" />
                      <input type="hidden" name="bindDiscord" value="1" />
                      <button
                        type="submit"
                        className="rounded-2xl bg-emerald-500/90 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
                      >
                        Add Riot account
                      </button>
                    </form>
                    <form action="/api/discord/oauth/start" method="GET">
                      <input type="hidden" name="returnTo" value="/discord/linked-roles" />
                      <button
                        type="submit"
                        className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-zinc-200 transition hover:bg-white/5"
                      >
                        Reconnect Discord
                      </button>
                    </form>
                    {communityDiscordUrl ? (
                      <Link
                        href={communityDiscordUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-zinc-200 transition hover:bg-white/5"
                      >
                        Discord invite
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-[24px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
                  <div className="text-sm font-semibold text-zinc-100">Linked Riot accounts</div>
                  <div className="mt-3 grid gap-2">
                    {linkedAccounts.map((account) => (
                      <div
                        key={`${account.gameName}#${account.tagLine}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-zinc-900/65 px-3 py-2"
                      >
                        <div>
                          <div className="font-semibold text-zinc-100">{account.gameName}#{account.tagLine}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {account.verificationSource === "riot_rso"
                              ? "Riot Sign On"
                              : account.verificationSource === "discord_connections"
                                ? "Discord connection"
                                : "Admin bind"}
                          </div>
                        </div>
                        {account.isPrimary ? (
                          <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                            Primary
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                {viewer && !communityUnlocked ? (
                  <form action="/api/community/access" method="POST" className="rounded-[24px] bg-zinc-950/55 p-4 ring-1 ring-amber-300/15">
                    <input
                      type="hidden"
                      name="returnTo"
                      value={nextReturnTo !== "/discord/linked-roles" ? nextReturnTo : "/discord/linked-roles"}
                    />
                    <div className="text-sm font-semibold text-zinc-100">Community code</div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        name="code"
                        type="password"
                        placeholder="Private code"
                        autoComplete="off"
                        required
                        className="min-w-0 flex-1 rounded-2xl bg-zinc-900/70 px-4 py-3 text-zinc-100 outline-none ring-1 ring-white/8 focus:ring-white/15"
                      />
                      <button
                        type="submit"
                        className="rounded-2xl bg-emerald-500/90 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
                      >
                        Unlock
                      </button>
                    </div>
                  </form>
                ) : null}

                <form action="/api/discord/bind/remove" method="POST">
                  <button
                    type="submit"
                    className="rounded-2xl border border-red-300/20 px-5 py-3 text-sm text-red-200 transition hover:bg-red-500/10"
                  >
                    Remove primary linked account
                  </button>
                </form>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-3">
                <form action="/api/discord/oauth/start" method="GET">
                  <input type="hidden" name="returnTo" value="/discord/linked-roles" />
                  <button
                    type="submit"
                    className="rounded-2xl bg-emerald-500/90 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
                  >
                    Connect Discord
                  </button>
                </form>
                {communityDiscordUrl ? (
                  <Link
                    href={communityDiscordUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl border border-white/10 px-5 py-3 text-sm text-zinc-200 transition hover:bg-white/5"
                  >
                    Open Discord invite
                  </Link>
                ) : null}
              </div>
            )}
        </section>

        {pending ? (
          <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6">
            <div className="text-xl font-semibold text-zinc-50">Verify your Riot account</div>

            <div className="mt-5 rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
              <div className="text-sm font-semibold text-zinc-100">Riot Sign On</div>
              <form action="/api/riot/oauth/start" method="GET" className="mt-4">
                <input type="hidden" name="returnTo" value="/discord/linked-roles" />
                <button
                  type="submit"
                  className="rounded-2xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400"
                >
                  Sign in with Riot
                </button>
              </form>
            </div>

            {pending.candidates.length ? (
              <div className="mt-5 grid gap-3">
                {pending.candidates.map((candidate) => (
                <form
                  key={candidate.id}
                  action="/api/discord/bind/confirm"
                  method="POST"
                  className="rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6"
                >
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-zinc-100">{candidate.riotId}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                        Discord source: {candidate.connectionType}
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="rounded-2xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400"
                    >
                      Use this Riot account
                    </button>
                  </div>
                  <label className="mt-4 flex items-start gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      name="confirmOwnership"
                      value="yes"
                      required
                      className="mt-0.5 h-4 w-4 rounded border-white/20 bg-zinc-900/70"
                    />
                    <span>I confirm this Riot account belongs to this Discord profile.</span>
                  </label>
                </form>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

      </div>
    </main>
  );
}
