import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSecret } from "@/lib/runtimeConfig";

const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_SESSION_MAX_AGE = 60 * 60 * 12;

type AdminSessionPayload = {
  v: 1;
  authorized: true;
  issuedAt: number;
};

function sessionSecret() {
  const secret = getAdminSecret();
  if (!secret) throw new Error("Missing env: ADMIN_SECRET");
  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function sealPayload(payload: AdminSessionPayload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

function unsealPayload(token: string | undefined | null) {
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
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSessionPayload;
    if (payload.v !== 1 || payload.authorized !== true) return null;
    return payload;
  } catch {
    return null;
  }
}

function baseCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE,
  };
}

function toBuffer(value: string) {
  return Buffer.from(value, "utf8");
}

export function isValidAdminCode(candidate: string | undefined | null) {
  const adminSecret = getAdminSecret();
  const provided = String(candidate ?? "").trim();
  if (!adminSecret || !provided) return false;

  const left = toBuffer(provided);
  const right = toBuffer(adminSecret);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isSecureRequest(req: NextRequest) {
  return req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

export function setAdminSessionCookie(response: NextResponse, secure: boolean) {
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    sealPayload({
      v: 1,
      authorized: true,
      issuedAt: Date.now(),
    }),
    baseCookieOptions(secure)
  );
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

export function hasAdminSessionFromRequest(req: NextRequest) {
  return !!unsealPayload(req.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function getOptionalAdminSession() {
  const store = await cookies();
  return unsealPayload(store.get(ADMIN_SESSION_COOKIE)?.value);
}
