// Which building goes on each lot: its zone, footprint, height cap, and, on
// residential lots, the house's facing and style family, then the sprite.
// Pure (no Pixi), so the whole city's plan runs under Node's test runner;
// populate.ts draws it.

import type { CityGrid } from "./grid";
import { pick, range, rngFor, type Rng } from "./rng.ts";
import { facingOf, pickSprite, type Facing, type SpriteEntry, type SpriteManifest } from "./sprite-pick.ts";
import type { CityDef, HouseStyle, ZoneKind } from "./types";

import { zoneAt } from "./zones.ts";
export { zoneAt } from "./zones.ts";

export interface LotPlan {
  x: number;
  y: number;
  w: number;
  d: number;
  /** The brick builder's spec, used when no sprite fits. */
  spec: ReturnType<typeof styleFor>;
  entry: SpriteEntry | null;
  /** Wall color for a house sprite, from the city palette. */
  tint: number;
}

/** About one core residential lot in eight becomes a walk-up, to break up the rows. */
const WALKUP_SHARE = 1 / 8;
const DEFAULT_HOUSES: HouseStyle[] = ["victorian", "edwardian"];
/** The tallest house sprite, so the zone's brick height never rules out a house. */
const TALLEST_HOUSE = 4;

/** Inside the hand-made core (everything is, before expandWorld records the core). */
export function inCore(city: CityDef, x: number, y: number): boolean {
  const c = city.core;
  return !c || (x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h);
}

/** House families a lot may take: suburban in the suburb ring, else the nearest residential zone's list. */
export function houseStyles(city: CityDef, x: number, y: number): HouseStyle[] {
  if (!inCore(city, x, y)) return ["suburban"];
  let best = DEFAULT_HOUSES;
  let score = Infinity;
  for (const z of city.zones) {
    if (z.kind !== "residential") continue;
    const s = Math.hypot(x - z.x, y - z.y) / z.r;
    if (s < score) {
      score = s;
      best = z.houses?.length ? z.houses : DEFAULT_HOUSES;
    }
  }
  return best;
}

/** Preserve the original population stream before making any house-only decisions. */
function legacyLots(grid: CityGrid, city: CityDef, seed: number, manifest: SpriteManifest | null): LotPlan[] {
  const rng = rngFor(seed, city.id, "populate");
  const used = new Set<string>();
  const taken = new Set<string>();
  const plans: LotPlan[] = [];
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    if (grid.at(x, y) !== "b" || taken.has(`${x},${y}`)) continue;
    const zone = zoneAt(city, x, y);
    const sizes: [number, number][] =
      zone === "downtown" || zone === "industrial" || zone === "campus" ? [[2, 2], [2, 1], [1, 2], [1, 1]]
      : zone === "midtown" ? (rng() < 0.4 ? [[2, 1], [1, 2], [1, 1]] : [[1, 1]]) : [[1, 1]];
    const free = (w: number, d: number) => {
      for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++)
        if (grid.at(i, j) !== "b" || taken.has(`${i},${j}`)) return false;
      return true;
    };
    const [w, d] = sizes.find(([w, d]) => free(w, d) && (w * d === 1 || rng() < 0.7)) ?? [1, 1];
    for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) taken.add(`${i},${j}`);
    const spec = styleFor(zone, city, rng, x, y, w, d, seed);
    const cap = sightlineCap(city, grid, x, y, w, d);
    spec.floors = Math.max(1, Math.min(spec.floors, cap));
    const heroSpot = nearZoneCore(city, zone, x + w / 2, y + d / 2);
    const entry = manifest ? pickSprite(manifest, { zone, w, d, maxFloors: spec.floors + 3, cap, heroSpot }, used, rng) : null;
    plans.push({ x, y, w, d, spec, entry, tint: pick(rngFor(seed, city.id, `walls:${x},${y}`), city.palette.walls) });
  }
  return plans;
}

/** Identify an uninterrupted road segment and side, including across yard gaps. */
function streetSide(grid: CityGrid, x: number, y: number, w: number, d: number, facing: Facing): string | null {
  const horizontal = facing === "s" || facing === "n";
  for (let distance = 1; distance <= 4; distance++) {
    for (let i = 0; i < (horizontal ? w : d); i++) {
      let rx = horizontal ? x + i : facing === "e" ? x + w - 1 + distance : x - distance;
      let ry = horizontal ? facing === "s" ? y + d - 1 + distance : y - distance : y + i;
      if (!grid.isRoad(rx, ry)) continue;
      if (horizontal) while (grid.isRoad(rx - 1, ry)) rx--;
      else while (grid.isRoad(rx, ry - 1)) ry--;
      return `${facing}:${rx},${ry}`;
    }
  }
  return null;
}

export function planLots(grid: CityGrid, city: CityDef, seed: number, manifest: SpriteManifest | null): LotPlan[] {
  const baseline = legacyLots(grid, city, seed, manifest);
  const residential = new Map(baseline.filter((p) => zoneAt(city, p.x, p.y) === "residential").map((p) => [`${p.x},${p.y}`, p]));
  const used = new Set(baseline.filter((p) => !residential.has(`${p.x},${p.y}`) && p.entry?.unique).map((p) => p.entry!.id));
  const taken = new Set<string>();
  const families = new Map<string, HouseStyle>();
  const out: LotPlan[] = [];
  for (const original of baseline) {
    const { x, y } = original;
    if (!residential.has(`${x},${y}`)) { out.push(original); continue; }
    if (taken.has(`${x},${y}`)) continue;
    const rng = rngFor(seed, city.id, `house:${x},${y}`);
    let w = 1, d = 1;
    // Reserve a larger lot only when a real, facing-compatible walk-up fits its full sightline cap.
    if (manifest && inCore(city, x, y) && rng() < 0.1) {
      for (const [sw, sd] of [[2, 1], [1, 2]]) {
        let free = true;
        for (let j = y; j < y + sd; j++) for (let i = x; i < x + sw; i++)
          if (!residential.has(`${i},${j}`) || taken.has(`${i},${j}`) || !inCore(city, i, j)) free = false;
        const facing = facingOf((i, j) => grid.isRoad(i, j), x, y, sw, sd);
        const cap = sightlineCap(city, grid, x, y, sw, sd);
        const fits = manifest.sprites.some((e) => (!e.kind || e.kind === "building") && !e.unique &&
          e.style === "walkup" && e.facing === facing && e.w === sw && e.d === sd &&
          e.zones.includes("residential") && e.floors <= Math.min(cap, TALLEST_HOUSE));
        if (free && fits && rng() < 0.7) { w = sw; d = sd; break; }
      }
    }
    const cap = sightlineCap(city, grid, x, y, w, d);
    const facing = facingOf((i, j) => grid.isRoad(i, j), x, y, w, d);
    const street = streetSide(grid, x, y, w, d, facing);
    const allowed = houseStyles(city, x, y);
    const prev = street ? families.get(street) : undefined;
    const family = prev && allowed.includes(prev) ? prev : pick(rng, allowed);
    if (street) families.set(street, family);
    const style = w * d > 1 || (inCore(city, x, y) && cap >= 3 && rng() < WALKUP_SHARE) ? "walkup" : family;
    const spec = w * d === 1 ? original.spec : styleFor("residential", city, rng, x, y, w, d, seed);
    spec.floors = Math.max(1, Math.min(spec.floors, cap));
    const entry = manifest ? pickSprite(manifest, { zone: "residential", w, d, facing, style,
      cap, maxFloors: Math.max(spec.floors + 3, TALLEST_HOUSE), heroSpot: nearZoneCore(city, "residential", x + w / 2, y + d / 2) }, used, rng) : null;
    for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) taken.add(`${i},${j}`);
    out.push({ x, y, w, d, spec, entry, tint: original.tint });
  }
  return out;
}

/** In the inner part of a zone of this kind: where a branded building is seen from the default camera. */
function nearZoneCore(city: CityDef, kind: ZoneKind, x: number, y: number): boolean {
  return city.zones.some((z) => z.kind === kind && Math.hypot(x - z.x, y - z.y) <= z.r * 0.6);
}

const homeTiles = new WeakMap<CityGrid, { x: number; y: number }[]>();

/**
 * Landmarks and home lots must stay visible from the default camera. A building
 * standing in front of one (closer to the viewer, on roughly the same screen
 * column) is capped in height, and the cap loosens with distance. Homes are
 * short, so their cap is lower and reaches less far.
 */
function sightlineCap(city: CityDef, grid: CityGrid, x: number, y: number, w: number, d: number): number {
  let cap = Infinity;
  const column = x + w / 2 - (y + d / 2);
  const depth = x + y + (w + d) / 2;
  for (const lm of city.landmarks) {
    const ahead = depth - (lm.x + lm.y + (lm.w + lm.d) / 2);
    const offset = Math.abs(column - (lm.x + lm.w / 2 - (lm.y + lm.d / 2)));
    if (ahead > 0 && ahead < 10 && offset <= (lm.w + lm.d) / 2 + 0.5) cap = Math.min(cap, 2 + Math.floor(ahead / 3));
  }
  let homes = homeTiles.get(grid);
  if (!homes) homeTiles.set(grid, homes = [...grid.cells()].filter((c) => c.c === "h"));
  for (const h of homes) {
    const ahead = depth - (h.x + h.y + 1);
    const offset = Math.abs(column - (h.x - h.y));
    if (ahead > 0 && ahead < 8 && offset <= (w + d) / 2 + 0.5) cap = Math.min(cap, 2 + Math.floor(ahead / 3));
  }
  return cap;
}

function styleFor(zone: ZoneKind, city: CityDef, rng: Rng, x: number, y: number, w: number, d: number, seed: number) {
  const p = city.palette;
  const s = { x, y, w, d, seed: seed ^ (x * 7919 + y * 104729) };
  switch (zone) {
    case "downtown": {
      const glass = rng() < 0.55;
      return {
        ...s,
        floors: Math.round(range(rng, 4, p.maxFloors)) + (w * d >= 4 ? 2 : 0),
        wall: glass ? pick(rng, [0x5b8fc7, 0x6aa6c9, 0x7fb3d5, 0x4f7ea8]) : pick(rng, p.walls),
        trim: pick(rng, p.trim),
        roof: 0x9aa4ae,
        roofType: pick(rng, ["antenna", "flat", "flat", "terrace"] as const),
        glass,
        windows: "bands" as const,
        litShare: 0.7,
      };
    }
    case "midtown":
      return {
        ...s,
        floors: Math.round(range(rng, 2, Math.min(6, p.maxFloors))),
        wall: pick(rng, p.walls),
        trim: pick(rng, p.trim),
        roof: 0x8f969e,
        roofType: pick(rng, p.roofTypes.includes("water-tower") ? (["flat", "water-tower", "flat"] as const) : (["flat", "flat", "hip"] as const)),
        shopfront: rng() < 0.65,
        windows: pick(rng, ["grid", "tall"] as const),
        litShare: 0.55,
      };
    case "industrial":
      return {
        ...s,
        floors: Math.round(range(rng, 1, 2)),
        wall: pick(rng, [0xb8b2a6, 0x9fa7ad, 0xc9b79c, 0x8e9aa3]),
        trim: 0xf2b134,
        roof: 0x7b838b,
        roofType: "flat" as const,
        windows: "bands" as const,
        litShare: 0.3,
      };
    case "campus":
      return {
        ...s,
        floors: Math.round(range(rng, 2, 3)),
        wall: pick(rng, [0xd8c3a0, 0xcfb38a, 0xe0cfb0]),
        trim: 0x9c5a45,
        roof: 0xb5543c,
        roofType: "hip" as const,
        windows: "tall" as const,
        litShare: 0.45,
      };
    default:
      return {
        ...s,
        floors: rng() < 0.75 ? 1 : 2,
        wall: pick(rng, p.walls),
        trim: pick(rng, p.trim),
        roof: pick(rng, p.roofs),
        roofType: pick(rng, p.roofTypes.filter((r) => r === "gable" || r === "hip" || r === "flat")),
        windows: "grid" as const,
        litShare: 0.5,
      };
  }
}

