import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createTournamentStub,
  createTournamentStubCodes,
  createTournamentStubProvider,
  RiotApiError,
} from "@/lib/riot";
import { dbConnect } from "@/lib/mongodb";
import { getAppBaseUrl } from "@/lib/runtimeConfig";
import { buildSingleElimBracket, hashToken } from "@/lib/tournaments";
import { Tournament } from "@/models/tournament";
import { TournamentMatch } from "@/models/tournamentMatch";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ManageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("seed_bracket"),
    token: z.string().trim().min(8),
  }),
  z.object({
    action: z.literal("generate_codes"),
    token: z.string().trim().min(8),
    round: z.coerce.number().int().min(1).optional(),
  }),
  z.object({
    action: z.literal("report_result"),
    token: z.string().trim().min(8),
    matchId: z.string().trim().min(8),
    winnerTeamId: z.string().trim().min(8),
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

function pickTargetRound(
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

function buildManualTournamentCode(slug: string, round: number, slot: number) {
  const safeSlug = String(slug ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `MAN-${safeSlug || "TOUR"}-R${round}S${slot}-${rand}`;
}

async function loadTournamentForManage(slug: string, token: string) {
  const tournament = await Tournament.findOne(
    { slug: String(slug).trim().toLowerCase() },
    {
      name: 1,
      slug: 1,
      platform: 1,
      teamSize: 1,
      bestOf: 1,
      status: 1,
      providerId: 1,
      stubTournamentId: 1,
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

    if (parsed.data.action === "seed_bracket") {
      const existingMatches = await TournamentMatch.countDocuments({ tournamentId: tournament._id });
      if (existingMatches > 0) {
        return NextResponse.json({ ok: false, error: "Bracket already generated" }, { status: 400 });
      }

      const teams = await TournamentTeam.find(
        {
          tournamentId: tournament._id,
          status: { $in: ["registered", "checked_in", "active"] },
        },
        { name: 1, seed: 1, status: 1, createdAt: 1 }
      )
        .sort({ createdAt: 1, _id: 1 })
        .lean();

      if (teams.length < 2) {
        return NextResponse.json({ ok: false, error: "Need at least 2 teams to seed" }, { status: 400 });
      }

      const seededTeams = teams.map((team, index) => ({
        id: String(team._id),
        seed: index + 1,
      }));

      const bracket = buildSingleElimBracket(seededTeams, tournament.bestOf ?? 1);

      await TournamentTeam.bulkWrite(
        teams.map((team, index) => ({
          updateOne: {
            filter: { _id: team._id },
            update: {
              $set: {
                seed: index + 1,
                status: "active",
              },
            },
          },
        }))
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
        }))
      );

      tournament.bracketGeneratedAt = new Date();
      tournament.bracketSize = bracket.bracketSize;
      tournament.status = "live";
      await tournament.save();

      revalidatePath("/tournaments");
      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);

      return NextResponse.json({
        ok: true,
        bracketSize: bracket.bracketSize,
        rounds: bracket.totalRounds,
      });
    }

    if (parsed.data.action === "generate_codes") {
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

      const targetRound = parsed.data.round ?? pickTargetRound(matches);
      if (!targetRound) {
        return NextResponse.json({ ok: false, error: "No ready matches need codes" }, { status: 400 });
      }

      const readyMatches = matches.filter(
        (match) => match.round === targetRound && matchReadyForCode(match)
      );
      const generatedCodes: Array<{ matchId: string; round: number; slot: number; code: string }> = [];

      if (!readyMatches.length) {
        return NextResponse.json({ ok: false, error: "No ready matches in that round" }, { status: 400 });
      }

      const applyManualCodes = async () => {
        for (const match of readyMatches) {
          const manualCode = buildManualTournamentCode(tournament.slug, match.round, match.slot);
          await TournamentMatch.updateOne(
            { _id: match._id },
            {
              $set: {
                tournamentCode: manualCode,
                status: "code_ready",
              },
            }
          );
          generatedCodes.push({
            matchId: String(match._id),
            round: match.round,
            slot: match.slot,
            code: manualCode,
          });
        }
      };

      const ensureStubResources = async (forceRecreate = false) => {
        if (!forceRecreate && tournament.providerId && tournament.stubTournamentId) return;

        const callbackUrl = `${resolveCallbackBaseUrl(req)}/api/tournaments/callback/${tournament.callbackToken}`;
        const providerId = await createTournamentStubProvider(tournament.platform ?? "sg2", callbackUrl);
        const stubTournamentId = await createTournamentStub(
          tournament.platform ?? "sg2",
          providerId,
          `${tournament.name} - ${tournament.slug}`
        );

        tournament.providerId = providerId;
        tournament.stubTournamentId = stubTournamentId;
        await tournament.save();
      };

      let recoveredFromStaleStub = false;
      let manualFallbackCount = 0;
      const allowManualCodeFallback = process.env.TOURNAMENT_MANUAL_CODE_FALLBACK !== "0";

      try {
        await ensureStubResources(false);
      } catch (error) {
        const canFallback =
          allowManualCodeFallback && error instanceof RiotApiError && error.status === 403;
        if (!canFallback) throw error;

        await applyManualCodes();
        manualFallbackCount = readyMatches.length;

        revalidatePath(`/tournaments/${tournament.slug}`);
        revalidatePath(`/tournaments/${tournament.slug}/manage`);

        return NextResponse.json({
          ok: true,
          generated: readyMatches.length,
          round: targetRound,
          generatedCodes,
          manualFallbackCount,
          warning:
            "Riot tournament API is forbidden for this key; generated manual lobby codes instead.",
        });
      }

      for (const match of readyMatches) {
        let tournamentCode: string | null = null;
        try {
          const codes = await createTournamentStubCodes(
            tournament.platform ?? "sg2",
            tournament.stubTournamentId!,
            1,
            {
              teamSize: tournament.teamSize ?? 5,
              metadata: JSON.stringify({
                slug: tournament.slug,
                round: match.round,
                slot: match.slot,
              }),
            }
          );
          tournamentCode = Array.isArray(codes) ? codes[0] : null;
        } catch (error) {
          const shouldRecover =
            error instanceof RiotApiError && (error.status === 403 || error.status === 404);

          if (!shouldRecover || recoveredFromStaleStub) throw error;

          recoveredFromStaleStub = true;
          try {
            await ensureStubResources(true);
          } catch (recreateError) {
            const canFallback =
              allowManualCodeFallback && recreateError instanceof RiotApiError && recreateError.status === 403;
            if (!canFallback) throw recreateError;

            tournamentCode = buildManualTournamentCode(tournament.slug, match.round, match.slot);
            manualFallbackCount += 1;
            if (!tournamentCode) continue;

            await TournamentMatch.updateOne(
              { _id: match._id },
              {
                $set: {
                  tournamentCode,
                  status: "code_ready",
                },
              }
            );
            continue;
          }

          try {
            const codes = await createTournamentStubCodes(
              tournament.platform ?? "sg2",
              tournament.stubTournamentId!,
              1,
              {
                teamSize: tournament.teamSize ?? 5,
                metadata: JSON.stringify({
                  slug: tournament.slug,
                  round: match.round,
                  slot: match.slot,
                }),
              }
            );
            tournamentCode = Array.isArray(codes) ? codes[0] : null;
          } catch (retryError) {
            const canFallback =
              allowManualCodeFallback &&
              retryError instanceof RiotApiError &&
              retryError.status === 403;
            if (!canFallback) throw retryError;

            tournamentCode = buildManualTournamentCode(tournament.slug, match.round, match.slot);
            manualFallbackCount += 1;
          }
        }

        if (!tournamentCode) continue;

        await TournamentMatch.updateOne(
          { _id: match._id },
          {
            $set: {
              tournamentCode,
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
      }

      revalidatePath(`/tournaments/${tournament.slug}`);
      revalidatePath(`/tournaments/${tournament.slug}/manage`);

      return NextResponse.json({
        ok: true,
        generated: readyMatches.length,
        round: targetRound,
        generatedCodes,
        manualFallbackCount,
        warning:
          manualFallbackCount > 0
            ? "Riot tournament API is forbidden for this key; generated manual lobby codes instead."
            : undefined,
      });
    }

    const match = await TournamentMatch.findOne({
      _id: parsed.data.matchId,
      tournamentId: tournament._id,
    });

    if (!match?._id) {
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    if (match.status === "completed" && match.winnerTeamId) {
      return NextResponse.json({ ok: false, error: "That match is already completed" }, { status: 400 });
    }

    const winnerId = String(parsed.data.winnerTeamId);
    const teamAId = match.teamAId ? String(match.teamAId) : null;
    const teamBId = match.teamBId ? String(match.teamBId) : null;

    if (winnerId !== teamAId && winnerId !== teamBId) {
      return NextResponse.json({ ok: false, error: "Winner must be one of the two teams" }, { status: 400 });
    }

    const loserId = winnerId === teamAId ? teamBId : teamAId;
    const winnerSeed = winnerId === teamAId ? match.teamASeed ?? null : match.teamBSeed ?? null;

    match.set("winnerTeamId", parsed.data.winnerTeamId);
    match.set("loserTeamId", loserId);
    match.status = "completed";
    match.scoreA = parsed.data.scoreA ?? (winnerId === teamAId ? 1 : 0);
    match.scoreB = parsed.data.scoreB ?? (winnerId === teamBId ? 1 : 0);
    await match.save();

    if (loserId) {
      await TournamentTeam.updateOne({ _id: loserId }, { $set: { status: "eliminated" } });
    }

    if (match.advanceToRound && match.advanceToSlot && match.advanceToSide) {
      const updatePath = match.advanceToSide === "A" ? "teamAId" : "teamBId";
      const updateSeedPath = match.advanceToSide === "A" ? "teamASeed" : "teamBSeed";

      const nextMatch = await TournamentMatch.findOne({
        tournamentId: tournament._id,
        round: match.advanceToRound,
        slot: match.advanceToSlot,
      });

      if (nextMatch?._id) {
        nextMatch.set(updatePath, parsed.data.winnerTeamId);
        nextMatch.set(updateSeedPath, winnerSeed);
        nextMatch.status = nextMatch.teamAId && nextMatch.teamBId ? "ready" : "pending";
        await nextMatch.save();
      }

      await TournamentTeam.updateOne({ _id: winnerId }, { $set: { status: "active" } });
    } else {
      await TournamentTeam.updateOne({ _id: winnerId }, { $set: { status: "winner" } });
      tournament.status = "completed";
      await tournament.save();
    }

    revalidatePath(`/tournaments/${tournament.slug}`);
    revalidatePath(`/tournaments/${tournament.slug}/manage`);
    revalidatePath("/tournaments");

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof RiotApiError) {
      const riotErrorMessage =
        error.status === 403
          ? "Riot API forbidden. Check RIOT_API_KEY validity/expiry and tournament access for this key."
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
