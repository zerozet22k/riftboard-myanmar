import { getAppBaseUrl } from "@/lib/runtimeConfig";

export const SITE_NAME = "RiftBoard Myanmar";
export const SITE_DESCRIPTION =
  "Myanmar League of Legends leaderboard, player profiles, LP tracking, match history, champion mastery, and community tournaments.";

export function getSiteUrl() {
  return getAppBaseUrl().replace(/\/+$/, "");
}

export function absoluteUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, `${getSiteUrl()}/`).toString();
}
