import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbConnect } from "@/lib/mongodb";
import { platformToMatchRegion } from "@/lib/riot";
import {
  getTournamentCallbackToken,
  getTournamentHostCode,
  isRiotTournamentApiEnabled,
} from "@/lib/runtimeConfig";
import {
  hashToken,
  makeToken,
  slugifyTournamentName,
  validateTournamentStructure,
} from "@/lib/tournaments";
import { Tournament } from "@/models/tournament";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateTournamentSchema = z.object({
  name: z.string().trim().min(3).max(80),
  slug: z.string().trim().max(48).optional(),
  description: z.string().trim().max(1600).optional(),
  publicRulesText: z.string().trim().max(3000).optional(),
  organizerName: z.string().trim().max(60).optional(),
  organizerContact: z.string().trim().max(120).optional(),
  platform: z.string().trim().min(2).max(8).optional(),
  teamSize: z.coerce.number().int().min(1).max(5).optional(),
  maxTeams: z.coerce.number().int().min(2).max(64).optional(),
  bestOf: z.coerce.number().int().min(1).max(5).optional(),
  startsAt: z.string().trim().optional(),
  registrationClosesAt: z.string().trim().optional(),
  checkInOpensAt: z.string().trim().optional(),
  checkInClosesAt: z.string().trim().optional(),
  hostCode: z.string().trim().optional(),
  policyAcknowledged: z.boolean().optional(),
});

function parseDateOrNull(value?: string) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function makeUniqueSlug(baseInput: string) {
  const base = slugifyTournamentName(baseInput) || `tournament-${Date.now()}`;

  for (let attempt = 0; attempt < 50; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await Tournament.exists({ slug });
    if (!existing) return slug;
  }

  throw new Error("Could not generate a unique tournament slug");
}

function validateTournamentDates(input: {
  startsAt: Date | null;
  registrationClosesAt: Date | null;
  checkInOpensAt: Date | null;
  checkInClosesAt: Date | null;
}) {
  if (input.registrationClosesAt && input.startsAt && input.registrationClosesAt > input.startsAt) {
    return "Registration must close before the tournament starts";
  }

  if (
    input.checkInOpensAt &&
    input.registrationClosesAt &&
    input.checkInOpensAt < input.registrationClosesAt
  ) {
    return "Check-in cannot open before registration closes";
  }

  if (input.checkInClosesAt && input.checkInOpensAt && input.checkInClosesAt < input.checkInOpensAt) {
    return "Check-in close time must be after check-in opens";
  }

  if (input.checkInClosesAt && input.startsAt && input.checkInClosesAt > input.startsAt) {
    return "Check-in must close before the tournament starts";
  }

  return null;
}

export async function GET() {
  await dbConnect();

  const tournaments = await Tournament.find(
    {},
    {
      name: 1,
      slug: 1,
      description: 1,
      publicRulesText: 1,
      platform: 1,
      teamSize: 1,
      maxTeams: 1,
      bestOf: 1,
      status: 1,
      complianceStatus: 1,
      riotApiState: 1,
      startsAt: 1,
      createdAt: 1,
    }
  )
    .sort({ startsAt: 1, createdAt: -1 })
    .lean();

  return NextResponse.json({ ok: true, tournaments, riotTournamentApiEnabled: isRiotTournamentApiEnabled() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateTournamentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid tournament input" }, { status: 400 });
    }

    const requiredHostCode = getTournamentHostCode();
    if (requiredHostCode && parsed.data.hostCode !== requiredHostCode) {
      return NextResponse.json({ ok: false, error: "Wrong community code" }, { status: 401 });
    }

    if (!parsed.data.policyAcknowledged) {
      return NextResponse.json(
        { ok: false, error: "You must acknowledge Riot's tournament policy requirements." },
        { status: 400 }
      );
    }

    const teamSize = parsed.data.teamSize ?? 5;
    const maxTeams = parsed.data.maxTeams ?? 8;
    const structure = validateTournamentStructure(teamSize, maxTeams);
    if (!structure.ok) {
      return NextResponse.json({ ok: false, error: structure.error }, { status: 400 });
    }

    const bestOf = parsed.data.bestOf ?? 1;
    if (![1, 3, 5].includes(bestOf)) {
      return NextResponse.json({ ok: false, error: "Best-of must be 1, 3, or 5" }, { status: 400 });
    }

    const startsAt = parseDateOrNull(parsed.data.startsAt);
    const registrationClosesAt = parseDateOrNull(parsed.data.registrationClosesAt);
    const checkInOpensAt = parseDateOrNull(parsed.data.checkInOpensAt);
    const checkInClosesAt = parseDateOrNull(parsed.data.checkInClosesAt);
    if (parsed.data.startsAt && !startsAt) {
      return NextResponse.json({ ok: false, error: "Invalid start time" }, { status: 400 });
    }
    if (parsed.data.registrationClosesAt && !registrationClosesAt) {
      return NextResponse.json(
        { ok: false, error: "Invalid registration close time" },
        { status: 400 }
      );
    }
    if (parsed.data.checkInOpensAt && !checkInOpensAt) {
      return NextResponse.json({ ok: false, error: "Invalid check-in open time" }, { status: 400 });
    }
    if (parsed.data.checkInClosesAt && !checkInClosesAt) {
      return NextResponse.json({ ok: false, error: "Invalid check-in close time" }, { status: 400 });
    }

    const dateError = validateTournamentDates({
      startsAt,
      registrationClosesAt,
      checkInOpensAt,
      checkInClosesAt,
    });
    if (dateError) {
      return NextResponse.json({ ok: false, error: dateError }, { status: 400 });
    }

    const platform = String(parsed.data.platform ?? "sg2").trim().toLowerCase();
    const matchRegion = platformToMatchRegion(platform);
    const riotApiEnabled = isRiotTournamentApiEnabled();

    await dbConnect();
    const slug = await makeUniqueSlug(parsed.data.slug || parsed.data.name);
    const manageToken = makeToken();
    const callbackToken = getTournamentCallbackToken();

    const tournament = await Tournament.create({
      name: parsed.data.name,
      slug,
      description: parsed.data.description || undefined,
      publicRulesText: parsed.data.publicRulesText || undefined,
      organizerName: parsed.data.organizerName || undefined,
      organizerContact: parsed.data.organizerContact || undefined,
      platform,
      matchRegion,
      format: "single_elimination",
      teamSize,
      maxTeams,
      bestOf,
      startsAt,
      registrationClosesAt,
      checkInOpensAt,
      checkInClosesAt,
      status: "draft",
      complianceStatus: "eligible",
      riotApiState: riotApiEnabled ? "not_provisioned" : "disabled",
      policyAcknowledgedAt: new Date(),
      policyAcknowledgedBy:
        parsed.data.organizerName?.trim() ||
        parsed.data.organizerContact?.trim() ||
        "organizer",
      callbackToken,
      manageTokenHash: hashToken(manageToken),
    });

    revalidatePath("/tournaments");

    return NextResponse.json({
      ok: true,
      slug,
      path: `/tournaments/${slug}`,
      managePath: `/tournaments/${slug}/manage?token=${manageToken}`,
      tournamentId: String(tournament._id),
      riotTournamentApiEnabled: riotApiEnabled,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Create failed" },
      { status: 500 }
    );
  }
}
