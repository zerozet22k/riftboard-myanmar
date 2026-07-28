"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  getAdSenseClientId,
  getAdSenseSlotIdForPathname,
} from "@/lib/adsense";

export default function AdSenseScript() {
  const pathname = usePathname();
  const clientId = getAdSenseClientId();
  const slotId = getAdSenseSlotIdForPathname(pathname);

  if (!clientId || !slotId) return null;

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
