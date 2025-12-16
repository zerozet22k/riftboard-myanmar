"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoUIRefresh({ everyMs = 15000 }: { everyMs?: number }) {
    const router = useRouter();

    useEffect(() => {
        const t = setInterval(() => router.refresh(), everyMs);
        return () => clearInterval(t);
    }, [router, everyMs]);

    return null;
}
