import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileRefreshButton from "@/components/ProfileRefreshButton";
import RankEmblem from "@/components/RankEmblem";
import TftMatchHistory, { type TftMatchRow } from "@/components/TftMatchHistory";
import {
  formatMetaDateTime as formatDisplayMetaDateTime,
  formatFullDateTime,
  formatNumber,
} from "@/lib/displayTime";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery } from "@/lib/playerIdentity";
import { bestRankSnapshot } from "@/lib/rank";
import {
  absoluteUrl,
  getSiteBannerUrl,
  getSiteOpenGraphImages,
  organizationSchemaId,
  SITE_NAME,
  websiteSchemaId,
} from "@/lib/seo";
import { hydrateTftMatches } from "@/lib/tftAssets";
import { Player } from "@/models/player";
import { RankEntry } from "@/models/rankEntry";
import { TftMatch } from "@/models/tftMatch";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { gameName: string; tagLine: string };

type RankSnapshot = {
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
  lastRefreshAt?: Date | string | null;
  tft?: RankSnapshot | null;
};

type TftMatchDocView = {
  _id: unknown;
  matchId?: string | null;
  queueId?: number | null;
  gameDatetime?: number | null;
  gameLength?: number | null;
  setNumber?: number | null;
  placement?: number | null;
  level?: number | null;
  lastRound?: number | null;
  playersEliminated?: number | null;
  totalDamageToPlayers?: number | null;
  goldLeft?: number | null;
  augments?: unknown[];
  traits?: unknown[];
  units?: unknown[];
};

type TftRawMatchView = {
  matchId?: string | null;
  raw?: unknown;
};

type TftRankHistoryRow = RankSnapshot & {
  queue: "RANKED_TFT";
};

function safeNum(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeStr(value: unknown) {
  return typeof value === "string" ? value : null;
}

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

function canonicalTftPlayerPath(gameName: string, tagLine: string) {
  return `/tft/p/${encodeURIComponent(gameName.trim())}/${encodeURIComponent(tagLine.trim().toLowerCase())}`;
}

function rankLine(tier?: string | null, division?: string | null, lp?: number | null) {
  if (!tier) return "UNRANKED";
  const divisionText = division ? ` ${String(division).toUpperCase()}` : "";
  const lpText = lp != null && Number.isFinite(Number(lp)) ? ` - ${formatNumber(lp)} LP` : "";
  return `${String(tier).toUpperCase()}${divisionText}${lpText}`;
}

function winrate(wins?: number | null, losses?: number | null) {
  if (wins == null || losses == null) return null;
  const total = wins + losses;
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function cursorFromLast(last: { _id: unknown; matchId?: string | null; gameDatetime?: number | null } | undefined) {
  if (!last || typeof last.gameDatetime !== "number") return null;
  const payload = { gd: last.gameDatetime, id: String(last._id), matchId: String(last.matchId ?? "") };
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function serializedTraits(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((trait) => {
    const row = trait && typeof trait === "object" ? (trait as Record<string, unknown>) : {};
    return {
      name: typeof row.name === "string" ? row.name : null,
      numUnits: typeof row.numUnits === "number" ? row.numUnits : null,
      style: typeof row.style === "number" ? row.style : null,
      tierCurrent: typeof row.tierCurrent === "number" ? row.tierCurrent : null,
      tierTotal: typeof row.tierTotal === "number" ? row.tierTotal : null,
    };
  });
}

function serializedUnits(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((unit) => {
    const row = unit && typeof unit === "object" ? (unit as Record<string, unknown>) : {};
    return {
      characterId: typeof row.characterId === "string" ? row.characterId : null,
      name: typeof row.name === "string" ? row.name : null,
      rarity: typeof row.rarity === "number" ? row.rarity : null,
      tier: typeof row.tier === "number" ? row.tier : null,
      itemNames: Array.isArray(row.itemNames)
        ? row.itemNames.filter((item): item is string => typeof item === "string")
        : [],
    };
  });
}

function serializeParticipant(participant: unknown) {
  const row = participant && typeof participant === "object" ? (participant as Record<string, unknown>) : {};
  return {
    puuid: safeStr(row.puuid),
    riotIdGameName: safeStr(row.riotIdGameName),
    riotIdTagline: safeStr(row.riotIdTagline),
    placement: safeNum(row.placement),
    level: safeNum(row.level),
    lastRound: safeNum(row.last_round),
    playersEliminated: safeNum(row.players_eliminated),
    totalDamageToPlayers: safeNum(row.total_damage_to_players),
    goldLeft: safeNum(row.gold_left),
    augments: Array.isArray(row.augments)
      ? row.augments.filter((value): value is string => typeof value === "string")
      : [],
    traits: Array.isArray(row.traits)
      ? row.traits.map((trait) => {
          const traitRow = trait && typeof trait === "object" ? (trait as Record<string, unknown>) : {};
          return {
            name: safeStr(traitRow.name),
            numUnits: safeNum(traitRow.num_units),
            style: safeNum(traitRow.style),
            tierCurrent: safeNum(traitRow.tier_current),
            tierTotal: safeNum(traitRow.tier_total),
          };
        })
      : [],
    units: Array.isArray(row.units)
      ? row.units.map((unit) => {
          const unitRow = unit && typeof unit === "object" ? (unit as Record<string, unknown>) : {};
          return {
            characterId: safeStr(unitRow.character_id),
            name: safeStr(unitRow.name),
            rarity: safeNum(unitRow.rarity),
            tier: safeNum(unitRow.tier),
            itemNames: Array.isArray(unitRow.itemNames)
              ? unitRow.itemNames.filter((item): item is string => typeof item === "string")
              : [],
          };
        })
      : [],
  };
}

function serializeParticipants(raw: unknown) {
  const payload = raw && typeof raw === "object" ? (raw as { info?: { participants?: unknown[] } }) : {};
  const participants = Array.isArray(payload.info?.participants) ? payload.info.participants : [];
  return participants.map(serializeParticipant).sort((left, right) => (left.placement ?? 99) - (right.placement ?? 99));
}

function playerMetaDescription(player: Pick<PlayerView, "gameName" | "tagLine" | "tft">) {
  return `${player.gameName}#${player.tagLine} TFT profile on RiftBoard Myanmar. Current TFT rank ${rankLine(
    player.tft?.tier ?? null,
    player.tft?.division ?? null,
    player.tft?.lp ?? null
  )}. View TFT LP, peak rank, placements, traits, units, and match history.`;
}

export async function generateMetadata({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}): Promise<Metadata> {
  const resolved = (await params) as Partial<RouteParams>;
  const gameNameRaw = safeDecode(resolved.gameName).trim();
  const tagLineRaw = safeDecode(resolved.tagLine).trim().toLowerCase();
  if (!gameNameRaw || !tagLineRaw) return { title: "TFT Player Profile", robots: { index: false, follow: false } };

  await dbConnect();
  const player = (await Player.findOne(
    { ...buildPlayerLookupQuery(gameNameRaw, tagLineRaw), "leaderboard.status": "approved" },
    { gameName: 1, tagLine: 1, tft: 1 }
  ).lean()) as Pick<PlayerView, "gameName" | "tagLine" | "tft"> | null;

  if (!player?.gameName || !player.tagLine) {
    return { title: "TFT Player Not Found", robots: { index: false, follow: false } };
  }

  const canonicalPath = canonicalTftPlayerPath(player.gameName, player.tagLine);
  const riotId = `${player.gameName}#${player.tagLine}`;
  const title = `${riotId} TFT Profile`;
  const description = playerMetaDescription(player);

  return {
    title,
    description,
    keywords: [
      riotId,
      `${player.gameName} ${player.tagLine}`,
      `${riotId} RiftBoard Myanmar`,
      `${riotId} Teamfight Tactics`,
      `${riotId} TFT profile`,
      `${riotId} TFT match history`,
    ],
    alternates: { canonical: canonicalPath },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "profile",
      url: absoluteUrl(canonicalPath),
      title,
      description,
      siteName: SITE_NAME,
      images: getSiteOpenGraphImages(),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: getSiteOpenGraphImages().map((image) => image.url),
    },
  };
}

export default async function TftPlayerProfilePage({
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
    { ...buildPlayerLookupQuery(gameNameRaw, tagLineRaw), "leaderboard.status": "approved" },
    {
      gameName: 1,
      tagLine: 1,
      platform: 1,
      matchRegion: 1,
      profileIconId: 1,
      summonerLevel: 1,
      lastRefreshAt: 1,
      tft: 1,
    }
  ).lean()) as PlayerView | null;

  if (!player?._id) notFound();

  const canonicalGameName = player.gameName.trim();
  const canonicalTagLineLower = player.tagLine.trim().toLowerCase();
  const canonicalPath = canonicalTftPlayerPath(canonicalGameName, canonicalTagLineLower);
  if (gameNameRaw !== canonicalGameName || tagLineRaw !== canonicalTagLineLower) redirect(canonicalPath);

  const [rankHistory, matchDocs] = await Promise.all([
    RankEntry.find(
      { playerId: player._id, queue: "RANKED_TFT" },
      { queue: 1, tier: 1, division: 1, lp: 1, wins: 1, losses: 1, fetchedAt: 1 }
    )
      .sort({ fetchedAt: -1 })
      .lean() as Promise<TftRankHistoryRow[]>,
    TftPlayerMatch.find({ playerId: player._id })
      .sort({ gameDatetime: -1, _id: -1 })
      .limit(20)
      .lean(),
  ]);

  const rawMatches = await TftMatch.find(
    { matchId: { $in: (matchDocs as TftMatchDocView[]).map((match) => String(match.matchId ?? "")).filter(Boolean) } },
    { matchId: 1, raw: 1 }
  ).lean<TftRawMatchView[]>();
  const rawByMatchId = new Map(rawMatches.map((match) => [String(match.matchId ?? ""), match.raw]));

  const serializedMatches: TftMatchRow[] = (matchDocs as TftMatchDocView[]).map((match) => ({
    _id: String(match._id),
    matchId: String(match.matchId ?? ""),
    queueId: typeof match.queueId === "number" ? match.queueId : null,
    gameDatetime: typeof match.gameDatetime === "number" ? match.gameDatetime : null,
    gameLength: typeof match.gameLength === "number" ? match.gameLength : null,
    setNumber: typeof match.setNumber === "number" ? match.setNumber : null,
    placement: typeof match.placement === "number" ? match.placement : null,
    level: typeof match.level === "number" ? match.level : null,
    lastRound: typeof match.lastRound === "number" ? match.lastRound : null,
    playersEliminated: typeof match.playersEliminated === "number" ? match.playersEliminated : null,
    totalDamageToPlayers: typeof match.totalDamageToPlayers === "number" ? match.totalDamageToPlayers : null,
    goldLeft: typeof match.goldLeft === "number" ? match.goldLeft : null,
    augments: Array.isArray(match.augments)
      ? match.augments.filter((value: unknown): value is string => typeof value === "string")
      : [],
    traits: serializedTraits(match.traits),
    units: serializedUnits(match.units),
    participants: serializeParticipants(rawByMatchId.get(String(match.matchId ?? ""))),
  }));
  const initialMatches = await hydrateTftMatches(serializedMatches);

  const tft = player.tft ?? {};
  const tftPeak = rankHistory.length ? bestRankSnapshot(rankHistory) : tft.tier ? tft : null;
  const wr = winrate(tft.wins ?? null, tft.losses ?? null);
  const record = tft.wins != null && tft.losses != null ? `${tft.wins}-${tft.losses}` : "--";
  const nameShown = `${player.gameName}#${player.tagLine}`;
  const lastUpdatedShort =
    formatDisplayMetaDateTime(player.tft?.fetchedAt ?? null) ??
    formatDisplayMetaDateTime(player.lastRefreshAt ?? null);
  const lolProfilePath = `/p/${encodeURIComponent(canonicalGameName)}/${encodeURIComponent(canonicalTagLineLower)}`;
  const profileUrl = absoluteUrl(canonicalPath);
  const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(profileUrl)}`;
  // eslint-disable-next-line react-hooks/purity
  const renderedAtMs = Date.now();
  const profileJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: absoluteUrl(canonicalPath),
    name: `${player.gameName}#${player.tagLine} TFT`,
    alternateName: [
      nameShown,
      `${player.gameName} ${player.tagLine}`,
      `${player.gameName} / ${player.tagLine}`,
    ],
    identifier: nameShown,
    description: playerMetaDescription(player),
    image: [getSiteBannerUrl()],
    isPartOf: { "@id": websiteSchemaId() },
    publisher: { "@id": organizationSchemaId() },
    mainEntity: {
      "@type": "Thing",
      name: nameShown,
      alternateName: [`${player.gameName} ${player.tagLine}`, `${player.gameName} / ${player.tagLine}`],
      identifier: nameShown,
    },
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(20,184,166,0.20),transparent_30%),radial-gradient(circle_at_18%_18%,rgba(59,130,246,0.12),transparent_24%),#09090b] text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(profileJsonLd) }}
      />
      <div className="mx-auto w-full max-w-[1400px] space-y-3 px-4 py-3 sm:px-5 sm:py-4 lg:px-6">
        <section className="relative overflow-hidden rounded-[24px] bg-zinc-950/62 p-4 ring-1 ring-white/5 sm:p-5">
          <div className="relative grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
              <ProfileAvatar
                iconId={player.profileIconId ?? null}
                alt={`${nameShown} profile icon`}
                className="h-[72px] w-[72px] shrink-0 sm:h-[88px] sm:w-[88px]"
                level={player.summonerLevel ?? null}
              />

              <div className="min-w-0 space-y-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[2rem]">
                    {nameShown}
                  </h1>
                  <span className="rounded-full border border-teal-400/25 bg-teal-400/10 px-2.5 py-1 text-xs text-teal-100">
                    TFT
                  </span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-300">
                    {String(player.platform ?? "auto").toUpperCase()}
                  </span>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full bg-teal-500/10 px-3 py-1 text-sm text-zinc-200">
                  <RankEmblem tier={tft.tier ?? null} className="h-4 w-4 shrink-0" alt="" />
                  <span>{rankLine(tft.tier ?? null, tft.division ?? null, tft.lp ?? null)}</span>
                </div>

                <div className="flex flex-wrap items-start gap-2.5">
                  <StatTile label="Record" value={record} />
                  <StatTile label="Win rate" value={wr != null ? `${wr}%` : "--"} />
                  <StatTile label="Updated" value={lastUpdatedShort ?? "--"} />
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href={lolProfilePath}
                    className="rounded-xl bg-zinc-950/42 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                  >
                    LoL profile
                  </Link>
                  <Link
                    href={canonicalPath}
                    aria-current="page"
                    className="rounded-xl bg-teal-500/12 px-3.5 py-2 text-sm font-medium text-teal-100 ring-1 ring-teal-300/20"
                  >
                    TFT profile
                  </Link>
                  <Link
                    href="/tft"
                    className="rounded-xl bg-zinc-950/42 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                  >
                    TFT leaderboard
                  </Link>
                  <a
                    href={facebookShareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl bg-zinc-950/42 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                  >
                    Share Facebook
                  </a>
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2">
              <div className="flex justify-start xl:justify-end">
                <ProfileRefreshButton gameName={canonicalGameName} tagLine={canonicalTagLineLower} mode="tft" />
              </div>
              <RankCard
                title="TFT Ranked"
                current={tft}
                peak={tftPeak}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Recent games</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">TFT match history</div>
          </div>
          <TftMatchHistory
            gameName={canonicalGameName}
            tagLine={canonicalTagLineLower}
            initialMatches={initialMatches}
            initialCursor={cursorFromLast(matchDocs[matchDocs.length - 1] as TftMatchDocView | undefined)}
            renderedAtMs={renderedAtMs}
          />
        </section>
      </div>
    </main>
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

function RankCard({
  title,
  current,
  peak,
}: {
  title: string;
  current: RankSnapshot;
  peak: RankSnapshot | null;
}) {
  const peakLine = peak ? rankLine(peak.tier ?? null, peak.division ?? null, peak.lp ?? null) : null;
  const currentLine = rankLine(current.tier ?? null, current.division ?? null, current.lp ?? null);
  const peakSeen = formatFullDateTime(peak?.fetchedAt ?? null);

  return (
    <div className="overflow-hidden rounded-[20px] bg-zinc-900/18 p-4 ring-1 ring-white/5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{title}</div>
      <div className="mt-3 flex items-start gap-3">
        <div className="rounded-[18px] bg-zinc-950/40 p-2 ring-1 ring-white/5">
          <RankEmblem tier={current.tier ?? null} className="h-12 w-12 shrink-0" alt="" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold tracking-tight text-zinc-50">{currentLine}</div>
          <div className="mt-2 text-sm text-zinc-400">
            {current.wins != null && current.losses != null ? `${current.wins}-${current.losses}` : "--"} record
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-white/8 pt-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Peak rank</div>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="rounded-xl bg-zinc-900/40 p-1.5 ring-1 ring-white/5">
            <RankEmblem tier={peak?.tier ?? null} className="h-8 w-8 shrink-0" alt="" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100">{peakLine ?? "Not enough history yet"}</div>
            <div className="mt-1 text-xs text-zinc-500">
              {peakSeen ? `Recorded ${peakSeen}` : "Saved from TFT rank history"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
