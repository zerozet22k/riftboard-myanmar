"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type RefreshResponse = {
  ok?: boolean;
  pending?: boolean;
  refreshed?: boolean;
  error?: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<RefreshResponse> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return {};
  }
  return response.json().catch(() => ({}));
}

function retryDelayMs(response: Response, fallbackMs = 60_000) {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.max(5_000, Math.min(180_000, seconds * 1000))
    : fallbackMs;
}

export default function ProfileRefreshButton({
  gameName,
  tagLine,
  initialPending = false,
  retryPending = false,
  compact = false,
}: {
  gameName: string;
  tagLine: string;
  initialPending?: boolean;
  retryPending?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const requestVersion = useRef(0);
  const [pending, setPending] = useState(initialPending);
  const [message, setMessage] = useState<string | null>(
    initialPending ? "Updating rank..." : null
  );
  const endpoint = `/api/p/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}/refresh`;

  const watchQueuedRefresh = useCallback(
    async (version: number, firstRetryAt: number | null = null) => {
      let nextPostAt = firstRetryAt;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const pollDelayMs =
          attempt < 2
            ? 10_000
            : attempt < 4
              ? 15_000
              : attempt < 6
                ? 20_000
                : 30_000;
        await sleep(pollDelayMs);
        if (requestVersion.current !== version) return;

        const retryWithPost =
          nextPostAt !== null && Date.now() >= nextPostAt;
        const response = await fetch(endpoint, {
          method: retryWithPost ? "POST" : "GET",
          cache: "no-store",
        }).catch(() => null);
        if (!response) {
          if (retryWithPost) nextPostAt = Date.now() + 60_000;
          continue;
        }

        const status = await readJson(response);
        if (retryWithPost) {
          if (response.status === 401 || response.status === 403) {
            nextPostAt = null;
          } else if (status.pending) {
            nextPostAt = Date.now() + retryDelayMs(response);
          }
        }
        if (!response.ok) {
          if (!status.pending && status.error) {
            setPending(false);
            setMessage(status.error);
            router.refresh();
            return;
          }
          continue;
        }
        if (status.pending) continue;
        if (requestVersion.current !== version) return;

        setPending(false);
        setMessage(
          status.error ? status.error : "Rank updated."
        );
        router.refresh();
        return;
      }

      if (requestVersion.current !== version) return;
      setPending(false);
      setMessage("Rank update is still queued.");
    },
    [endpoint, router]
  );

  useEffect(() => {
    if (!initialPending) return;
    const version = ++requestVersion.current;
    void watchQueuedRefresh(
      version,
      retryPending ? Date.now() + 15_000 : null
    );
    return () => {
      requestVersion.current += 1;
    };
  }, [initialPending, retryPending, watchQueuedRefresh]);

  async function run() {
    if (pending) return;
    const version = ++requestVersion.current;
    setPending(true);
    setMessage("Updating rank...");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const result = await readJson(response);
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "The rank update could not start.");
      }
      if (requestVersion.current !== version) return;

      if (result.pending) {
        await watchQueuedRefresh(
          version,
          Date.now() + retryDelayMs(response)
        );
        return;
      }

      setPending(false);
      setMessage(result.refreshed ? "Rank updated." : "Rank is already current.");
      router.refresh();
    } catch (error) {
      if (requestVersion.current !== version) return;
      setPending(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "The rank update could not start."
      );
    }
  }

  return (
    <div
      className={
        compact
          ? "flex flex-col items-start gap-1"
          : "flex flex-col items-start gap-2 sm:items-end"
      }
    >
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={
          compact
            ? "inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
            : "rounded-xl bg-zinc-900/40 px-3.5 py-2 text-sm text-zinc-100 transition hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
        }
      >
        {pending ? "Updating rank..." : "Refresh rank"}
      </button>

      {message ? (
        <div
          role={message.includes("could not") ? "alert" : "status"}
          className={`max-w-[280px] text-xs ${
            message.includes("could not")
              ? "text-red-300"
              : "text-zinc-500"
          } ${compact ? "text-left" : "text-right"}`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
