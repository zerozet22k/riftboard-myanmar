import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDiscordRedirectUri, makeDiscordOAuthUrl } from "@/lib/discord";
import { normalizeReturnTo, setDiscordOAuthStateCookie } from "@/lib/discordSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestOrigin(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))
    ?.split(",")[0]
    ?.trim();
  const protocol = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol)
    .split(",")[0]
    .trim()
    .replace(/:$/, "");

  if (!host || (protocol !== "http" && protocol !== "https")) {
    return req.nextUrl.origin;
  }

  return new URL(`${protocol}://${host}`).origin;
}

export async function GET(req: NextRequest) {
  const returnTo = normalizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const callbackUrl = new URL(getDiscordRedirectUri());

  // OAuth state is stored in a host-only cookie. If the page was opened on a
  // different host alias (for example localhost while Discord returns to
  // 127.0.0.1), start the flow on the callback host so the browser can return
  // the state cookie after Discord redirects back.
  if (requestOrigin(req) !== callbackUrl.origin) {
    const canonicalStartUrl = new URL("/api/discord/oauth/start", callbackUrl.origin);
    canonicalStartUrl.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(canonicalStartUrl);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const response = NextResponse.redirect(makeDiscordOAuthUrl(state));

  setDiscordOAuthStateCookie(response, { state, returnTo }, callbackUrl.protocol === "https:");
  return response;
}
