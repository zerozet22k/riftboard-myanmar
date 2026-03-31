export type RankLike = {
    tier?: string | null;
    division?: string | null;
    lp?: number | null;
    wins?: number | null;
    losses?: number | null;
    fetchedAt?: Date | string | null;
};

export const TIER_SCORE: Record<string, number> = {
    CHALLENGER: 900,
    GRANDMASTER: 800,
    MASTER: 700,
    DIAMOND: 600,
    EMERALD: 500,
    PLATINUM: 400,
    GOLD: 300,
    SILVER: 200,
    BRONZE: 100,
    IRON: 0,
};

const DIV_SCORE: Record<string, number> = { I: 40, II: 30, III: 20, IV: 10 };

export function rankScore(tier?: string | null, division?: string | null, lp?: number | null) {
    const t = tier ? (TIER_SCORE[tier.toUpperCase()] ?? -1) : -1;
    const d = division ? (DIV_SCORE[division.toUpperCase()] ?? 0) : 0;
    const l = lp ?? 0;
    return t * 10000 + d * 100 + l;
}

export function winrate(w?: number | null, l?: number | null) {
    const W = w ?? 0;
    const L = l ?? 0;
    const total = W + L;
    if (!total) return null;
    return Math.round((W / total) * 1000) / 10;
}

export function compareRanks(a?: RankLike | null, b?: RankLike | null) {
    return rankScore(a?.tier, a?.division, a?.lp) - rankScore(b?.tier, b?.division, b?.lp);
}

export function bestRankSnapshot<T extends RankLike>(items: T[]) {
    let best: T | null = null;

    for (const item of items) {
        if (!best || compareRanks(item, best) > 0) {
            best = item;
        }
    }

    return best;
}
