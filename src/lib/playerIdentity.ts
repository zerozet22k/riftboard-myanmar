export type RiotIdLike = {
  gameName?: unknown;
  tagLine?: unknown;
};

export type RiotIdAliasEntry = {
  gameName: string;
  tagLine: string;
  gameNameNorm: string;
  tagLineNorm: string;
  observedAt: Date;
};

function cleanRiotIdPart(value: unknown) {
  return String(value ?? "").trim();
}

function coerceObservedAt(value: unknown, fallback: Date) {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function normalizeRiotIdPart(value: unknown) {
  return cleanRiotIdPart(value).toLowerCase();
}

export function makeRiotIdAlias(
  gameName: unknown,
  tagLine: unknown,
  observedAt = new Date()
): RiotIdAliasEntry | null {
  const cleanGameName = cleanRiotIdPart(gameName);
  const cleanTagLine = cleanRiotIdPart(tagLine);

  if (!cleanGameName || !cleanTagLine) return null;

  return {
    gameName: cleanGameName,
    tagLine: cleanTagLine,
    gameNameNorm: normalizeRiotIdPart(cleanGameName),
    tagLineNorm: normalizeRiotIdPart(cleanTagLine),
    observedAt: coerceObservedAt(observedAt, new Date()),
  };
}

export function sameRiotId(a: RiotIdLike | null | undefined, b: RiotIdLike | null | undefined) {
  return (
    normalizeRiotIdPart(a?.gameName) === normalizeRiotIdPart(b?.gameName) &&
    normalizeRiotIdPart(a?.tagLine) === normalizeRiotIdPart(b?.tagLine)
  );
}

export function canonicalPlayerPath(gameName: unknown, tagLine: unknown) {
  const cleanGameName = cleanRiotIdPart(gameName);
  const cleanTagLine = cleanRiotIdPart(tagLine).toLowerCase();
  return `/p/${encodeURIComponent(cleanGameName)}/${encodeURIComponent(cleanTagLine)}`;
}

export function buildPlayerLookupQuery(gameName: unknown, tagLine: unknown) {
  const gameNameNorm = normalizeRiotIdPart(gameName);
  const tagLineNorm = normalizeRiotIdPart(tagLine);

  return {
    $or: [
      { gameNameNorm, tagLineNorm },
      {
        "riotIdAliases.gameNameNorm": gameNameNorm,
        "riotIdAliases.tagLineNorm": tagLineNorm,
      },
    ],
  };
}

export function normalizeRiotIdAliases(
  aliases: unknown,
  canonical?: RiotIdLike | null
): RiotIdAliasEntry[] {
  const out: RiotIdAliasEntry[] = [];
  const seen = new Set<string>();
  const canonicalGameNameNorm = normalizeRiotIdPart(canonical?.gameName);
  const canonicalTagLineNorm = normalizeRiotIdPart(canonical?.tagLine);

  for (const item of Array.isArray(aliases) ? aliases : []) {
    const alias = makeRiotIdAlias(
      (item as RiotIdAliasEntry | null | undefined)?.gameName,
      (item as RiotIdAliasEntry | null | undefined)?.tagLine,
      (item as RiotIdAliasEntry | null | undefined)?.observedAt ?? new Date()
    );

    if (!alias) continue;

    if (
      alias.gameNameNorm === canonicalGameNameNorm &&
      alias.tagLineNorm === canonicalTagLineNorm
    ) {
      continue;
    }

    const key = `${alias.gameNameNorm}#${alias.tagLineNorm}`;
    if (seen.has(key)) continue;

    out.push(alias);
    seen.add(key);
  }

  return out;
}

export function syncCanonicalRiotId(
  target: { gameName?: unknown; tagLine?: unknown; riotIdAliases?: unknown },
  nextGameName: unknown,
  nextTagLine: unknown,
  observedAt = new Date()
) {
  const next = makeRiotIdAlias(nextGameName, nextTagLine, observedAt);
  if (!next) throw new Error("Missing Riot ID");

  const current = makeRiotIdAlias(target.gameName, target.tagLine, observedAt);
  const renamed = !!current && !sameRiotId(current, next);
  const aliases = Array.isArray(target.riotIdAliases) ? target.riotIdAliases : [];
  const merged = renamed && current ? [...aliases, current] : aliases;

  target.gameName = next.gameName;
  target.tagLine = next.tagLine;
  target.riotIdAliases = normalizeRiotIdAliases(merged, next);

  return { renamed, canonical: next };
}
