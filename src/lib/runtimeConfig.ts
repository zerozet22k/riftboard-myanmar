function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function getCommunityJoinCode() {
  return firstNonEmpty([
    process.env.COMMUNITY_JOIN_CODE,
    process.env.SUBMIT_CODE,
  ]);
}

export function getSchedulerTokens() {
  const values = [
    process.env.SCHEDULER_TOKEN,
    process.env.CRON_SECRET,
    process.env.CRON_KEY,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);

  return Array.from(new Set(values));
}
