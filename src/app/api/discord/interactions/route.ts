import { after, NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getAppBaseUrl } from "@/lib/runtimeConfig";
import {
  editDiscordInteractionOriginalResponse,
  getDiscordGuildId,
  verifyDiscordInteraction,
} from "@/lib/discord";
import {
  isVerifiedDiscordLink,
  refreshStoredDiscordProfile,
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import {
  syncAllDiscordGuildRankRoles,
} from "@/lib/discordGuildRoles";
import { findPrimaryDiscordLink } from "@/lib/discordLinkStore";
import { Player } from "@/models/player";
import { canonicalPlayerPath } from "@/lib/playerIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DiscordInteraction = {
  application_id?: string;
  token?: string;
  type?: number;
  guild_id?: string;
  data?: {
    name?: string;
  };
  member?: {
    user?: { id?: string };
    permissions?: string;
    roles?: string[];
  };
  user?: {
    id?: string;
  };
};

const SYNC_SERVER_ROLES_ROLE_ID =
  process.env.DISCORD_SYNC_SERVER_ROLES_ROLE_ID?.trim() || "1490362401038663910";

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
  return [
    "**Link your Riot ID**",
    `Use this page to connect Discord with your Riot account: ${linkedRolesUrl}`,
    "After that, I can sync your rank roles here.",
  ].join("\n");
}

function helpText(linkedRolesUrl: string, canSyncServerRoles: boolean) {
  const lines = [
    "Commands:",
    `/bind - link Riot: ${linkedRolesUrl}`,
    "/status - linked account",
    "/myrank - solo rank",
    "/profile - profile link",
    "/refresh-profile - refresh rank roles",
    "/roles - role info",
  ];
  if (canSyncServerRoles) lines.push("/sync-server-roles - sync server roles");
  return lines.join("\n");
}

function rolesText(linkedRolesUrl: string) {
  return [
    "**Rank roles**",
    "Solo, TFT, and Flex roles sync from verified Riot data.",
    "Use /refresh-profile after your rank changes.",
    `Not linked yet? ${linkedRolesUrl}`,
  ].join("\n");
}

function publicBindMessage(linkedRolesUrl: string) {
  return [
    "**Welcome to Riftboard Myanmar.**",
    `Link your Riot ID here: ${linkedRolesUrl}`,
    "After linking, your bind role is removed and your rank roles can sync.",
  ].join("\n");
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

function publicMessageResponse(content: string) {
  return NextResponse.json({
    type: 4,
    data: {
      content,
    },
  });
}

function deferredMessageResponse() {
  return NextResponse.json({
    type: 5,
    data: {
      flags: 64,
    },
  });
}

function requireDeferredIdentifiers(interaction: DiscordInteraction) {
  const interactionToken = String(interaction.token ?? "").trim();
  const applicationId = String(interaction.application_id ?? "").trim();
  if (!interactionToken || !applicationId) {
    throw new Error("Discord did not provide an interaction token for the deferred response.");
  }
  return { interactionToken, applicationId };
}

function scheduleDeferredReply(
  interaction: DiscordInteraction,
  task: () => Promise<string>
) {
  const { interactionToken, applicationId } = requireDeferredIdentifiers(interaction);

  after(async () => {
    try {
      const content = await task();
      await editDiscordInteractionOriginalResponse({
        applicationId,
        interactionToken,
        content,
      });
    } catch (error) {
      const content =
        error instanceof Error ? error.message : "Discord command failed unexpectedly.";
      console.error("[discord/interactions] deferred command failed", error);
      try {
        await editDiscordInteractionOriginalResponse({
          applicationId,
          interactionToken,
          content,
        });
      } catch (editError) {
        console.error("[discord/interactions] deferred response edit failed", editError);
      }
    }
  });

  return deferredMessageResponse();
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

function hasDiscordRole(interaction: DiscordInteraction, roleId: string) {
  const wantedRoleId = String(roleId ?? "").trim();
  if (!wantedRoleId) return false;
  return (interaction.member?.roles ?? []).some(
    (memberRoleId) => String(memberRoleId).trim() === wantedRoleId
  );
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

  const canSyncServerRoles = hasDiscordRole(interaction, SYNC_SERVER_ROLES_ROLE_ID);

  if (commandName === "help") {
    return messageResponse(helpText(linkedRolesUrl, canSyncServerRoles));
  }

  if (commandName === "roles") {
    return messageResponse(rolesText(linkedRolesUrl));
  }

  if (allowedGuildId && interaction.guild_id !== allowedGuildId) {
    return messageResponse("Use these commands inside the configured Discord server after joining it.");
  }

  if (commandName === "sync-server-roles") {
    if (!canSyncServerRoles) {
      return messageResponse("You need the server role-sync staff role to use this.");
    }

    return scheduleDeferredReply(interaction, async () => {
      const summary = await syncAllDiscordGuildRankRoles();
      const createdRoles =
        summary.createdRoleNames.length
          ? `Created: ${summary.createdRoleNames.join(", ")}`
          : "";
      const errors =
        summary.errors.length
          ? `Errors: ${summary.errors.slice(0, 3).join(" | ")}${summary.errors.length > 3 ? " | ..." : ""}`
          : "";

      return [
        "**Server role sync complete**",
        `Scanned: ${summary.scanned}`,
        `Synced: ${summary.synced}`,
        `Bind role added: ${summary.bindRoleAdded}`,
        `Bind role removed: ${summary.bindRoleRemoved}`,
        `Riftboarded added: ${summary.verifiedRoleAdded}`,
        `Riftboarded removed: ${summary.verifiedRoleRemoved}`,
        `Rank roles removed: ${summary.cleanedRoles}`,
        `Not in server: ${summary.missingMembers} linked Discord users`,
        `Missing Riftboard profiles: ${summary.missingPlayers}`,
        `DMs: ${summary.messagedUnboundMembers} sent, ${summary.unboundMessageFailures} failed`,
        `Unranked: ${summary.unranked}`,
        createdRoles,
        errors,
      ].filter(Boolean).join("\n");
    });
  }

  if (commandName === "setup-bind-message") {
    if (!hasAdministratorPermission(interaction)) {
      return messageResponse("This command is only available to server administrators.");
    }

    return publicMessageResponse(publicBindMessage(linkedRolesUrl));
  }

  if (!userId) {
    return messageResponse("Could not determine the Discord user for this command.");
  }

  await dbConnect();
  const link = await findPrimaryDiscordLink(userId);

  if (!link?._id) {
    return messageResponse(
      `**You're not linked yet.**\nBind your Riot ID here: ${linkedRolesUrl}\nOnce linked, run /refresh-profile.`
    );
  }
  if (!isVerifiedDiscordLink(link)) {
    return messageResponse(
      `**Please relink your Riot ID.**\nBind here: ${linkedRolesUrl}\nOnce linked, run /refresh-profile.`
    );
  }

  if (commandName === "status") {
    const syncedText = link.lastSyncedAt
      ? formatSyncTime(link.lastSyncedAt)
      : "not synced";
    return messageResponse(
      `Bound: ${formatRiotId(link)}\nSynced: ${syncedText}\nProfile: ${formatProfileUrl(link)}`
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
    return scheduleDeferredReply(interaction, async () => {
      const refreshed = await refreshStoredDiscordProfile(userId, {
        force: true,
        syncMatches: false,
        fullMastery: false,
        syncLinkedRole: true,
      });
      const syncSuffix = refreshed.linkedRoleError
        ? ` Linked role error: ${refreshed.linkedRoleError}`
        : refreshed.linkedRoleSkipped
          ? " Linked role unchanged."
        : " Linked role synced.";
      const guildRoleSuffix = refreshed.guildRoleError
        ? ` Server role error: ${refreshed.guildRoleError}`
        : refreshed.guildRoleSkipped
          ? " Server roles unchanged."
        : " Server roles synced.";

      return `Updated. ${formatSoloRank(refreshed.player)} Profile: ${getAppBaseUrl()}${refreshed.canonicalPath}${syncSuffix}${guildRoleSuffix}`;
    });
  }

  if (commandName === "refresh-linked-role") {
    return scheduleDeferredReply(interaction, async () => {
      const synced = await syncDiscordLinkedRoleForStoredLink(String(link._id));
      return `Linked role refreshed: ${synced.player.gameName}#${synced.player.tagLine}.`;
    });
  }

  return messageResponse(
    "Unknown command. Try /help, /bind, /status, /profile, /myrank, /roles, /refresh-profile, /refresh-linked-role, or /sync-server-roles."
  );
}
