import mongoose from "mongoose";
import { sendDiscordChannelMessage } from "@/lib/discord";
import { getLatestDdragonVersion } from "@/lib/ddragon";
import { dbConnect } from "@/lib/mongodb";
import { getAppBaseUrl } from "@/lib/runtimeConfig";
import { findActiveGameByPuuid, isRiot404 } from "@/lib/riot";
import { canonicalPlayerPath } from "@/lib/playerIdentity";
import { DiscordLink } from "@/models/discordLink";
import { LiveGamePost } from "@/models/liveGamePost";
import { Player } from "@/models/player";

const DEFAULT_LIVE_CHANNEL_ID = "1504353915091681360";
const CHAMPION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ChampionInfo = {
  name: string;
  imageFull: string;
};

type ChampionDataDragon = {
  data?: Record<string, { key?: string; name?: string; image?: { full?: string } }>;
};

let championCache:
  | {
      version: string;
      loadedAt: number;
      byKey: Map<string, ChampionInfo>;
    }
  | null = null;

function liveChannelId() {
  return String(process.env.DISCORD_LIVE_GAMES_CHANNEL_ID ?? DEFAULT_LIVE_CHANNEL_ID).trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queueName(queueId: number | undefined) {
  if (queueId === 420) return "Ranked Solo/Duo";
  if (queueId === 440) return "Ranked Flex";
  if (queueId === 400) return "Draft Pick";
  if (queueId === 430) return "Blind Pick";
  if (queueId === 450) return "ARAM";
  if (queueId === 1700) return "Arena";
  if (queueId === 0 || queueId == null) return "Custom";
  return `Queue ${queueId}`;
}

function formatDuration(seconds: number | undefined) {
  const safe = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

async function getChampionMap() {
  const version = await getLatestDdragonVersion();
  const now = Date.now();
  if (championCache?.version === version && now - championCache.loadedAt < CHAMPION_CACHE_TTL_MS) {
    return championCache.byKey;
  }

  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`, {
    next: { revalidate: 24 * 60 * 60 },
  });
  if (!res.ok) throw new Error(`Failed to fetch champion data (${res.status})`);

  const json = (await res.json()) as ChampionDataDragon;
  const byKey = new Map<string, ChampionInfo>();
  for (const champion of Object.values(json.data ?? {})) {
    const key = String(champion.key ?? "").trim();
    if (!key) continue;
    byKey.set(key, {
      name: champion.name ?? `Champion ${key}`,
      imageFull: champion.image?.full ?? `${key}.png`,
    });
  }

  championCache = { version, loadedAt: now, byKey };
  return byKey;
}

function championName(champions: Map<string, ChampionInfo>, championId: number | undefined) {
  if (championId == null) return "Unknown";
  return champions.get(String(championId))?.name ?? `Champion ${championId}`;
}

function championIconUrl(version: string, champions: Map<string, ChampionInfo>, championId: number | undefined) {
  if (championId == null) return null;
  const info = champions.get(String(championId));
  if (!info?.imageFull) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${info.imageFull}`;
}

type LivePlayer = {
  _id: unknown;
  gameName: string;
  tagLine: string;
  platform?: string | null;
  puuid?: string | null;
};

function compactRiotId(player: Pick<LivePlayer, "gameName" | "tagLine">) {
  return `${player.gameName}#${player.tagLine}`;
}

function buildLiveGameMessage(input: {
  platform: string;
  game: NonNullable<Awaited<ReturnType<typeof findActiveGameByPuuid>>>["game"];
  players: LivePlayer[];
  champions: Map<string, ChampionInfo>;
  ddragonVersion: string;
}) {
  const title = `Live now: ${queueName(input.game.gameQueueConfigId)} on ${input.platform.toUpperCase()}`;
  const started = input.game.gameStartTime ? `<t:${Math.floor(input.game.gameStartTime / 1000)}:R>` : "now";
  const tracked = input.players
    .slice(0, 6)
    .map((player) => {
      const participant = input.game.participants.find((p) => p.puuid && player.puuid && p.puuid === player.puuid);
      const champion = championName(input.champions, participant?.championId);
      const url = `${getAppBaseUrl()}${canonicalPlayerPath(player.gameName, player.tagLine)}`;
      return `• [${compactRiotId(player)}](${url}) - ${champion}`;
    })
    .join("\n");

  const teamLines = [100, 200]
    .map((teamId) => {
      const names = input.game.participants
        .filter((participant) => participant.teamId === teamId)
        .slice(0, 5)
        .map((participant) => championName(input.champions, participant.championId))
        .join(", ");
      return names ? `Team ${teamId === 100 ? "Blue" : "Red"}: ${names}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const firstTracked = input.players[0];
  const firstParticipant = input.game.participants.find((p) => p.puuid && firstTracked?.puuid && p.puuid === firstTracked.puuid);
  const icon = championIconUrl(input.ddragonVersion, input.champions, firstParticipant?.championId);

  return [
    `**${title}**`,
    `Game ${input.game.gameId} - ${formatDuration(input.game.gameLength)} - started ${started}`,
    "",
    tracked,
    "",
    teamLines,
    icon ? `\n${icon}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function publishLiveGamesToDiscord(opts?: {
  channelId?: string;
  limit?: number;
  delayMs?: number;
}) {
  await dbConnect();

  const channelId = String(opts?.channelId ?? liveChannelId()).trim();
  if (!channelId) throw new Error("Missing Discord live channel ID.");

  const limit = Math.max(1, Math.min(200, Math.floor(Number(opts?.limit ?? 80) || 80)));
  const delayMs = Math.max(0, Math.min(5000, Math.floor(Number(opts?.delayMs ?? 350) || 0)));
  const now = new Date();
  const verifiedLinks = await DiscordLink.find(
    {
      verifiedBinding: true,
      verificationSource: { $in: ["discord_connections", "riot_rso", "legacy_manual"] },
    },
    { playerId: 1 }
  ).lean();
  const linkedPlayerIds = verifiedLinks
    .map((link) => String(link.playerId ?? "").trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const approvedFilter = {
    puuid: { $type: "string" as const, $ne: "" },
    "leaderboard.group": "burmese",
    "leaderboard.status": "approved",
    "track.lol": { $ne: false },
  };

  const linkedPlayers = linkedPlayerIds.length
    ? await Player.find(
        {
          _id: { $in: linkedPlayerIds },
          puuid: { $type: "string" as const, $ne: "" },
          "track.lol": { $ne: false },
        },
        { gameName: 1, tagLine: 1, platform: 1, puuid: 1 }
      )
        .sort({ lastRefreshAt: -1, updatedAt: -1 })
        .limit(limit)
        .lean<LivePlayer[]>()
    : [];
  const linkedIds = new Set(linkedPlayers.map((player) => String(player._id ?? "")));
  const remaining = Math.max(0, limit - linkedPlayers.length);
  const approvedPlayers = remaining
    ? await Player.find(
        linkedIds.size
          ? {
              ...approvedFilter,
              _id: { $nin: [...linkedIds].map((id) => new mongoose.Types.ObjectId(id)) },
            }
          : approvedFilter,
        { gameName: 1, tagLine: 1, platform: 1, puuid: 1 }
      )
        .sort({ lastRefreshAt: -1, updatedAt: -1 })
        .limit(remaining)
        .lean<LivePlayer[]>()
    : [];
  const players = [...linkedPlayers, ...approvedPlayers];

  const games = new Map<
    string,
    {
      platform: string;
      game: NonNullable<Awaited<ReturnType<typeof findActiveGameByPuuid>>>["game"];
      players: LivePlayer[];
    }
  >();
  const errors: string[] = [];
  let checked = 0;
  let active = 0;

  for (const player of players) {
    const puuid = String(player.puuid ?? "").trim();
    if (!puuid) continue;
    checked++;

    try {
      const found = await findActiveGameByPuuid(puuid, player.platform);
      if (!found?.game?.gameId) {
        if (delayMs) await sleep(delayMs);
        continue;
      }

      active++;
      const key = `${found.platform}:${found.game.gameId}`;
      const existing = games.get(key);
      if (existing) {
        existing.players.push(player);
      } else {
        const trackedPuuids = new Set(players.map((candidate) => String(candidate.puuid ?? "").trim()).filter(Boolean));
        const playersInGame = players.filter((candidate) =>
          found.game.participants.some(
            (participant) => participant.puuid && participant.puuid === String(candidate.puuid ?? "").trim() && trackedPuuids.has(participant.puuid)
          )
        );
        games.set(key, {
          platform: found.platform,
          game: found.game,
          players: playersInGame.length ? playersInGame : [player],
        });
      }
    } catch (error) {
      if (!isRiot404(error)) {
        errors.push(`${compactRiotId(player)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (delayMs) await sleep(delayMs);
  }

  const champions = await getChampionMap().catch(() => new Map<string, ChampionInfo>());
  const ddragonVersion = await getLatestDdragonVersion().catch(() => "latest");
  let posted = 0;
  let skipped = 0;

  for (const item of games.values()) {
    const playerIds = item.players
      .map((player) => {
        const id = String(player._id ?? "").trim();
        return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
      })
      .filter((id): id is mongoose.Types.ObjectId => !!id);
    const riotIds = item.players.map(compactRiotId);

    const existing = await LiveGamePost.findOne({
      channelId,
      platform: item.platform,
      gameId: item.game.gameId,
    }).lean();

    if (existing?.messageId) {
      skipped++;
      await LiveGamePost.updateOne(
        { channelId, platform: item.platform, gameId: item.game.gameId },
        { $set: { lastSeenAt: now, playerIds, riotIds } }
      );
      continue;
    }

    try {
      const sent = await sendDiscordChannelMessage({
        channelId,
        content: buildLiveGameMessage({
          platform: item.platform,
          game: item.game,
          players: item.players,
          champions,
          ddragonVersion,
        }),
      });
      posted++;
      await LiveGamePost.updateOne(
        { channelId, platform: item.platform, gameId: item.game.gameId },
        {
          $set: {
            playerIds,
            riotIds,
            lastSeenAt: now,
            messageId: typeof sent.id === "string" ? sent.id : null,
            postedAt: new Date(),
            error: null,
          },
          $setOnInsert: {
            channelId,
            platform: item.platform,
            gameId: item.game.gameId,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      await LiveGamePost.updateOne(
        { channelId, platform: item.platform, gameId: item.game.gameId },
        {
          $set: {
            playerIds,
            riotIds,
            lastSeenAt: now,
            error: error instanceof Error ? error.message : String(error),
          },
          $setOnInsert: {
            channelId,
            platform: item.platform,
            gameId: item.game.gameId,
          },
        },
        { upsert: true }
      );
      errors.push(`Discord post ${item.platform}:${item.game.gameId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    checked,
    active,
    games: games.size,
    posted,
    skipped,
    errors,
  };
}
