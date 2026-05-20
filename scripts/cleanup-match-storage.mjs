import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!uri) {
  console.error("Missing MONGODB_URI / MONGO_URI / DATABASE_URL.");
  process.exit(1);
}

const keep = Math.max(1, Math.min(200, Number(process.argv[2] ?? process.env.MATCH_RETENTION_LIMIT ?? 50) || 50));

const PlayerMatch = mongoose.model(
  "CleanupPlayerMatch",
  new mongoose.Schema({}, { strict: false, collection: "playermatches" })
);
const Match = mongoose.model("CleanupMatch", new mongoose.Schema({}, { strict: false, collection: "matches" }));
const TftPlayerMatch = mongoose.model(
  "CleanupTftPlayerMatch",
  new mongoose.Schema({}, { strict: false, collection: "tftplayermatches" })
);
const TftMatch = mongoose.model("CleanupTftMatch", new mongoose.Schema({}, { strict: false, collection: "tftmatches" }));

async function prunePlayerCollection(Model, sortField) {
  let deleted = 0;
  const groups = await Model.aggregate([
    { $sort: { playerId: 1, [sortField]: -1, _id: -1 } },
    { $group: { _id: "$playerId", ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: keep } } },
    { $project: { ids: 1 } },
  ]).allowDiskUse(true);

  for (const group of groups) {
    const dropIds = Array.isArray(group.ids) ? group.ids.slice(keep) : [];
    if (!dropIds.length) continue;
    const result = await Model.deleteMany({ _id: { $in: dropIds } });
    deleted += result.deletedCount ?? 0;
  }
  return deleted;
}

async function deleteUnreferenced(MatchModel, PlayerMatchModel) {
  const referenced = await PlayerMatchModel.distinct("matchId");
  const result = await MatchModel.deleteMany({ matchId: { $nin: referenced } });
  return result.deletedCount ?? 0;
}

await mongoose.connect(uri);
try {
  console.log(`Keeping ${keep} recent matches per player.`);
  const lolRowsDeleted = await prunePlayerCollection(PlayerMatch, "gameCreation");
  const tftRowsDeleted = await prunePlayerCollection(TftPlayerMatch, "gameDatetime");
  const lolDetailsDeleted = await deleteUnreferenced(Match, PlayerMatch);
  const tftDetailsDeleted = await deleteUnreferenced(TftMatch, TftPlayerMatch);

  console.log(
    JSON.stringify(
      {
        ok: true,
        keep,
        deleted: {
          playerMatches: lolRowsDeleted,
          tftPlayerMatches: tftRowsDeleted,
          matchDetails: lolDetailsDeleted,
          tftMatchDetails: tftDetailsDeleted,
        },
      },
      null,
      2
    )
  );
} finally {
  await mongoose.disconnect();
}
