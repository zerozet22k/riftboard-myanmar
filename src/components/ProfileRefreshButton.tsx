"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatFullDateTime } from "@/lib/displayTime";

export default function ProfileRefreshButton({
  gameName,
  tagLine,
  mode = "lol",
}: {
  gameName: string;
  tagLine: string;
  mode?: "lol" | "tft";
}) {
  const router = useRouter();

  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const busy = loading || pending;

  async function run() {
    if (busy) return;

    setErr(null);
    setLoading(true);

    try {
      const gn = String(gameName ?? "").trim();
      const tl = String(tagLine ?? "").trim().toLowerCase();
      if (!gn || !tl) {
        setErr("Missing gameName/tagLine");
        return;
      }

      const prefix = mode === "tft" ? "/api/tft/p" : "/api/p";
      const res = await fetch(`${prefix}/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          syncMatches: mode === "lol",
          syncTftMatches: mode === "tft",
          matchesCount: 10,
          fullMastery: mode === "lol",
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setErr(j?.error ?? `Refresh failed (${res.status})`);
        return;
      }

      if (j?.player?._skipped) {
        const nextText = formatFullDateTime(j.player._nextRefreshAt) ?? "?";
        setErr(`Cooldown: try again in ${j.player._cooldownSecondsLeft ?? "?"}s (next: ${nextText})`);
        return;
      }

      startTransition(() => router.refresh());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-xl bg-zinc-900/40 px-3.5 py-2 text-sm text-zinc-100 transition hover:bg-white/5 disabled:opacity-40"
      >
        {busy ? "Refreshing..." : "Refresh"}
      </button>

      {err ? <div className="max-w-[280px] text-right text-xs text-red-300">{err}</div> : null}
    </div>
  );
}
