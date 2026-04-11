"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setError(data.error || "Invalid code");
        return;
      }

      setCode("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="password"
          placeholder="Code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoFocus
          autoComplete="current-password"
          disabled={pending}
          className="rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={pending || !code.trim()}
          className="rounded bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-black dark:hover:bg-neutral-300"
        >
          {pending ? "Checking..." : "Enter"}
        </button>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
      </form>
    </div>
  );
}
