// src/lib/riot.ts
// Upgraded: better types (summonerLevel/name/revisionDate), proper 429 handling (Retry-After),
// match-v5 helpers (ids + match), and a sane region/platform mapping.

export type RiotAccount = { puuid: string; gameName?: string; tagLine?: string };

export type Summoner = {
  id: string;
  puuid: string;
  name: string;
  profileIconId: number;
  summonerLevel: number;
  revisionDate: number; // unix ms
};

export type LeagueEntry = {
  leagueId: string;
  puuid: string;
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

export type ChampionMastery = {
  championId: number;
  championLevel: number;
  championPoints: number;
  lastPlayTime?: number;

  chestGranted?: boolean;
  tokensEarned?: number;

  championPointsSinceLastLevel?: number;
  championPointsUntilNextLevel?: number;
  markRequiredForNextLevel?: number;
  championSeasonMilestone?: number;
};

export type MatchId = string;

// Match-V5 returns a big payload. Keep it as unknown/any and you extract what you need.
export type MatchV5 = any;

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function optEnv(name: string) {
  const v = process.env[name];
  return v ? v.trim() : undefined;
}

const API_KEY = () => mustEnv("RIOT_API_KEY");

/**
 * ACCOUNT-V1 routing values: americas | asia | europe
 * If you set RIOT_ACCOUNT_REGION=sea, we map it to asia (account lives there).
 */
function ACCOUNT_REGION(): "americas" | "asia" | "europe" {
  const raw = mustEnv("RIOT_ACCOUNT_REGION").toLowerCase();
  if (raw === "sea") return "asia";
  if (raw === "americas" || raw === "asia" || raw === "europe") return raw;
  throw new Error(`RIOT_ACCOUNT_REGION must be americas|asia|europe|sea (got: ${raw})`);
}

/**
 * MATCH-V5 routing values: americas | asia | europe | sea
 * Prefer setting RIOT_MATCH_REGION explicitly. If not set, we infer:
 * - if RIOT_ACCOUNT_REGION was "sea" => match region "sea"
 * - else use the same as account region (americas/asia/europe)
 */
function MATCH_REGION_DEFAULT(): "americas" | "asia" | "europe" | "sea" {
  const rawMatch = optEnv("RIOT_MATCH_REGION")?.toLowerCase();
  if (rawMatch) {
    if (rawMatch === "americas" || rawMatch === "asia" || rawMatch === "europe" || rawMatch === "sea")
      return rawMatch;
    throw new Error(`RIOT_MATCH_REGION must be americas|asia|europe|sea (got: ${rawMatch})`);
  }

  const rawAccount = mustEnv("RIOT_ACCOUNT_REGION").toLowerCase();
  if (rawAccount === "sea") return "sea";
  const acc = ACCOUNT_REGION();
  return acc;
}

/**
 * For SEA platforms like sg2/th2/ph2/vn2/tw2 => match routing "sea"
 * Otherwise map common LoL platforms to match routing.
 */
export function platformToMatchRegion(platform: string): "americas" | "asia" | "europe" | "sea" {
  const p = platform.toLowerCase();

  // SEA cluster
  if (["sg2", "th2", "ph2", "vn2", "tw2"].includes(p)) return "sea";

  // AMERICAS
  if (["na1", "br1", "la1", "la2", "oc1"].includes(p)) return "americas";

  // EUROPE
  if (["euw1", "eun1", "tr1", "ru"].includes(p)) return "europe";

  // ASIA
  if (["kr", "jp1"].includes(p)) return "asia";

  // fallback to env default
  return MATCH_REGION_DEFAULT();
}

export class RiotApiError extends Error {
  status: number;
  body: string;
  url?: string;
  retryAfterMs?: number;

  constructor(status: number, body: string, opts?: { url?: string; retryAfterMs?: number }) {
    super(`Riot API ${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.url = opts?.url;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}

function parseRiotErrorMessage(text: string) {
  try {
    const j = JSON.parse(text);
    return j?.status?.message ? String(j.status.message) : text;
  } catch {
    return text;
  }
}

function retryAfterMsFromHeaders(res: Response): number | undefined {
  const ra = res.headers.get("retry-after");
  if (!ra) return undefined;
  const n = Number(ra);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n * 1000);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function riotFetch<T>(url: string, opts?: { maxRetries?: number }): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: {
        "X-Riot-Token": API_KEY(),
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    });

    if (res.ok) return (await res.json()) as T;

    const text = await res.text().catch(() => "");
    const msg = parseRiotErrorMessage(text || res.statusText);

    // 429: respect Retry-After if present
    if (res.status === 429 && attempt < maxRetries) {
      const waitMs = retryAfterMsFromHeaders(res) ?? (1500 + attempt * 1500);
      // tiny jitter so concurrent refreshes don’t line up
      await sleep(waitMs + Math.floor(Math.random() * 250));
      continue;
    }

    throw new RiotApiError(res.status, msg, { url, retryAfterMs: retryAfterMsFromHeaders(res) });
  }

  // should never reach
  throw new RiotApiError(429, "Rate limit (retries exhausted)", { url });
}

export function isRiot404(e: unknown) {
  return e instanceof RiotApiError && e.status === 404;
}

export function isRiot429(e: unknown) {
  return e instanceof RiotApiError && e.status === 429;
}

// -----------------------
// Account / Summoner / League
// -----------------------

export async function getPuuidByRiotId(gameName: string, tagLine: string) {
  const region = ACCOUNT_REGION();
  const url =
    `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch<RiotAccount>(url);
}

export async function getSummonerByPuuid(platform: string, puuid: string) {
  const host = platform.toLowerCase();
  const url = `https://${host}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(
    puuid
  )}`;
  return riotFetch<Summoner>(url);
}

export async function getLeagueEntriesByPuuid(platform: string, puuid: string) {
  const host = platform.toLowerCase();
  const url = `https://${host}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(
    puuid
  )}`;
  return riotFetch<LeagueEntry[]>(url);
}

/**
 * Finds the correct SEA platform by probing known SEA shards.
 * (Good enough for your Myanmar use-case.)
 */
export async function findSeaPlatformByPuuid(puuid: string) {
  const candidates = ["sg2", "th2", "ph2", "vn2", "tw2"] as const;

  for (const platform of candidates) {
    try {
      const summoner = await getSummonerByPuuid(platform, puuid);
      return { platform, summoner };
    } catch (e) {
      if (isRiot404(e)) continue;
      throw e;
    }
  }

  throw new Error("LoL account not found on SEA platforms (sg2/th2/ph2/vn2/tw2).");
}

// -----------------------
// Champion Mastery
// -----------------------

export async function getChampionMasteriesByPuuid(platform: string, puuid: string) {
  const host = platform.toLowerCase();
  const url =
    `https://${host}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/` +
    `${encodeURIComponent(puuid)}`;
  return riotFetch<ChampionMastery[]>(url);
}

export async function getTopChampionMasteriesByPuuid(platform: string, puuid: string, count = 3) {
  if (!puuid) throw new Error("Missing puuid");
  const all = await getChampionMasteriesByPuuid(platform, puuid);
  return Array.isArray(all) ? all.slice(0, count) : [];
}

// -----------------------
// Match-V5 (history + details)
// -----------------------

function matchHost(matchRegion?: string) {
  const region = (matchRegion ?? MATCH_REGION_DEFAULT()).toLowerCase();
  return region; // "sea" | "asia" | "europe" | "americas"
}

export async function getMatchIdsByPuuid(params: {
  puuid: string;
  matchRegion?: string;
  start?: number;
  count?: number;
  queue?: number;
  type?: "ranked" | "normal" | "tourney" | "tutorial";
}) {
  const host = matchHost(params.matchRegion);
  const start = params.start ?? 0;
  const count = params.count ?? 10;

  const qs = new URLSearchParams();
  qs.set("start", String(start));
  qs.set("count", String(count));
  if (params.queue != null) qs.set("queue", String(params.queue));
  if (params.type) qs.set("type", params.type);

  const url =
    `https://${host}.api.riotgames.com/lol/match/v5/matches/by-puuid/` +
    `${encodeURIComponent(params.puuid)}/ids?${qs.toString()}`;

  return riotFetch<MatchId[]>(url);
}

export async function getMatchById(matchId: string, matchRegion?: string) {
  const host = matchHost(matchRegion);
  const url = `https://${host}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return riotFetch<MatchV5>(url);
}
