import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { enrichMatchParticipants } from "@/lib/participantProfiles";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { Match } from "@/models/match";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { gameName: string; tagLine: string; matchId: string };

type RoleSortable = {
  teamPosition?: string | null;
  riotId?: string | null;
  summonerName?: string | null;
};

type MatchParticipantRaw = {
  puuid?: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  gameName?: string;
  tagLine?: string;
  summonerName?: string;
  championId?: number;
  champLevel?: number;
  teamId?: number;
  teamPosition?: string;
  win?: boolean;
  kills?: number;
  deaths?: number;
  assists?: number;
  goldEarned?: number;
  totalDamageDealtToChampions?: number;
  visionScore?: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  perks?: {
    styles?: Array<{
      style?: number;
      selections?: Array<{ perk?: number }>;
    }>;
  };
};

type MatchInfoRaw = {
  participants?: MatchParticipantRaw[];
  queueId?: number;
  gameCreation?: number;
  gameDuration?: number;
};

type MatchDocView = {
  matchId: string;
  region?: string | null;
  queueId?: number | null;
  gameCreation?: number | null;
  gameDuration?: number | null;
  raw?: { info?: MatchInfoRaw } | null;
};

type PlayerView = {
  _id: unknown;
  puuid?: string | null;
  gameName?: string | null;
  tagLine?: string | null;
  platform?: string | null;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  solo?: Record<string, unknown> | null;
  flex?: Record<string, unknown> | null;
};

type PlayerMatchView = {
  matchId: string;
  region?: string | null;
  queueId?: number | null;
  gameCreation?: number | null;
  gameDuration?: number | null;
  championId?: number | null;
  teamId?: number | null;
  teamPosition?: string | null;
  primaryStyle?: number | null;
  primaryRune?: number | null;
  subStyle?: number | null;
  win?: boolean | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  cs?: number | null;
  gold?: number | null;
  items?: unknown[];
  summonerSpells?: unknown[];
};

function norm(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function safeDecode(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

const ROLE_ORDER: Record<string, number> = {
  TOP: 1,
  JUNGLE: 2,
  MIDDLE: 3,
  BOTTOM: 4,
  UTILITY: 5,
  NONE: 99,
};

function sortByRole(left: RoleSortable, right: RoleSortable) {
  const leftRank = ROLE_ORDER[String(left.teamPosition ?? "NONE").toUpperCase()] ?? 50;
  const rightRank = ROLE_ORDER[String(right.teamPosition ?? "NONE").toUpperCase()] ?? 50;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(left.riotId ?? left.summonerName ?? "").localeCompare(
    String(right.riotId ?? right.summonerName ?? "")
  );
}

function safeStr(value: unknown) {
  return typeof value === "string" ? value : null;
}

function safeNum(value: unknown) {
  return typeof value === "number" ? value : null;
}

function safeBool(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function buildRiotId(participant: MatchParticipantRaw) {
  const gameName = safeStr(participant.riotIdGameName) ?? safeStr(participant.gameName);
  const tagLine = safeStr(participant.riotIdTagline) ?? safeStr(participant.tagLine);
  if (!gameName || !tagLine) return null;
  return `${gameName}#${tagLine}`;
}

function participantSummary(participant: MatchParticipantRaw, mePuuidLower: string | null) {
  const puuid = safeStr(participant.puuid);
  const isMe = !!(mePuuidLower && puuid && puuid.toLowerCase() === mePuuidLower);
  const styles = Array.isArray(participant.perks?.styles) ? participant.perks.styles : [];
  const items = [
    participant.item0,
    participant.item1,
    participant.item2,
    participant.item3,
    participant.item4,
    participant.item5,
    participant.item6,
  ].filter((value): value is number => typeof value === "number" && value !== 0);
  const cs =
    (typeof participant.totalMinionsKilled === "number" ? participant.totalMinionsKilled : 0) +
    (typeof participant.neutralMinionsKilled === "number" ? participant.neutralMinionsKilled : 0);

  return {
    puuid: puuid ?? null,
    isMe,
    riotId: buildRiotId(participant),
    summonerName: safeStr(participant.summonerName),
    championId: safeNum(participant.championId),
    champLevel: safeNum(participant.champLevel),
    teamId: safeNum(participant.teamId),
    teamPosition: safeStr(participant.teamPosition),
    primaryStyle: safeNum(styles[0]?.style),
    primaryRune: safeNum(styles[0]?.selections?.[0]?.perk),
    subStyle: safeNum(styles[1]?.style),
    win: safeBool(participant.win),
    kills: safeNum(participant.kills),
    deaths: safeNum(participant.deaths),
    assists: safeNum(participant.assists),
    cs: Number.isFinite(cs) ? cs : null,
    gold: safeNum(participant.goldEarned),
    damage: safeNum(participant.totalDamageDealtToChampions),
    visionScore: safeNum(participant.visionScore),
    wardsPlaced: safeNum(participant.wardsPlaced),
    wardsKilled: safeNum(participant.wardsKilled),
    summonerSpells: [participant.summoner1Id, participant.summoner2Id].filter(
      (value): value is number => typeof value === "number"
    ),
    items,
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: RouteParams | Promise<RouteParams> }
) {
  try {
    const params = await ctx.params;
    const gameNameRaw = safeDecode(params.gameName);
    const tagLineRaw = safeDecode(params.tagLine);
    const matchId = safeDecode(params.matchId).trim();

    if (!norm(gameNameRaw) || !norm(tagLineRaw) || !matchId) {
      return NextResponse.json({ ok: false, error: "Missing params" }, { status: 400 });
    }

    const includeRaw = new URL(req.url).searchParams.get("raw") === "1";

    await dbConnect();

    const player = (await Player.findOne(
      buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
      {
        _id: 1,
        puuid: 1,
        gameName: 1,
        tagLine: 1,
        platform: 1,
        profileIconId: 1,
        summonerLevel: 1,
        solo: 1,
        flex: 1,
      }
    ).lean()) as PlayerView | null;

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));
    const mePuuidLower = typeof player.puuid === "string" ? player.puuid.toLowerCase() : null;

    const my = (await PlayerMatch.findOne(
      { playerId, matchId },
      {
        matchId: 1,
        region: 1,
        queueId: 1,
        gameCreation: 1,
        gameDuration: 1,
        championId: 1,
        teamId: 1,
        teamPosition: 1,
        primaryStyle: 1,
        primaryRune: 1,
        subStyle: 1,
        win: 1,
        kills: 1,
        deaths: 1,
        assists: 1,
        cs: 1,
        gold: 1,
        items: 1,
        summonerSpells: 1,
      }
    ).lean()) as PlayerMatchView | null;

    const matchDoc = (await Match.findOne(
      { matchId },
      { matchId: 1, region: 1, queueId: 1, gameCreation: 1, gameDuration: 1, raw: 1 }
    ).lean()) as MatchDocView | null;

    if (!matchDoc?.raw?.info) {
      return NextResponse.json(
        { ok: false, error: "Match not cached yet (no raw). Refresh / load more first." },
        { status: 404 }
      );
    }

    const info = matchDoc.raw.info;
    const participantsRaw = Array.isArray(info.participants) ? info.participants : [];
    const participants = participantsRaw.map((participant) => participantSummary(participant, mePuuidLower));
    const enrichedParticipants = await enrichMatchParticipants({
      participants,
      platform: safeStr(player.platform),
      trackedSelf: player.puuid
        ? {
            puuid: String(player.puuid),
            gameName: String(player.gameName ?? ""),
            tagLine: String(player.tagLine ?? ""),
            platform: String(player.platform ?? ""),
            profileIconId: safeNum(player.profileIconId),
            summonerLevel: safeNum(player.summonerLevel),
            solo: player.solo ?? null,
            flex: player.flex ?? null,
          }
        : null,
    });

    const blue = enrichedParticipants.filter((participant) => participant.teamId === 100).sort(sortByRole);
    const red = enrichedParticipants.filter((participant) => participant.teamId === 200).sort(sortByRole);

    return NextResponse.json({
      ok: true,
      match: {
        matchId: String(matchDoc.matchId),
        region: safeStr(matchDoc.region),
        queueId: safeNum(matchDoc.queueId) ?? safeNum(info.queueId),
        gameCreation: safeNum(matchDoc.gameCreation) ?? safeNum(info.gameCreation),
        gameDuration: safeNum(matchDoc.gameDuration) ?? safeNum(info.gameDuration),
      },
      my: my
        ? {
            matchId: String(my.matchId),
            region: safeStr(my.region),
            queueId: safeNum(my.queueId),
            gameCreation: safeNum(my.gameCreation),
            gameDuration: safeNum(my.gameDuration),
            championId: safeNum(my.championId),
            teamId: safeNum(my.teamId),
            teamPosition: safeStr(my.teamPosition),
            win: safeBool(my.win),
            kills: safeNum(my.kills),
            deaths: safeNum(my.deaths),
            assists: safeNum(my.assists),
            cs: safeNum(my.cs),
            gold: safeNum(my.gold),
            items: Array.isArray(my.items)
              ? my.items.filter((value): value is number => typeof value === "number")
              : [],
            summonerSpells: Array.isArray(my.summonerSpells)
              ? my.summonerSpells.filter((value): value is number => typeof value === "number")
              : [],
            primaryStyle: safeNum(my.primaryStyle),
            primaryRune: safeNum(my.primaryRune),
            subStyle: safeNum(my.subStyle),
          }
        : null,
      teams: { blue, red },
      raw: includeRaw ? matchDoc.raw : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
