"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

function parseRiotId(input: string) {
    const raw = input.trim();
    if (!raw) return null;

    const cleaned = raw
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s*\/\s*/g, "#")
        .replace(/\s*#\s*/g, "#")
        .trim();

    if (cleaned.includes("#")) {
        const i = cleaned.lastIndexOf("#");
        const gameName = cleaned.slice(0, i).trim();
        const tagLine = cleaned.slice(i + 1).trim();
        return gameName && tagLine ? { gameName, tagLine } : null;
    }

    const m = cleaned.match(/^(.*\S)\s+(\S+)$/);
    if (!m) return null;
    return { gameName: m[1].trim(), tagLine: m[2].trim() };
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

    function syncFromPaste(v: string) {
        setRiotId(v);
        const p = parseRiotId(v);
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
        // ignore body; just best-effort
        if (!res.ok) throw new Error("Refresh failed");
    }

    function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setMsg(null);
        setErr(null);

        const gn = gameName.trim();
        const tl = tagLine.trim();

        if (!gn || !tl) {
            setErr('Paste like "Name#TAG" (or "Name TAG") or fill both fields.');
            return;
        }

        const payload: any = { riotId: riotId.trim() || undefined, gameName: gn, tagLine: tl };
        if (codeRequired) payload.code = code.trim();

        startTransition(async () => {
            try {
                const res = await fetch("/api/submit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ok) {
                    setErr(data.error ?? "Submit failed");
                    return;
                }

                // ✅ immediately refresh this player (not all)
                if (REFRESH_KEY) {
                    await triggerRefreshOne(gn, tl);
                }

                setMsg("Submitted + refreshed.");
                setRiotId("");
                setGameName("");
                setTagLine("");
                setCode("");

                // update UI
                router.refresh();
            } catch (e: any) {
                setErr(e?.message ?? "Submit failed");
            }
        });
    }

    return (
        <form onSubmit={onSubmit} className="rounded-xl border p-4 space-y-3">
            <div className="space-y-2">
                <label className="text-sm font-medium">Riot ID (paste)</label>
                <input
                    value={riotId}
                    onChange={(e) => syncFromPaste(e.target.value)}
                    placeholder='e.g. "Hide on bush#KR1" or "Hide on bush KR1"'
                    className="border rounded px-3 py-2 w-full"
                    disabled={pending}
                />
                <p className="text-xs opacity-70">
                    Supports <span className="font-mono">Name#TAG</span>,{" "}
                    <span className="font-mono">Name TAG</span>,{" "}
                    <span className="font-mono">Name/TAG</span>
                    {parsed ? (
                        <>
                            {" — "}Parsed: <span className="font-mono">{parsed.gameName}</span>#
                            <span className="font-mono">{parsed.tagLine}</span>
                        </>
                    ) : null}
                </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    placeholder="GameName"
                    className="border rounded px-3 py-2"
                    required
                    minLength={2}
                    maxLength={16}
                    disabled={pending}
                />
                <input
                    value={tagLine}
                    onChange={(e) => setTagLine(e.target.value)}
                    placeholder="TAG"
                    className="border rounded px-3 py-2"
                    required
                    minLength={2}
                    maxLength={10}
                    disabled={pending}
                />
            </div>

            {codeRequired && (
                <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Community code"
                    className="border rounded px-3 py-2 w-full"
                    required
                    disabled={pending}
                />
            )}

            <button
                type="submit"
                className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
                disabled={pending}
            >
                {pending ? "Submitting..." : "Submit"}
            </button>

            {msg && <p className="text-sm">{msg}</p>}
            {err && <p className="text-sm text-red-600">{err}</p>}

            <p className="text-sm opacity-70">SEA supported. Platform is auto-detected on refresh.</p>
        </form>
    );
}
