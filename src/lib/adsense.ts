const ADSENSE_CLIENT_PATTERN = /^ca-pub-\d{16}$/;
const ADSENSE_SLOT_PATTERN = /^\d{5,20}$/;
const GOOGLE_SELLER_CERTIFICATION_ID = "f08c47fec0942fa0";

export function normalizeAdSenseClientId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return ADSENSE_CLIENT_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeAdSenseSlotId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return ADSENSE_SLOT_PATTERN.test(normalized) ? normalized : null;
}

export function getAdSenseClientId() {
  return normalizeAdSenseClientId(process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID);
}

export function getLeaderboardAdSlotId() {
  return normalizeAdSenseSlotId(process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_LEADERBOARD_SLOT_ID);
}

export function getGoogleAdsTxtRecord() {
  const clientId = getAdSenseClientId();
  if (!clientId) return null;

  const publisherId = clientId.replace(/^ca-/, "");
  return `google.com, ${publisherId}, DIRECT, ${GOOGLE_SELLER_CERTIFICATION_ID}`;
}
