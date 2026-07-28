import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDiscordRedirectUri, makeDiscordOAuthUrl } from "@/lib/discord";
import { normalizeReturnTo, setDiscordOAuthStateCookie } from "@/lib/discordSession";
import { oauthRequestOrigin } from "@/lib/oauthRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(response: NextResponse) {
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

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
    return noStore(NextResponse.redirect(canonicalStartUrl, 303));
  }

  const state = crypto.randomBytes(24).toString("hex");
  const response = NextResponse.redirect(makeDiscordOAuthUrl(state), 303);

  setDiscordOAuthStateCookie(response, { state, returnTo }, callbackUrl.protocol === "https:");
  return noStore(response);
}
