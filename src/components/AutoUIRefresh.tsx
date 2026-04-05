"use client";

import { useEffect, useEffectEvent } from "react";
import { useRouter } from "next/navigation";

export default function AutoUIRefresh({ everyMs = 15000 }: { everyMs?: number }) {
    const router = useRouter();
    const refresh = useEffectEvent(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        router.refresh();
    });

    useEffect(() => {
        const t = setInterval(() => refresh(), everyMs);
        return () => clearInterval(t);
    }, [everyMs]);

    return null;
}
