import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbConnect } from "@/lib/mongodb";
import { getPuuidByRiotId } from "@/lib/riot";
import { makeRosterEntry, parseRiotId, parseRosterLines } from "@/lib/tournaments";
import { Tournament } from "@/models/tournament";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RegisterTeamSchema = z.object({
  teamName: z.string().trim().min(2).max(40),
  captainRiotId: z.string().trim().min(3).max(40),
  rosterText: z.string().trim().optional(),
  contactDiscord: z.string().trim().max(120).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = RegisterTeamSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid team input" }, { status: 400 });
    }

    await dbConnect();

    const tournament = await Tournament.findOne(
      { slug: String(slug).trim().toLowerCase() },
      {
        name: 1,
        slug: 1,
        status: 1,
        teamSize: 1,
        maxTeams: 1,
        registrationClosesAt: 1,
      }
    ).lean();

    if (!tournament?._id) {
      return NextResponse.json({ ok: false, error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.status !== "registration") {
      return NextResponse.json(
        { ok: false, error: "Registration is closed for this tournament" },
        { status: 400 }
      );
    }

    if (
      tournament.registrationClosesAt &&
      new Date(tournament.registrationClosesAt).getTime() < Date.now()
    ) {
      return NextResponse.json(
        { ok: false, error: "Registration deadline has already passed" },
        { status: 400 }
      );
    }

    const existingCount = await TournamentTeam.countDocuments({
      tournamentId: tournament._id,
      status: { $ne: "dropped" },
    });
    if (existingCount >= tournament.maxTeams) {
      return NextResponse.json({ ok: false, error: "Tournament is full" }, { status: 400 });
    }

    const rawIds = [
      parsed.data.captainRiotId,
      ...parseRosterLines(parsed.data.rosterText ?? ""),
    ];

    const parsedIds = rawIds
      .map((entry, index) => {
        const riotId = parseRiotId(entry);
        return riotId ? { ...riotId, isCaptain: index === 0 } : null;
      })
      .filter((value): value is { gameName: string; tagLine: string; isCaptain: boolean } => !!value);

    const deduped = parsedIds.filter((entry, index, list) => {
      return (
        list.findIndex(
          (other) =>
            other.gameName.trim().toLowerCase() === entry.gameName.trim().toLowerCase() &&
            other.tagLine.trim().toLowerCase() === entry.tagLine.trim().toLowerCase()
        ) === index
      );
    });

    if (deduped.length !== tournament.teamSize) {
      return NextResponse.json(
        {
          ok: false,
          error:
            tournament.teamSize === 1
              ? "Enter exactly one Riot ID"
              : `Enter exactly ${tournament.teamSize} unique Riot IDs (captain first)`,
        },
        { status: 400 }
      );
    }

    const resolvedRoster = await Promise.all(
      deduped.map(async (entry) => {
        const account = await getPuuidByRiotId(entry.gameName, entry.tagLine);
        return makeRosterEntry({
          gameName: account.gameName ?? entry.gameName,
          tagLine: account.tagLine ?? entry.tagLine,
          puuid: account.puuid,
          isCaptain: entry.isCaptain,
        });
      })
    );

    const existingName = await TournamentTeam.exists({
      tournamentId: tournament._id,
      nameNorm: parsed.data.teamName.trim().toLowerCase(),
    });
    if (existingName) {
      return NextResponse.json({ ok: false, error: "That team name is already taken" }, { status: 400 });
    }

    const rosterPuuids = resolvedRoster.map((entry) => entry.puuid).filter((value): value is string => !!value);
    if (rosterPuuids.length) {
      const existingRosterConflict = await TournamentTeam.findOne(
        {
          tournamentId: tournament._id,
          status: { $ne: "dropped" },
          "roster.puuid": { $in: rosterPuuids },
        },
        { name: 1 }
      ).lean();

      if (existingRosterConflict?.name) {
        return NextResponse.json(
          {
            ok: false,
            error: `One of those players is already registered on ${existingRosterConflict.name}`,
          },
          { status: 400 }
        );
      }
    }

    const created = await TournamentTeam.create({
      tournamentId: tournament._id,
      name: parsed.data.teamName,
      nameNorm: parsed.data.teamName.trim().toLowerCase(),
      contactDiscord: parsed.data.contactDiscord || undefined,
      roster: resolvedRoster,
      status: "registered",
      checkedIn: false,
      seed: null,
    });

    revalidatePath("/tournaments");
    revalidatePath(`/tournaments/${tournament.slug}`);
    revalidatePath(`/tournaments/${tournament.slug}/manage`);

    return NextResponse.json({
      ok: true,
      teamId: String(created._id),
      message: "Team registered",
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Registration failed" },
      { status: 500 }
    );
  }
}
