"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";



export default function RefreshButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [err, setErr] = useState<string | null>(null);

    function onClick() {
        setErr(null);

        startTransition(async () => {
            try {
                const url = `/api/refresh`;
                const res = await fetch(url, { method: "GET", cache: "no-store" });

                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ok) throw new Error(data.error ?? "Refresh failed");

                router.refresh();
            } catch (e: any) {
                setErr(e?.message ?? "Refresh failed");
            }
        });
    }

    return (
        <div className="flex items-center gap-2">
            <button
                onClick={onClick}
                disabled={pending}
                className="rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1 text-xs font-semibold hover:bg-white/5 disabled:opacity-50"
            >
                {pending ? "Refreshing..." : "Refresh now"}
            </button>
            {err ? <span className="text-xs text-red-400">{err}</span> : null}
        </div>
    );
}
