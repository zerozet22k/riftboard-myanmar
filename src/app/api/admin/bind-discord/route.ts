import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminSessionFromRequest } from "@/lib/adminSession";
import { encryptDiscordSecret } from "@/lib/discord";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { upsertAndRefreshByRiotId } from "@/lib/refresh";
import { parseRiotId } from "@/lib/tournaments";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BindSchema = z.object({
  discordUserId: z.string().trim().min(5),
  discordUsername: z.string().trim().optional(),
  riotId: z.string().trim().min(3),
  syncRoles: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    if (!hasAdminSessionFromRequest(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = BindSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }

    const riot = parseRiotId(parsed.data.riotId);
    if (!riot) {
      return NextResponse.json({ ok: false, error: "Enter Riot ID as GameName#TagLine" }, { status: 400 });
    }

    await dbConnect();
    await upsertAndRefreshByRiotId(
      { gameName: riot.gameName, tagLine: riot.tagLine },
      { force: true, syncMatches: false, fullMastery: false }
    );

    const player = await Player.findOne(buildPlayerLookupQuery(riot.gameName, riot.tagLine), {
      _id: 1,
      gameName: 1,
      tagLine: 1,
    }).lean();
    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Could not resolve Riot player" }, { status: 404 });
    }

    const now = new Date();
    const link = await DiscordLink.findOneAndUpdate(
      { discordUserId: parsed.data.discordUserId },
      {
        $set: {
          discordUsername: parsed.data.discordUsername || null,
          playerId: player._id,
          gameName: player.gameName,
          tagLine: player.tagLine,
          tokenType: "Manual",
          scopes: [],
          expiresAt: null,
          verifiedBinding: true,
          verificationSource: "legacy_manual",
          lastVerifiedAt: now,
          proofConnectionType: "admin_manual",
          proofConnectionLabel: `${player.gameName}#${player.tagLine}`,
        },
        $setOnInsert: {
          accessTokenEnc: encryptDiscordSecret(`admin-manual:${parsed.data.discordUserId}:${now.getTime()}`),
          refreshTokenEnc: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    let roleSyncError: string | null = null;
    if (parsed.data.syncRoles !== false) {
      try {
        await syncDiscordGuildRankRoleForStoredLink(String(link._id), { force: true });
      } catch (error) {
        roleSyncError = error instanceof Error ? error.message : "Role sync failed";
      }
    }

    return NextResponse.json({
      ok: true,
      link: {
        discordUserId: link.discordUserId,
        discordUsername: link.discordUsername ?? null,
        gameName: player.gameName,
        tagLine: player.tagLine,
        roleSyncError,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bind failed" },
      { status: 500 }
    );
  }
}
