import type { HouseStyle } from "./types";

/** The side a house's front door faces: toward y+1 ("s"), x+1 ("e"), y-1 ("n"), or x-1 ("w"). */
export type Facing = "n" | "e" | "s" | "w";

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
  /** Missing means "building"; landmarks, props, and the player's homes are never placed on lots. */
  kind?: "building" | "landmark" | "prop" | "home";
  /** Houses: the side the front door faces. */
  facing?: Facing;
  /** Houses: the painted-walls layer the game tints; same size and anchor as `day`. */
  walls?: string;
  /** Houses: the style family, for coherent rows. */
  style?: HouseStyle;
  /** Home tiers (engine/hero.ts HOME_TIERS index). */
  tier?: number;
  /** The landmark id this sprite draws, e.g. "sf-glass-tower". */
  landmark?: string;
  /** White where the LED crown is, transparent elsewhere; same size and anchor as `day`. */
  crown?: string;
  /** Props the game places itself: Muni shelters beside streets, V boards beside the freeway. */
  prop?: "shelter" | "vboard";
  /** Branded buildings: the city area (CityDef.areas) whose lots it prefers. */
  area?: string;
  /** Which tile edge a shelter stands on: "sy" toward y+1 (lower left), "sx" toward x+1 (lower right). */
  side?: "sy" | "sx";
}

export interface SpriteManifest {
  /** Images are rendered at this multiple of game pixels. */
  scale: number;
  sprites: SpriteEntry[];
}

export interface Lot {
  /** House lots: the side the road is on. */
  facing?: Facing;
  /** House lots: the style family; matching houses are preferred, with legacy buildings as a fallback. */
  style?: HouseStyle;

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
  const fits = m.sprites.filter((s) =>
    isBuilding(s) && s.w === lot.w && s.d === lot.d && s.zones.includes(lot.zone) &&
    s.floors <= lot.cap && (!s.facing || s.facing === lot.facing));
  // Keep the legacy selection's random draws unchanged for unstyled lots.
  const allowHero = lot.heroSpot || rng() < HERO_ELSEWHERE;
  const poolFor = (entries: SpriteEntry[]) => {
    const heroes = allowHero ? entries.filter((s) => s.unique && !used.has(s.id)) : [];
    return heroes.length ? heroes : entries.filter((s) => !s.unique && s.floors <= lot.maxFloors);
  };
  const houses = lot.style ? poolFor(fits.filter((s) => s.style === lot.style)) : [];
  const pool = houses.length ? houses : poolFor(fits.filter((s) => !s.style));
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

export interface FreewaySite {
  w: number;
  h: number;
  /** Open ground a V board may stand on. */
  open: (x: number, y: number) => boolean;
  /** Highway pavement tiles. */
  highway: { x: number; y: number }[];
  /** Where the boards should be seen from: downtown's center. */
  target: { x: number; y: number };
}

const VBOARD_GAP = 6;

/**
 * The paved tiles of some roads: every whole tile within a tile of each path's centerline that the grid says is
 * road. Centerlines may lie on tile edges or through tile centers (fractional coordinates), and paths run on past
 * the grid's edge, so tiles come from floor and ceiling and are kept only when isRoad holds.
 */
export function roadTiles(roads: { path: [number, number][] }[], isRoad: (x: number, y: number) => boolean): { x: number; y: number }[] {
  const out = new Map<string, { x: number; y: number }>();
  const add = (x: number, y: number) => { if (isRoad(x, y)) out.set(`${x},${y}`, { x, y }); };
  for (const r of roads)
    for (let k = 1; k < r.path.length; k++) {
      const [[ax, ay], [bx, by]] = [r.path[k - 1], r.path[k]];
      const along = ay === by;
      const [c, lo, hi] = along ? [ay, Math.min(ax, bx), Math.max(ax, bx)] : [ax, Math.min(ay, by), Math.max(ay, by)];
      const across = new Set([Math.floor(c) - 1, Math.floor(c), Math.ceil(c) - 1, Math.ceil(c)]);
      for (let t = Math.floor(lo); t < Math.ceil(hi); t++) for (const u of across) along ? add(t, u) : add(u, t);
    }
  return [...out.values()];
}

/**
 * Freeway V boards: each V-board sprite once, on open ground right beside the
 * highway, the stretch nearest downtown first, at least VBOARD_GAP tiles apart.
 */
export function placeVBoards(m: SpriteManifest, site: FreewaySite, rng: () => number): { entry: SpriteEntry; x: number; y: number }[] {
  const boards = m.sprites.filter((s) => s.kind === "prop" && s.prop === "vboard");
  if (!boards.length || !site.highway.length) return [];
  const hwy = new Set(site.highway.map((t) => `${t.x},${t.y}`));
  const spots: { x: number; y: number; key: number }[] = [];
  for (let y = 0; y < site.h; y++)
    for (let x = 0; x < site.w; x++) {
      if (!site.open(x, y)) continue;
      let beside = false;
      for (let j = -1; j <= 1 && !beside; j++) for (let i = -1; i <= 1; i++) if (hwy.has(`${x + i},${y + j}`)) beside = true;
      if (beside) spots.push({ x, y, key: Math.hypot(x - site.target.x, y - site.target.y) + rng() * 0.5 });
    }
  spots.sort((a, b) => a.key - b.key);
  const out: { entry: SpriteEntry; x: number; y: number }[] = [];
  for (const s of spots) {
    if (out.length >= boards.length) break;
    if (out.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < VBOARD_GAP)) continue;
    out.push({ entry: boards[out.length], x: s.x, y: s.y });
  }
  return out;
}

/**
 * The side a lot's front should face: the nearest road on any side within four tiles, checking the
 * camera-facing sides (s, then e) first at each distance, so more fronts are seen. "s" when none is near.
 */
export function facingOf(isRoad: (x: number, y: number) => boolean, x: number, y: number, w = 1, d = 1): Facing {
  const run = (n: number, f: (i: number) => [number, number]) => Array.from({ length: n }, (_, i) => f(i));
  for (let k = 1; k <= 4; k++) {
    const sides: [Facing, [number, number][]][] = [
      ["s", run(w, (i) => [x + i, y + d - 1 + k])],
      ["e", run(d, (j) => [x + w - 1 + k, y + j])],
      ["n", run(w, (i) => [x + i, y - k])],
      ["w", run(d, (j) => [x - k, y + j])],
    ];
    for (const [f, tiles] of sides) if (tiles.some(([tx, ty]) => isRoad(tx, ty))) return f;
  }
  return "s";
}

/** The player's home model for a tier and facing, from the shared home set. */
export function findHome(m: SpriteManifest, tier: number, facing: Facing): SpriteEntry | null {
  return m.sprites.find((s) => s.kind === "home" && s.tier === tier && s.facing === facing) ?? null;
}
