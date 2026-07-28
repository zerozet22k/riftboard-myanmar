import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import {
  saveVerifiedDiscordLinkFromCandidate,
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import {
  clearPendingDiscordBindCookie,
  discordSessionCookieIsSecure,
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
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const candidateId = String(formData?.get("candidateId") ?? "").trim();
  const confirmOwnership = String(formData?.get("confirmOwnership") ?? "").trim();
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

  if (confirmOwnership !== "yes") {
    return redirectLinkedRoles(req, "error", "confirm-riot-ownership");
  }

  try {
    await dbConnect();
    const bound = await saveVerifiedDiscordLinkFromCandidate({
      discordUserId: pending.discordUserId,
      candidate,
    });

    let syncMessage: string | undefined;
    if (bound.isPrimary) {
      try {
        await syncDiscordLinkedRoleForStoredLink(String(bound.link._id), { force: true });
      } catch {
        syncMessage = "discord-role-sync-failed";
      }

      try {
        await syncDiscordGuildRankRoleForStoredLink(String(bound.link._id), { force: true });
      } catch {
        syncMessage = "discord-role-sync-failed";
      }
    }

    const target = new URL(normalizeReturnTo(pending.returnTo), req.url);
    if (target.pathname === "/discord/linked-roles") {
      target.searchParams.set("status", "linked");
      target.searchParams.set("riotId", `${bound.player.gameName}#${bound.player.tagLine}`);
      if (syncMessage) target.searchParams.set("message", syncMessage);
    }

    const response = NextResponse.redirect(target, 303);
    setDiscordSessionCookie(
      response,
      { discordUserId: pending.discordUserId },
      discordSessionCookieIsSecure(req)
    );
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
