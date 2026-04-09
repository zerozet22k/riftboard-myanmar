import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDiscordSessionFromRequest } from "@/lib/discordSession";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import {
  PROFILE_COMMENT_MAX_LENGTH,
  serializeProfileComment,
  type StoredProfileComment,
} from "@/lib/profileComments";
import { Player } from "@/models/player";
import { ProfileComment } from "@/models/profileComment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateProfileCommentSchema = z.object({
  body: z.string().trim().min(1).max(PROFILE_COMMENT_MAX_LENGTH),
});

type Params = { gameName: string; tagLine: string };

type ResolvedProfile = {
  _id: mongoose.Types.ObjectId;
  gameName: string;
  tagLine: string;
};

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

async function resolveProfileTarget(params: Params) {
  const gameNameRaw = safeDecode(params?.gameName).trim();
  const tagLineRaw = safeDecode(params?.tagLine).trim().toLowerCase();

  if (!gameNameRaw || !tagLineRaw) {
    return {
      player: null,
      error: NextResponse.json({ ok: false, error: "Missing name/tag" }, { status: 400 }),
    };
  }

  await dbConnect();

  const player = await Player.findOne(
    buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
    { _id: 1, gameName: 1, tagLine: 1 }
  ).lean<ResolvedProfile | null>();

  if (!player?._id) {
    return {
      player: null,
      error: NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 }),
    };
  }

  return { player, error: null };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const resolved = await resolveProfileTarget(await params);
    if (resolved.error || !resolved.player) {
      return resolved.error ?? NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }
    const player = resolved.player;

    const comments = await ProfileComment.find(
      { profilePlayerId: player._id },
      {
        authorDiscordUsername: 1,
        authorGameName: 1,
        authorTagLine: 1,
        body: 1,
        createdAt: 1,
      }
    )
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .lean<StoredProfileComment[]>();

    return NextResponse.json({
      ok: true,
      comments: comments.map(serializeProfileComment),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load comments";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireDiscordSessionFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const parsed = CreateProfileCommentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid comment" }, { status: 400 });
    }

    const resolved = await resolveProfileTarget(await params);
    if (resolved.error || !resolved.player) {
      return resolved.error ?? NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }
    const player = resolved.player;

    const created = await ProfileComment.create({
      profilePlayerId: player._id,
      authorDiscordUserId: session.discordUserId,
      authorDiscordUsername: session.discordUsername ?? session.discordUserId,
      authorGameName: session.gameName,
      authorTagLine: session.tagLine,
      body: parsed.data.body,
    });

    revalidatePath(canonicalPlayerPath(player.gameName, player.tagLine));

    return NextResponse.json({
      ok: true,
      comment: serializeProfileComment({
        _id: created._id,
        authorDiscordUsername: created.authorDiscordUsername,
        authorGameName: created.authorGameName,
        authorTagLine: created.authorTagLine,
        body: created.body,
        createdAt: created.createdAt,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save comment";
    return NextResponse.json(
      { ok: false, error: message },
      { status: /Connect Discord|Join the Riftboard Discord server/i.test(message) ? 401 : 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireDiscordSessionFromRequest(req);
    const resolved = await resolveProfileTarget(await params);
    if (resolved.error || !resolved.player) {
      return resolved.error ?? NextResponse.json({ ok: false, error: "Player not found" }, { status: 404 });
    }
    const player = resolved.player;

    if (session.playerId !== String(player._id)) {
      return NextResponse.json(
        { ok: false, error: "Only the profile owner can remove comments." },
        { status: 403 }
      );
    }

    const commentId = String(req.nextUrl.searchParams.get("commentId") ?? "").trim();
    if (!commentId || !mongoose.isValidObjectId(commentId)) {
      return NextResponse.json({ ok: false, error: "Invalid comment id" }, { status: 400 });
    }

    const deleted = await ProfileComment.findOneAndDelete({
      _id: commentId,
      profilePlayerId: player._id,
    });

    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Comment not found" }, { status: 404 });
    }

    revalidatePath(canonicalPlayerPath(player.gameName, player.tagLine));

    return NextResponse.json({ ok: true, commentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete comment";
    return NextResponse.json(
      { ok: false, error: message },
      { status: /Connect Discord|Join the Riftboard Discord server/i.test(message) ? 401 : 500 }
    );
  }
}
