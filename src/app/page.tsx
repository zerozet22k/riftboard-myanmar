import type { Metadata } from "next";
import LeaderboardPage from "./leaderboard/page";
import { absoluteUrl, getSiteOpenGraphImages, SITE_NAME } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Myanmar League of Legends Leaderboard",
  description: "Myanmar ranked LoL players, current LP, recent form, and main champions in one board.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    title: "Myanmar League of Legends Leaderboard",
    description: "Myanmar ranked LoL players, current LP, recent form, and main champions in one board.",
    siteName: SITE_NAME,
    images: getSiteOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Myanmar League of Legends Leaderboard",
    description: "Myanmar ranked LoL players, current LP, recent form, and main champions in one board.",
    images: getSiteOpenGraphImages().map((image) => image.url),
  },
};

export default LeaderboardPage;
