import crypto from "node:crypto";
import { getAppBaseUrl } from "@/lib/runtimeConfig";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const DISCORD_LINKED_ROLE_METADATA = [
  {
    key: "solo_ranked",
    name: "Solo Ranked",
    description: "1 when the linked Riftboard player currently has a solo queue rank.",
    type: 7,
  },
  {
    key: "leaderboard_approved",
    name: "Community Approved",
    description: "1 when the linked Riftboard player is approved on the community leaderboard.",
    type: 7,
  },
  {
    key: "solo_tier_exact",
    name: "Solo Tier Exact",
    description: "Exact numeric solo tier value. Diamond is 600, Master is 700, Challenger is 900.",
    type: 3,
  },
  {
    key: "solo_tier_plus",
    name: "Solo Tier Plus",
    description: "Solo tier floor for tier-or-higher linked roles. Diamond+ is 600, Master+ is 700.",
    type: 2,
  },
  {
    key: "solo_rank_score",
    name: "Solo Rank Score",
    description: "Detailed solo rank score including tier, division, and LP.",
    type: 2,
  },
] as const;

export const DISCORD_COMMAND_DEFINITIONS = [
  {
    name: "link",
    description: "Get the Riftboard account-link page for Discord linked roles.",
    type: 1,
  },
  {
    name: "myrank",
    description: "Show the current Riftboard rank for your linked Riot ID.",
    type: 1,
  },
  {
    name: "refresh-linked-role",
    description: "Push your latest stored Riftboard rank metadata to Discord linked roles.",
    type: 1,
  },
] as const;

function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function mustEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export function getDiscordClientId() {
  return firstNonEmpty([
    process.env.DISCORD_CLIENT_ID,
    process.env.DISCORD_APPLICATION_ID,
  ]) || mustEnv("DISCORD_APPLICATION_ID");
}

export function getDiscordClientSecret() {
  return mustEnv("DISCORD_CLIENT_SECRET");
}

export function getDiscordBotToken() {
  return mustEnv("DISCORD_BOT_TOKEN");
}

export function getDiscordPublicKey() {
  return mustEnv("DISCORD_PUBLIC_KEY");
}

export function getDiscordGuildId() {
  return firstNonEmpty([
    process.env.DISCORD_GUILD_ID,
    process.env.DISCORD_SERVER_GUILD_ID,
  ]);
}

export function getDiscordRedirectUri() {
  return firstNonEmpty([
    process.env.DISCORD_REDIRECT_URI,
    `${getAppBaseUrl()}/api/discord/oauth/callback`,
  ]);
}

export function getDiscordInteractionsEndpointUrl() {
  return `${getAppBaseUrl()}/api/discord/interactions`;
}

export function getDiscordLinkedRolesVerificationUrl() {
  return `${getAppBaseUrl()}/discord/linked-roles`;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(getDiscordClientSecret()).digest();
}

export function encryptDiscordSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptDiscordSecret(payload: string) {
  const raw = Buffer.from(payload, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

async function discordApi<T>(path: string, init: RequestInit, auth?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (auth) headers.set("Authorization", auth);
  const res = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status}: ${text || res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type DiscordOAuthToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string;
};

export type DiscordConnection = {
  id?: string;
  name?: string;
  type?: string;
  verified?: boolean;
  visibility?: number;
};

export type DiscordGuild = {
  id: string;
  name?: string;
  owner?: boolean;
  permissions?: string;
};

export async function exchangeDiscordCode(code: string) {
  const body = new URLSearchParams({
    client_id: getDiscordClientId(),
    client_secret: getDiscordClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: getDiscordRedirectUri(),
  });

  return discordApi<DiscordOAuthToken>(
    "/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
}

export async function refreshDiscordToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: getDiscordClientId(),
    client_secret: getDiscordClientSecret(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return discordApi<DiscordOAuthToken>(
    "/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
}

export async function getDiscordUser(accessToken: string) {
  return discordApi<DiscordUser>(
    "/users/@me",
    { method: "GET" },
    `Bearer ${accessToken}`
  );
}

export async function getDiscordUserConnections(accessToken: string) {
  return discordApi<DiscordConnection[]>(
    "/users/@me/connections",
    { method: "GET" },
    `Bearer ${accessToken}`
  );
}

export async function getDiscordUserGuilds(accessToken: string) {
  return discordApi<DiscordGuild[]>(
    "/users/@me/guilds",
    { method: "GET" },
    `Bearer ${accessToken}`
  );
}

export async function updateDiscordRoleConnection(input: {
  accessToken: string;
  platformName: string;
  platformUsername: string;
  metadata: Record<string, number>;
}) {
  return discordApi<Record<string, unknown>>(
    `/users/@me/applications/${encodeURIComponent(getDiscordClientId())}/role-connection`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform_name: input.platformName,
        platform_username: input.platformUsername,
        metadata: input.metadata,
      }),
    },
    `Bearer ${input.accessToken}`
  );
}

export async function registerDiscordMetadataSchema() {
  return discordApi<unknown>(
    `/applications/${encodeURIComponent(getDiscordClientId())}/role-connections/metadata`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DISCORD_LINKED_ROLE_METADATA),
    },
    `Bot ${getDiscordBotToken()}`
  );
}

export async function registerDiscordGuildCommands() {
  const guildId = getDiscordGuildId();
  if (!guildId) throw new Error("Missing env: DISCORD_GUILD_ID");

  return discordApi<unknown>(
    `/applications/${encodeURIComponent(getDiscordClientId())}/guilds/${encodeURIComponent(guildId)}/commands`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DISCORD_COMMAND_DEFINITIONS),
    },
    `Bot ${getDiscordBotToken()}`
  );
}

export async function updateDiscordApplicationUrls() {
  return discordApi<unknown>(
    "/applications/@me",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interactions_endpoint_url: getDiscordInteractionsEndpointUrl(),
        role_connections_verification_url: getDiscordLinkedRolesVerificationUrl(),
      }),
    },
    `Bot ${getDiscordBotToken()}`
  );
}

export function makeDiscordOAuthUrl(state: string) {
  const query = new URLSearchParams({
    client_id: getDiscordClientId(),
    response_type: "code",
    scope: "identify connections guilds role_connections.write",
    redirect_uri: getDiscordRedirectUri(),
    prompt: "consent",
    state,
  });
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

export function verifyDiscordInteraction(input: {
  timestamp: string;
  body: string;
  signatureHex: string;
}) {
  const publicKeyDer = Buffer.concat([
    SPKI_ED25519_PREFIX,
    Buffer.from(getDiscordPublicKey(), "hex"),
  ]);
  const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
  return crypto.verify(
    null,
    Buffer.from(`${input.timestamp}${input.body}`, "utf8"),
    publicKey,
    Buffer.from(input.signatureHex, "hex")
  );
}
