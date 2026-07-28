"use client";

import { useEffect, useEffectEvent } from "react";
import { useRouter } from "next/navigation";

const MIN_REFRESH_MS = 5 * 60 * 1000;
const MAX_JITTER_MS = 45 * 1000;

export default function AutoUIRefresh({ everyMs = MIN_REFRESH_MS }: { everyMs?: number }) {
  const router = useRouter();
  const refresh = useEffectEvent(() => {
    router.refresh();
  });

  useEffect(() => {
    const baseDelay = Math.max(MIN_REFRESH_MS, Number.isFinite(everyMs) ? everyMs : MIN_REFRESH_MS);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dueAt = Date.now() + nextDelay();

    function nextDelay() {
      const jitterCeiling = Math.min(MAX_JITTER_MS, Math.floor(baseDelay * 0.15));
      return baseDelay + Math.floor(Math.random() * (jitterCeiling + 1));
    }

    function available() {
      return document.visibilityState === "visible" && navigator.onLine;
    }

    function clearTimer() {
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function schedule() {
      clearTimer();
      if (!available()) return;

      const wait = Math.max(0, dueAt - Date.now());
      timer = setTimeout(() => {
        timer = null;
        if (available()) refresh();
        dueAt = Date.now() + nextDelay();
        schedule();
      }, wait);
    }

    function handleAvailabilityChange() {
      schedule();
    }

    schedule();
    document.addEventListener("visibilitychange", handleAvailabilityChange);
    window.addEventListener("online", handleAvailabilityChange);
    window.addEventListener("offline", handleAvailabilityChange);

    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", handleAvailabilityChange);
      window.removeEventListener("online", handleAvailabilityChange);
      window.removeEventListener("offline", handleAvailabilityChange);
    };
  }, [everyMs]);

  return null;
}
