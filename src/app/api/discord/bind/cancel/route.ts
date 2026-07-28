import { NextRequest, NextResponse } from "next/server";
import { clearPendingDiscordBindCookie } from "@/lib/discordSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const target = new URL("/discord/linked-roles", req.url);
  target.searchParams.set("status", "cancelled");
  target.searchParams.set("message", "pending-bind-cleared");

  const response = NextResponse.redirect(target, 303);
  clearPendingDiscordBindCookie(response);
  return response;
}
