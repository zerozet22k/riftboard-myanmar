import fs from "node:fs";
import mongoose from "mongoose";

function parseEnv(filePath) {
  const map = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

const env = parseEnv(".env");
const uri = env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGODB_URI in .env");
  process.exit(1);
}

const Player = mongoose.models.PlayerTmpHardDelete ?? mongoose.model("PlayerTmpHardDelete", new mongoose.Schema({}, { strict: false, collection: "players" }));
const PlayerMatch = mongoose.models.PlayerMatchTmpHardDelete ?? mongoose.model("PlayerMatchTmpHardDelete", new mongoose.Schema({}, { strict: false, collection: "playermatches" }));
const RankEntry = mongoose.models.RankEntryTmpHardDelete ?? mongoose.model("RankEntryTmpHardDelete", new mongoose.Schema({}, { strict: false, collection: "rankentries" }));
const PlayerMastery = mongoose.models.PlayerMasteryTmpHardDelete ?? mongoose.model("PlayerMasteryTmpHardDelete", new mongoose.Schema({}, { strict: false, collection: "playermasteries" }));
const ProfileComment = mongoose.models.ProfileCommentTmpHardDelete ?? mongoose.model("ProfileCommentTmpHardDelete", new mongoose.Schema({}, { strict: false, collection: "profilecomments" }));
const DiscordLink = mongoose.models.DiscordLinkTmpHardDelete ?? mongoose.model("DiscordLinkTmpHardDelete", new mongoose.Schema({}, { strict: false, collection: "discordlinks" }));

try {
  await mongoose.connect(uri);

  const player = await Player.findOne(
    {
      gameNameNorm: "yum",
      tagLineNorm: "ggez",
    },
    { _id: 1, gameName: 1, tagLine: 1 }
  ).lean();

  if (!player?._id) {
    console.log(JSON.stringify({ ok: true, found: false }));
    process.exit(0);
  }

  const playerId = player._id;

  const [playerDelete, matchDelete, rankDelete, masteryDelete, commentDelete, discordDelete] = await Promise.all([
    Player.deleteOne({ _id: playerId }),
    PlayerMatch.deleteMany({ playerId }),
    RankEntry.deleteMany({ playerId }),
    PlayerMastery.deleteMany({ playerId }),
    ProfileComment.deleteMany({ profilePlayerId: playerId }),
    DiscordLink.deleteMany({ playerId }),
  ]);

  console.log(
    JSON.stringify({
      ok: true,
      found: true,
      player: `${player.gameName}#${player.tagLine}`,
      deleted: {
        player: playerDelete.deletedCount ?? 0,
        matches: matchDelete.deletedCount ?? 0,
        rankEntries: rankDelete.deletedCount ?? 0,
        masteryRows: masteryDelete.deletedCount ?? 0,
        profileComments: commentDelete.deletedCount ?? 0,
        discordLinks: discordDelete.deletedCount ?? 0,
      },
    })
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "hard-delete-failed");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => undefined);
}
