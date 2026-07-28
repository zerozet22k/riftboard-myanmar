import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import {
  clearDiscordRolesWithoutRiotAccount,
  syncOwnedPrimaryDiscordRoles,
} from "@/lib/discordAccountRoles";
import { getOptionalDiscordSessionFromRequest } from "@/lib/discordSession";
import { removeOwnedDiscordLink } from "@/lib/discordLinkStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectLinkedRoles(
  req: NextRequest,
  status: string,
  message?: string,
  riotId?: string
) {
  const url = new URL("/discord/linked-roles", req.url);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("message", message);
  if (riotId) url.searchParams.set("riotId", riotId);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const session = await getOptionalDiscordSessionFromRequest(req);
  if (!session?.discordUserId) {
    return redirectLinkedRoles(req, "error", "missing-discord-session");
  }

  try {
    await dbConnect();
    const formData = await req.formData().catch(() => null);
    // Keeping the session link as the fallback preserves the old "remove primary"
    // form while allowing the account hub to target any owned link explicitly.
    const linkId = String(formData?.get("linkId") ?? session.linkId).trim();
    const result = await removeOwnedDiscordLink(session.discordUserId, linkId);
    if (!result) {
      return redirectLinkedRoles(req, "error", "linked-account-not-found");
    }

    const riotId = `${result.removed.gameName}#${result.removed.tagLine}`;
    const removedPrimary =
      result.removed.isPrimary === true ||
      String(result.removed._id) === String(session.linkId);
    let message = "riot-account-unlinked";

    if (removedPrimary && result.primary?._id) {
      try {
        const roleSync = await syncOwnedPrimaryDiscordRoles(
          session.discordUserId,
          result.primary._id
        );
        if (roleSync.outcome === "partial") {
          message = "riot-account-unlinked-role-sync-partial";
        } else if (roleSync.outcome === "failed") {
          message = "riot-account-unlinked-role-sync-failed";
        }
      } catch (error) {
        message = "riot-account-unlinked-role-sync-failed";
        console.error("[discord/account] promoted primary role sync failed", error);
      }
    } else if (removedPrimary && !result.primary?._id) {
      const roleClear = await clearDiscordRolesWithoutRiotAccount(
        session.discordUserId
      );
      if (roleClear.outcome === "partial") {
        message = "riot-account-unlinked-role-clear-partial";
      } else if (roleClear.outcome === "failed") {
        message = "riot-account-unlinked-role-clear-failed";
      }
    }

    return redirectLinkedRoles(
      req,
      "unlinked",
      message,
      riotId
    );
  } catch (error) {
    console.error("[discord/account] unlink failed", error);
    return redirectLinkedRoles(req, "error", "discord-unlink-failed");
  }
}
