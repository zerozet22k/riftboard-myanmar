export type RiotAccount = { puuid: string; gameName?: string; tagLine?: string };

export type Summoner = {
  id: string;
  puuid: string;
  name: string;
  profileIconId: number;
  summonerLevel: number;
  revisionDate: number; 
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

export type MatchV5 = unknown;
export type ActiveShard = {
  puuid: string;
  game: string;
  activeShard: string;
};

export type TournamentCodeParams = {
  mapType?: string;
  pickType?: string;
  spectatorType?: string;
  teamSize?: number;
  metadata?: string;
  allowedParticipantIds?: string[];
};

export type TournamentCodeDetails = Record<string, unknown>;
export type TournamentLobbyEvents = Record<string, unknown>;

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function optEnv(name: string) {
  const v = process.env[name];
  return v ? v.trim() : undefined;
}

const ACCOUNT_REGIONS = ["americas", "asia", "europe"] as const;

function getLolApiKey() {
  return mustEnv("RIOT_API_KEY");
}

function getTftApiKey() {
  const key = optEnv("RIOT_TFT_API_KEY") || optEnv("TFT_API_KEY");
  if (!key) throw new Error("Missing env: RIOT_TFT_API_KEY");
  return key;
}

export function hasTftApiKey() {
  return !!(optEnv("RIOT_TFT_API_KEY") || optEnv("TFT_API_KEY"));
}

export function getRiotApiKey(game: "lol" | "tft" = "lol") {
  return game === "tft" ? getTftApiKey() : getLolApiKey();
}

function ACCOUNT_REGION(): "americas" | "asia" | "europe" {
  const raw = mustEnv("RIOT_ACCOUNT_REGION").toLowerCase();
  if (raw === "sea") return "asia";
  if (raw === "americas" || raw === "asia" || raw === "europe") return raw;
  throw new Error(`RIOT_ACCOUNT_REGION must be americas|asia|europe|sea (got: ${raw})`);
}


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

function platformToTournamentRouting(platform: string): "americas" | "asia" | "europe" {
  const region = platformToMatchRegion(platform);
  // Tournament APIs are routed on americas|asia|europe, not sea.
  return region === "sea" ? "asia" : region;
}

function platformToTournamentRegion(platform: string):
  | "BR"
  | "EUNE"
  | "EUW"
  | "JP"
  | "LAN"
  | "LAS"
  | "NA"
  | "OCE"
  | "PBE"
  | "RU"
  | "TR"
  | "KR" {
  const p = platform.toLowerCase();

  // Legacy provider registration still expects Riot's platform-to-region codes here.
  if (p === "br1") return "BR";
  if (p === "eun1") return "EUNE";
  if (p === "euw1") return "EUW";
  if (p === "jp1") return "JP";
  if (p === "la1") return "LAN";
  if (p === "la2") return "LAS";
  if (p === "na1") return "NA";
  if (p === "oc1") return "OCE";
  if (p === "ru") return "RU";
  if (p === "tr1") return "TR";
  if (p === "kr") return "KR";

  // SEA shards are routed through asia. JP is the closest supported tournament region.
  if (["sg2", "th2", "ph2", "vn2", "tw2"].includes(p)) return "JP";

  return "JP";
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

async function riotFetch<T>(url: string, opts?: { maxRetries?: number; apiKey?: string }): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const apiKey = opts?.apiKey ?? getLolApiKey();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: {
        "X-Riot-Token": apiKey,
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

async function riotFetchWithBody<T>(
  url: string,
  body: unknown,
  opts?: { maxRetries?: number; apiKey?: string }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const apiKey = opts?.apiKey ?? getLolApiKey();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Riot-Token": apiKey,
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (res.ok) {
      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }

    const text = await res.text().catch(() => "");
    const msg = parseRiotErrorMessage(text || res.statusText);

    if (res.status === 429 && attempt < maxRetries) {
      const waitMs = retryAfterMsFromHeaders(res) ?? (1500 + attempt * 1500);
      await sleep(waitMs + Math.floor(Math.random() * 250));
      continue;
    }

    throw new RiotApiError(res.status, msg, { url, retryAfterMs: retryAfterMsFromHeaders(res) });
  }

  throw new RiotApiError(429, "Rate limit (retries exhausted)", { url });
}

export async function getAccountByPuuid(puuid: string) {
  for (const region of ACCOUNT_REGIONS) {
    const url =
      `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-puuid/` +
      `${encodeURIComponent(puuid)}`;

    try {
      return await riotFetch<RiotAccount>(url);
    } catch (e) {
      if (isRiot404(e)) continue;
      throw e;
    }
  }

  throw new RiotApiError(404, "Riot account not found for puuid");
}

export async function getActiveShardByPuuid(game: "lol" | "tft", puuid: string) {
  for (const region of ACCOUNT_REGIONS) {
    const url =
      `https://${region}.api.riotgames.com/riot/account/v1/active-shards/by-game/` +
      `${encodeURIComponent(game)}/by-puuid/${encodeURIComponent(puuid)}`;

    try {
      return await riotFetch<ActiveShard>(url);
    } catch (e) {
      if (isRiot404(e)) continue;
      throw e;
    }
  }

  throw new RiotApiError(404, `Active shard not found for ${game} account`);
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

export async function getTftLeagueEntriesByPuuid(platform: string, puuid: string) {
  const host = platform.toLowerCase();
  const url = `https://${host}.api.riotgames.com/tft/league/v1/entries/by-puuid/${encodeURIComponent(
    puuid
  )}`;
  return riotFetch<LeagueEntry[]>(url, { apiKey: getRiotApiKey("tft") });
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

// -----------------------
// Tournament-V5
// -----------------------

export async function createTournamentProvider(platform: string, callbackUrl: string) {
  const routingHost = platformToTournamentRouting(platform);
  const providerRegion = platformToTournamentRegion(platform);
  const url = `https://${routingHost}.api.riotgames.com/lol/tournament/v5/providers`;
  return riotFetchWithBody<number>(url, {
    region: providerRegion,
    url: callbackUrl,
  });
}

export async function createTournament(platform: string, providerId: number, name: string) {
  const routingHost = platformToTournamentRouting(platform);
  const url = `https://${routingHost}.api.riotgames.com/lol/tournament/v5/tournaments`;
  return riotFetchWithBody<number>(url, {
    name,
    providerId,
  });
}

export async function createTournamentCodes(
  platform: string,
  tournamentId: number,
  count: number,
  params?: TournamentCodeParams
) {
  const routingHost = platformToTournamentRouting(platform);
  const url =
    `https://${routingHost}.api.riotgames.com/lol/tournament/v5/codes?` +
    new URLSearchParams({
      tournamentId: String(tournamentId),
      count: String(count),
    }).toString();

  return riotFetchWithBody<string[]>(url, {
    mapType: params?.mapType ?? "SUMMONERS_RIFT",
    pickType: params?.pickType ?? "TOURNAMENT_DRAFT",
    spectatorType: params?.spectatorType ?? "ALL",
    teamSize: Math.max(1, Math.min(5, params?.teamSize ?? 5)),
    metadata: params?.metadata ?? "",
    allowedParticipants: params?.allowedParticipantIds ?? [],
  });
}

export async function getTournamentCode(platform: string, tournamentCode: string) {
  const routingHost = platformToTournamentRouting(platform);
  const url =
    `https://${routingHost}.api.riotgames.com/lol/tournament/v5/codes/` +
    `${encodeURIComponent(tournamentCode)}`;
  return riotFetch<TournamentCodeDetails>(url);
}

export async function getTournamentLobbyEvents(platform: string, tournamentCode: string) {
  const routingHost = platformToTournamentRouting(platform);
  const url =
    `https://${routingHost}.api.riotgames.com/lol/tournament/v5/lobby-events/by-code/` +
    `${encodeURIComponent(tournamentCode)}`;
  return riotFetch<TournamentLobbyEvents>(url);
}
