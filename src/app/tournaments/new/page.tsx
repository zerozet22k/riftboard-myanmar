import Link from "next/link";
import TournamentCreateForm from "@/components/TournamentCreateForm";
import { getTournamentHostCode, isRiotTournamentApiEnabled } from "@/lib/runtimeConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function NewTournamentPage() {
  const hostCodeRequired = !!getTournamentHostCode();
  const riotTournamentApiEnabled = isRiotTournamentApiEnabled();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1100px] space-y-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="space-y-3">
          <Link href="/tournaments" className="text-sm text-zinc-400 transition hover:text-zinc-200">
            Back to tournaments
          </Link>
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Community</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-50">Create tournament</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Create a Riot-compliant tournament draft, then use the secret organizer link to open
              registration, run check-in, lock seeds, and provision Riot match codes.
              {hostCodeRequired ? " The same community code is required here too." : ""}
            </p>
            {!riotTournamentApiEnabled ? (
              <p className="mt-2 max-w-2xl text-sm text-amber-300">
                Riot Tournament API is disabled in this deployment right now. You can still prepare
                the tournament flow, but Riot provisioning and live match codes will stay blocked
                until approved access is configured.
              </p>
            ) : null}
          </div>
        </header>

        <TournamentCreateForm
          hostCodeRequired={hostCodeRequired}
          riotTournamentApiEnabled={riotTournamentApiEnabled}
        />
      </div>
    </main>
  );
}
