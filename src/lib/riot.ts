// src/lib/riot.ts

export type RiotAccount = { puuid: string; gameName?: string; tagLine?: string };

export type Summoner = {
  id: string;
  puuid: string;
  profileIconId: number;
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

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

const API_KEY = () => mustEnv("RIOT_API_KEY");

function ACCOUNT_REGION(): "americas" | "asia" | "europe" {
  const raw = mustEnv("RIOT_ACCOUNT_REGION").toLowerCase();
  if (raw === "sea") return "asia"; 
  if (raw === "americas" || raw === "asia" || raw === "europe") return raw;
  throw new Error(`RIOT_ACCOUNT_REGION must be americas|asia|europe (got: ${raw})`);
}

export class RiotApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Riot API ${status}: ${body}`);
    this.status = status;
    this.body = body;
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

async function riotFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "X-Riot-Token": API_KEY(),
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = parseRiotErrorMessage(text || res.statusText);
    throw new RiotApiError(res.status, msg);
  }

  return (await res.json()) as T;
}

export function isRiot404(e: unknown) {
  return e instanceof RiotApiError && e.status === 404;
}

export function isRiot429(e: unknown) {
  return e instanceof RiotApiError && e.status === 429;
}

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
export type ChampionMastery = {
  championId: number;
  championLevel: number;
  championPoints: number;
  lastPlayTime?: number;
};

export async function getChampionMasteriesByPuuid(platform: string, puuid: string) {
  const host = platform.toLowerCase();
  const url =
    `https://${host}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/` +
    `${encodeURIComponent(puuid)}`;
  return riotFetch<ChampionMastery[]>(url);
}

export async function getTopChampionMasteriesByPuuid(
  platform: string,
  puuid: string,
  count = 3
) {
  if (!puuid) throw new Error("Missing puuid");
  const all = await getChampionMasteriesByPuuid(platform, puuid);
  return Array.isArray(all) ? all.slice(0, count) : [];
}