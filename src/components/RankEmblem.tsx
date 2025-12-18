"use client";

import { useEffect, useState } from "react";

const RANK_ICON_BASE =
  "https://raw.communitydragon.org/15.6/plugins/rcp-fe-lol-shared-components/global/default";

function tierIconUrl(tier?: string | null) {
  if (!tier) return `${RANK_ICON_BASE}/normal.png`;
  return `${RANK_ICON_BASE}/${String(tier).toLowerCase()}.png`;
}

export default function RankEmblem({
  tier,
  className = "",
  alt = "",
}: {
  tier?: string | null;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState(() => tierIconUrl(tier));

  useEffect(() => {
    setSrc(tierIconUrl(tier));
  }, [tier]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        if (src.endsWith("/normal.png")) return;
        setSrc(`${RANK_ICON_BASE}/normal.png`);
      }}
    />
  );
}
