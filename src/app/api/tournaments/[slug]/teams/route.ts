import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  grantStoredCommunityAccessForDiscordUser,
  hasCommunityAccessFromRequest,
  hasStoredCommunityAccessForDiscordUser,
  setCommunityAccessCookie,
} from "@/lib/communityAccess";
import { recordIntegrationEvent } from "@/lib/integrationEvents";
import { dbConnect } from "@/lib/mongodb";
import { requireDiscordSessionFromRequest } from "@/lib/discordSession";
import { getCommunityJoinCodes } from "@/lib/runtimeConfig";
import { makeRosterEntry } from "@/lib/tournaments";
import { Tournament } from "@/models/tournament";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateTeamSchema = z.object({
  teamName: z.string().trim().min(2).max(40),
  contactDiscord: z.string().trim().max(120).optional(),
  code: z.string().trim().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await requireDiscordSessionFromRequest(req);
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = CreateTeamSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid team input" }, { status: 400 });
    }

    const requiredCodes = getCommunityJoinCodes();
    const unlockedBrowser = hasCommunityAccessFromRequest(req);
    const unlockedAccount = await hasStoredCommunityAccessForDiscordUser(session.discordUserId);
    const providedCode = String(parsed.data.code ?? "").trim();
    const acceptedCode = requiredCodes.includes(providedCode);
    if (requiredCodes.length && !unlockedBrowser && !unlockedAccount && !acceptedCode) {
      return NextResponse.json({ ok: false, error: "Wrong community code" }, { status: 401 });
    }

    await dbConnect();

    const tournament = await Tournament.findOne(
      { slug: String(slug).trim().toLowerCase() },
      {
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
        { ok: false, error: "Registration is not open for this tournament" },
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

    const reservedTeams = await TournamentTeam.countDocuments({
      tournamentId: tournament._id,
      verificationMode: "discord_verified",
      status: { $ne: "dropped" },
    });
    if (reservedTeams >= (tournament.maxTeams ?? 0)) {
      return NextResponse.json({ ok: false, error: "Tournament is full" }, { status: 400 });
    }

    const existingMembership = await TournamentTeam.findOne(
      {
        tournamentId: tournament._id,
        verificationMode: "discord_verified",
        status: { $ne: "dropped" },
        roster: {
          $elemMatch: {
            discordUserId: session.discordUserId,
            inviteStatus: { $in: ["pending", "accepted"] },
          },
        },
      },
      { name: 1 }
    ).lean();

    if (existingMembership?.name) {
      return NextResponse.json(
        { ok: false, error: `You are already attached to ${existingMembership.name} in this tournament.` },
        { status: 400 }
      );
    }

    const existingName = await TournamentTeam.exists({
      tournamentId: tournament._id,
      verificationMode: "discord_verified",
      status: { $ne: "dropped" },
      nameNorm: parsed.data.teamName.trim().toLowerCase(),
    });
    if (existingName) {
      return NextResponse.json({ ok: false, error: "That team name is already taken" }, { status: 400 });
    }

    const now = new Date();
    const created = await TournamentTeam.create({
      tournamentId: tournament._id,
      name: parsed.data.teamName,
      nameNorm: parsed.data.teamName.trim().toLowerCase(),
      contactDiscord: parsed.data.contactDiscord || undefined,
      verificationMode: "discord_verified",
      roster: [
        makeRosterEntry({
          playerId: session.playerId,
          discordUserId: session.discordUserId,
          discordUsername: session.discordUsername,
          gameName: session.gameName,
          tagLine: session.tagLine,
          isCaptain: true,
          inviteStatus: "accepted",
          invitedAt: now,
          acceptedAt: now,
        }),
      ],
      status: (tournament.teamSize ?? 1) === 1 ? "registered" : "forming",
      checkedIn: false,
      checkedInAt: null,
      seed: null,
    });

    if ((tournament.teamSize ?? 1) === 1) {
      await recordIntegrationEvent({
        eventType: "team_registered",
        aggregateType: "team",
        aggregateId: String(created._id),
        tournamentId: tournament._id,
        payload: {
          tournamentId: String(tournament._id),
          teamId: String(created._id),
          teamName: created.name,
        },
      });
    }

    revalidatePath("/tournaments");
    revalidatePath(`/tournaments/${tournament.slug}`);
    revalidatePath(`/tournaments/${tournament.slug}/manage`);

    const response = NextResponse.json({
      ok: true,
      teamId: String(created._id),
      status: created.status,
      message: (tournament.teamSize ?? 1) === 1 ? "You are registered." : "Team created. Invite teammates next.",
    });

    if (acceptedCode) {
      await grantStoredCommunityAccessForDiscordUser(session.discordUserId);
      setCommunityAccessCookie(response, req.nextUrl.protocol === "https:");
    } else if (!unlockedBrowser && unlockedAccount) {
      setCommunityAccessCookie(response, req.nextUrl.protocol === "https:");
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: /Connect Discord/i.test(message) ? 401 : 500 }
    );
  }
}
