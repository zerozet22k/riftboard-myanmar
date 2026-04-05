"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type SubmitViewer = {
  discordUsername: string | null;
  gameName: string;
  tagLine: string;
};

async function safeJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;

  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function SubmitForm({
  codeRequired,
  viewer,
  returnTo = "/submit",
  showBindingCard = true,
}: {
  codeRequired: boolean;
  viewer: SubmitViewer | null;
  returnTo?: string;
  showBindingCard?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!viewer) return;

    setMsg(null);
    setErr(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: code.trim() || undefined,
          }),
        });

        const data = await safeJson(res);
        if (!res.ok || data?.ok === false) {
          setErr((data && (data.error || data.message)) || `Refresh failed (${res.status})`);
          return;
        }

        setMsg("Refreshing your bound Riot account...");
        setCode("");

        const canonicalPath =
          data && typeof data.canonicalPath === "string" && data.canonicalPath.startsWith("/p/")
            ? data.canonicalPath
            : null;

        if (canonicalPath) {
          router.push(canonicalPath);
          router.refresh();
          return;
        }

        router.refresh();
      } catch (error) {
        setErr(error instanceof Error ? error.message : "Refresh failed");
      }
    });
  }

  if (!viewer) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6 space-y-4">
        <div>
          <div className="text-lg font-semibold text-zinc-100">Connect Discord first</div>
          <p className="mt-2 text-sm text-zinc-400">
            Manual Riot ID entry is disabled. Connect Discord so Riftboard can trust the Riot
            account exposed by your Discord profile.
          </p>
        </div>

        <form action="/api/discord/oauth/start" method="GET">
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Connect Discord
          </button>
        </form>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6 space-y-4"
    >
      {showBindingCard ? (
        <div className="rounded-2xl border border-white/8 bg-zinc-950/40 p-4">
          <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">Verified binding</div>
          <div className="mt-2 text-lg font-semibold text-zinc-100">
            {viewer.gameName}#{viewer.tagLine}
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            Discord: {viewer.discordUsername ?? "Connected account"}
          </div>
        </div>
      ) : null}

      {codeRequired ? (
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Community code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter community code"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-700"
            required
            disabled={pending}
            autoComplete="off"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/5 disabled:opacity-50"
          disabled={pending}
        >
          {pending ? "Refreshing..." : "Refresh my account"}
        </button>

        <Link
          href={`/api/discord/oauth/start?returnTo=${encodeURIComponent(returnTo)}`}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/5"
        >
          Reconnect Discord
        </Link>
      </div>

      {msg && <p className="text-sm text-zinc-200">{msg}</p>}
      {err && <p className="text-sm text-red-400">{err}</p>}
    </form>
  );
}
