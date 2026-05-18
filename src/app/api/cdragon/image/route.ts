import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOST = "raw.communitydragon.org";
const MAX_ATTEMPTS = 3;

function validCommunityDragonUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST) return null;
    if (!url.pathname.startsWith("/latest/") && !/^\/\d+\.\d+\//.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function retryUrl(url: URL, attempt: number) {
  const next = new URL(url);
  next.searchParams.set("rb_img_try", String(attempt));
  return next;
}

export async function GET(req: NextRequest) {
  const source = validCommunityDragonUrl(req.nextUrl.searchParams.get("src"));
  if (!source) {
    return NextResponse.json({ ok: false, error: "Invalid CommunityDragon image URL" }, { status: 400 });
  }

  let lastStatus = 502;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const url = attempt === 0 ? source : retryUrl(source, attempt);
    const response = await fetch(url, {
      headers: { "User-Agent": "RiftBoard/1.0" },
      cache: attempt === 0 ? "force-cache" : "no-store",
      next: attempt === 0 ? { revalidate: 60 * 60 * 24 * 7 } : undefined,
    }).catch(() => null);

    if (!response) continue;
    lastStatus = response.status;
    if (!response.ok) continue;

    const contentType = response.headers.get("content-type") || "image/png";
    const body = await response.arrayBuffer();
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      },
    });
  }

  return NextResponse.json(
    { ok: false, error: `CommunityDragon image unavailable (${lastStatus})` },
    { status: 502 }
  );
}
