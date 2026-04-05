import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getTournamentCode, RiotApiError } from "@/lib/riot";
import { getTournamentCallbackToken } from "@/lib/runtimeConfig";
import { parseTournamentCodeMetadata } from "@/lib/tournaments";
import {
  extractLinkedMatchId,
  extractTournamentCodeFromPayload,
  syncTournamentMatchFromRiot,
} from "@/lib/tournamentWorkflow";
import { Tournament } from "@/models/tournament";
import { TournamentMatch } from "@/models/tournamentMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (String(token).trim() !== getTournamentCallbackToken()) {
    return NextResponse.json({ ok: false, error: "Invalid callback token" }, { status: 401 });
  }

  await dbConnect();

  const payload = await req.json().catch(() => ({}));
  const tournamentCode = extractTournamentCodeFromPayload(payload);
  if (!tournamentCode) {
    return NextResponse.json({ ok: false, error: "Missing tournament code in callback" }, { status: 400 });
  }

  const match = await TournamentMatch.findOne({ tournamentCode });
  if (!match?._id) {
    return NextResponse.json({ ok: false, error: "Tournament code not recognized" }, { status: 404 });
  }

  match.lastCallbackAt = new Date();
  match.lastCallbackPayload = payload;
  match.callbackCount = (match.callbackCount ?? 0) + 1;

  const tournament = await Tournament.findById(match.tournamentId);
  if (!tournament?._id) {
    await match.save();
    return NextResponse.json({ ok: false, error: "Tournament not found for callback" }, { status: 404 });
  }

  let linkedMatchId = extractLinkedMatchId(payload);

  try {
    const codeDetails = await getTournamentCode(tournament.platform ?? "sg2", tournamentCode);
    const callbackMetadata = parseTournamentCodeMetadata(
      typeof codeDetails?.metadata === "string" ? codeDetails.metadata : match.codeMetadata
    );

    if (callbackMetadata && callbackMetadata.matchId !== String(match._id)) {
      match.note = "Rejected callback because Riot metadata did not match the stored match.";
      await match.save();
      return NextResponse.json({ ok: false, error: "Metadata mismatch for callback" }, { status: 409 });
    }

    linkedMatchId = linkedMatchId ?? extractLinkedMatchId(codeDetails);
  } catch (error) {
    if (!(error instanceof RiotApiError)) throw error;
  }

  if (linkedMatchId) {
    match.linkedMatchId = linkedMatchId;
  }
  await match.save();

  if (linkedMatchId && match.status !== "completed") {
    await syncTournamentMatchFromRiot({
      tournament,
      match,
      linkedMatchId,
      resultSource: "callback",
      callbackPayload: payload,
    });
  }

  return NextResponse.json({ ok: true, linkedMatchId });
}
