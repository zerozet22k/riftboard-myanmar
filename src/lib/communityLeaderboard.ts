export function approvedCommunityLeaderboardQuery(group = "burmese") {
  return {
    "leaderboard.status": "approved" as const,
    $or: [
      { "leaderboard.group": group },
      { "leaderboard.group": null },
    ],
  };
}
