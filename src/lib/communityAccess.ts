import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { DiscordLink } from "@/models/discordLink";
import { getCommunityJoinCodes, isCommunityCodeRequired } from "@/lib/runtimeConfig";

const COMMUNITY_ACCESS_COOKIE = "community_access";
const COMMUNITY_ACCESS_MAX_AGE = 60 * 60 * 24 * 30;

type CommunityAccessPayload = {
  v: 1;
  codeHash: string;
  grantedAt: number;
};

type StoredCommunityAccessRecord = {
  communityAccessCodeHash?: string | null;
};

function firstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function signingSecret() {
  const secret = firstNonEmpty([
    process.env.APP_SESSION_SECRET,
    process.env.DISCORD_CLIENT_SECRET,
  ]);
  if (!secret) throw new Error("Missing env: APP_SESSION_SECRET");
  return secret;
}

function communityCodeHash() {
  const codes = getCommunityJoinCodes();
  return crypto.createHash("sha256").update(codes.join("|")).digest("hex");
}

export function currentCommunityCodeHash() {
  return communityCodeHash();
}

function sign(body: string) {
  return crypto.createHmac("sha256", signingSecret()).update(body).digest("base64url");
}

function sealPayload(payload: CommunityAccessPayload) {
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
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CommunityAccessPayload;
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
    maxAge: COMMUNITY_ACCESS_MAX_AGE,
  };
}

export function setCommunityAccessCookie(response: NextResponse, secure: boolean) {
  response.cookies.set(
    COMMUNITY_ACCESS_COOKIE,
    sealPayload({
      v: 1,
      codeHash: communityCodeHash(),
      grantedAt: Date.now(),
    }),
    baseCookieOptions(secure)
  );
}

export function clearCommunityAccessCookie(response: NextResponse) {
  response.cookies.set(COMMUNITY_ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
}

export function hasCommunityAccessCookieValue(token: string | undefined | null) {
  if (!isCommunityCodeRequired()) return true;
  const payload = unsealPayload(token);
  return payload?.v === 1 && payload.codeHash === communityCodeHash();
}

export function hasStoredCommunityAccessRecord(record: StoredCommunityAccessRecord | null | undefined) {
  if (!isCommunityCodeRequired()) return true;
  return String(record?.communityAccessCodeHash ?? "").trim() === communityCodeHash();
}

export async function hasCommunityAccess() {
  if (!isCommunityCodeRequired()) return true;
  const store = await cookies();
  return hasCommunityAccessCookieValue(store.get(COMMUNITY_ACCESS_COOKIE)?.value);
}

export function hasCommunityAccessFromRequest(req: NextRequest) {
  if (!isCommunityCodeRequired()) return true;
  return hasCommunityAccessCookieValue(req.cookies.get(COMMUNITY_ACCESS_COOKIE)?.value);
}

export async function hasStoredCommunityAccessForDiscordUser(discordUserId: string) {
  if (!isCommunityCodeRequired()) return true;

  await dbConnect();
  const link = await DiscordLink.findOne(
    { discordUserId: String(discordUserId).trim() },
    { communityAccessCodeHash: 1 }
  ).lean<StoredCommunityAccessRecord | null>();

  return hasStoredCommunityAccessRecord(link);
}

export async function grantStoredCommunityAccessForDiscordUser(discordUserId: string) {
  if (!isCommunityCodeRequired()) return true;

  await dbConnect();
  const updated = await DiscordLink.findOneAndUpdate(
    { discordUserId: String(discordUserId).trim() },
    {
      $set: {
        communityAccessCodeHash: communityCodeHash(),
        communityAccessGrantedAt: new Date(),
      },
    },
    { new: true, projection: { _id: 1 } }
  ).lean<{ _id?: unknown } | null>();

  return !!updated?._id;
}
