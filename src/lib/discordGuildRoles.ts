import { dbConnect } from "@/lib/mongodb";
import {
  addDiscordGuildMemberRole,
  createDiscordGuildRole,
  getDiscordGuildId,
  getDiscordGuildMember,
  listDiscordGuildRoles,
  removeDiscordGuildMemberRole,
  type DiscordGuildRole,
} from "@/lib/discord";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";

type GuildRolePlayerProjection = {
  _id: unknown;
  gameName: string;
  tagLine: string;
  solo?: {
    tier?: string | null;
  } | null;
};

type ManagedRoleSpec = {
  tier: string;
  color: number;
};

type ManagedRoleContext = {
  guildId: string;
  rolesByName: Map<string, DiscordGuildRole>;
  managedRoles: DiscordGuildRole[];
  createdRoleNames: string[];
};

type SyncDiscordGuildRankRoleOptions = {
  force?: boolean;
};

const MANAGED_RANK_ROLE_SPECS: ManagedRoleSpec[] = [
  { tier: "CHALLENGER", color: 0xf0c74b },
  { tier: "GRANDMASTER", color: 0xd14b5a },
  { tier: "MASTER", color: 0xa970ff },
  { tier: "DIAMOND", color: 0x4ba3ff },
  { tier: "EMERALD", color: 0x2ecc71 },
  { tier: "PLATINUM", color: 0x25b7b7 },
  { tier: "GOLD", color: 0xd4af37 },
  { tier: "SILVER", color: 0xaeb6bf },
  { tier: "BRONZE", color: 0xa97142 },
  { tier: "IRON", color: 0x5d6d7e },
];

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function rankRolePrefix() {
  return String(process.env.DISCORD_RANK_ROLE_PREFIX ?? "Rank").trim();
}

function managedRoleName(tier: string) {
  const prettyTier = toTitleCase(tier);
  const prefix = rankRolePrefix();
  return prefix ? `${prefix}: ${prettyTier}` : prettyTier;
}

function managedRoleNames() {
  return MANAGED_RANK_ROLE_SPECS.map((spec) => managedRoleName(spec.tier));
}

function normalizeManagedTier(tier?: string | null) {
  const key = String(tier ?? "").trim().toUpperCase();
  return MANAGED_RANK_ROLE_SPECS.some((spec) => spec.tier === key) ? key : null;
}

function isUnknownMemberError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Unknown Member/i.test(message) || /Discord API 404/i.test(message);
}

async function ensureManagedRoleContext(existingRoles?: DiscordGuildRole[]) {
  const guildId = String(getDiscordGuildId() ?? "").trim();
  if (!guildId) throw new Error("Missing env: DISCORD_GUILD_ID");

  const createdRoleNames: string[] = [];
  const roles = [...(existingRoles ?? (await listDiscordGuildRoles(guildId)))];
  const byName = new Map(roles.map((role) => [String(role.name ?? "").trim(), role]));

  for (const spec of MANAGED_RANK_ROLE_SPECS) {
    const name = managedRoleName(spec.tier);
    if (byName.has(name)) continue;

    const created = await createDiscordGuildRole({
      guildId,
      name,
      color: spec.color,
      reason: "Create managed Riftboard rank role",
    });
    roles.push(created);
    byName.set(name, created);
    createdRoleNames.push(name);
  }

  return {
    guildId,
    rolesByName: byName,
    managedRoles: managedRoleNames()
      .map((name) => byName.get(name))
      .filter((role): role is DiscordGuildRole => !!role?.id),
    createdRoleNames,
  } satisfies ManagedRoleContext;
}

export async function syncDiscordGuildRankRoleForIdentity(input: {
  discordUserId: string;
  player: GuildRolePlayerProjection;
  context?: ManagedRoleContext;
}) {
  const context = input.context ?? (await ensureManagedRoleContext());
  const member = await getDiscordGuildMember({
    guildId: context.guildId,
    userId: input.discordUserId,
  });
  const existingRoleIds = new Set(
    Array.isArray(member.roles) ? member.roles.map((roleId) => String(roleId)) : []
  );

  const wantedTier = normalizeManagedTier(input.player.solo?.tier ?? null);
  const wantedRole = wantedTier ? context.rolesByName.get(managedRoleName(wantedTier)) ?? null : null;

  let addedRoleName: string | null = null;
  let removedRoles = 0;

  for (const role of context.managedRoles) {
    const shouldHave = !!wantedRole && role.id === wantedRole.id;
    const hasRole = existingRoleIds.has(role.id);

    if (shouldHave && !hasRole) {
      await addDiscordGuildMemberRole({
        guildId: context.guildId,
        userId: input.discordUserId,
        roleId: role.id,
        reason: `Sync Riftboard rank role for ${input.player.gameName}#${input.player.tagLine}`,
      });
      addedRoleName = role.name;
      existingRoleIds.add(role.id);
      continue;
    }

    if (!shouldHave && hasRole) {
      await removeDiscordGuildMemberRole({
        guildId: context.guildId,
        userId: input.discordUserId,
        roleId: role.id,
        reason: `Remove stale Riftboard rank role for ${input.player.gameName}#${input.player.tagLine}`,
      });
      removedRoles++;
      existingRoleIds.delete(role.id);
    }
  }

  return {
    createdRoleNames: context.createdRoleNames,
    assignedRoleName: wantedRole?.name ?? null,
    addedRoleName,
    removedRoles,
  };
}

export async function syncDiscordGuildRankRoleForStoredLink(
  linkId: string,
  opts?: SyncDiscordGuildRankRoleOptions
) {
  await dbConnect();

  const link = await DiscordLink.findById(linkId);
  if (!link?._id) throw new Error("Discord link not found.");
  if (!link.verifiedBinding || link.verificationSource !== "discord_connections") {
    throw new Error("Reconnect Discord before syncing server rank roles.");
  }

  const player = await Player.findById(link.playerId, {
    gameName: 1,
    tagLine: 1,
    solo: 1,
  }).lean<GuildRolePlayerProjection | null>();
  if (!player?._id) throw new Error("Linked Riftboard profile not found.");

  const wantedTier = normalizeManagedTier(player.solo?.tier ?? null);
  if (
    !opts?.force &&
    link.gameName === player.gameName &&
    link.tagLine === player.tagLine &&
    String(link.guildRankRoleTier ?? "") === String(wantedTier ?? "")
  ) {
    return {
      createdRoleNames: [],
      assignedRoleName: link.guildRankRoleName ?? null,
      addedRoleName: null,
      removedRoles: 0,
      skipped: true,
    };
  }

  const result = await syncDiscordGuildRankRoleForIdentity({
    discordUserId: String(link.discordUserId),
    player,
  });

  link.gameName = player.gameName;
  link.tagLine = player.tagLine;
  link.guildRankRoleTier = wantedTier;
  link.guildRankRoleName = result.assignedRoleName;
  link.guildRankRolesSyncedAt = new Date();
  await link.save();

  return { ...result, skipped: false };
}

export async function syncAllDiscordGuildRankRoles() {
  await dbConnect();

  const links = await DiscordLink.find(
    {
      verifiedBinding: true,
      verificationSource: "discord_connections",
    },
    {
      discordUserId: 1,
      playerId: 1,
    }
  ).lean();

  const playerIds = Array.from(
    new Set(
      links
        .map((link) => String(link.playerId ?? "").trim())
        .filter(Boolean)
    )
  );

  const players = await Player.find(
    { _id: { $in: playerIds } },
    { gameName: 1, tagLine: 1, solo: 1 }
  ).lean<GuildRolePlayerProjection[]>();
  const playersById = new Map(players.map((player) => [String(player._id), player]));

  const context = await ensureManagedRoleContext();
  let synced = 0;
  let missingPlayers = 0;
  let missingMembers = 0;
  let unranked = 0;
  const errors: string[] = [];

  for (const link of links) {
    const player = playersById.get(String(link.playerId ?? ""));
    if (!player?._id) {
      missingPlayers++;
      continue;
    }

    try {
      const result = await syncDiscordGuildRankRoleForIdentity({
        discordUserId: String(link.discordUserId),
        player,
        context,
      });
      synced++;
      if (!result.assignedRoleName) unranked++;
    } catch (error) {
      if (isUnknownMemberError(error)) {
        missingMembers++;
        continue;
      }
      errors.push(
        `${String(link.discordUserId)} (${player.gameName}#${player.tagLine}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    scanned: links.length,
    synced,
    missingPlayers,
    missingMembers,
    unranked,
    createdRoleNames: context.createdRoleNames,
    errors,
  };
}
