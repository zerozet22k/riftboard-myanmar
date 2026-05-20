import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TournamentBracket, {
  type TournamentBracketMatch,
  type TournamentBracketTeam,
} from "@/components/TournamentBracket";
import TournamentRegisterForm from "@/components/TournamentRegisterForm";
import { hasCommunityAccess, hasStoredCommunityAccessForDiscordUser } from "@/lib/communityAccess";
import { formatCompactDateTime } from "@/lib/displayTime";
import { getOptionalDiscordSession } from "@/lib/discordSession";
import { dbConnect } from "@/lib/mongodb";
import { getCommunityJoinCode } from "@/lib/runtimeConfig";
import {
  absoluteUrl,
  getSiteBannerUrl,
  getSiteOpenGraphImages,
  organizationSchemaId,
  SITE_NAME,
  websiteSchemaId,
} from "@/lib/seo";
import {
  activeParticipantCount,
  displayTournamentStatus,
  TOURNAMENT_POLICY_SUMMARY,
} from "@/lib/tournaments";
import { acceptedRosterCount, pendingRosterCount } from "@/lib/tournamentTeams";
import { Tournament } from "@/models/tournament";
import { TournamentMatch } from "@/models/tournamentMatch";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const resolved = await params;
  const slug = String(resolved.slug ?? "").trim().toLowerCase();

  if (!slug) {
    return {
      title: "Tournament",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  await dbConnect();

  const tournament = await Tournament.findOne(
    { slug },
    {
      name: 1,
      slug: 1,
      description: 1,
      status: 1,
      startsAt: 1,
    }
  ).lean<{
    name?: string;
    slug?: string;
    description?: string;
    status?: string;
    startsAt?: Date | null;
  } | null>();

  if (!tournament?.name || !tournament.slug) {
    return {
      title: "Tournament Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const canonicalPath = `/tournaments/${encodeURIComponent(tournament.slug)}`;
  const statusText = tournament.status ? displayTournamentStatus(tournament.status as never) : "Tournament";
  const startsText = tournament.startsAt ? ` Starts ${formatWhen(tournament.startsAt)}.` : "";
  const description =
    `${tournament.description?.trim() || "Community League of Legends tournament on RiftBoard Myanmar."} ${statusText}.${startsText}`.trim();

  return {
    title: tournament.name,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "website",
      url: absoluteUrl(canonicalPath),
      title: tournament.name,
      description,
      siteName: SITE_NAME,
      images: getSiteOpenGraphImages(),
    },
    twitter: {
      card: "summary_large_image",
      title: tournament.name,
      description,
      images: getSiteOpenGraphImages().map((image) => image.url),
    },
  };
}

function formatWhen(value: Date | string | null | undefined) {
  return formatCompactDateTime(value) ?? "TBA";
}

function teamStatusLabel(team: {
  status?: string | null;
  verificationMode?: string | null;
  roster?: Array<{ inviteStatus?: string | null }> | null;
}) {
  if (team.verificationMode !== "discord_verified") return "Legacy re-link required";
  if (team.status === "forming") {
    const pending = pendingRosterCount(team.roster as never);
    return pending ? `Forming • ${pending} pending` : "Forming";
  }
  return String(team.status ?? "unknown");
}

export default async function TournamentPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const resolved = await params;
  const now = new Date();
  await dbConnect();

  const [tournament, viewer, browserCommunityAccess] = await Promise.all([
    Tournament.findOne(
      { slug: String(resolved.slug).trim().toLowerCase() },
      {
        name: 1,
        slug: 1,
        description: 1,
        publicRulesText: 1,
        organizerName: 1,
        organizerContact: 1,
        platform: 1,
        teamSize: 1,
        maxTeams: 1,
        bestOf: 1,
        status: 1,
        complianceStatus: 1,
        riotApiState: 1,
        startsAt: 1,
        registrationClosesAt: 1,
        checkInOpensAt: 1,
        checkInClosesAt: 1,
      }
    ).lean(),
    getOptionalDiscordSession(),
    hasCommunityAccess(),
  ]);
  const viewerDiscordUserId = viewer?.discordUserId ?? "";
  const storedCommunityAccess = viewer?.discordUserId
    ? await hasStoredCommunityAccessForDiscordUser(viewer.discordUserId)
    : false;
  const joinCodeRequired = !!getCommunityJoinCode() && !(browserCommunityAccess || storedCommunityAccess);

  if (!tournament?._id) notFound();

  const [teams, matches] = await Promise.all([
    TournamentTeam.find(
      { tournamentId: tournament._id },
      {
        name: 1,
        seed: 1,
        status: 1,
        verificationMode: 1,
        checkedIn: 1,
        roster: 1,
        contactDiscord: 1,
      }
    )
      .sort({ seed: 1, createdAt: 1 })
      .lean(),
    TournamentMatch.find(
      { tournamentId: tournament._id },
      {
        round: 1,
        slot: 1,
        bestOf: 1,
        status: 1,
        teamAId: 1,
        teamBId: 1,
        teamASeed: 1,
        teamBSeed: 1,
        winnerTeamId: 1,
        scoreA: 1,
        scoreB: 1,
        tournamentCode: 1,
      }
    )
      .sort({ round: 1, slot: 1 })
      .lean(),
  ]);

  const bracketTeams: TournamentBracketTeam[] = teams.map((team) => ({
    id: String(team._id),
    name: team.name,
    seed: typeof team.seed === "number" ? team.seed : null,
  }));

  const bracketMatches: TournamentBracketMatch[] = matches.map((match) => ({
    id: String(match._id),
    round: match.round,
    slot: match.slot,
    bestOf: match.bestOf ?? 1,
    status: match.status,
    teamAId: match.teamAId ? String(match.teamAId) : null,
    teamBId: match.teamBId ? String(match.teamBId) : null,
    teamASeed: typeof match.teamASeed === "number" ? match.teamASeed : null,
    teamBSeed: typeof match.teamBSeed === "number" ? match.teamBSeed : null,
    winnerTeamId: match.winnerTeamId ? String(match.winnerTeamId) : null,
    scoreA: match.scoreA ?? 0,
    scoreB: match.scoreB ?? 0,
    tournamentCode: match.tournamentCode ?? null,
  }));

  const verifiedTeams = teams.filter(
    (team) => team.verificationMode === "discord_verified" && team.status !== "dropped"
  );
  const checkedInTeams = verifiedTeams.filter((team) => team.checkedIn);
  const activeParticipants = activeParticipantCount(checkedInTeams.length, tournament.teamSize ?? 5);
  const registrationClosed =
    tournament.status !== "registration" ||
    (!!tournament.registrationClosesAt &&
      new Date(tournament.registrationClosesAt).getTime() < now.getTime()) ||
    verifiedTeams.length >= (tournament.maxTeams ?? 0);

  const viewerTeam = viewer
    ? teams.find(
        (team) =>
          team.status !== "dropped" &&
          Array.isArray(team.roster) &&
          team.roster.some((entry) => String(entry.discordUserId ?? "").trim() === viewer.discordUserId)
      ) ?? null
    : null;
  const tournamentJsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: tournament.name,
    url: absoluteUrl(`/tournaments/${encodeURIComponent(tournament.slug)}`),
    description: tournament.description?.trim() || "Community League of Legends tournament on RiftBoard Myanmar.",
    eventStatus: `https://schema.org/${tournament.status === "completed" ? "EventCompleted" : tournament.status === "live" ? "EventInProgress" : "EventScheduled"}`,
    organizer: {
      "@id": organizationSchemaId(),
    },
    publisher: {
      "@id": organizationSchemaId(),
    },
    image: [getSiteBannerUrl()],
    isPartOf: {
      "@id": websiteSchemaId(),
    },
    startDate: tournament.startsAt ? new Date(tournament.startsAt).toISOString() : undefined,
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tournamentJsonLd) }}
      />
      <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="rounded-[32px] bg-zinc-900/30 p-5 ring-1 ring-white/5 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <Link href="/tournaments" className="text-sm text-zinc-400 transition hover:text-zinc-200">
                Back to tournaments
              </Link>
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Community tournament</div>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-50">{tournament.name}</h1>
                <p className="mt-3 max-w-3xl text-sm text-zinc-400">
                  {tournament.description?.trim() || "A Riot-compliant community tournament draft."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                {String(tournament.platform ?? "sg2").toUpperCase()}
              </span>
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                {tournament.teamSize}v{tournament.teamSize}
              </span>
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                BO{tournament.bestOf ?? 1}
              </span>
              <span className="rounded-full bg-zinc-950/60 px-3 py-1 ring-1 ring-white/6">
                {displayTournamentStatus(tournament.status as never)}
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
              <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Registration</div>
              <div className="mt-2 text-sm text-zinc-300">
                Teams {verifiedTeams.length}/{tournament.maxTeams}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Closes {formatWhen(tournament.registrationClosesAt)}
              </div>
            </div>
            <div className="rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
              <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Check-in</div>
              <div className="mt-2 text-sm text-zinc-300">
                {checkedInTeams.length} checked-in team{checkedInTeams.length === 1 ? "" : "s"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Window {formatWhen(tournament.checkInOpensAt)} to {formatWhen(tournament.checkInClosesAt)}
              </div>
            </div>
            <div className="rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
              <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Participants</div>
              <div className="mt-2 text-sm text-zinc-300">{activeParticipants} active participants</div>
              <div className="mt-1 text-xs text-zinc-500">Riot minimum: 20 active participants</div>
            </div>
            <div className="rounded-[22px] bg-zinc-950/55 p-4 ring-1 ring-white/6">
              <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Riot state</div>
              <div className="mt-2 text-sm text-zinc-300">
                {tournament.riotApiState === "provisioned" ? "Provisioned" : "Not provisioned yet"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Compliance: {tournament.complianceStatus === "eligible" ? "Eligible" : "Blocked"}
              </div>
            </div>
          </div>

          {tournament.status === "draft" ? (
            <div className="mt-5 rounded-[24px] bg-amber-500/10 px-4 py-4 text-sm text-amber-200 ring-1 ring-amber-500/20">
              This tournament is still a draft. The organizer needs to open registration before
              teams can join.
            </div>
          ) : null}
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_380px]">
          <section className="space-y-6">
            <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6">
              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Bracket</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-50">Single elimination</div>
              </div>
              {bracketMatches.length ? (
                <TournamentBracket matches={bracketMatches} teams={bracketTeams} />
              ) : (
                <div className="text-sm text-zinc-500">
                  {tournament.status === "seeded" || tournament.status === "live" || tournament.status === "completed"
                    ? "Bracket will appear here once the organizer locks it."
                    : "The organizer has not locked the bracket yet."}
                </div>
              )}
            </section>

            <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6">
              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Teams</div>
                <div className="mt-1 text-2xl font-semibold text-zinc-50">Registered squads</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {teams.length ? (
                  teams.map((team) => (
                    <div key={String(team._id)} className="rounded-[24px] bg-zinc-950/50 p-4 ring-1 ring-white/6">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-zinc-100">{team.name}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {team.seed ? `Seed ${team.seed}` : "Seed pending"} •{" "}
                            {team.checkedIn ? "Checked in" : "Not checked in"} • {teamStatusLabel(team)}
                          </div>
                        </div>
                        {team.contactDiscord ? (
                          <div className="text-xs text-zinc-500">{team.contactDiscord}</div>
                        ) : null}
                      </div>

                      <div className="mt-4 space-y-2">
                        {Array.isArray(team.roster) && team.roster.length ? (
                          team.roster.map((member, index) => (
                            <div
                              key={`${member.gameNameNorm}-${member.tagLineNorm}-${index}`}
                              className="flex items-center justify-between gap-3 text-sm"
                            >
                              <div className="truncate text-zinc-200">
                                {member.gameName}#{member.tagLine}
                              </div>
                              <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                                {member.isCaptain ? "Captain" : inviteStatusLabel(member.inviteStatus ?? "")}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-zinc-500">No roster saved.</div>
                        )}
                      </div>

                      <div className="mt-3 text-xs text-zinc-500">
                        Accepted roster: {acceptedRosterCount(team.roster as never)}/{tournament.teamSize}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-500">No teams have signed up yet.</div>
                )}
              </div>
            </section>
          </section>

          <aside className="space-y-6">
            <TournamentRegisterForm
              slug={tournament.slug}
              teamSize={tournament.teamSize ?? 5}
              disabled={registrationClosed}
              statusLabel={displayTournamentStatus(tournament.status as never)}
              joinCodeRequired={joinCodeRequired}
              viewer={
                viewer
                  ? {
                      discordUserId: viewer.discordUserId,
                      discordUsername: viewer.discordUsername,
                      gameName: viewer.gameName,
                      tagLine: viewer.tagLine,
                    }
                  : null
              }
              viewerTeam={
                viewerTeam
                  ? {
                      id: String(viewerTeam._id),
                      name: viewerTeam.name,
                      status: viewerTeam.status,
                      verificationMode: viewerTeam.verificationMode ?? null,
                      isCaptain:
                        viewerTeam.roster?.some(
                          (entry) =>
                            String(entry.discordUserId ?? "").trim() === viewerDiscordUserId &&
                            !!entry.isCaptain
                        ) ?? false,
                      viewerInviteStatus:
                        viewerTeam.roster?.find(
                          (entry) => String(entry.discordUserId ?? "").trim() === viewerDiscordUserId
                        )?.inviteStatus ?? null,
                      contactDiscord: viewerTeam.contactDiscord ?? null,
                      roster: Array.isArray(viewerTeam.roster)
                        ? viewerTeam.roster.map((entry) => ({
                            discordUserId: entry.discordUserId ? String(entry.discordUserId) : null,
                            discordUsername: entry.discordUsername ?? null,
                            gameName: entry.gameName,
                            tagLine: entry.tagLine,
                            isCaptain: !!entry.isCaptain,
                            inviteStatus: entry.inviteStatus ?? "accepted",
                          }))
                        : [],
                    }
                  : null
              }
            />

            <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5">
              <div className="text-lg font-semibold text-zinc-100">Public rules</div>
              <div className="mt-3 space-y-2 text-sm text-zinc-400">
                {tournament.publicRulesText?.trim() ? (
                  tournament.publicRulesText
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, index) => <div key={`${line}-${index}`}>{line}</div>)
                ) : (
                  TOURNAMENT_POLICY_SUMMARY.map((item) => <div key={item}>{item}</div>)
                )}
              </div>
            </section>

            <section className="rounded-[28px] bg-zinc-900/25 p-5 ring-1 ring-white/5">
              <div className="text-lg font-semibold text-zinc-100">Organizer</div>
              <div className="mt-3 space-y-2 text-sm text-zinc-400">
                <div>Name: {tournament.organizerName?.trim() || "TBA"}</div>
                <div>Contact: {tournament.organizerContact?.trim() || "TBA"}</div>
                <div>Starts: {formatWhen(tournament.startsAt)}</div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function inviteStatusLabel(status: string) {
  if (status === "pending") return "Pending";
  if (status === "declined") return "Declined";
  return "Accepted";
}
