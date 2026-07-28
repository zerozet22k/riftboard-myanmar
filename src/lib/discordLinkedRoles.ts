import { dbConnect } from "@/lib/mongodb";
import {
  type DiscordConnection,
  updateDiscordRoleConnection,
} from "@/lib/discord";
import {
  ensureFreshDiscordAccountAccessToken,
  loadStoredDiscordAccount,
  verifyDiscordGuildMembershipForAccount,
} from "@/lib/discordAccountStore";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import { rankScore, TIER_SCORE } from "@/lib/rank";
import { refreshPlayerById, upsertAndRefreshByRiotId } from "@/lib/refresh";
import { withRiotRefreshLease } from "@/lib/schedulerLease";
import { parseRiotId } from "@/lib/tournaments";
import { DiscordLink, type DiscordLinkDoc } from "@/models/discordLink";
import { Player } from "@/models/player";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import {
  assertPlayerLinkAvailable,
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

type StoredDiscordCredentials = {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt: Date | null;
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

function credentialsFromDiscordAccount(input: {
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt?: Date | null;
}): StoredDiscordCredentials {
  return {
    accessTokenEnc: input.accessTokenEnc,
    refreshTokenEnc: input.refreshTokenEnc ?? null,
    tokenType: input.tokenType,
    scopes: input.scopes,
    expiresAt: input.expiresAt ?? null,
  };
}

async function propagateDiscordCredentials(
  discordUserId: string,
  credentials: StoredDiscordCredentials,
  discordUsername?: string | null
) {
  const update: Record<string, unknown> = { ...credentials };
  if (discordUsername !== undefined) {
    update.discordUsername = discordUsername;
  }

  // A Discord OAuth credential belongs to the Discord user, not one Riot
  // account. A single multi-document update keeps every sibling link on the
  // same access/refresh token generation.
  await DiscordLink.updateMany(
    { discordUserId: String(discordUserId).trim() },
    { $set: update }
  );
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
    if (connection?.verified !== true) continue;

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

  await dbConnect();
  const lookup = buildPlayerLookupQuery(parsed.gameName, parsed.tagLine);
  const existing = await Player.findOne(
    lookup,
    {
      gameName: 1,
      tagLine: 1,
      solo: 1,
      leaderboard: 1,
    }
  ).lean<PlayerProjection | null>();
  if (existing?._id) return existing;

  await withRiotRefreshLease(() =>
    upsertAndRefreshByRiotId(
      { gameName: parsed.gameName, tagLine: parsed.tagLine },
      { force: true, syncMatches: false, fullMastery: false }
    )
  );

  const player = await Player.findOne(
    lookup,
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
  const account = await loadStoredDiscordAccount(String(link.discordUserId));
  const accessToken = await ensureFreshDiscordAccountAccessToken(account);
  link.accessTokenEnc = account.accessTokenEnc;
  link.refreshTokenEnc = account.refreshTokenEnc ?? null;
  link.tokenType = account.tokenType;
  link.scopes = account.scopes ?? [];
  link.expiresAt = account.expiresAt ?? null;
  return accessToken;
}

export async function verifyDiscordGuildMembershipForLink(linkInput: DiscordLinkDocument) {
  const link = toDiscordLinkDocument(linkInput);
  const account = await loadStoredDiscordAccount(String(link.discordUserId));
  const accessToken = await verifyDiscordGuildMembershipForAccount(account);
  link.accessTokenEnc = account.accessTokenEnc;
  link.refreshTokenEnc = account.refreshTokenEnc ?? null;
  link.tokenType = account.tokenType;
  link.scopes = account.scopes ?? [];
  link.expiresAt = account.expiresAt ?? null;
  link.lastVerifiedAt = account.lastVerifiedAt ?? null;
  link.lastVerifiedGuildId = account.lastVerifiedGuildId ?? null;
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
  discordUserId: string;
  candidate: DiscordRiotCandidate;
}) {
  const player = await resolvePlayerForDiscordLink(input.candidate.riotId);
  const account = await loadStoredDiscordAccount(input.discordUserId);
  const discordUsername = account.discordUsername ?? "Discord User";
  await ensureDiscordLinkMultiAccountIndexes();
  await assertPlayerLinkAvailable(input.discordUserId, player._id);
  const [existingLink, currentPrimary] = await Promise.all([
    DiscordLink.findOne(
      { discordUserId: input.discordUserId, playerId: player._id },
      { isPrimary: 1 }
    ).lean<{ isPrimary?: boolean } | null>(),
    findPrimaryDiscordLink(input.discordUserId),
  ]);
  const useForRoles =
    existingLink?.isPrimary === true || !currentPrimary?._id;
  const credentials = credentialsFromDiscordAccount({
    accessTokenEnc: account.accessTokenEnc,
    refreshTokenEnc: account.refreshTokenEnc,
    tokenType: account.tokenType,
    scopes: account.scopes ?? [],
    expiresAt: account.expiresAt,
  });

  const saved = await DiscordLink.findOneAndUpdate(
    { discordUserId: input.discordUserId, playerId: player._id } as Record<string, unknown>,
    {
      $set: {
        discordUsername,
        playerId: player._id,
        isPrimary: useForRoles,
        gameName: player.gameName,
        tagLine: player.tagLine,
        ...credentials,
        verifiedBinding: true,
        verificationSource: "discord_connections",
        lastVerifiedAt: account.lastVerifiedAt ?? null,
        lastVerifiedGuildId: account.lastVerifiedGuildId ?? null,
        proofConnectionType: input.candidate.connectionType,
        proofConnectionLabel: input.candidate.connectionLabel,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const savedLink = toDiscordLinkDocument(saved);
  await propagateDiscordCredentials(input.discordUserId, credentials, discordUsername);
  if (useForRoles) {
    await setPrimaryDiscordLink(input.discordUserId, savedLink._id);
  }

  return { link: savedLink, player, isPrimary: useForRoles };
}

export async function saveVerifiedDiscordLinkFromRso(input: {
  discordUserId: string;
  player: {
    _id: unknown;
    gameName: string;
    tagLine: string;
  };
}) {
  const account = await loadStoredDiscordAccount(input.discordUserId);
  await ensureDiscordLinkMultiAccountIndexes();
  await assertPlayerLinkAvailable(input.discordUserId, input.player._id);
  const [existingLink, currentPrimary] = await Promise.all([
    DiscordLink.findOne(
      { discordUserId: input.discordUserId, playerId: input.player._id },
      { isPrimary: 1 }
    ).lean<{ isPrimary?: boolean } | null>(),
    findPrimaryDiscordLink(input.discordUserId),
  ]);
  const useForRoles =
    existingLink?.isPrimary === true || !currentPrimary?._id;
  const credentials = credentialsFromDiscordAccount({
    accessTokenEnc: account.accessTokenEnc,
    refreshTokenEnc: account.refreshTokenEnc,
    tokenType: account.tokenType,
    scopes: account.scopes ?? [],
    expiresAt: account.expiresAt,
  });

  const saved = await DiscordLink.findOneAndUpdate(
    { discordUserId: input.discordUserId, playerId: input.player._id } as Record<string, unknown>,
    {
      $set: {
        discordUsername: account.discordUsername ?? null,
        playerId: input.player._id,
        isPrimary: useForRoles,
        gameName: input.player.gameName,
        tagLine: input.player.tagLine,
        ...credentials,
        verifiedBinding: true,
        verificationSource: "riot_rso",
        lastVerifiedAt: account.lastVerifiedAt ?? null,
        lastVerifiedGuildId: account.lastVerifiedGuildId ?? null,
        proofConnectionType: "riot_rso",
        proofConnectionLabel: `${input.player.gameName}#${input.player.tagLine}`,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const savedLink = toDiscordLinkDocument(saved);
  await propagateDiscordCredentials(
    input.discordUserId,
    credentials,
    account.discordUsername ?? null
  );
  if (useForRoles) {
    await setPrimaryDiscordLink(input.discordUserId, savedLink._id);
  }

  return { link: savedLink, player: input.player, isPrimary: useForRoles };
}

export async function syncDiscordLinkedRoleForStoredLink(
  linkId: string,
  opts?: SyncDiscordLinkedRoleOptions
) {
  await dbConnect();
  const link = await DiscordLink.findById(linkId);
  if (!link?._id) throw new Error("Discord link not found.");
  if (link.isPrimary !== true) throw new Error("primary-account-required");
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
  const player = (await withRiotRefreshLease(() =>
    refreshPlayerById(String(link.playerId), {
      force: opts?.force ?? true,
      syncMatches: opts?.syncMatches ?? false,
      matchesCount: opts?.matchesCount ?? 5,
      fullMastery: opts?.fullMastery ?? false,
    })
  )) as RefreshedDiscordPlayer;

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
