/**
 * Riot may encrypt identifiers differently for different API-key scopes.
 * Keep this decision pure so refresh behavior can be regression-tested without
 * making live Riot requests.
 *
 * @param {Record<string, string | undefined>} env
 */
export function hasSeparateTftPuuidScope(env) {
  const lolKey = String(env.RIOT_API_KEY ?? "").trim();
  const configuredTftKey = String(env.RIOT_TFT_API_KEY ?? "").trim();
  const legacyTftKey = String(env.TFT_API_KEY ?? "").trim();
  const tftKey = configuredTftKey || legacyTftKey;

  return Boolean(tftKey) && tftKey !== lolKey;
}
