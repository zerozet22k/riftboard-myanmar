import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import {
  saveVerifiedDiscordLinkFromCandidate,
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import {
  clearPendingDiscordBindCookie,
  decodePendingDiscordTokenPayload,
  normalizeReturnTo,
  readPendingDiscordBindCookieValue,
  setDiscordSessionCookie,
} from "@/lib/discordSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectLinkedRoles(req: NextRequest, status: string, message?: string, riotId?: string) {
  const url = new URL("/discord/linked-roles", req.url);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("message", message);
  if (riotId) url.searchParams.set("riotId", riotId);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const candidateId = String(formData?.get("candidateId") ?? "").trim();
  const pending = readPendingDiscordBindCookieValue(req.cookies.get("discord_pending_bind")?.value);

  if (!pending) {
    const response = redirectLinkedRoles(req, "error", "oauth-state-expired");
    clearPendingDiscordBindCookie(response);
    return response;
  }

  const candidate = pending.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    const response = redirectLinkedRoles(req, "error", "invalid-riot-candidate");
    clearPendingDiscordBindCookie(response);
    return response;
  }

  try {
    const decoded = decodePendingDiscordTokenPayload(pending);
    const expiresIn = decoded.expiresAt
      ? Math.max(60, Math.floor((decoded.expiresAt.getTime() - Date.now()) / 1000))
      : 3600;

    await dbConnect();
    const bound = await saveVerifiedDiscordLinkFromCandidate({
      discordUser: {
        id: pending.discordUserId,
        username: pending.discordUsername || "Discord User",
        global_name: pending.discordUsername,
      },
      token: {
        access_token: decoded.accessToken,
        refresh_token: decoded.refreshToken ?? undefined,
        token_type: pending.tokenType,
        expires_in: expiresIn,
        scope: pending.scopes.join(" "),
      },
      candidate,
    });

    let syncMessage: string | undefined;
    try {
      await syncDiscordLinkedRoleForStoredLink(String(bound.link._id));
    } catch {
      syncMessage = "linked-role-sync-failed";
    }

    const target = new URL(normalizeReturnTo(pending.returnTo), req.url);
    if (target.pathname === "/discord/linked-roles") {
      target.searchParams.set("status", "linked");
      target.searchParams.set("riotId", `${bound.player.gameName}#${bound.player.tagLine}`);
      if (syncMessage) target.searchParams.set("message", syncMessage);
    }

    const response = NextResponse.redirect(target);
    setDiscordSessionCookie(response, { discordUserId: pending.discordUserId }, req.nextUrl.protocol === "https:");
    clearPendingDiscordBindCookie(response);
    return response;
  } catch (error) {
    const response = redirectLinkedRoles(
      req,
      "error",
      error instanceof Error ? error.message : "discord-link-failed"
    );
    clearPendingDiscordBindCookie(response);
    return response;
  }
}
