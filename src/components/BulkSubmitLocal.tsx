"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ZW = /[\u200B-\u200D\uFEFF]/g;

function sanitizeLine(v: string) {
  return String(v || "")
    .replace(ZW, "")
    .replace(/\r/g, "")
    .trim();
}

function sanitizeRiotIdPaste(v: string) {
  return String(v || "")
    .replace(ZW, "")
    .replace(/\s*\/\s*/g, "#")
    .replace(/\s*#\s*/g, "#")
    .replace(/#+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

type Row = {
  input: string;
  riotId: string;
  status: "queued" | "running" | "ok" | "error" | "skipped";
  message?: string;
  playerId?: string;
};

async function submitOne(opts: { riotId: string; code?: string }) {
  const payload: any = { riotId: opts.riotId };
  if (opts.code) payload.code = opts.code;

  // retry on 429/5xx a few times (simple backoff)
  let attempt = 0;
  while (true) {
    attempt++;

    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await safeJson(res);

    if (res.ok && data?.ok !== false) return { res, data };

    const status = res.status;
    const errMsg =
      (data && (data.error || data.message)) || `Submit failed (${status})`;

    // 429: respect Retry-After if present
    if (status === 429 && attempt <= 5) {
      const ra = res.headers.get("retry-after");
      const waitMs = ra ? Math.max(1000, Number(ra) * 1000) : 3500;
      await sleep(waitMs);
      continue;
    }

    // 5xx: quick backoff
    if (status >= 500 && status <= 599 && attempt <= 3) {
      await sleep(1200 * attempt);
      continue;
    }

    throw new Error(errMsg);
  }
}

export default function BulkSubmitLocal({
  codeRequired,
  defaultDelayMs = 1800,
}: {
  codeRequired: boolean;
  defaultDelayMs?: number;
}) {
  const router = useRouter();

  // local/dev only (or allow enabling via NEXT_PUBLIC_ENABLE_BULK_SUBMIT=1)
  const enabled =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ENABLE_BULK_SUBMIT === "1";

  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [delayMs, setDelayMs] = useState<number>(defaultDelayMs);

  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const lines = useMemo(() => {
    const raw = String(text || "").split("\n").map(sanitizeLine).filter(Boolean);
    // de-dupe while keeping order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of raw) {
      const x = sanitizeRiotIdPaste(l);
      if (!x) continue;
      const key = x.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x);
    }
    return out;
  }, [text]);

  const stats = useMemo(() => {
    const total = rows.length;
    const ok = rows.filter((r) => r.status === "ok").length;
    const err = rows.filter((r) => r.status === "error").length;
    const skipped = rows.filter((r) => r.status === "skipped").length;
    const done = ok + err + skipped;
    return { total, ok, err, skipped, done };
  }, [rows]);

  async function start() {
    stopRef.current = false;

    const cv = code.trim();
    if (codeRequired && !cv) {
      setRows([
        {
          input: "",
          riotId: "",
          status: "error",
          message: "Community code is required.",
        },
      ]);
      return;
    }

    const initial: Row[] = lines.map((l) => ({
      input: l,
      riotId: l,
      status: "queued",
    }));

    setRows(initial);
    setRunning(true);

    try {
      for (let i = 0; i < initial.length; i++) {
        if (stopRef.current) break;

        // mark running
        setRows((prev) => {
          const next = [...prev];
          if (next[i]) next[i] = { ...next[i], status: "running", message: undefined };
          return next;
        });

        try {
          const { data } = await submitOne({ riotId: initial[i].riotId, code: cv || undefined });

          const existed = !!data?.existed;
          const refreshed = !!data?.refreshed;
          const refreshError = data?.refreshError as string | null;

          const msgParts: string[] = [];
          msgParts.push(existed ? "updated" : "created");
          msgParts.push(refreshed ? "refreshed" : "queued");
          if (refreshError) msgParts.push(`refreshErr: ${refreshError}`);

          setRows((prev) => {
            const next = [...prev];
            if (next[i]) {
              next[i] = {
                ...next[i],
                status: "ok",
                playerId: data?.playerId ? String(data.playerId) : undefined,
                message: msgParts.join(" • "),
              };
            }
            return next;
          });
        } catch (e: any) {
          setRows((prev) => {
            const next = [...prev];
            if (next[i]) {
              next[i] = {
                ...next[i],
                status: "error",
                message: e?.message ?? "Submit failed",
              };
            }
            return next;
          });
        }

        if (i < initial.length - 1 && !stopRef.current) {
          await sleep(Math.max(250, Number(delayMs) || 0));
        }
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  function stop() {
    stopRef.current = true;
    setRunning(false);
  }

  if (!enabled) return null;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-200">Local bulk submit</div>
          <div className="text-xs text-zinc-500">
            One Riot ID per line. Submits sequentially to <span className="font-mono">/api/submit</span>.
          </div>
        </div>

        <div className="text-xs text-zinc-500 tabular-nums">
          {stats.done}/{stats.total} • ok {stats.ok} • err {stats.err}
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Hide on bush#KR1\nFaker#T1\nSome Name/SG2`}
        className="min-h-[140px] w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-700"
        disabled={running}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {codeRequired ? (
          <div className="space-y-1 sm:col-span-1">
            <label className="text-xs text-zinc-500">Community code</label>
            <input
              value={code}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-700"
              disabled={true}
              autoComplete="off"
            />
          </div>
        ) : (
          <div className="sm:col-span-1" />
        )}

        <div className="space-y-1 sm:col-span-1">
          <label className="text-xs text-zinc-500">Delay (ms)</label>
          <input
            value={String(delayMs)}
            onChange={(e) => setDelayMs(Number(e.target.value))}
            inputMode="numeric"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-zinc-700"
            disabled={running}
          />
        </div>

        <div className="flex items-end gap-2 sm:justify-end sm:col-span-1">
          {!running ? (
            <button
              onClick={start}
              disabled={lines.length === 0}
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/5 disabled:opacity-50"
            >
              Start ({lines.length})
            </button>
          ) : (
            <button
              onClick={stop}
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/5"
            >
              Stop
            </button>
          )}

          <button
            onClick={() => {
              setText("");
              setRows([]);
            }}
            disabled={running}
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 overflow-hidden">
          <div className="max-h-64 overflow-auto">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-sm text-zinc-200 truncate">{r.riotId}</div>
                  {r.message ? (
                    <div className="text-xs text-zinc-500 truncate">{r.message}</div>
                  ) : null}
                </div>

                <div className="shrink-0 text-xs tabular-nums">
                  {r.status === "queued" && <span className="text-zinc-500">queued</span>}
                  {r.status === "running" && <span className="text-zinc-300">running…</span>}
                  {r.status === "ok" && <span className="text-emerald-400">ok</span>}
                  {r.status === "error" && <span className="text-red-400">error</span>}
                  {r.status === "skipped" && <span className="text-zinc-500">skipped</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
