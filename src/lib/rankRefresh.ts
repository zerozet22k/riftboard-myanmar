import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";

const DEFAULT_FRESH_FOR_MS = 2 * 60 * 1000;
const OWNER_FAILURE_BACKOFF_MS = 5 * 60 * 1000;

type DateLike = Date | string | null | undefined;

export type RankRefreshStateLike = {
  requestedAt?: DateLike;
  startedAt?: DateLike;
  completedAt?: DateLike;
  lastAttemptAt?: DateLike;
  retryAfterAt?: DateLike;
  lastError?: string | null;
};

export type RankFreshnessLike = {
  solo?: { fetchedAt?: DateLike } | null;
  flex?: { fetchedAt?: DateLike } | null;
  rankRefresh?: RankRefreshStateLike | null;
};

function dateMs(value: DateLike) {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function claimedRequestDate(value: DateLike) {
  const timestamp = dateMs(value);
  return timestamp > 0 ? new Date(timestamp) : null;
}

export function latestLolRankFetchAt(player: RankFreshnessLike) {
  const timestamp = Math.max(
    dateMs(player.solo?.fetchedAt),
    dateMs(player.flex?.fetchedAt)
  );
  return timestamp > 0 ? new Date(timestamp) : null;
}

export function isRankRefreshPending(
  rankRefresh: RankRefreshStateLike | null | undefined
) {
  const requestedAt = dateMs(rankRefresh?.requestedAt);
  const completedAt = dateMs(rankRefresh?.completedAt);
  return requestedAt > 0 && requestedAt > completedAt;
}

export async function queuePlayerRankRefresh(
  playerId: unknown,
  options?: { freshForMs?: number; force?: boolean }
) {
  await dbConnect();
  const player = await Player.findById(
    playerId,
    {
      solo: 1,
      flex: 1,
      rankRefresh: 1,
    }
  ).lean<RankFreshnessLike | null>();
  if (!player) throw new Error("Player not found");

  const currentFetch = latestLolRankFetchAt(player);
  const pending = isRankRefreshPending(player.rankRefresh);
  if (pending) {
    return {
      queued: true,
      pending: true,
      requestedAt: player.rankRefresh?.requestedAt ?? null,
      lastRankFetchAt: currentFetch,
      retryAfterAt: null,
    };
  }

  const retryAfterTimestamp = dateMs(player.rankRefresh?.retryAfterAt);
  if (!options?.force && retryAfterTimestamp > Date.now()) {
    return {
      queued: false,
      pending: false,
      requestedAt: null,
      lastRankFetchAt: currentFetch,
      retryAfterAt: new Date(retryAfterTimestamp),
    };
  }

  const freshForMs = Math.max(
    0,
    options?.freshForMs ?? DEFAULT_FRESH_FOR_MS
  );
  if (
    !options?.force &&
    currentFetch &&
    Date.now() - currentFetch.getTime() < freshForMs
  ) {
    return {
      queued: false,
      pending: false,
      requestedAt: null,
      lastRankFetchAt: currentFetch,
      retryAfterAt: null,
    };
  }

  const requestedAt = new Date();
  await Player.updateOne(
    { _id: playerId },
    {
      $set: { "rankRefresh.requestedAt": requestedAt },
      $unset: {
        "rankRefresh.startedAt": 1,
        "rankRefresh.retryAfterAt": 1,
        "rankRefresh.lastError": 1,
      },
    }
  );

  return {
    queued: true,
    pending: true,
    requestedAt,
    lastRankFetchAt: currentFetch,
    retryAfterAt: null,
  };
}

export async function markPlayerRankRefreshStarted(
  playerId: unknown,
  requestedAt: DateLike,
  startedAt = new Date()
) {
  const claim = claimedRequestDate(requestedAt);
  if (!claim) return;
  await Player.updateOne(
    {
      _id: playerId,
      "rankRefresh.requestedAt": claim,
    },
    {
      $set: {
        "rankRefresh.startedAt": startedAt,
        "rankRefresh.lastAttemptAt": startedAt,
      },
      $unset: { "rankRefresh.lastError": 1 },
    }
  );
}

export async function markPlayerRankRefreshCompleted(
  playerId: unknown,
  requestedAt: DateLike,
  completedAt = new Date()
) {
  const claim = claimedRequestDate(requestedAt);
  if (!claim) return;
  await Player.updateOne(
    {
      _id: playerId,
      "rankRefresh.requestedAt": claim,
    },
    {
      $set: { "rankRefresh.completedAt": completedAt },
      $unset: {
        "rankRefresh.requestedAt": 1,
        "rankRefresh.startedAt": 1,
        "rankRefresh.lastError": 1,
      },
    }
  );
}

export async function markPlayerRankRefreshSucceeded(
  playerId: unknown,
  completedAt = new Date()
) {
  await Player.updateOne(
    { _id: playerId },
    {
      $set: { "rankRefresh.lastAttemptAt": completedAt },
      $unset: {
        "rankRefresh.retryAfterAt": 1,
        "rankRefresh.lastError": 1,
      },
    }
  );
}

export async function markPlayerRankRefreshSchedulerFailed(
  playerId: unknown,
  error: unknown,
  retryAfterMs = 30 * 60 * 1000
) {
  const attemptedAt = new Date();
  const retryAfterAt = new Date(
    attemptedAt.getTime() + Math.max(60_000, retryAfterMs)
  );
  const lastError = (
    error instanceof Error ? error.message : String(error ?? "Rank update failed")
  )
    .replace(/\s+/g, " ")
    .slice(0, 180);

  await Player.updateOne(
    {
      _id: playerId,
      "rankRefresh.requestedAt": { $exists: false },
    },
    {
      $set: {
        "rankRefresh.lastAttemptAt": attemptedAt,
        "rankRefresh.retryAfterAt": retryAfterAt,
        "rankRefresh.lastError": lastError || "Rank update failed",
      },
    }
  );
}

export async function markPlayerRankRefreshFailed(
  playerId: unknown,
  requestedAt: DateLike,
  error: unknown
) {
  const claim = claimedRequestDate(requestedAt);
  if (!claim) return;
  const completedAt = new Date();
  const lastError = (
    error instanceof Error ? error.message : String(error ?? "Rank update failed")
  )
    .replace(/\s+/g, " ")
    .slice(0, 180);
  await Player.updateOne(
    {
      _id: playerId,
      "rankRefresh.requestedAt": claim,
    },
    {
      $set: {
        "rankRefresh.completedAt": completedAt,
        "rankRefresh.lastAttemptAt": completedAt,
        "rankRefresh.retryAfterAt": new Date(
          completedAt.getTime() + OWNER_FAILURE_BACKOFF_MS
        ),
        "rankRefresh.lastError": lastError || "Rank update failed",
      },
      $unset: {
        "rankRefresh.requestedAt": 1,
        "rankRefresh.startedAt": 1,
      },
    }
  );
}
