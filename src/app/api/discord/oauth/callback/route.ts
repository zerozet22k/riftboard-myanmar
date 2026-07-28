import { NextRequest, NextResponse } from "next/server";
import {
  exchangeDiscordCode,
  getDiscordGuildId,
  getDiscordUser,
  getDiscordUserGuilds,
} from "@/lib/discord";
import { saveDiscordAccountFromOAuth } from "@/lib/discordAccountStore";
import {
  clearDiscordOAuthStateCookie,
  clearPendingDiscordBindCookie,
  normalizeReturnTo,
  readDiscordOAuthStateCookieValue,
  setDiscordSessionCookie,
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

  let connectedDiscordUserId = "";

  try {
    const token = await exchangeDiscordCode(code);
    const [discordUser, guilds] = await Promise.all([
      getDiscordUser(token.access_token),
      getDiscordUserGuilds(token.access_token),
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

    await saveDiscordAccountFromOAuth({
      discordUser,
      token,
      verifiedGuildId: requiredGuildId,
    });
    connectedDiscordUserId = discordUser.id;

    const response = redirectWithStatus(
      req,
      "connected",
      "discord-account-connected",
      undefined,
      storedState.returnTo
    );
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
      error instanceof Error ? error.message : "discord-link-failed",
      undefined,
      storedState.returnTo
    );
    if (connectedDiscordUserId) {
      setDiscordSessionCookie(
        response,
        { discordUserId: connectedDiscordUserId },
        req.nextUrl.protocol === "https:"
      );
    }
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  }
}
