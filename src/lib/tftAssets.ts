type CDragonUnit = {
  name?: string;
  character_record?: {
    character_id?: string;
    display_name?: string;
    rarity?: number;
    squareIconPath?: string;
  };
};

type CDragonTrait = {
  display_name?: string;
  trait_id?: string;
  icon_path?: string;
};

type CDragonItem = {
  name?: string;
  nameId?: string;
  squareIconPath?: string;
};

export type TftHydratedMatch = {
  augments: Array<string | { id: string; displayName: string; iconUrl: string | null }>;
  traits: Array<{
    name?: string | null;
    numUnits?: number | null;
    style?: number | null;
    tierCurrent?: number | null;
    tierTotal?: number | null;
    displayName?: string | null;
    iconUrl?: string | null;
  }>;
  units: Array<{
    characterId?: string | null;
    name?: string | null;
    rarity?: number | null;
    tier?: number | null;
    itemNames?: string[];
    displayName?: string | null;
    iconUrl?: string | null;
    itemIcons?: Array<{ id: string; displayName: string; iconUrl: string | null }>;
  }>;
  participants?: Array<{
    puuid?: string | null;
    riotIdGameName?: string | null;
    riotIdTagline?: string | null;
    placement?: number | null;
    level?: number | null;
    lastRound?: number | null;
    playersEliminated?: number | null;
    totalDamageToPlayers?: number | null;
    goldLeft?: number | null;
    augments: Array<string | { id: string; displayName: string; iconUrl: string | null }>;
    traits: TftHydratedMatch["traits"];
    units: TftHydratedMatch["units"];
  }>;
};

const CDRAGON_BASE = "https://raw.communitydragon.org/latest";
const GAME_DATA_BASE = `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default`;
const JSON_BASE = `${GAME_DATA_BASE}/v1`;

let cachedIndex: Promise<{
  units: Map<string, { displayName: string; iconUrl: string | null; rarity: number | null }>;
  traits: Map<string, { displayName: string; iconUrl: string | null }>;
  items: Map<string, { displayName: string; iconUrl: string | null }>;
}> | null = null;

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function labelFromId(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/^TFT\d+_/i, "")
    .replace(/^Set\d+_/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cdragonAssetUrl(path: unknown) {
  const raw = String(path ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const gameDataPrefix = "/lol-game-data/assets/";
  if (raw.toLowerCase().startsWith(gameDataPrefix)) {
    return `${GAME_DATA_BASE}/${raw.slice(gameDataPrefix.length).toLowerCase()}`;
  }
  return `${CDRAGON_BASE}/${raw.replace(/^\/+/, "").toLowerCase()}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { next: { revalidate: 60 * 60 * 24 } });
  if (!response.ok) throw new Error(`Failed to load TFT assets (${response.status})`);
  return response.json() as Promise<T>;
}

function addAlias<T>(map: Map<string, T>, key: unknown, value: T) {
  const normalized = normalizeKey(key);
  if (normalized && !map.has(normalized)) map.set(normalized, value);
}

async function buildIndex() {
  const [champions, traits, items] = await Promise.all([
    fetchJson<CDragonUnit[]>(`${JSON_BASE}/tftchampions.json`),
    fetchJson<CDragonTrait[]>(`${JSON_BASE}/tfttraits.json`),
    fetchJson<CDragonItem[]>(`${JSON_BASE}/tftitems.json`),
  ]);

  const unitMap = new Map<string, { displayName: string; iconUrl: string | null; rarity: number | null }>();
  const traitMap = new Map<string, { displayName: string; iconUrl: string | null }>();
  const itemMap = new Map<string, { displayName: string; iconUrl: string | null }>();

  for (const champion of Array.isArray(champions) ? champions : []) {
    const record = champion.character_record ?? {};
    const displayName = String(record.display_name ?? labelFromId(record.character_id ?? champion.name) ?? "").trim();
    if (!displayName) continue;
    const value = {
      displayName,
      iconUrl: cdragonAssetUrl(record.squareIconPath),
      rarity: typeof record.rarity === "number" ? record.rarity : null,
    };
    addAlias(unitMap, champion.name, value);
    addAlias(unitMap, record.character_id, value);
    addAlias(unitMap, displayName, value);
  }

  for (const trait of Array.isArray(traits) ? traits : []) {
    const displayName = String(trait.display_name ?? labelFromId(trait.trait_id) ?? "").trim();
    if (!displayName) continue;
    const value = { displayName, iconUrl: cdragonAssetUrl(trait.icon_path) };
    addAlias(traitMap, trait.trait_id, value);
    addAlias(traitMap, displayName, value);
  }

  for (const item of Array.isArray(items) ? items : []) {
    const displayName = String(item.name ?? labelFromId(item.nameId) ?? "").trim();
    if (!displayName) continue;
    const value = { displayName, iconUrl: cdragonAssetUrl(item.squareIconPath) };
    addAlias(itemMap, item.nameId, value);
    addAlias(itemMap, item.name, value);
    addAlias(itemMap, displayName, value);
  }

  return { units: unitMap, traits: traitMap, items: itemMap };
}

async function getTftAssetIndex() {
  cachedIndex ??= buildIndex();
  return cachedIndex;
}

type HydratableTftBoard = { augments?: unknown[]; traits?: unknown[]; units?: unknown[] };

function hydrateBoard<T extends HydratableTftBoard>(
  board: T,
  index: Awaited<ReturnType<typeof getTftAssetIndex>>
): T & Pick<TftHydratedMatch, "augments" | "traits" | "units"> {
  return {
    ...board,
    augments: Array.isArray(board.augments)
      ? board.augments
          .filter((augment): augment is string => typeof augment === "string")
          .map((augment) => {
            const asset = index.items.get(normalizeKey(augment));
            return {
              id: augment,
              displayName: asset?.displayName ?? labelFromId(augment),
              iconUrl: asset?.iconUrl ?? null,
            };
          })
      : [],
    traits: Array.isArray(board.traits)
      ? board.traits.map((trait) => {
          const row = trait && typeof trait === "object" ? (trait as TftHydratedMatch["traits"][number]) : {};
          const asset = index.traits.get(normalizeKey(row.name));
          return {
            ...row,
            displayName: asset?.displayName ?? labelFromId(row.name),
            iconUrl: asset?.iconUrl ?? null,
          };
        })
      : [],
    units: Array.isArray(board.units)
      ? board.units.map((unit) => {
          const row = unit && typeof unit === "object" ? (unit as TftHydratedMatch["units"][number]) : {};
          const asset = index.units.get(normalizeKey(row.characterId)) ?? index.units.get(normalizeKey(row.name));
          return {
            ...row,
            displayName: asset?.displayName ?? labelFromId(row.characterId ?? row.name),
            iconUrl: asset?.iconUrl ?? null,
            rarity: row.rarity ?? asset?.rarity ?? null,
            itemIcons: Array.isArray(row.itemNames)
              ? row.itemNames.map((itemName) => {
                  const item = index.items.get(normalizeKey(itemName));
                  return {
                    id: itemName,
                    displayName: item?.displayName ?? labelFromId(itemName),
                    iconUrl: item?.iconUrl ?? null,
                  };
                })
              : [],
          };
        })
      : [],
  };
}

export async function hydrateTftMatches<T extends HydratableTftBoard & { participants?: HydratableTftBoard[] }>(
  matches: T[]
): Promise<Array<T & TftHydratedMatch>> {
  let index: Awaited<ReturnType<typeof getTftAssetIndex>>;
  try {
    index = await getTftAssetIndex();
  } catch (error) {
    console.warn("Failed to hydrate TFT assets:", error);
    return matches.map((match) => ({
      ...match,
      augments: Array.isArray(match.augments) ? (match.augments as string[]) : [],
      traits: Array.isArray(match.traits) ? (match.traits as TftHydratedMatch["traits"]) : [],
      units: Array.isArray(match.units) ? (match.units as TftHydratedMatch["units"]) : [],
      participants: Array.isArray(match.participants)
        ? match.participants.map((participant) => ({
            ...participant,
            augments: Array.isArray(participant.augments) ? (participant.augments as string[]) : [],
            traits: Array.isArray(participant.traits) ? (participant.traits as TftHydratedMatch["traits"]) : [],
            units: Array.isArray(participant.units) ? (participant.units as TftHydratedMatch["units"]) : [],
          }))
        : undefined,
    })) as Array<T & TftHydratedMatch>;
  }

  return matches.map((match) => {
    const hydrated = hydrateBoard(match, index);
    return {
      ...hydrated,
      participants: Array.isArray(match.participants)
        ? match.participants.map((participant) => hydrateBoard(participant, index))
        : undefined,
    };
  }) as Array<T & TftHydratedMatch>;
}
