"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const ZW = /[\u200B-\u200D\uFEFF]/g;

function sanitizeRiotIdPaste(v: string) {
  return String(v || "")
    .replace(ZW, "")
    .replace(/\s*\/\s*/g, "#")
    .replace(/\s*#\s*/g, "#")
    .replace(/#+/g, "#") // "##" -> "#"
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeGameName(v: string) {
  // allow spaces + most characters, but block separators that break parsing
  return String(v || "")
    .replace(ZW, "")
    .replace(/[#/]/g, "") // prevent "#", "/"
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

function sanitizeTagLine(v: string) {
  // keep it strict: alnum only, uppercase
  return String(v || "")
    .replace(ZW, "")
    .replace(/[^0-9a-zA-Z]/g, "")
    .toUpperCase()
    .trim()
    .slice(0, 10);
}

function parseRiotId(input: string) {
  const cleaned = sanitizeRiotIdPaste(input);
  if (!cleaned) return null;

  if (cleaned.includes("#")) {
    const i = cleaned.lastIndexOf("#");
    const gameName = cleaned.slice(0, i).trim();
    const tagLine = cleaned.slice(i + 1).trim();
    return gameName && tagLine ? { gameName, tagLine } : null;
  }

  // "Name TAG"
  const m = cleaned.match(/^(.*\S)\s+(\S+)$/);
  if (!m) return null;

  const gameName = m[1].trim();
  const tagLine = m[2].trim();
  return gameName && tagLine ? { gameName, tagLine } : null;
}

async function safeJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const REFRESH_KEY = process.env.NEXT_PUBLIC_REFRESH_KEY || "";

export default function SubmitForm({ codeRequired }: { codeRequired: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [riotId, setRiotId] = useState("");
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [code, setCode] = useState("");

  const parsed = useMemo(() => parseRiotId(riotId), [riotId]);

  // if paste parses cleanly, lock the lower inputs so users can't type "#"
  const lockLowerFields = !!parsed;

  function syncFromRiotId(v: string) {
    const cleaned = sanitizeRiotIdPaste(v);
    setRiotId(cleaned);

    const p = parseRiotId(cleaned);
    if (p) {
      setGameName(p.gameName);
      setTagLine(p.tagLine);
    }
  }

  async function triggerRefreshOne(gn: string, tl: string) {
    if (!REFRESH_KEY) return; // no key, skip
    const url =
      `/api/refresh?key=${encodeURIComponent(REFRESH_KEY)}` +
      `&gameName=${encodeURIComponent(gn)}` +
      `&tagLine=${encodeURIComponent(tl)}`;

    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error("Refresh failed");
  }

  function validate(gn: string, tl: string, codeVal: string) {
    if (!gn || !tl) return 'Paste like "Name#TAG" (or "Name TAG") or fill both fields.';
    if (gn.length < 2 || gn.length > 16) return "GameName must be 2–16 characters.";
    if (tl.length < 2 || tl.length > 10) return "TAG must be 2–10 characters.";
    if (codeRequired && !codeVal.trim()) return "Community code is required.";
    return null;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setErr(null);

    // prefer parsed (paste box) if available
    const gn = sanitizeGameName(parsed?.gameName ?? gameName);
    const tl = sanitizeTagLine(parsed?.tagLine ?? tagLine);
    const cv = code.trim();

    const v = validate(gn, tl, cv);
    if (v) {
      setErr(v);
      return;
    }

    const payload: any = { gameName: gn, tagLine: tl };
    if (riotId.trim()) payload.riotId = sanitizeRiotIdPaste(riotId);
    if (codeRequired) payload.code = cv;

    startTransition(async () => {
      try {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await safeJson(res);

        if (!res.ok || (data && data.ok === false)) {
          setErr((data && (data.error || data.message)) || `Submit failed (${res.status})`);
          return;
        }

        // best-effort refresh
        try {
          await triggerRefreshOne(gn, tl);
        } catch {
          // don't fail submit if refresh fails
        }

        setMsg("Submitted. Refreshing leaderboard…");
        setRiotId("");
        setGameName("");
        setTagLine("");
        setCode("");
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? "Submit failed");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6 space-y-4"
    >
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-200">Riot ID (paste)</label>
        <input
          value={riotId}
          onChange={(e) => syncFromRiotId(e.target.value)}
          placeholder='e.g. "Hide on bush#KR1" or "Hide on bush KR1"'
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-700"
          disabled={pending}
          inputMode="text"
          autoComplete="off"
        />
        <p className="text-xs text-zinc-500">
          Supports <span className="font-mono">Name#TAG</span>,{" "}
          <span className="font-mono">Name TAG</span>,{" "}
          <span className="font-mono">Name/TAG</span>
          {parsed ? (
            <>
              {" — "}Parsed:{" "}
              <span className="font-mono text-zinc-300">{parsed.gameName}</span>#
              <span className="font-mono text-zinc-300">{parsed.tagLine}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">GameName</label>
          <input
            value={gameName}
            onChange={(e) => setGameName(sanitizeGameName(e.target.value))}
            placeholder="GameName"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-700 disabled:opacity-60"
            required
            minLength={2}
            maxLength={16}
            disabled={pending}
            readOnly={lockLowerFields}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-zinc-500">TAG</label>
          <input
            value={tagLine}
            onChange={(e) => setTagLine(sanitizeTagLine(e.target.value))}
            placeholder="TAG"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-700 disabled:opacity-60"
            required
            minLength={2}
            maxLength={10}
            disabled={pending}
            readOnly={lockLowerFields}
            autoComplete="off"
          />
        </div>
      </div>

      {codeRequired && (
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
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/5 disabled:opacity-50"
          disabled={pending}
        >
          {pending ? "Submitting…" : "Submit"}
        </button>

        <div className="text-xs text-zinc-500">SEA supported. Platform is auto-detected on refresh.</div>
      </div>

      {msg && <p className="text-sm text-zinc-200">{msg}</p>}
      {err && <p className="text-sm text-red-400">{err}</p>}
    </form>
  );
}
