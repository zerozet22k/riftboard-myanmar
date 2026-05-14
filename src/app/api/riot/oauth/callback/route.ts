import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { syncDiscordGuildRankRoleForStoredLink } from "@/lib/discordGuildRoles";
import {
  saveVerifiedDiscordLinkFromRso,
  syncDiscordLinkedRoleForStoredLink,
} from "@/lib/discordLinkedRoles";
import {
  clearPendingDiscordBindCookie,
  decodePendingDiscordTokenPayload,
  normalizeReturnTo as normalizeDiscordReturnTo,
  readPendingDiscordBindCookieValue,
  setDiscordSessionCookie,
} from "@/lib/discordSession";
import {
  canonicalPlayerPath,
  normalizeRiotIdPart,
} from "@/lib/playerIdentity";
import {
  clearRsoOAuthStateCookie,
  exchangeRsoCode,
  fetchRsoUserInfo,
  normalizeReturnTo,
  readRsoOAuthStateCookieValue,
  setRsoSessionCookie,
} from "@/lib/riotAuth";
import { getAccountByPuuid } from "@/lib/riot";
import { Player } from "@/models/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  const savedState = readRsoOAuthStateCookieValue(
    req.cookies.get("rso_oauth_state")?.value
  );
  const pendingDiscordBind = readPendingDiscordBindCookieValue(
    req.cookies.get("discord_pending_bind")?.value
  );

  /* ---- error from Riot or missing params ---- */
  if (errorParam || !code || !stateParam || !savedState) {
    const target = new URL("/", req.url);
    target.searchParams.set("rso_error", errorParam || "missing_params");
    const response = NextResponse.redirect(target);
    clearRsoOAuthStateCookie(response);
    return response;
  }

  /* ---- state mismatch => CSRF ---- */
  if (stateParam !== savedState.state) {
    const target = new URL("/", req.url);
    target.searchParams.set("rso_error", "state_mismatch");
    const response = NextResponse.redirect(target);
    clearRsoOAuthStateCookie(response);
    return response;
  }

  try {
    /* ---- exchange code for token ---- */
    const token = await exchangeRsoCode(code);

    /* ---- get user info (puuid) ---- */
    const userInfo = await fetchRsoUserInfo(token.access_token);
    if (!userInfo.sub) throw new Error("RSO returned no PUUID");

    const puuid = userInfo.sub;

    /* ---- resolve Riot ID ---- */
    const account = await getAccountByPuuid(puuid);
    if (!account?.gameName || !account?.tagLine) {
      throw new Error("Could not resolve Riot ID from PUUID");
    }

    /* ---- find or create player ---- */
    await dbConnect();

    const gameNameNorm = normalizeRiotIdPart(account.gameName);
    const tagLineNorm = normalizeRiotIdPart(account.tagLine);

    let player = await Player.findOne({ puuid }).lean();

    if (!player) {
      player = await Player.findOne({
        gameNameNorm,
        tagLineNorm,
      }).lean();
    }

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

    if (pendingDiscordBind && player?._id && player.gameName && player.tagLine) {
      const decodedDiscord = decodePendingDiscordTokenPayload(pendingDiscordBind);
      const bound = await saveVerifiedDiscordLinkFromRso({
        discordUserId: pendingDiscordBind.discordUserId,
        discordUsername: pendingDiscordBind.discordUsername,
        accessToken: decodedDiscord.accessToken,
        refreshToken: decodedDiscord.refreshToken,
        tokenType: pendingDiscordBind.tokenType,
        scopes: pendingDiscordBind.scopes,
        expiresAt: decodedDiscord.expiresAt,
        player: {
          _id: player._id,
          gameName: player.gameName ?? account.gameName,
          tagLine: player.tagLine ?? account.tagLine,
        },
      });

      let syncFailed = false;
      try {
        await syncDiscordLinkedRoleForStoredLink(String(bound.link._id), { force: true });
      } catch (error) {
        syncFailed = true;
        console.error("[riot/oauth] Discord linked-role sync failed", error);
      }

      try {
        await syncDiscordGuildRankRoleForStoredLink(String(bound.link._id), { force: true });
      } catch (error) {
        syncFailed = true;
        console.error("[riot/oauth] Discord guild role sync failed", error);
      }

      const target = new URL(normalizeDiscordReturnTo(pendingDiscordBind.returnTo), req.url);
      if (target.pathname === "/discord/linked-roles") {
        target.searchParams.set("status", "linked");
        target.searchParams.set("riotId", `${bound.player.gameName}#${bound.player.tagLine}`);
        if (syncFailed) target.searchParams.set("message", "discord-role-sync-failed");
      }

      const response = NextResponse.redirect(target);
      setRsoSessionCookie(response, { puuid }, req.nextUrl.protocol === "https:");
      setDiscordSessionCookie(response, { discordUserId: pendingDiscordBind.discordUserId }, req.nextUrl.protocol === "https:");
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
    const target = new URL("/", req.url);
    target.searchParams.set(
      "rso_error",
      error instanceof Error ? error.message : "callback_failed"
    );
    const response = NextResponse.redirect(target);
    clearRsoOAuthStateCookie(response);
    return response;
  }
}
