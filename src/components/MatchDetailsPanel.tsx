"use client";

import type { ReactNode } from "react";
import RankEmblem from "@/components/RankEmblem";
import { formatNumber } from "@/lib/displayTime";
import { bestHighEloRead, highEloBadgeClass, highEloCardClass } from "@/lib/highElo";
import { analyzeMatchPerformance, matchPerformanceToneClass, type MatchPerformanceBadge } from "@/lib/matchAnalysis";

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
  champLevel?: number | null;
  teamId: number | null;
  teamPosition: string | null;
  primaryStyle?: number | null;
  primaryRune?: number | null;
  subStyle?: number | null;
  win: boolean | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  largestMultiKill?: number | null;
  doubleKills?: number | null;
  tripleKills?: number | null;
  quadraKills?: number | null;
  pentaKills?: number | null;
  cs: number | null;
  gold: number | null;
  damage?: number | null;
  visionScore?: number | null;
  wardsPlaced?: number | null;
  wardsKilled?: number | null;
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
  const lp = snapshot.lp != null ? ` ${formatNumber(snapshot.lp)} LP` : "";
  return `${tier}${division}${lp}`.trim();
}

function divisionNumber(division?: string | null) {
  const value = String(division ?? "").toUpperCase();
  if (value === "I") return "1";
  if (value === "II") return "2";
  if (value === "III") return "3";
  if (value === "IV") return "4";
  return "";
}

function shortRank(snapshot: RankSnapshot | null | undefined) {
  if (!snapshot?.tier) return "UR";

  const tier = String(snapshot.tier).toUpperCase();
  const tierShort =
    tier === "GRANDMASTER"
      ? "GM"
      : tier === "CHALLENGER"
        ? "C"
        : tier === "MASTER"
          ? "M"
          : tier === "PLATINUM"
            ? "P"
            : tier === "EMERALD"
              ? "E"
              : tier === "DIAMOND"
                ? "D"
                : tier === "GOLD"
                  ? "G"
                  : tier === "SILVER"
                    ? "S"
                    : tier === "BRONZE"
                      ? "B"
                      : tier === "IRON"
                        ? "I"
                        : tier.slice(0, 1);

  const division = divisionNumber(snapshot.division);
  const lp = snapshot.lp != null ? `-${Number(snapshot.lp)}lp` : "";
  return `${tierShort}${division}${lp}`;
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
  if (participant.rankSource === "self") return age ? `Tracked ${age}` : "Tracked";
  if (participant.rankSource === "live") return age ? `Checked ${age}` : "Checked";
  if (participant.rankSource === "cache") {
    return age ? `Cached ${age}${participant.rankStale ? " stale" : ""}` : "Cached";
  }
  return "Unavailable";
}

function csPerMinute(cs: number | null, durationSeconds: number | null | undefined) {
  if (cs == null || !durationSeconds || durationSeconds <= 0) return null;
  return (cs / (durationSeconds / 60)).toFixed(1);
}

function damageWidth(value: number | null | undefined, maxValue: number) {
  if (!value || !maxValue) return "0%";
  return `${Math.max(6, Math.round((value / maxValue) * 100))}%`;
}

function Pill({ children, className = "", title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] leading-none tabular-nums " +
        className
      }
    >
      {children}
    </span>
  );
}

function PerformanceBadges({ badges }: { badges: MatchPerformanceBadge[] }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-0.5">
      {badges.map((badge) => (
        <Pill
          key={`${badge.kind}-${badge.label}`}
          className={`${matchPerformanceToneClass(badge.tone)} ${
            badge.kind === "score" || badge.kind === "verdict" ? "font-semibold" : ""
          }`}
          title={badge.title}
        >
          {badge.label}
        </Pill>
      ))}
    </div>
  );
}

function normalizedRole(participant: MatchParticipant) {
  const role = String(participant.teamPosition ?? "").toUpperCase();
  if (role === "MIDDLE") return "MID";
  if (role === "BOTTOM") return "BOT";
  if (role === "UTILITY") return "SUP";
  return role;
}

function laneOpponentFor(participant: MatchParticipant, opponents: MatchParticipant[]) {
  const role = normalizedRole(participant);
  if (!role || role === "NONE" || role === "INVALID") return null;
  return opponents.find((opponent) => normalizedRole(opponent) === role) ?? null;
}

function analysisInput(participant: MatchParticipant, opponent: MatchParticipant | null, matchDuration: number | null | undefined, queueId: number | null | undefined) {
  return {
    ...participant,
    gameDuration: matchDuration ?? null,
    queueId,
    laneOpponent: opponent
      ? {
          kills: opponent.kills,
          deaths: opponent.deaths,
          assists: opponent.assists,
          cs: opponent.cs,
          gold: opponent.gold,
          damage: opponent.damage,
        }
      : null,
  };
}

function ItemIcon({ id, url, info }: { id: number; url: string; info: ItemInfo | null }) {
  const title = info?.name ? info.name : `Item ${id}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={title}
      title={title}
      className="h-4 w-4 rounded bg-zinc-900/30 ring-1 ring-white/6"
      loading="lazy"
    />
  );
}

function RuneIcon({ rune, title }: { rune: RuneInfo | null; title: string }) {
  if (!rune?.icon) {
    return <div className="h-4 w-4 rounded-sm bg-zinc-900/30 ring-1 ring-white/6" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`}
      alt={rune.name || title}
      title={rune.name || title}
        className="h-3.5 w-3.5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6"
      loading="lazy"
    />
  );
}

function RankLine({
  label,
  snapshot,
}: {
  label: string;
  snapshot: RankSnapshot | null | undefined;
}) {
  return (
    <div className="flex items-center gap-1 px-0 py-0">
      <RankEmblem
        tier={snapshot?.tier ?? null}
        className="h-3.5 w-3.5 shrink-0"
        alt={snapshot?.tier ? `${snapshot.tier} emblem` : "Unranked emblem"}
      />
      <div className="min-w-0">
        <div className="text-[7px] uppercase tracking-[0.12em] text-zinc-500">{label}</div>
        <div className="truncate text-[9px] font-medium text-zinc-100">{formatRank(snapshot)}</div>
      </div>
    </div>
  );
}

function HighEloPill({ participant }: { participant: MatchParticipant }) {
  const read = bestHighEloRead(participant.solo, participant.flex);
  if (!read) return null;
  return (
    <Pill className={`${highEloBadgeClass(read)} font-semibold`} title={read.title}>
      {read.shortLabel}
    </Pill>
  );
}

function CompactSoloRank({ snapshot }: { snapshot: RankSnapshot | null | undefined }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-zinc-900/55 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100">
      <RankEmblem
        tier={snapshot?.tier ?? null}
        className="h-3.5 w-3.5 shrink-0"
        alt={snapshot?.tier ? `${snapshot.tier} emblem` : "Unranked emblem"}
      />
      <span>{shortRank(snapshot)}</span>
    </div>
  );
}

function PlayerSummaryCell({
  participant,
  championName,
  championIcon,
  profileIcon,
  spellAInfo,
  spellBInfo,
  primaryRune,
  subStyle,
  ddragonVersion,
}: {
  participant: MatchParticipant;
  championName: string | null;
  championIcon: string | null;
  profileIcon: string | null;
  spellAInfo: SpellInfo | null;
  spellBInfo: SpellInfo | null;
  primaryRune: RuneInfo | null;
  subStyle: RuneInfo | null;
  ddragonVersion: string;
}) {
  const position = prettyPos(participant.teamPosition);
  const highElo = bestHighEloRead(participant.solo, participant.flex);

  return (
    <div
      className={`flex min-w-[170px] items-start gap-1.5 rounded-lg ${
        highElo ? "bg-white/[0.025] px-1 py-0.5 ring-1 ring-white/8" : ""
      }`}
    >
      <div className="relative shrink-0">
        {championIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={championIcon}
            alt={championName ?? "Champion"}
            className="h-8 w-8 rounded-lg bg-zinc-900/30 ring-1 ring-white/6"
            loading="lazy"
          />
        ) : (
          <div className="h-8 w-8 rounded-lg bg-zinc-900/30 ring-1 ring-white/6" />
        )}
        {profileIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profileIcon}
            alt="Profile icon"
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-zinc-950 ring-1 ring-black/30"
            loading="lazy"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <div className="max-w-[106px] truncate text-[10px] font-semibold text-zinc-100">
            {participantName(participant)}
          </div>
          {participant.isMe ? (
            <Pill className="border-blue-500/30 bg-blue-500/10 text-blue-100">YOU</Pill>
          ) : null}
          <HighEloPill participant={participant} />
          {position ? (
            <Pill className="border-transparent bg-zinc-900/60 text-zinc-300">{position}</Pill>
          ) : null}
          {participant.champLevel != null ? (
            <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">
              Lv {participant.champLevel}
            </Pill>
          ) : participant.summonerLevel != null ? (
            <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">
              Lv {participant.summonerLevel}
            </Pill>
          ) : null}
        </div>

        <div className="mt-0.5 text-[9px] text-zinc-500">{championName ?? "Unknown champion"}</div>

        <div className="mt-1 flex flex-wrap items-center gap-0.5">
          {spellAInfo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
              alt={spellAInfo.name}
              title={spellAInfo.name}
              className="h-3.5 w-3.5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6"
              loading="lazy"
            />
          ) : (
            <div className="h-3.5 w-3.5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6" />
          )}
          {spellBInfo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
              alt={spellBInfo.name}
              title={spellBInfo.name}
              className="h-3.5 w-3.5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6"
              loading="lazy"
            />
          ) : (
            <div className="h-3.5 w-3.5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6" />
          )}
          <RuneIcon rune={primaryRune} title="Primary rune" />
          <RuneIcon rune={subStyle} title="Secondary style" />
        </div>
      </div>
    </div>
  );
}

function MobileStat({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: ReactNode;
  subvalue?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[8px] uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[11px] font-medium tabular-nums text-zinc-100">{value}</div>
      {subvalue ? <div className="mt-0.5 text-[9px] text-zinc-500">{subvalue}</div> : null}
    </div>
  );
}

function MobileParticipantRow({
  participant,
  ddragonVersion,
  itemMap,
  spellMap,
  champMap,
  runeMap,
  styleMap,
  matchDuration,
  queueId,
  tone,
  opponents,
}: {
  participant: MatchParticipant;
  ddragonVersion: string;
  itemMap: Record<string, ItemInfo>;
  spellMap: Record<string, SpellInfo>;
  champMap: Record<string, string>;
  runeMap: Record<string, RuneInfo>;
  styleMap: Record<string, RuneInfo>;
  matchDuration: number | null | undefined;
  queueId: number | null | undefined;
  tone: "blue" | "red";
  opponents: MatchParticipant[];
}) {
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
  const kills = participant.kills ?? 0;
  const deaths = participant.deaths ?? 0;
  const assists = participant.assists ?? 0;
  const kda = deaths === 0 ? `${kills + assists}.00` : ((kills + assists) / deaths).toFixed(2);
  const csPm = csPerMinute(participant.cs, matchDuration);
  const position = prettyPos(participant.teamPosition);
  const badges = analyzeMatchPerformance(analysisInput(participant, laneOpponentFor(participant, opponents), matchDuration, queueId));
  const highElo = bestHighEloRead(participant.solo, participant.flex);
  const rowTone =
    participant.isMe && tone === "blue"
      ? "rounded-xl bg-blue-500/8"
      : participant.isMe && tone === "red"
        ? "rounded-xl bg-red-500/8"
        : "";

  return (
    <div className={`px-2.5 py-2.5 ${rowTone} ${highElo ? highEloCardClass(highElo) : ""}`}>
      {highElo ? (
        <div className="mb-1 flex justify-end">
          <Pill className={`${highEloBadgeClass(highElo)} font-semibold`} title={highElo.title}>
            {highElo.label}
          </Pill>
        </div>
      ) : null}
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          {championIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={championIcon}
              alt={championName ?? "Champion"}
              className="h-10 w-10 rounded-xl bg-zinc-900/30 ring-1 ring-white/6"
              loading="lazy"
            />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-zinc-900/30 ring-1 ring-white/6" />
          )}
          {profileIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profileIcon}
              alt="Profile icon"
              className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-zinc-950 ring-1 ring-black/30"
              loading="lazy"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="truncate text-[12px] font-semibold text-zinc-100">
              {participantName(participant)}
            </div>
            <CompactSoloRank snapshot={participant.solo} />
            {participant.isMe ? (
              <Pill className="border-blue-500/30 bg-blue-500/10 text-blue-100">YOU</Pill>
            ) : null}
            <HighEloPill participant={participant} />
            {position ? (
              <Pill className="border-transparent bg-zinc-900/60 text-zinc-300">{position}</Pill>
            ) : null}
            {participant.champLevel != null ? (
              <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">
                Lv {participant.champLevel}
              </Pill>
            ) : participant.summonerLevel != null ? (
              <Pill className="border-transparent bg-zinc-900/60 text-zinc-400">
                Lv {participant.summonerLevel}
              </Pill>
            ) : null}
          </div>

          <div className="mt-0.5 text-[10px] text-zinc-500">{championName ?? "Unknown champion"}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {spellAInfo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
            alt={spellAInfo.name}
            title={spellAInfo.name}
            className="h-5 w-5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6"
            loading="lazy"
          />
        ) : (
          <div className="h-5 w-5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6" />
        )}
        {spellBInfo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
            alt={spellBInfo.name}
            title={spellBInfo.name}
            className="h-5 w-5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6"
            loading="lazy"
          />
        ) : (
          <div className="h-5 w-5 rounded-sm bg-zinc-900/30 ring-1 ring-white/6" />
        )}
        <RuneIcon rune={primaryRune} title="Primary rune" />
        <RuneIcon rune={subStyle} title="Secondary style" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <MobileStat label="KDA" value={`${kills}/${deaths}/${assists}`} subvalue={`${kda} KDA`} />
        <MobileStat
          label="Damage"
          value={formatNumber(participant.damage) ?? "--"}
          subvalue={`${formatNumber(participant.gold) ?? "--"} gold`}
        />
        <MobileStat
          label="Vision"
          value={formatNumber(participant.visionScore) ?? "--"}
          subvalue={`${participant.wardsPlaced ?? "--"} / ${participant.wardsKilled ?? "--"}`}
        />
        <MobileStat
          label="CS"
          value={formatNumber(participant.cs) ?? "--"}
          subvalue={csPm ? `${csPm}/m` : "--"}
        />
      </div>

      <div className="mt-2">
        <PerformanceBadges badges={badges} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {participant.items.length ? (
          participant.items.slice(0, 7).map((id, itemIndex) => {
            const url = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`;
            return (
              <ItemIcon
                key={`${participant.puuid ?? participant.riotId ?? participant.summonerName ?? "mobile"}-${id}-${itemIndex}`}
                id={id}
                url={url}
                info={itemMap[String(id)] ?? null}
              />
            );
          })
        ) : (
          <div className="text-[10px] text-zinc-500">No items</div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0 text-[9px] text-zinc-500">{participantRankStatus(participant)}</div>
        {!participant.isMe && participant.opggUrl ? (
          <a
            href={participant.opggUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-300 transition hover:bg-white/5 hover:text-white"
          >
            OP.GG
          </a>
        ) : (
          <div className="shrink-0 rounded-md bg-zinc-900/30 px-2 py-1 text-[9px] text-zinc-600">
            Tracked
          </div>
        )}
      </div>
    </div>
  );
}

function MobileTeamList({
  title,
  participants,
  opponents,
  ddragonVersion,
  itemMap,
  spellMap,
  champMap,
  runeMap,
  styleMap,
  matchDuration,
  queueId,
  tone,
}: {
  title: string;
  participants: MatchParticipant[];
  opponents: MatchParticipant[];
  ddragonVersion: string;
  itemMap: Record<string, ItemInfo>;
  spellMap: Record<string, SpellInfo>;
  champMap: Record<string, string>;
  runeMap: Record<string, RuneInfo>;
  styleMap: Record<string, RuneInfo>;
  matchDuration: number | null | undefined;
  queueId: number | null | undefined;
  tone: "blue" | "red";
}) {
  const teamWon = participants.some((participant) => participant.win === true);

  return (
    <section
      className={tone === "blue" ? "rounded-[18px] bg-blue-500/[0.038]" : "rounded-[18px] bg-red-500/[0.038]"}
    >
      <div className="flex items-center gap-2 border-b border-white/6 px-3 py-2">
        <div className="text-xs font-semibold text-zinc-100">{title}</div>
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

      <div className="divide-y divide-white/6 px-1.5 py-1">
        {participants.map((participant, index) => (
          <MobileParticipantRow
            key={`${participant.puuid ?? participant.riotId ?? participant.summonerName ?? title}-mobile-${index}`}
            participant={participant}
            ddragonVersion={ddragonVersion}
            itemMap={itemMap}
            spellMap={spellMap}
            champMap={champMap}
            runeMap={runeMap}
            styleMap={styleMap}
            matchDuration={matchDuration}
            queueId={queueId}
            tone={tone}
            opponents={opponents}
          />
        ))}
      </div>
    </section>
  );
}

function TeamTable({
  title,
  participants,
  opponents,
  ddragonVersion,
  itemMap,
  spellMap,
  champMap,
  runeMap,
  styleMap,
  matchDuration,
  queueId,
  tone,
}: {
  title: string;
  participants: MatchParticipant[];
  opponents: MatchParticipant[];
  ddragonVersion: string;
  itemMap: Record<string, ItemInfo>;
  spellMap: Record<string, SpellInfo>;
  champMap: Record<string, string>;
  runeMap: Record<string, RuneInfo>;
  styleMap: Record<string, RuneInfo>;
  matchDuration: number | null | undefined;
  queueId: number | null | undefined;
  tone: "blue" | "red";
}) {
  const teamWon = participants.some((participant) => participant.win === true);
  const maxDamage = Math.max(1, ...participants.map((participant) => participant.damage ?? 0));

  return (
    <section
      className={tone === "blue" ? "rounded-xl bg-blue-500/[0.032]" : "rounded-xl bg-red-500/[0.032]"}
    >
      <div className="flex items-center gap-2 border-b border-white/6 px-2.5 py-1.5">
        <div className="text-[11px] font-semibold text-zinc-100">{title}</div>
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

      <table className="w-full border-collapse text-[9px] text-zinc-300">
        <thead>
          <tr className="text-left uppercase tracking-[0.12em] text-zinc-500">
            <th className="w-[190px] px-2 py-1.5 font-medium">Player</th>
            <th className="w-[104px] px-1 py-1.5 font-medium">KDA / Score</th>
            <th className="w-[72px] px-1 py-1.5 font-medium">Dmg</th>
            <th className="w-[54px] px-1 py-1.5 font-medium">Vision</th>
            <th className="w-[62px] px-1 py-1.5 font-medium">CS</th>
            <th className="w-[120px] px-1 py-1.5 font-medium">Rank</th>
            <th className="w-[98px] px-1 py-1.5 font-medium">Items</th>
            <th className="w-[62px] px-2 py-1.5 font-medium">Link</th>
          </tr>
        </thead>

        <tbody>
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
            const kills = participant.kills ?? 0;
            const deaths = participant.deaths ?? 0;
            const assists = participant.assists ?? 0;
            const kda = deaths === 0 ? `${kills + assists}.00` : ((kills + assists) / deaths).toFixed(2);
            const damage = participant.damage ?? null;
            const vision = participant.visionScore ?? null;
            const csPm = csPerMinute(participant.cs, matchDuration);
            const badges = analyzeMatchPerformance(analysisInput(participant, laneOpponentFor(participant, opponents), matchDuration, queueId));
            const highElo = bestHighEloRead(participant.solo, participant.flex);
            const rowTone =
              participant.isMe && tone === "blue"
                ? "bg-blue-500/7"
                : participant.isMe && tone === "red"
                  ? "bg-red-500/7"
                  : "bg-transparent";

            return (
              <tr
                key={`${participant.puuid ?? participant.riotId ?? participant.summonerName ?? title}-${index}`}
                className={`align-top ${rowTone} ${highElo ? "bg-gradient-to-r from-white/[0.045] via-white/[0.015] to-transparent" : ""}`}
              >
                <td className="border-t border-white/6 px-2 py-1">
                  <PlayerSummaryCell
                    participant={participant}
                    championName={championName}
                    championIcon={championIcon}
                    profileIcon={profileIcon}
                    spellAInfo={spellAInfo}
                    spellBInfo={spellBInfo}
                    primaryRune={primaryRune}
                    subStyle={subStyle}
                    ddragonVersion={ddragonVersion}
                  />
                </td>

                <td className="border-t border-white/6 px-1 py-1">
                  <div className="font-semibold tabular-nums text-zinc-100">
                    {kills}/{deaths}/{assists}
                  </div>
                  <div className="mt-0.5 text-[8px] tabular-nums text-zinc-500">{kda} KDA</div>
                  <div className="mt-0.5">
                    <PerformanceBadges badges={badges} />
                  </div>
                </td>

                <td className="border-t border-white/6 px-1 py-1">
                  <div className="font-medium tabular-nums text-zinc-100">
                    {formatNumber(damage) ?? "--"}
                  </div>
                  <div className="mt-0.5 h-1 w-[48px] rounded-full bg-white/6">
                    <div
                      className={
                        "h-full rounded-full " + (tone === "blue" ? "bg-blue-400/80" : "bg-red-400/80")
                      }
                      style={{ width: damageWidth(damage, maxDamage) }}
                    />
                  </div>
                </td>

                <td className="border-t border-white/6 px-1 py-1">
                  <div className="font-medium tabular-nums text-zinc-100">
                    {formatNumber(vision) ?? "--"}
                  </div>
                  <div className="mt-0.5 text-[8px] tabular-nums text-zinc-500">
                    {participant.wardsPlaced ?? "--"} / {participant.wardsKilled ?? "--"}
                  </div>
                </td>

                <td className="border-t border-white/6 px-1 py-1">
                  <div className="font-medium tabular-nums text-zinc-100">
                    {formatNumber(participant.cs) ?? "--"}
                  </div>
                  <div className="mt-0.5 text-[8px] tabular-nums text-zinc-500">
                    {csPm ? `${csPm}/m` : "--"}
                  </div>
                  <div className="mt-0.5 text-[8px] tabular-nums text-zinc-500">
                    {formatNumber(participant.gold) ?? "--"} gold
                  </div>
                </td>

                <td className="border-t border-white/6 px-1 py-1">
                  <div className="space-y-0.5">
                    <RankLine label="Solo" snapshot={participant.solo} />
                    <RankLine label="Flex" snapshot={participant.flex} />
                  </div>
                </td>

                <td className="border-t border-white/6 px-1 py-1">
                  <div className="flex min-w-[84px] flex-wrap gap-0.5">
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
                      <div className="text-[9px] text-zinc-500">No items</div>
                    )}
                  </div>
                </td>

                <td className="border-t border-white/6 px-2 py-1">
                  <div className="w-[54px] space-y-0.5">
                    <div className="text-[8px] leading-tight text-zinc-500">{participantRankStatus(participant)}</div>
                    {!participant.isMe && participant.opggUrl ? (
                      <a
                        href={participant.opggUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex w-full items-center justify-center rounded-md bg-zinc-950/40 px-1 py-0.5 text-[9px] text-zinc-300 ring-1 ring-white/5 transition hover:bg-white/5 hover:text-white"
                      >
                        OP.GG
                      </a>
                    ) : (
                      <div className="rounded-md bg-zinc-950/30 px-1 py-0.5 text-center text-[8px] text-zinc-600 ring-1 ring-white/5">
                        Tracked
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
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
    <div className="mt-1.5 space-y-1.5">
      <div className="px-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/6 pb-1.5">
          <div>
            <div className="text-xs font-semibold text-zinc-100">Match details</div>
            <div className="text-[11px] text-zinc-500">
              {details?.match?.matchId ?? matchId}
              {details?.match?.region ? (
                <span className="text-zinc-700"> / {String(details.match.region).toUpperCase()}</span>
              ) : null}
            </div>
          </div>
          <div className="max-w-[240px] text-right text-[9px] leading-tight text-zinc-500">
            Current ranks refresh on demand and may be cached for up to 24h.
          </div>
        </div>
      </div>

      {loading ? <div className="px-5 py-2 text-sm text-zinc-400 sm:px-6">Loading team details...</div> : null}
      {!loading && error ? <div className="px-5 py-2 text-sm text-red-300 sm:px-6">{error}</div> : null}

      {!loading && !error && details?.teams ? (
        <>
          <div className="space-y-3 p-2.5 sm:hidden">
            <MobileTeamList
              title="Blue side"
              participants={details.teams.blue}
              opponents={details.teams.red}
              ddragonVersion={ddragonVersion}
              itemMap={itemMap}
              spellMap={spellMap}
              champMap={champMap}
              runeMap={runeMap}
              styleMap={styleMap}
              matchDuration={details.match?.gameDuration ?? null}
              queueId={details.match?.queueId ?? null}
              tone="blue"
            />
            <MobileTeamList
              title="Red side"
              participants={details.teams.red}
              opponents={details.teams.blue}
              ddragonVersion={ddragonVersion}
              itemMap={itemMap}
              spellMap={spellMap}
              champMap={champMap}
              runeMap={runeMap}
              styleMap={styleMap}
              matchDuration={details.match?.gameDuration ?? null}
              queueId={details.match?.queueId ?? null}
              tone="red"
            />
          </div>

          <div className="hidden sm:block">
            <div className="x-scroll-area pb-2">
              <div className="min-w-[720px] space-y-1.5 p-2">
                <TeamTable
                  title="Blue side"
                  participants={details.teams.blue}
                  opponents={details.teams.red}
                  ddragonVersion={ddragonVersion}
                  itemMap={itemMap}
                  spellMap={spellMap}
                  champMap={champMap}
                  runeMap={runeMap}
                  styleMap={styleMap}
                  matchDuration={details.match?.gameDuration ?? null}
                  queueId={details.match?.queueId ?? null}
                  tone="blue"
                />
                <TeamTable
                  title="Red side"
                  participants={details.teams.red}
                  opponents={details.teams.blue}
                  ddragonVersion={ddragonVersion}
                  itemMap={itemMap}
                  spellMap={spellMap}
                  champMap={champMap}
                  runeMap={runeMap}
                  styleMap={styleMap}
                  matchDuration={details.match?.gameDuration ?? null}
                  queueId={details.match?.queueId ?? null}
                  tone="red"
                />
              </div>
            </div>
          </div>
        </>
      ) : null}

      {!loading && !error && !details?.teams ? (
        <div className="px-5 py-2 text-sm text-zinc-500 sm:px-6">No extra details stored for this match yet.</div>
      ) : null}
    </div>
  );
}
