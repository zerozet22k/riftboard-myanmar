import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbConnect } from "@/lib/mongodb";
import { requireDiscordSessionFromRequest } from "@/lib/discordSession";
import { activeRosterCount, findRosterMemberByDiscordUserId } from "@/lib/tournamentTeams";
import { makeRosterEntry } from "@/lib/tournaments";
import { DiscordLink } from "@/models/discordLink";
import { Tournament } from "@/models/tournament";
import { TournamentTeam } from "@/models/tournamentTeam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InviteSchema = z.object({
  playerId: z.string().trim().min(8),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; teamId: string }> }
) {
  try {
    const session = await requireDiscordSessionFromRequest(req);
    const { slug, teamId } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid invite input" }, { status: 400 });
    }

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
      status: { $ne: "dropped" },
    });
    if (!team?._id) {
      return NextResponse.json({ ok: false, error: "Team not found" }, { status: 404 });
    }

    const captain = Array.isArray(team.roster) ? team.roster.find((entry) => entry.isCaptain) : null;
    if (!captain?.discordUserId || captain.discordUserId !== session.discordUserId) {
      return NextResponse.json({ ok: false, error: "Only the captain can invite teammates." }, { status: 403 });
    }

    if (team.status !== "forming") {
      return NextResponse.json({ ok: false, error: "This team is already locked." }, { status: 400 });
    }

    const targetLink = await DiscordLink.findOne(
      {
        playerId: parsed.data.playerId,
        verifiedBinding: true,
        verificationSource: "discord_connections",
      },
      {
        discordUserId: 1,
        discordUsername: 1,
        playerId: 1,
        gameName: 1,
        tagLine: 1,
      }
    ).lean();

    if (!targetLink?.discordUserId) {
      return NextResponse.json({ ok: false, error: "That player is not a verified Riftboard member yet." }, { status: 404 });
    }

    if (String(targetLink.discordUserId) === session.discordUserId) {
      return NextResponse.json({ ok: false, error: "You are already the captain of this team." }, { status: 400 });
    }

    const existingMember = findRosterMemberByDiscordUserId(team.roster, String(targetLink.discordUserId));
    if (existingMember?.inviteStatus === "accepted") {
      return NextResponse.json({ ok: false, error: "That player is already on your roster." }, { status: 400 });
    }
    if (existingMember?.inviteStatus === "pending") {
      return NextResponse.json({ ok: false, error: "That player already has a pending invite." }, { status: 400 });
    }

    if (activeRosterCount(team.roster) >= (tournament.teamSize ?? 1)) {
      return NextResponse.json({ ok: false, error: "Your roster is already full." }, { status: 400 });
    }

    const otherTeamConflict = await TournamentTeam.findOne(
      {
        tournamentId: tournament._id,
        verificationMode: "discord_verified",
        status: { $ne: "dropped" },
        _id: { $ne: team._id },
        roster: {
          $elemMatch: {
            discordUserId: String(targetLink.discordUserId),
            inviteStatus: { $in: ["pending", "accepted"] },
          },
        },
      },
      { name: 1 }
    ).lean();

    if (otherTeamConflict?.name) {
      return NextResponse.json(
        { ok: false, error: `That player is already reserved on ${otherTeamConflict.name}.` },
        { status: 400 }
      );
    }

    const now = new Date();
    if (existingMember) {
      existingMember.playerId = String(targetLink.playerId);
      existingMember.discordUserId = String(targetLink.discordUserId);
      existingMember.discordUsername = targetLink.discordUsername ?? null;
      existingMember.gameName = targetLink.gameName;
      existingMember.tagLine = targetLink.tagLine;
      existingMember.gameNameNorm = targetLink.gameName.trim().toLowerCase();
      existingMember.tagLineNorm = targetLink.tagLine.trim().toLowerCase();
      existingMember.inviteStatus = "pending";
      existingMember.invitedAt = now;
      existingMember.acceptedAt = null;
      existingMember.declinedAt = null;
    } else {
      team.roster.push(
        makeRosterEntry({
          playerId: String(targetLink.playerId),
          discordUserId: String(targetLink.discordUserId),
          discordUsername: targetLink.discordUsername ?? null,
          gameName: targetLink.gameName,
          tagLine: targetLink.tagLine,
          isCaptain: false,
          inviteStatus: "pending",
          invitedAt: now,
        })
      );
    }

    team.checkedIn = false;
    team.checkedInAt = null;
    team.seed = null;
    team.status = "forming";
    await team.save();

    revalidatePath(`/tournaments/${tournament.slug}`);
    revalidatePath(`/tournaments/${tournament.slug}/manage`);

    return NextResponse.json({
      ok: true,
      teamId: String(team._id),
      invitedDiscordUserId: String(targetLink.discordUserId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: /Connect Discord/i.test(message) ? 401 : 500 }
    );
  }
}
