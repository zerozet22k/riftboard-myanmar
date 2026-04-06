import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getAppBaseUrl } from "@/lib/runtimeConfig";
import { getDiscordGuildId, verifyDiscordInteraction } from "@/lib/discord";
import {
  isVerifiedDiscordLink,
  refreshStoredDiscordProfile,
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import {
  syncAllDiscordGuildRankRoles,
} from "@/lib/discordGuildRoles";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";
import { canonicalPlayerPath } from "@/lib/playerIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DiscordInteraction = {
  type?: number;
  guild_id?: string;
  data?: {
    name?: string;
  };
  member?: {
    user?: { id?: string };
    permissions?: string;
  };
  user?: {
    id?: string;
  };
};

function interactionUserId(interaction: DiscordInteraction) {
  return String(interaction.member?.user?.id ?? interaction.user?.id ?? "").trim();
}

function formatRiotId(player: { gameName: string; tagLine: string }) {
  return `${player.gameName}#${player.tagLine}`;
}

function formatSoloRank(player: {
  gameName: string;
  tagLine: string;
  solo?: { tier?: string | null; division?: string | null; lp?: number | null } | null;
}) {
  const solo = player.solo ?? null;
  if (!solo?.tier) return `${player.gameName}#${player.tagLine} is currently unranked in solo queue.`;

  const division = solo.division ? ` ${String(solo.division).toUpperCase()}` : "";
  const lp = solo.lp != null ? ` - ${solo.lp} LP` : "";
  return `${player.gameName}#${player.tagLine}: ${String(solo.tier).toUpperCase()}${division}${lp}`;
}

function formatProfileUrl(player: { gameName: string; tagLine: string }) {
  return `${getAppBaseUrl()}${canonicalPlayerPath(player.gameName, player.tagLine)}`;
}

function formatSyncTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "not yet synced";
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function linkInstructions(linkedRolesUrl: string) {
  return `Join the configured Discord server first, then finish your bind here: ${linkedRolesUrl}. Joining alone does not complete the Riot account verification.`;
}

function messageResponse(content: string) {
  return NextResponse.json({
    type: 4,
    data: {
      flags: 64,
      content,
    },
  });
}

function hasAdministratorPermission(interaction: DiscordInteraction) {
  const raw = String(interaction.member?.permissions ?? "").trim();
  if (!raw) return false;

  try {
    const administratorBit = BigInt("8");
    return (BigInt(raw) & administratorBit) === administratorBit;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  const body = await req.text();

  if (!signature || !timestamp || !verifyDiscordInteraction({ timestamp, body, signatureHex: signature })) {
    return new NextResponse("Invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(body) as DiscordInteraction;

  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  if (interaction.type !== 2) {
    return messageResponse("Unsupported interaction type.");
  }

  const allowedGuildId = getDiscordGuildId();
  const commandName = String(interaction.data?.name ?? "").trim().toLowerCase();
  const userId = interactionUserId(interaction);
  const linkedRolesUrl = `${getAppBaseUrl()}/discord/linked-roles`;

  if (commandName === "link" || commandName === "bind") {
    return messageResponse(linkInstructions(linkedRolesUrl));
  }

  if (allowedGuildId && interaction.guild_id !== allowedGuildId) {
    return messageResponse("Use these commands inside the configured Discord server after joining it.");
  }

  if (commandName === "sync-server-roles") {
    if (!hasAdministratorPermission(interaction)) {
      return messageResponse("This command is only available to server administrators.");
    }

    try {
      const summary = await syncAllDiscordGuildRankRoles();
      const createdRoles =
        summary.createdRoleNames.length
          ? ` Created roles: ${summary.createdRoleNames.join(", ")}.`
          : "";
      const errors =
        summary.errors.length
          ? ` Errors: ${summary.errors.slice(0, 3).join(" | ")}${summary.errors.length > 3 ? " | ..." : ""}`
          : "";

      return messageResponse(
        `Server role sync finished. Scanned ${summary.scanned}, synced ${summary.synced}, unranked ${summary.unranked}, missing members ${summary.missingMembers}, missing players ${summary.missingPlayers}.${createdRoles}${errors}`
      );
    } catch (error) {
      return messageResponse(
        error instanceof Error ? error.message : "Could not sync server rank roles."
      );
    }
  }

  if (!userId) {
    return messageResponse("Could not determine the Discord user for this command.");
  }

  await dbConnect();
  const link = await DiscordLink.findOne({ discordUserId: userId }).lean();

  if (!link?._id) {
    return messageResponse(`No linked Riftboard profile found yet. Use ${linkedRolesUrl} first.`);
  }
  if (!isVerifiedDiscordLink(link)) {
    return messageResponse(`Reconnect your Discord account at ${linkedRolesUrl} to verify your Riot binding again.`);
  }

  if (commandName === "status") {
    const syncedText = link.lastSyncedAt
      ? `Last linked-role sync: ${formatSyncTime(link.lastSyncedAt)}.`
      : "Linked-role metadata has not been synced yet.";
    return messageResponse(
      `Bound Riot ID: ${formatRiotId(link)}. ${syncedText} Profile: ${formatProfileUrl(link)}`
    );
  }

  if (commandName === "profile") {
    return messageResponse(`Profile for ${formatRiotId(link)}: ${formatProfileUrl(link)}`);
  }

  if (commandName === "myrank") {
    const player = await Player.findById(link.playerId, {
      gameName: 1,
      tagLine: 1,
      solo: 1,
    }).lean();

    if (!player?._id) {
      return messageResponse("Your linked Riftboard profile could not be found.");
    }

    return messageResponse(`${formatSoloRank(player)} Profile: ${formatProfileUrl(player)}`);
  }

  if (commandName === "refresh-profile") {
    try {
      const refreshed = await refreshStoredDiscordProfile(userId, {
        force: true,
        syncMatches: false,
        fullMastery: false,
        syncLinkedRole: true,
      });
      const syncSuffix = refreshed.linkedRoleError
        ? ` Linked-role sync still needs a retry: ${refreshed.linkedRoleError}`
        : " Linked-role metadata synced.";
      const guildRoleSuffix = refreshed.guildRoleError
        ? ` Server rank role sync still needs a retry: ${refreshed.guildRoleError}`
        : " Server rank roles synced.";

      return messageResponse(
        `Updated ${formatSoloRank(refreshed.player)} Profile: ${getAppBaseUrl()}${refreshed.canonicalPath}${syncSuffix}${guildRoleSuffix}`
      );
    } catch (error) {
      return messageResponse(
        error instanceof Error ? error.message : "Could not refresh your linked Riftboard profile."
      );
    }
  }

  if (commandName === "refresh-linked-role") {
    try {
      const synced = await syncDiscordLinkedRoleForStoredLink(String(link._id));
      return messageResponse(
        `Linked role metadata refreshed for ${synced.player.gameName}#${synced.player.tagLine}.`
      );
    } catch (error) {
      return messageResponse(
        error instanceof Error ? error.message : "Could not refresh linked role metadata."
      );
    }
  }

  return messageResponse(
    "Unknown command. Try /bind, /status, /profile, /myrank, /refresh-profile, /refresh-linked-role, or /sync-server-roles."
  );
}
