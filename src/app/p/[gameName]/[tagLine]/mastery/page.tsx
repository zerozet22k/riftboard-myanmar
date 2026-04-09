import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import MasteryTable, { type MasteryRow } from "@/components/MasteryTable";
import { formatFullDateTime } from "@/lib/displayTime";
import { dbConnect } from "@/lib/mongodb";
import { buildPlayerLookupQuery, canonicalPlayerPath } from "@/lib/playerIdentity";
import { absoluteUrl, getSiteOpenGraphImages, SITE_LOGO_PATH } from "@/lib/seo";
import { Player } from "@/models/player";
import { PlayerMastery } from "@/models/playerMastery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";

type RouteParams = { gameName: string; tagLine: string };

type ChampionSummaryEntry = {
  id?: number;
  name?: string;
};

function safeDecode(seg: unknown) {
  try {
    return decodeURIComponent(String(seg ?? ""));
  } catch {
    return String(seg ?? "");
  }
}

async function getChampionNameMap() {
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
      title: "Champion Mastery",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  await dbConnect();

  const player = await Player.findOne(
    buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
    { gameName: 1, tagLine: 1 }
  ).lean<{ gameName?: string; tagLine?: string } | null>();

  if (!player?.gameName || !player.tagLine) {
    return {
      title: "Champion Mastery",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const canonicalPath = `${canonicalPlayerPath(player.gameName, player.tagLine)}/mastery`;
  const title = `${player.gameName}#${player.tagLine} Champion Mastery`;
  const description = `Champion mastery table for ${player.gameName}#${player.tagLine} on RiftBoard Myanmar, including points, levels, and tracked mastery progress.`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      type: "article",
      url: absoluteUrl(canonicalPath),
      title,
      description,
      images: getSiteOpenGraphImages(),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [absoluteUrl(SITE_LOGO_PATH), ...getSiteOpenGraphImages().map((image) => image.url)],
    },
  };
}

export default async function PlayerMasteryPage({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}) {
  const resolved = (await params) as Partial<RouteParams>;
  const gameNameRaw = safeDecode(resolved.gameName).trim();
  const tagLineRaw = safeDecode(resolved.tagLine).trim().toLowerCase();

  if (!gameNameRaw || !tagLineRaw) notFound();

  await dbConnect();

  const player: {
    _id: unknown;
    gameName: string;
    tagLine: string;
    masterySyncedAt?: Date | null;
  } | null = await Player.findOne(
    buildPlayerLookupQuery(gameNameRaw, tagLineRaw),
    { gameName: 1, tagLine: 1, masterySyncedAt: 1 }
  ).lean();

  if (!player?._id) notFound();

  const canonicalPath = canonicalPlayerPath(player.gameName, player.tagLine);
  if (gameNameRaw !== player.gameName || tagLineRaw !== String(player.tagLine).toLowerCase()) {
    redirect(`${canonicalPath}/mastery`);
  }

  const [championNames, masteryDocs] = await Promise.all([
    getChampionNameMap(),
    PlayerMastery.find({ playerId: player._id })
      .sort({ championPoints: -1, championLevel: -1, championId: 1 })
      .lean(),
  ]);

  const rows: MasteryRow[] = masteryDocs.map((doc) => ({
    championId: typeof doc.championId === "number" ? doc.championId : 0,
    championName: championNames[String(doc.championId)] ?? `Champion #${doc.championId}`,
    championLevel: typeof doc.championLevel === "number" ? doc.championLevel : null,
    championPoints: typeof doc.championPoints === "number" ? doc.championPoints : null,
    lastPlayTime: typeof doc.lastPlayTime === "number" ? doc.lastPlayTime : null,
    chestGranted: typeof doc.chestGranted === "boolean" ? doc.chestGranted : null,
    tokensEarned: typeof doc.tokensEarned === "number" ? doc.tokensEarned : null,
    championPointsSinceLastLevel:
      typeof doc.championPointsSinceLastLevel === "number" ? doc.championPointsSinceLastLevel : null,
    championPointsUntilNextLevel:
      typeof doc.championPointsUntilNextLevel === "number" ? doc.championPointsUntilNextLevel : null,
    markRequiredForNextLevel:
      typeof doc.markRequiredForNextLevel === "number" ? doc.markRequiredForNextLevel : null,
    championSeasonMilestone:
      typeof doc.championSeasonMilestone === "number" ? doc.championSeasonMilestone : null,
    fetchedAt: doc.fetchedAt instanceof Date ? doc.fetchedAt.toISOString() : null,
  }));

  const lastSyncedLabel = formatFullDateTime(player.masterySyncedAt ?? masteryDocs[0]?.fetchedAt ?? null);
  const stale = !player.masterySyncedAt;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-3xl font-semibold tracking-tight">{player.gameName}#{player.tagLine}</div>
            <div className="mt-1 text-sm text-zinc-400">
              Full champion mastery database for this tracked player.
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={canonicalPath}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-2 hover:bg-zinc-900/60"
            >
              Back to profile
            </Link>
          </div>
        </header>

        {rows.length === 0 ? (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-400 sm:p-6">
            No stored mastery rows yet. Refresh this player profile to sync mastery from Riot.
          </section>
        ) : (
          <MasteryTable rows={rows} lastSyncedLabel={lastSyncedLabel} stale={stale} />
        )}
      </div>
    </main>
  );
}
