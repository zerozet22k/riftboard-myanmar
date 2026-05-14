import { dbConnect } from "@/lib/mongodb";
import {
  decryptDiscordSecret,
  encryptDiscordSecret,
  getDiscordGuildId,
  getDiscordUserGuilds,
  refreshDiscordToken,
  type DiscordConnection,
  type DiscordOAuthToken,
  type DiscordUser,
  updateDiscordRoleConnection,
} from "@/lib/discord";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import { rankScore, TIER_SCORE } from "@/lib/rank";
import { refreshPlayerById, upsertAndRefreshByRiotId } from "@/lib/refresh";
import { parseRiotId } from "@/lib/tournaments";
import { DiscordLink, type DiscordLinkDoc } from "@/models/discordLink";
import { Player } from "@/models/player";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import {
  ensureDiscordLinkMultiAccountIndexes,
  findPrimaryDiscordLink,
  setPrimaryDiscordLink,
} from "@/lib/discordLinkStore";

type PlayerProjection = {
  _id: unknown;
  gameName: string;
  tagLine: string;
  solo?: {
    tier?: string | null;
    division?: string | null;
    lp?: number | null;
  } | null;
  leaderboard?: {
    status?: string | null;
  } | null;
};

type DiscordLinkDocument = InstanceType<typeof DiscordLink>;

type RefreshedDiscordPlayer = {
  gameName: string;
  tagLine: string;
  solo?: {
    tier?: string | null;
    division?: string | null;
    lp?: number | null;
  } | null;
  _skipped?: boolean;
  _cooldownSecondsLeft?: number;
  _nextRefreshAt?: string;
};

type SyncDiscordLinkedRoleOptions = {
  force?: boolean;
};

export type DiscordRiotCandidate = {
  id: string;
  riotId: string;
  gameName: string;
  tagLine: string;
  connectionType: string;
  connectionLabel: string;
};

const TRUSTED_VERIFICATION_SOURCES = ["discord_connections", "riot_rso", "legacy_manual"] as const;
const LINKED_ROLE_VERIFICATION_SOURCES = ["discord_connections", "riot_rso"] as const;

const RIOT_CONNECTION_TYPE_PATTERN = /(riot|league)/i;
const RECENT_GUILD_VERIFICATION_MS = 10 * 60 * 1000;

function normalizeTierValue(tier?: string | null) {
  return tier ? TIER_SCORE[String(tier).toUpperCase()] ?? 0 : 0;
}

function toDiscordLinkDocument(link: unknown) {
  return link as DiscordLinkDocument;
}

function sameMetadataSnapshot(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, number>
) {
  if (!left) return false;

  const rightEntries = Object.entries(right);
  if (Object.keys(left).length !== rightEntries.length) return false;

  return rightEntries.every(([key, value]) => Number(left[key]) === value);
}

export function buildDiscordLinkedRoleMetadata(player: PlayerProjection) {
  const solo = player.solo ?? null;
  const soloRanked = solo?.tier ? 1 : 0;
  const soloTierValue = normalizeTierValue(solo?.tier ?? null);

  return {
    solo_ranked: soloRanked,
    leaderboard_approved: player.leaderboard?.status === "approved" ? 1 : 0,
    solo_tier_exact: soloTierValue,
    solo_tier_plus: soloTierValue,
    solo_rank_score: soloRanked ? rankScore(solo?.tier ?? null, solo?.division ?? null, solo?.lp ?? null) : 0,
  };
}

export function extractRiotCandidatesFromDiscordConnections(connections: DiscordConnection[]) {
  const deduped = new Map<string, DiscordRiotCandidate>();

  for (const connection of Array.isArray(connections) ? connections : []) {
    const connectionType = String(connection?.type ?? "").trim();
    if (!RIOT_CONNECTION_TYPE_PATTERN.test(connectionType)) continue;
    if (connection?.verified === false) continue;

    const label = String(connection?.name ?? "").trim();
    const parsed = parseRiotId(label);
    if (!parsed) continue;

    const riotId = `${parsed.gameName}#${parsed.tagLine}`;
    const key = riotId.toLowerCase();
    if (deduped.has(key)) continue;

    deduped.set(key, {
      id: key,
      riotId,
      gameName: parsed.gameName,
      tagLine: parsed.tagLine,
      connectionType,
      connectionLabel: label,
    });
  }

  return [...deduped.values()].sort((left, right) => left.riotId.localeCompare(right.riotId));
}

export async function resolvePlayerForDiscordLink(riotIdInput: string) {
  const parsed = parseRiotId(riotIdInput);
  if (!parsed) throw new Error("Discord did not provide a valid Riot ID.");

  await upsertAndRefreshByRiotId(
    { gameName: parsed.gameName, tagLine: parsed.tagLine },
    { force: true, syncMatches: false, fullMastery: false }
  );

  const player = await Player.findOne(
    buildPlayerLookupQuery(parsed.gameName, parsed.tagLine),
    {
      gameName: 1,
      tagLine: 1,
      solo: 1,
      leaderboard: 1,
    }
  ).lean<PlayerProjection | null>();

  if (!player?._id) throw new Error("Could not resolve that Discord-provided Riot account into a Riftboard profile.");
  return player;
}

export async function ensureFreshDiscordAccessToken(linkInput: DiscordLinkDocument) {
  const link = toDiscordLinkDocument(linkInput);
  let accessToken = decryptDiscordSecret(link.accessTokenEnc);

  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    if (!link.refreshTokenEnc) {
      throw new Error("Discord authorization expired. Reconnect your Discord account.");
    }

    const refreshed = await refreshDiscordToken(decryptDiscordSecret(link.refreshTokenEnc));
    accessToken = refreshed.access_token;
    link.accessTokenEnc = encryptDiscordSecret(refreshed.access_token);
    link.refreshTokenEnc = refreshed.refresh_token
      ? encryptDiscordSecret(refreshed.refresh_token)
      : link.refreshTokenEnc;
    link.tokenType = refreshed.token_type;
    link.scopes = String(refreshed.scope ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    link.expiresAt = new Date(Date.now() + Math.max(0, refreshed.expires_in - 60) * 1000);
    await link.save();
  }

  return accessToken;
}

export async function verifyDiscordGuildMembershipForLink(linkInput: DiscordLinkDocument) {
  const link = toDiscordLinkDocument(linkInput);
  const guildId = String(getDiscordGuildId() ?? "").trim();
  if (!guildId) throw new Error("Missing env: DISCORD_GUILD_ID");

  const accessToken = await ensureFreshDiscordAccessToken(link);
  const lastVerifiedAt = link.lastVerifiedAt ? new Date(link.lastVerifiedAt).getTime() : 0;
  if (
    lastVerifiedAt &&
    Number.isFinite(lastVerifiedAt) &&
    Date.now() - lastVerifiedAt < RECENT_GUILD_VERIFICATION_MS &&
    String(link.lastVerifiedGuildId ?? "").trim() === guildId
  ) {
    return accessToken;
  }

  const guilds = await getDiscordUserGuilds(accessToken);
  const isMember = guilds.some((guild) => String(guild?.id ?? "").trim() === guildId);

  if (!isMember) {
    throw new Error("Join the Riftboard Discord server before using this feature.");
  }

  link.lastVerifiedAt = new Date();
  link.lastVerifiedGuildId = guildId;
  await link.save();
  return accessToken;
}

export async function loadStoredDiscordIdentity(discordUserId: string) {
  await dbConnect();

  const link = await findPrimaryDiscordLink(discordUserId);
  if (!link?._id) throw new Error("No Discord link found. Connect Discord first.");
  if (!isVerifiedDiscordLink(link)) {
    throw new Error("Reconnect Discord to verify your Riot account again.");
  }

  const player = await Player.findById(
    link.playerId,
    { gameName: 1, tagLine: 1, solo: 1, leaderboard: 1 }
  ).lean<PlayerProjection | null>();

  if (!player?._id) throw new Error("Your linked Riftboard profile could not be found.");
  return { link, player };
}

export async function loadVerifiedDiscordIdentity(discordUserId: string) {
  const identity = await loadStoredDiscordIdentity(discordUserId);
  const accessToken = await verifyDiscordGuildMembershipForLink(identity.link);
  return { ...identity, accessToken };
}

export async function saveVerifiedDiscordLinkFromCandidate(input: {
  discordUser: DiscordUser;
  token: DiscordOAuthToken;
  candidate: DiscordRiotCandidate;
}) {
  const player = await resolvePlayerForDiscordLink(input.candidate.riotId);
  const guildId = String(getDiscordGuildId() ?? "").trim();
  const now = new Date();
  await ensureDiscordLinkMultiAccountIndexes();
  await DiscordLink.deleteMany({
    playerId: player._id,
    discordUserId: { $ne: input.discordUser.id },
  } as Record<string, unknown>);

  const saved = await DiscordLink.findOneAndUpdate(
    { discordUserId: input.discordUser.id, playerId: player._id } as Record<string, unknown>,
    {
      $set: {
        discordUsername: input.discordUser.global_name || input.discordUser.username,
        playerId: player._id,
        isPrimary: true,
        gameName: player.gameName,
        tagLine: player.tagLine,
        accessTokenEnc: encryptDiscordSecret(input.token.access_token),
        refreshTokenEnc: input.token.refresh_token ? encryptDiscordSecret(input.token.refresh_token) : null,
        tokenType: input.token.token_type,
        scopes: String(input.token.scope ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean),
        expiresAt: new Date(Date.now() + Math.max(0, input.token.expires_in - 60) * 1000),
        verifiedBinding: true,
        verificationSource: "discord_connections",
        lastVerifiedAt: now,
        lastVerifiedGuildId: guildId || null,
        proofConnectionType: input.candidate.connectionType,
        proofConnectionLabel: input.candidate.connectionLabel,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const savedLink = toDiscordLinkDocument(saved);
  await setPrimaryDiscordLink(input.discordUser.id, savedLink._id);

  return { link: savedLink, player };
}

export async function saveVerifiedDiscordLinkFromRso(input: {
  discordUserId: string;
  discordUsername: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt?: Date | null;
  player: {
    _id: unknown;
    gameName: string;
    tagLine: string;
  };
}) {
  const guildId = String(getDiscordGuildId() ?? "").trim();
  const now = new Date();
  await ensureDiscordLinkMultiAccountIndexes();
  await DiscordLink.deleteMany({
    playerId: input.player._id,
    discordUserId: { $ne: input.discordUserId },
  } as Record<string, unknown>);

  const saved = await DiscordLink.findOneAndUpdate(
    { discordUserId: input.discordUserId, playerId: input.player._id } as Record<string, unknown>,
    {
      $set: {
        discordUsername: input.discordUsername,
        playerId: input.player._id,
        isPrimary: true,
        gameName: input.player.gameName,
        tagLine: input.player.tagLine,
        accessTokenEnc: encryptDiscordSecret(input.accessToken),
        refreshTokenEnc: input.refreshToken ? encryptDiscordSecret(input.refreshToken) : null,
        tokenType: input.tokenType,
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        verifiedBinding: true,
        verificationSource: "riot_rso",
        lastVerifiedAt: now,
        lastVerifiedGuildId: guildId || null,
        proofConnectionType: "riot_rso",
        proofConnectionLabel: `${input.player.gameName}#${input.player.tagLine}`,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const savedLink = toDiscordLinkDocument(saved);
  await setPrimaryDiscordLink(input.discordUserId, savedLink._id);

  return { link: savedLink, player: input.player };
}

export async function syncDiscordLinkedRoleForStoredLink(
  linkId: string,
  opts?: SyncDiscordLinkedRoleOptions
) {
  await dbConnect();
  const link = await DiscordLink.findById(linkId);
  if (!link?._id) throw new Error("Discord link not found.");
  if (
    !link.verifiedBinding ||
    !LINKED_ROLE_VERIFICATION_SOURCES.includes(link.verificationSource as "discord_connections" | "riot_rso")
  ) {
    throw new Error("Reconnect Discord before syncing linked roles.");
  }

  const player = await Player.findById(
    link.playerId,
    { gameName: 1, tagLine: 1, solo: 1, leaderboard: 1 }
  ).lean<PlayerProjection | null>();
  if (!player?._id) throw new Error("Linked Riftboard profile not found.");

  const metadata = buildDiscordLinkedRoleMetadata(player);
  const platformUsername = `${player.gameName}#${player.tagLine}`;
  if (
    !opts?.force &&
    link.gameName === player.gameName &&
    link.tagLine === player.tagLine &&
    sameMetadataSnapshot(link.metadataSnapshot, metadata)
  ) {
    return { link, player, metadata, skipped: true };
  }

  const accessToken = await verifyDiscordGuildMembershipForLink(link);
  await updateDiscordRoleConnection({
    accessToken,
    platformName: "Riftboard Myanmar",
    platformUsername,
    metadata,
  });

  link.gameName = player.gameName;
  link.tagLine = player.tagLine;
  link.metadataSnapshot = metadata;
  link.lastSyncedAt = new Date();
  await link.save();

  return { link, player, metadata, skipped: false };
}

export async function refreshStoredDiscordProfile(
  discordUserId: string,
  opts?: {
    force?: boolean;
    syncMatches?: boolean;
    matchesCount?: number;
    fullMastery?: boolean;
    syncLinkedRole?: boolean;
  }
) {
  const { link } = await loadStoredDiscordIdentity(discordUserId);
  const player = (await refreshPlayerById(String(link.playerId), {
    force: opts?.force ?? true,
    syncMatches: opts?.syncMatches ?? false,
    matchesCount: opts?.matchesCount ?? 10,
    fullMastery: opts?.fullMastery ?? false,
  })) as RefreshedDiscordPlayer;

  let linkedRoleError: string | null = null;
  let guildRoleError: string | null = null;
  let linkedRoleSkipped = false;
  let guildRoleSkipped = false;
  if (
    opts?.syncLinkedRole !== false &&
    LINKED_ROLE_VERIFICATION_SOURCES.includes(link.verificationSource as "discord_connections" | "riot_rso")
  ) {
    try {
      const synced = await syncDiscordLinkedRoleForStoredLink(String(link._id));
      linkedRoleSkipped = synced.skipped;
    } catch (error) {
      linkedRoleError =
        error instanceof Error ? error.message : "Could not refresh linked-role metadata.";
    }
  } else if (opts?.syncLinkedRole !== false) {
    linkedRoleSkipped = true;
  }

  try {
    const synced = await syncDiscordGuildRankRoleForStoredLink(String(link._id), {
      force: opts?.force ?? false,
    });
    guildRoleSkipped = synced.skipped;
  } catch (error) {
    guildRoleError =
      error instanceof Error ? error.message : "Could not refresh Discord server rank roles.";
  }

  return {
    player,
    canonicalPath: canonicalPlayerPath(player.gameName, player.tagLine),
    linkedRoleError,
    guildRoleError,
    linkedRoleSkipped,
    guildRoleSkipped,
  };
}

export function isVerifiedDiscordLink(
  link: Pick<DiscordLinkDoc, "verifiedBinding" | "verificationSource"> | null | undefined
) {
  return (
    !!link?.verifiedBinding &&
    TRUSTED_VERIFICATION_SOURCES.includes(link.verificationSource as (typeof TRUSTED_VERIFICATION_SOURCES)[number])
  );
}
