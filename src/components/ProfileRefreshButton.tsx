"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function ProfileRefreshButton({
    gameName,
    tagLine,
}: {
    gameName: string;
    tagLine: string;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [err, setErr] = useState<string | null>(null);

    async function run() {
        setErr(null);

        const gn = String(gameName ?? "").trim();
        const tl = String(tagLine ?? "").trim().toLowerCase();
        if (!gn || !tl) {
            setErr("Missing gameName/tagLine");
            return;
        }

        const res = await fetch(`/api/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}/refresh`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                syncMatches: true,
                matchesCount: 10,


                fullMastery: true,



            }),
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) {
            setErr(j?.error ?? `Refresh failed (${res.status})`);
            return;
        }


        if (j?.player?._skipped) {
            setErr(
                `Cooldown: try again in ${j.player._cooldownSecondsLeft ?? "?"}s (next: ${j.player._nextRefreshAt ?? "?"})`
            );
        }

        startTransition(() => router.refresh());
    }

    return (
        <div className="flex flex-col items-start sm:items-end gap-2">
            <button
                onClick={run}
                disabled={pending}
                className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm disabled:opacity-40"
            >
                {pending ? "Refreshing…" : "Refresh"}
            </button>

            {err && <div className="text-xs text-red-300 max-w-[280px] text-right">{err}</div>}
        </div>
    );
}
