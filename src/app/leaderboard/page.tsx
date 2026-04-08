import type { Metadata } from "next";
import type { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { bestRankSnapshot } from "@/lib/rank";
import { absoluteUrl } from "@/lib/seo";
import { Player } from "@/models/player";
import { RankEntry } from "@/models/rankEntry";
import AutoUIRefresh from "@/components/AutoUIRefresh";
import LeaderboardTable, { type LeaderboardRow } from "@/components/LeaderboardTable";

export const runtime = "nodejs";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Browse the RiftBoard Myanmar leaderboard for tracked League of Legends players, current solo queue LP, flex rank, champion mains, and profile links.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    title: "RiftBoard Myanmar Leaderboard",
    description:
      "Browse tracked League of Legends players in Myanmar with current LP, rank snapshots, champion mains, and profile links.",
  },
  twitter: {
    card: "summary_large_image",
    title: "RiftBoard Myanmar Leaderboard",
    description:
      "Browse tracked League of Legends players in Myanmar with current LP, rank snapshots, champion mains, and profile links.",
  },
};

const TIER_ORDER: Record<string, number> = {
  CHALLENGER: 9,
  GRANDMASTER: 8,
  MASTER: 7,
  DIAMOND: 6,
  EMERALD: 5,
  PLATINUM: 4,
  GOLD: 3,
  SILVER: 2,
  BRONZE: 1,
  IRON: 0,
};

const DIV_ORDER: Record<string, number> = { I: 4, II: 3, III: 2, IV: 1 };

type RankSnapshot = {
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
  wins?: number | null;
  losses?: number | null;
  fetchedAt?: Date | string | null;
};

type PlayerMain = {
  championId?: number | null;
  championPoints?: number | null;
  championName?: string | null;
};

type LeaderboardPlayer = {
  _id: Types.ObjectId;
  gameName?: string | null;
  tagLine?: string | null;
  platform?: string | null;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  solo?: RankSnapshot | null;
  flex?: RankSnapshot | null;
  mains?: PlayerMain[] | null;
  lastRefreshAt?: Date | string | null;
};

type RankHistoryRow = {
  playerId: Types.ObjectId;
  queue: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR" | string;
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
};

function rankKey(tier?: string | null, div?: string | null, lp?: number | null) {
  const t = tier ? TIER_ORDER[String(tier).toUpperCase()] : undefined;
  if (t === undefined) return -1;
  const d = div ? (DIV_ORDER[String(div).toUpperCase()] ?? 0) : 0;
  const points = Number.isFinite(Number(lp)) ? Number(lp) : 0;
  return t * 100000 + d * 1000 + points;
}

function winrate(w?: number | null, l?: number | null) {
  if (w == null || l == null) return null;
  const total = w + l;
  if (!total) return 0;
  return Math.round((w / total) * 100);
}

function topMains(p: LeaderboardPlayer): NonNullable<LeaderboardRow["mains"]> {
  const src = Array.isArray(p.mains) ? p.mains : [];
  const mapped = src
    .map((x) => ({
      championId: x?.championId ?? null,
      name: x?.championName ?? null,
      points: x?.championPoints ?? null,
    }))
    .filter((m) => m.championId != null);

  mapped.sort((a, b) => (b.points ?? -1) - (a.points ?? -1));
  return mapped.slice(0, 3);
}

function lastUpdatedIso(p: LeaderboardPlayer): string | null {
  const d = p?.lastRefreshAt ?? p?.solo?.fetchedAt ?? p?.flex?.fetchedAt ?? null;
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function pHref(gameName: string, tagLine: string) {
  const gn = String(gameName ?? "").trim();
  const tl = String(tagLine ?? "").trim().toLowerCase();
  return `/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}`;
}

function fallbackPeak(current: {
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
}) {
  return current?.tier
    ? {
        tier: current.tier ?? null,
        division: current.division ?? null,
        lp: current.lp ?? null,
      }
    : null;
}

export default async function LeaderboardPage() {
  await dbConnect();

  const q: Record<string, unknown> = {
    "leaderboard.status": "approved",
    $or: [
      { "leaderboard.group": "burmese" },
      { "leaderboard.group": null },
      { leaderboard: { $exists: false } },
    ],
  };

  const players = await Player.find(
    q,
    {
      gameName: 1,
      tagLine: 1,
      platform: 1,
      profileIconId: 1,
      summonerLevel: 1,
      solo: 1,
      flex: 1,
      mains: 1,
      lastRefreshAt: 1,
      updatedAt: 1,
    }
  ).lean<LeaderboardPlayer[]>();

  const playerIds: Types.ObjectId[] = players.map((p) => p._id as Types.ObjectId);
  const rankHistory = await RankEntry.find(
    {
      playerId: { $in: playerIds },
      queue: { $in: ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] },
    },
    {
      playerId: 1,
      queue: 1,
      tier: 1,
      division: 1,
      lp: 1,
    }
  ).lean<RankHistoryRow[]>();

  const peakMap = new Map<
    string,
    {
      solo: { tier?: string | null; division?: string | null; lp?: number | null } | null;
      flex: { tier?: string | null; division?: string | null; lp?: number | null } | null;
    }
  >();

  for (const row of rankHistory) {
    const playerId = String(row.playerId);
    const current = peakMap.get(playerId) ?? { solo: null, flex: null };

    if (row.queue === "RANKED_SOLO_5x5") {
      current.solo = bestRankSnapshot([...(current.solo ? [current.solo] : []), row]);
    } else if (row.queue === "RANKED_FLEX_SR") {
      current.flex = bestRankSnapshot([...(current.flex ? [current.flex] : []), row]);
    }

    peakMap.set(playerId, current);
  }

  const rows: LeaderboardRow[] = players.map((p) => {
    const gameName = String(p.gameName ?? "").trim();
    const tagLineRaw = String(p.tagLine ?? "").trim();
    const tagLineLower = tagLineRaw.toLowerCase();
    const href = pHref(gameName, tagLineLower);

    const solo: RankSnapshot = p.solo || {};
    const flex: RankSnapshot = p.flex || {};

    const soloTier = solo.tier ?? null;
    const soloDiv = solo.division ?? null;
    const soloLp = solo.lp ?? null;

    const flexTier = flex.tier ?? null;
    const flexDiv = flex.division ?? null;
    const flexLp = flex.lp ?? null;
    const peaks = peakMap.get(String(p._id)) ?? {
      solo: fallbackPeak(solo),
      flex: fallbackPeak(flex),
    };

    return {
      id: String(p._id),
      gameName,
      tagLine: tagLineLower,
      href,

      name: `${gameName}#${tagLineRaw}`,
      platform: String(p.platform ?? "auto").toUpperCase(),
      profileIconId: typeof p.profileIconId === "number" ? p.profileIconId : null,
      summonerLevel: typeof p.summonerLevel === "number" ? p.summonerLevel : null,
      updatedAt: lastUpdatedIso(p),

      tier: soloTier,
      div: soloDiv,
      lp: soloLp,
      wins: solo.wins ?? null,
      losses: solo.losses ?? null,
      wr: winrate(solo.wins ?? null, solo.losses ?? null),
      key: rankKey(soloTier, soloDiv, soloLp),

      flexTier,
      flexDiv,
      flexLp,
      flexWins: flex.wins ?? null,
      flexLosses: flex.losses ?? null,
      flexWr: winrate(flex.wins ?? null, flex.losses ?? null),
      flexKey: rankKey(flexTier, flexDiv, flexLp),
      peakTier: peaks.solo?.tier ?? null,
      peakDiv: peaks.solo?.division ?? null,
      peakLp: peaks.solo?.lp ?? null,
      peakFlexTier: peaks.flex?.tier ?? null,
      peakFlexDiv: peaks.flex?.division ?? null,
      peakFlexLp: peaks.flex?.lp ?? null,

      mains: topMains(p),
    };
  });

  const rankedSolo = rows.filter((r) => r.tier).length;
  const rankedFlex = rows.filter((r) => r.flexTier).length;

  const latestUpdatedMs = rows.reduce((max, r) => {
    const ms = r.updatedAt ? Date.parse(r.updatedAt) : 0;
    return Number.isFinite(ms) && ms > max ? ms : max;
  }, 0);
  const tableKey = `${rows.length}-${latestUpdatedMs}`;
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "RiftBoard Myanmar Leaderboard",
    url: absoluteUrl("/"),
    description:
      "Community leaderboard for tracked Myanmar League of Legends players with LP, rank, and champion data.",
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <AutoUIRefresh everyMs={60000} />
      <div className="mx-auto max-w-full p-4 sm:p-6 space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Myanmar League of Legends Leaderboard
            </h1>
            <p className="max-w-3xl text-sm text-zinc-400">
              Track current LP, ranked snapshots, champion mains, and player profiles across the
              RiftBoard Myanmar community.
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                Players: <span className="text-zinc-200">{rows.length}</span>
              </span>
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                Solo ranked: <span className="text-zinc-200">{rankedSolo}</span>
              </span>
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                Flex ranked: <span className="text-zinc-200">{rankedFlex}</span>
              </span>
            </div>

            <p className="text-xs text-zinc-500 sm:text-right">
              Profiles refresh from each player page. The leaderboard syncs automatically in the
              background.
            </p>
          </div>
        </header>

        <LeaderboardTable key={tableKey} initialRows={rows} />
      </div>
    </main>
  );
}
