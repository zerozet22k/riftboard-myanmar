import { getGoogleAdsTxtRecord } from "@/lib/adsense";

export const revalidate = 3600;

export function GET() {
  const record = getGoogleAdsTxtRecord();

  if (!record) {
    return new Response("# RiftBoard AdSense is not configured.\n", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  }

  return new Response(`${record}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
