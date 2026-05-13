export type MatchPerformanceTone = "elite" | "good" | "warn" | "bad" | "awful" | "neutral";

export type MatchPerformanceBadge = {
  label: string;
  tone: MatchPerformanceTone;
  title: string;
  kind: "verdict" | "fact";
};

export type MatchPerformanceInput = {
  gameDuration?: number | null;
  teamPosition?: string | null;
  win?: boolean | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  largestMultiKill?: number | null;
  doubleKills?: number | null;
  tripleKills?: number | null;
  quadraKills?: number | null;
  pentaKills?: number | null;
  cs?: number | null;
  gold?: number | null;
};

export const MATCH_ANALYSIS_VERSION = "RiftBoard read v1";

export function matchPerformanceToneClass(tone: MatchPerformanceTone) {
  if (tone === "elite") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (tone === "good") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
  if (tone === "warn") return "border-yellow-300/30 bg-yellow-300/10 text-yellow-100";
  if (tone === "bad") return "border-orange-300/30 bg-orange-300/10 text-orange-100";
  if (tone === "awful") return "border-red-300/30 bg-red-300/10 text-red-100";
  return "border-zinc-700/70 bg-zinc-900/55 text-zinc-300";
}

export function csPerMinute(cs: number | null | undefined, durationSeconds: number | null | undefined) {
  if (cs == null || !durationSeconds || durationSeconds <= 0) return null;
  return cs / (durationSeconds / 60);
}

export function goldPerMinute(gold: number | null | undefined, durationSeconds: number | null | undefined) {
  if (gold == null || !durationSeconds || durationSeconds <= 0) return null;
  return gold / (durationSeconds / 60);
}

export function analyzeMatchPerformance(match: MatchPerformanceInput): MatchPerformanceBadge[] {
  const kills = match.kills ?? 0;
  const deaths = match.deaths ?? 0;
  const assists = match.assists ?? 0;
  const kdaValue = deaths === 0 ? kills + assists : (kills + assists) / Math.max(1, deaths);
  const cspm = csPerMinute(match.cs, match.gameDuration);
  const gpm = goldPerMinute(match.gold, match.gameDuration);
  const support = String(match.teamPosition ?? "").toUpperCase() === "UTILITY";
  const win = match.win === true;
  const minutes = match.gameDuration ? match.gameDuration / 60 : null;

  let score = 0;
  score += Math.min(32, kdaValue * 8);
  score += Math.max(0, 18 - Math.min(18, deaths * 2.7));
  score += support ? 9 : Math.min(18, (cspm ?? 0) * 2.25);
  score += Math.min(18, ((gpm ?? 0) / 430) * 18);
  score += win ? 12 : -2;
  score = Math.round(Math.max(0, Math.min(100, score)));

  const facts: MatchPerformanceBadge[] = [];
  const explanation = `${MATCH_ANALYSIS_VERSION}: ${score}/100 from KDA, deaths, CS/min, gold/min, role, and result. Same thresholds are used for every player.`;
  const verdict: MatchPerformanceBadge =
    score >= 88
      ? { label: "Raid Boss", tone: "elite", title: explanation, kind: "verdict" }
      : score >= 78
        ? { label: "Match Driver", tone: "elite", title: explanation, kind: "verdict" }
        : score >= 66
          ? { label: "Heavy Lift", tone: "good", title: explanation, kind: "verdict" }
          : score >= 54
            ? { label: "Serviceable", tone: "neutral", title: explanation, kind: "verdict" }
            : score >= 42
              ? { label: "Low Output", tone: "warn", title: explanation, kind: "verdict" }
              : score >= 28
                ? { label: "Passenger", tone: "bad", title: explanation, kind: "verdict" }
                : { label: "Dead Weight", tone: "awful", title: explanation, kind: "verdict" };

  const pentaKills = match.pentaKills ?? 0;
  const quadraKills = match.quadraKills ?? 0;
  const tripleKills = match.tripleKills ?? 0;
  const doubleKills = match.doubleKills ?? 0;
  const largestMultiKill = match.largestMultiKill ?? 0;

  if (pentaKills > 0 || largestMultiKill >= 5) {
    facts.push({ label: "Pentakill", tone: "elite", title: "Recorded a pentakill.", kind: "fact" });
  } else if (quadraKills > 0 || largestMultiKill >= 4) {
    facts.push({ label: "Quadra", tone: "elite", title: "Recorded a quadra kill.", kind: "fact" });
  } else if (tripleKills > 0 || largestMultiKill >= 3) {
    facts.push({ label: "Triple", tone: "good", title: "Recorded a triple kill.", kind: "fact" });
  } else if (doubleKills > 0 || largestMultiKill >= 2) {
    facts.push({ label: "Double", tone: "good", title: "Recorded a double kill.", kind: "fact" });
  }

  if (deaths === 0 && kills + assists >= 8) {
    facts.push({ label: "Undying", tone: "elite", title: "Zero deaths with meaningful takedown contribution.", kind: "fact" });
  } else if (deaths <= 2 && kdaValue >= 5) {
    facts.push({ label: "No Leaks", tone: "good", title: "Low deaths with strong KDA control.", kind: "fact" });
  } else if (deaths >= 9) {
    facts.push({ label: "Bleeder", tone: "awful", title: "Very high deaths likely gave away pressure and tempo.", kind: "fact" });
  } else if (deaths >= 7) {
    facts.push({ label: "Leak Point", tone: "bad", title: "High deaths likely hurt map pressure.", kind: "fact" });
  }

  if (!support && cspm != null && cspm >= 8.2) {
    facts.push({ label: "Vacuum Farm", tone: "good", title: `${cspm.toFixed(1)} CS/min.`, kind: "fact" });
  } else if (!support && cspm != null && cspm <= 4.4 && minutes != null && minutes >= 18) {
    facts.push({ label: "Starved", tone: "bad", title: `${cspm.toFixed(1)} CS/min over ${Math.round(minutes)} minutes.`, kind: "fact" });
  }

  if (gpm != null && gpm >= 520) {
    facts.push({ label: "Gold Engine", tone: "elite", title: `${Math.round(gpm)} gold/min.`, kind: "fact" });
  } else if (gpm != null && gpm >= 460) {
    facts.push({ label: "Paid", tone: "good", title: `${Math.round(gpm)} gold/min.`, kind: "fact" });
  } else if (gpm != null && gpm < 310 && minutes != null && minutes >= 18) {
    facts.push({ label: "Broke", tone: "bad", title: `${Math.round(gpm)} gold/min.`, kind: "fact" });
  }

  if (kills >= 10 && win) {
    facts.push({ label: "Executioner", tone: "elite", title: "Double-digit kills in a win.", kind: "fact" });
  } else if (kills === 0 && assists <= 4 && minutes != null && minutes >= 18) {
    facts.push({ label: "No Threat", tone: "awful", title: "Almost no direct kill pressure.", kind: "fact" });
  } else if (assists >= 14) {
    facts.push({ label: "Connector", tone: "good", title: "High assist involvement.", kind: "fact" });
  }

  if (kills + assists <= 4 && minutes != null && minutes >= 25) {
    facts.push({ label: "Invisible", tone: "awful", title: "Low takedown involvement in a long game.", kind: "fact" });
  }
  if (deaths >= kills + assists && deaths >= 5) {
    facts.push({ label: "Feeder Line", tone: "awful", title: "Deaths outweighed takedown contribution.", kind: "fact" });
  }
  if (!win && score >= 68) {
    facts.push({ label: "Lost Cause", tone: "warn", title: "Good personal output in a losing game.", kind: "fact" });
  }
  if (win && score < 42) {
    facts.push({ label: "Carried Along", tone: "warn", title: "Win with low personal output.", kind: "fact" });
  }

  return [verdict, ...facts.slice(0, 3)];
}
