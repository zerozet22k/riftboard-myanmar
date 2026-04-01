import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Tournament } from "@/models/tournament";
import { TournamentMatch } from "@/models/tournamentMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  await dbConnect();

  const tournament = await Tournament.findOne(
    { callbackToken: String(token).trim() },
    { slug: 1 }
  ).lean();

  if (!tournament?._id) {
    return NextResponse.json({ ok: false, error: "Callback not found" }, { status: 404 });
  }

  const payload = await req.json().catch(() => ({}));
  const tournamentCode = firstString([
    (payload as Record<string, unknown>)?.shortCode,
    (payload as Record<string, unknown>)?.tournamentCode,
    (payload as Record<string, unknown>)?.code,
    (payload as Record<string, unknown>)?.shortcode,
  ]);
  const linkedMatchId = firstString([
    (payload as Record<string, unknown>)?.matchId,
    (payload as Record<string, unknown>)?.gameId,
  ]);

  if (tournamentCode) {
    await TournamentMatch.updateOne(
      { tournamentId: tournament._id, tournamentCode },
      {
        $set: {
          lastCallbackAt: new Date(),
          lastCallbackPayload: payload,
          ...(linkedMatchId ? { linkedMatchId } : {}),
        },
        $inc: { callbackCount: 1 },
      }
    );
  }

  return NextResponse.json({ ok: true });
}
