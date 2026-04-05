import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasCommunityAccessFromRequest } from "@/lib/communityAccess";
import { makeDiscordOAuthUrl } from "@/lib/discord";
import { normalizeReturnTo, setDiscordOAuthStateCookie } from "@/lib/discordSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasCommunityAccessFromRequest(req)) {
    const denied = new URL("/discord/linked-roles", req.url);
    denied.searchParams.set("status", "error");
    denied.searchParams.set("message", "community-code-required");
    return NextResponse.redirect(denied);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const returnTo = normalizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const response = NextResponse.redirect(makeDiscordOAuthUrl(state));

  setDiscordOAuthStateCookie(response, { state, returnTo }, req.nextUrl.protocol === "https:");
  return response;
}
