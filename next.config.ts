import dns from "node:dns";
import type { NextConfig } from "next";

const mongoUri = String(process.env.MONGODB_URI ?? "");
if (
  mongoUri.startsWith("mongodb+srv://") &&
  dns.getServers().every((server) => server === "127.0.0.1" || server === "::1")
) {
  const configuredServers = String(process.env.MONGODB_DNS_SERVERS ?? "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  dns.setServers(configuredServers.length ? configuredServers : ["1.1.1.1", "8.8.8.8"]);
}

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
