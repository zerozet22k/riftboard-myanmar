import { NextRequest, NextResponse } from "next/server";
import {
  grantStoredCommunityAccessForDiscordUser,
  setCommunityAccessCookie,
} from "@/lib/communityAccess";
import { getOptionalDiscordSessionFromRequest, normalizeReturnTo } from "@/lib/discordSession";
import { getCommunityJoinCodes } from "@/lib/runtimeConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const code = String(form.get("code") ?? "").trim();
  const returnTo = normalizeReturnTo(String(form.get("returnTo") ?? "/discord/linked-roles"));
  const target = new URL(returnTo, req.url);
  const requiredCodes = getCommunityJoinCodes();

  if (requiredCodes.length && !requiredCodes.includes(code)) {
    const failure = new URL("/discord/linked-roles", req.url);
    failure.searchParams.set("status", "error");
    failure.searchParams.set("message", "wrong-community-code");
    return NextResponse.redirect(failure);
  }

  const response = NextResponse.redirect(target);
  const session = await getOptionalDiscordSessionFromRequest(req);
  if (session?.discordUserId) {
    await grantStoredCommunityAccessForDiscordUser(session.discordUserId);
  }
  setCommunityAccessCookie(response, req.nextUrl.protocol === "https:");
  return response;
}
