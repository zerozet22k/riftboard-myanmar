// app/page.tsx
import Link from "next/link";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import HomeSearch from "@/components/HomeSearch";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await dbConnect();
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl p-4 sm:p-8 space-y-8">
        <header className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            RiftBoard Myanmar
          </h1>

          <p className="text-sm sm:text-base text-zinc-400">
            Search players already in the leaderboard, or add yourself.
          </p>


          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href="/leaderboard"
              className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-2 text-sm hover:bg-zinc-900/60"
            >
              Open leaderboard
            </Link>

            <Link
              href="/submit"
              className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm hover:bg-zinc-900/40"
            >
              Add yourself with invite code
            </Link>

          </div>
        </header>

        {/* Search */}
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/20 p-4 sm:p-6 space-y-3">
          <div className="text-sm text-zinc-300 font-medium">Search</div>
          <HomeSearch />
          <div className="text-xs text-zinc-500">
            Tip: try <span className="font-mono">name#TAG</span> or just part of the name.
          </div>
        </section>
      </div>
    </main>
  );
}
