import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { DiscordLink } from "@/models/discordLink";

let ensuredDiscordLinkIndexes = false;

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
  ensuredDiscordLinkIndexes = true;
}

export async function setPrimaryDiscordLink(discordUserId: string, linkId: unknown) {
  const normalizedDiscordUserId = String(discordUserId ?? "").trim();
  if (!normalizedDiscordUserId) return;

  await DiscordLink.updateMany(
    { discordUserId: normalizedDiscordUserId, _id: { $ne: linkId } },
    { $set: { isPrimary: false } }
  );
  await DiscordLink.updateOne(
    { _id: linkId },
    { $set: { isPrimary: true } }
  );
}

export async function findPrimaryDiscordLink(discordUserId: string) {
  await ensureDiscordLinkMultiAccountIndexes();
  return DiscordLink.findOne({ discordUserId: String(discordUserId).trim() })
    .sort({ isPrimary: -1, updatedAt: -1, _id: -1 });
}
