import { NextRequest, NextResponse } from "next/server";
import { syncOwnedPrimaryDiscordRoles } from "@/lib/discordAccountRoles";
import { getOptionalDiscordSessionFromRequest } from "@/lib/discordSession";

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
  try {
    const result = await syncOwnedPrimaryDiscordRoles(session.discordUserId, linkId);
    if (result.outcome === "failed") {
      return redirectLinkedRoles(
        req,
        "error",
        "discord-role-sync-failed",
        result.riotId
      );
    }
    if (result.outcome === "partial") {
      return redirectLinkedRoles(
        req,
        "synced",
        "discord-role-sync-partial",
        result.riotId
      );
    }

    return redirectLinkedRoles(
      req,
      "synced",
      result.linkedRoleAttempted
        ? "discord-roles-synced"
        : "discord-guild-role-synced",
      result.riotId
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "discord-role-sync-failed";
    if (message !== "linked-account-not-found" && message !== "primary-account-required") {
      console.error("[discord/account] role sync failed", error);
    }
    return redirectLinkedRoles(
      req,
      "error",
      message === "linked-account-not-found" || message === "primary-account-required"
        ? message
        : "discord-role-sync-failed"
    );
  }
}
