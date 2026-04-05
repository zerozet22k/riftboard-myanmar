import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { recordIntegrationEvent } from "@/lib/integrationEvents";
import { dbConnect } from "@/lib/mongodb";
import { requireDiscordSessionFromRequest } from "@/lib/discordSession";
import { teamReadyForRegistration } from "@/lib/tournamentTeams";
import { Tournament } from "@/models/tournament";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; teamId: string }> }
) {
  try {
    const session = await requireDiscordSessionFromRequest(req);
    const { slug, teamId } = await params;
    await dbConnect();

    const tournament = await Tournament.findOne(
      { slug: String(slug).trim().toLowerCase() },
      { slug: 1, status: 1, teamSize: 1, registrationClosesAt: 1 }
    ).lean();
    if (!tournament?._id) {
      return NextResponse.json({ ok: false, error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.status !== "registration") {
      return NextResponse.json({ ok: false, error: "Registration is closed" }, { status: 400 });
    }

    if (
      tournament.registrationClosesAt &&
      new Date(tournament.registrationClosesAt).getTime() < Date.now()
    ) {
      return NextResponse.json({ ok: false, error: "Registration deadline has already passed" }, { status: 400 });
    }

    const team = await TournamentTeam.findOne({
      _id: teamId,
      tournamentId: tournament._id,
      verificationMode: "discord_verified",
      status: { $in: ["forming", "registered"] },
    });
    if (!team?._id) {
      return NextResponse.json({ ok: false, error: "Team not found" }, { status: 404 });
    }

    const member = Array.isArray(team.roster)
      ? team.roster.find((entry) => String(entry.discordUserId ?? "").trim() === session.discordUserId)
      : null;
    if (!member) {
      return NextResponse.json({ ok: false, error: "You are not on this team." }, { status: 403 });
    }
    if (member.isCaptain) {
      return NextResponse.json({ ok: false, error: "Captains do not need to accept their own team." }, { status: 400 });
    }
    if (member.inviteStatus !== "pending") {
      return NextResponse.json({ ok: false, error: "You do not have a pending invite on this team." }, { status: 400 });
    }

    const now = new Date();
    member.playerId = session.playerId;
    member.discordUserId = session.discordUserId;
    member.discordUsername = session.discordUsername;
    member.gameName = session.gameName;
    member.tagLine = session.tagLine;
    member.gameNameNorm = session.gameName.trim().toLowerCase();
    member.tagLineNorm = session.tagLine.trim().toLowerCase();
    member.inviteStatus = "accepted";
    member.acceptedAt = now;
    member.declinedAt = null;
    member.invitedAt = member.invitedAt ?? now;

    const becameRegistered = teamReadyForRegistration(
      team.roster,
      tournament.teamSize ?? 1,
      team.verificationMode ?? null
    );

    team.status = becameRegistered ? "registered" : "forming";
    team.checkedIn = false;
    team.checkedInAt = null;
    team.seed = null;
    await team.save();

    if (becameRegistered) {
      await recordIntegrationEvent({
        eventType: "team_registered",
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

    return NextResponse.json({
      ok: true,
      teamId: String(team._id),
      status: team.status,
      message: becameRegistered ? "You joined the team." : "Invite accepted.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Accept failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: /Connect Discord/i.test(message) ? 401 : 500 }
    );
  }
}
