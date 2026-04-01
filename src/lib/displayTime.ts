const APP_LOCALE = "en-US";
const APP_TIME_ZONE = "Asia/Yangon";
const numberFormatter = new Intl.NumberFormat(APP_LOCALE);

function parseDate(value: Date | string | number | null | undefined) {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatNumber(value: number | string | null | undefined) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numberFormatter.format(numeric);
}

export function formatFullDateTime(value: Date | string | number | null | undefined) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

export function formatMetaDateTime(value: Date | string | number | null | undefined) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function formatCompactDateTime(value: Date | string | number | null | undefined) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function formatRelativeTime(epochMs: number | null | undefined, nowMs: number) {
  if (!epochMs || !Number.isFinite(epochMs) || !Number.isFinite(nowMs)) return null;
  const delta = nowMs - epochMs;
  if (delta < 0) return null;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
