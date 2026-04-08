import Link from "next/link";
import type { Metadata } from "next";
import { dbConnect } from "@/lib/mongodb";
import { absoluteUrl } from "@/lib/seo";
import { displayTournamentStatus } from "@/lib/tournaments";
import { Tournament } from "@/models/tournament";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tournaments",
  description:
    "Browse community League of Legends tournaments on RiftBoard Myanmar with registration, check-in, brackets, and team status.",
  alternates: {
    canonical: "/tournaments",
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/tournaments"),
    title: "RiftBoard Myanmar Tournaments",
    description:
      "Browse community League of Legends tournaments on RiftBoard Myanmar with registration, check-in, brackets, and team status.",
  },
};

type TournamentListRow = {
  _id: unknown;
  name: string;
  slug: string;
  description?: string;
  platform?: string;
  teamSize?: number;
  maxTeams?: number;
  bestOf?: number;
  status: string;
  complianceStatus?: string;
  riotApiState?: string;
  startsAt?: Date | null;
};

function formatWhen(value: Date | string | null | undefined) {
  if (!value) return "TBA";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "TBA";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export default async function TournamentsPage() {
  await dbConnect();

  const tournaments = (await Tournament.find(
    {},
    {
      name: 1,
      slug: 1,
      description: 1,
      platform: 1,
      teamSize: 1,
      maxTeams: 1,
      bestOf: 1,
      status: 1,
      complianceStatus: 1,
      riotApiState: 1,
      startsAt: 1,
      createdAt: 1,
    }
  )
    .where("status")
    .ne("draft")
    .sort({ startsAt: 1, createdAt: -1 })
    .lean()) as TournamentListRow[];

  const counts = await TournamentTeam.aggregate<{
    _id: unknown;
    total: number;
  }>([
    {
      $match: {
        verificationMode: "discord_verified",
        status: { $ne: "dropped" },
      },
    },
    { $group: { _id: "$tournamentId", total: { $sum: 1 } } },
  ]);

  const countMap = new Map(counts.map((row) => [String(row._id), row.total]));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Community</div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Tournaments</h1>
            <p className="max-w-2xl text-sm text-zinc-400">
              Burmese-friendly Riot-compliant tournaments with registration, check-in, transparent
              seeding, and callback-driven match progression.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
    
            <Link
              href="/tournaments/new"
              className="rounded-2xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400"
            >
              Create tournament
            </Link>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          {tournaments.length ? (
            tournaments.map((tournament) => (
              <Link
                key={String(tournament._id)}
                href={`/tournaments/${tournament.slug}`}
                className="rounded-[28px] bg-zinc-900/30 p-5 ring-1 ring-white/5 transition hover:bg-zinc-900/45"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xl font-semibold text-zinc-50">{tournament.name}</div>
                    <div className="mt-1 text-sm text-zinc-500">
                      {String(tournament.platform ?? "sg2").toUpperCase()} • {tournament.teamSize}v
                      {tournament.teamSize} • BO{tournament.bestOf ?? 1}
                    </div>
                  </div>
                  <div className="rounded-full bg-zinc-950/60 px-3 py-1 text-xs uppercase tracking-[0.16em] text-zinc-300 ring-1 ring-white/6">
                    {displayTournamentStatus(tournament.status as never)}
                  </div>
                </div>

                <div className="mt-4 text-sm text-zinc-400">
                  {tournament.description?.trim() || "No description yet."}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                    Teams: {countMap.get(String(tournament._id)) ?? 0}/{tournament.maxTeams ?? 0}
                  </span>
                  <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                    Starts: {formatWhen(tournament.startsAt)}
                  </span>
                  <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                    Riot: {tournament.riotApiState === "provisioned" ? "Provisioned" : "Pending"}
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-[28px] bg-zinc-900/30 p-8 text-sm text-zinc-400 ring-1 ring-white/5">
              No tournaments yet. Create the first one for the community.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
