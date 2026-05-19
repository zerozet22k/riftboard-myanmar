export type RankLike = {
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
} | null | undefined;

type HighEloLevel = "diamond" | "master" | "grandmaster" | "challenger";

export type HighEloRead = {
  level: HighEloLevel;
  label: string;
  shortLabel: string;
  title: string;
};

const TIER_POWER: Record<string, number> = {
  IRON: 1,
  BRONZE: 2,
  SILVER: 3,
  GOLD: 4,
  PLATINUM: 5,
  EMERALD: 6,
  DIAMOND: 7,
  MASTER: 8,
  GRANDMASTER: 9,
  CHALLENGER: 10,
};

const DIVISION_POWER: Record<string, number> = {
  IV: 1,
  III: 2,
  II: 3,
  I: 4,
};

function rankPower(rank: RankLike) {
  const tier = String(rank?.tier ?? "").toUpperCase();
  const tierPower = TIER_POWER[tier];
  if (!tierPower) return -1;
  const divisionPower = DIVISION_POWER[String(rank?.division ?? "").toUpperCase()] ?? 0;
  const lp = Number.isFinite(Number(rank?.lp)) ? Number(rank?.lp) : 0;
  return tierPower * 100000 + divisionPower * 1000 + lp;
}

export function bestRank(...ranks: RankLike[]) {
  return ranks
    .filter(Boolean)
    .sort((left, right) => rankPower(right) - rankPower(left))[0] ?? null;
}

export function highEloRead(rank: RankLike): HighEloRead | null {
  const tier = String(rank?.tier ?? "").toUpperCase();
  const division = String(rank?.division ?? "").toUpperCase();

  if (tier === "CHALLENGER") {
    return {
      level: "challenger",
      label: "Apex Lobby",
      shortLabel: "Apex",
      title: "Top-end lobby detected. RiftBoard gives this match a cleaner spotlight.",
    };
  }
  if (tier === "GRANDMASTER") {
    return {
      level: "grandmaster",
      label: "Elite Lobby",
      shortLabel: "Elite",
      title: "Elite lobby detected. The match card gets a stronger frame.",
    };
  }
  if (tier === "MASTER") {
    return {
      level: "master",
      label: "Pressure Lobby",
      shortLabel: "Pressure",
      title: "High-pressure lobby detected. The match card gets a stronger frame.",
    };
  }
  if (tier === "DIAMOND" && ["I", "II", "III"].includes(division)) {
    return {
      level: "diamond",
      label: "Sharp Lobby",
      shortLabel: "Sharp",
      title: "Sharper ranked lobby detected. RiftBoard gives this match a little more presence.",
    };
  }

  return null;
}

export function bestHighEloRead(...ranks: RankLike[]) {
  return highEloRead(bestRank(...ranks));
}

export function highEloCardClass(read: HighEloRead | null) {
  if (!read) return "";
  if (read.level === "challenger") {
    return "border border-yellow-200/35 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.20),transparent_34%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(63,35,5,0.30))] shadow-[0_0_28px_rgba(250,204,21,0.12)]";
  }
  if (read.level === "grandmaster") {
    return "border border-red-300/30 bg-[radial-gradient(circle_at_top_left,rgba(248,113,113,0.18),transparent_34%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(76,29,149,0.24))] shadow-[0_0_26px_rgba(248,113,113,0.10)]";
  }
  if (read.level === "master") {
    return "border border-fuchsia-300/28 bg-[radial-gradient(circle_at_top_left,rgba(217,70,239,0.18),transparent_34%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(49,46,129,0.24))] shadow-[0_0_24px_rgba(217,70,239,0.10)]";
  }
  return "border border-sky-300/24 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.15),transparent_34%),linear-gradient(135deg,rgba(24,24,27,0.98),rgba(14,116,144,0.16))] shadow-[0_0_18px_rgba(56,189,248,0.08)]";
}

export function highEloBadgeClass(read: HighEloRead | null) {
  if (!read) return "";
  if (read.level === "challenger") return "border-yellow-200/45 bg-yellow-300/15 text-yellow-50";
  if (read.level === "grandmaster") return "border-red-300/40 bg-red-400/12 text-red-50";
  if (read.level === "master") return "border-fuchsia-300/40 bg-fuchsia-400/12 text-fuchsia-50";
  return "border-sky-300/35 bg-sky-400/10 text-sky-50";
}
