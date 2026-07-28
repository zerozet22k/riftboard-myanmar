import dns from "node:dns";
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing env MONGODB_URI");

function mongoDnsServers() {
  const configuredServers = String(process.env.MONGODB_DNS_SERVERS ?? "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  return configuredServers.length ? configuredServers : ["1.1.1.1", "8.8.8.8"];
}

if (
  MONGODB_URI.startsWith("mongodb+srv://") &&
  dns.getServers().every((server) => server === "127.0.0.1" || server === "::1")
) {
  dns.setServers(mongoDnsServers());
}

type Cached = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  dnsFallbackApplied?: boolean;
};
const g = globalThis as unknown as { __mongo?: Cached };

const cached: Cached = g.__mongo ?? { conn: null, promise: null };
g.__mongo = cached;

function clearFailedConnection() {
  cached.conn = null;
  cached.promise = null;
}

function isSrvDnsFailure(error: unknown) {
  if (!MONGODB_URI?.startsWith("mongodb+srv://")) return false;
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const syscall = "syscall" in error ? String((error as { syscall?: unknown }).syscall ?? "") : "";
  return /^(?:ECONNREFUSED|ETIMEOUT|ENOTFOUND|ESERVFAIL|EREFUSED)$/.test(code) ||
    /^query(?:Srv|Txt)$/i.test(syscall);
}

function startConnection() {
  return mongoose.connect(MONGODB_URI!, {
    autoIndex: process.env.NODE_ENV !== "production",
  });
}

export async function dbConnect() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = startConnection();
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    // A transient DNS/network failure must not poison the process forever.
    clearFailedConnection();

    if (isSrvDnsFailure(error) && !cached.dnsFallbackApplied) {
      cached.dnsFallbackApplied = true;
      dns.setServers(mongoDnsServers());
      cached.promise = startConnection();

      try {
        cached.conn = await cached.promise;
        return cached.conn;
      } catch (retryError) {
        clearFailedConnection();
        throw retryError;
      }
    }

    throw error;
  }
}
