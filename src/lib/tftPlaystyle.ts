export type TftPlaystyleMatch = {
  level?: number | null;
  goldLeft?: number | null;
  totalDamageToPlayers?: number | null;
  units?: Array<{
    characterId?: string | null;
    name?: string | null;
    displayName?: string | null;
    rarity?: number | null;
    tier?: number | null;
    itemNames?: string[];
    itemIcons?: Array<{ id: string; displayName: string; iconUrl?: string | null }>;
  }>;
};

export type TftPlaystyleAxis = {
  left: string;
  right: string;
  value: number;
  icon: string;
  label: string;
};

export type TftPlaystyleSummary = {
  badges: Array<{ icon: string; label: string; tone: "sky" | "amber" | "emerald" | "rose" }>;
  axes: TftPlaystyleAxis[];
};

const AXIS_TONES: Array<TftPlaystyleSummary["badges"][number]["tone"]> = [
  "sky",
  "amber",
  "rose",
  "emerald",
];

const AD_WORDS = [
  "sword",
  "rageblade",
  "edge",
  "slayer",
  "deathblade",
  "infinity",
  "whisper",
  "bloodthirster",
  "titan",
  "sterak",
  "runaan",
  "hurricane",
  "breaker",
];

const AP_WORDS = [
  "rod",
  "archangel",
  "deathcap",
  "jeweled",
  "nashor",
  "blue",
  "shojin",
  "morello",
  "ionic",
  "adaptive",
  "spark",
  "gauntlet",
];

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function axisLabel(left: string, right: string, value: number) {
  if (value < 42) return left;
  if (value > 58) return right;
  return "Balanced";
}

function itemText(unit: NonNullable<TftPlaystyleMatch["units"]>[number]) {
  const iconText = (unit.itemIcons ?? []).map((item) => `${item.id} ${item.displayName}`).join(" ");
  return `${unit.itemNames?.join(" ") ?? ""} ${iconText}`.toLowerCase();
}

export function analyzeTftPlaystyle(matches: TftPlaystyleMatch[]): TftPlaystyleSummary {
  const window = matches.slice(0, 20);
  const carries = window
    .map((match) =>
      [...(match.units ?? [])]
        .sort(
          (left, right) =>
            (right.itemNames?.length ?? 0) - (left.itemNames?.length ?? 0) ||
            (right.tier ?? 0) - (left.tier ?? 0) ||
            (right.rarity ?? 0) - (left.rarity ?? 0)
        )[0]
    )
    .filter(Boolean)
    .map((unit) => String(unit.characterId ?? unit.name ?? unit.displayName ?? "").toLowerCase())
    .filter(Boolean);
  const flexible = carries.length ? clamp((new Set(carries).size / carries.length) * 135) : 50;

  const levelMatches = window.filter((match) => match.level != null);
  const goldMatches = window.filter((match) => match.goldLeft != null);
  const avgLevel = levelMatches.length
    ? levelMatches.reduce((sum, match) => sum + (match.level ?? 0), 0) / levelMatches.length
    : 0;
  const avgGold = goldMatches.length
    ? goldMatches.reduce((sum, match) => sum + (match.goldLeft ?? 0), 0) / goldMatches.length
    : 0;
  const tempo = clamp(42 + (avgLevel - 7) * 24 + (12 - avgGold) * 2);

  const damageMatches = window.filter((match) => match.totalDamageToPlayers != null);
  const avgDamage = damageMatches.length
    ? damageMatches.reduce((sum, match) => sum + (match.totalDamageToPlayers ?? 0), 0) / damageMatches.length
    : 0;
  const damage = clamp((avgDamage / 165) * 100);

  let adSignals = 0;
  let apSignals = 0;
  for (const match of window) {
    for (const unit of match.units ?? []) {
      const label = itemText(unit);
      if (AD_WORDS.some((word) => label.includes(word))) adSignals += 1;
      if (AP_WORDS.some((word) => label.includes(word))) apSignals += 1;
    }
  }
  const ap = adSignals + apSignals ? (apSignals / (adSignals + apSignals)) * 100 : 50;

  const axes = [
    { left: "Flexible", right: "Forcer", value: flexible, icon: flexible > 58 ? "FOR" : flexible < 42 ? "FLX" : "BAL", label: axisLabel("Flexible", "Forcer", flexible) },
    { left: "Economy", right: "Tempo", value: tempo, icon: tempo > 58 ? "TMP" : tempo < 42 ? "ECO" : "BAL", label: axisLabel("Economy", "Tempo", tempo) },
    { left: "Tank", right: "Damage", value: damage, icon: damage > 58 ? "DMG" : damage < 42 ? "TNK" : "BAL", label: axisLabel("Tank", "Damage", damage) },
    { left: "AD", right: "AP", value: ap, icon: ap > 58 ? "AP" : ap < 42 ? "AD" : "HYB", label: axisLabel("AD", "AP", ap) },
  ];

  const badges = axes
    .map((axis, index) => ({
      icon: axis.icon,
      label: axis.label,
      tone: AXIS_TONES[index],
      strength: Math.abs(axis.value - 50),
    }))
    .filter((badge) => badge.label !== "Balanced" && badge.strength >= 8)
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 3)
    .map(({ icon, label, tone }) => ({ icon, label, tone }));

  return {
    axes,
    badges: badges.length ? badges : [{ icon: "BAL", label: "Balanced", tone: "sky" }],
  };
}
