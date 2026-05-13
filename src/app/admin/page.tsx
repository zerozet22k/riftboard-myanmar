import type { Metadata } from "next";
import AdminAddPlayerForm from "@/components/AdminAddPlayerForm";
import AdminLoginForm from "@/components/AdminLoginForm";
import { getOptionalAdminSession } from "@/lib/adminSession";
import { approvedCommunityLeaderboardQuery } from "@/lib/communityLeaderboard";
import { dbConnect } from "@/lib/mongodb";
import { cleanRiotIdPart } from "@/lib/playerIdentity";
import { hasTftApiKey } from "@/lib/riot";
import { DiscordLink } from "@/models/discordLink";
import { Player } from "@/models/player";
import { TftPlayerMatch } from "@/models/tftPlayerMatch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminPage() {
  const session = await getOptionalAdminSession();
  if (!session) return <AdminLoginForm />;

  await dbConnect();
  const [trackedPlayers, discordLinks, tftPlayersWithMatches, recentLinks] = await Promise.all([
    Player.countDocuments(approvedCommunityLeaderboardQuery()),
    DiscordLink.countDocuments(),
    TftPlayerMatch.distinct("playerId").then((ids) => ids.length),
    DiscordLink.find(
      {},
      { discordUserId: 1, discordUsername: 1, gameName: 1, tagLine: 1, verifiedBinding: 1, lastSyncedAt: 1, updatedAt: 1 }
    )
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
  ]);

  return (
    <AdminAddPlayerForm
      stats={{
        trackedPlayers,
        discordLinks,
        tftPlayersWithMatches,
        tftApiConfigured: hasTftApiKey(),
        recentDiscordLinks: recentLinks.map((link) => ({
          discordUserId: String(link.discordUserId ?? ""),
          discordUsername: link.discordUsername ?? null,
          gameName: cleanRiotIdPart(link.gameName),
          tagLine: cleanRiotIdPart(link.tagLine),
          verifiedBinding: link.verifiedBinding === true,
          lastSyncedAt: link.lastSyncedAt ? new Date(link.lastSyncedAt).toISOString() : null,
        })),
      }}
    />
  );
}
