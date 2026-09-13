// Fills a city's lots with buildings in the style of their zone, and plants
// trees and reeds. Everything is seeded, so a city always looks the same.

import { Container, Graphics } from "pixi.js";
import { buildBrick, buildGrove, buildTree, type Built } from "./bricks";
import { shade } from "./color";
import type { CityGrid } from "./grid";
import { depthOf, iso } from "./iso";
import { pick, range, rngFor, type Rng } from "./rng";
import { pickSprite } from "./sprite-pick";
import { buildSprite, type SpriteSet } from "./sprites";
import type { CityDef, ZoneKind } from "./types";
import { zoneAt } from "./zones.ts";

export { zoneAt };

export interface Placed {
  built: Built;
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface Plant {
  view: Container;
  x: number;
  y: number;
}

/** In the inner part of a zone of this kind: where a branded building is seen from the default camera. */
function nearZoneCore(city: CityDef, kind: ZoneKind, x: number, y: number): boolean {
  return city.zones.some((z) => z.kind === kind && Math.hypot(x - z.x, y - z.y) <= z.r * 0.6);
}

export function populate(grid: CityGrid, city: CityDef, seed: number, sprites: SpriteSet | null = null): { buildings: Placed[] } {
  const rng = rngFor(seed, city.id, "populate");
  const used = new Set<string>();
  const taken = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const free = (x: number, y: number, w: number, d: number) => {
    for (let j = y; j < y + d; j++)
      for (let i = x; i < x + w; i++) if (grid.at(i, j) !== "b" || taken.has(key(i, j))) return false;
    return true;
  };
  const buildings: Placed[] = [];

  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) {
      if (grid.at(x, y) !== "b" || taken.has(key(x, y))) continue;
      const zone = zoneAt(city, x, y);
      const sizes: [number, number][] =
        zone === "downtown" ? [[2, 2], [2, 1], [1, 2], [1, 1]]
        : zone === "industrial" || zone === "campus" ? [[2, 2], [2, 1], [1, 2], [1, 1]]
        : zone === "midtown" ? (rng() < 0.4 ? [[2, 1], [1, 2], [1, 1]] : [[1, 1]])
        : [[1, 1]];
      const [w, d] = sizes.find(([sw, sd]) => free(x, y, sw, sd) && (sw * sd === 1 || rng() < 0.7)) ?? [1, 1];
      for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) taken.add(key(i, j));
      const spec = styleFor(zone, city, rng, x, y, w, d, seed);
      const cap = sightlineCap(city, x, y, w, d);
      spec.floors = Math.max(1, Math.min(spec.floors, cap));
      const heroSpot = nearZoneCore(city, zone, x + w / 2, y + d / 2);
      const entry = sprites ? pickSprite(sprites.manifest, { zone, w, d, maxFloors: spec.floors + 3, cap, heroSpot }, used, rng) : null;
      const built = entry && sprites ? buildSprite(sprites, entry, x, y) : buildBrick(spec);
      buildings.push({ built, x, y, w, d });
    }
  return { buildings };
}

/**
 * Landmarks must stay visible from the default camera. A building standing in
 * front of a landmark (closer to the viewer, on roughly the same screen column)
 * is capped in height, and the cap loosens with distance.
 */
function sightlineCap(city: CityDef, x: number, y: number, w: number, d: number): number {
  let cap = Infinity;
  const column = x + w / 2 - (y + d / 2);
  const depth = x + y + (w + d) / 2;
  for (const lm of city.landmarks) {
    const ahead = depth - (lm.x + lm.y + (lm.w + lm.d) / 2);
    const offset = Math.abs(column - (lm.x + lm.w / 2 - (lm.y + lm.d / 2)));
    if (ahead > 0 && ahead < 10 && offset <= (lm.w + lm.d) / 2 + 0.5) cap = Math.min(cap, 2 + Math.floor(ahead / 3));
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

/**
 * Trees on parks, a sprinkle along streets, dense groves in forests, reeds in
 * marshes, boulders and pines on mountain rock, and cacti in the desert.
 * One object per tile keeps even very large forests cheap.
 */
export function plant(grid: CityGrid, city: CityDef, seed: number, leaf: number, bare: boolean, snow: number, desert = false): Plant[] {
  const rng = rngFor(seed, city.id, "plants");
  const out: Plant[] = [];
  for (const { x, y, c } of grid.cells()) {
    if (c === "F") out.push({ view: buildGrove(x, y, seed, shade(leaf, 0.85), 2 + (rng() < 0.5 ? 1 : 0), 0.55, bare, snow), x, y });
    else if (c === "p") out.push({ view: buildGrove(x, y, seed, leaf, rng() < 0.5 ? 2 : 1, 0.3, bare, snow), x, y });
    else if (c === "." && rng() < (desert ? 0.05 : 0.08))
      out.push({ view: desert ? cactus(x, y, rng) : buildTree(x, y, seed, shade(leaf, 0.9 + rng() * 0.2), bare, snow), x, y });
    else if (c === "s" && desert && rng() < 0.05) out.push({ view: cactus(x, y, rng), x, y });
    else if (c === "~" && rng() < 0.7) out.push({ view: reeds(x, y, rng), x, y });
    else if (c === "m" && rng() < 0.6) out.push({ view: rng() < 0.55 ? boulder(x, y, rng, snow) : buildGrove(x, y, seed, 0x2f6b3a, 1 + (rng() < 0.4 ? 1 : 0), 1, false, snow), x, y });
  }
  return out;
}

function cactus(x: number, y: number, rng: () => number): Container {
  const g = new Graphics();
  const p = iso(x + 0.3 + rng() * 0.4, y + 0.3 + rng() * 0.4);
  const h = 16 + rng() * 12;
  const green = 0x4f9a55;
  g.ellipse(p.x, p.y, 6, 2.5).fill({ color: 0x000000, alpha: 0.12 });
  g.roundRect(p.x - 2.6, p.y - h, 5.2, h, 2.6).fill(green);
  g.roundRect(p.x - 2.6, p.y - h, 2, h, 1).fill(shade(green, 1.15));
  if (rng() < 0.8) g.roundRect(p.x - 8, p.y - h * 0.7, 2.4, h * 0.35, 1.2).fill(green).rect(p.x - 8, p.y - h * 0.4, 6, 2.2).fill(green);
  if (rng() < 0.6) g.roundRect(p.x + 5.6, p.y - h * 0.8, 2.4, h * 0.3, 1.2).fill(shade(green, 0.85)).rect(p.x + 2.6, p.y - h * 0.55, 5, 2.2).fill(shade(green, 0.85));
  const c = new Container();
  c.addChild(g);
  return c;
}

function boulder(x: number, y: number, rng: () => number, snow: number): Container {
  const g = new Graphics();
  const p = iso(x + 0.3 + rng() * 0.4, y + 0.3 + rng() * 0.4);
  const s = 0.7 + rng() * 0.6;
  g.ellipse(p.x, p.y + 1, 11 * s, 4 * s).fill({ color: 0x000000, alpha: 0.14 });
  g.roundRect(p.x - 10 * s, p.y - 10 * s, 20 * s, 11 * s, 4 * s).fill(0x7d7870);
  g.roundRect(p.x - 7 * s, p.y - 15 * s, 13 * s, 8 * s, 3.5 * s).fill(0x938d84);
  if (snow > 0.3) g.roundRect(p.x - 6 * s, p.y - 16 * s, 11 * s, 3.5 * s, 1.7 * s).fill({ color: 0xffffff, alpha: snow });
  const c = new Container();
  c.addChild(g);
  return c;
}

function reeds(x: number, y: number, rng: Rng): Container {
  const g = new Graphics();
  for (let i = 0; i < 6; i++) {
    const p = iso(x + 0.15 + rng() * 0.7, y + 0.15 + rng() * 0.7);
    const hgt = 8 + rng() * 8;
    g.moveTo(p.x, p.y).lineTo(p.x + (rng() - 0.5) * 4, p.y - hgt).stroke({ width: 1.6, color: 0x6f9a3c });
    if (rng() < 0.5) g.roundRect(p.x - 1.5, p.y - hgt - 5, 3, 6, 1.5).fill(0x7a4e2d);
  }
  const c = new Container();
  c.addChild(g);
  c.zIndex = depthOf(x, y, 50);
  return c;
}
