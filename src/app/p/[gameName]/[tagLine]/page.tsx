import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import MatchHistory, { type MatchRow } from "@/components/MatchHistory";
import ProfileRefreshButton from "@/components/ProfileRefreshButton";
import RankEmblem from "@/components/RankEmblem";
import { getLatestDdragonVersion } from "@/lib/ddragon";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import { bestRankSnapshot } from "@/lib/rank";
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

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
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
  return formatDateTime(snapshot?.fetchedAt ?? null);
}

function cursorFromLast(last: MatchDoc | undefined) {
  if (!last || typeof last.gameCreation !== "number") return null;
  const payload = { gc: last.gameCreation, id: String(last._id) };
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

  const profileIcon =
    typeof player.profileIconId === "number"
      ? `https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/profileicon/${player.profileIconId}.png`
      : null;
  const nameShown = `${player.gameName}#${player.tagLine}`;
  const lastUpdated =
    formatDateTime(player.lastRefreshAt) ??
    formatDateTime(isoOrNull(player.solo?.fetchedAt)) ??
    formatDateTime(isoOrNull(player.flex?.fetchedAt));
  const masteryUpdated = formatDateTime(player.masterySyncedAt);
  const masteryPath = `${canonicalPath}/mastery`;
  const initialCursor = cursorFromLast(matchDocs[matchDocs.length - 1]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
              {profileIcon ? (
                <img src={profileIcon} alt="Profile icon" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" />
              )}
            </div>

            <div className="space-y-1">
              <div className="text-2xl font-semibold tracking-tight">{nameShown}</div>

              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <RankEmblem tier={solo.tier ?? null} className="h-5 w-5 shrink-0" alt="" />
                <span className="text-zinc-300">
                  {rankLine(solo.tier ?? null, solo.division ?? null, solo.lp ?? null)}
                </span>
              </div>

              <div className="text-sm text-zinc-400">
                Level: <span className="text-zinc-200">{player.summonerLevel ?? "--"}</span>
                <span className="px-2 text-zinc-600">/</span>
                Platform:{" "}
                <span className="text-zinc-200">{String(player.platform ?? "auto").toUpperCase()}</span>
                <span className="px-2 text-zinc-600">/</span>
                Match region:{" "}
                <span className="text-zinc-200">{String(player.matchRegion ?? "--").toUpperCase()}</span>
              </div>

              <div className="text-xs text-zinc-500">
                Last synced: <span className="text-zinc-300">{lastUpdated ?? "--"}</span>
              </div>

              <div className="flex items-center gap-3 pt-1 text-sm">
                <Link
                  href="/leaderboard"
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-2 hover:bg-zinc-900/60"
                >
                  Open leaderboard
                </Link>
                <Link
                  href="/"
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-2 hover:bg-zinc-900/60"
                >
                  Go back home
                </Link>
              </div>
            </div>
          </div>

          <ProfileRefreshButton gameName={canonicalGameName} tagLine={canonicalTagLineLower} />
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
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
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-lg font-semibold">Top champions</div>
              <div className="mt-1 text-xs text-zinc-500">
                Full mastery sync: <span className="text-zinc-300">{masteryUpdated ?? "Not synced yet"}</span>
              </div>
            </div>
            <Link
              href={masteryPath}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm hover:bg-white/5"
            >
              View all mastery
            </Link>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {Array.isArray(player.mains) && player.mains.length ? (
              player.mains.slice(0, 3).map((main, index) => {
                const championId = typeof main?.championId === "number" ? main.championId : null;
                const championName = championId != null ? champNames[String(championId)] : null;
                const points = typeof main?.championPoints === "number" ? main.championPoints : null;
                const icon = champIconUrl(championId);

                return (
                  <span
                    key={`${championId ?? "unknown"}-${index}`}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-sm"
                    title={
                      championName
                        ? `${championName} (#${championId})`
                        : championId != null
                          ? `Champion #${championId}`
                          : "Champion"
                    }
                  >
                    {icon ? <img src={icon} alt={championName ?? "Champion"} className="h-6 w-6 rounded-full" /> : null}
                    <span className="text-zinc-200">
                      {championName ?? (championId != null ? `#${championId}` : "--")}
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {points != null ? points.toLocaleString() : "--"} pts
                    </span>
                  </span>
                );
              })
            ) : (
              <div className="text-sm text-zinc-500">No mastery data yet.</div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-lg font-semibold">Match history</div>
          <MatchHistory
            gameName={canonicalGameName}
            tagLine={canonicalTagLineLower}
            ddragonVersion={ddVer}
            initialMatches={initialMatches}
            initialCursor={initialCursor}
          />
        </section>
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
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6">
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="mt-3 flex items-center gap-4">
        <RankEmblem
          tier={tier}
          className="h-14 w-14 shrink-0"
          alt={tier ? `${tier} emblem` : "Unranked emblem"}
        />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="border-zinc-800 bg-zinc-950/40 text-zinc-200">{currentLine}</Pill>
          </div>

          <div className="mt-2 text-sm tabular-nums text-zinc-400">
            {wl} <span className="text-zinc-600">/</span> {wr != null ? `${wr}%` : "--"}
          </div>

          <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
            <div className="uppercase tracking-wide text-zinc-500">App-tracked peak</div>
            <div className="mt-1 text-sm text-zinc-200">{peakLine ?? "Not enough history yet"}</div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {peakSeen ? `Seen ${peakSeen}` : "Peaks come from this app's saved rank history."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
