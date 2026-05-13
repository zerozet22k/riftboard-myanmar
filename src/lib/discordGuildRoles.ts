import { dbConnect } from "@/lib/mongodb";
import {
  addDiscordGuildMemberRole,
  createDiscordGuildRole,
  getDiscordGuildId,
  getDiscordGuildMember,
  listDiscordGuildMembers,
  listDiscordGuildRoles,
  removeDiscordGuildMemberRole,
  createDiscordDmChannel,
  sendDiscordChannelMessage,
  type DiscordGuildRole,
  type DiscordGuildMember,
} from "@/lib/discord";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";
import { getAppBaseUrl, isCommunityCodeRequired } from "@/lib/runtimeConfig";

type GuildRolePlayerProjection = {
  _id: unknown;
  gameName: string;
  tagLine: string;
  solo?: {
    tier?: string | null;
  } | null;
  tft?: {
    tier?: string | null;
  } | null;
  flex?: {
    tier?: string | null;
  } | null;
};

type ManagedRoleSpec = {
  tier: string;
  color: number;
};

type ManagedRankQueueKey = "solo" | "tft" | "flex";

type ManagedRankQueue = {
  key: ManagedRankQueueKey;
  label: string;
  roleLabel: string | null;
};

type ManagedRoleContext = {
  guildId: string;
  rolesByName: Map<string, DiscordGuildRole>;
  managedRolesByQueue: Map<ManagedRankQueueKey, DiscordGuildRole[]>;
  bindRole: DiscordGuildRole;
  verifiedRole: DiscordGuildRole;
  createdRoleNames: string[];
};

type SyncDiscordGuildRankRoleOptions = {
  force?: boolean;
};

function canSyncGuildRankRoles(link: { verifiedBinding?: boolean | null; verificationSource?: string | null }) {
  return (
    link.verifiedBinding === true &&
    (link.verificationSource === "discord_connections" || link.verificationSource === "legacy_manual")
  );
}

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

const MANAGED_RANK_QUEUES: ManagedRankQueue[] = [
  { key: "solo", label: "Solo Queue", roleLabel: null },
  { key: "tft", label: "TFT", roleLabel: "TFT" },
  { key: "flex", label: "Ranked Flex", roleLabel: "Flex" },
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

function bindRoleName() {
  return String(process.env.DISCORD_BIND_ROLE_NAME ?? "").trim() || "Riftboard: Bind Riot";
}

function bindRoleColor() {
  const raw = String(process.env.DISCORD_BIND_ROLE_COLOR ?? "5865F2").trim().replace(/^#/, "");
  const parsed = Number.parseInt(raw, 16);
  return Number.isFinite(parsed) ? parsed : 0x5865f2;
}

function verifiedRoleName() {
  return String(process.env.DISCORD_VERIFIED_ROLE_NAME ?? "").trim() || "Riftboarded";
}

function verifiedRoleColor() {
  const raw = String(process.env.DISCORD_VERIFIED_ROLE_COLOR ?? "2ECC71").trim().replace(/^#/, "");
  const parsed = Number.parseInt(raw, 16);
  return Number.isFinite(parsed) ? parsed : 0x2ecc71;
}

function managedRoleName(queue: ManagedRankQueue, tier: string) {
  const prettyTier = toTitleCase(tier);
  const prefix = rankRolePrefix();
  const queueTier = queue.roleLabel ? `${queue.roleLabel} ${prettyTier}` : prettyTier;
  return prefix ? `${prefix}: ${queueTier}` : queueTier;
}

function normalizeManagedTier(tier?: string | null) {
  const key = String(tier ?? "").trim().toUpperCase();
  return MANAGED_RANK_ROLE_SPECS.some((spec) => spec.tier === key) ? key : null;
}

function isUnknownMemberError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Unknown Member/i.test(message) || /Discord API 404/i.test(message);
}

function playerTierForQueue(player: GuildRolePlayerProjection, queueKey: ManagedRankQueueKey) {
  return normalizeManagedTier(player[queueKey]?.tier ?? null);
}

function guildRankRoleSnapshot(player: GuildRolePlayerProjection) {
  return Object.fromEntries(
    MANAGED_RANK_QUEUES.map((queue) => [queue.key, playerTierForQueue(player, queue.key)])
  ) as Record<ManagedRankQueueKey, string | null>;
}

function sameGuildRankRoleSnapshot(
  left: Record<string, string | null> | null | undefined,
  right: Record<ManagedRankQueueKey, string | null>
) {
  if (!left) return false;
  return MANAGED_RANK_QUEUES.every((queue) =>
    String(left[queue.key] ?? "") === String(right[queue.key] ?? "")
  );
}

function assignedRoleNamesFromSnapshot(snapshot: Record<ManagedRankQueueKey, string | null>) {
  return Object.fromEntries(
    MANAGED_RANK_QUEUES.map((queue) => {
      const tier = snapshot[queue.key];
      return [queue.key, tier ? managedRoleName(queue, tier) : null];
    })
  ) as Record<ManagedRankQueueKey, string | null>;
}

function managedRoles(context: ManagedRoleContext) {
  return MANAGED_RANK_QUEUES.flatMap((queue) => context.managedRolesByQueue.get(queue.key) ?? []);
}

function memberUserId(member: DiscordGuildMember) {
  return String(member.user?.id ?? "").trim();
}

function isBotMember(member: DiscordGuildMember) {
  return !!member.user?.bot;
}

async function listAllDiscordGuildMembers(guildId: string) {
  const members: DiscordGuildMember[] = [];
  let after = "";

  for (;;) {
    const page = await listDiscordGuildMembers({ guildId, after, limit: 1000 });
    if (!page.length) break;

    members.push(...page);
    const lastUserId = memberUserId(page[page.length - 1]);
    if (page.length < 1000 || !lastUserId || lastUserId === after) break;
    after = lastUserId;
  }

  return members;
}

function unboundBindMessage() {
  const linkedRolesUrl = `${getAppBaseUrl()}/discord/linked-roles`;
  const codeText = isCommunityCodeRequired()
    ? "If it asks for the community code, ask server staff and enter it there."
    : "No community code is needed right now.";

  return [
    "**Welcome to Riftboard Myanmar.**",
    `You have the **${bindRoleName()}** role because your Riot account is not linked yet.`,
    `Bind here: ${linkedRolesUrl}`,
    "After linking, the bind role is removed and your rank roles can sync.",
    codeText,
  ].join("\n");
}

async function messageUnboundMember(userId: string) {
  const dm = await createDiscordDmChannel(userId);
  await sendDiscordChannelMessage({
    channelId: dm.id,
    content: unboundBindMessage(),
  });
}

async function ensureManagedRoleContext(existingRoles?: DiscordGuildRole[]) {
  const guildId = String(getDiscordGuildId() ?? "").trim();
  if (!guildId) throw new Error("Missing env: DISCORD_GUILD_ID");

  const createdRoleNames: string[] = [];
  const roles = [...(existingRoles ?? (await listDiscordGuildRoles(guildId)))];
  const byName = new Map(roles.map((role) => [String(role.name ?? "").trim(), role]));

  let bindRole = byName.get(bindRoleName());
  if (!bindRole) {
    bindRole = await createDiscordGuildRole({
      guildId,
      name: bindRoleName(),
      color: bindRoleColor(),
      reason: "Create Riftboard bind role",
    });
    roles.push(bindRole);
    byName.set(bindRole.name, bindRole);
    createdRoleNames.push(bindRole.name);
  }

  let verifiedRole = byName.get(verifiedRoleName());
  if (!verifiedRole) {
    verifiedRole = await createDiscordGuildRole({
      guildId,
      name: verifiedRoleName(),
      color: verifiedRoleColor(),
      reason: "Create Riftboard verified member role",
    });
    roles.push(verifiedRole);
    byName.set(verifiedRole.name, verifiedRole);
    createdRoleNames.push(verifiedRole.name);
  }

  for (const queue of MANAGED_RANK_QUEUES) {
    for (const spec of MANAGED_RANK_ROLE_SPECS) {
      const name = managedRoleName(queue, spec.tier);
      if (byName.has(name)) continue;

      const created = await createDiscordGuildRole({
        guildId,
        name,
        color: spec.color,
        reason: `Create managed Riftboard ${queue.label} rank role`,
      });
      roles.push(created);
      byName.set(name, created);
      createdRoleNames.push(name);
    }
  }

  return {
    guildId,
    rolesByName: byName,
    bindRole,
    verifiedRole,
    managedRolesByQueue: new Map(
      MANAGED_RANK_QUEUES.map((queue) => [
        queue.key,
        MANAGED_RANK_ROLE_SPECS.map((spec) => byName.get(managedRoleName(queue, spec.tier)))
          .filter((role): role is DiscordGuildRole => !!role?.id),
      ])
    ),
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

  let addedRoleName: string | null = null;
  let removedRoles = 0;
  let removedBindRole = false;
  let addedVerifiedRole = false;
  const assignedRoleNames = Object.fromEntries(
    MANAGED_RANK_QUEUES.map((queue) => [queue.key, null])
  ) as Record<ManagedRankQueueKey, string | null>;

  for (const queue of MANAGED_RANK_QUEUES) {
    const wantedTier = playerTierForQueue(input.player, queue.key);
    const wantedRole = wantedTier
      ? context.rolesByName.get(managedRoleName(queue, wantedTier)) ?? null
      : null;
    assignedRoleNames[queue.key] = wantedRole?.name ?? null;

    for (const role of context.managedRolesByQueue.get(queue.key) ?? []) {
      const shouldHave = !!wantedRole && role.id === wantedRole.id;
      const hasRole = existingRoleIds.has(role.id);

      if (shouldHave && !hasRole) {
        await addDiscordGuildMemberRole({
          guildId: context.guildId,
          userId: input.discordUserId,
          roleId: role.id,
          reason: `Sync Riftboard ${queue.label} rank role for ${input.player.gameName}#${input.player.tagLine}`,
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
          reason: `Remove stale Riftboard ${queue.label} rank role for ${input.player.gameName}#${input.player.tagLine}`,
        });
        removedRoles++;
        existingRoleIds.delete(role.id);
      }
    }
  }

  if (existingRoleIds.has(context.bindRole.id)) {
    await removeDiscordGuildMemberRole({
      guildId: context.guildId,
      userId: input.discordUserId,
      roleId: context.bindRole.id,
      reason: `Remove Riftboard bind role for verified member ${input.player.gameName}#${input.player.tagLine}`,
    });
    existingRoleIds.delete(context.bindRole.id);
    removedBindRole = true;
  }

  if (!existingRoleIds.has(context.verifiedRole.id)) {
    await addDiscordGuildMemberRole({
      guildId: context.guildId,
      userId: input.discordUserId,
      roleId: context.verifiedRole.id,
      reason: `Assign Riftboard verified role for ${input.player.gameName}#${input.player.tagLine}`,
    });
    existingRoleIds.add(context.verifiedRole.id);
    addedVerifiedRole = true;
  }

  return {
    createdRoleNames: context.createdRoleNames,
    assignedRoleName: assignedRoleNames.solo,
    assignedRoleNames,
    addedRoleName,
    removedRoles,
    removedBindRole,
    addedVerifiedRole,
  };
}

export async function syncDiscordGuildRankRoleForStoredLink(
  linkId: string,
  opts?: SyncDiscordGuildRankRoleOptions
) {
  await dbConnect();

  const link = await DiscordLink.findById(linkId);
  if (!link?._id) throw new Error("Discord link not found.");
  if (!canSyncGuildRankRoles(link)) {
    throw new Error("Bind this Discord user before syncing server rank roles.");
  }

  const player = await Player.findById(link.playerId, {
    gameName: 1,
    tagLine: 1,
    solo: 1,
    tft: 1,
    flex: 1,
  }).lean<GuildRolePlayerProjection | null>();
  if (!player?._id) throw new Error("Linked Riftboard profile not found.");

  const wantedSnapshot = guildRankRoleSnapshot(player);
  if (
    !opts?.force &&
    link.gameName === player.gameName &&
    link.tagLine === player.tagLine &&
    sameGuildRankRoleSnapshot(link.guildRankRolesSnapshot, wantedSnapshot)
  ) {
    return {
      createdRoleNames: [],
      assignedRoleName: link.guildRankRoleName ?? null,
      assignedRoleNames: assignedRoleNamesFromSnapshot(wantedSnapshot),
      addedRoleName: null,
      removedRoles: 0,
      removedBindRole: false,
      addedVerifiedRole: false,
      skipped: true,
    };
  }

  const result = await syncDiscordGuildRankRoleForIdentity({
    discordUserId: String(link.discordUserId),
    player,
  });

  link.gameName = player.gameName;
  link.tagLine = player.tagLine;
  link.guildRankRoleTier = wantedSnapshot.solo;
  link.guildRankRoleName = result.assignedRoleName;
  link.guildRankRolesSnapshot = wantedSnapshot;
  link.guildRankRolesSyncedAt = new Date();
  await link.save();

  return { ...result, skipped: false };
}

export async function syncAllDiscordGuildRankRoles() {
  await dbConnect();

  const links = await DiscordLink.find(
    {
      verifiedBinding: true,
      verificationSource: { $in: ["discord_connections", "legacy_manual"] },
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
    { gameName: 1, tagLine: 1, solo: 1, tft: 1, flex: 1 }
  ).lean<GuildRolePlayerProjection[]>();
  const playersById = new Map(players.map((player) => [String(player._id), player]));

  const context = await ensureManagedRoleContext();
  const allowedDiscordUserIds = new Set<string>();
  let synced = 0;
  let missingPlayers = 0;
  let missingMembers = 0;
  let unranked = 0;
  let cleanedMembers = 0;
  let cleanedRoles = 0;
  let bindRoleAdded = 0;
  let bindRoleRemoved = 0;
  let verifiedRoleAdded = 0;
  let verifiedRoleRemoved = 0;
  let messagedUnboundMembers = 0;
  let unboundMessageFailures = 0;
  const errors: string[] = [];

  for (const link of links) {
    const discordUserId = String(link.discordUserId ?? "").trim();
    if (discordUserId) {
      allowedDiscordUserIds.add(discordUserId);
    }

    const player = playersById.get(String(link.playerId ?? ""));
    if (!player?._id) {
      missingPlayers++;
      continue;
    }

    try {
      const result = await syncDiscordGuildRankRoleForIdentity({
        discordUserId,
        player,
        context,
      });
      synced++;
      if (!result.assignedRoleName) unranked++;
      if (result.removedBindRole) bindRoleRemoved++;
      if (result.addedVerifiedRole) verifiedRoleAdded++;
      const snapshot = guildRankRoleSnapshot(player);
      await DiscordLink.updateOne(
        { _id: link._id },
        {
          $set: {
            gameName: player.gameName,
            tagLine: player.tagLine,
            guildRankRoleTier: snapshot.solo,
            guildRankRoleName: result.assignedRoleName,
            guildRankRolesSnapshot: snapshot,
            guildRankRolesSyncedAt: new Date(),
          },
        }
      );
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

  try {
    const removableRolesById = new Map(managedRoles(context).map((role) => [role.id, role]));
    removableRolesById.set(context.verifiedRole.id, context.verifiedRole);
    if (removableRolesById.size) {
      const members = await listAllDiscordGuildMembers(context.guildId);

      for (const member of members) {
        const userId = memberUserId(member);
        if (isBotMember(member)) continue;
        if (!userId || allowedDiscordUserIds.has(userId)) continue;

        const existingRoleIds = new Set(
          Array.isArray(member.roles) ? member.roles.map((roleId) => String(roleId)) : []
        );
        const rolesToRemove = (Array.isArray(member.roles) ? member.roles : [])
          .map((roleId) => removableRolesById.get(String(roleId)))
          .filter((role): role is DiscordGuildRole => !!role?.id);

        for (const role of rolesToRemove) {
          await removeDiscordGuildMemberRole({
            guildId: context.guildId,
            userId,
            roleId: role.id,
            reason: "Remove Riftboard managed rank role from unbound member",
          });
          cleanedRoles++;
          if (role.id === context.verifiedRole.id) verifiedRoleRemoved++;
        }

        let addedBindRole = false;
        if (!existingRoleIds.has(context.bindRole.id)) {
          await addDiscordGuildMemberRole({
            guildId: context.guildId,
            userId,
            roleId: context.bindRole.id,
            reason: "Assign Riftboard bind role to unlinked member",
          });
          bindRoleAdded++;
          addedBindRole = true;
        }

        if (!rolesToRemove.length && !addedBindRole) continue;
        if (rolesToRemove.length || addedBindRole) cleanedMembers++;

        try {
          await messageUnboundMember(userId);
          messagedUnboundMembers++;
        } catch (error) {
          unboundMessageFailures++;
          console.error("[discordGuildRoles] failed to DM unbound member", userId, error);
        }
      }
    }
  } catch (error) {
    errors.push(
      `cleanup unbound members: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    scanned: links.length,
    synced,
    missingPlayers,
    missingMembers,
    unranked,
    cleanedMembers,
    cleanedRoles,
    bindRoleAdded,
    bindRoleRemoved,
    verifiedRoleAdded,
    verifiedRoleRemoved,
    messagedUnboundMembers,
    unboundMessageFailures,
    createdRoleNames: context.createdRoleNames,
    errors,
  };
}
