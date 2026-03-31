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

function csPerMinute(cs: number | null, durationSeconds: number | null | undefined) {
  if (cs == null || !durationSeconds || durationSeconds <= 0) return null;
  return (cs / (durationSeconds / 60)).toFixed(1);
}

function damageWidth(value: number | null | undefined, maxValue: number) {
  if (!value || !maxValue) return "0%";
  return `${Math.max(6, Math.round((value / maxValue) * 100))}%`;
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={title}
      title={title}
      className="h-8 w-8 rounded-lg bg-zinc-900/30 ring-1 ring-white/6"
      loading="lazy"
    />
  );
}

function RuneIcon({ rune, title }: { rune: RuneInfo | null; title: string }) {
  if (!rune?.icon) {
    return <div className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`}
      alt={rune.name || title}
      title={rune.name || title}
      className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6"
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
    <div className="flex items-center gap-2 rounded-xl bg-zinc-950/45 px-2.5 py-2 ring-1 ring-white/5">
      <RankEmblem
        tier={snapshot?.tier ?? null}
        className="h-7 w-7 shrink-0"
        alt={snapshot?.tier ? `${snapshot.tier} emblem` : "Unranked emblem"}
      />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
        <div className="truncate text-sm font-medium text-zinc-100">{formatRank(snapshot)}</div>
      </div>
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
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="relative shrink-0">
        {championIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={championIcon}
            alt={championName ?? "Champion"}
            className="h-12 w-12 rounded-[16px] bg-zinc-900/30 ring-1 ring-white/6"
            loading="lazy"
          />
        ) : (
          <div className="h-12 w-12 rounded-[16px] bg-zinc-900/30 ring-1 ring-white/6" />
        )}
        {profileIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profileIcon}
            alt="Profile icon"
            className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-zinc-950 ring-1 ring-black/30"
            loading="lazy"
          />
        ) : null}
      </div>

      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center gap-1.5">
          {spellAInfo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
              alt={spellAInfo.name}
              title={spellAInfo.name}
              className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6"
              loading="lazy"
            />
          ) : (
            <div className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6" />
          )}
          {spellBInfo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
              alt={spellBInfo.name}
              title={spellBInfo.name}
              className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6"
              loading="lazy"
            />
          ) : (
            <div className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6" />
          )}
          <RuneIcon rune={primaryRune} title="Primary rune" />
          <RuneIcon rune={subStyle} title="Secondary style" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold text-zinc-100">{participantName(participant)}</div>
            {participant.isMe ? (
              <Pill className="border-blue-500/30 bg-blue-500/10 text-blue-100">YOU</Pill>
            ) : null}
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
          <div className="mt-1 text-xs text-zinc-500">{championName ?? "Unknown champion"}</div>
        </div>
      </div>
    </div>
  );
}

function ParticipantStat({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: ReactNode;
  subvalue?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-zinc-950/40 px-3 py-2 ring-1 ring-white/5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-medium tabular-nums text-zinc-100">{value}</div>
      {subvalue ? <div className="mt-0.5 text-[11px] text-zinc-500">{subvalue}</div> : null}
    </div>
  );
}

function MobileParticipantCard({
  participant,
  ddragonVersion,
  itemMap,
  spellMap,
  champMap,
  runeMap,
  styleMap,
  matchDuration,
  tone,
}: {
  participant: MatchParticipant;
  ddragonVersion: string;
  itemMap: Record<string, ItemInfo>;
  spellMap: Record<string, SpellInfo>;
  champMap: Record<string, string>;
  runeMap: Record<string, RuneInfo>;
  styleMap: Record<string, RuneInfo>;
  matchDuration: number | null | undefined;
  tone: "blue" | "red";
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
  const rowTone =
    participant.isMe && tone === "blue"
      ? "bg-blue-500/8 ring-blue-400/20"
      : participant.isMe && tone === "red"
        ? "bg-red-500/8 ring-red-400/20"
        : "bg-zinc-950/20 ring-white/6";
  const position = prettyPos(participant.teamPosition);

  return (
    <div className={`rounded-[22px] p-3 ring-1 ${rowTone}`}>
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {championIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={championIcon}
              alt={championName ?? "Champion"}
              className="h-12 w-12 rounded-[16px] bg-zinc-900/30 ring-1 ring-white/6"
              loading="lazy"
            />
          ) : (
            <div className="h-12 w-12 rounded-[16px] bg-zinc-900/30 ring-1 ring-white/6" />
          )}
          {profileIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profileIcon}
              alt="Profile icon"
              className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-zinc-950 ring-1 ring-black/30"
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

          <div className="mt-1 text-xs text-zinc-500">{championName ?? "Unknown champion"}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {spellAInfo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellAInfo.iconFull}`}
            alt={spellAInfo.name}
            title={spellAInfo.name}
            className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6"
            loading="lazy"
          />
        ) : (
          <div className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6" />
        )}
        {spellBInfo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${spellBInfo.iconFull}`}
            alt={spellBInfo.name}
            title={spellBInfo.name}
            className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6"
            loading="lazy"
          />
        ) : (
          <div className="h-7 w-7 rounded-lg bg-zinc-900/30 ring-1 ring-white/6" />
        )}
        <RuneIcon rune={primaryRune} title="Primary rune" />
        <RuneIcon rune={subStyle} title="Secondary style" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ParticipantStat label="KDA" value={`${kills}/${deaths}/${assists}`} subvalue={`${kda} KDA`} />
        <ParticipantStat
          label="Damage"
          value={participant.damage != null ? participant.damage.toLocaleString() : "--"}
          subvalue={`Gold ${participant.gold != null ? participant.gold.toLocaleString() : "--"}`}
        />
        <ParticipantStat
          label="Vision"
          value={participant.visionScore != null ? participant.visionScore.toLocaleString() : "--"}
          subvalue={`${participant.wardsPlaced ?? "--"} placed / ${participant.wardsKilled ?? "--"} killed`}
        />
        <ParticipantStat
          label="CS"
          value={participant.cs != null ? participant.cs.toLocaleString() : "--"}
          subvalue={csPm ? `${csPm}/m` : "--"}
        />
      </div>

      <div className="mt-3 grid gap-2">
        <RankLine label="Solo" snapshot={participant.solo} />
        <RankLine label="Flex" snapshot={participant.flex} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
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
          <div className="text-xs text-zinc-500">No items</div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-zinc-500">{participantRankStatus(participant)}</div>
        {!participant.isMe && participant.opggUrl ? (
          <a
            href={participant.opggUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-2xl bg-zinc-950/40 px-3 py-2 text-sm text-zinc-300 ring-1 ring-white/5 transition hover:bg-white/5 hover:text-white"
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
  );
}

function TeamTable({
  title,
  participants,
  ddragonVersion,
  itemMap,
  spellMap,
  champMap,
  runeMap,
  styleMap,
  matchDuration,
  tone,
}: {
  title: string;
  participants: MatchParticipant[];
  ddragonVersion: string;
  itemMap: Record<string, ItemInfo>;
  spellMap: Record<string, SpellInfo>;
  champMap: Record<string, string>;
  runeMap: Record<string, RuneInfo>;
  styleMap: Record<string, RuneInfo>;
  matchDuration: number | null | undefined;
  tone: "blue" | "red";
}) {
  const teamWon = participants.some((participant) => participant.win === true);
  const maxDamage = Math.max(1, ...participants.map((participant) => participant.damage ?? 0));

  return (
    <section className="rounded-[28px] bg-zinc-950/25 p-3 ring-1 ring-white/5 sm:p-4">
      <div className="flex items-center gap-2 border-b border-white/8 pb-3">
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

      <div className="mt-3 space-y-3 lg:hidden">
        {participants.map((participant, index) => (
          <MobileParticipantCard
            key={`${participant.puuid ?? participant.riotId ?? participant.summonerName ?? title}-mobile-${index}`}
            participant={participant}
            ddragonVersion={ddragonVersion}
            itemMap={itemMap}
            spellMap={spellMap}
            champMap={champMap}
            runeMap={runeMap}
            styleMap={styleMap}
            matchDuration={matchDuration}
            tone={tone}
          />
        ))}
      </div>

      <div className="mt-3 hidden overflow-x-auto lg:block">
        <table className="min-w-[980px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <th className="pb-3 pr-4 font-medium">Player</th>
              <th className="pb-3 px-3 font-medium">KDA</th>
              <th className="pb-3 px-3 font-medium">Damage</th>
              <th className="pb-3 px-3 font-medium">Vision</th>
              <th className="pb-3 px-3 font-medium">CS</th>
              <th className="pb-3 px-3 font-medium">Current rank</th>
              <th className="pb-3 px-3 font-medium">Items</th>
              <th className="pb-3 pl-3 font-medium">Link</th>
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
              const rowTone =
                participant.isMe && tone === "blue"
                  ? "bg-blue-500/6"
                  : participant.isMe && tone === "red"
                    ? "bg-red-500/6"
                    : "bg-transparent";
              const damage = participant.damage ?? null;
              const vision = participant.visionScore ?? null;
              const csPm = csPerMinute(participant.cs, matchDuration);

              return (
                <tr
                  key={`${participant.puuid ?? participant.riotId ?? participant.summonerName ?? title}-${index}`}
                  className={`align-top ${rowTone}`}
                >
                  <td className="border-t border-white/6 py-3 pr-4">
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

                  <td className="border-t border-white/6 px-3 py-3">
                    <div className="font-semibold tabular-nums text-zinc-100">
                      {kills}/{deaths}/{assists}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-zinc-400">{kda} KDA</div>
                  </td>

                  <td className="border-t border-white/6 px-3 py-3">
                    <div className="font-medium tabular-nums text-zinc-100">
                      {damage != null ? damage.toLocaleString() : "--"}
                    </div>
                    <div className="mt-2 h-2.5 w-[130px] rounded-full bg-white/6">
                      <div
                        className={
                          "h-full rounded-full " +
                          (tone === "blue" ? "bg-blue-400/80" : "bg-red-400/80")
                        }
                        style={{ width: damageWidth(damage, maxDamage) }}
                      />
                    </div>
                  </td>

                  <td className="border-t border-white/6 px-3 py-3">
                    <div className="font-medium tabular-nums text-zinc-100">
                      {vision != null ? vision.toLocaleString() : "--"}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-zinc-500">
                      {participant.wardsPlaced ?? "--"} placed / {participant.wardsKilled ?? "--"} killed
                    </div>
                  </td>

                  <td className="border-t border-white/6 px-3 py-3">
                    <div className="font-medium tabular-nums text-zinc-100">
                      {participant.cs != null ? participant.cs.toLocaleString() : "--"}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-zinc-500">
                      {csPm ? `${csPm}/m` : "--"}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-zinc-500">
                      Gold {participant.gold != null ? participant.gold.toLocaleString() : "--"}
                    </div>
                  </td>

                  <td className="border-t border-white/6 px-3 py-3">
                    <div className="grid gap-2">
                      <RankLine label="Solo" snapshot={participant.solo} />
                      <RankLine label="Flex" snapshot={participant.flex} />
                    </div>
                  </td>

                  <td className="border-t border-white/6 px-3 py-3">
                    <div className="flex min-w-[170px] flex-wrap gap-1.5">
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
                        <div className="text-xs text-zinc-500">No items</div>
                      )}
                    </div>
                  </td>

                  <td className="border-t border-white/6 pl-3 py-3">
                    <div className="w-[150px] space-y-2">
                      <div className="text-xs text-zinc-500">{participantRankStatus(participant)}</div>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
        <div className="grid gap-4 xl:grid-cols-2">
          <TeamTable
            title="Blue side"
            participants={details.teams.blue}
            ddragonVersion={ddragonVersion}
            itemMap={itemMap}
            spellMap={spellMap}
            champMap={champMap}
            runeMap={runeMap}
            styleMap={styleMap}
            matchDuration={details.match?.gameDuration ?? null}
            tone="blue"
          />
          <TeamTable
            title="Red side"
            participants={details.teams.red}
            ddragonVersion={ddragonVersion}
            itemMap={itemMap}
            spellMap={spellMap}
            champMap={champMap}
            runeMap={runeMap}
            styleMap={styleMap}
            matchDuration={details.match?.gameDuration ?? null}
            tone="red"
          />
        </div>
      ) : null}

      {!loading && !error && !details?.teams ? (
        <div className="text-sm text-zinc-500">No extra details stored for this match yet.</div>
      ) : null}
    </div>
  );
}
