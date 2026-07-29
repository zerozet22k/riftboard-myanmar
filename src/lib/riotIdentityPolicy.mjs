function clean(value) {
  return String(value ?? "").trim();
}

/**
 * A stored LoL PUUID is the durable account identity. Riot IDs can be renamed
 * and old names can later belong to somebody else, so existing players must be
 * resolved from their PUUID instead of being rebound from their saved Riot ID.
 *
 * @param {unknown} value
 */
export function hasStoredRiotIdentity(value) {
  return clean(value).length > 0;
}

/**
 * Two player rows are safe to consolidate only when their durable identities
 * agree, or one of the rows has not been assigned a PUUID yet.
 *
 * @param {unknown} currentPuuid
 * @param {unknown} duplicatePuuid
 */
export function canMergeRiotIdentities(currentPuuid, duplicatePuuid) {
  const current = clean(currentPuuid);
  const duplicate = clean(duplicatePuuid);
  return !current || !duplicate || current === duplicate;
}

/**
 * @param {unknown} retryAfterAt
 * @param {{ force?: boolean, nowMs?: number }} [options]
 */
export function isTftRetryBackoffActive(retryAfterAt, options = {}) {
  if (options.force === true) return false;
  const retryAt = new Date(String(retryAfterAt ?? "")).getTime();
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  return Number.isFinite(retryAt) && retryAt > nowMs;
}
