import { getAppBaseUrl } from "@/lib/runtimeConfig";

export const SITE_NAME = "RiftBoard Myanmar";
export const SITE_DESCRIPTION =
  "Myanmar League of Legends leaderboard, player profiles, LP tracking, match history, champion mastery, and community tournaments.";
export const SITE_PUBLISHER = SITE_NAME;

export function getSiteUrl() {
  return getAppBaseUrl().replace(/\/+$/, "");
}

export function absoluteUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, `${getSiteUrl()}/`).toString();
}

export function organizationSchemaId() {
  return absoluteUrl("/#organization");
}

export function websiteSchemaId() {
  return absoluteUrl("/#website");
}

export function getOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationSchemaId(),
    name: SITE_PUBLISHER,
    url: getSiteUrl(),
  };
}

export function getWebsiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": websiteSchemaId(),
    name: SITE_NAME,
    url: getSiteUrl(),
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: {
      "@id": organizationSchemaId(),
    },
  };
}
