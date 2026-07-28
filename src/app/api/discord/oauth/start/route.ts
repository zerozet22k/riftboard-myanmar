import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDiscordRedirectUri, makeDiscordOAuthUrl } from "@/lib/discord";
import { normalizeReturnTo, setDiscordOAuthStateCookie } from "@/lib/discordSession";
import { oauthRequestOrigin } from "@/lib/oauthRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const returnTo = normalizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const callbackUrl = new URL(getDiscordRedirectUri());

  // OAuth state is stored in a host-only cookie. If the page was opened on a
  // different host alias (for example localhost while Discord returns to
  // 127.0.0.1), start the flow on the callback host so the browser can return
  // the state cookie after Discord redirects back.
  if (oauthRequestOrigin(req) !== callbackUrl.origin) {
    const canonicalStartUrl = new URL("/api/discord/oauth/start", callbackUrl.origin);
    canonicalStartUrl.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(canonicalStartUrl);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const response = NextResponse.redirect(makeDiscordOAuthUrl(state));

  setDiscordOAuthStateCookie(response, { state, returnTo }, callbackUrl.protocol === "https:");
  return response;
}
