import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { loadVerifiedDiscordIdentity, type DiscordRiotCandidate } from "@/lib/discordLinkedRoles";
import { decryptDiscordSecret, encryptDiscordSecret } from "@/lib/discord";

const DISCORD_SESSION_COOKIE = "discord_session";
const DISCORD_OAUTH_STATE_COOKIE = "discord_oauth_state";
const DISCORD_PENDING_BIND_COOKIE = "discord_pending_bind";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const SHORT_STATE_MAX_AGE = 60 * 10;

type SignedSessionPayload = {
  v: 1;
  discordUserId: string;
  issuedAt: number;
};

export type DiscordViewerSession = {
  discordUserId: string;
  discordUsername: string | null;
  playerId: string;
  gameName: string;
  tagLine: string;
  linkId: string;
};

export type DiscordOAuthStatePayload = {
  v: 1;
  state: string;
  returnTo: string;
  createdAt: number;
};

export type PendingDiscordBindPayload = {
  v: 1;
  discordUserId: string;
  discordUsername: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt: string | null;
  candidates: DiscordRiotCandidate[];
  returnTo: string;
  createdAt: number;
};

function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

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

export function normalizeReturnTo(input: string | undefined | null) {
  const value = String(input ?? "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/discord/linked-roles";
  }
  return value;
}

export function setDiscordSessionCookie(
  response: NextResponse,
  payload: Omit<SignedSessionPayload, "v" | "issuedAt">,
  secure: boolean
) {
  response.cookies.set(
    DISCORD_SESSION_COOKIE,
    sealPayload<SignedSessionPayload>({
      v: 1,
      discordUserId: payload.discordUserId,
      issuedAt: Date.now(),
    }),
    baseCookieOptions(secure, SESSION_MAX_AGE)
  );
}

export function clearDiscordSessionCookie(response: NextResponse) {
  response.cookies.set(DISCORD_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

export function setDiscordOAuthStateCookie(
  response: NextResponse,
  payload: Omit<DiscordOAuthStatePayload, "v" | "createdAt">,
  secure: boolean
) {
  response.cookies.set(
    DISCORD_OAUTH_STATE_COOKIE,
    sealPayload<DiscordOAuthStatePayload>({
      v: 1,
      state: payload.state,
      returnTo: normalizeReturnTo(payload.returnTo),
      createdAt: Date.now(),
    }),
    baseCookieOptions(secure, SHORT_STATE_MAX_AGE)
  );
}

export function clearDiscordOAuthStateCookie(response: NextResponse) {
  response.cookies.set(DISCORD_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
}

export function readDiscordOAuthStateCookieValue(token: string | undefined | null) {
  const payload = unsealPayload<DiscordOAuthStatePayload>(token);
  if (!payload?.state || payload.v !== 1) return null;
  if (Date.now() - payload.createdAt > SHORT_STATE_MAX_AGE * 1000) return null;
  return payload;
}

export function setPendingDiscordBindCookie(
  response: NextResponse,
  payload: Omit<PendingDiscordBindPayload, "v" | "createdAt">,
  secure: boolean
) {
  response.cookies.set(
    DISCORD_PENDING_BIND_COOKIE,
    sealPayload<PendingDiscordBindPayload>({
      ...payload,
      v: 1,
      returnTo: normalizeReturnTo(payload.returnTo),
      createdAt: Date.now(),
    }),
    baseCookieOptions(secure, SHORT_STATE_MAX_AGE)
  );
}

export function clearPendingDiscordBindCookie(response: NextResponse) {
  response.cookies.set(DISCORD_PENDING_BIND_COOKIE, "", { path: "/", maxAge: 0 });
}

export function makePendingDiscordBindPayload(input: {
  discordUserId: string;
  discordUsername: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenType: string;
  scopes: string[];
  expiresAt?: Date | null;
  candidates: DiscordRiotCandidate[];
  returnTo?: string | null;
}) {
  return {
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    accessTokenEnc: encryptDiscordSecret(input.accessToken),
    refreshTokenEnc: input.refreshToken ? encryptDiscordSecret(input.refreshToken) : null,
    tokenType: input.tokenType,
    scopes: input.scopes,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    candidates: input.candidates,
    returnTo: normalizeReturnTo(input.returnTo),
  };
}

export function readPendingDiscordBindCookieValue(token: string | undefined | null) {
  const payload = unsealPayload<PendingDiscordBindPayload>(token);
  if (!payload?.discordUserId || payload.v !== 1) return null;
  if (Date.now() - payload.createdAt > SHORT_STATE_MAX_AGE * 1000) return null;
  if (!Array.isArray(payload.candidates) || !payload.candidates.length) return null;
  return payload;
}

export function decodePendingDiscordTokenPayload(payload: PendingDiscordBindPayload) {
  return {
    accessToken: decryptDiscordSecret(payload.accessTokenEnc),
    refreshToken: payload.refreshTokenEnc ? decryptDiscordSecret(payload.refreshTokenEnc) : null,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
  };
}

async function loadDiscordViewerSessionFromCookieValue(token: string | undefined | null) {
  const payload = unsealPayload<SignedSessionPayload>(token);
  if (!payload?.discordUserId || payload.v !== 1) return null;

  try {
    const identity = await loadVerifiedDiscordIdentity(payload.discordUserId);
    return {
      discordUserId: String(identity.link.discordUserId),
      discordUsername: identity.link.discordUsername ?? null,
      playerId: String(identity.link.playerId),
      gameName: identity.player.gameName,
      tagLine: identity.player.tagLine,
      linkId: String(identity.link._id),
    } satisfies DiscordViewerSession;
  } catch {
    return null;
  }
}

export async function getOptionalDiscordSession() {
  const store = await cookies();
  return loadDiscordViewerSessionFromCookieValue(store.get(DISCORD_SESSION_COOKIE)?.value);
}

export async function requireDiscordSession() {
  const session = await getOptionalDiscordSession();
  if (!session) throw new Error("Connect Discord and verify your Riot account first.");
  return session;
}

export async function getOptionalDiscordSessionFromRequest(req: NextRequest) {
  return loadDiscordViewerSessionFromCookieValue(req.cookies.get(DISCORD_SESSION_COOKIE)?.value);
}

export async function requireDiscordSessionFromRequest(req: NextRequest) {
  const session = await getOptionalDiscordSessionFromRequest(req);
  if (!session) throw new Error("Connect Discord and verify your Riot account first.");
  return session;
}
