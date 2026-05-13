import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import {
  clearDiscordSessionCookie,
  getOptionalDiscordSessionFromRequest,
} from "@/lib/discordSession";
import { DiscordLink } from "@/models/discordLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectLinkedRoles(req: NextRequest, status: string, message?: string) {
  const url = new URL("/discord/linked-roles", req.url);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}

export async function POST(req: NextRequest) {
  const session = await getOptionalDiscordSessionFromRequest(req);
  if (!session?.discordUserId) {
    return redirectLinkedRoles(req, "error", "missing-discord-session");
  }

  try {
    await dbConnect();
    await DiscordLink.deleteOne({ _id: session.linkId, discordUserId: session.discordUserId });
    const nextPrimary = await DiscordLink.findOne({ discordUserId: session.discordUserId })
      .sort({ updatedAt: -1, _id: -1 });
    if (nextPrimary?._id) {
      await DiscordLink.updateOne({ _id: nextPrimary._id }, { $set: { isPrimary: true } });
    }

    const response = redirectLinkedRoles(req, "unlinked", "discord-link-removed");
    if (!nextPrimary?._id) {
      clearDiscordSessionCookie(response);
    }
    return response;
  } catch (error) {
    return redirectLinkedRoles(
      req,
      "error",
      error instanceof Error ? error.message : "discord-unlink-failed"
    );
  }
}
