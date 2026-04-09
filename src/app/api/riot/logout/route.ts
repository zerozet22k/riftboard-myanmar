import { NextRequest, NextResponse } from "next/server";
import { clearRsoSessionCookie, normalizeReturnTo } from "@/lib/riotAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const returnTo = normalizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const target = new URL(returnTo, req.url);
  const response = NextResponse.redirect(target);
  clearRsoSessionCookie(response);
  return response;
}
