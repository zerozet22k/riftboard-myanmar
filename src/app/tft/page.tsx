import Link from "next/link";
import type { Metadata } from "next";
import { dbConnect } from "@/lib/mongodb";
import { formatNumber, formatRelativeTime } from "@/lib/displayTime";
import { hasTftApiKey } from "@/lib/riot";
import {
  absoluteUrl,
  getSiteOpenGraphImages,
  organizationSchemaId,
  websiteSchemaId,
} from "@/lib/seo";
import { approvedCommunityLeaderboardQuery } from "@/lib/communityLeaderboard";
import { analyzeTftPlaystyle, type TftPlaystyleSummary } from "@/lib/tftPlaystyle";
import { Player } from "@/models/player";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";
import ProfileAvatar from "@/components/ProfileAvatar";
import RankEmblem from "@/components/RankEmblem";

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
const PAGE_SIZE = 50;

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

type TftRow = {
  id: string;
  name: string;
  href: string;
  platform: string;
  profileIconId: number | null;
  summonerLevel: number | null;
  updatedAt: string | null;
  tier: string | null;
  div: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  wr: number | null;
  key: number;
  playstyle: TftPlaystyleSummary | null;
};

type TftRecentMatch = {
  playerId?: unknown;
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

function prettyRank(tier?: string | null, div?: string | null) {
  if (!tier) return "UNRANKED";
  return `${String(tier).toUpperCase()}${div ? ` ${String(div).toUpperCase()}` : ""}`;
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

function relativeUpdated(iso: string | null) {
  if (!iso) return "--";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatRelativeTime(ms, Date.now()) ?? "--" : "--";
}

function parsePage(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw ?? 1);
  return Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
}

function pageHref(page: number) {
  return page <= 1 ? "/tft" : `/tft?page=${page}`;
}

function badgeTone(tone: TftPlaystyleSummary["badges"][number]["tone"]) {
  if (tone === "sky") return "border-sky-300/25 bg-sky-300/10 text-sky-100";
  if (tone === "amber") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (tone === "rose") return "border-rose-300/25 bg-rose-300/10 text-rose-100";
  return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
}

function axisTone(index: number): TftPlaystyleSummary["badges"][number]["tone"] {
  if (index === 0) return "sky";
  if (index === 1) return "amber";
  if (index === 2) return "rose";
  return "emerald";
}

function playstyleSidePercent(axis: TftPlaystyleSummary["axes"][number]) {
  if (axis.label === "Balanced") return 50;
  return Math.round(axis.value >= 50 ? axis.value : 100 - axis.value);
}

function playstyleDisplayLabel(axis: TftPlaystyleSummary["axes"][number]) {
  return axis.label === "Balanced" ? `${axis.left}/${axis.right}` : axis.label;
}

function PlaystylePills({ playstyle }: { playstyle: TftPlaystyleSummary | null }) {
  if (!playstyle) {
    return (
      <span className="inline-flex items-center rounded-md border border-zinc-700/70 bg-zinc-950/35 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
        Sync pending
      </span>
    );
  }
  return (
    <div className="grid max-w-[280px] grid-cols-2 gap-1.5">
      {playstyle.axes.map((axis, index) => (
        <span
          key={`${axis.left}-${axis.right}`}
          className={`inline-flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[11px] font-medium ${badgeTone(axisTone(index))}`}
          title={`${axis.left} / ${axis.right}`}
        >
          <span className="min-w-0 truncate">{playstyleDisplayLabel(axis)}</span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums">{playstyleSidePercent(axis)}%</span>
        </span>
      ))}
    </div>
  );
}

export default async function TftPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string | string[] }>;
}) {
  await dbConnect();
  const sp = searchParams ? await searchParams : {};
  const requestedPage = parsePage(sp.page);

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
    .map<TftRow>((player) => {
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
        playstyle: null,
      };
    });

  rows.sort((left, right) => right.key - left.key || left.name.localeCompare(right.name));

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const visibleRows = rows.slice(startIndex, startIndex + PAGE_SIZE);

  const playerIds = visibleRows.map((row) => row.id);
  const recentMatches = await TftPlayerMatch.find(
    { playerId: { $in: playerIds } },
    { playerId: 1, level: 1, goldLeft: 1, totalDamageToPlayers: 1, units: 1, gameDatetime: 1 }
  )
    .sort({ gameDatetime: -1, _id: -1 })
    .lean<TftRecentMatch[]>();
  const recentByPlayer = new Map<string, TftRecentMatch[]>();
  for (const match of recentMatches) {
    const playerId = String(match.playerId ?? "");
    if (!playerId) continue;
    const bucket = recentByPlayer.get(playerId) ?? [];
    if (bucket.length < 20) {
      bucket.push(match);
      recentByPlayer.set(playerId, bucket);
    }
  }

  const pagedRows = visibleRows.map((row) => ({
    ...row,
    playstyle: recentByPlayer.get(row.id)?.length ? analyzeTftPlaystyle(recentByPlayer.get(row.id) ?? []) : null,
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

        {pagedRows.length ? (
          <>
            <div className="space-y-3 xl:hidden">
              {pagedRows.map((row, index) => (
                <article key={row.id} className="rounded-[24px] bg-zinc-900/22 p-4 ring-1 ring-white/5">
                  <div className="flex items-start gap-3">
                    <ProfileAvatar
                      iconId={row.profileIconId}
                      alt={`${row.name} profile icon`}
                      className="h-16 w-16 shrink-0"
                      level={row.summonerLevel}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="text-xs tabular-nums text-zinc-500">#{startIndex + index + 1}</div>
                      <Link href={row.href} className="line-clamp-2 text-lg font-semibold hover:underline underline-offset-4">
                        {row.name}
                      </Link>
                      <div className="mt-1 text-xs text-zinc-500">
                        {row.platform} / Updated <span className="text-zinc-300">{relativeUpdated(row.updatedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3 rounded-[22px] bg-zinc-950/40 p-3">
                    <div className="rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-white/5">
                      <RankEmblem
                        tier={row.tier}
                        className="h-10 w-10 shrink-0"
                        alt={row.tier ? `${row.tier} emblem` : "Unranked emblem"}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-zinc-100">{prettyRank(row.tier, row.div)}</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {row.lp != null ? `${formatNumber(row.lp)} LP` : "--"}
                      </div>
                    </div>

                    <div className="text-right text-xs tabular-nums text-zinc-400">
                      <div>{row.wins != null && row.losses != null ? `${row.wins}-${row.losses}` : "--"}</div>
                      <div>{row.wr != null ? `${row.wr}% WR` : "--"}</div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-[18px] bg-zinc-950/30 p-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Playstyle</div>
                    <PlaystylePills playstyle={row.playstyle} />
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-[24px] bg-zinc-900/22 ring-1 ring-white/5 xl:block">
              <table className="min-w-full text-sm">
                <thead className="border-b border-white/8 bg-zinc-950/85 text-zinc-300">
                  <tr>
                    <th className="w-14 p-4 text-left">#</th>
                    <th className="min-w-[320px] p-4 text-left">Player</th>
                    <th className="min-w-[260px] p-4 text-left">Rank</th>
                    <th className="min-w-[160px] p-4 text-left">Record</th>
                    <th className="min-w-[260px] p-4 text-left">Playstyle</th>
                    <th className="min-w-[160px] p-4 text-left">Updated</th>
                  </tr>
                </thead>

                <tbody>
                  {pagedRows.map((row, index) => (
                    <tr key={row.id} className="border-b border-white/6 align-top hover:bg-white/5">
                      <td className="p-4 tabular-nums text-zinc-500">{startIndex + index + 1}</td>

                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <ProfileAvatar
                            iconId={row.profileIconId}
                            alt={`${row.name} profile icon`}
                            className="h-14 w-14 shrink-0"
                            level={row.summonerLevel}
                          />

                          <div className="min-w-0">
                            <Link href={row.href} className="font-semibold hover:underline underline-offset-4">
                              {row.name}
                            </Link>
                            <div className="mt-1 text-xs text-zinc-500">{row.platform}</div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-white/5">
                            <RankEmblem
                              tier={row.tier}
                              className="h-9 w-9 shrink-0"
                              alt={row.tier ? `${row.tier} emblem` : "Unranked emblem"}
                            />
                          </div>
                          <div>
                            <div className="font-semibold text-zinc-100">{prettyRank(row.tier, row.div)}</div>
                            <div className="mt-1 text-xs text-zinc-400">
                              {row.lp != null ? `${formatNumber(row.lp)} LP` : "--"}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4 text-zinc-300">
                        <div className="tabular-nums">
                          {row.wins != null && row.losses != null ? `${row.wins}-${row.losses}` : "--"}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{row.wr != null ? `${row.wr}% WR` : "--"}</div>
                      </td>

                      <td className="p-4">
                        <PlaystylePills playstyle={row.playstyle} />
                      </td>

                      <td className="p-4 text-zinc-400">{relativeUpdated(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav className="flex flex-col gap-3 rounded-[20px] bg-zinc-900/22 p-3 text-sm text-zinc-400 ring-1 ring-white/5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                Showing <span className="text-zinc-100">{startIndex + 1}</span>
                {" - "}
                <span className="text-zinc-100">{startIndex + pagedRows.length}</span>
                {" of "}
                <span className="text-zinc-100">{rows.length}</span>
              </div>

              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={pageHref(currentPage - 1)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950/35 px-3 py-2 text-zinc-100 transition hover:bg-white/5"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="rounded-lg border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-zinc-600">Previous</span>
                )}
                <span className="px-2 text-xs text-zinc-500">
                  Page <span className="text-zinc-200">{currentPage}</span> / {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Link
                    href={pageHref(currentPage + 1)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950/35 px-3 py-2 text-zinc-100 transition hover:bg-white/5"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="rounded-lg border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-zinc-600">Next</span>
                )}
              </div>
            </nav>
          </>
        ) : (
          <section className="rounded-[26px] bg-zinc-900/22 p-6 ring-1 ring-white/5">
            <h2 className="text-lg font-semibold text-zinc-50">No TFT players yet</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              The page is live, but RiftBoard has not saved any approved Myanmar players yet.
              Once tracked players refresh, TFT entries will appear here.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
