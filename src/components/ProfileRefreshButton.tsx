"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export default function ProfileRefreshButton({
  mode = "lol",
}: {
  gameName: string;
  tagLine: string;
  mode?: "lol" | "tft";
}) {
  const router = useRouter();

  const [pending, startTransition] = useTransition();
  function run() {
    if (pending) return;
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-xl bg-zinc-900/40 px-3.5 py-2 text-sm text-zinc-100 transition hover:bg-white/5 disabled:opacity-40"
      >
        {pending ? "Checking..." : "Check saved data"}
      </button>

      <div className="max-w-[280px] text-right text-xs text-zinc-500">
        {mode === "tft" ? "TFT" : "League"} updates run automatically in the background.
      </div>
    </div>
  );
}
