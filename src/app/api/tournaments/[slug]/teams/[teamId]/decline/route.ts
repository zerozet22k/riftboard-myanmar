import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireDiscordSessionFromRequest } from "@/lib/discordSession";
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
      { slug: 1, status: 1, registrationClosesAt: 1 }
    ).lean();
    if (!tournament?._id) {
      return NextResponse.json({ ok: false, error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.status !== "registration") {
      return NextResponse.json({ ok: false, error: "Registration is closed" }, { status: 400 });
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
      return NextResponse.json({ ok: false, error: "Captains cannot decline their own team." }, { status: 400 });
    }
    if (member.inviteStatus !== "pending") {
      return NextResponse.json({ ok: false, error: "You do not have a pending invite on this team." }, { status: 400 });
    }

    member.inviteStatus = "declined";
    member.declinedAt = new Date();
    member.acceptedAt = null;
    team.status = "forming";
    team.checkedIn = false;
    team.checkedInAt = null;
    team.seed = null;
    await team.save();

    revalidatePath(`/tournaments/${tournament.slug}`);
    revalidatePath(`/tournaments/${tournament.slug}/manage`);

    return NextResponse.json({
      ok: true,
      teamId: String(team._id),
      message: "Invite declined.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decline failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: /Connect Discord/i.test(message) ? 401 : 500 }
    );
  }
}
