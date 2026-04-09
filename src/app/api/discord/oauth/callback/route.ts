import { NextRequest, NextResponse } from "next/server";
import { hasStoredCommunityAccessRecord } from "@/lib/communityAccess";
import { dbConnect } from "@/lib/mongodb";
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
import { isCommunityCodeRequired } from "@/lib/runtimeConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWithStatus(req: NextRequest, status: string, message?: string, riotId?: string) {
  const url = new URL("/discord/linked-roles", req.url);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("message", message);
  if (riotId) url.searchParams.set("riotId", riotId);
  return NextResponse.redirect(url);
}

function redirectToReturnPath(req: NextRequest, returnTo: string, riotId: string, message?: string) {
  const target = new URL(normalizeReturnTo(returnTo), req.url);
  if (target.pathname === "/discord/linked-roles") {
    target.searchParams.set("status", "linked");
    target.searchParams.set("riotId", riotId);
    if (message) target.searchParams.set("message", message);
  }
  return NextResponse.redirect(target);
}

function redirectToCommunityCodeStep(req: NextRequest, returnTo: string, riotId: string) {
  const target = new URL("/discord/linked-roles", req.url);
  target.searchParams.set("status", "linked");
  target.searchParams.set("message", "community-code-required");
  target.searchParams.set("riotId", riotId);
  target.searchParams.set("returnTo", normalizeReturnTo(returnTo));
  return NextResponse.redirect(target);
}

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get("code") ?? "").trim();
  const state = String(req.nextUrl.searchParams.get("state") ?? "").trim();
  const storedState = readDiscordOAuthStateCookieValue(req.cookies.get("discord_oauth_state")?.value);

  if (!code || !state || !storedState) {
    const response = redirectWithStatus(req, "error", "missing-oauth-state");
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }

  if (storedState.state !== state) {
    const response = redirectWithStatus(req, "error", "invalid-oauth-state");
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
      const response = redirectWithStatus(req, "error", "guild-membership-required");
      clearDiscordOAuthStateCookie(response);
      clearPendingDiscordBindCookie(response);
      return response;
    }

    const candidates = extractRiotCandidatesFromDiscordConnections(connections);
    if (!candidates.length) {
      const response = redirectWithStatus(req, "error", "no-riot-connection");
      clearDiscordOAuthStateCookie(response);
      clearPendingDiscordBindCookie(response);
      return response;
    }

    if (candidates.length > 1) {
      const response = redirectWithStatus(req, "choose");
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
    }

    await dbConnect();
    const bound = await saveVerifiedDiscordLinkFromCandidate({
      discordUser,
      token,
      candidate: candidates[0],
    });

    let syncMessage: string | undefined;
    try {
      await syncDiscordLinkedRoleForStoredLink(String(bound.link._id));
    } catch {
      syncMessage = "discord-role-sync-failed";
    }

    try {
      await syncDiscordGuildRankRoleForStoredLink(String(bound.link._id));
    } catch {
      syncMessage = "discord-role-sync-failed";
    }

    const riotId = `${bound.player.gameName}#${bound.player.tagLine}`;
    const requiresCommunityCode =
      isCommunityCodeRequired() && !hasStoredCommunityAccessRecord(bound.link);
    const response = requiresCommunityCode
      ? redirectToCommunityCodeStep(req, storedState.returnTo, riotId)
      : redirectToReturnPath(req, storedState.returnTo, riotId, syncMessage);
    setDiscordSessionCookie(
      response,
      { discordUserId: discordUser.id },
      req.nextUrl.protocol === "https:"
    );
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  } catch (error) {
    const response = redirectWithStatus(
      req,
      "error",
      error instanceof Error ? error.message : "discord-link-failed"
    );
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }
}
