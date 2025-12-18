"use server";

import { refreshAllPlayers } from "@/lib/refresh";
import { revalidatePath } from "next/cache";

export async function refreshLeaderboardAction() {
    await refreshAllPlayers({
        leaderboardOnly: true,
        leaderboardGroup: "burmese",
        leaderboardStatus: "approved",
        limit: 20,
        delayMs: 900,
    });

    revalidatePath("/leaderboard");
    revalidatePath("/");
}
