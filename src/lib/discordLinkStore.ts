import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { DiscordLink } from "@/models/discordLink";

let ensuredDiscordLinkIndexes = false;
const VERIFIED_LINK_SOURCES = ["discord_connections", "riot_rso", "legacy_manual"] as const;

function normalizeDiscordUserId(discordUserId: string) {
  return String(discordUserId ?? "").trim();
}

function normalizedLinkId(linkId: unknown) {
  const value = String(linkId ?? "").trim();
  return mongoose.isValidObjectId(value) ? value : null;
}

function verifiedLinkFilter(discordUserId: string) {
  return {
    discordUserId,
    verifiedBinding: true,
    verificationSource: { $in: VERIFIED_LINK_SOURCES },
  };
}

export async function ensureDiscordLinkMultiAccountIndexes() {
  if (ensuredDiscordLinkIndexes) return;

  await dbConnect();
  const collection = mongoose.connection.db?.collection(DiscordLink.collection.name);
  if (!collection) return;

  const indexes = await collection.indexes();
  const discordUserIdIndex = indexes.find((index) => index.name === "discordUserId_1");
  if (discordUserIdIndex?.unique) {
    await collection.dropIndex("discordUserId_1").catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/index not found/i.test(message)) throw error;
    });
  }

  await collection.createIndex({ discordUserId: 1 });
  await collection.createIndex({ discordUserId: 1, isPrimary: -1, updatedAt: -1 });
  await collection.createIndex({ discordUserId: 1, playerId: 1 }, { unique: true });
  await collection.createIndex({ playerId: 1, updatedAt: -1 });
  await collection.createIndex(
    { playerId: 1 },
    {
      unique: true,
      partialFilterExpression: { verifiedBinding: true },
      name: "verified_player_owner_unique",
    }
  );
  await collection.createIndex(
    { discordUserId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        verifiedBinding: true,
        isPrimary: true,
      },
      name: "verified_primary_per_discord_unique",
    }
  );
  ensuredDiscordLinkIndexes = true;
}

export async function setPrimaryDiscordLink(discordUserId: string, linkId: unknown) {
  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
  const normalizedId = normalizedLinkId(linkId);
  if (!normalizedDiscordUserId || !normalizedId) return null;

  await ensureDiscordLinkMultiAccountIndexes();
  const selected = await DiscordLink.findOne({
    ...verifiedLinkFilter(normalizedDiscordUserId),
    _id: normalizedId,
  });
  if (!selected?._id) return null;

  await DiscordLink.updateMany(
    { discordUserId: normalizedDiscordUserId, _id: { $ne: selected._id }, isPrimary: true },
    { $set: { isPrimary: false } }
  );
  const updated = await DiscordLink.findOneAndUpdate(
    {
      ...verifiedLinkFilter(normalizedDiscordUserId),
      _id: selected._id,
    },
    { $set: { isPrimary: true } },
    { new: true }
  ).catch(async (error: unknown) => {
    await ensurePrimaryDiscordLink(normalizedDiscordUserId).catch(() => null);
    throw error;
  });
  if (updated?._id) return updated;

  await ensurePrimaryDiscordLink(normalizedDiscordUserId);
  return null;
}

export async function findPrimaryDiscordLink(discordUserId: string) {
  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
  if (!normalizedDiscordUserId) return null;

  await ensureDiscordLinkMultiAccountIndexes();
  const current = await DiscordLink.findOne({
    ...verifiedLinkFilter(normalizedDiscordUserId),
    isPrimary: true,
  }).sort({ updatedAt: -1, _id: -1 });
  return current ?? ensurePrimaryDiscordLink(normalizedDiscordUserId);
}

export async function findOwnedVerifiedDiscordLink(discordUserId: string, linkId: unknown) {
  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
  const normalizedId = normalizedLinkId(linkId);
  if (!normalizedDiscordUserId || !normalizedId) return null;

  await ensureDiscordLinkMultiAccountIndexes();
  return DiscordLink.findOne({
    ...verifiedLinkFilter(normalizedDiscordUserId),
    _id: normalizedId,
  });
}

export async function assertPlayerLinkAvailable(
  discordUserId: string,
  playerId: unknown
) {
  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
  if (!normalizedDiscordUserId || !playerId) {
    throw new Error("invalid-discord-link");
  }

  await ensureDiscordLinkMultiAccountIndexes();
  const existingOwner = await DiscordLink.exists({
    playerId,
    discordUserId: { $ne: normalizedDiscordUserId },
    verifiedBinding: true,
  });
  if (existingOwner) {
    throw new Error("riot-account-already-linked");
  }
}

export async function ensurePrimaryDiscordLink(discordUserId: string) {
  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
  if (!normalizedDiscordUserId) return null;

  await ensureDiscordLinkMultiAccountIndexes();
  const current = await DiscordLink.findOne({
    ...verifiedLinkFilter(normalizedDiscordUserId),
    isPrimary: true,
  }).sort({ updatedAt: -1, _id: -1 });

  if (current?._id) {
    await DiscordLink.updateMany(
      {
        discordUserId: normalizedDiscordUserId,
        _id: { $ne: current._id },
        isPrimary: true,
      },
      { $set: { isPrimary: false } }
    );
    return current;
  }

  const fallback = await DiscordLink.findOne(
    verifiedLinkFilter(normalizedDiscordUserId)
  ).sort({ updatedAt: -1, _id: -1 });

  await DiscordLink.updateMany(
    { discordUserId: normalizedDiscordUserId, isPrimary: true },
    { $set: { isPrimary: false } }
  );
  if (!fallback?._id) return null;

  return DiscordLink.findOneAndUpdate(
    {
      ...verifiedLinkFilter(normalizedDiscordUserId),
      _id: fallback._id,
    },
    { $set: { isPrimary: true } },
    { new: true }
  );
}

export async function removeOwnedDiscordLink(discordUserId: string, linkId: unknown) {
  const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
  const normalizedId = normalizedLinkId(linkId);
  if (!normalizedDiscordUserId || !normalizedId) return null;

  await ensureDiscordLinkMultiAccountIndexes();
  const removed = await DiscordLink.findOneAndDelete({
    _id: normalizedId,
    discordUserId: normalizedDiscordUserId,
  });
  if (!removed?._id) return null;

  const primary = await ensurePrimaryDiscordLink(normalizedDiscordUserId);
  return { removed, primary };
}
