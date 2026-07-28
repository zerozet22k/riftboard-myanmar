import { NextRequest, NextResponse } from "next/server";
import { getDiscordRedirectUri } from "@/lib/discord";
import { loadStoredDiscordAccount } from "@/lib/discordAccountStore";
import {
  clearDiscordOAuthStateCookie,
  clearPendingDiscordBindCookie,
  normalizeReturnTo,
  readDiscordOAuthStateCookieValue,
  readDiscordLoginCompletionTicketValue,
  setDiscordSessionCookie,
} from "@/lib/discordSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(response: NextResponse) {
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function accountHubUrl(
  origin: string,
  status: "connected" | "error",
  message: string,
  returnTo?: string | null
) {
  const target = new URL("/discord/linked-roles", origin);
  target.searchParams.set("status", status);
  target.searchParams.set("message", message);
  const safeReturnTo = normalizeReturnTo(returnTo);
  if (safeReturnTo !== "/discord/linked-roles") {
    target.searchParams.set("returnTo", safeReturnTo);
  }
  return target;
}

export async function GET(req: NextRequest) {
  const callbackUrl = new URL(getDiscordRedirectUri());
  const ticket = readDiscordLoginCompletionTicketValue(
    req.nextUrl.searchParams.get("ticket")
  );
  const storedState = readDiscordOAuthStateCookieValue(
    req.cookies.get("discord_oauth_state")?.value
  );

  if (!ticket || !storedState || storedState.state !== ticket.oauthState) {
    return noStore(
      NextResponse.redirect(
        accountHubUrl(
          callbackUrl.origin,
          "error",
          "session-ticket-invalid"
        ),
        303
      )
    );
  }

  try {
    await loadStoredDiscordAccount(ticket.discordUserId);
    const response = NextResponse.redirect(
      accountHubUrl(
        callbackUrl.origin,
        "connected",
        "discord-account-connected",
        ticket.returnTo
      ),
      303
    );
    setDiscordSessionCookie(
      response,
      { discordUserId: ticket.discordUserId },
      callbackUrl.protocol === "https:"
    );
    clearDiscordOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return noStore(response);
  } catch (error) {
    console.error(
      "[discord/session] Login completion failed",
      error instanceof Error ? error.name : "UnknownError"
    );
    return noStore(
      NextResponse.redirect(
        accountHubUrl(
          callbackUrl.origin,
          "error",
          "session-completion-failed",
          ticket.returnTo
        ),
        303
      )
    );
  }
}
