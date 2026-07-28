import type { NextRequest } from "next/server";

export function normalizeOAuthReturnTo(
  input: string | undefined | null,
  fallback: string
) {
  const value = String(input ?? "").trim();
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://riftboard.invalid/");
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

export function oauthRequestOrigin(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))
    ?.split(",")[0]
    ?.trim();
  const protocol = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol)
    .split(",")[0]
    .trim()
    .replace(/:$/, "");

  if (!host || (protocol !== "http" && protocol !== "https")) {
    return req.nextUrl.origin;
  }

  return new URL(`${protocol}://${host}`).origin;
}

export function oauthProviderErrorMessage(
  provider: "Discord" | "Riot",
  error: string | undefined | null,
  description?: string | null
) {
  const code =
    String(error ?? "")
      .trim()
      .replace(/[^a-z0-9_.-]/gi, "")
      .slice(0, 80) || "unknown_error";
  const detail = String(description ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);

  if (code.toLowerCase() === "access_denied") {
    return `${provider} authorization was cancelled. Nothing was linked.`;
  }

  return detail
    ? `${provider} authorization failed (${code}): ${detail}`
    : `${provider} authorization failed (${code}).`;
}
