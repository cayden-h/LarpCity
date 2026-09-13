// The world builder. A city's hand-made (or template) core sits in the middle
// of a much larger generated world, so the map fills the screen and there is
// always more to explore.
//
// The world's outline is a rectangle on screen (a rotated square in tile
// space: |dx - dy| <= RU and |dx + dy| <= RV around the center), so every tile
// can be reached by dragging at any zoom and the camera never runs into the
// corners of an isometric diamond.
//
//   1. Water that leaves the core keeps going to the world's edge.
//   2. Terrain: open suburbs around the core, and beyond them farm patchwork,
//      forest, ponds, and the state's land (mountains, desert, marsh, tundra).
//   3. Roads (roads/outskirts.ts): the core's streets continued, a suburban
//      grid, a frontage road, a highway ring with interchanges, country roads.
//   4. Street frontage becomes lots, and feature landmarks (wind farms, ski
//      lifts, harbors...) are placed where they fit.

import { cellHash, fbm } from "./noise.ts";
import { ringFits, stampRoads, worldRoads, type Frame } from "./roads/outskirts.ts";
import type { RoadDef } from "./roads/types";
import { rngFor } from "./rng.ts";
import type { CityDef, FeatureSpec, LandmarkPlacement, Outskirts, TileChar, Zone } from "./types";

/** Half-width of the world in screen columns (dx - dy) and half-height in rows (dx + dy). */
export const RU = 58;
export const RV = 66;

const DEFAULTS: Outskirts = { terrain: "plains", farms: 0.35, forest: 0.25, suburbs: 10, grid: 6, beltway: true, features: [] };

const OPEN = new Set<TileChar>([".", "f", "F", "s", "~", "m"]);
/** Core tiles a street may be continued across to reach the core's edge (open ground and lots, never parks). */
const PAVABLE = new Set<TileChar>([".", "b", "s", "f", "F", "~"]);
/** The narrowest suburbs worth shrinking to so a highway ring fits in the world. */
const MIN_RING_SUBURBS = 6;

export interface Region {
  cx: number;
  cy: number;
  ru: number;
  rv: number;
}

export interface World {
  city: CityDef;
  /** Tile at the center of the world (and of the core). */
  center: { x: number; y: number };
  region: Region;
}

export function expandWorld(source: CityDef, seed: number): World {
  const o: Outskirts = { ...DEFAULTS, ...source.outskirts, features: source.outskirts?.features ?? [] };
  const core = source.layout;
  const cw = Math.max(...core.map((r) => r.length)), ch = core.length;
  const N = RU + RV + 2;
  const cc = Math.floor(N / 2);
  const Mx = Math.round(cc - cw / 2), My = Math.round(cc - ch / 2);
  const inside = (X: number, Y: number, inset = 0) =>
    Math.abs(X - cc - (Y - cc)) <= RU - inset && Math.abs(X - cc + (Y - cc)) <= RV - inset;
  // A big core leaves no room for the ring's corners at the requested suburb
  // width; narrow the suburbs until the ring fits (or give up on the ring).
  if (o.beltway && !ringFits({ Mx, My, cw, ch, inside }, o.suburbs))
    for (let s = o.suburbs - 1; s >= MIN_RING_SUBURBS; s--)
      if (ringFits({ Mx, My, cw, ch, inside }, s)) {
        o.suburbs = s;
        break;
      }
  const ring = o.beltway && ringFits({ Mx, My, cw, ch, inside }, o.suburbs);

  const at = (x: number, y: number): TileChar => (x >= 0 && y >= 0 && x < cw && y < ch ? ((core[y][x] ?? " ") as TileChar) : " ");
  const g: TileChar[][] = Array.from({ length: N }, () => Array<TileChar>(N).fill(" "));
  const get = (X: number, Y: number): TileChar => (X >= 0 && Y >= 0 && X < N && Y < N ? g[Y][X] : " ");
  const dist = (X: number, Y: number) => Math.max(Mx - X, X - (Mx + cw - 1), My - Y, Y - (My + ch - 1), 0);
  const cells: [number, number][] = [];
  for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++) if (inside(X, Y)) cells.push([X, Y]);

  // 1. The core, then water projected outward from its edges.
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) g[y + My][x + Mx] = at(x, y);
  for (const [X, Y] of cells) {
    if (g[Y][X] !== " ") continue;
    let cx = Math.max(0, Math.min(cw - 1, X - Mx)), cy = Math.max(0, Math.min(ch - 1, Y - My));
    let c = at(cx, cy);
    // Clipped corners: step toward the middle to find the real edge tile.
    for (let k = 0; c === " " && k < 10; k++) {
      cx += cx < cw / 2 ? 1 : -1;
      cy += cy < ch / 2 ? 1 : -1;
      c = at(cx, cy);
    }
    if (c === "w") g[Y][X] = "w";
  }

  // 2. Terrain: suburbs are open land; beyond them, the state's land.
  for (const [X, Y] of cells) {
    if (g[Y][X] !== " ") continue;
    const d = dist(X, Y);
    g[Y][X] = d <= o.suburbs ? "." : terrainTile(o, seed, X, Y, d);
  }

  // 3. Roads.
  const coreRoads: RoadDef[] = source.roads.map((r) => ({ ...r, path: r.path.map(([x, y]): [number, number] => [x + Mx, y + My]) }));
  const footprint = new Set<string>();
  for (const l of source.landmarks) for (let j = 0; j < l.d; j++) for (let i = 0; i < l.w; i++) footprint.add(`${l.x + Mx + i},${l.y + My + j}`);
  const free = (X: number, Y: number) => inside(X, Y) && PAVABLE.has(get(X, Y)) && !footprint.has(`${X},${Y}`);
  const frame: Frame = { N, Mx, My, cw, ch, S: o.suburbs, G: o.grid, ring, seed, inside: (X, Y) => inside(X, Y), tile: get, free };
  const roads = [...coreRoads, ...worldRoads(frame, coreRoads)];
  const streets = stampRoads(g, roads);

  // Street frontage becomes lots: dense in the suburbs, the odd farmhouse beyond.
  const lotRng = rngFor(seed, "lots");
  const onStreet = (X: number, Y: number) => streets.has(`${X},${Y}`);
  const nearRoad = (X: number, Y: number, r: number) => {
    for (let k = 1; k <= r; k++) if (onStreet(X - k, Y) || onStreet(X + k, Y) || onStreet(X, Y - k) || onStreet(X, Y + k)) return true;
    return false;
  };
  const marks: [number, number, TileChar][] = [];
  for (const [X, Y] of cells) {
    const c = g[Y][X];
    const d = dist(X, Y);
    if (d === 0) continue;
    if (d <= o.suburbs && c === ".") {
      const park = cellHash(seed, "park", Math.floor((X - 2) / o.grid), Math.floor((Y - 2) / o.grid)) < 0.1;
      marks.push([X, Y, park ? "p" : nearRoad(X, Y, 2) ? "b" : "."]);
    } else if (d > o.suburbs + 1 && (c === "." || c === "f") && nearRoad(X, Y, 1) && lotRng() < 0.05) marks.push([X, Y, "b"]);
  }
  for (const [X, Y, c] of marks) g[Y][X] = c;

  // 4. Features, kept a few tiles in from the world's edge so they are never cut off.
  const landmarks: LandmarkPlacement[] = source.landmarks.map((l) => ({ ...l, x: l.x + Mx, y: l.y + My }));
  const used = new Set<string>();
  for (const l of landmarks) for (let j = l.y - 1; j <= l.y + l.d; j++) for (let i = l.x - 1; i <= l.x + l.w; i++) used.add(`${i},${j}`);
  const placeRng = rngFor(seed, "features");
  for (const f of o.features)
    for (let n = 0; n < (f.count ?? 1); n++) {
      const spot = findSpot(f, g, N, dist, o, used, placeRng, (x, y) => inside(x, y, 6));
      if (!spot) continue;
      landmarks.push({ id: f.id, x: spot.x, y: spot.y, w: f.w, d: f.d });
      for (let j = spot.y - 1; j <= spot.y + f.d; j++) for (let i = spot.x - 1; i <= spot.x + f.w; i++) used.add(`${i},${j}`);
      if (f.where !== "water")
        for (let j = spot.y; j < spot.y + f.d; j++) for (let i = spot.x; i < spot.x + f.w; i++) g[j][i] = f.where === "edge" ? "m" : "P";
    }

  const zones: Zone[] = source.zones.map((z) => ({ ...z, x: z.x + Mx, y: z.y + My }));
  // Strip malls on the frontage road, by the ring, where it meets the main roads.
  if (ring) {
    const r = o.suburbs - 1;
    for (const [zx, zy] of [[Mx + cw / 2, My - r], [Mx + cw / 2, My + ch + r], [Mx - r, My + ch / 2], [Mx + cw + r, My + ch / 2]])
      zones.push({ x: zx, y: zy, r: 3, kind: "midtown" });
  }

  const city: CityDef = {
    ...source,
    layout: g.map((row) => row.join("")),
    roads,
    core: { x: Mx, y: My, w: cw, h: ch },
    landmarks,
    zones,
    traffic: Math.round(source.traffic * 2.4),
  };
  return { city, center: { x: cc, y: cc }, region: { cx: cc, cy: cc, ru: RU, rv: RV } };
}

function terrainTile(o: Outskirts, seed: number, X: number, Y: number, d: number): TileChar {
  const n = fbm(seed, X * 0.085, Y * 0.085);
  const pond = fbm(seed + 31, X * 0.16, Y * 0.16);
  const farmCell = cellHash(seed, "farm", Math.floor(X / 5), Math.floor(Y / 5));
  const hedge = X % 5 === 0 || Y % 5 === 0;
  const farm = farmCell < o.farms && !hedge;
  switch (o.terrain) {
    case "desert":
      if (d > o.suburbs + 8 && n > 0.66) return "m";
      return n > 0.58 ? "." : "s";
    case "swamp":
      if (pond > 0.66) return "w";
      if (n > 0.55) return "~";
      if (n < 0.3 && o.forest > 0) return "F";
      return farm ? "f" : ".";
    case "tundra":
      if (pond > 0.78) return "w";
      if (n > 0.6) return "m";
      return n > 0.45 ? "F" : ".";
    case "island":
      if (d > o.suburbs + 10) return "w";
      if (n > 0.62) return "m";
      return n > 0.45 ? "F" : ".";
    default: {
      if (pond > 0.8 && d > o.suburbs + 3) return "w";
      if (o.terrain === "mountains" && d > o.suburbs + 5 && n > 0.52) return "m";
      if (o.terrain === "hills" && d > o.suburbs + 9 && n > 0.7) return "m";
      if (n > 1 - o.forest) return "F";
      return farm ? "f" : ".";
    }
  }
}

function findSpot(
  f: FeatureSpec,
  g: TileChar[][],
  N: number,
  dist: (x: number, y: number) => number,
  o: Outskirts,
  used: Set<string>,
  rng: () => number,
  reachable: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  const fits = (x: number, y: number) => {
    let touchesWater = false;
    for (let j = y; j < y + f.d; j++)
      for (let i = x; i < x + f.w; i++) {
        if (!reachable(i, j) || used.has(`${i},${j}`)) return false;
        const c = g[j][i], d = dist(i, j);
        if (f.where === "water") {
          if (c !== "w") return false;
          continue;
        }
        if (f.where === "edge") {
          if (!OPEN.has(c) || d < o.suburbs + 4) return false;
          continue;
        }
        if (f.where === "rural" && (!OPEN.has(c) || c === "m" || d < o.suburbs + 2)) return false;
        if (f.where === "suburb" && (!(c === "b" || c === "." || c === "p") || d === 0 || d > o.suburbs)) return false;
        if (f.where === "coast") {
          if (!(c === "." || c === "s" || c === "b" || c === "p" || c === "~") || d === 0) return false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g[j + dy]?.[i + dx] === "w") touchesWater = true;
        }
        if (f.where === "core" && (!(c === "b" || c === "." || c === "p") || d !== 0)) return false;
      }
    return f.where !== "coast" || touchesWater;
  };
  for (let tries = 0; tries < 6000; tries++) {
    const x = 1 + Math.floor(rng() * (N - f.w - 2)), y = 1 + Math.floor(rng() * (N - f.d - 2));
    if (fits(x, y)) return { x, y };
  }
  return null;
}
