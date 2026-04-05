import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getAppBaseUrl } from "@/lib/runtimeConfig";
import { getDiscordGuildId, verifyDiscordInteraction } from "@/lib/discord";
import { isVerifiedDiscordLink, syncDiscordLinkedRoleForStoredLink } from "@/lib/discordLinkedRoles";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";

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
  };
  user?: {
    id?: string;
  };
};

function interactionUserId(interaction: DiscordInteraction) {
  return String(interaction.member?.user?.id ?? interaction.user?.id ?? "").trim();
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

function messageResponse(content: string) {
  return NextResponse.json({
    type: 4,
    data: {
      flags: 64,
      content,
    },
  });
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
  if (allowedGuildId && interaction.guild_id && interaction.guild_id !== allowedGuildId) {
    return messageResponse("This bot is only configured for the Riftboard Myanmar server.");
  }

  const commandName = String(interaction.data?.name ?? "").trim().toLowerCase();
  const userId = interactionUserId(interaction);
  const linkedRolesUrl = `${getAppBaseUrl()}/discord/linked-roles`;

  if (commandName === "link") {
    return messageResponse(`Link your Riftboard profile here: ${linkedRolesUrl}`);
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

  if (commandName === "myrank") {
    const player = await Player.findById(link.playerId, {
      gameName: 1,
      tagLine: 1,
      solo: 1,
    }).lean();

    if (!player?._id) {
      return messageResponse("Your linked Riftboard profile could not be found.");
    }

    return messageResponse(formatSoloRank(player));
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

  return messageResponse("Unknown command.");
}
