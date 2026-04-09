import { getAppBaseUrl } from "@/lib/runtimeConfig";

export const SITE_NAME = "RiftBoard Myanmar";
export const SITE_DESCRIPTION =
  "Myanmar League of Legends leaderboard, player profiles, LP tracking, match history, champion mastery, and community tournaments.";
export const SITE_PUBLISHER = SITE_NAME;
export const SITE_LOGO_PATH = "/logo.png";
export const SITE_BANNER_PATH = "/banner.png";
const GOOGLE_SITE_VERIFICATION_FALLBACK = "4nPX8Ok4DvtWgJbLn6wOWqfQ5iw9t7DPbthiMlHP3gc";

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

export function getSiteLogoUrl() {
  return absoluteUrl(SITE_LOGO_PATH);
}

export function getSiteBannerUrl() {
  return absoluteUrl(SITE_BANNER_PATH);
}

export function getSiteOpenGraphImages() {
  return [
    {
      url: getSiteBannerUrl(),
      width: 1200,
      height: 630,
      alt: `${SITE_NAME} banner`,
    },
  ];
}

export function getOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationSchemaId(),
    name: SITE_PUBLISHER,
    url: getSiteUrl(),
    logo: {
      "@type": "ImageObject",
      url: getSiteLogoUrl(),
    },
    image: [getSiteBannerUrl()],
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
    image: [getSiteBannerUrl()],
    publisher: {
      "@id": organizationSchemaId(),
    },
  };
}

export function getGoogleSiteVerification() {
  const raw =
    process.env.GOOGLE_SITE_VERIFICATION?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() ||
    GOOGLE_SITE_VERIFICATION_FALLBACK;

  const normalized = raw.replace(/^google-site-verification\s*=\s*/i, "").trim();
  return normalized || undefined;
}
