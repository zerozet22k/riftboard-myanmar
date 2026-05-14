import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { refreshPlayerById } from "@/lib/refresh";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import { DiscordLink } from "@/models/discordLink";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import { syncDiscordLinkedRoleForStoredLink } from "@/lib/discordLinkedRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

function toBool(v: unknown) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function toInt(v: unknown, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Error";
  if (/Exception decrypting|Bad Request/i.test(message)) {
    return "Riot could not return match history for this account yet. No recent matches were saved.";
  }
  if (/403|Forbidden/i.test(message)) return "Riot rejected the API key. Update RIOT_API_KEY.";
  if (/404|not found/i.test(message)) return "No player or match history was found for this Riot ID.";
  return message;
}

async function syncDiscordRolesForPlayer(playerId: string) {
  const links = await DiscordLink.find(
    {
      playerId,
      verifiedBinding: true,
      verificationSource: { $in: ["discord_connections", "riot_rso"] },
    },
    { _id: 1 }
  ).lean();

  let linkedRoleSkipped = 0;
  let guildRoleSkipped = 0;
  const errors: string[] = [];

  for (const link of links) {
    const linkId = String(link._id);

    try {
      const synced = await syncDiscordLinkedRoleForStoredLink(linkId);
      if (synced.skipped) linkedRoleSkipped++;
    } catch (error) {
      errors.push(errorMessage(error));
    }

    try {
      const synced = await syncDiscordGuildRankRoleForStoredLink(linkId, { force: true });
      if (synced.skipped) guildRoleSkipped++;
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  return {
    scanned: links.length,
    linkedRoleSkipped,
    guildRoleSkipped,
    errors,
  };
}

export async function POST(
  req: NextRequest,
  ctx: {
    params:
      | { gameName: string; tagLine: string }
      | Promise<{ gameName: string; tagLine: string }>;
  }
) {
  try {
    const params = await ctx.params;

    const gameNameRaw = safeDecode(params?.gameName);
    const tagLineRaw = safeDecode(params?.tagLine);

    const gameNameNorm = String(gameNameRaw ?? "").trim().toLowerCase();
    const tagLineNorm = String(tagLineRaw ?? "").trim().toLowerCase();

    if (!gameNameNorm || !tagLineNorm) {
      return NextResponse.json({ ok: false, error: "Missing name/tag" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));

    const syncMatches = toBool(body?.syncMatches);
    const fullMastery = toBool(body?.fullMastery);

    // keep it sane
    const matchesCount = Math.max(1, Math.min(100, toInt(body?.matchesCount, 10)));

    // optional override for cooldown if you want it
    const force = toBool(body?.force);

    await dbConnect();

    const player = await Player.findOne(
      buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
      { _id: 1, gameName: 1, tagLine: 1 }
    ).lean();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const out = await refreshPlayerById(String(player._id), {
      force,
      syncMatches,
      matchesCount,
      fullMastery, 
    });
    const discordRoleSync = out?._skipped
      ? { scanned: 0, linkedRoleSkipped: 0, guildRoleSkipped: 0, errors: [] }
      : await syncDiscordRolesForPlayer(String(out?._id ?? player._id));

    const canonicalPath = canonicalPlayerPath(out?.gameName ?? player.gameName, out?.tagLine ?? player.tagLine);
    const originalPath = canonicalPlayerPath(player.gameName, player.tagLine);

    revalidatePath(canonicalPath);
    if (originalPath !== canonicalPath) revalidatePath(originalPath);
    revalidatePath("/leaderboard");
    revalidatePath("/tft");
    revalidatePath("/");

    return NextResponse.json({ ok: true, player: out, discordRoleSync });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
