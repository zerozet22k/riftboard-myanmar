// src/components/MatchHistory.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

export type MatchRow = {
  _id: string;
  matchId: string;
  queueId: number | null;
  gameCreation: number | null; // epoch ms
  gameDuration: number | null; // seconds

  championId: number | null;
  teamId?: number | null; // 100 blue, 200 red (optional)
  win: boolean | null;

  kills: number | null;
  deaths: number | null;
  assists: number | null;

  cs: number | null;
  gold: number | null;

  items: number[];
  summonerSpells: number[];
};

function queueName(queueId: number | null) {
  if (queueId == null) return "Unknown";
  return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

const QUEUE_NAMES: Record<number, string> = {
  // Ranked
  420: "Ranked Solo/Duo",
  440: "Ranked Flex",
  700: "Clash",

  // Normal SR
  400: "Normal Draft",
  430: "Normal Blind",
  490: "Quickplay",

  // ARAM + rotating
  450: "ARAM",
  900: "ARURF",
  1010: "URF",
  1020: "One for All",
  1300: "Nexus Blitz",
  1400: "Ultimate Spellbook",

  // Bot games
  830: "Co-op vs AI (Intro)",
  840: "Co-op vs AI (Beginner)",
  850: "Co-op vs AI (Intermediate)",

  // Arena
  1700: "Arena",
  1710: "Arena",
  1720: "Arena",

  // TFT
  1090: "TFT (Normal)",
  1100: "TFT (Ranked)",
  1110: "TFT (Tutorial)",
  1130: "TFT (Hyper Roll)",
  1160: "TFT (Double Up)",
};

const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

const CHAMP_SUMMARY_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";

function matchesUrl(gameName: string, tagLine: string, limit: number, cursor?: string | null) {
  const gn = String(gameName ?? "").trim();
  const tl = String(tagLine ?? "").trim().toLowerCase();
  const base = `/api/p/${encodeURIComponent(gn)}/${encodeURIComponent(tl)}/matches`;

  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("autosync", "1");
  if (cursor) qs.set("cursor", cursor);

  return `${base}?${qs.toString()}`;
}

function fmtDuration(sec: number | null) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function fmtAgo(epochMs: number | null) {
  if (!epochMs || !Number.isFinite(epochMs)) return null;
  const d = Date.now() - epochMs;
  if (d < 0) return null;
  const mins = Math.floor(d / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type ItemInfo = { name: string; plaintext?: string; gold?: number };
type SpellInfo = { name: string; iconFull: string };

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-none tabular-nums " +
        className
      }
    >
      {children}
    </span>
  );
}

function ItemIcon({
  id,
  url,
  info,
}: {
  id: number;
  url: string;
  info: ItemInfo | null;
}) {
  const title = info?.name ? info.name : `Item ${id}`;
  const body = info?.plaintext?.trim();
  const gold = typeof info?.gold === "number" ? info.gold : null;

  return (
    <div className="group relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={title}
        className="h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900/30"
        loading="lazy"
      />

      {/* Tooltip */}
      <div className="pointer-events-none absolute left-1/2 z-50 hidden w-64 -translate-x-1/2 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 text-xs shadow-xl backdrop-blur group-hover:block -top-2 -translate-y-full">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-zinc-100 truncate">{title}</div>
          {gold != null ? (
            <div className="text-[11px] text-zinc-400 tabular-nums">{gold.toLocaleString()}g</div>
          ) : null}
        </div>
        {body ? <div className="mt-1 text-[11px] leading-snug text-zinc-400">{body}</div> : null}
        {!body && gold == null ? (
          <div className="mt-1 text-[11px] text-zinc-500">Item #{id}</div>
        ) : null}
      </div>
    </div>
  );
}

function sideLabel(teamId?: number | null) {
  if (teamId === 100) return "BLUE SIDE";
  if (teamId === 200) return "RED SIDE";
  return null;
}

export default function MatchHistory({
  gameName,
  tagLine,
  ddragonVersion,
  initialMatches,
  initialCursor,
}: {
  gameName: string;
  tagLine: string;
  ddragonVersion: string;
  initialMatches: MatchRow[];
  initialCursor: string | null;
}) {
  const [items, setItems] = useState<MatchRow[]>(initialMatches);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Item map (id -> name/plaintext/cost)
  const [itemMap, setItemMap] = useState<Record<string, ItemInfo>>({});
  // Summoner spells map (id -> icon+name)
  const [spellMap, setSpellMap] = useState<Record<string, SpellInfo>>({});
  // Champion name map (id -> name) optional
  const [champMap, setChampMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;

    // Items
    fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/item.json`, {
      cache: "force-cache",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.data) return;
        const out: Record<string, ItemInfo> = {};
        for (const [id, v] of Object.entries<any>(j.data)) {
          out[id] = {
            name: String(v?.name ?? `Item ${id}`),
            plaintext: typeof v?.plaintext === "string" ? v.plaintext : undefined,
            gold: typeof v?.gold?.total === "number" ? v.gold.total : undefined,
          };
        }
        setItemMap(out);
      })
      .catch(() => {});

    // Spells
    fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/summoner.json`, {
      cache: "force-cache",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.data) return;
        const out: Record<string, SpellInfo> = {};
        for (const v of Object.values<any>(j.data)) {
          const idStr = String(v?.key ?? "");
          const iconFull = String(v?.image?.full ?? "");
          if (!idStr || !iconFull) continue;
          out[idStr] = { name: String(v?.name ?? `Spell ${idStr}`), iconFull };
        }
        setSpellMap(out);
      })
      .catch(() => {});

    // Champ names (nice-to-have)
    fetch(CHAMP_SUMMARY_URL, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        const out: Record<string, string> = {};
        for (const c of list) {
          if (c?.id != null && c?.name) out[String(c.id)] = String(c.name);
        }
        setChampMap(out);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [ddragonVersion]);

  async function loadMore() {
    if (!cursor || loading) return;

    const gn = String(gameName ?? "").trim();
    const tl = String(tagLine ?? "").trim().toLowerCase();
    if (!gn || !tl) {
      setErr("Missing gameName/tagLine");
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(matchesUrl(gn, tl, 10, cursor), { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? `Failed (${res.status})`);

      setItems((prev) => [...prev, ...(Array.isArray(j.matches) ? j.matches : [])]);
      setCursor(j.nextCursor ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Load failed");
    } finally {
      setLoading(false);
    }
  }

  const empty = items.length === 0;

  const shownCount = useMemo(() => items.length, [items.length]);

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6 space-y-4">
      {empty ? (
        <div className="text-sm text-zinc-400">No matches yet. Hit Refresh to sync some.</div>
      ) : (
        <div className="space-y-3">
          {items.map((m) => {
            const champIcon = m.championId != null ? `${CHAMP_ICON_BASE}/${m.championId}.png` : null;
            const champName = m.championId != null ? champMap[String(m.championId)] : null;

            const k = m.kills ?? 0;
            const d = m.deaths ?? 0;
            const a = m.assists ?? 0;
            const kda = d === 0 ? `${k + a}.00` : ((k + a) / d).toFixed(2);

            const win = m.win === true;
            const playedAt = m.gameCreation ? new Date(m.gameCreation) : null;
            const playedStr = playedAt ? playedAt.toLocaleString() : "—";
            const ago = fmtAgo(m.gameCreation ?? null);

            const dur = fmtDuration(m.gameDuration ?? null);
            const side = sideLabel(m.teamId ?? null);

            const accent = win ? "border-l-blue-500/70" : "border-l-red-500/70";
            const tint = win ? "bg-blue-500/5" : "bg-red-500/5";
            const resultPill = win
              ? "border-blue-500/30 bg-blue-500/10 text-blue-200"
              : "border-red-500/30 bg-red-500/10 text-red-200";

            const spellA = m.summonerSpells?.[0] ?? null;
            const spellB = m.summonerSpells?.[1] ?? null;

            const spellAInfo = spellA != null ? spellMap[String(spellA)] : null;
            const spellBInfo = spellB != null ? spellMap[String(spellB)] : null;

            return (
              <div
                key={m._id}
                className={`rounded-2xl border border-zinc-800 ${tint} p-3 sm:p-4 border-l-4 ${accent}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {champIcon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={champIcon}
                        alt={champName ?? "Champion"}
                        className="h-12 w-12 rounded-2xl border border-zinc-800 bg-zinc-900/40"
                        title={champName ?? (m.championId != null ? `Champion #${m.championId}` : "Champion")}
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-2xl border border-zinc-800 bg-zinc-900/40" />
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm text-zinc-400">{queueName(m.queueId)}</div>
                        <Pill className={resultPill}>{win ? "WIN" : "LOSS"}</Pill>
                        {side ? (
                          <Pill className="border-zinc-800 bg-zinc-950/30 text-zinc-300">{side}</Pill>
                        ) : null}
                        <Pill className="border-zinc-800 bg-zinc-950/30 text-zinc-300">
                          {dur}
                        </Pill>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <div className="text-base font-semibold text-zinc-100 tabular-nums">
                          {k}/{d}/{a}
                          <span className="text-zinc-500 font-normal"> • </span>
                          <span className="text-zinc-300">{kda} KDA</span>
                        </div>

                        {champName ? (
                          <div className="text-xs text-zinc-400 truncate">• {champName}</div>
                        ) : null}
                      </div>

                      <div className="mt-1 text-xs text-zinc-500">
                        {playedStr}
                        {ago ? <span className="text-zinc-600"> • </span> : null}
                        {ago ? <span className="text-zinc-400">{ago}</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right text-xs text-zinc-500 tabular-nums space-y-1">
                    <div>CS: <span className="text-zinc-300">{m.cs ?? "—"}</span></div>
                    <div>Gold: <span className="text-zinc-300">{m.gold != null ? m.gold.toLocaleString() : "—"}</span></div>
                  </div>
                </div>

                {/* spells + items */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {/* Spells */}
                  <div className="flex items-center gap-2">
                    {spellAInfo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
                        alt={spellAInfo.name}
                        title={spellAInfo.name}
                        className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30" />
                    )}

                    {spellBInfo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
                        alt={spellBInfo.name}
                        title={spellBInfo.name}
                        className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30" />
                    )}
                  </div>

                  {/* Items */}
                  <div className="flex flex-wrap gap-2">
                    {m.items?.length ? (
                      m.items.slice(0, 7).map((id, idx) => {
                        const url = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`;
                        const info = itemMap[String(id)] ?? null;
                        return (
                          <ItemIcon key={`${m._id}-${id}-${idx}`} id={id} url={url} info={info} />
                        );
                      })
                    ) : (
                      <div className="text-xs text-zinc-500">No items captured.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {err && <div className="text-sm text-red-300">{err}</div>}

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-zinc-500">
          Showing <span className="text-zinc-300">{shownCount}</span> matches
        </div>

        <button
          onClick={loadMore}
          disabled={!cursor || loading}
          className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm disabled:opacity-40 hover:bg-white/5"
        >
          {loading ? "Loading…" : cursor ? "Load more" : "No more"}
        </button>
      </div>
    </div>
  );
}
