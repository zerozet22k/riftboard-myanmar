import { after, NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { dbConnect } from "@/lib/mongodb";
import { loadVerifiedDiscordAccount } from "@/lib/discordAccountStore";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import {
  saveVerifiedDiscordLinkFromRso,
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import {
  clearPendingDiscordBindCookie,
  discordSessionCookieIsSecure,
  getOptionalDiscordSessionFromRequest,
  setDiscordSessionCookie,
} from "@/lib/discordSession";
import {
  canonicalPlayerPath,
  normalizeRiotIdPart,
} from "@/lib/playerIdentity";
import {
  markPlayerRankRefreshFailed,
  queuePlayerRankRefresh,
} from "@/lib/rankRefresh";
import {
  clearRsoOAuthStateCookie,
  exchangeRsoCode,
  fetchRsoUserInfo,
  normalizeReturnTo,
  readRsoOAuthStateCookieValue,
  setRsoSessionCookie,
} from "@/lib/riotAuth";
import { getRsoAccountMe, isRiot429 } from "@/lib/riot";
import { refreshPlayerById } from "@/lib/refresh";
import {
  RiotRefreshBusyError,
  withRiotRefreshLease,
} from "@/lib/schedulerLease";
import { Player } from "@/models/player";
import { oauthProviderErrorMessage } from "@/lib/oauthRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectOAuthError(req: NextRequest, returnTo: string | undefined | null, error: string) {
  const safeReturnTo = normalizeReturnTo(returnTo);
  const target = new URL(safeReturnTo === "/" ? "/discord/linked-roles" : safeReturnTo, req.url);
  target.searchParams.set("status", "error");
  target.searchParams.set("message", error);
  return NextResponse.redirect(target);
}

async function refreshLinkedPlayer(
  playerId: unknown,
  requestedAt: Date | string | null | undefined
) {
  try {
    const refreshed = await withRiotRefreshLease(() =>
      refreshPlayerById(String(playerId), {
        force: true,
        cooldownMs: 0,
        syncMatches: false,
        syncTftMatches: false,
        syncMastery: false,
        matchesCount: 5,
        fullMastery: false,
      })
    );
    const profilePath = canonicalPlayerPath(
      refreshed.gameName,
      refreshed.tagLine
    );
    revalidatePath("/");
    revalidatePath("/leaderboard");
    revalidatePath("/tft");
    revalidatePath("/discord/linked-roles");
    revalidatePath(profilePath);
    return true;
  } catch (error) {
    const queuedForRetry =
      error instanceof RiotRefreshBusyError || isRiot429(error);
    if (!queuedForRetry) {
      await markPlayerRankRefreshFailed(
        playerId,
        requestedAt,
        error
      ).catch(() => undefined);
    }
    console.error(
      "[riot/oauth] linked player refresh failed",
      error instanceof Error ? error.name : "UnknownError"
    );
    return false;
  }
}

function scheduleLinkedAccountRefresh(
  playerId: unknown,
  linkId: string,
  syncRoles: boolean,
  requestedAt: Date | string | null | undefined
) {
  after(async () => {
    const refreshed = await refreshLinkedPlayer(playerId, requestedAt);
    if (!refreshed || !syncRoles) return;

    try {
      await syncDiscordLinkedRoleForStoredLink(linkId, { force: true });
    } catch (error) {
      console.error("[riot/oauth] Discord linked-role sync failed", error);
    }

    try {
      await syncDiscordGuildRankRoleForStoredLink(linkId, { force: true });
    } catch (error) {
      console.error("[riot/oauth] Discord guild role sync failed", error);
    }
  });
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  const errorDescription = req.nextUrl.searchParams.get("error_description");

  const savedState = readRsoOAuthStateCookieValue(
    req.cookies.get("rso_oauth_state")?.value
  );
  /* ---- missing or invalid state => incomplete/invalid OAuth flow ---- */
  if (!stateParam || !savedState) {
    const response = redirectOAuthError(req, savedState?.returnTo, "missing-rso-state");
    clearRsoOAuthStateCookie(response);
    return response;
  }

  /* ---- state mismatch => CSRF ---- */
  if (stateParam !== savedState.state) {
    const response = redirectOAuthError(req, savedState.returnTo, "invalid-rso-state");
    clearRsoOAuthStateCookie(response);
    return response;
  }

  /* ---- provider-declared errors (for example a cancelled sign-in) ---- */
  if (errorParam) {
    const response = redirectOAuthError(
      req,
      savedState.returnTo,
      oauthProviderErrorMessage("Riot", errorParam, errorDescription)
    );
    clearRsoOAuthStateCookie(response);
    return response;
  }

  if (!code) {
    const response = redirectOAuthError(
      req,
      savedState.returnTo,
      "Riot returned without an authorization code. Start Riot sign-in again."
    );
    clearRsoOAuthStateCookie(response);
    return response;
  }

  try {
    /* ---- exchange code for token ---- */
    const token = await exchangeRsoCode(code);

    /* ---- get user info (puuid) ---- */
    const userInfo = await fetchRsoUserInfo(token.access_token);
    if (!userInfo.sub) throw new Error("RSO returned no PUUID");

    /* ---- resolve Riot ID ---- */
    const account = await getRsoAccountMe(token.access_token);
    if (!account?.gameName || !account?.tagLine) {
      throw new Error("Could not resolve Riot ID from RSO");
    }
    const userInfoPuuid = String(userInfo.sub).trim();
    const accountPuuid = String(account.puuid ?? "").trim();
    if (accountPuuid && accountPuuid !== userInfoPuuid) {
      throw new Error("riot-id-puuid-conflict");
    }
    const puuid = accountPuuid || userInfoPuuid;

    /* ---- find or create player ---- */
    await dbConnect();

    const gameNameNorm = normalizeRiotIdPart(account.gameName);
    const tagLineNorm = normalizeRiotIdPart(account.tagLine);

    const [playerByPuuid, playerByRiotId] = await Promise.all([
      Player.findOne({ puuid }).lean(),
      Player.findOne({ gameNameNorm, tagLineNorm }).lean(),
    ]);
    const riotIdPuuid = String(playerByRiotId?.puuid ?? "").trim();
    if (
      (riotIdPuuid && riotIdPuuid !== puuid) ||
      (playerByPuuid &&
        playerByRiotId &&
        String(playerByPuuid._id) !== String(playerByRiotId._id))
    ) {
      throw new Error("riot-id-puuid-conflict");
    }

    let player = playerByPuuid ?? playerByRiotId;

    if (!player) {
      const created = await Player.create({
        gameName: account.gameName,
        tagLine: account.tagLine,
        gameNameNorm,
        tagLineNorm,
        puuid,
        platform: "auto",
        solo: {},
        flex: {},
      });
      player = created.toObject();
    } else if (!player.puuid) {
      await Player.updateOne({ _id: player._id }, { $set: { puuid } });
    }

    if (savedState.bindDiscordAccount && player?._id && player.gameName && player.tagLine) {
      const discordSession = await getOptionalDiscordSessionFromRequest(req, {
        verifyGuildMembership: true,
      });
      if (!discordSession?.discordUserId) {
        const target = new URL("/discord/linked-roles", req.url);
        target.searchParams.set("status", "error");
        target.searchParams.set("message", "missing-discord-session");
        const response = NextResponse.redirect(target);
        setRsoSessionCookie(response, { puuid }, req.nextUrl.protocol === "https:");
        clearRsoOAuthStateCookie(response);
        return response;
      }

      await loadVerifiedDiscordAccount(discordSession.discordUserId);
      const bound = await saveVerifiedDiscordLinkFromRso({
        discordUserId: discordSession.discordUserId,
        player: {
          _id: player._id,
          gameName: player.gameName ?? account.gameName,
          tagLine: player.tagLine ?? account.tagLine,
        },
      });

      const queuedRefresh = await queuePlayerRankRefresh(
        player._id,
        { force: true }
      );
      scheduleLinkedAccountRefresh(
        player._id,
        String(bound.link._id),
        bound.isPrimary,
        queuedRefresh.requestedAt
      );

      const target = new URL(normalizeReturnTo(savedState.returnTo), req.url);
      if (target.pathname === "/discord/linked-roles") {
        target.searchParams.set("status", "linked");
        target.searchParams.set("riotId", `${bound.player.gameName}#${bound.player.tagLine}`);
      }

      const response = NextResponse.redirect(target);
      setRsoSessionCookie(response, { puuid }, req.nextUrl.protocol === "https:");
      setDiscordSessionCookie(
        response,
        { discordUserId: discordSession.discordUserId },
        discordSessionCookieIsSecure(req)
      );
      clearRsoOAuthStateCookie(response);
      clearPendingDiscordBindCookie(response);
      return response;
    }

    /* ---- set session cookie ---- */
    const returnTo = normalizeReturnTo(savedState.returnTo);
    const profilePath = canonicalPlayerPath(
      player.gameName ?? account.gameName,
      player.tagLine ?? account.tagLine
    );

    if (player?._id) {
      const queuedRefresh = await queuePlayerRankRefresh(
        player._id,
        { force: true }
      );
      await refreshLinkedPlayer(
        player._id,
        queuedRefresh.requestedAt
      );
    }

    const target = new URL(
      returnTo === "/" ? profilePath : returnTo,
      req.url
    );

    const response = NextResponse.redirect(target);
    setRsoSessionCookie(response, { puuid }, req.nextUrl.protocol === "https:");
    clearRsoOAuthStateCookie(response);
    clearPendingDiscordBindCookie(response);
    return response;
  } catch (error) {
    console.error("RSO callback error:", error);
    const response = redirectOAuthError(
      req,
      savedState?.returnTo,
      error instanceof Error ? error.message : "rso-callback-failed"
    );
    clearRsoOAuthStateCookie(response);
    return response;
  }
}
