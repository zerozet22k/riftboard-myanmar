import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Manual roster registration is disabled. Connect Discord and use the verified team flow on the tournament page.",
    },
    { status: 410 }
  );
}
