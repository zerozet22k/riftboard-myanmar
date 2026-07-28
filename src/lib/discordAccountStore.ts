import { dbConnect } from "@/lib/mongodb";
import {
  decryptDiscordSecret,
  encryptDiscordSecret,
  getDiscordGuildId,
  getDiscordUserGuilds,
  refreshDiscordToken,
  type DiscordOAuthToken,
  type DiscordUser,
} from "@/lib/discord";
import { DiscordAccount } from "@/models/discordAccount";
import { DiscordLink } from "@/models/discordLink";

type DiscordAccountDocument = InstanceType<typeof DiscordAccount>;

export type StoredDiscordCredentials = {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt: Date | null;
};

const RECENT_GUILD_VERIFICATION_MS = 10 * 60 * 1000;
let discordAccountIndexPromise: Promise<unknown> | null = null;

function normalizeDiscordUserId(discordUserId: string) {
  return String(discordUserId ?? "").trim();
}

function tokenScopes(scope: string | undefined) {
  return String(scope ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function encryptedCredentials(input: {
  accessToken: string;
  refreshToken?: string | null;
  refreshTokenEncFallback?: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt?: Date | null;
}): StoredDiscordCredentials {
  return {
    accessTokenEnc: encryptDiscordSecret(input.accessToken),
    refreshTokenEnc: input.refreshToken
      ? encryptDiscordSecret(input.refreshToken)
      : input.refreshTokenEncFallback ?? null,
    tokenType: input.tokenType,
    scopes: input.scopes,
    expiresAt: input.expiresAt ?? null,
  };
}

async function ensureDiscordAccountIndexes() {
  await dbConnect();
  discordAccountIndexPromise ??= DiscordAccount.collection.createIndex(
    { discordUserId: 1 },
    { unique: true }
  );
  try {
    await discordAccountIndexPromise;
  } catch (error) {
    discordAccountIndexPromise = null;
    throw error;
  }
}

async function mirrorDiscordAccountToLinks(
  discordUserId: string,
  account: Pick<
    DiscordAccountDocument,
    | "discordUsername"
    | "accessTokenEnc"
    | "refreshTokenEnc"
    | "tokenType"
    | "scopes"
    | "expiresAt"
    | "lastVerifiedAt"
    | "lastVerifiedGuildId"
  >
) {
  await DiscordLink.updateMany(
    { discordUserId },
    {
      $set: {
        discordUsername: account.discordUsername ?? null,
        accessTokenEnc: account.accessTokenEnc,
        refreshTokenEnc: account.refreshTokenEnc ?? null,
        tokenType: account.tokenType,
        scopes: account.scopes ?? [],
        expiresAt: account.expiresAt ?? null,
        lastVerifiedAt: account.lastVerifiedAt ?? null,
        lastVerifiedGuildId: account.lastVerifiedGuildId ?? null,
      },
    }
  );
}

/**
 * Lazily creates the Discord owner record for production links written before
 * DiscordAccount existed. No bulk migration is required and the child link is
 * left intact.
 */
export async function ensureStoredDiscordAccount(discordUserId: string) {
  const normalizedId = normalizeDiscordUserId(discordUserId);
  if (!normalizedId) return null;

  await ensureDiscordAccountIndexes();
  const existing = await DiscordAccount.findOne({ discordUserId: normalizedId });
  if (existing?._id) return existing;

  const legacyLink = await DiscordLink.findOne({
    discordUserId: normalizedId,
    verifiedBinding: true,
    accessTokenEnc: { $nin: [null, ""] },
  }).sort({ isPrimary: -1, updatedAt: -1, _id: -1 });
  if (!legacyLink?._id) return null;

  return DiscordAccount.findOneAndUpdate(
    { discordUserId: normalizedId },
    {
      $setOnInsert: {
        discordUserId: normalizedId,
        discordUsername: legacyLink.discordUsername ?? null,
        accessTokenEnc: legacyLink.accessTokenEnc,
        refreshTokenEnc: legacyLink.refreshTokenEnc ?? null,
        tokenType: legacyLink.tokenType,
        scopes: legacyLink.scopes ?? [],
        expiresAt: legacyLink.expiresAt ?? null,
        lastVerifiedAt: legacyLink.lastVerifiedAt ?? null,
        lastVerifiedGuildId: legacyLink.lastVerifiedGuildId ?? null,
        communityAccessCodeHash: legacyLink.communityAccessCodeHash ?? null,
        communityAccessGrantedAt: legacyLink.communityAccessGrantedAt ?? null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function saveDiscordAccountFromOAuth(input: {
  discordUser: DiscordUser;
  token: DiscordOAuthToken;
  verifiedGuildId: string;
}) {
  const discordUserId = normalizeDiscordUserId(input.discordUser.id);
  if (!discordUserId) throw new Error("invalid-discord-account");

  await ensureDiscordAccountIndexes();
  const existing = await DiscordAccount.findOne(
    { discordUserId },
    { refreshTokenEnc: 1 }
  ).lean<{ refreshTokenEnc?: string | null } | null>();
  const credentials = encryptedCredentials({
    accessToken: input.token.access_token,
    refreshToken: input.token.refresh_token ?? null,
    refreshTokenEncFallback: existing?.refreshTokenEnc ?? null,
    tokenType: input.token.token_type,
    scopes: tokenScopes(input.token.scope),
    expiresAt: new Date(
      Date.now() + Math.max(0, input.token.expires_in - 60) * 1000
    ),
  });

  const account = await DiscordAccount.findOneAndUpdate(
    { discordUserId },
    {
      $set: {
        discordUsername:
          input.discordUser.global_name || input.discordUser.username,
        ...credentials,
        lastVerifiedAt: new Date(),
        lastVerifiedGuildId: String(input.verifiedGuildId).trim(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await mirrorDiscordAccountToLinks(discordUserId, account);
  return account;
}

export async function loadStoredDiscordAccount(discordUserId: string) {
  const account = await ensureStoredDiscordAccount(discordUserId);
  if (!account?._id) {
    throw new Error("No Discord account found. Connect Discord first.");
  }
  return account;
}

export async function ensureFreshDiscordAccountAccessToken(
  accountInput: DiscordAccountDocument
) {
  const account = accountInput;
  let accessToken = decryptDiscordSecret(account.accessTokenEnc);

  if (account.expiresAt && account.expiresAt.getTime() <= Date.now()) {
    if (!account.refreshTokenEnc) {
      throw new Error("Discord authorization expired. Reconnect your Discord account.");
    }

    const encryptedRefreshToken = account.refreshTokenEnc;
    const refreshed = await refreshDiscordToken(
      decryptDiscordSecret(encryptedRefreshToken)
    );
    const credentials = encryptedCredentials({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? null,
      refreshTokenEncFallback: encryptedRefreshToken,
      tokenType: refreshed.token_type,
      scopes: tokenScopes(refreshed.scope),
      expiresAt: new Date(
        Date.now() + Math.max(0, refreshed.expires_in - 60) * 1000
      ),
    });

    accessToken = refreshed.access_token;
    account.accessTokenEnc = credentials.accessTokenEnc;
    account.refreshTokenEnc = credentials.refreshTokenEnc;
    account.tokenType = credentials.tokenType;
    account.scopes = credentials.scopes;
    account.expiresAt = credentials.expiresAt;
    await account.save();
    await mirrorDiscordAccountToLinks(String(account.discordUserId), account);
  }

  return accessToken;
}

export async function verifyDiscordGuildMembershipForAccount(
  accountInput: DiscordAccountDocument
) {
  const account = accountInput;
  const guildId = String(getDiscordGuildId() ?? "").trim();
  if (!guildId) throw new Error("Missing env: DISCORD_GUILD_ID");

  const accessToken = await ensureFreshDiscordAccountAccessToken(account);
  const lastVerifiedAt = account.lastVerifiedAt
    ? new Date(account.lastVerifiedAt).getTime()
    : 0;
  if (
    lastVerifiedAt &&
    Number.isFinite(lastVerifiedAt) &&
    Date.now() - lastVerifiedAt < RECENT_GUILD_VERIFICATION_MS &&
    String(account.lastVerifiedGuildId ?? "").trim() === guildId
  ) {
    return accessToken;
  }

  const guilds = await getDiscordUserGuilds(accessToken);
  const isMember = guilds.some(
    (guild) => String(guild?.id ?? "").trim() === guildId
  );
  if (!isMember) {
    throw new Error("Join the Riftboard Discord server before using this feature.");
  }

  account.lastVerifiedAt = new Date();
  account.lastVerifiedGuildId = guildId;
  await account.save();
  await mirrorDiscordAccountToLinks(String(account.discordUserId), account);
  return accessToken;
}

export async function loadVerifiedDiscordAccount(discordUserId: string) {
  const account = await loadStoredDiscordAccount(discordUserId);
  const accessToken = await verifyDiscordGuildMembershipForAccount(account);
  return { account, accessToken };
}
