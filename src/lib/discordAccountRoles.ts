import {
  clearDiscordGuildRankRolesForUser,
  syncDiscordGuildRankRoleForStoredLink,
} from "@/lib/discordGuildRoles";
import { syncDiscordLinkedRoleForStoredLink } from "@/lib/discordLinkedRoles";
import {
  loadVerifiedDiscordAccount,
} from "@/lib/discordAccountStore";
import { updateDiscordRoleConnection } from "@/lib/discord";
import {
  ensurePrimaryDiscordLink,
  findOwnedVerifiedDiscordLink,
} from "@/lib/discordLinkStore";

export type DiscordAccountRoleSyncResult = {
  outcome: "success" | "partial" | "failed";
  linkedRoleAttempted: boolean;
  riotId: string;
};

export async function syncOwnedPrimaryDiscordRoles(
  discordUserId: string,
  linkId: unknown
): Promise<DiscordAccountRoleSyncResult> {
  const [link, primary] = await Promise.all([
    findOwnedVerifiedDiscordLink(discordUserId, linkId),
    ensurePrimaryDiscordLink(discordUserId),
  ]);
  if (!link?._id) throw new Error("linked-account-not-found");
  if (!primary?._id || String(primary._id) !== String(link._id)) {
    throw new Error("primary-account-required");
  }

  const linkedRoleAttempted =
    link.verificationSource === "discord_connections" ||
    link.verificationSource === "riot_rso";
  let failed = 0;

  if (linkedRoleAttempted) {
    try {
      await syncDiscordLinkedRoleForStoredLink(String(link._id), { force: true });
    } catch (error) {
      failed++;
      console.error("[discord/account] linked-role sync failed", error);
    }
  }

  try {
    await syncDiscordGuildRankRoleForStoredLink(String(link._id), { force: true });
  } catch (error) {
    failed++;
    console.error("[discord/account] guild-role sync failed", error);
  }

  const attempts = linkedRoleAttempted ? 2 : 1;
  return {
    outcome: failed === 0 ? "success" : failed === attempts ? "failed" : "partial",
    linkedRoleAttempted,
    riotId: `${link.gameName}#${link.tagLine}`,
  };
}

export async function clearDiscordRolesWithoutRiotAccount(
  discordUserId: string
): Promise<Pick<DiscordAccountRoleSyncResult, "outcome" | "linkedRoleAttempted">> {
  let failed = 0;

  try {
    const { accessToken } = await loadVerifiedDiscordAccount(discordUserId);
    await updateDiscordRoleConnection({
      accessToken,
      platformName: "Riftboard Myanmar",
      platformUsername: "No Riot account connected",
      metadata: {
        solo_ranked: 0,
        leaderboard_approved: 0,
        solo_tier_exact: 0,
        solo_tier_plus: 0,
        solo_rank_score: 0,
      },
    });
  } catch (error) {
    failed++;
    console.error("[discord/account] linked-role clear failed", error);
  }

  try {
    await clearDiscordGuildRankRolesForUser(discordUserId);
  } catch (error) {
    failed++;
    console.error("[discord/account] guild-role clear failed", error);
  }

  return {
    outcome: failed === 0 ? "success" : failed === 2 ? "failed" : "partial",
    linkedRoleAttempted: true,
  };
}
