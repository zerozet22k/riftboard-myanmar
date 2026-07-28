import { revalidatePath } from "next/cache";
import { after, NextRequest, NextResponse } from "next/server";
import {
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import { getOptionalDiscordSessionFromRequest } from "@/lib/discordSession";
import { dbConnect } from "@/lib/mongodb";
import {
  canonicalPlayerPath,
  buildPlayerLookupQuery,
} from "@/lib/playerIdentity";
import {
  isRankRefreshPending,
  latestLolRankFetchAt,
  markPlayerRankRefreshFailed,
  queuePlayerRankRefresh,
} from "@/lib/rankRefresh";
import { refreshPlayerById } from "@/lib/refresh";
import { isRiot429 } from "@/lib/riot";
import {
  RiotRefreshBusyError,
  withRiotRefreshLease,
} from "@/lib/schedulerLease";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { gameName: string; tagLine: string };

function safeDecode(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}

async function loadPlayer(params: Promise<Params>) {
  const { gameName, tagLine } = await params;
  const gameNameRaw = safeDecode(gameName).trim();
  const tagLineRaw = safeDecode(tagLine).trim();
  if (!gameNameRaw || !tagLineRaw) return null;

  await dbConnect();
  return Player.findOne(
    buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
    {
      _id: 1,
      gameName: 1,
      tagLine: 1,
      solo: 1,
      flex: 1,
      rankRefresh: 1,
    }
  ).lean();
}

function statusPayload(
  player: NonNullable<Awaited<ReturnType<typeof loadPlayer>>>
) {
  const lastRankFetchAt = latestLolRankFetchAt(player);
  return {
    ok: true,
    pending: isRankRefreshPending(player.rankRefresh),
    lastRankFetchAt: lastRankFetchAt?.toISOString() ?? null,
    error: player.rankRefresh?.lastError
      ? "The rank update could not finish. Try again."
      : null,
  };
}

function noStoreJson(
  body: Record<string, unknown>,
  init?: { status?: number; headers?: Record<string, string> }
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}

function retryAfterSeconds(error: unknown, fallbackSeconds: number) {
  const retryAfterMs = Number(
    (error as { retryAfterMs?: unknown } | null)?.retryAfterMs
  );
  return Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.max(5, Math.ceil(retryAfterMs / 1000))
    : fallbackSeconds;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  const player = await loadPlayer(params);
  if (!player?._id) {
    return noStoreJson(
      { ok: false, error: "Player not found" },
      { status: 404 }
    );
  }
  return noStoreJson(statusPayload(player));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  const session = await getOptionalDiscordSessionFromRequest(req);
  if (!session?.discordUserId) {
    return noStoreJson(
      { ok: false, error: "Sign in with Discord to refresh your rank." },
      { status: 401 }
    );
  }

  const player = await loadPlayer(params);
  if (!player?._id) {
    return noStoreJson(
      { ok: false, error: "Player not found" },
      { status: 404 }
    );
  }

  const link = await DiscordLink.findOne(
    {
      discordUserId: session.discordUserId,
      playerId: player._id,
      verifiedBinding: true,
    },
    { _id: 1, isPrimary: 1 }
  ).lean<{ _id: unknown; isPrimary?: boolean } | null>();
  if (!link?._id) {
    return noStoreJson(
      {
        ok: false,
        error: "Connect this Riot account to your Discord login first.",
      },
      { status: 403 }
    );
  }

  const queued = await queuePlayerRankRefresh(player._id);
  if (queued.retryAfterAt) {
    const retryAfter = Math.max(
      5,
      Math.ceil((queued.retryAfterAt.getTime() - Date.now()) / 1000)
    );
    return noStoreJson(
      {
        ok: false,
        refreshed: false,
        pending: false,
        error: "Please wait a few minutes before trying this rank update again.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }
  if (!queued.pending) {
    return noStoreJson({
      ...statusPayload(player),
      refreshed: false,
      pending: false,
    });
  }

  try {
    const refreshed = await withRiotRefreshLease(() =>
      refreshPlayerById(String(player._id), {
        force: true,
        cooldownMs: 0,
        syncMatches: false,
        syncTftMatches: false,
        syncMastery: false,
        fullMastery: false,
      })
    );

    const canonicalPath = canonicalPlayerPath(
      refreshed.gameName,
      refreshed.tagLine
    );
    revalidatePath("/");
    revalidatePath("/leaderboard");
    revalidatePath("/discord/linked-roles");
    revalidatePath(canonicalPath);

    if (link.isPrimary) {
      const linkId = String(link._id);
      after(async () => {
        await Promise.allSettled([
          syncDiscordLinkedRoleForStoredLink(linkId, { force: true }),
          syncDiscordGuildRankRoleForStoredLink(linkId, { force: true }),
        ]);
      });
    }

    return noStoreJson({
      ok: true,
      refreshed: true,
      pending: false,
      canonicalPath,
      lastRankFetchAt: latestLolRankFetchAt(refreshed)?.toISOString() ?? null,
      error: null,
    });
  } catch (error) {
    const busy = error instanceof RiotRefreshBusyError;
    const rateLimited = isRiot429(error);
    if (busy || rateLimited) {
      const retryAfter = rateLimited
        ? retryAfterSeconds(error, 120)
        : error instanceof RiotRefreshBusyError
          ? error.retryAfterSeconds
          : 60;
      return noStoreJson(
        {
          ok: true,
          refreshed: false,
          pending: true,
          message: "Rank update queued.",
        },
        {
          status: 202,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }

    await markPlayerRankRefreshFailed(
      player._id,
      queued.requestedAt,
      error
    );
    console.error(
      "[rank/refresh] owner refresh failed",
      error instanceof Error ? error.name : "UnknownError"
    );
    return noStoreJson(
      {
        ok: false,
        pending: false,
        error: "The rank update could not finish. Try again.",
      },
      { status: 503 }
    );
  }
}
