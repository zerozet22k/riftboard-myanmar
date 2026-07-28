import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  type DiscordRiotCandidate,
} from "@/lib/discordLinkedRoles";
import {
  loadStoredDiscordAccount,
  loadVerifiedDiscordAccount,
} from "@/lib/discordAccountStore";
import { findPrimaryDiscordLink } from "@/lib/discordLinkStore";
import { decryptDiscordSecret, encryptDiscordSecret } from "@/lib/discord";
import { normalizeOAuthReturnTo } from "@/lib/oauthRequest";
import { Player } from "@/models/player";

const SECURE_DISCORD_SESSION_COOKIE = "__Host-riftboard_session";
const LOCAL_DISCORD_SESSION_COOKIE = "riftboard_session";
const LEGACY_DISCORD_SESSION_COOKIE = "discord_session";
const DISCORD_OAUTH_STATE_COOKIE = "discord_oauth_state";
const DISCORD_PENDING_BIND_COOKIE = "discord_pending_bind";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const SHORT_STATE_MAX_AGE = 60 * 10;
const LOGIN_COMPLETION_MAX_AGE = 60 * 2;

type SignedSessionPayload = {
  v: 1;
  discordUserId: string;
  issuedAt: number;
};

type DiscordLoginCompletionPayload = {
  v: 1;
  discordUserId: string;
  oauthState: string;
  returnTo: string;
  createdAt: number;
};

export type DiscordViewerSession = {
  discordUserId: string;
  discordUsername: string | null;
  playerId: string | null;
  gameName: string | null;
  tagLine: string | null;
  linkId: string | null;
};

export type DiscordLinkedSession = Omit<
  DiscordViewerSession,
  "playerId" | "gameName" | "tagLine" | "linkId"
> & {
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

export type DiscordSessionLoadOptions = {
  verifyGuildMembership?: boolean;
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

export function discordSessionCookieIsSecure(req: NextRequest) {
  const forwardedProtocol = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .replace(/:$/, "");
  return (
    req.nextUrl.protocol === "https:" ||
    forwardedProtocol === "https"
  );
}

export function normalizeReturnTo(input: string | undefined | null) {
  return normalizeOAuthReturnTo(input, "/discord/linked-roles");
}

export function setDiscordSessionCookie(
  response: NextResponse,
  payload: Omit<SignedSessionPayload, "v" | "issuedAt">,
  secure: boolean
) {
  const cookieName = secure
    ? SECURE_DISCORD_SESSION_COOKIE
    : LOCAL_DISCORD_SESSION_COOKIE;
  response.cookies.set(
    cookieName,
    sealPayload<SignedSessionPayload>({
      v: 1,
      discordUserId: payload.discordUserId,
      issuedAt: Date.now(),
    }),
    baseCookieOptions(secure, SESSION_MAX_AGE)
  );

  for (const staleName of [
    LEGACY_DISCORD_SESSION_COOKIE,
    secure ? LOCAL_DISCORD_SESSION_COOKIE : SECURE_DISCORD_SESSION_COOKIE,
  ]) {
    response.cookies.set(staleName, "", {
      httpOnly: true,
      secure: staleName === SECURE_DISCORD_SESSION_COOKIE,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

export function clearDiscordSessionCookie(response: NextResponse) {
  for (const cookieName of [
    SECURE_DISCORD_SESSION_COOKIE,
    LOCAL_DISCORD_SESSION_COOKIE,
    LEGACY_DISCORD_SESSION_COOKIE,
  ]) {
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: cookieName === SECURE_DISCORD_SESSION_COOKIE,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

export function makeDiscordLoginCompletionTicket(input: {
  discordUserId: string;
  oauthState: string;
  returnTo?: string | null;
}) {
  return sealPayload<DiscordLoginCompletionPayload>({
    v: 1,
    discordUserId: String(input.discordUserId ?? "").trim(),
    oauthState: String(input.oauthState ?? "").trim(),
    returnTo: normalizeReturnTo(input.returnTo),
    createdAt: Date.now(),
  });
}

export function readDiscordLoginCompletionTicketValue(
  token: string | undefined | null
) {
  const payload = unsealPayload<DiscordLoginCompletionPayload>(token);
  if (!payload?.discordUserId || !payload.oauthState || payload.v !== 1) {
    return null;
  }
  const createdAt = Number(payload.createdAt);
  if (
    !Number.isFinite(createdAt) ||
    createdAt <= 0 ||
    createdAt > Date.now() + 60_000 ||
    Date.now() - createdAt > LOGIN_COMPLETION_MAX_AGE * 1000
  ) {
    return null;
  }
  return {
    ...payload,
    returnTo: normalizeReturnTo(payload.returnTo),
  };
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
  if (!Array.isArray(payload.candidates)) return null;
  return payload;
}

export function decodePendingDiscordTokenPayload(payload: PendingDiscordBindPayload) {
  return {
    accessToken: decryptDiscordSecret(payload.accessTokenEnc),
    refreshToken: payload.refreshTokenEnc ? decryptDiscordSecret(payload.refreshTokenEnc) : null,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
  };
}

async function loadDiscordViewerSessionFromCookieValue(
  token: string | undefined | null,
  options?: DiscordSessionLoadOptions
) {
  const payload = unsealPayload<SignedSessionPayload>(token);
  if (!payload?.discordUserId || payload.v !== 1) return null;
  const issuedAt = Number(payload.issuedAt);
  if (
    !Number.isFinite(issuedAt) ||
    issuedAt <= 0 ||
    issuedAt > Date.now() + 60_000 ||
    Date.now() - issuedAt > SESSION_MAX_AGE * 1000
  ) {
    return null;
  }

  let account;
  try {
    account = options?.verifyGuildMembership
      ? (await loadVerifiedDiscordAccount(payload.discordUserId)).account
      : await loadStoredDiscordAccount(payload.discordUserId);
  } catch (error) {
    console.warn(
      "[discord/session] Discord account restore failed",
      error instanceof Error ? error.name : "UnknownError"
    );
    return null;
  }

  const ownerSession = {
    discordUserId: String(account.discordUserId),
    discordUsername: account.discordUsername ?? null,
    playerId: null,
    gameName: null,
    tagLine: null,
    linkId: null,
  } satisfies DiscordViewerSession;

  try {
    const link = await findPrimaryDiscordLink(payload.discordUserId);
    const player = link?._id
      ? await Player.findById(
          link.playerId,
          { gameName: 1, tagLine: 1 }
        ).lean<{ _id: unknown; gameName: string; tagLine: string } | null>()
      : null;

    return {
      ...ownerSession,
      discordUsername: account.discordUsername ?? link?.discordUsername ?? null,
      playerId: player?._id ? String(player._id) : null,
      gameName: player?.gameName ?? null,
      tagLine: player?.tagLine ?? null,
      linkId: player?._id && link?._id ? String(link._id) : null,
    } satisfies DiscordViewerSession;
  } catch (error) {
    console.warn(
      "[discord/session] Optional Riot account restore failed",
      error instanceof Error ? error.name : "UnknownError"
    );
    return ownerSession;
  }
}

async function loadDiscordViewerSessionFromCookieValues(
  tokens: Array<string | undefined | null>,
  options?: DiscordSessionLoadOptions
) {
  const uniqueTokens = [...new Set(tokens.filter((token): token is string => Boolean(token)))];
  for (const token of uniqueTokens) {
    const session = await loadDiscordViewerSessionFromCookieValue(token, options);
    if (session) return session;
  }
  return null;
}

function discordSessionCookieValues(
  readCookie: (name: string) => string | undefined
) {
  return [
    readCookie(SECURE_DISCORD_SESSION_COOKIE),
    readCookie(LOCAL_DISCORD_SESSION_COOKIE),
    readCookie(LEGACY_DISCORD_SESSION_COOKIE),
  ];
}

function asLinkedDiscordSession(
  session: DiscordViewerSession | null
): DiscordLinkedSession | null {
  if (
    !session?.playerId ||
    !session.gameName ||
    !session.tagLine ||
    !session.linkId
  ) {
    return null;
  }
  return session as DiscordLinkedSession;
}

export async function getOptionalDiscordSession() {
  const store = await cookies();
  return loadDiscordViewerSessionFromCookieValues(
    discordSessionCookieValues((name) => store.get(name)?.value)
  );
}

export async function requireDiscordSession(): Promise<DiscordLinkedSession> {
  const store = await cookies();
  const session = asLinkedDiscordSession(
    await loadDiscordViewerSessionFromCookieValues(
      discordSessionCookieValues((name) => store.get(name)?.value),
      { verifyGuildMembership: true }
    )
  );
  if (!session) throw new Error("Connect Discord and a Riot account first.");
  return session;
}

export async function getOptionalDiscordSessionFromRequest(
  req: NextRequest,
  options?: DiscordSessionLoadOptions
) {
  return loadDiscordViewerSessionFromCookieValues(
    discordSessionCookieValues((name) => req.cookies.get(name)?.value),
    options
  );
}

export async function requireDiscordSessionFromRequest(
  req: NextRequest
): Promise<DiscordLinkedSession> {
  const session = asLinkedDiscordSession(
    await getOptionalDiscordSessionFromRequest(req, {
      verifyGuildMembership: true,
    })
  );
  if (!session) throw new Error("Connect Discord and a Riot account first.");
  return session;
}
