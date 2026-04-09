import type { Metadata } from "next";
import LeaderboardPage from "./leaderboard/page";
import { absoluteUrl, getSiteOpenGraphImages, SITE_DESCRIPTION } from "@/lib/seo";

export const runtime = "nodejs";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Myanmar League of Legends Leaderboard",
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    title: "Myanmar League of Legends Leaderboard",
    description: SITE_DESCRIPTION,
    images: getSiteOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Myanmar League of Legends Leaderboard",
    description: SITE_DESCRIPTION,
    images: getSiteOpenGraphImages().map((image) => image.url),
  },
};

export default LeaderboardPage;
