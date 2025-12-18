
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";
import { refreshPlayerById } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MATCH_WINDOW = 100;

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

function decodeCursor(s: string): { gc: number; id: string } | null {
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const j = JSON.parse(raw);
    if (typeof j?.gc !== "number") return null;
    if (typeof j?.id !== "string") return null;
    if (!mongoose.Types.ObjectId.isValid(j.id)) return null;
    return { gc: j.gc, id: j.id };
  } catch {
    return null;
  }
}

function encodeCursor(gc: number, id: string) {
  return Buffer.from(JSON.stringify({ gc, id })).toString("base64url");
}

function shapeMatches(docs: any[]) {
  const matches = docs.map((m: any) => ({
    _id: String(m._id),
    matchId: String(m.matchId),
    queueId: typeof m.queueId === "number" ? m.queueId : null,
    gameCreation: typeof m.gameCreation === "number" ? m.gameCreation : null,
    gameDuration: typeof m.gameDuration === "number" ? m.gameDuration : null,
    championId: typeof m.championId === "number" ? m.championId : null,
    win: typeof m.win === "boolean" ? m.win : null,
    kills: typeof m.kills === "number" ? m.kills : null,
    deaths: typeof m.deaths === "number" ? m.deaths : null,
    assists: typeof m.assists === "number" ? m.assists : null,
    cs: typeof m.cs === "number" ? m.cs : null,
    gold: typeof m.gold === "number" ? m.gold : null,
    items: Array.isArray(m.items) ? m.items.filter((x: any) => typeof x === "number") : [],
    summonerSpells: Array.isArray(m.summonerSpells)
      ? m.summonerSpells.filter((x: any) => typeof x === "number")
      : [],
  }));

  const last = docs[docs.length - 1];
  const nextCursor =
    last && typeof last.gameCreation === "number"
      ? encodeCursor(last.gameCreation, String(last._id))
      : null;

  return { matches, nextCursor };
}

export async function GET(
  req: NextRequest,
  ctx: {
    params:
    | { gameName: string; tagLine: string }
    | Promise<{ gameName: string; tagLine: string }>;
  }
) {
  try {
    const params = await ctx.params;

    const gameNameRaw = safeDecode(params?.gameName);
    const tagLineRaw = safeDecode(params?.tagLine);

    const gameNameNorm = norm(gameNameRaw);
    const tagLineNorm = norm(tagLineRaw);

    if (!gameNameNorm || !tagLineNorm) {
      return NextResponse.json({ ok: false, error: "Missing name/tag" }, { status: 400 });
    }

    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.max(1, Math.min(25, Number(limitRaw ?? 10) || 10));

    const cursorRaw = url.searchParams.get("cursor");
    const cur = cursorRaw ? decodeCursor(cursorRaw) : null;


    if (cursorRaw && !cur) {
      return NextResponse.json({ ok: false, error: "Invalid cursor" }, { status: 400 });
    }

    const autosync = url.searchParams.get("autosync") === "1";

    await dbConnect();

    const player = await Player.findOne(
      { gameNameNorm, tagLineNorm },
      { _id: 1 }
    ).lean();

    if (!player?._id) {
      return NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const playerId = new mongoose.Types.ObjectId(String(player._id));

    const buildQuery = () => {
      const q: any = { playerId };
      if (cur) {
        q.$or = [
          { gameCreation: { $lt: cur.gc } },
          { gameCreation: cur.gc, _id: { $lt: new mongoose.Types.ObjectId(cur.id) } },
        ];
      }
      return q;
    };

    async function readPage() {
      const docs = await PlayerMatch.find(
        buildQuery(),
        {
          matchId: 1,
          queueId: 1,
          gameCreation: 1,
          gameDuration: 1,
          championId: 1,
          win: 1,
          kills: 1,
          deaths: 1,
          assists: 1,
          cs: 1,
          gold: 1,
          items: 1,
          summonerSpells: 1,
        }
      )
        .sort({ gameCreation: -1, _id: -1 })
        .limit(limit)
        .lean();

      return docs;
    }


    let docs = await readPage();


    if (autosync && cursorRaw && docs.length === 0) {
      const existingCount = await PlayerMatch.countDocuments({ playerId });
      const targetCount = Math.min(MAX_MATCH_WINDOW, existingCount + limit);

      if (targetCount > existingCount) {

        await refreshPlayerById(String(player._id), {
          force: false,
          cooldownMs: 0,
          syncMatches: true,
          matchesCount: targetCount,
          fullMastery: false,
        });

        docs = await readPage();
      }
    }

    const { matches, nextCursor } = shapeMatches(docs);
    return NextResponse.json({ ok: true, matches, nextCursor });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 });
  }
}
