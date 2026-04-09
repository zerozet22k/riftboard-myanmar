import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  makeRsoOAuthUrl,
  normalizeReturnTo,
  setRsoOAuthStateCookie,
} from "@/lib/riotAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const state = crypto.randomBytes(24).toString("hex");
  const returnTo = normalizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const response = NextResponse.redirect(makeRsoOAuthUrl(state));

  setRsoOAuthStateCookie(response, { state, returnTo }, req.nextUrl.protocol === "https:");
  return response;
}
