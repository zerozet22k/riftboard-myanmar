import Link from "next/link";
import { dbConnect } from "@/lib/mongodb";
import { Player } from "@/models/player";
import RefreshButton from "@/components/RefreshButton";
import AutoUIRefresh from "@/components/AutoUIRefresh";
import PlayersTable from "@/components/PlayersTable";

export const dynamic = "force-dynamic";

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

function rankKey(tier?: string | null, div?: string | null, lp?: number | null) {
  const t = tier ? TIER_ORDER[String(tier).toUpperCase()] : undefined;
  if (t === undefined) return -1; // unranked
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

function topMains(p: any) {
  const src =
    (Array.isArray(p.mains) && p.mains) ||
    (Array.isArray(p.masteryTop) && p.masteryTop) ||
    (Array.isArray(p.mastery) && p.mastery) ||
    (Array.isArray(p.championMasteries) && p.championMasteries) ||
    [];

  const mapped = src
    .map((x: any) => ({
      championId: x.championId ?? x.id ?? x.champId ?? null,
      name: x.championName ?? x.name ?? x.champion ?? null,
      points: x.championPoints ?? x.points ?? x.masteryPoints ?? null,
    }))
    .filter((m: any) => m.championId != null || m.name);

  mapped.sort((a: any, b: any) => (b.points ?? -1) - (a.points ?? -1));
  return mapped.slice(0, 3);
}

export default async function HomePage() {
  await dbConnect();
  const players = await Player.find(
    {},
    { gameName: 1, tagLine: 1, platform: 1, solo: 1, flex: 1, mains: 1, masteryTop: 1 }
  ).lean();

  const rows = players.map((p: any) => {
    const solo = p.solo || {};
    const flex = p.flex || {};

    const soloTier = solo.tier ?? null;
    const soloDiv = solo.division ?? null;
    const soloLp = solo.lp ?? null;

    const flexTier = flex.tier ?? null;
    const flexDiv = flex.division ?? null;
    const flexLp = flex.lp ?? null;

    return {
      id: String(p._id),
      name: `${p.gameName}#${p.tagLine}`,
      platform: String(p.platform ?? "auto").toUpperCase(),

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

      mains: topMains(p),
    };
  });

  const rankedCount = rows.filter((r) => r.tier).length;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <AutoUIRefresh everyMs={15000} />

      <div className="mx-auto max-w-full p-4 sm:p-6 space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              RiftBoard Myanmar
            </h1>

            <p className="text-sm text-zinc-400">
              Add yourself at{" "}
              <Link
                className="font-mono underline underline-offset-4 hover:text-zinc-200"
                href="/submit"
              >
                /submit
              </Link>
              .
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                Players: <span className="text-zinc-200">{rows.length}</span>
              </span>
              <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1">
                Ranked: <span className="text-zinc-200">{rankedCount}</span>
              </span>
            </div>

            <RefreshButton />
          </div>
        </header>

        <PlayersTable initialRows={rows} />
      </div>
    </main>
  );
}
