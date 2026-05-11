import fs from "node:fs";
import path from "node:path";

const DISCORD_API_BASE = "https://discord.com/api/v10";

const LINKED_ROLE_METADATA = [
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
];

const COMMANDS = [
  {
    name: "link",
    description: "Get the Riftboard account-link page for Discord linked roles.",
    type: 1,
  },
  {
    name: "bind",
    description: "Alias for /link so members can finish the Riot account bind faster.",
    type: 1,
  },
  {
    name: "help",
    description: "Show Riftboard Discord bot commands and binding instructions.",
    type: 1,
  },
  {
    name: "roles",
    description: "Explain Riftboard rank roles and how to receive them.",
    type: 1,
  },
  {
    name: "status",
    description: "Show which Riot ID is currently bound to your Discord account.",
    type: 1,
  },
  {
    name: "profile",
    description: "Get the Riftboard profile URL for your linked Riot ID.",
    type: 1,
  },
  {
    name: "myrank",
    description: "Show the current Riftboard rank for your linked Riot ID.",
    type: 1,
  },
  {
    name: "refresh-profile",
    description: "Refresh your linked Riftboard profile from Riot and sync Discord roles.",
    type: 1,
  },
  {
    name: "refresh-linked-role",
    description: "Push your latest stored Riftboard rank metadata to Discord linked roles.",
    type: 1,
  },
  {
    name: "sync-server-roles",
    description: "Admin command to create and sync rank roles for linked members already in this server.",
    type: 1,
    default_member_permissions: "8",
  },
  {
    name: "setup-bind-message",
    description: "Admin command to post a public Riftboard bind message in this channel.",
    type: 1,
    default_member_permissions: "8",
  },
];

function loadDotEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function firstNonEmpty(values) {
  for (const value of values) {
    const trimmed = value?.trim?.();
    if (trimmed) return trimmed;
  }
  return "";
}

function mustEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

async function discordApi(pathname, init) {
  const res = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bot ${mustEnv("DISCORD_BOT_TOKEN")}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Discord API ${res.status} on ${init.method ?? "GET"} ${pathname}: ${text || res.statusText}`
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  loadDotEnv();

  const applicationId = firstNonEmpty([
    process.env.DISCORD_CLIENT_ID,
    process.env.DISCORD_APPLICATION_ID,
  ]);
  if (!applicationId) throw new Error("Missing env: DISCORD_APPLICATION_ID or DISCORD_CLIENT_ID");

  const guildId = firstNonEmpty([
    process.env.DISCORD_GUILD_ID,
    process.env.DISCORD_SERVER_GUILD_ID,
  ]);
  const appBaseUrl = firstNonEmpty([
    process.env.APP_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]).replace(/\/+$/, "");

  if (!appBaseUrl) {
    throw new Error("Missing env: APP_BASE_URL or NEXT_PUBLIC_APP_URL");
  }

  const interactionsEndpointUrl = `${appBaseUrl}/api/discord/interactions`;
  const linkedRolesVerificationUrl = `${appBaseUrl}/discord/linked-roles`;

  console.log("Registering linked role metadata...");
  await discordApi(`/applications/${applicationId}/role-connections/metadata`, {
    method: "PUT",
    body: JSON.stringify(LINKED_ROLE_METADATA),
  });

  console.log("Registering global commands...");
  await discordApi(`/applications/${applicationId}/commands`, {
    method: "PUT",
    body: JSON.stringify(COMMANDS),
  });

  if (guildId) {
    console.log(`Registering guild commands for guild ${guildId}...`);
    await discordApi(`/applications/${applicationId}/guilds/${guildId}/commands`, {
      method: "PUT",
      body: JSON.stringify(COMMANDS),
    });
  } else {
    console.log("Skipping guild command registration because DISCORD_GUILD_ID is not set.");
  }

  console.log("Updating application URLs...");
  await discordApi("/applications/@me", {
    method: "PATCH",
    body: JSON.stringify({
      interactions_endpoint_url: interactionsEndpointUrl,
      role_connections_verification_url: linkedRolesVerificationUrl,
    }),
  });

  console.log("Discord registration complete.");
  console.log("Global commands can take a little while to propagate across Discord.");
  console.log(`Interactions Endpoint URL: ${interactionsEndpointUrl}`);
  console.log(`Linked Roles Verification URL: ${linkedRolesVerificationUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
