import { NextRequest, NextResponse } from "next/server";
import { clearDiscordSessionCookie } from "@/lib/discordSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const target = new URL("/discord/linked-roles", req.url);
  target.searchParams.set("status", "signed-out");
  target.searchParams.set("message", "discord-session-cleared");

  const response = NextResponse.redirect(target, 303);
  clearDiscordSessionCookie(response);
  return response;
}
