"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { getAdSenseClientId } from "@/lib/adsense";

function hasAdPlacement(pathname: string) {
  return pathname === "/" || pathname === "/leaderboard";
}

export default function AdSenseScript() {
  const pathname = usePathname();
  const clientId = getAdSenseClientId();

  if (!clientId || !hasAdPlacement(pathname)) return null;

  return (
    <Script
      id="riftboard-adsense"
      async
      strategy="afterInteractive"
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`}
    />
  );
}
