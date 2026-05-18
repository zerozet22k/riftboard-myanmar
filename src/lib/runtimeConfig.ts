function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function parseCodeList(value: string | undefined) {
  if (!value?.trim()) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => !!part)
    )
  );
}

function normalizeUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  return `https://${trimmed.replace(/\/+$/, "")}`;
}

export function getCommunityJoinCode() {
  const fromList = getCommunityJoinCodes();
  if (fromList.length) return fromList[0];
  return firstNonEmpty([
    process.env.SUBMIT_CODE,
  ]);
}

export function getCommunityJoinCodes() {
  const list = parseCodeList(process.env.COMMUNITY_JOIN_CODE);
  if (list.length) return list;

  const fallback = process.env.SUBMIT_CODE?.trim();
  return fallback ? [fallback] : [];
}

export function isCommunityCodeRequired() {
  return getCommunityJoinCodes().length > 0;
}

export function getCommunityDiscordUrl() {
  return firstNonEmpty([
    normalizeUrl(process.env.COMMUNITY_DISCORD_URL),
    normalizeUrl(process.env.COMMUNITY_DISCORD_INVITE_URL),
    normalizeUrl(process.env.DISCORD_INVITE_URL),
    normalizeUrl(process.env.NEXT_PUBLIC_COMMUNITY_DISCORD_URL),
    normalizeUrl(process.env.NEXT_PUBLIC_DISCORD_INVITE_URL),
  ]);
}

export function getTournamentHostCode() {
  return firstNonEmpty([
    process.env.TOURNAMENT_HOST_CODE,
    process.env.COMMUNITY_JOIN_CODE,
    process.env.SUBMIT_CODE,
  ]);
}

export function isRiotTournamentApiEnabled() {
  const raw = firstNonEmpty([process.env.RIOT_TOURNAMENT_API_ENABLED]).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function getTournamentCallbackToken() {
  return firstNonEmpty([process.env.RIOT_TOURNAMENT_CALLBACK_TOKEN, "riot-tournament-callback"]);
}

export function getSchedulerTokens() {
  const values = [
    process.env.SCHEDULER_TOKEN,
    process.env.CRON_SECRET,
    process.env.CRON_KEY,
    process.env.COMMUNITY_RUNNER_TOKEN,
    process.env.REFRESH_RUNNER_TOKEN,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);

  return Array.from(new Set(values));
}

export function getAdminSecret() {
  return firstNonEmpty([process.env.ADMIN_SECRET]);
}

export function getAppBaseUrl() {
  return firstNonEmpty([
    normalizeUrl(process.env.APP_BASE_URL),
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL),
    normalizeUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    normalizeUrl(process.env.VERCEL_URL),
    "http://127.0.0.1:3000",
  ]);
}
