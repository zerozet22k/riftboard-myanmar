import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { hasTftApiKey } from "@/lib/riot";
import {
  absoluteUrl,
  getSiteOpenGraphImages,
  organizationSchemaId,
  websiteSchemaId,
} from "@/lib/seo";
import { approvedCommunityLeaderboardQuery } from "@/lib/communityLeaderboard";
import { Player } from "@/models/player";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";
import TftLeaderboardTable, { type TftLeaderboardRow } from "@/components/TftLeaderboardTable";

export const runtime = "nodejs";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "TFT Leaderboard",
  description:
    "Browse the RiftBoard Myanmar TFT leaderboard for tracked Myanmar players, current ladder placements, LP, and ranked records.",
  alternates: {
    canonical: "/tft",
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/tft"),
    title: "RiftBoard Myanmar TFT Leaderboard",
    description:
      "Browse tracked Myanmar TFT players with current ladder rank, LP, and ranked records.",
    images: getSiteOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "RiftBoard Myanmar TFT Leaderboard",
    description:
      "Browse tracked Myanmar TFT players with current ladder rank, LP, and ranked records.",
    images: getSiteOpenGraphImages().map((image) => image.url),
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

type TftPlayer = {
  _id: string;
  gameName?: string | null;
  tagLine?: string | null;
  platform?: string | null;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  lastRefreshAt?: Date | string | null;
  tft?: RankSnapshot | null;
};

type TftRecentMatch = {
  playerId?: unknown;
  gameDatetime?: number | null;
  level?: number | null;
  goldLeft?: number | null;
  totalDamageToPlayers?: number | null;
  units?: Array<{
    characterId?: string | null;
    name?: string | null;
    rarity?: number | null;
    tier?: number | null;
    itemNames?: string[];
  }>;
};

const getRecentMatchesForLeaderboardPage = unstable_cache(
  async (rawPlayerIds: string[]) => {
    await dbConnect();
    const playerIds = rawPlayerIds
      .map((id) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null))
      .filter((id): id is Types.ObjectId => id != null);

    if (!playerIds.length) return [] as Array<[string, TftRecentMatch[]]>;

    const recentGroups = await TftPlayerMatch.aggregate<{
      _id: Types.ObjectId;
      matches: TftRecentMatch[];
    }>([
      { $match: { playerId: { $in: playerIds } } },
      { $sort: { playerId: 1, gameDatetime: -1, _id: -1 } },
      {
        $group: {
          _id: "$playerId",
          matches: {
            $push: {
              playerId: "$playerId",
              gameDatetime: "$gameDatetime",
              level: "$level",
              goldLeft: "$goldLeft",
              totalDamageToPlayers: "$totalDamageToPlayers",
              units: "$units",
            },
          },
        },
      },
      { $project: { matches: { $slice: ["$matches", 20] } } },
    ]);

    return recentGroups.map((group) => [String(group._id), group.matches ?? []] as [string, TftRecentMatch[]]);
  },
  ["tft-leaderboard-recent-matches-v4"],
  { revalidate: 300 }
);

function rankKey(tier?: string | null, div?: string | null, lp?: number | null) {
  const t = tier ? TIER_ORDER[String(tier).toUpperCase()] : undefined;
  if (t === undefined) return -1;
  const d = div ? (DIV_ORDER[String(div).toUpperCase()] ?? 0) : 0;
  const points = Number.isFinite(Number(lp)) ? Number(lp) : 0;
  return t * 100000 + d * 1000 + points;
}

function winrate(wins?: number | null, losses?: number | null) {
  if (wins == null || losses == null) return null;
  const total = wins + losses;
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function playerHref(gameName: string, tagLine: string) {
  return `/tft/p/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine.toLowerCase())}`;
}

function updatedIso(player: TftPlayer) {
  const value = player.tft?.fetchedAt ?? player.lastRefreshAt ?? null;
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export default async function TftPage() {
  await dbConnect();

  const players = await Player.find(
    approvedCommunityLeaderboardQuery(),
    {
      gameName: 1,
      tagLine: 1,
      platform: 1,
      profileIconId: 1,
      summonerLevel: 1,
      lastRefreshAt: 1,
      tft: 1,
    }
  ).lean<TftPlayer[]>();

  const rows = players
    .filter((player) => player.gameName && player.tagLine)
    .map<Omit<TftLeaderboardRow, "recentMatches">>((player) => {
      const gameName = String(player.gameName ?? "").trim();
      const tagLine = String(player.tagLine ?? "").trim();
      const tft = player.tft ?? {};

      return {
        id: String(player._id),
        name: `${gameName}#${tagLine}`,
        href: playerHref(gameName, tagLine),
        platform: String(player.platform ?? "auto").toUpperCase(),
        profileIconId: typeof player.profileIconId === "number" ? player.profileIconId : null,
        summonerLevel: typeof player.summonerLevel === "number" ? player.summonerLevel : null,
        updatedAt: updatedIso(player),
        tier: tft.tier ?? null,
        div: tft.division ?? null,
        lp: tft.lp ?? null,
        wins: tft.wins ?? null,
        losses: tft.losses ?? null,
        wr: winrate(tft.wins ?? null, tft.losses ?? null),
        key: rankKey(tft.tier ?? null, tft.division ?? null, tft.lp ?? null),
      };
    });

  rows.sort((left, right) => right.key - left.key || left.name.localeCompare(right.name));

  const recentByPlayer = new Map(await getRecentMatchesForLeaderboardPage(rows.map((row) => row.id)));
  const tableRows: TftLeaderboardRow[] = rows.map((row) => ({
    ...row,
    recentMatches: recentByPlayer.get(row.id) ?? [],
  }));

  const rankedRows = rows.filter((row) => row.tier);
  const syncedRows = rows.filter((row) => row.updatedAt);
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "RiftBoard Myanmar TFT Leaderboard",
    url: absoluteUrl("/tft"),
    description:
      "Community TFT leaderboard for tracked Myanmar players with current ladder rank, LP, and ranked records.",
    isPartOf: {
      "@id": websiteSchemaId(),
    },
    publisher: {
      "@id": organizationSchemaId(),
    },
  };
  const tftReady = hasTftApiKey();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />

      <div className="mx-auto max-w-full space-y-6 p-4 sm:p-6">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Teamfight Tactics</div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              Myanmar TFT Leaderboard
            </h1>
            <p className="max-w-3xl text-sm text-zinc-400">
              Track official TFT ladder placements for RiftBoard Myanmar players. This page only
              shows official Riot rank data and does not create alternative rating systems.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
              Tracked: <span className="text-zinc-200">{rows.length}</span>
            </span>
            <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
              Ranked: <span className="text-zinc-200">{rankedRows.length}</span>
            </span>
            <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
              Synced: <span className="text-zinc-200">{syncedRows.length}</span>
            </span>
          </div>
        </header>

        {!tftReady ? (
          <section className="rounded-[26px] border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
            TFT data refresh is ready in code, but the production TFT key is not configured yet.
            Add <code className="mx-1 rounded bg-black/25 px-1.5 py-0.5">RIOT_TFT_API_KEY</code>
            in Vercel before expecting live ladder syncs.
          </section>
        ) : null}

        {tableRows.length ? (
          <TftLeaderboardTable rows={tableRows} />
        ) : (
          <section className="rounded-[26px] bg-zinc-900/22 p-6 ring-1 ring-white/5">
            <h2 className="text-lg font-semibold text-zinc-50">No TFT players yet</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              The page is live, but RiftBoard has not saved any approved Myanmar players yet. Once tracked players refresh, TFT entries will appear here.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
