"use client";

import { useFormStatus } from "react-dom";

function Submit() {
    const { pending } = useFormStatus();

    return (
        <button
            type="submit"
            disabled={pending}
            className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm disabled:opacity-40"
        >
            {pending ? "Refreshing…" : "Refresh"}
        </button>
    );
}

export default function RefreshButton({ action }: { action: () => Promise<void> }) {
    return (
        <form action={action}>
            <Submit />
        </form>
    );
}
