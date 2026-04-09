import Link from "next/link";
import Image from "next/image";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";
import {
  absoluteUrl,
  getGoogleSiteVerification,
  getSiteOpenGraphImages,
  getOrganizationJsonLd,
  getSiteUrl,
  getWebsiteJsonLd,
  SITE_LOGO_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_PUBLISHER,
} from "@/lib/seo";
import { getCommunityDiscordUrl, isCommunityCodeRequired } from "@/lib/runtimeConfig";
import { RIOT_LEGAL_BOILERPLATE } from "@/lib/tournaments";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  publisher: SITE_PUBLISHER,
  keywords: [
    "Myanmar League of Legends",
    "LoL leaderboard Myanmar",
    "RiftBoard Myanmar",
    "League of Legends player profiles",
    "LoL match history",
    "LoL champion mastery",
    "Myanmar esports tournaments",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    google: getGoogleSiteVerification(),
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    images: getSiteOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [absoluteUrl(SITE_LOGO_PATH), ...getSiteOpenGraphImages().map((image) => image.url)],
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const communityCodeRequired = isCommunityCodeRequired();
  const communityDiscordUrl = communityCodeRequired ? "" : getCommunityDiscordUrl();
  const siteJsonLd = [getOrganizationJsonLd(), getWebsiteJsonLd()];

  return (
    <html lang="en" className="dark">
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          "min-h-screen antialiased",
          "bg-zinc-950 text-zinc-100",
        ].join(" ")}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />

        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950 via-zinc-950 to-black" />
          <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(to_right,rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
        </div>

        <div className="mx-auto w-full">
          <SiteHeader
            discordUrl={communityDiscordUrl}
            accessLabel={communityCodeRequired ? "Join Community" : "Link Account"}
          />
          {children}
          <footer className="px-4 py-10 text-center text-xs text-zinc-500 sm:px-6">
            <div className="mb-4 flex items-center justify-center gap-3">
              <Image
                src={SITE_LOGO_PATH}
                alt="RiftBoard Myanmar logo"
                width={40}
                height={40}
                className="rounded-xl ring-1 ring-white/10"
              />
              <div className="text-left">
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-600">Myanmar Community</div>
                <div className="text-sm font-semibold text-zinc-300">RiftBoard Myanmar</div>
              </div>
            </div>
            <div className="mb-3 flex items-center justify-center gap-4 text-sm text-zinc-400">
              {communityDiscordUrl ? (
                <Link
                  href={communityDiscordUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="transition hover:text-zinc-200"
                >
                  Discord
                </Link>
              ) : null}
              <Link href="/terms" className="transition hover:text-zinc-200">
                Terms
              </Link>
              <Link href="/privacy" className="transition hover:text-zinc-200">
                Privacy
              </Link>
            </div>
            <div>{RIOT_LEGAL_BOILERPLATE}</div>
          </footer>
        </div>
      </body>
    </html>
  );
}
