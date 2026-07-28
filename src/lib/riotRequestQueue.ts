type RiotQueueState = {
  tail: Promise<void>;
  nextRequestAt: number;
  blockedUntil: number;
  minIntervalMs: number;
};

type RiotQueueStore = Map<string, RiotQueueState>;

const globalWithRiotQueues = globalThis as typeof globalThis & {
  __riftboardRiotQueues?: RiotQueueStore;
};

const queues =
  globalWithRiotQueues.__riftboardRiotQueues ??
  (globalWithRiotQueues.__riftboardRiotQueues = new Map<string, RiotQueueState>());

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberFromEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function routingGroup(hostname: string) {
  const route = hostname.toLowerCase().split(".")[0] ?? "global";
  if (["sg2", "th2", "ph2", "vn2", "tw2", "oc1", "sea"].includes(route)) return "sea";
  if (["kr", "jp1", "asia"].includes(route)) return "asia";
  if (["euw1", "eun1", "tr1", "ru", "europe"].includes(route)) return "europe";
  if (["na1", "br1", "la1", "la2", "americas"].includes(route)) return "americas";
  return route;
}

function queueKey(url: string, apiKey: string) {
  const hostname = new URL(url).hostname;
  const keyFingerprint = `${apiKey.length}:${apiKey.slice(-8)}`;
  return `${keyFingerprint}:${routingGroup(hostname)}`;
}

function getQueue(url: string, apiKey: string) {
  const key = queueKey(url, apiKey);
  const existing = queues.get(key);
  if (existing) return existing;

  const initial: RiotQueueState = {
    tail: Promise.resolve(),
    nextRequestAt: 0,
    blockedUntil: 0,
    minIntervalMs: Math.max(25, numberFromEnv("RIOT_MIN_REQUEST_INTERVAL_MS", 1_250)),
  };
  queues.set(key, initial);
  return initial;
}

function parseRateLimits(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => {
      const [limitRaw, secondsRaw] = part.trim().split(":");
      const limit = Number(limitRaw);
      const seconds = Number(secondsRaw);
      return Number.isFinite(limit) && limit > 0 && Number.isFinite(seconds) && seconds > 0
        ? { limit, seconds }
        : null;
    })
    .filter((entry): entry is { limit: number; seconds: number } => entry !== null);
}

function updatePacingFromHeaders(state: RiotQueueState, response: Response) {
  const limits = [
    ...parseRateLimits(response.headers.get("x-app-rate-limit")),
    ...parseRateLimits(response.headers.get("x-method-rate-limit")),
  ];
  if (!limits.length) return;

  const safetyFactor = Math.max(1, numberFromEnv("RIOT_RATE_LIMIT_SAFETY_FACTOR", 1.08));
  const interval = Math.max(
    ...limits.map(({ limit, seconds }) => (seconds * 1000 * safetyFactor) / limit)
  );
  state.minIntervalMs = Math.max(25, Math.min(10_000, Math.ceil(interval)));
}

export function retryAfterMsFromResponse(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function updateCircuitBreaker(state: RiotQueueState, response: Response) {
  if (response.status !== 429) return;

  const retryAfterMs =
    retryAfterMsFromResponse(response) ??
    Math.max(10_000, numberFromEnv("RIOT_429_FALLBACK_MS", 120_000));
  state.blockedUntil = Math.max(state.blockedUntil, Date.now() + retryAfterMs);
}

export async function queuedRiotFetch(
  url: string,
  init: RequestInit,
  apiKey: string
): Promise<Response> {
  const state = getQueue(url, apiKey);

  const request = state.tail.then(async () => {
    const now = Date.now();
    if (state.blockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
      return new Response(
        JSON.stringify({
          status: {
            message: "Riot request queue is paused after a rate-limit response.",
            status_code: 429,
          },
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfterSeconds),
          },
        }
      );
    }

    const waitMs = state.nextRequestAt - now;
    if (waitMs > 0) await sleep(waitMs);

    try {
      const timeoutMs = Math.max(
        1_000,
        Math.min(60_000, numberFromEnv("RIOT_REQUEST_TIMEOUT_MS", 15_000))
      );
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = init.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      const response = await fetch(url, { ...init, signal });
      updatePacingFromHeaders(state, response);
      updateCircuitBreaker(state, response);
      return response;
    } finally {
      state.nextRequestAt = Date.now() + state.minIntervalMs;
    }
  });

  state.tail = request.then(
    () => undefined,
    () => undefined
  );

  return request;
}
