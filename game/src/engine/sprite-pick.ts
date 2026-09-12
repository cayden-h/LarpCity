// Which pre-rendered sprite goes on a lot. Pure (no Pixi), so it runs under
// Node's test runner; sprites.ts does the loading and drawing.

export interface SpriteEntry {
  id: string;
  w: number;
  d: number;
  floors: number;
  zones: string[];
  /** Branded hero sprites are placed once per city, before anything generic. */
  unique: boolean;
  brand: string | null;
  /** Pixel (in game px) of tile (0, 0)'s top corner inside the image. */
  ax: number;
  ay: number;
  /** Highest point above the ground, in game px. */
  topZ: number;
  day: string;
  night: string;
  /** Missing means "building"; landmarks and props are never placed on lots. */
  kind?: "building" | "landmark" | "prop";
  /** The landmark id this sprite draws, e.g. "sf-glass-tower". */
  landmark?: string;
  /** White where the LED crown is, transparent elsewhere; same size and anchor as `day`. */
  crown?: string;
  prop?: "shelter";
  /** Which tile edge a shelter stands on: "sy" toward y+1 (lower left), "sx" toward x+1 (lower right). */
  side?: "sy" | "sx";
}

export interface SpriteManifest {
  /** Images are rendered at this multiple of game pixels. */
  scale: number;
  sprites: SpriteEntry[];
}

export interface Lot {
  zone: string;
  w: number;
  d: number;
  /** How tall a generic sprite may be here (the zone's style). */
  maxFloors: number;
  /** Hard limit so landmarks stay visible (populate.ts sightlineCap). */
  cap: number;
  /** In the inner part of its own zone, where a branded building is seen; heroes go only here. */
  heroSpot: boolean;
}

const isBuilding = (s: SpriteEntry) => !s.kind || s.kind === "building";

/** Chance a branded sprite takes an ordinary lot in its zone, once the zone's hero spots are spoken for. */
const HERO_ELSEWHERE = 0.3;

export function pickSprite(m: SpriteManifest, lot: Lot, used: Set<string>, rng: () => number): SpriteEntry | null {
  const fits = m.sprites.filter((s) => isBuilding(s) && s.w === lot.w && s.d === lot.d && s.zones.includes(lot.zone) && s.floors <= lot.cap);
  // Branded sprites go on hero spots first; elsewhere in their zone now and then, so every brand finds a lot.
  const unplaced = fits.filter((s) => s.unique && !used.has(s.id));
  const heroes = lot.heroSpot || rng() < HERO_ELSEWHERE ? unplaced : [];
  const pool = heroes.length ? heroes : fits.filter((s) => !s.unique && s.floors <= lot.maxFloors);
  if (!pool.length) return null;
  const s = pool[Math.floor(rng() * pool.length)];
  if (s.unique) used.add(s.id);
  return s;
}

/** Where a sprite's top-left goes for a building on tile (x, y); matches iso() in iso.ts (32 x 16 px half-tile). */
export function spriteOrigin(e: SpriteEntry, x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * 32 - e.ax, y: (x + y) * 16 - e.ay };
}

/** The sprite that replaces a landmark's procedural model, or null to keep the model. */
export function findLandmark(m: SpriteManifest, landmarkId: string): SpriteEntry | null {
  return m.sprites.find((s) => s.kind === "landmark" && s.landmark === landmarkId) ?? null;
}

export interface ShelterSite {
  w: number;
  h: number;
  at: (x: number, y: number) => string;
  zone: (x: number, y: number) => string;
  /** Tiles a shelter must not take (landmark footprints, the home yard). */
  blocked: (x: number, y: number) => boolean;
}

// Muni stops line neighborhood streets as well as downtown ones.
const SHELTER_ZONES = ["downtown", "midtown", "residential"];
const SHELTER_GAP = 4;

/**
 * Muni bus shelters on open ground beside a street in the busy zones: one
 * facing the road below (y+1) or to the right (x+1), at least SHELTER_GAP
 * tiles apart. Grass and plazas come before parks, where trees crowd them.
 */
export function placeShelters(m: SpriteManifest, site: ShelterSite, rng: () => number, max = 8): { entry: SpriteEntry; x: number; y: number }[] {
  const bySide = {
    sy: m.sprites.filter((s) => s.kind === "prop" && s.prop === "shelter" && s.side === "sy"),
    sx: m.sprites.filter((s) => s.kind === "prop" && s.prop === "shelter" && s.side === "sx"),
  };
  if (!bySide.sy.length && !bySide.sx.length) return [];
  const road = (x: number, y: number) => site.at(x, y) === "=" || site.at(x, y) === "t";
  const spots: { x: number; y: number; side: "sy" | "sx"; key: number }[] = [];
  for (let y = 0; y < site.h; y++)
    for (let x = 0; x < site.w; x++) {
      const c = site.at(x, y);
      if ((c !== "." && c !== "p" && c !== "P") || site.blocked(x, y) || !SHELTER_ZONES.includes(site.zone(x, y))) continue;
      const side = road(x, y + 1) && bySide.sy.length ? "sy" : road(x + 1, y) && bySide.sx.length ? "sx" : null;
      if (side) spots.push({ x, y, side, key: rng() + (c === "p" ? 1 : 0) });
    }
  spots.sort((a, b) => a.key - b.key);
  const out: { entry: SpriteEntry; x: number; y: number }[] = [];
  for (const s of spots) {
    if (out.length >= max) break;
    if (out.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < SHELTER_GAP)) continue;
    const pool = bySide[s.side];
    out.push({ entry: pool[Math.floor(rng() * pool.length)], x: s.x, y: s.y });
  }
  return out;
}
