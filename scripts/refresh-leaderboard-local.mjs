const baseUrl = process.env.LOCAL_APP_URL?.trim() || "http://127.0.0.1:3000";
const route = new URL("/api/cron/leaderboard", baseUrl);

for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith("--")) continue;

  const eq = arg.indexOf("=");
  const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
  const value = eq >= 0 ? arg.slice(eq + 1) : "1";

  if (key) route.searchParams.set(key, value);
}

const token = process.env.CRON_SECRET?.trim() || process.env.CRON_KEY?.trim() || "";
const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

async function main() {
  try {
    const res = await fetch(route, { headers, cache: "no-store" });
    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json?.ok) {
      const reason = json?.error ? `: ${json.error}` : "";
      throw new Error(`Refresh failed (${res.status})${reason}`);
    }

    console.log(JSON.stringify(json, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error("Make sure your local Next app is running, for example with `npm run dev`.");
    process.exit(1);
  }
}

await main();
