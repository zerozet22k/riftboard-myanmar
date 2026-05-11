export function approvedCommunityLeaderboardQuery(group = "burmese") {
  return {
    "leaderboard.status": "approved",
    $or: [
      { "leaderboard.group": group },
      { "leaderboard.group": null },
    ],
  };
}
