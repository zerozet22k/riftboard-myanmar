"use client";

import type { ReactNode } from "react";
import RankEmblem from "@/components/RankEmblem";

type RankSnapshot = {
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
  fetchedAt?: string | null;
};

export type MatchParticipant = {
  puuid: string | null;
  isMe: boolean;
  riotId: string | null;
  summonerName: string | null;
  gameName: string | null;
  tagLine: string | null;
  platform: string | null;
  profileIconId: number | null;
  summonerLevel: number | null;
  championId: number | null;
  teamId: number | null;
  teamPosition: string | null;
  primaryStyle?: number | null;
  primaryRune?: number | null;
  subStyle?: number | null;
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  cs: number | null;
  gold: number | null;
  summonerSpells: number[];
  items: number[];
  solo: RankSnapshot | null;
  flex: RankSnapshot | null;
  opggUrl: string | null;
  lastRankFetchAt: string | null;
  rankSource: "self" | "live" | "cache" | "none";
  rankStale: boolean;
};

export type MatchDetailsResponse = {
  ok: boolean;
  error?: string;
  match?: {
    matchId: string;
    region: string | null;
    queueId: number | null;
    gameCreation: number | null;
    gameDuration: number | null;
  };
  teams?: {
    blue: MatchParticipant[];
    red: MatchParticipant[];
  };
};

type ItemInfo = { name: string; plaintext?: string; gold?: number };
type SpellInfo = { name: string; iconFull: string };
type RuneInfo = { name: string; icon: string };

const CHAMP_ICON_BASE =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons";

function fmtAgo(epochMs: number | null) {
  if (!epochMs || !Number.isFinite(epochMs)) return null;
  const delta = Date.now() - epochMs;
  if (delta < 0) return null;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtAgoFromIso(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return fmtAgo(parsed);
}

function formatRank(snapshot: RankSnapshot | null | undefined) {
  if (!snapshot?.tier) return "UNRANKED";
  const tier = String(snapshot.tier).toUpperCase();
  const division = snapshot.division ? ` ${String(snapshot.division).toUpperCase()}` : "";
  const lp = snapshot.lp != null ? ` ${Number(snapshot.lp).toLocaleString()} LP` : "";
  return `${tier}${division}${lp}`.trim();
}

function prettyPos(teamPosition?: string | null) {
  const position = String(teamPosition ?? "").toUpperCase().trim();
  if (!position || position === "NONE" || position === "INVALID") return null;
  if (position === "UTILITY") return "SUP";
  if (position === "MIDDLE") return "MID";
  if (position === "BOTTOM") return "BOT";
  return position;
}

function participantName(participant: MatchParticipant) {
  if (participant.riotId) return participant.riotId;
  if (participant.gameName && participant.tagLine) return `${participant.gameName}#${participant.tagLine}`;
  if (participant.summonerName) return participant.summonerName;
  return "Unknown player";
}

function participantRankStatus(participant: MatchParticipant) {
  const age = fmtAgoFromIso(participant.lastRankFetchAt);
  if (participant.rankSource === "self") return age ? `Tracked snapshot ${age}` : "Tracked snapshot";
  if (participant.rankSource === "live") return age ? `Current rank checked ${age}` : "Current rank checked";
  if (participant.rankSource === "cache") {
    return age
      ? `Cached rank ${age}${participant.rankStale ? " (may be stale)" : ""}`
      : participant.rankStale
        ? "Cached rank (may be stale)"
        : "Cached rank";
  }
  return "Current rank unavailable";
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
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

function ItemIcon({ id, url, info }: { id: number; url: string; info: ItemInfo | null }) {
  const title = info?.name ? info.name : `Item ${id}`;
  return (
    <img
      src={url}
      alt={title}
      title={title}
      className="h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900/30"
      loading="lazy"
    />
  );
}

function RuneIcon({ rune, title }: { rune: RuneInfo | null; title: string }) {
  if (!rune?.icon) {
    return <div className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30" />;
  }
  return (
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`}
      alt={rune.name || title}
      title={rune.name || title}
      className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-900/30"
      loading="lazy"
    />
  );
}

function RankSnapshotChip({
  label,
  snapshot,
}: {
  label: string;
  snapshot: RankSnapshot | null | undefined;
}) {
  const ranked = !!snapshot?.tier;
  return (
    <div
      className={
        "flex items-center gap-2 rounded-2xl px-3 py-2 ring-1 ring-inset " +
        (ranked
          ? "bg-emerald-500/10 ring-emerald-400/20"
          : "bg-zinc-950/50 ring-white/5")
      }
    >
      <RankEmblem
        tier={snapshot?.tier ?? null}
        className="h-8 w-8 shrink-0"
        alt={snapshot?.tier ? `${snapshot.tier} emblem` : "Unranked emblem"}
      />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
        <div className={"truncate text-sm font-medium " + (ranked ? "text-zinc-100" : "text-zinc-400")}>
          {formatRank(snapshot)}
        </div>
      </div>
    </div>
  );
}

function ParticipantMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-zinc-950/45 px-3 py-2 ring-1 ring-white/5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <span className="text-sm font-medium tabular-nums text-zinc-100">{value}</span>
    </div>
  );
}

function TeamPanel({
  title,
  participants,
  ddragonVersion,
  itemMap,
  spellMap,
  champMap,
  runeMap,
  styleMap,
}: {
  title: string;
  participants: MatchParticipant[];
  ddragonVersion: string;
  itemMap: Record<string, ItemInfo>;
  spellMap: Record<string, SpellInfo>;
  champMap: Record<string, string>;
  runeMap: Record<string, RuneInfo>;
  styleMap: Record<string, RuneInfo>;
}) {
  const teamWon = participants.some((participant) => participant.win === true);
  return (
    <div className="rounded-[28px] bg-zinc-950/25 p-3 ring-1 ring-white/5 sm:p-4">
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/8 pb-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <Pill
            className={
              teamWon
                ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
                : "border-red-500/30 bg-red-500/10 text-red-100"
            }
          >
            {teamWon ? "VICTORY" : "DEFEAT"}
          </Pill>
        </div>
      </div>
      <div className="space-y-3">
        {participants.map((participant, index) => {
          const championName =
            participant.championId != null ? champMap[String(participant.championId)] : null;
          const championIcon =
            participant.championId != null ? `${CHAMP_ICON_BASE}/${participant.championId}.png` : null;
          const profileIcon =
            participant.profileIconId != null
              ? `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${participant.profileIconId}.png`
              : null;
          const spellA = participant.summonerSpells[0] ?? null;
          const spellB = participant.summonerSpells[1] ?? null;
          const spellAInfo = spellA != null ? spellMap[String(spellA)] ?? null : null;
          const spellBInfo = spellB != null ? spellMap[String(spellB)] ?? null : null;
          const primaryRune =
            participant.primaryRune != null ? runeMap[String(participant.primaryRune)] ?? null : null;
          const subStyle =
            participant.subStyle != null ? styleMap[String(participant.subStyle)] ?? null : null;
          const position = prettyPos(participant.teamPosition);
          const kills = participant.kills ?? 0;
          const deaths = participant.deaths ?? 0;
          const assists = participant.assists ?? 0;
          const kda = deaths === 0 ? `${kills + assists}.00` : ((kills + assists) / deaths).toFixed(2);

          return (
            <div
              key={`${participant.puuid ?? participant.riotId ?? participant.summonerName ?? title}-${index}`}
              className={
                "rounded-[24px] p-3 ring-1 sm:p-4 " +
                (participant.isMe
                  ? "bg-blue-500/5 ring-blue-500/20"
                  : "bg-zinc-900/25 ring-white/5")
              }
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                <div className="min-w-0">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {championIcon ? (
                            <img
                              src={championIcon}
                              alt={championName ?? "Champion"}
                              className="h-14 w-14 rounded-[20px] border border-zinc-800 bg-zinc-900/30"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-14 w-14 rounded-[20px] border border-zinc-800 bg-zinc-900/30" />
                          )}
                          {profileIcon ? (
                            <img
                              src={profileIcon}
                              alt="Profile icon"
                              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full border border-zinc-900 bg-zinc-950"
                              loading="lazy"
                            />
                          ) : null}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-semibold text-zinc-100">
                              {participantName(participant)}
                            </div>
                            {participant.isMe ? (
                              <Pill className="border-blue-500/30 bg-blue-500/10 text-blue-100">YOU</Pill>
                            ) : null}
                            {position ? (
                              <Pill className="border-zinc-800 bg-zinc-950/40 text-zinc-300">{position}</Pill>
                            ) : null}
                            {participant.summonerLevel != null ? (
                              <Pill className="border-zinc-800 bg-zinc-950/40 text-zinc-400">
                                Lv {participant.summonerLevel}
                              </Pill>
                            ) : null}
                          </div>

                          <div className="mt-1 text-sm text-zinc-400">
                            {championName ?? "Unknown champion"}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-4">
                        {spellAInfo ? (
                          <img
                            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
                            alt={spellAInfo.name}
                            title={spellAInfo.name}
                            className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30" />
                        )}
                        {spellBInfo ? (
                          <img
                            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
                            alt={spellBInfo.name}
                            title={spellBInfo.name}
                            className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900/30" />
                        )}
                        <div className="h-8 w-px bg-white/8" />
                        <RuneIcon rune={primaryRune} title="Primary rune" />
                        <RuneIcon rune={subStyle} title="Secondary style" />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <ParticipantMetric label="Score" value={`${kills}/${deaths}/${assists}`} />
                        <ParticipantMetric label="KDA" value={kda} />
                        <ParticipantMetric label="CS" value={participant.cs ?? "--"} />
                        <ParticipantMetric
                          label="Gold"
                          value={participant.gold != null ? participant.gold.toLocaleString() : "--"}
                        />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {participant.items.length ? (
                          participant.items.slice(0, 7).map((id, itemIndex) => {
                            const url = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`;
                            return (
                              <ItemIcon
                                key={`${participant.puuid ?? participant.riotId ?? participant.summonerName ?? title}-${id}-${itemIndex}`}
                                id={id}
                                url={url}
                                info={itemMap[String(id)] ?? null}
                              />
                            );
                          })
                        ) : (
                          <div className="text-xs text-zinc-500">No items captured.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <RankSnapshotChip label="Solo" snapshot={participant.solo} />
                  <RankSnapshotChip label="Flex" snapshot={participant.flex} />

                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/45 px-3 py-3 text-xs text-zinc-500">
                    {/* freshness copy stays lightweight instead of another full card */}
                    {participantRankStatus(participant)}
                  </div>

                  {!participant.isMe && participant.opggUrl ? (
                    <a
                      href={participant.opggUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center rounded-2xl bg-zinc-950/40 px-3 py-2 text-sm text-zinc-300 ring-1 ring-white/5 transition hover:bg-white/5 hover:text-white"
                    >
                      Open on OP.GG
                    </a>
                  ) : (
                    <div className="rounded-2xl bg-zinc-950/30 px-3 py-2 text-center text-xs text-zinc-600 ring-1 ring-white/5">
                      Tracked player
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MatchDetailsPanel({
  matchId,
  details,
  loading,
  error,
  ddragonVersion,
  itemMap,
  spellMap,
  champMap,
  runeMap,
  styleMap,
}: {
  matchId: string;
  details?: MatchDetailsResponse;
  loading: boolean;
  error?: string | null;
  ddragonVersion: string;
  itemMap: Record<string, ItemInfo>;
  spellMap: Record<string, SpellInfo>;
  champMap: Record<string, string>;
  runeMap: Record<string, RuneInfo>;
  styleMap: Record<string, RuneInfo>;
}) {
  return (
    <div className="mt-4 rounded-[28px] bg-zinc-950/45 p-3 ring-1 ring-white/5 sm:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Match details</div>
          <div className="text-xs text-zinc-500">
            {details?.match?.matchId ?? matchId}
            {details?.match?.region ? (
              <span className="text-zinc-700"> / {String(details.match.region).toUpperCase()}</span>
            ) : null}
          </div>
        </div>
        <div className="text-xs text-zinc-500">
          Current ranks refresh on demand and may be cached for up to 24h.
        </div>
      </div>
      {loading ? <div className="text-sm text-zinc-400">Loading team details...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}
      {!loading && !error && details?.teams ? (
        <div className="grid gap-4 2xl:grid-cols-2">
          <TeamPanel
            title="Blue side"
            participants={details.teams.blue}
            ddragonVersion={ddragonVersion}
            itemMap={itemMap}
            spellMap={spellMap}
            champMap={champMap}
            runeMap={runeMap}
            styleMap={styleMap}
          />
          <TeamPanel
            title="Red side"
            participants={details.teams.red}
            ddragonVersion={ddragonVersion}
            itemMap={itemMap}
            spellMap={spellMap}
            champMap={champMap}
            runeMap={runeMap}
            styleMap={styleMap}
          />
        </div>
      ) : null}
      {!loading && !error && !details?.teams ? (
        <div className="text-sm text-zinc-500">No extra details stored for this match yet.</div>
      ) : null}
    </div>
  );
}
