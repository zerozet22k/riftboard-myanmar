import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireDiscordSessionFromRequest } from "@/lib/discordSession";
import { DiscordLink } from "@/models/discordLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(req: NextRequest) {
  try {
    await requireDiscordSessionFromRequest(req);
    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json({ ok: true, items: [] });
    }

    await dbConnect();

    const rx = new RegExp(escapeRegex(q), "i");
    const links = await DiscordLink.find(
      {
        verifiedBinding: true,
        verificationSource: { $in: ["discord_connections", "legacy_manual"] },
        $or: [
          { discordUsername: rx },
          { gameName: rx },
          { tagLine: rx },
        ],
      },
      {
        discordUserId: 1,
        discordUsername: 1,
        playerId: 1,
        gameName: 1,
        tagLine: 1,
      }
    )
      .sort({ discordUsername: 1, gameName: 1, tagLine: 1 })
      .limit(10)
      .lean();

    return NextResponse.json({
      ok: true,
      items: links.map((link) => ({
        discordUserId: String(link.discordUserId),
        discordUsername: link.discordUsername ?? null,
        playerId: String(link.playerId),
        gameName: link.gameName,
        tagLine: link.tagLine,
        riotId: `${link.gameName}#${link.tagLine}`,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}
