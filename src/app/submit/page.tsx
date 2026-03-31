import Link from "next/link";
import SubmitForm from "../../components/SubmitForm";
import { getCommunityJoinCode } from "@/lib/runtimeConfig";

export default function SubmitPage() {
  const joinCodeRequired = !!getCommunityJoinCode();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-xl p-4 sm:p-6 space-y-6">
        <div className="space-y-2">
          <Link
            href="/"
            className="inline-flex text-sm text-zinc-400 underline underline-offset-4 hover:text-zinc-200"
          >
            Back to leaderboard
          </Link>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Add or update your Riot ID
          </h1>

          <p className="text-sm text-zinc-400">
            Paste your Riot ID (e.g. <span className="font-mono">Name#TAG</span>) and we will add
            you to the community leaderboard or update your existing profile if you renamed.
            {joinCodeRequired ? " A join code is required for this community." : ""}
          </p>
        </div>

        <SubmitForm codeRequired={joinCodeRequired} />

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-400">
          Tip: Your Riot ID updates immediately. Rank, match history, and champion data may take a
          moment to catch up depending on Riot rate limits.
        </div>
      </div>
    </main>
  );
}
