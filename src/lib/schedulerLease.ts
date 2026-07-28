import { randomUUID } from "node:crypto";
import { dbConnect } from "@/lib/mongodb";
import { SchedulerLease } from "@/models/schedulerLease";

export type SchedulerLeaseHandle = {
  name: string;
  owner: string;
  leaseUntil: Date;
};

export class RiotRefreshBusyError extends Error {
  readonly retryAfterSeconds = 60;

  constructor() {
    super("Another Riot data refresh is already running. Please try again shortly.");
    this.name = "RiotRefreshBusyError";
  }
}

function isDuplicateKey(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Number((error as { code?: unknown }).code) === 11000
  );
}

export async function acquireSchedulerLease(
  name: string,
  ttlMs = 60 * 60 * 1000
): Promise<SchedulerLeaseHandle | null> {
  await dbConnect();

  const now = new Date();
  const owner = randomUUID();
  const leaseUntil = new Date(now.getTime() + Math.max(60_000, ttlMs));

  try {
    const lease = await SchedulerLease.findOneAndUpdate(
      {
        _id: name,
        $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
      },
      {
        $set: {
          owner,
          leaseUntil,
          startedAt: now,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    if (!lease || lease.owner !== owner) return null;
    return { name, owner, leaseUntil };
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

export async function releaseSchedulerLease(handle: SchedulerLeaseHandle) {
  await SchedulerLease.updateOne(
    { _id: handle.name, owner: handle.owner },
    {
      $set: {
        leaseUntil: new Date(),
      },
    }
  );
}

export async function deferSchedulerLease(
  handle: SchedulerLeaseHandle,
  delayMs: number
) {
  const leaseUntil = new Date(Date.now() + Math.max(60_000, delayMs));
  await SchedulerLease.updateOne(
    { _id: handle.name, owner: handle.owner },
    { $set: { leaseUntil } }
  );
}

function rateLimitDelayMs(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = "status" in error ? Number((error as { status?: unknown }).status) : 0;
  if (status !== 429) return null;
  const retryAfterMs =
    "retryAfterMs" in error
      ? Number((error as { retryAfterMs?: unknown }).retryAfterMs)
      : Number.NaN;
  return Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 120_000;
}

export async function withRiotRefreshLease<T>(work: () => Promise<T>): Promise<T> {
  let lease = await acquireSchedulerLease("riot-api-refresh");
  if (!lease) throw new RiotRefreshBusyError();

  try {
    return await work();
  } catch (error) {
    const delayMs = rateLimitDelayMs(error);
    if (delayMs) {
      await deferSchedulerLease(lease, delayMs).catch((deferError) => {
        console.error("Could not extend Riot refresh cooldown:", deferError);
      });
      lease = null;
    }
    throw error;
  } finally {
    if (lease) {
      await releaseSchedulerLease(lease).catch((error) => {
        console.error("Could not release Riot refresh lease:", error);
      });
    }
  }
}
