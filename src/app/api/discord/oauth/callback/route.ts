import { NextRequest, NextResponse } from "next/server";
import {
  exchangeDiscordCode,
  getDiscordGuildId,
  getDiscordUser,
  getDiscordUserConnections,
  getDiscordUserGuilds,
} from "@/lib/discord";
import {
  extractRiotCandidatesFromDiscordConnections,
  saveVerifiedDiscordLinkFromCandidate,
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import {
  clearDiscordOAuthStateCookie,
  clearPendingDiscordBindCookie,
  makePendingDiscordBindPayload,
  normalizeReturnTo,
  readDiscordOAuthStateCookieValue,
  setDiscordSessionCookie,
  setPendingDiscordBindCookie,
} from "@/lib/discordSession";
import { oauthProviderErrorMessage } from "@/lib/oauthRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWithStatus(
  req: NextRequest,
  status: string,
  message?: string,
  riotId?: string,
  returnTo?: string | null
) {
  const url = new URL("/discord/linked-roles", req.url);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("message", message);
  if (riotId) url.searchParams.set("riotId", riotId);
  const safeReturnTo = normalizeReturnTo(returnTo);
  if (safeReturnTo !== "/discord/linked-roles") {
    url.searchParams.set("returnTo", safeReturnTo);
  }
  return NextResponse.redirect(url);
}

function redirectAfterLinked(
  req: NextRequest,
  returnTo: string,
  riotId: string,
  syncFailed: boolean
) {
  const target = new URL(normalizeReturnTo(returnTo), req.url);
  if (target.pathname === "/discord/linked-roles") {
    target.searchParams.set("status", "linked");
    target.searchParams.set("riotId", riotId);
    if (syncFailed) target.searchParams.set("message", "discord-role-sync-failed");
  }
  return NextResponse.redirect(target);
}

async function syncDiscordRoles(linkId: string) {
  let failed = false;

  try {
    await syncDiscordLinkedRoleForStoredLink(linkId, { force: true });
  } catch (error) {
    failed = true;
    console.error("[discord/oauth] linked role sync failed", error);
  }

  try {
    await syncDiscordGuildRankRoleForStoredLink(linkId, { force: true });
  } catch (error) {
    failed = true;
    console.error("[discord/oauth] guild rank role sync failed", error);
  }

  return failed;
}

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get("code") ?? "").trim();
  const state = String(req.nextUrl.searchParams.get("state") ?? "").trim();
  const providerError = String(req.nextUrl.searchParams.get("error") ?? "").trim();
  const providerErrorDescription = String(
    req.nextUrl.searchParams.get("error_description") ?? ""
  ).trim();
  const storedState = readDiscordOAuthStateCookieValue(req.cookies.get("discord_oauth_state")?.value);

  if (!state || !storedState) {
    const response = redirectWithStatus(req, "error", "missing-oauth-state");
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }

  if (storedState.state !== state) {
    const response = redirectWithStatus(
      req,
      "error",
      "invalid-oauth-state",
      undefined,
      storedState.returnTo
    );
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }

  if (providerError) {
    const response = redirectWithStatus(
      req,
      "error",
      oauthProviderErrorMessage("Discord", providerError, providerErrorDescription),
      undefined,
      storedState.returnTo
    );
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }

  if (!code) {
    const response = redirectWithStatus(
      req,
      "error",
      "Discord returned without an authorization code. Start the link again.",
      undefined,
      storedState.returnTo
    );
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }

  try {
    const token = await exchangeDiscordCode(code);
    const [discordUser, guilds, connections] = await Promise.all([
      getDiscordUser(token.access_token),
      getDiscordUserGuilds(token.access_token),
      getDiscordUserConnections(token.access_token),
    ]);

    const requiredGuildId = String(getDiscordGuildId() ?? "").trim();
    if (!requiredGuildId) {
      throw new Error("Missing env: DISCORD_GUILD_ID");
    }
    const guildVerified = guilds.some((guild) => String(guild?.id ?? "").trim() === requiredGuildId);
    if (!guildVerified) {
      const response = redirectWithStatus(
        req,
        "error",
        "guild-membership-required",
        undefined,
        storedState.returnTo
      );
      clearDiscordOAuthStateCookie(response);
      clearPendingDiscordBindCookie(response);
      return response;
    }

    const candidates = extractRiotCandidatesFromDiscordConnections(connections);
    if (!candidates.length) {
      const response = redirectWithStatus(
        req,
        "choose",
        "connect-riot-rso",
        undefined,
        storedState.returnTo
      );
      setPendingDiscordBindCookie(
        response,
        makePendingDiscordBindPayload({
          discordUserId: discordUser.id,
          discordUsername: discordUser.global_name || discordUser.username,
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          tokenType: token.token_type,
          scopes: String(token.scope ?? "")
            .trim()
            .split(/\s+/)
            .filter(Boolean),
          expiresAt: new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000),
          candidates: [],
          returnTo: storedState.returnTo,
        }),
        req.nextUrl.protocol === "https:"
      );
      clearDiscordOAuthStateCookie(response);
      return response;
    }

    if (candidates.length === 1) {
      const bound = await saveVerifiedDiscordLinkFromCandidate({
        discordUser,
        token,
        candidate: candidates[0],
      });
      const syncFailed = await syncDiscordRoles(String(bound.link._id));
      const response = redirectAfterLinked(
        req,
        storedState.returnTo,
        `${bound.player.gameName}#${bound.player.tagLine}`,
        syncFailed
      );

      setDiscordSessionCookie(response, { discordUserId: discordUser.id }, req.nextUrl.protocol === "https:");
      clearDiscordOAuthStateCookie(response);
      clearPendingDiscordBindCookie(response);
      return response;
    }

    const response = redirectWithStatus(
      req,
      "choose",
      undefined,
      undefined,
      storedState.returnTo
    );
    setPendingDiscordBindCookie(
      response,
      makePendingDiscordBindPayload({
        discordUserId: discordUser.id,
        discordUsername: discordUser.global_name || discordUser.username,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenType: token.token_type,
        scopes: String(token.scope ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean),
        expiresAt: new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000),
        candidates,
        returnTo: storedState.returnTo,
      }),
      req.nextUrl.protocol === "https:"
    );
    clearDiscordOAuthStateCookie(response);
    return response;
  } catch (error) {
    const response = redirectWithStatus(
      req,
      "error",
      error instanceof Error ? error.message : "discord-link-failed",
      undefined,
      storedState.returnTo
    );
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }
}
