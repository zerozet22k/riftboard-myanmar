"use client";

import { useMemo, useState } from "react";

const CDRAGON_PROFILE_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons";

function buildSources(iconId?: number | null, ddragonVersion?: string | null) {
  const normalizedId = typeof iconId === "number" && iconId >= 0 ? iconId : 29;
  const sources = [];

  if (ddragonVersion) {
    sources.push(
      `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${normalizedId}.png`
    );
  }

  sources.push(`${CDRAGON_PROFILE_BASE}/${normalizedId}.jpg`);
  sources.push(`${CDRAGON_PROFILE_BASE}/29.jpg`);
  return sources;
}

export default function ProfileAvatar({
  iconId,
  ddragonVersion,
  alt,
  className = "",
  level,
}: {
  iconId?: number | null;
  ddragonVersion?: string | null;
  alt: string;
  className?: string;
  level?: number | null;
}) {
  const sources = useMemo(() => buildSources(iconId, ddragonVersion), [iconId, ddragonVersion]);
  const sourceKey = sources.join("|");

  return (
    <ProfileAvatarImage
      key={sourceKey}
      sources={sources}
      alt={alt}
      className={className}
      level={level}
    />
  );
}

function ProfileAvatarImage({
  sources,
  alt,
  className,
  level,
}: {
  sources: string[];
  alt: string;
  className: string;
  level?: number | null;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const src = sources[Math.min(sourceIndex, sources.length - 1)];

  return (
    <div className={`relative overflow-hidden rounded-[22px] border border-zinc-700/70 bg-zinc-900/60 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => {
          setSourceIndex((current) => (current < sources.length - 1 ? current + 1 : current));
        }}
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_55%)]" />

      {level != null ? (
        <div className="absolute bottom-1.5 right-1.5 rounded-full border border-black/20 bg-zinc-950/90 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-100 shadow-lg">
          {level}
        </div>
      ) : null}
    </div>
  );
}
