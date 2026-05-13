import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminSessionFromRequest } from "@/lib/adminSession";
import { encryptDiscordSecret } from "@/lib/discord";
import { ensureDiscordLinkMultiAccountIndexes, setPrimaryDiscordLink } from "@/lib/discordLinkStore";
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

function normalizeDiscordIdentity(inputUserId: string, inputUsername?: string) {
  const rawUserId = String(inputUserId ?? "").trim();
  const snowflake = rawUserId.match(/\b\d{15,22}\b/)?.[0] ?? "";
  const usernameFromUserId = rawUserId
    .replace(snowflake, "")
    .replace(/[<@!>]/g, "")
    .trim();
  const username = String(inputUsername ?? "").trim() || usernameFromUserId || null;

  return { discordUserId: snowflake, discordUsername: username };
}

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
    const discord = normalizeDiscordIdentity(parsed.data.discordUserId, parsed.data.discordUsername);
    if (!discord.discordUserId) {
      return NextResponse.json(
        { ok: false, error: "Enter a Discord numeric user ID. You can paste '1255434368717951019 thanag36412'." },
        { status: 400 }
      );
    }

    await dbConnect();
    let refreshWarning: string | null = null;
    let player = await Player.findOne(buildPlayerLookupQuery(riot.gameName, riot.tagLine), {
      _id: 1,
      gameName: 1,
      tagLine: 1,
    }).lean();

    if (!player?._id) {
      try {
        await upsertAndRefreshByRiotId(
          { gameName: riot.gameName, tagLine: riot.tagLine },
          { force: true, syncMatches: false, fullMastery: false }
        );
      } catch (error) {
        refreshWarning = error instanceof Error ? error.message : "Could not refresh Riot player before binding.";
      }

      player = await Player.findOne(buildPlayerLookupQuery(riot.gameName, riot.tagLine), {
        _id: 1,
        gameName: 1,
        tagLine: 1,
      }).lean();
    }

    if (!player?._id) {
      return NextResponse.json(
        { ok: false, error: refreshWarning ? `Could not resolve Riot player: ${refreshWarning}` : "Could not resolve Riot player" },
        { status: 404 }
      );
    }

    const now = new Date();
    await ensureDiscordLinkMultiAccountIndexes();
    await DiscordLink.deleteMany({
      playerId: player._id,
      discordUserId: { $ne: discord.discordUserId },
    });
    const link = await DiscordLink.findOneAndUpdate(
      { discordUserId: discord.discordUserId, playerId: player._id },
      {
        $set: {
          discordUsername: discord.discordUsername,
          playerId: player._id,
          isPrimary: true,
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
          accessTokenEnc: encryptDiscordSecret(`admin-manual:${discord.discordUserId}:${now.getTime()}`),
          refreshTokenEnc: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await setPrimaryDiscordLink(discord.discordUserId, link._id);

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
        refreshWarning,
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
