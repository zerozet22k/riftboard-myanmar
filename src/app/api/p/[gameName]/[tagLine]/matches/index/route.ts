import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";
import { Match } from "@/models/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

function safeStr(v: any) {
  return typeof v === "string" ? v : null;
}
function safeNum(v: any) {
  return typeof v === "number" ? v : null;
}
function safeBool(v: any) {
  return typeof v === "boolean" ? v : null;
}

const ROLE_ORDER: Record<string, number> = {
  TOP: 1,
  JUNGLE: 2,
  MIDDLE: 3,
  BOTTOM: 4,
  UTILITY: 5,
  NONE: 99,
};

function sortByRole(a: any, b: any) {
  const ra = ROLE_ORDER[String(a?.teamPosition ?? "NONE").toUpperCase()] ?? 50;
  const rb = ROLE_ORDER[String(b?.teamPosition ?? "NONE").toUpperCase()] ?? 50;
  if (ra !== rb) return ra - rb;
  return String(a?.riotId ?? a?.summonerName ?? "").localeCompare(String(b?.riotId ?? b?.summonerName ?? ""));
}

function buildRiotId(p: any) {
  const gn = safeStr(p?.riotIdGameName) ?? safeStr(p?.gameName);
  const tl = safeStr(p?.riotIdTagline) ?? safeStr(p?.tagLine);
  if (!gn || !tl) return null;
  return `${gn}#${tl}`;
}

function extractRunesFromParticipant(p: any) {
  const perks = p?.perks;
  const styles = Array.isArray(perks?.styles) ? perks.styles : [];

  const primaryStyle =
    typeof styles?.[0]?.style === "number" ? styles[0].style : null;

  const primaryRune =
    typeof styles?.[0]?.selections?.[0]?.perk === "number"
      ? styles[0].selections[0].perk
      : null;

  const subStyle =
    typeof styles?.[1]?.style === "number" ? styles[1].style : null;

  return { primaryStyle, primaryRune, subStyle };
}

function participantSummary(p: any, mePuuidLower: string | null) {
  const puuid = safeStr(p?.puuid);
  const isMe = !!(mePuuidLower && puuid && puuid.toLowerCase() === mePuuidLower);

  const items = [p?.item0, p?.item1, p?.item2, p?.item3, p?.item4, p?.item5, p?.item6]
    .filter((x: any) => typeof x === "number" && x !== 0);

  const cs =
    (typeof p?.totalMinionsKilled === "number" ? p.totalMinionsKilled : 0) +
    (typeof p?.neutralMinionsKilled === "number" ? p.neutralMinionsKilled : 0);

  const runes = extractRunesFromParticipant(p);

  return {
    puuid: puuid ?? null,
    isMe,

    riotId: buildRiotId(p),
    summonerName: safeStr(p?.summonerName),

    championId: safeNum(p?.championId),
    teamId: safeNum(p?.teamId),
    teamPosition: safeStr(p?.teamPosition),

    win: safeBool(p?.win),
    kills: safeNum(p?.kills),
    deaths: safeNum(p?.deaths),
    assists: safeNum(p?.assists),

    cs: Number.isFinite(cs) ? cs : null,
    gold: safeNum(p?.goldEarned),

    summonerSpells: [p?.summoner1Id, p?.summoner2Id].filter((x: any) => typeof x === "number"),
    items,

    // ✅ runes (now available for teammates too)
    primaryStyle: runes.primaryStyle,
    primaryRune: runes.primaryRune,
    subStyle: runes.subStyle,
  };
}

const ARENA_QUEUES = new Set([1700, 1710, 1720]);

export async function GET(
  req: NextRequest,
  ctx: {
    params:
      | { gameName: string; tagLine: string; matchId: string }
      | Promise<{ gameName: string; tagLine: string; matchId: string }>;
  }
) {
  try {
    const params = await ctx.params;

    const gameNameRaw = safeDecode(params?.gameName);
    const tagLineRaw = safeDecode(params?.tagLine);
    const matchId = safeDecode(params?.matchId).trim();

    const gameNameNorm = norm(gameNameRaw);
    const tagLineNorm = norm(tagLineRaw);

    if (!gameNameNorm || !tagLineNorm || !matchId) {
      return NextResponse.json({ ok: false, error: "Missing params" }, { status: 400 });
    }

    const url = new URL(req.url);
    const includeRaw = url.searchParams.get("raw") === "1";

    await dbConnect();

    const player: any = await Player.findOne(
      { gameNameNorm, tagLineNorm },
      { _id: 1, puuid: 1 }
    ).lean();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));
    const mePuuidLower = typeof player.puuid === "string" ? player.puuid.toLowerCase() : null;

    const my = await PlayerMatch.findOne(
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
    ).lean();

    const matchDoc: any = await Match.findOne(
      { matchId },
      { matchId: 1, region: 1, queueId: 1, gameCreation: 1, gameDuration: 1, raw: 1 }
    ).lean();

    if (!matchDoc?.raw?.info) {
      return NextResponse.json(
        { ok: false, error: "Match not cached yet (no raw). Refresh / load more first." },
        { status: 404 }
      );
    }

    const info = matchDoc.raw.info;
    const queueId = safeNum(matchDoc.queueId) ?? safeNum(info.queueId);
    const isArena = queueId != null && ARENA_QUEUES.has(queueId);

    const participantsRaw: any[] = Array.isArray(info.participants) ? info.participants : [];
    const participants = participantsRaw.map((p) => participantSummary(p, mePuuidLower));

    // group by teamId for every mode (arena will have multiple)
    const groupsMap = new Map<number, any[]>();
    for (const p of participants) {
      const tid = typeof p.teamId === "number" ? p.teamId : -1;
      const arr = groupsMap.get(tid) ?? [];
      arr.push(p);
      groupsMap.set(tid, arr);
    }

    const groups = Array.from(groupsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([teamId, players]) => ({
        teamId: teamId === -1 ? null : teamId,
        players: isArena ? players : players.sort(sortByRole),
      }));

    // convenience for SR
    const blue = (groupsMap.get(100) ?? []).sort(sortByRole);
    const red = (groupsMap.get(200) ?? []).sort(sortByRole);

    return NextResponse.json({
      ok: true,
      match: {
        matchId: String(matchDoc.matchId),
        region: safeStr(matchDoc.region),
        queueId,
        isArena,
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

            primaryStyle: safeNum(my.primaryStyle),
            primaryRune: safeNum(my.primaryRune),
            subStyle: safeNum(my.subStyle),

            win: safeBool(my.win),
            kills: safeNum(my.kills),
            deaths: safeNum(my.deaths),
            assists: safeNum(my.assists),
            cs: safeNum(my.cs),
            gold: safeNum(my.gold),

            items: Array.isArray(my.items) ? my.items.filter((x: any) => typeof x === "number") : [],
            summonerSpells: Array.isArray(my.summonerSpells)
              ? my.summonerSpells.filter((x: any) => typeof x === "number")
              : [],
          }
        : null,
      teams: {
        blue,
        red,
        groups, // ✅ arena-safe (and SR-safe)
      },
      raw: includeRaw ? matchDoc.raw : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 });
  }
}
