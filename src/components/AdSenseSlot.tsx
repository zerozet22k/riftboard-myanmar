"use client";

import { useEffect, useRef } from "react";
import { getAdSenseClientId, normalizeAdSenseSlotId } from "@/lib/adsense";

type AdSenseWindow = Window & {
  adsbygoogle?: Array<Record<string, never>>;
};

export default function AdSenseSlot({
  slotId,
  className = "",
  format = "auto",
}: {
  slotId?: string | null;
  className?: string;
  format?: "auto" | "rectangle" | "horizontal" | "vertical";
}) {
  const initialized = useRef(false);
  const clientId = getAdSenseClientId();
  const normalizedSlotId = normalizeAdSenseSlotId(slotId);

  useEffect(() => {
    if (!clientId || !normalizedSlotId || initialized.current) return;

    initialized.current = true;
    try {
      const adsWindow = window as AdSenseWindow;
      (adsWindow.adsbygoogle ??= []).push({});
    } catch {
      initialized.current = false;
    }
  }, [clientId, normalizedSlotId]);

  if (!clientId || !normalizedSlotId) return null;

  return (
    <aside
      aria-label="Advertisement"
      className={`overflow-hidden rounded-[20px] border border-white/6 bg-zinc-900/16 px-3 py-2 ${className}`}
    >
      <div className="mb-1.5 text-center text-[10px] uppercase tracking-[0.18em] text-zinc-600">
        Advertisement
      </div>
      <ins
        className="adsbygoogle block min-h-[90px] w-full"
        data-ad-client={clientId}
        data-ad-slot={normalizedSlotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </aside>
  );
}
