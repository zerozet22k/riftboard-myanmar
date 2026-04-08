import type { MetadataRoute } from "next";
import { dbConnect } from "@/lib/mongodb";
import { canonicalPlayerPath } from "@/lib/playerIdentity";
import { absoluteUrl } from "@/lib/seo";
import { Player } from "@/models/player";
import { Tournament } from "@/models/tournament";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await dbConnect();

  const [players, tournaments] = await Promise.all([
    Player.find(
      {
        "leaderboard.status": "approved",
        $or: [
          { "leaderboard.group": "burmese" },
          { "leaderboard.group": null },
          { leaderboard: { $exists: false } },
        ],
      },
      {
        gameName: 1,
        tagLine: 1,
        lastRefreshAt: 1,
        updatedAt: 1,
      }
    ).lean<Array<{ gameName?: string | null; tagLine?: string | null; lastRefreshAt?: Date | null; updatedAt?: Date | null }>>(),
    Tournament.find(
      { status: { $ne: "draft" } },
      {
        slug: 1,
        updatedAt: 1,
      }
    ).lean<Array<{ slug?: string | null; updatedAt?: Date | null }>>(),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: absoluteUrl("/tournaments"),
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: absoluteUrl("/privacy"),
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: absoluteUrl("/terms"),
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];

  const playerPages: MetadataRoute.Sitemap = players
    .filter((player) => player.gameName && player.tagLine)
    .map((player) => ({
      url: absoluteUrl(canonicalPlayerPath(player.gameName, player.tagLine)),
      lastModified: player.lastRefreshAt ?? player.updatedAt ?? new Date(),
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

  const tournamentPages: MetadataRoute.Sitemap = tournaments
    .filter((tournament) => tournament.slug)
    .map((tournament) => ({
      url: absoluteUrl(`/tournaments/${encodeURIComponent(String(tournament.slug))}`),
      lastModified: tournament.updatedAt ?? new Date(),
      changeFrequency: "daily" as const,
      priority: 0.6,
    }));

  return [...staticPages, ...playerPages, ...tournamentPages];
}
