import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { Client, GatewayIntentBits } from "discord.js";

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

function appBaseUrl() {
  return firstNonEmpty([process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_URL]).replace(/\/+$/, "");
}

function bindRoleName() {
  return firstNonEmpty([process.env.DISCORD_BIND_ROLE_NAME]) || "Riftboard: Bind Riot";
}

function bindRoleColor() {
  const raw = firstNonEmpty([process.env.DISCORD_BIND_ROLE_COLOR]) || "5865F2";
  const parsed = Number.parseInt(raw.replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x5865f2;
}

function verifiedRoleName() {
  return firstNonEmpty([process.env.DISCORD_VERIFIED_ROLE_NAME]) || "Riftboarded";
}

function verifiedRoleColor() {
  const raw = firstNonEmpty([process.env.DISCORD_VERIFIED_ROLE_COLOR]) || "2ECC71";
  const parsed = Number.parseInt(raw.replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : 0x2ecc71;
}

function bindMessage() {
  const linkedRolesUrl = `${appBaseUrl()}/discord/linked-roles`;
  return [
    "**Welcome to Riftboard Myanmar.**",
    `You have the **${bindRoleName()}** role because your Riot account is not linked yet.`,
    `Bind here: ${linkedRolesUrl}`,
    "After linking, the bind role is removed and your rank roles can sync.",
  ].join("\n");
}

const DiscordLink =
  mongoose.models.DiscordLinkWorker ??
  mongoose.model(
    "DiscordLinkWorker",
    new mongoose.Schema(
      {
        discordUserId: { type: String, index: true },
        playerId: mongoose.Schema.Types.ObjectId,
        verifiedBinding: Boolean,
        verificationSource: String,
      },
      { collection: "discordlinks", strict: false }
    )
  );

const Player =
  mongoose.models.PlayerWorker ??
  mongoose.model(
    "PlayerWorker",
    new mongoose.Schema({}, { collection: "players", strict: false })
  );

async function isVerifiedApprovedMember(discordUserId) {
  const link = await DiscordLink.findOne(
    {
      discordUserId: String(discordUserId).trim(),
      verifiedBinding: true,
      verificationSource: "discord_connections",
    },
    { playerId: 1 }
  ).lean();
  if (!link?.playerId) return false;

  const player = await Player.findOne(
    {
      _id: link.playerId,
      "leaderboard.status": "approved",
      $or: [{ "leaderboard.group": "burmese" }, { "leaderboard.group": null }],
    },
    { _id: 1 }
  ).lean();

  return !!player?._id;
}

async function ensureBindRole(guild) {
  const roles = await guild.roles.fetch();
  const existing = roles.find((role) => role.name === bindRoleName());
  if (existing) return existing;

  return guild.roles.create({
    name: bindRoleName(),
    color: bindRoleColor(),
    mentionable: false,
    hoist: false,
    reason: "Create Riftboard bind role",
  });
}

async function ensureVerifiedRole(guild) {
  const roles = await guild.roles.fetch();
  const existing = roles.find((role) => role.name === verifiedRoleName());
  if (existing) return existing;

  return guild.roles.create({
    name: verifiedRoleName(),
    color: verifiedRoleColor(),
    mentionable: false,
    hoist: false,
    reason: "Create Riftboard verified member role",
  });
}

async function reconcileJoinedMember(member) {
  if (member.user.bot) return;

  const role = await ensureBindRole(member.guild);
  const verifiedRole = await ensureVerifiedRole(member.guild);
  const verified = await isVerifiedApprovedMember(member.id);

  if (verified) {
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, "Remove Riftboard bind role from verified member");
      console.log(`[discord-worker] removed bind role from verified member ${member.id}`);
    }
    if (!member.roles.cache.has(verifiedRole.id)) {
      await member.roles.add(verifiedRole, "Assign Riftboard verified role to linked member");
      console.log(`[discord-worker] added verified role to member ${member.id}`);
    }
    return;
  }

  if (member.roles.cache.has(verifiedRole.id)) {
    await member.roles.remove(verifiedRole, "Remove Riftboard verified role from unlinked member");
    console.log(`[discord-worker] removed verified role from unlinked member ${member.id}`);
  }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, "Assign Riftboard bind role to new unlinked member");
    console.log(`[discord-worker] added bind role to new member ${member.id}`);
  }

  try {
    await member.send(bindMessage());
  } catch (error) {
    console.warn(`[discord-worker] could not DM ${member.id}:`, error instanceof Error ? error.message : error);
  }
}

async function main() {
  loadDotEnv();

  const mongoUri = mustEnv("MONGODB_URI");
  const guildId = firstNonEmpty([process.env.DISCORD_GUILD_ID, process.env.DISCORD_SERVER_GUILD_ID]);
  if (!guildId) throw new Error("Missing env: DISCORD_GUILD_ID");
  if (!appBaseUrl()) throw new Error("Missing env: APP_BASE_URL or NEXT_PUBLIC_APP_URL");

  await mongoose.connect(mongoUri);
  console.log("[discord-worker] connected to MongoDB");

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once("ready", async () => {
    console.log(`[discord-worker] ready as ${client.user?.tag ?? client.user?.id}`);
    const guild = await client.guilds.fetch(guildId);
    await ensureBindRole(guild);
    await ensureVerifiedRole(guild);
    console.log(`[discord-worker] watching joins in guild ${guildId}`);
  });

  client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== guildId) return;
    try {
      await reconcileJoinedMember(member);
    } catch (error) {
      console.error(
        `[discord-worker] failed to handle new member ${member.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  });

  process.once("SIGINT", async () => {
    console.log("[discord-worker] shutting down");
    client.destroy();
    await mongoose.disconnect();
    process.exit(0);
  });

  process.once("SIGTERM", async () => {
    console.log("[discord-worker] shutting down");
    client.destroy();
    await mongoose.disconnect();
    process.exit(0);
  });

  await client.login(mustEnv("DISCORD_BOT_TOKEN"));
}

main().catch(async (error) => {
  console.error("[discord-worker]", error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
