import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  clearRsoSessionCookie,
  getRsoRedirectUri,
  makeRsoOAuthUrl,
  normalizeReturnTo,
  setRsoOAuthStateCookie,
} from "@/lib/riotAuth";
import { oauthRequestOrigin } from "@/lib/oauthRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const returnTo = normalizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const bindDiscordAccount = req.nextUrl.searchParams.get("bindDiscord") === "1";
  const promptLogin = req.nextUrl.searchParams.get("switch") === "1";
  const callbackUrl = new URL(getRsoRedirectUri());

  if (oauthRequestOrigin(req) !== callbackUrl.origin) {
    const canonicalStartUrl = new URL("/api/riot/oauth/start", callbackUrl.origin);
    canonicalStartUrl.searchParams.set("returnTo", returnTo);
    if (bindDiscordAccount) canonicalStartUrl.searchParams.set("bindDiscord", "1");
    if (promptLogin) canonicalStartUrl.searchParams.set("switch", "1");
    return NextResponse.redirect(canonicalStartUrl);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const response = NextResponse.redirect(makeRsoOAuthUrl(state, { promptLogin }));

  if (promptLogin) clearRsoSessionCookie(response);
  setRsoOAuthStateCookie(
    response,
    { state, returnTo, bindDiscordAccount },
    callbackUrl.protocol === "https:"
  );
  return response;
}
