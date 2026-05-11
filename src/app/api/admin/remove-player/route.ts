import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminSessionFromRequest, isValidAdminCode } from "@/lib/adminSession";
import { dbConnect } from "@/lib/mongodb";
import { canonicalPlayerPath, normalizeRiotIdPart } from "@/lib/playerIdentity";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";
import { PlayerMastery } from "@/models/playerMastery";
import { PlayerMatch } from "@/models/playerMatch";
import { ProfileComment } from "@/models/profileComment";
import { RankEntry } from "@/models/rankEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RemovePlayerSchema = z.object({
  secret: z.string().trim().min(1).optional(),
  gameName: z.string().trim().min(1),
  tagLine: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = RemovePlayerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }

    const isAuthorized =
      hasAdminSessionFromRequest(req) || isValidAdminCode(parsed.data.secret ?? null);
    if (!isAuthorized) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const gameNameNorm = normalizeRiotIdPart(parsed.data.gameName);
    const tagLineNorm = normalizeRiotIdPart(parsed.data.tagLine);

    await dbConnect();

    const player = await Player.findOne({
      gameNameNorm,
      tagLineNorm,
    }).lean<{ _id?: unknown; gameName?: string; tagLine?: string } | null>();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = player._id;
    const canonicalPath = canonicalPlayerPath(player.gameName ?? parsed.data.gameName, player.tagLine ?? parsed.data.tagLine);

    const [playerDelete, matchDelete, rankDelete, masteryDelete, commentDelete, discordDelete] = await Promise.all([
      Player.deleteOne({ _id: playerId }),
      PlayerMatch.deleteMany({ playerId }),
      RankEntry.deleteMany({ playerId }),
      PlayerMastery.deleteMany({ playerId }),
      ProfileComment.deleteMany({ profilePlayerId: playerId }),
      DiscordLink.deleteMany({ playerId }),
    ]);

    revalidatePath("/");
    revalidatePath("/leaderboard");
    revalidatePath("/tft");
    revalidatePath(canonicalPath);

    return NextResponse.json({
      ok: true,
      gameName: player.gameName ?? parsed.data.gameName,
      tagLine: player.tagLine ?? parsed.data.tagLine,
      canonicalPath,
      deleted: {
        player: playerDelete.deletedCount ?? 0,
        matches: matchDelete.deletedCount ?? 0,
        rankEntries: rankDelete.deletedCount ?? 0,
        masteryRows: masteryDelete.deletedCount ?? 0,
        profileComments: commentDelete.deletedCount ?? 0,
        discordLinks: discordDelete.deletedCount ?? 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
