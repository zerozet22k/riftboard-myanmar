import { NextRequest, NextResponse } from "next/server";
import { syncOwnedPrimaryDiscordRoles } from "@/lib/discordAccountRoles";
import { getOptionalDiscordSessionFromRequest } from "@/lib/discordSession";
import { setPrimaryDiscordLink } from "@/lib/discordLinkStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectLinkedRoles(
  req: NextRequest,
  status: string,
  message: string,
  riotId?: string
) {
  const url = new URL("/discord/linked-roles", req.url);
  url.searchParams.set("status", status);
  url.searchParams.set("message", message);
  if (riotId) url.searchParams.set("riotId", riotId);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const session = await getOptionalDiscordSessionFromRequest(req);
  if (!session?.discordUserId) {
    return redirectLinkedRoles(req, "error", "missing-discord-session");
  }

  const formData = await req.formData().catch(() => null);
  const linkId = String(formData?.get("linkId") ?? "").trim();
  if (!linkId) {
    return redirectLinkedRoles(req, "error", "linked-account-not-found");
  }

  try {
    const selected = await setPrimaryDiscordLink(session.discordUserId, linkId);
    if (!selected?._id) {
      return redirectLinkedRoles(req, "error", "linked-account-not-found");
    }

    let message = "primary-account-updated";
    try {
      const roleSync = await syncOwnedPrimaryDiscordRoles(
        session.discordUserId,
        selected._id
      );
      if (roleSync.outcome === "partial") {
        message = "primary-account-updated-role-sync-partial";
      } else if (roleSync.outcome === "failed") {
        message = "primary-account-updated-role-sync-failed";
      }
    } catch (error) {
      message = "primary-account-updated-role-sync-failed";
      console.error("[discord/account] primary role sync failed", error);
    }

    return redirectLinkedRoles(
      req,
      "updated",
      message,
      `${selected.gameName}#${selected.tagLine}`
    );
  } catch (error) {
    console.error("[discord/account] primary selection failed", error);
    return redirectLinkedRoles(req, "error", "primary-account-update-failed");
  }
}
