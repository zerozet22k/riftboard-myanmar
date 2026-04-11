import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  clearAdminSessionCookie,
  isSecureRequest,
  isValidAdminCode,
  setAdminSessionCookie,
} from "@/lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AdminSessionSchema = z.object({
  code: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = AdminSessionSchema.safeParse(body);

  if (!parsed.success || !isValidAdminCode(parsed.data.code)) {
    return NextResponse.json({ ok: false, error: "Invalid code" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  setAdminSessionCookie(response, isSecureRequest(req));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearAdminSessionCookie(response);
  return response;
}
