"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RankEmblem from "@/components/RankEmblem";

const PROFILE_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons";

type SearchResult = {
  id: string;
  name: string;
  path: string;
  platform?: string | null;
  profileIconId?: number | null;
  soloTier?: string | null;
  soloDivision?: string | null;
  soloLp?: number | null;
};

function profileIconUrl(profileIconId?: number | null) {
  if (profileIconId == null || !Number.isFinite(Number(profileIconId))) return null;
  return `${PROFILE_ICON_BASE}/${Number(profileIconId)}.jpg`;
}

function rankLine(item: SearchResult) {
  if (!item.soloTier) return item.platform ? `${item.platform} - UNRANKED` : "UNRANKED";
  const tier = String(item.soloTier).toUpperCase();
  const division = item.soloDivision ? ` ${String(item.soloDivision).toUpperCase()}` : "";
  const lp = typeof item.soloLp === "number" ? ` ${item.soloLp} LP` : "";
  const rank = `${tier}${division}${lp}`;
  return item.platform ? `${item.platform} - ${rank}` : rank;
}

function tierColorClass(tier?: string | null) {
  const value = String(tier ?? "").toUpperCase();
  if (value === "CHALLENGER") return "border-sky-200/40 bg-sky-300/15 text-sky-100";
  if (value === "GRANDMASTER") return "border-red-300/40 bg-red-400/15 text-red-100";
  if (value === "MASTER") return "border-purple-300/40 bg-purple-400/15 text-purple-100";
  if (value === "DIAMOND") return "border-cyan-300/40 bg-cyan-400/15 text-cyan-100";
  if (value === "EMERALD") return "border-emerald-300/40 bg-emerald-400/15 text-emerald-100";
  if (value === "PLATINUM") return "border-teal-200/35 bg-teal-300/12 text-teal-100";
  if (value === "GOLD") return "border-yellow-300/45 bg-yellow-300/15 text-yellow-100";
  if (value === "SILVER") return "border-zinc-200/35 bg-zinc-200/12 text-zinc-100";
  if (value === "BRONZE") return "border-amber-700/45 bg-amber-700/18 text-amber-100";
  if (value === "IRON") return "border-stone-500/40 bg-stone-500/15 text-stone-200";
  return "border-zinc-700/70 bg-zinc-900/65 text-zinc-400";
}

function splitRiotId(name: string) {
  const hash = name.lastIndexOf("#");
  if (hash <= 0) return { gameName: name, tagLine: "" };
  return { gameName: name.slice(0, hash), tagLine: name.slice(hash + 1) };
}

export default function HeaderPlayerSearch() {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const trimmed = query.trim();
  const showMenu = open && trimmed.length >= 2;
  const addHref = trimmed
    ? `/discord/linked-roles?riotId=${encodeURIComponent(trimmed)}`
    : "/discord/linked-roles";

  useEffect(() => {
    function onDown(event: MouseEvent) {
      const element = wrapRef.current;
      if (!element) return;
      if (!element.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (trimmed.length < 2) {
      setItems([]);
      setLoading(false);
      setActive(0);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/p/search?q=${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          items?: SearchResult[];
        };
        const nextItems = Array.isArray(data.items)
          ? data.items.filter((item) => typeof item.path === "string" && item.path.startsWith("/p/"))
          : [];
        if (!controller.signal.aborted) {
          setItems(nextItems);
          setActive(0);
          setOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [trimmed]);

  function go(item: SearchResult | undefined) {
    if (!item?.path) return;
    setOpen(false);
    setQuery("");
    router.push(item.path);
  }

  return (
    <div ref={wrapRef} className="relative w-full min-w-0 lg:w-[280px] xl:w-[340px]">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!showMenu && event.key !== "Escape") return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => Math.min(Math.max(0, items.length - 1), current + 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => Math.max(0, current - 1));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            go(items[active] ?? items[0]);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Search Riftboard users"
        className="h-10 w-full rounded-full border border-white/10 bg-zinc-950/55 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 transition focus:border-white/20 focus:bg-zinc-950/80"
      />

      {showMenu ? (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="border-b border-white/8 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
            Riftboard users
          </div>

          {loading ? <div className="px-3 py-3 text-xs text-zinc-500">Searching...</div> : null}
          {!loading && !items.length ? (
            <div className="px-3 py-3 text-xs text-zinc-500">No tracked Riftboard user found.</div>
          ) : null}

          {!loading && items.length ? (
            <div className="max-h-[280px] overflow-auto py-1">
              {items.map((item, index) => {
                const { gameName, tagLine } = splitRiotId(item.name);
                const icon = profileIconUrl(item.profileIconId ?? null);
                const activeRow = index === active;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(item)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${
                      activeRow ? "bg-white/8" : "hover:bg-white/5"
                    }`}
                  >
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-zinc-900 ring-1 ring-white/8">
                      {icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={icon}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(event) => {
                            const image = event.currentTarget;
                            if (image.dataset.fallback === "1") return;
                            image.dataset.fallback = "1";
                            image.src = String(image.src).replace(/\.jpg$/i, ".png");
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-zinc-100">
                        {gameName}
                        {tagLine ? <span className="font-normal text-zinc-500"> #{tagLine}</span> : null}
                      </div>
                      <div
                        className={`mt-1 inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${tierColorClass(
                          item.soloTier,
                        )}`}
                      >
                        <RankEmblem
                          tier={item.soloTier ?? null}
                          className="h-3.5 w-3.5 shrink-0"
                          alt={item.soloTier ? `${item.soloTier} emblem` : "Unranked emblem"}
                        />
                        <span className="truncate">{rankLine(item)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          <Link
            href={addHref}
            onClick={() => setOpen(false)}
            className="flex items-center justify-between border-t border-white/8 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/10"
          >
            <span>{"Can't find yourself?"}</span>
            <span className="text-[11px] text-emerald-200/60">{trimmed || "Link Riot"}</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
