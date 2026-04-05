import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordIntegrationEvent } from "@/lib/integrationEvents";
import { dbConnect } from "@/lib/mongodb";
import {
  createTournament,
  createTournamentCodes,
  createTournamentProvider,
  getRiotApiKey,
  getTournamentCode,
  getTournamentLobbyEvents,
  RiotApiError,
} from "@/lib/riot";
import { getAppBaseUrl, getTournamentCallbackToken, isRiotTournamentApiEnabled } from "@/lib/runtimeConfig";
import {
  activeParticipantCount,
  buildSingleElimBracket,
  createTournamentCodeMetadata,
  hashApiKey,
  hashToken,
  minimumTeamsForTournament,
} from "@/lib/tournaments";
import {
  applyTournamentMatchOutcome,
  extractLinkedMatchId,
  syncTournamentMatchFromRiot,
} from "@/lib/tournamentWorkflow";
import { Tournament } from "@/models/tournament";
import { TournamentMatch } from "@/models/tournamentMatch";
import { TournamentProvider } from "@/models/tournamentProvider";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SeedEntrySchema = z.object({
  teamId: z.string().trim().min(8),
  seed: z.coerce.number().int().min(1),
});

const ManageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open_registration"),
    token: z.string().trim().min(8),
  }),
  z.object({
    action: z.literal("open_check_in"),
    token: z.string().trim().min(8),
  }),
  z.object({
    action: z.literal("set_team_check_in"),
    token: z.string().trim().min(8),
    teamId: z.string().trim().min(8),
    checkedIn: z.boolean(),
  }),
  z.object({
    action: z.literal("save_seeds"),
    token: z.string().trim().min(8),
    seeds: z.array(SeedEntrySchema).min(1),
  }),
  z.object({
    action: z.literal("lock_bracket"),
    token: z.string().trim().min(8),
  }),
  z.object({
    action: z.literal("provision_riot"),
    token: z.string().trim().min(8),
  }),
  z.object({
    action: z.literal("generate_next_round_codes"),
    token: z.string().trim().min(8),
    round: z.coerce.number().int().min(1).optional(),
  }),
  z.object({
    action: z.literal("sync_match"),
    token: z.string().trim().min(8),
    matchId: z.string().trim().min(8),
  }),
  z.object({
    action: z.literal("adjudicate_match"),
    token: z.string().trim().min(8),
    matchId: z.string().trim().min(8),
    winnerTeamId: z.string().trim().min(8),
    note: z.string().trim().min(8).max(500),
    scoreA: z.coerce.number().int().min(0).max(5).optional(),
    scoreB: z.coerce.number().int().min(0).max(5).optional(),
  }),
]);

function matchReadyForCode(match: {
  teamAId?: unknown;
  teamBId?: unknown;
  tournamentCode?: string | null;
  status?: string | null;
}) {
  return !!match.teamAId && !!match.teamBId && !match.tournamentCode && match.status !== "completed";
}

function resolveCallbackBaseUrl(req: NextRequest) {
  const configured = getAppBaseUrl();
  const requestOrigin = req.nextUrl.origin;
  const configuredHost = (() => {
    try {
      return new URL(configured).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  const usesLocalConfiguredHost =
    configuredHost === "127.0.0.1" || configuredHost === "localhost" || configuredHost === "0.0.0.0";

  if (usesLocalConfiguredHost && requestOrigin && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(requestOrigin)) {
    return requestOrigin;
  }

  return configured;
}

async function loadTournamentForManage(slug: string, token: string) {
  const tournament = await Tournament.findOne(
    { slug: String(slug).trim().toLowerCase() },
    {
      name: 1,
      slug: 1,
      platform: 1,
      matchRegion: 1,
      teamSize: 1,
      bestOf: 1,
      status: 1,
      riotApiState: 1,
      riotProviderId: 1,
      riotTournamentId: 1,
      complianceStatus: 1,
      callbackToken: 1,
      bracketSize: 1,
      manageTokenHash: 1,
    }
  )
    .select("+manageTokenHash")
    .exec();

  if (!tournament?._id) {
    return { error: "Tournament not found", tournament: null as null };
  }

  if (tournament.manageTokenHash !== hashToken(token)) {
    return { error: "Invalid manage token", tournament: null as null };
  }

  return { error: null, tournament };
}

async function ensureReusableProvider(platform: string, callbackUrl: string) {
  const apiKeyHash = hashApiKey(getRiotApiKey());
  const existing = await TournamentProvider.findOne({
    platform,
    callbackBaseUrl: callbackUrl,
    apiKeyHash,
  }).lean();

  if (existing?.providerId) return existing.providerId;

  const providerId = await createTournamentProvider(platform, callbackUrl);
  await TournamentProvider.create({
    platform,
    callbackBaseUrl: callbackUrl,
    apiKeyHash,
    providerId,
  });
  return providerId;
}

function validateSeedAssignments(
  checkedInTeamIds: string[],
  seeds: Array<{ teamId: string; seed: number }>
) {
  if (seeds.length !== checkedInTeamIds.length) {
    return "Every checked-in team must have exactly one seed.";
  }

  const teamSet = new Set(checkedInTeamIds);
  const seenTeams = new Set<string>();
  const seenSeeds = new Set<number>();

  for (const entry of seeds) {
    if (!teamSet.has(entry.teamId)) return "Seeds can only be assigned to checked-in teams.";
    if (seenTeams.has(entry.teamId)) return "Each checked-in team can only be seeded once.";
    if (seenSeeds.has(entry.seed)) return "Seed numbers must be unique.";
    seenTeams.add(entry.teamId);
    seenSeeds.add(entry.seed);
  }

  for (let seed = 1; seed <= seeds.length; seed++) {
    if (!seenSeeds.has(seed)) return "Seeds must be consecutive starting from 1.";
  }

  return null;
}

function nextRoundNeedingCodes(
  matches: Array<{
    round: number;
    teamAId?: unknown;
    teamBId?: unknown;
    tournamentCode?: string | null;
    status?: string | null;
  }>
) {
  const rounds = [...new Set(matches.filter(matchReadyForCode).map((match) => match.round))].sort((a, b) => a - b);
  return rounds[0] ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = ManageActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid manage action" }, { status: 400 });
    }

    await dbConnect();

    const loaded = await loadTournamentForManage(slug, parsed.data.token);
    if (loaded.error || !loaded.tournament) {
      return NextResponse.json({ ok: false, error: loaded.error }, { status: 401 });
    }

    const tournament = loaded.tournament;

    if (parsed.data.action === "open_registration") {
      if (tournament.status !== "draft") {
        return NextResponse.json({ ok: false, error: "Tournament is no longer in draft" }, { status: 400 });
      }

      tournament.status = "registration";
      await tournament.save();
      revalidatePath("/tournaments");
      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);
      return NextResponse.json({ ok: true, status: tournament.status });
    }

    if (parsed.data.action === "open_check_in") {
      if (!["registration", "draft"].includes(tournament.status)) {
        return NextResponse.json(
          { ok: false, error: "Tournament cannot enter check-in from its current state" },
          { status: 400 }
        );
      }

      tournament.status = "check_in";
      await tournament.save();
      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);
      return NextResponse.json({ ok: true, status: tournament.status });
    }

    if (parsed.data.action === "set_team_check_in") {
      if (tournament.status !== "check_in") {
        return NextResponse.json({ ok: false, error: "Tournament is not in check-in" }, { status: 400 });
      }

      const team = await TournamentTeam.findOne({
        _id: parsed.data.teamId,
        tournamentId: tournament._id,
      });

      if (!team?._id) {
        return NextResponse.json({ ok: false, error: "Team not found" }, { status: 404 });
      }

      if (team.verificationMode !== "discord_verified" || team.status === "forming") {
        return NextResponse.json(
          { ok: false, error: "Only fully verified teams can be checked in." },
          { status: 400 }
        );
      }

      team.checkedIn = parsed.data.checkedIn;
      team.checkedInAt = parsed.data.checkedIn ? new Date() : null;
      team.status = parsed.data.checkedIn ? "checked_in" : "registered";
      if (!parsed.data.checkedIn) {
        team.seed = null;
      }
      await team.save();

      if (parsed.data.checkedIn) {
        await recordIntegrationEvent({
          eventType: "team_checked_in",
          aggregateType: "team",
          aggregateId: String(team._id),
          tournamentId: tournament._id,
          payload: {
            tournamentId: String(tournament._id),
            teamId: String(team._id),
            teamName: team.name,
          },
        });
      }

      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);
      return NextResponse.json({ ok: true, checkedIn: team.checkedIn });
    }

    if (parsed.data.action === "save_seeds") {
      if (tournament.status !== "check_in") {
        return NextResponse.json(
          { ok: false, error: "Seeds can only be edited during check-in" },
          { status: 400 }
        );
      }

      const existingMatches = await TournamentMatch.countDocuments({ tournamentId: tournament._id });
      if (existingMatches > 0) {
        return NextResponse.json({ ok: false, error: "Bracket is already locked" }, { status: 400 });
      }

      const checkedInTeams = await TournamentTeam.find(
        {
          tournamentId: tournament._id,
          verificationMode: "discord_verified",
          checkedIn: true,
          status: { $in: ["checked_in", "active", "registered"] },
        },
        { name: 1, seed: 1 }
      )
        .sort({ createdAt: 1, _id: 1 })
        .lean();

      const validationError = validateSeedAssignments(
        checkedInTeams.map((team) => String(team._id)),
        parsed.data.seeds
      );
      if (validationError) {
        return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
      }

      await TournamentTeam.updateMany(
        { tournamentId: tournament._id, checkedIn: false },
        { $set: { seed: null } }
      );
      await Promise.all(
        parsed.data.seeds.map((entry) =>
          TournamentTeam.updateOne(
            { _id: entry.teamId, tournamentId: tournament._id },
            { $set: { seed: entry.seed, status: "checked_in", checkedIn: true } }
          )
        )
      );

      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);
      return NextResponse.json({ ok: true, saved: parsed.data.seeds.length });
    }

    if (parsed.data.action === "lock_bracket") {
      if (tournament.status !== "check_in") {
        return NextResponse.json(
          { ok: false, error: "Bracket can only be locked from check-in" },
          { status: 400 }
        );
      }

      const existingMatches = await TournamentMatch.countDocuments({ tournamentId: tournament._id });
      if (existingMatches > 0) {
        return NextResponse.json({ ok: false, error: "Bracket already generated" }, { status: 400 });
      }

      const teams = await TournamentTeam.find(
        {
          tournamentId: tournament._id,
          verificationMode: "discord_verified",
          checkedIn: true,
          status: { $in: ["checked_in", "active", "registered"] },
        },
        { name: 1, seed: 1, checkedIn: 1, status: 1, createdAt: 1 }
      )
        .sort({ seed: 1, createdAt: 1, _id: 1 })
        .lean();

      const minimumTeams = minimumTeamsForTournament(tournament.teamSize ?? 5);
      if (teams.length < minimumTeams) {
        return NextResponse.json(
          {
            ok: false,
            error: `Need at least ${minimumTeams} checked-in teams to satisfy Riot's 20 participant minimum.`,
          },
          { status: 400 }
        );
      }

      const participantTotal = activeParticipantCount(teams.length, tournament.teamSize ?? 5);
      if (participantTotal < 20) {
        return NextResponse.json(
          { ok: false, error: "Riot requires at least 20 active participants before bracket lock." },
          { status: 400 }
        );
      }

      const seeds = teams.map((team) => ({
        teamId: String(team._id),
        seed: typeof team.seed === "number" ? team.seed : 0,
      }));
      const seedValidation = validateSeedAssignments(
        teams.map((team) => String(team._id)),
        seeds
      );
      if (seedValidation) {
        return NextResponse.json({ ok: false, error: seedValidation }, { status: 400 });
      }

      const bracket = buildSingleElimBracket(
        seeds.map((entry) => ({ id: entry.teamId, seed: entry.seed })),
        tournament.bestOf ?? 1
      );

      await TournamentMatch.insertMany(
        bracket.matches.map((match) => ({
          tournamentId: tournament._id,
          round: match.round,
          slot: match.slot,
          bestOf: match.bestOf,
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          teamASeed: match.teamASeed,
          teamBSeed: match.teamBSeed,
          winnerTeamId: match.winnerTeamId,
          loserTeamId: match.loserTeamId,
          status: match.status,
          note: match.note,
          advanceToRound: match.advanceToRound,
          advanceToSlot: match.advanceToSlot,
          advanceToSide: match.advanceToSide,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          codeMetadata: null,
          codeGeneratedAt: null,
          completedAt: match.status === "completed" ? new Date() : null,
          resultSource: null,
        }))
      );

      tournament.bracketGeneratedAt = new Date();
      tournament.bracketSize = bracket.bracketSize;
      tournament.seedsLockedAt = new Date();
      tournament.status = "seeded";
      await tournament.save();

      await recordIntegrationEvent({
        eventType: "bracket_locked",
        aggregateType: "tournament",
        aggregateId: String(tournament._id),
        tournamentId: tournament._id,
        payload: {
          tournamentId: String(tournament._id),
          slug: tournament.slug,
          teamCount: teams.length,
          participantTotal,
          bracketSize: bracket.bracketSize,
        },
      });

      revalidatePath("/tournaments");
      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);

      return NextResponse.json({
        ok: true,
        bracketSize: bracket.bracketSize,
        rounds: bracket.totalRounds,
      });
    }

    if (parsed.data.action === "provision_riot") {
      if (!isRiotTournamentApiEnabled()) {
        return NextResponse.json(
          {
            ok: false,
            error: "Riot Tournament API is disabled for this deployment. Set RIOT_TOURNAMENT_API_ENABLED=true after approval.",
          },
          { status: 400 }
        );
      }

      if (!["seeded", "live", "completed"].includes(tournament.status)) {
        return NextResponse.json(
          { ok: false, error: "Lock the bracket before provisioning Riot tournament resources." },
          { status: 400 }
        );
      }

      if (tournament.riotTournamentId) {
        return NextResponse.json({
          ok: true,
          providerId: tournament.riotProviderId,
          tournamentId: tournament.riotTournamentId,
          reused: true,
        });
      }

      const callbackUrl = `${resolveCallbackBaseUrl(req)}/api/tournaments/callback/${getTournamentCallbackToken()}`;
      const providerId = await ensureReusableProvider(tournament.platform ?? "sg2", callbackUrl);
      const riotTournamentId = await createTournament(
        tournament.platform ?? "sg2",
        providerId,
        `${tournament.name} - ${tournament.slug}`
      );

      tournament.riotProviderId = providerId;
      tournament.riotTournamentId = riotTournamentId;
      tournament.riotProvisionedAt = new Date();
      tournament.riotApiState = "provisioned";
      tournament.riotLastError = null;
      await tournament.save();

      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);

      return NextResponse.json({
        ok: true,
        providerId,
        tournamentId: riotTournamentId,
        reused: false,
      });
    }

    if (parsed.data.action === "generate_next_round_codes") {
      if (!isRiotTournamentApiEnabled()) {
        return NextResponse.json(
          { ok: false, error: "Riot Tournament API is disabled for this deployment." },
          { status: 400 }
        );
      }

      if (!tournament.riotTournamentId || tournament.riotApiState !== "provisioned") {
        return NextResponse.json(
          { ok: false, error: "Provision the Riot tournament before generating match codes." },
          { status: 400 }
        );
      }

      const matches = await TournamentMatch.find(
        { tournamentId: tournament._id },
        {
          round: 1,
          slot: 1,
          teamAId: 1,
          teamBId: 1,
          tournamentCode: 1,
          status: 1,
        }
      )
        .sort({ round: 1, slot: 1 })
        .lean();

      const targetRound = parsed.data.round ?? nextRoundNeedingCodes(matches);
      if (!targetRound) {
        return NextResponse.json({ ok: false, error: "No ready matches need Riot codes." }, { status: 400 });
      }

      const readyMatches = matches.filter(
        (match) => match.round === targetRound && matchReadyForCode(match)
      );
      if (!readyMatches.length) {
        return NextResponse.json({ ok: false, error: "No ready matches in that round." }, { status: 400 });
      }

      const generatedCodes: Array<{ matchId: string; round: number; slot: number; code: string }> = [];

      for (const match of readyMatches) {
        const metadata = createTournamentCodeMetadata({
          tournamentId: String(tournament._id),
          slug: tournament.slug,
          matchId: String(match._id),
          round: match.round,
          slot: match.slot,
        });
        const codes = await createTournamentCodes(
          tournament.platform ?? "sg2",
          tournament.riotTournamentId,
          1,
          {
            teamSize: tournament.teamSize ?? 5,
            metadata,
          }
        );

        const tournamentCode = Array.isArray(codes) ? codes[0] : null;
        if (!tournamentCode) continue;

        await TournamentMatch.updateOne(
          { _id: match._id },
          {
            $set: {
              tournamentCode,
              codeMetadata: metadata,
              codeGeneratedAt: new Date(),
              status: "code_ready",
            },
          }
        );

        generatedCodes.push({
          matchId: String(match._id),
          round: match.round,
          slot: match.slot,
          code: tournamentCode,
        });

        await recordIntegrationEvent({
          eventType: "match_code_ready",
          aggregateType: "match",
          aggregateId: String(match._id),
          tournamentId: tournament._id,
          payload: {
            tournamentId: String(tournament._id),
            matchId: String(match._id),
            round: match.round,
            slot: match.slot,
            tournamentCode,
          },
        });
      }

      if (generatedCodes.length && tournament.status === "seeded") {
        tournament.status = "live";
        await tournament.save();
      }

      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);

      return NextResponse.json({
        ok: true,
        generated: generatedCodes.length,
        round: targetRound,
        generatedCodes,
      });
    }

    if (parsed.data.action === "sync_match") {
      const match = await TournamentMatch.findOne({
        _id: parsed.data.matchId,
        tournamentId: tournament._id,
      });

      if (!match?._id) {
        return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
      }

      if (!match.tournamentCode) {
        return NextResponse.json({ ok: false, error: "This match does not have a Riot code yet." }, { status: 400 });
      }

      const [codeDetails, lobbyEvents] = await Promise.all([
        getTournamentCode(tournament.platform ?? "sg2", match.tournamentCode),
        getTournamentLobbyEvents(tournament.platform ?? "sg2", match.tournamentCode),
      ]);

      const linkedMatchId = match.linkedMatchId ?? extractLinkedMatchId(codeDetails);
      let synchronized = false;

      if (linkedMatchId && match.linkedMatchId !== linkedMatchId) {
        match.linkedMatchId = linkedMatchId;
        await match.save();
      }

      if (linkedMatchId && match.status !== "completed") {
        await syncTournamentMatchFromRiot({
          tournament,
          match,
          linkedMatchId,
          resultSource: "sync",
        });
        synchronized = true;
      }

      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);
      revalidatePath("/tournaments");

      return NextResponse.json({
        ok: true,
        linkedMatchId,
        synchronized,
        lobbyEventCount: Array.isArray((lobbyEvents as { eventList?: unknown[] }).eventList)
          ? ((lobbyEvents as { eventList?: unknown[] }).eventList?.length ?? 0)
          : 0,
      });
    }

    const match = await TournamentMatch.findOne({
      _id: parsed.data.matchId,
      tournamentId: tournament._id,
    });

    if (!match?._id) {
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    await applyTournamentMatchOutcome({
      tournament,
      match,
      winnerTeamId: parsed.data.winnerTeamId,
      resultSource: "manual",
      note: parsed.data.note,
      scoreA: parsed.data.scoreA,
      scoreB: parsed.data.scoreB,
    });

    revalidatePath(`/tournaments/${tournament.slug}`);
    revalidatePath(`/tournaments/${tournament.slug}/manage`);
    revalidatePath("/tournaments");

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof RiotApiError) {
      const riotErrorMessage =
        error.status === 403
          ? "Riot API forbidden. Check RIOT_API_KEY approval, validity, and Tournament API access."
          : `Riot API ${error.status}: ${error.body}`;
      return NextResponse.json(
        {
          ok: false,
          error: riotErrorMessage,
          details:
            error.status === 403
              ? {
                  riotMessage: error.body,
                  riotUrl: error.url,
                }
              : undefined,
        },
        { status: error.status === 403 ? 403 : error.status >= 500 ? 502 : 400 }
      );
    }

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Manage action failed" },
      { status: 500 }
    );
  }
}
