import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/runtimeConfig";

const RSO_AUTHORIZE_URL = "https://auth.riotgames.com/authorize";
const RSO_TOKEN_URL = "https://auth.riotgames.com/token";
const RSO_USERINFO_URL = "https://auth.riotgames.com/userinfo";
const DEFAULT_RSO_CLIENT_ID = "9a39070a-4e68-4c8e-8a60-e1aaabfb4cc8";

const RSO_SESSION_COOKIE = "rso_session";
const RSO_OAUTH_STATE_COOKIE = "rso_oauth_state";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SHORT_STATE_MAX_AGE = 60 * 10; // 10 min

/* ------------------------------------------------------------------ */
/*  Env helpers                                                       */
/* ------------------------------------------------------------------ */

function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function mustEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export function getRsoClientId() {
  return firstNonEmpty([
    process.env.RSO_CLIENT_ID,
    process.env.RIOT_RSO_CLIENT_ID,
  ]) || DEFAULT_RSO_CLIENT_ID;
}

function getRsoClientSecret() {
  return firstNonEmpty([
    process.env.RSO_CLIENT_SECRET,
    process.env.RIOT_RSO_CLIENT_SECRET,
  ]) || mustEnv("RSO_CLIENT_SECRET");
}

export function getRsoRedirectUri() {
  return firstNonEmpty([
    process.env.RSO_REDIRECT_URI,
    `${getAppBaseUrl()}/api/riot/oauth/callback`,
  ]);
}

/* ------------------------------------------------------------------ */
/*  Sealed cookie helpers (same pattern as discordSession)            */
/* ------------------------------------------------------------------ */

function sessionSecret() {
  const secret = firstNonEmpty([
    process.env.APP_SESSION_SECRET,
    process.env.DISCORD_CLIENT_SECRET,
  ]);
  if (!secret) throw new Error("Missing env: APP_SESSION_SECRET");
  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function sealPayload<T extends { v: 1 }>(payload: T) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

function unsealPayload<T extends { v: 1 }>(token: string | undefined | null) {
  const raw = String(token ?? "").trim();
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(body);

  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function baseCookieOptions(secure: boolean, maxAge: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/* ------------------------------------------------------------------ */
/*  RSO OAuth URL                                                     */
/* ------------------------------------------------------------------ */

export function makeRsoOAuthUrl(state: string, opts?: { promptLogin?: boolean }) {
  const query = new URLSearchParams({
    client_id: getRsoClientId(),
    response_type: "code",
    redirect_uri: getRsoRedirectUri(),
    scope: "openid",
    state,
  });
  if (opts?.promptLogin) query.set("prompt", "login");
  return `${RSO_AUTHORIZE_URL}?${query.toString()}`;
}

/* ------------------------------------------------------------------ */
/*  Token exchange                                                    */
/* ------------------------------------------------------------------ */

export type RsoTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
};

export async function exchangeRsoCode(code: string): Promise<RsoTokenResponse> {
  const credentials = Buffer.from(
    `${getRsoClientId()}:${getRsoClientSecret()}`
  ).toString("base64");

  const res = await fetch(RSO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRsoRedirectUri(),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RSO token exchange ${res.status}: ${text || res.statusText}`);
  }

  return (await res.json()) as RsoTokenResponse;
}

/* ------------------------------------------------------------------ */
/*  Userinfo                                                          */
/* ------------------------------------------------------------------ */

export type RsoUserInfo = {
  sub: string; // puuid
  cpid?: string;
  jti?: string;
};

export async function fetchRsoUserInfo(accessToken: string): Promise<RsoUserInfo> {
  const res = await fetch(RSO_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RSO userinfo ${res.status}: ${text || res.statusText}`);
  }

  return (await res.json()) as RsoUserInfo;
}

/* ------------------------------------------------------------------ */
/*  OAuth state cookie                                                */
/* ------------------------------------------------------------------ */

type RsoOAuthStatePayload = {
  v: 1;
  state: string;
  returnTo: string;
  bindDiscordAccount?: boolean;
  createdAt: number;
};

export function normalizeReturnTo(input: string | undefined | null) {
  const value = String(input ?? "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function setRsoOAuthStateCookie(
  response: NextResponse,
  payload: Omit<RsoOAuthStatePayload, "v" | "createdAt">,
  secure: boolean
) {
  response.cookies.set(
    RSO_OAUTH_STATE_COOKIE,
    sealPayload<RsoOAuthStatePayload>({
      v: 1,
      state: payload.state,
      returnTo: normalizeReturnTo(payload.returnTo),
      bindDiscordAccount: payload.bindDiscordAccount === true,
      createdAt: Date.now(),
    }),
    baseCookieOptions(secure, SHORT_STATE_MAX_AGE)
  );
}

export function clearRsoOAuthStateCookie(response: NextResponse) {
  response.cookies.set(RSO_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
}

export function readRsoOAuthStateCookieValue(token: string | undefined | null) {
  const payload = unsealPayload<RsoOAuthStatePayload>(token);
  if (!payload?.state || payload.v !== 1) return null;
  if (Date.now() - payload.createdAt > SHORT_STATE_MAX_AGE * 1000) return null;
  return payload;
}

/* ------------------------------------------------------------------ */
/*  RSO session cookie                                                */
/* ------------------------------------------------------------------ */

type RsoSignedSessionPayload = {
  v: 1;
  puuid: string;
  issuedAt: number;
};

export type RsoViewerSession = {
  puuid: string;
  playerId: string;
  gameName: string;
  tagLine: string;
};

export function setRsoSessionCookie(
  response: NextResponse,
  payload: { puuid: string },
  secure: boolean
) {
  response.cookies.set(
    RSO_SESSION_COOKIE,
    sealPayload<RsoSignedSessionPayload>({
      v: 1,
      puuid: payload.puuid,
      issuedAt: Date.now(),
    }),
    baseCookieOptions(secure, SESSION_MAX_AGE)
  );
}

export function clearRsoSessionCookie(response: NextResponse) {
  response.cookies.set(RSO_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

async function loadRsoSessionFromCookieValue(
  token: string | undefined | null
): Promise<RsoViewerSession | null> {
  const payload = unsealPayload<RsoSignedSessionPayload>(token);
  if (!payload?.puuid || payload.v !== 1) return null;

  // Lazy import to avoid circular deps
  const { dbConnect } = await import("@/lib/mongodb");
  const { Player } = await import("@/models/player");

  await dbConnect();
  const player = await Player.findOne(
    { puuid: payload.puuid },
    { _id: 1, gameName: 1, tagLine: 1 }
  ).lean();

  if (!player?._id) return null;

  return {
    puuid: payload.puuid,
    playerId: String(player._id),
    gameName: player.gameName,
    tagLine: player.tagLine,
  };
}

export async function getOptionalRsoSession(): Promise<RsoViewerSession | null> {
  const store = await cookies();
  return loadRsoSessionFromCookieValue(store.get(RSO_SESSION_COOKIE)?.value);
}

export async function requireRsoSession(): Promise<RsoViewerSession> {
  const session = await getOptionalRsoSession();
  if (!session) throw new Error("Sign in with your Riot account first.");
  return session;
}

export async function getOptionalRsoSessionFromRequest(
  req: NextRequest
): Promise<RsoViewerSession | null> {
  return loadRsoSessionFromCookieValue(req.cookies.get(RSO_SESSION_COOKIE)?.value);
}

export async function requireRsoSessionFromRequest(
  req: NextRequest
): Promise<RsoViewerSession> {
  const session = await getOptionalRsoSessionFromRequest(req);
  if (!session) throw new Error("Sign in with your Riot account first.");
  return session;
}
