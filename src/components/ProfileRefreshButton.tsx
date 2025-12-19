"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

function formatDateTime(v: unknown) {
    if (v == null) return null;

    const d =
        typeof v === "number"
            ? new Date(v)
            : new Date(typeof v === "string" ? v : String(v));

    if (Number.isNaN(d.getTime())) return String(v);

    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
    }).format(d);
}

export default function ProfileRefreshButton({
    gameName,
    tagLine,
}: {
    gameName: string;
    tagLine: string;
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

            const res = await fetch(
                `/api/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}/refresh`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        syncMatches: true,
                        matchesCount: 10,
                        fullMastery: true,
                    }),
                }
            );

            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j?.ok) {
                setErr(j?.error ?? `Refresh failed (${res.status})`);
                return;
            }

            if (j?.player?._skipped) {
                const nextText = formatDateTime(j.player._nextRefreshAt) ?? "?";
                setErr(`Cooldown: try again in ${j.player._cooldownSecondsLeft ?? "?"}s (next: ${nextText})`);
                return; // don't bother router.refresh() if nothing changed
            }

            startTransition(() => router.refresh());
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-col items-start sm:items-end gap-2">
            <button
                onClick={run}
                disabled={busy}
                className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm disabled:opacity-40"
            >
                {busy ? "Refreshing…" : "Refresh"}
            </button>

            {err && <div className="text-xs text-red-300 max-w-[280px] text-right">{err}</div>}
        </div>
    );
}
