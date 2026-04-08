import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import MatchHistory, { type MatchRow } from "@/components/MatchHistory";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileRefreshButton from "@/components/ProfileRefreshButton";
import RankEmblem from "@/components/RankEmblem";
import { getLatestDdragonVersion } from "@/lib/ddragon";
import {
  formatFullDateTime,
  formatMetaDateTime as formatDisplayMetaDateTime,
  formatNumber,
} from "@/lib/displayTime";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import { bestRankSnapshot } from "@/lib/rank";
import { absoluteUrl } from "@/lib/seo";
import { Player } from "@/models/player";
import { PlayerMatch } from "@/models/playerMatch";
import { RankEntry } from "@/models/rankEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

type RouteParams = { gameName: string; tagLine: string };

type PeakRankLike = {
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
  wins?: number | null;
  losses?: number | null;
  fetchedAt?: Date | string | null;
};

type PlayerView = {
  _id: unknown;
  gameName: string;
  tagLine: string;
  platform?: string | null;
  matchRegion?: string | null;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  lastRefreshAt?: Date | null;
  masterySyncedAt?: Date | null;
  solo?: PeakRankLike | null;
  flex?: PeakRankLike | null;
  mains?: Array<{
    championId?: number | null;
    championPoints?: number | null;
  }> | null;
};

type RankHistoryRow = PeakRankLike & {
  queue: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";
};

type MatchDoc = {
  _id: unknown;
  matchId: string;
  queueId?: number | null;
  gameCreation?: number | null;
  gameDuration?: number | null;
  championId?: number | null;
  teamId?: number | null;
  teamPosition?: string | null;
  primaryStyle?: number | null;
  primaryRune?: number | null;
  subStyle?: number | null;
  win?: boolean | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  cs?: number | null;
  gold?: number | null;
  items?: unknown[];
  summonerSpells?: unknown[];
};

type ChampionSummaryEntry = { id?: number; name?: string };

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

function isoOrNull(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function rankLine(tier?: string | null, division?: string | null, lp?: number | null) {
  if (!tier) return "UNRANKED";
  const tierText = String(tier).toUpperCase();
  const divisionText = division ? ` ${String(division).toUpperCase()}` : "";
  const lpText = lp != null && Number.isFinite(Number(lp)) ? ` - ${Number(lp)} LP` : "";
  return `${tierText}${divisionText}${lpText}`;
}

function peakRankFromHistory(history: PeakRankLike[], current: PeakRankLike | null | undefined) {
  if (history.length) return bestRankSnapshot(history);
  if (current?.tier) return current;
  return null;
}

function peakSeenLabel(snapshot?: PeakRankLike | null) {
  return formatFullDateTime(snapshot?.fetchedAt ?? null);
}

function cursorFromLast(last: MatchDoc | undefined) {
  if (!last || typeof last.gameCreation !== "number") return null;
  const payload = { gc: last.gameCreation, id: String(last._id), matchId: String(last.matchId ?? "") };
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getChampNameMap() {
  const response = await fetch(CHAMP_SUMMARY_URL, {
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!response.ok) return {} as Record<string, string>;

  const payload = (await response.json()) as ChampionSummaryEntry[];
  const map: Record<string, string> = {};
  for (const champion of payload) {
    if (champion?.id == null || !champion?.name) continue;
    map[String(champion.id)] = champion.name;
  }
  return map;
}

function champIconUrl(championId: number | null | undefined) {
  if (championId == null) return null;
  return `${CHAMP_ICON_BASE}/${championId}.png`;
}

function playerMetaDescription(player: Pick<PlayerView, "gameName" | "tagLine" | "solo" | "flex">) {
  const soloLine = rankLine(player.solo?.tier ?? null, player.solo?.division ?? null, player.solo?.lp ?? null);
  const flexLine = rankLine(player.flex?.tier ?? null, player.flex?.division ?? null, player.flex?.lp ?? null);
  return `${player.gameName}#${player.tagLine} on RiftBoard Myanmar. Solo: ${soloLine}. Flex: ${flexLine}. View LP, match history, and champion mastery.`;
}

export async function generateMetadata({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}): Promise<Metadata> {
  const resolved = (await params) as Partial<RouteParams>;
  const gameNameRaw = safeDecode(resolved.gameName).trim();
  const tagLineRaw = safeDecode(resolved.tagLine).trim().toLowerCase();

  if (!gameNameRaw || !tagLineRaw) {
    return {
      title: "Player Profile",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  await dbConnect();

  const player = (await Player.findOne(
    buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
    {
      gameName: 1,
      tagLine: 1,
      solo: 1,
      flex: 1,
    }
  ).lean()) as Pick<PlayerView, "gameName" | "tagLine" | "solo" | "flex"> | null;

  if (!player?.gameName || !player.tagLine) {
    return {
      title: "Player Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const canonicalPath = canonicalPlayerPath(player.gameName, player.tagLine);
  const description = playerMetaDescription(player);
  const title = `${player.gameName}#${player.tagLine} Profile`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      type: "profile",
      url: absoluteUrl(canonicalPath),
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function PlayerProfilePage({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}) {
  const resolved = (await params) as Partial<RouteParams>;
  const gameNameRaw = safeDecode(resolved.gameName).trim();
  const tagLineRaw = safeDecode(resolved.tagLine).trim().toLowerCase();

  if (!gameNameRaw || !tagLineRaw) notFound();

  await dbConnect();

  const player = (await Player.findOne(
    buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
    {
      gameName: 1,
      tagLine: 1,
      platform: 1,
      matchRegion: 1,
      profileIconId: 1,
      summonerLevel: 1,
      lastRefreshAt: 1,
      masterySyncedAt: 1,
      solo: 1,
      flex: 1,
      mains: 1,
    }
  ).lean()) as PlayerView | null;

  if (!player?._id) notFound();

  const canonicalGameName = player.gameName.trim();
  const canonicalTagLineLower = player.tagLine.trim().toLowerCase();
  const canonicalPath = canonicalPlayerPath(canonicalGameName, canonicalTagLineLower);

  if (gameNameRaw !== canonicalGameName || tagLineRaw !== canonicalTagLineLower) {
    redirect(canonicalPath);
  }

  const [ddVer, champNames, rankHistory, matchDocs] = await Promise.all([
    getLatestDdragonVersion(),
    getChampNameMap(),
    RankEntry.find(
      {
        playerId: player._id,
        queue: { $in: ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] },
      },
      { queue: 1, tier: 1, division: 1, lp: 1, wins: 1, losses: 1, fetchedAt: 1 }
    )
      .sort({ fetchedAt: -1 })
      .lean() as Promise<RankHistoryRow[]>,
    PlayerMatch.find(
      { playerId: player._id },
      {
        matchId: 1,
        queueId: 1,
        gameCreation: 1,
        gameDuration: 1,
        championId: 1,
        teamId: 1,
        teamPosition: 1,
        primaryStyle: 1,
        primaryRune: 1,
        subStyle: 1,
        win: 1,
        kills: 1,
        deaths: 1,
        assists: 1,
        cs: 1,
        gold: 1,
        items: 1,
        summonerSpells: 1,
      }
    )
      .sort({ gameCreation: -1, _id: -1 })
      .limit(10)
      .lean() as Promise<MatchDoc[]>,
  ]);

  const initialMatches: MatchRow[] = matchDocs.map((match) => ({
    _id: String(match._id),
    matchId: String(match.matchId),
    queueId: typeof match.queueId === "number" ? match.queueId : null,
    gameCreation: typeof match.gameCreation === "number" ? match.gameCreation : null,
    gameDuration: typeof match.gameDuration === "number" ? match.gameDuration : null,
    championId: typeof match.championId === "number" ? match.championId : null,
    teamId: typeof match.teamId === "number" ? match.teamId : null,
    teamPosition: typeof match.teamPosition === "string" ? match.teamPosition : null,
    primaryStyle: typeof match.primaryStyle === "number" ? match.primaryStyle : null,
    primaryRune: typeof match.primaryRune === "number" ? match.primaryRune : null,
    subStyle: typeof match.subStyle === "number" ? match.subStyle : null,
    win: typeof match.win === "boolean" ? match.win : null,
    kills: typeof match.kills === "number" ? match.kills : null,
    deaths: typeof match.deaths === "number" ? match.deaths : null,
    assists: typeof match.assists === "number" ? match.assists : null,
    cs: typeof match.cs === "number" ? match.cs : null,
    gold: typeof match.gold === "number" ? match.gold : null,
    items: Array.isArray(match.items)
      ? match.items.filter((value): value is number => typeof value === "number")
      : [],
    summonerSpells: Array.isArray(match.summonerSpells)
      ? match.summonerSpells.filter((value): value is number => typeof value === "number")
      : [],
  }));

  const solo = player.solo ?? {};
  const flex = player.flex ?? {};
  const soloPeak = peakRankFromHistory(
    rankHistory.filter((entry) => entry.queue === "RANKED_SOLO_5x5"),
    solo
  );
  const flexPeak = peakRankFromHistory(
    rankHistory.filter((entry) => entry.queue === "RANKED_FLEX_SR"),
    flex
  );
  // eslint-disable-next-line react-hooks/purity
  const renderedAtMs = Date.now();

  const nameShown = `${player.gameName}#${player.tagLine}`;
  const lastUpdatedShort =
    formatDisplayMetaDateTime(player.lastRefreshAt) ??
    formatDisplayMetaDateTime(isoOrNull(player.solo?.fetchedAt)) ??
    formatDisplayMetaDateTime(isoOrNull(player.flex?.fetchedAt));
  const masteryUpdatedShort = formatDisplayMetaDateTime(player.masterySyncedAt);
  const masteryPath = `${canonicalPath}/mastery`;
  const initialCursor = cursorFromLast(matchDocs[matchDocs.length - 1]);
  const profileJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: absoluteUrl(canonicalPath),
    name: `${player.gameName}#${player.tagLine}`,
    description: playerMetaDescription(player),
    mainEntity: {
      "@type": "Thing",
      name: `${player.gameName}#${player.tagLine}`,
    },
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(30,41,59,0.42),transparent_34%),radial-gradient(circle_at_18%_18%,rgba(16,185,129,0.14),transparent_22%),#09090b] text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(profileJsonLd) }}
      />
      <div className="mx-auto w-full max-w-[1400px] space-y-3 px-4 py-3 sm:px-5 sm:py-4 lg:px-6">
        <section className="relative overflow-hidden rounded-[24px] bg-zinc-950/62 p-4 ring-1 ring-white/5 sm:p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.14),transparent_26%)]" />

          <div className="relative grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
              <ProfileAvatar
                iconId={player.profileIconId ?? null}
                ddragonVersion={ddVer}
                alt={`${nameShown} profile icon`}
                className="h-[72px] w-[72px] shrink-0 sm:h-[88px] sm:w-[88px]"
                level={player.summonerLevel ?? null}
              />

              <div className="min-w-0 space-y-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[2rem]">
                      {nameShown}
                    </h1>
                    <Pill className="border-zinc-700 bg-zinc-900/70 text-zinc-300">
                      {String(player.platform ?? "auto").toUpperCase()}
                    </Pill>
                    <Pill className="border-zinc-700 bg-zinc-900/70 text-zinc-400">
                      Match region {String(player.matchRegion ?? "--").toUpperCase()}
                    </Pill>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1">
                      <RankEmblem tier={solo.tier ?? null} className="h-4 w-4 shrink-0" alt="" />
                      <span>{rankLine(solo.tier ?? null, solo.division ?? null, solo.lp ?? null)}</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-zinc-900/45 px-3 py-1 text-zinc-400">
                      <RankEmblem tier={flex.tier ?? null} className="h-4 w-4 shrink-0" alt="" />
                      <span>{rankLine(flex.tier ?? null, flex.division ?? null, flex.lp ?? null)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-2.5">
                  <StatTile label="Level" value={formatNumber(player.summonerLevel) ?? "--"} />
                  <MetaInfoButton
                    lastUpdated={lastUpdatedShort}
                    masteryUpdated={masteryUpdatedShort}
                  />
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href={masteryPath}
                    className="rounded-xl bg-zinc-950/42 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                  >
                    Full mastery
                  </Link>
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2">
              <div className="flex justify-start xl:justify-end">
                <ProfileRefreshButton gameName={canonicalGameName} tagLine={canonicalTagLineLower} />
              </div>
              <HeroQueueSummary
                title="Current ladder"
                primaryLabel="Solo"
                primaryLine={rankLine(solo.tier ?? null, solo.division ?? null, solo.lp ?? null)}
                primaryTier={solo.tier ?? null}
                secondaryLabel="Flex"
                secondaryLine={rankLine(flex.tier ?? null, flex.division ?? null, flex.lp ?? null)}
                secondaryTier={flex.tier ?? null}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-3 2xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <RankCard
              title="Ranked Solo"
              tier={solo.tier ?? null}
              division={solo.division ?? null}
              lp={solo.lp ?? null}
              wins={solo.wins ?? null}
              losses={solo.losses ?? null}
              peak={soloPeak}
            />
            <RankCard
              title="Ranked Flex"
              tier={flex.tier ?? null}
              division={flex.division ?? null}
              lp={flex.lp ?? null}
              wins={flex.wins ?? null}
              losses={flex.losses ?? null}
              peak={flexPeak}
            />
          </aside>

          <div className="space-y-4">
            <section className="rounded-[22px] bg-zinc-900/18 p-4 ring-1 ring-white/5 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Champion pool
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">
                    Top champions
                  </div>
                  <div className="mt-2 text-sm text-zinc-400">
                    Stored from your latest mastery sync and used on the leaderboard too.
                  </div>
                </div>
                <Link
                  href={masteryPath}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-white/5"
                >
                  View all mastery
                </Link>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {Array.isArray(player.mains) && player.mains.length ? (
                  player.mains.slice(0, 3).map((main, index) => {
                    const championId = typeof main?.championId === "number" ? main.championId : null;
                    const championName = championId != null ? champNames[String(championId)] : null;
                    const points = typeof main?.championPoints === "number" ? main.championPoints : null;
                    const icon = champIconUrl(championId);

                    return (
                      <div
                        key={`${championId ?? "unknown"}-${index}`}
                        className="rounded-[16px] bg-zinc-950/36 p-3"
                        title={
                          championName
                            ? `${championName} (#${championId})`
                            : championId != null
                              ? `Champion #${championId}`
                              : "Champion"
                        }
                      >
                        <div className="flex items-center gap-3">
                          {icon ? (
                            <img
                              src={icon}
                              alt={championName ?? "Champion"}
                              className="h-9 w-9 rounded-lg"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-lg bg-zinc-900/40" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-100">
                              {championName ?? (championId != null ? `#${championId}` : "--")}
                            </div>
                            <div className="mt-1 text-sm tabular-nums text-zinc-400">
                              {formatNumber(points) ?? "--"} pts
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-3xl bg-zinc-950/40 p-5 text-sm text-zinc-500 ring-1 ring-white/5 md:col-span-3">
                    No mastery data yet.
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Recent games
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">
                    Match history
                  </div>
                </div>
              </div>
              <MatchHistory
                gameName={canonicalGameName}
                tagLine={canonicalTagLineLower}
                ddragonVersion={ddVer}
                initialMatches={initialMatches}
                initialCursor={initialCursor}
                renderedAtMs={renderedAtMs}
              />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function winrate(wins: number | null, losses: number | null) {
  if (wins == null || losses == null) return null;
  const total = wins + losses;
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={"inline-flex items-center rounded-full border px-2.5 py-1 text-xs tabular-nums " + className}>
      {children}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-[104px] rounded-xl bg-zinc-900/18 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm text-zinc-200">{value}</div>
    </div>
  );
}

function MetaInfoButton({
  lastUpdated,
  masteryUpdated,
}: {
  lastUpdated: string | null;
  masteryUpdated: string | null;
}) {
  return (
    <details className="group relative">
      <summary
        aria-label="Show private sync info"
        className="flex h-9 w-9 list-none items-center justify-center rounded-full bg-zinc-900/22 text-sm font-semibold text-zinc-300 ring-1 ring-white/5 transition hover:bg-white/5"
      >
        i
      </summary>
      <div className="absolute left-0 top-[calc(100%+10px)] z-20 w-[220px] rounded-2xl bg-zinc-950/96 p-3 text-sm text-zinc-300 shadow-[0_18px_50px_rgba(0,0,0,0.35)] ring-1 ring-white/8 sm:left-auto sm:right-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Private sync info</div>
        <div className="mt-2 space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Profile</div>
            <div className="mt-1 text-sm text-zinc-100">{lastUpdated ?? "--"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Mastery</div>
            <div className="mt-1 text-sm text-zinc-100">{masteryUpdated ?? "Not synced yet"}</div>
          </div>
        </div>
      </div>
    </details>
  );
}

function HeroQueueSummary({
  title,
  primaryLabel,
  primaryLine,
  primaryTier,
  secondaryLabel,
  secondaryLine,
  secondaryTier,
}: {
  title: string;
  primaryLabel: string;
  primaryLine: string;
  primaryTier: string | null;
  secondaryLabel: string;
  secondaryLine: string;
  secondaryTier: string | null;
}) {
  return (
    <div className="rounded-[18px] bg-zinc-900/20 p-2.5 ring-1 ring-white/5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{title}</div>

      <div className="mt-2 space-y-1.5">
        <HeroQueueSummaryRow label={primaryLabel} line={primaryLine} tier={primaryTier} />
        <HeroQueueSummaryRow label={secondaryLabel} line={secondaryLine} tier={secondaryTier} />
      </div>
    </div>
  );
}

function HeroQueueSummaryRow({
  label,
  line,
  tier,
}: {
  label: string;
  line: string;
  tier: string | null;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-zinc-950/34 px-2.5 py-2">
      <RankEmblem tier={tier} className="h-7 w-7 shrink-0" alt="" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
        <div className="mt-0.5 truncate text-xs font-medium text-zinc-100">{line}</div>
      </div>
    </div>
  );
}

function RankCard({
  title,
  tier,
  division,
  lp,
  wins,
  losses,
  peak,
}: {
  title: string;
  tier: string | null;
  division: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
  peak: PeakRankLike | null;
}) {
  const wr = winrate(wins, losses);
  const wl = wins != null && losses != null ? `${wins}-${losses}` : "--";
  const currentLine = rankLine(tier, division, lp);
  const peakLine = peak ? rankLine(peak.tier ?? null, peak.division ?? null, peak.lp ?? null) : null;
  const peakSeen = peakSeenLabel(peak);

  return (
    <div className="overflow-hidden rounded-[20px] bg-zinc-900/18 p-4 ring-1 ring-white/5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{title}</div>

      <div className="mt-3 flex items-start gap-3">
        <div className="rounded-[18px] bg-zinc-950/40 p-2 ring-1 ring-white/5">
          <RankEmblem
            tier={tier}
            className="h-12 w-12 shrink-0"
            alt={tier ? `${tier} emblem` : "Unranked emblem"}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold tracking-tight text-zinc-50">{currentLine}</div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-400">
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Record</span>
              <div className="mt-1 tabular-nums text-zinc-100">{wl}</div>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Win rate</span>
              <div className="mt-1 tabular-nums text-zinc-100">{wr != null ? `${wr}%` : "--"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-white/8 pt-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Peak rank</div>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="rounded-xl bg-zinc-900/40 p-1.5 ring-1 ring-white/5">
            <RankEmblem
              tier={peak?.tier ?? null}
              className="h-8 w-8 shrink-0"
              alt={peak?.tier ? `${peak.tier} peak emblem` : "Peak rank emblem"}
            />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100">
              {peakLine ?? "Not enough history yet"}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {peakSeen ? `Recorded ${peakSeen}` : "Saved from your profile history"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
