// src/lib/ddragon.ts
let _latest: string | null = null;
let _latestAt = 0;

export async function getLatestDdragonVersion(): Promise<string> {
  const now = Date.now();
  if (_latest && now - _latestAt < 24 * 60 * 60 * 1000) return _latest;

  const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", {
    // Next.js cache hint (safe)
    next: { revalidate: 24 * 60 * 60 },
  });

  if (!res.ok) throw new Error(`Failed to fetch ddragon versions (${res.status})`);
  const versions = (await res.json()) as string[];

  _latest = versions?.[0] ?? "latest";
  _latestAt = now;
  return _latest;
}
