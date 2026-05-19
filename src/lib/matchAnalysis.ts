export type MatchPerformanceTone =
  | "rainbow"
  | "gold"
  | "silver"
  | "bronze"
  | "elite"
  | "good"
  | "warn"
  | "bad"
  | "awful"
  | "neutral";

export type MatchPerformanceBadge = {
  label: string;
  tone: MatchPerformanceTone;
  title: string;
  kind: "score" | "verdict" | "fact";
};

export type MatchPerformanceInput = {
  queueId?: number | null;
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
  damage?: number | null;
  laneOpponent?: {
    kills?: number | null;
    deaths?: number | null;
    assists?: number | null;
    cs?: number | null;
    gold?: number | null;
    damage?: number | null;
  } | null;
};

export const MATCH_ANALYSIS_VERSION = "RiftBoard read v1";
const MAX_RIFTBOARD_SCORE = 120;
const ARENA_QUEUE_IDS = new Set([1700, 1710, 1720, 1750]);
const ARAM_QUEUE_IDS = new Set([65, 67, 72, 73, 78, 100, 300, 450, 720, 920, 2400]);

type MatchQueueKind = "arena" | "aram" | "rift";

export function matchPerformanceToneClass(tone: MatchPerformanceTone) {
  if (tone === "rainbow") {
    return "riftboard-rainbow-badge border-white/35 bg-[linear-gradient(90deg,rgba(244,114,182,0.34),rgba(250,204,21,0.3),rgba(52,211,153,0.3),rgba(96,165,250,0.34),rgba(168,85,247,0.34),rgba(244,114,182,0.34))] text-white shadow-[0_0_18px_rgba(255,255,255,0.2)]";
  }
  if (tone === "gold") return "border-yellow-300/50 bg-[linear-gradient(90deg,rgba(250,204,21,0.22),rgba(251,191,36,0.12))] text-yellow-50";
  if (tone === "silver") return "border-zinc-200/40 bg-[linear-gradient(90deg,rgba(228,228,231,0.18),rgba(148,163,184,0.12))] text-zinc-50";
  if (tone === "bronze") return "border-amber-700/45 bg-[linear-gradient(90deg,rgba(180,83,9,0.2),rgba(245,158,11,0.1))] text-amber-100";
  if (tone === "elite") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (tone === "good") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100";
  if (tone === "warn") return "border-yellow-300/30 bg-yellow-300/10 text-yellow-100";
  if (tone === "bad") return "border-orange-300/30 bg-orange-300/10 text-orange-100";
  if (tone === "awful") return "border-red-300/30 bg-red-300/10 text-red-100";
  return "border-zinc-700/70 bg-zinc-900/55 text-zinc-300";
}

function scoreTone(score: number): MatchPerformanceTone {
  if (score >= 96) return "rainbow";
  if (score >= 88) return "gold";
  if (score >= 72) return "silver";
  if (score >= 54) return "bronze";
  return "neutral";
}

function scoreBonus({
  kills,
  deaths,
  assists,
  kdaValue,
  cspm,
  gpm,
  support,
  win,
  largestMultiKill,
  queueKind,
}: {
  kills: number;
  deaths: number;
  assists: number;
  kdaValue: number;
  cspm: number | null;
  gpm: number | null;
  support: boolean;
  win: boolean;
  largestMultiKill: number;
  queueKind: MatchQueueKind;
}) {
  let bonus = 0;
  const takedowns = kills + assists;

  if (win && deaths === 0 && takedowns >= 12) bonus += 8;
  else if (win && deaths <= 1 && kdaValue >= 8) bonus += 5;
  else if (deaths <= 2 && kdaValue >= 6) bonus += 2;

  if (kdaValue >= 12) bonus += 4;
  else if (kdaValue >= 8) bonus += 2;

  if (queueKind === "rift" && !support && cspm != null) {
    if (cspm >= 8.5) bonus += 6;
    else if (cspm >= 7.5) bonus += 4;
  } else if (queueKind === "aram" && assists >= 18) {
    bonus += 4;
  } else if (queueKind === "arena" && takedowns >= 14) {
    bonus += 4;
  }

  if (gpm != null) {
    if (gpm >= 520) bonus += 5;
    else if (gpm >= 430) bonus += 3;
  }

  if (kills >= 10) bonus += 4;
  else if (kills >= 8) bonus += 3;

  if (largestMultiKill >= 5) bonus += 6;
  else if (largestMultiKill >= 4) bonus += 4;
  else if (largestMultiKill >= 2) bonus += 2;

  return bonus;
}

function queueKind(queueId: number | null | undefined): MatchQueueKind {
  if (queueId != null && ARENA_QUEUE_IDS.has(queueId)) return "arena";
  if (queueId != null && ARAM_QUEUE_IDS.has(queueId)) return "aram";
  return "rift";
}

function verdictTitle(label: string, kind: MatchQueueKind) {
  if (label === "Limit Break") return "LEGENDARY output. Riftboard found a carry signal above the normal scale.";
  if (label === "Final Boss") return "Primary threat confirmed. The enemy team had to answer this player first.";
  if (label === "Carry Threat") return "High-impact game. Damage, tempo, and gold pointed at one dangerous player.";
  if (label === "Tempo Lead") return "Strong match control. Plays started to move around this player.";
  if (label === "Power Spike") return kind === "arena" ? "Arena impact online. Rounds found a real threat here." : "Pressure online. This player became a real win condition.";
  if (label === "Stable") return "Steady game. Enough value landed to keep the line intact.";
  if (label === "Low Impact") return "Low pressure signal. The match needed more damage, gold, or takedown presence.";
  if (label === "Quiet Game") return "Quiet scoreboard. The match barely heard this player call.";
  return "Danger state. Deaths and low output pulled the read into red.";
}

function ratePerMinute(value: number, minutes: number | null) {
  if (!minutes || minutes <= 0) return null;
  return value / minutes;
}

function fmtRate(value: number | null) {
  return value == null ? "--" : value.toFixed(2);
}

function signedNumber(value: number) {
  return `${value >= 0 ? "+" : ""}${Math.round(value)}`;
}

function laneSignal(match: MatchPerformanceInput, support: boolean) {
  const opponent = match.laneOpponent;
  if (!opponent) return null;
  const kills = match.kills ?? 0;
  const deaths = match.deaths ?? 0;
  const assists = match.assists ?? 0;
  const takedownDiff = kills + assists - ((opponent.kills ?? 0) + (opponent.assists ?? 0));
  const deathDiff = (opponent.deaths ?? 0) - deaths;
  const csDiff = (match.cs ?? 0) - (opponent.cs ?? 0);
  const goldDiff = (match.gold ?? 0) - (opponent.gold ?? 0);
  const damageDiff = (match.damage ?? 0) - (opponent.damage ?? 0);
  const score =
    takedownDiff * 1.6 +
    deathDiff * 2.2 +
    goldDiff / 900 +
    damageDiff / 4200 +
    (support ? 0 : csDiff / 18);
  return { score, takedownDiff, deathDiff, csDiff, goldDiff, damageDiff };
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
  const matchup = laneSignal(match, support);
  const win = match.win === true;
  const minutes = match.gameDuration ? match.gameDuration / 60 : null;
  const kind = queueKind(match.queueId);

  const largestMultiKill = match.largestMultiKill ?? 0;

  let score = 0;
  score += Math.min(32, kdaValue * 8);
  score += Math.max(0, 18 - Math.min(18, deaths * (kind === "aram" ? 1.9 : 2.7)));
  score +=
    kind === "arena"
      ? Math.min(18, kdaValue * 1.25 + kills * 0.7)
      : kind === "aram"
        ? Math.min(18, (kills + assists) * 0.55 + ((gpm ?? 0) / 500) * 4)
        : support
          ? 9
          : Math.min(18, (cspm ?? 0) * 2.25);
  score += Math.min(18, ((gpm ?? 0) / 430) * 18);
  score += win ? (kind === "rift" ? 12 : 10) : -2;
  score += scoreBonus({
    kills,
    deaths,
    assists,
    kdaValue,
    cspm,
    gpm,
    support,
    win,
    largestMultiKill,
    queueKind: kind,
  });
  if (kind === "rift" && matchup) {
    if (matchup.score >= 9) score += 8;
    else if (matchup.score >= 5) score += 5;
    else if (matchup.score >= 2.5) score += 2;
    else if (matchup.score <= -7) score -= 5;
    else if (matchup.score <= -4) score -= 3;
  }
  score = Math.round(Math.max(0, Math.min(MAX_RIFTBOARD_SCORE, score)));

  const facts: MatchPerformanceBadge[] = [];
  const scoringBasis =
    kind === "arena"
      ? "KDA, deaths, takedowns, gold/min, result, and Arena bonuses"
      : kind === "aram"
        ? "KDA, deaths, takedowns, gold/min, result, and ARAM bonuses"
        : "KDA, deaths, CS/min, gold/min, role, result, matchup diff, and carry bonuses";
  const explanation = `${MATCH_ANALYSIS_VERSION}: ${score}/${MAX_RIFTBOARD_SCORE} from ${scoringBasis}.`;
  const makeVerdict = (label: string, tone: MatchPerformanceTone): MatchPerformanceBadge => ({
    label,
    tone,
    title: verdictTitle(label, kind),
    kind: "verdict",
  });
  const scoreBadge: MatchPerformanceBadge = {
    label: `Score ${score}`,
    tone: scoreTone(score),
    title: explanation,
    kind: "score",
  };
  const verdict: MatchPerformanceBadge =
    score >= 112
      ? makeVerdict("Limit Break", "rainbow")
      : score >= 100
        ? makeVerdict("Final Boss", "elite")
        : score >= 88
          ? makeVerdict("Carry Threat", "elite")
          : score >= 78
            ? makeVerdict("Tempo Lead", "elite")
            : score >= 66
              ? makeVerdict("Power Spike", "good")
              : score >= 54
                ? makeVerdict("Stable", "neutral")
                : score >= 42
                  ? makeVerdict("Low Impact", "warn")
                  : score >= 28
                    ? makeVerdict("Quiet Game", "bad")
                    : makeVerdict("Danger State", "awful");

  const pentaKills = match.pentaKills ?? 0;
  const quadraKills = match.quadraKills ?? 0;
  const tripleKills = match.tripleKills ?? 0;
  const doubleKills = match.doubleKills ?? 0;
  const deathsPerMinute = ratePerMinute(deaths, minutes);

  if (pentaKills > 0 || largestMultiKill >= 5) {
    facts.push({ label: "Pentakill", tone: "elite", title: "Five takedowns in one surge. The fight ended under one name.", kind: "fact" });
  } else if (quadraKills > 0 || largestMultiKill >= 4) {
    facts.push({ label: "Quadra Kill", tone: "elite", title: "Four takedowns before the enemy could reset the fight.", kind: "fact" });
  } else if (tripleKills > 0 || largestMultiKill >= 3) {
    facts.push({ label: "Triple Kill", tone: "good", title: "Three takedowns chained into one fight swing.", kind: "fact" });
  } else if (doubleKills > 0 || largestMultiKill >= 2) {
    facts.push({ label: "Double Kill", tone: "good", title: "Two takedowns in one window. Clean fight conversion.", kind: "fact" });
  }

  if (kind === "rift" && matchup) {
    if (matchup.score >= 9) {
      facts.push({
        label: "Lane Gap",
        tone: "elite",
        title: `Direct matchup won hard: ${signedNumber(matchup.takedownDiff)} takedowns, ${signedNumber(matchup.deathDiff)} death diff, ${signedNumber(matchup.goldDiff)} gold.`,
        kind: "fact",
      });
    } else if (matchup.score >= 5 || (matchup.takedownDiff >= 6 && matchup.damageDiff >= 4000)) {
      facts.push({
        label: "Lane Win",
        tone: "good",
        title: `Beat the role opponent on pressure: ${signedNumber(matchup.takedownDiff)} takedowns, ${signedNumber(matchup.damageDiff)} damage.`,
        kind: "fact",
      });
    } else if (matchup.score >= 2.5 || (matchup.damageDiff >= 5000 && matchup.takedownDiff >= 2)) {
      facts.push({
        label: "Lane Pressure",
        tone: "good",
        title: `Out-pressured the role opponent: ${signedNumber(matchup.damageDiff)} damage, ${signedNumber(matchup.takedownDiff)} takedowns.`,
        kind: "fact",
      });
    } else if (matchup.score <= -7) {
      facts.push({
        label: "Lane Lost",
        tone: "bad",
        title: `Role matchup fell behind: ${signedNumber(matchup.takedownDiff)} takedowns, ${signedNumber(matchup.csDiff)} CS, ${signedNumber(matchup.goldDiff)} gold.`,
        kind: "fact",
      });
    }
  }

  if (deaths === 0 && kills + assists >= 8) {
    facts.push({ label: "Survivor", tone: "elite", title: `0 deaths across ${minutes ? Math.round(minutes) : "the"} minutes. Shutdown denied.`, kind: "fact" });
  } else if (deaths <= 2 && kdaValue >= 5) {
    facts.push({ label: "Clean Escape", tone: "good", title: `${deaths} deaths, ${fmtRate(deathsPerMinute)} deaths/min. Low-risk pressure stayed alive.`, kind: "fact" });
  } else if (deaths >= 9) {
    facts.push({ label: "Death Magnet", tone: "awful", title: `${deaths} deaths, ${fmtRate(deathsPerMinute)} deaths/min. The enemy kept finding the timer.`, kind: "fact" });
  } else if (deaths >= 7) {
    facts.push({ label: "High Risk", tone: "bad", title: `${deaths} deaths, ${fmtRate(deathsPerMinute)} deaths/min. Too much tempo leaked through death timers.`, kind: "fact" });
  }

  if (kind === "rift" && !support && cspm != null && cspm >= 8.2) {
    facts.push({ label: "Farm Lead", tone: "good", title: `${cspm.toFixed(1)} CS/min. Strong resource control kept the build moving.`, kind: "fact" });
  } else if (kind === "rift" && !support && cspm != null && cspm <= 4.4 && minutes != null && minutes >= 18) {
    facts.push({ label: "Low Farm", tone: "bad", title: `${cspm.toFixed(1)} CS/min over ${Math.round(minutes)} minutes. The resource line fell behind.`, kind: "fact" });
  }

  if (gpm != null && gpm >= 520) {
    facts.push({ label: "Gold Lead", tone: "elite", title: `${Math.round(gpm)} gold/min. Major item tempo came online.`, kind: "fact" });
  } else if (gpm != null && gpm >= 460) {
    facts.push({ label: "Item Tempo", tone: "good", title: `${Math.round(gpm)} gold/min. Item spikes arrived on schedule.`, kind: "fact" });
  } else if (gpm != null && gpm < 310 && minutes != null && minutes >= 18) {
    facts.push({ label: "Gold Starved", tone: "bad", title: `${Math.round(gpm)} gold/min. The build path had to fight uphill.`, kind: "fact" });
  }

  if (kills >= 10 && win) {
    facts.push({ label: "Finisher", tone: "elite", title: `${kills} kills in a win. Fight cleanup belonged here.`, kind: "fact" });
  } else if (kills === 0 && assists <= 4 && minutes != null && minutes >= 18) {
    facts.push({ label: "No Threat", tone: "awful", title: "Almost no direct takedown pressure reached the scoreboard.", kind: "fact" });
  } else if (assists >= 14) {
    facts.push({ label: "Teamfight Link", tone: "good", title: `${assists} assists. This player kept connecting fights.`, kind: "fact" });
  }

  if (kills + assists <= 4 && minutes != null && minutes >= 25) {
    facts.push({ label: "Low Presence", tone: "awful", title: `${kills + assists} takedowns over ${Math.round(minutes)} minutes. The map barely saw the signal.`, kind: "fact" });
  }
  if (deaths >= kills + assists && deaths >= 5) {
    facts.push({ label: "Timer Debt", tone: "awful", title: `${deaths} deaths against ${kills + assists} takedowns. The death clock won too many trades.`, kind: "fact" });
  }
  if (!win && score >= 68) {
    facts.push({ label: "Strong Loss", tone: "warn", title: "The nexus fell, but the personal output stayed strong.", kind: "fact" });
  }
  if (win && score < 42) {
    facts.push({ label: "Team Covered", tone: "warn", title: "Victory secured while allies held most of the spotlight.", kind: "fact" });
  }

  return [scoreBadge, verdict, ...facts.slice(0, 2)];
}
