# Task 6: The world builder emits the road hierarchy

**Files:**
- Create: `game/src/engine/roads/outskirts.ts`
- Modify: `game/src/engine/world.ts` (full replacement below)
- Modify: `game/src/engine/noise.ts:3` (import with `.ts`)
- Modify: `game/src/engine/types.ts` (`CityDef.core`)
- Test: `game/tests/roads-world.test.ts`

Layout of the generated roads, by Chebyshev distance `d` from the core rectangle (S = `outskirts.suburbs`, G = `outskirts.grid`):

| d | What |
|---|---|
| 1 | Perimeter road (local) hugging the core |
| 2 .. S-1 | Suburbs: grid lines every G (arterial on every 2G line, collector otherwise), one local street per block (30% cul-de-sacs) |
| S | Frontage road (local), where collectors end |
| S+1 | Ramps (inner side) |
| S+2, S+3 | Highway ring, 2 lanes each way (only when `outskirts.beltway` and it fits) |
| S+4 | Ramps (outer side) |
| S+7 and beyond | Country roads every 2G (local, `rural`) |

- Core streets that reach the core's edge continue outward (starting past the perimeter road): arterials to the world's edge, other streets as collectors to the frontage road (and on as country roads when there is no ring).
- Suburb arterials also run on to the world's edge.
- Every arterial crossing the ring gets a diamond interchange (overpass plus four ramps) unless its ramps would hit a corner, the radial highway, or another interchange.
- One radial highway leaves the ring on the side with the least water, from the middle of that side, to the world's edge.
- Generated roads split at water wider than 5 tiles (8 for highways) and at the world's edge; the core's roads are kept as the city made them.
- Stamping order: highways, ramps, then the rest; a street tile over a highway tile becomes `O`.

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-world.test.ts`:

```ts
// The generated world: road tiles and roads agree, the network is connected,
// and cities with a beltway get a highway ring with interchanges. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { austin } from "../src/cities/austin.ts";
import { dallas } from "../src/cities/dallas.ts";
import { houston } from "../src/cities/houston.ts";
import { miami } from "../src/cities/miami.ts";
import { newYork } from "../src/cities/new-york.ts";
import { sanFrancisco } from "../src/cities/san-francisco.ts";
import { templateCity } from "../src/cities/templates.ts";
import { STATES } from "../src/data/states.ts";
import { buildGraph } from "../src/engine/roads/graph.ts";
import { roadTiles } from "../src/engine/roads/types.ts";
import type { CityDef } from "../src/engine/types.ts";
import { expandWorld } from "../src/engine/world.ts";

const ROADISH = new Set(["=", "B", "t", "O"]);
const CITIES: CityDef[] = [houston, dallas, austin, miami, newYork, sanFrancisco, ...STATES.slice(0, 8).map(templateCity)];

for (const source of CITIES)
  test(`${source.id}: world roads match tiles, and most lanes are reachable`, () => {
    const { city } = expandWorld(source, 7);
    const at = (x: number, y: number) => city.layout[y]?.[x] ?? " ";
    const covered = new Set<string>();
    for (const r of city.roads)
      for (const [x, y] of roadTiles(r)) {
        assert.ok(ROADISH.has(at(x, y)), `${r.id} covers ${x},${y} = "${at(x, y)}"`);
        covered.add(`${x},${y}`);
      }
    city.layout.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (ROADISH.has(c)) assert.ok(covered.has(`${x},${y}`), `road tile ${x},${y} has no road`);
      }),
    );
    assert.ok(city.core, "the expanded city records its core");
    const net = buildGraph(city.roads, { core: city.core });
    const live = net.lanes.filter((l) => l.live).length / net.lanes.length;
    assert.ok(live >= 0.85, `only ${(live * 100).toFixed(0)}% of lanes are reachable`);
  });

test("a city with a beltway gets a highway ring, interchanges, and overpasses", () => {
  const withRing = [houston, dallas, austin, miami, newYork]
    .map((c) => expandWorld(c, 7).city)
    .filter((c) => c.roads.some((r) => r.cls === "highway"));
  assert.ok(withRing.length > 0, "no city got a ring");
  for (const city of withRing) {
    const net = buildGraph(city.roads, { core: city.core });
    assert.ok(net.nodes.filter((n) => n.kind === "merge").length >= 4, `${city.id}: no interchange`);
    assert.ok(city.layout.some((row) => row.includes("O")), `${city.id}: no overpass`);
    assert.ok(net.movements.some((m) => m.turn === "merge" && m.live), `${city.id}: no live on-ramp`);
  }
});

test("the world is the same for the same seed", () => {
  const a = expandWorld(houston, 7).city, b = expandWorld(houston, 7).city;
  assert.deepEqual(a.layout, b.layout);
  assert.deepEqual(a.roads, b.roads);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-world.test.ts`
Expected: FAIL; `world.ts` imports `./noise` without an extension.

- [ ] **Step 3: `CityDef.core` and the noise import**

In `game/src/engine/types.ts`, inside `CityDef` after `roads`:

```ts
  /** The hand-made core's rectangle in world tiles; set by the world builder. */
  core?: { x: number; y: number; w: number; h: number };
```

In `game/src/engine/noise.ts` line 3: `import { hashKeys } from "./rng.ts";`

- [ ] **Step 4: Create `game/src/engine/roads/outskirts.ts`**

```ts
// Roads for the generated world around a city's core: a perimeter road
// hugging the core, the core's streets continued outward, a suburban grid of
// collectors and arterials with a local street (or cul-de-sac) in each block,
// a frontage road at the suburbs' edge, an optional highway ring with diamond
// interchanges and one radial highway, and country roads beyond.

import { cellHash } from "../noise.ts";
import type { TileChar } from "../types";
import { defaultLanes, roadTiles, roadWidth, type RoadClass, type RoadDef } from "./types.ts";

export interface Frame {
  N: number;
  /** The core's top-left tile and size in world tiles. */
  Mx: number;
  My: number;
  cw: number;
  ch: number;
  /** Suburb ring width and street spacing. */
  S: number;
  G: number;
  ring: boolean;
  seed: number;
  inside: (X: number, Y: number) => boolean;
  /** The world tile before roads are stamped (terrain and the core). */
  tile: (X: number, Y: number) => TileChar;
}

/** Which way a road runs: along x (it sits in rows) or along y (in columns). */
type Axis = "x" | "y";

interface Line {
  axis: Axis;
  /** First row (axis x) or column (axis y) it covers. */
  at: number;
  width: number;
}

const onLine = (v: number, step: number) => (((v - 2) % step) + step) % step === 0;

export function coreDist(f: Frame, X: number, Y: number): number {
  return Math.max(f.Mx - X, X - (f.Mx + f.cw - 1), f.My - Y, Y - (f.My + f.ch - 1), 0);
}

export function outskirtRoads(f: Frame, core: RoadDef[]): RoadDef[] {
  const out: RoadDef[] = [];
  let serial = 0;
  const { Mx, My, cw, ch, S, G } = f;
  const cx0 = Mx, cx1 = Mx + cw - 1, cy0 = My, cy1 = My + ch - 1;
  const across = (axis: Axis): [number, number] => (axis === "x" ? [cy0, cy1] : [cx0, cx1]);
  const along = (axis: Axis): [number, number] => (axis === "x" ? [cx0, cx1] : [cy0, cy1]);
  const rel = (axis: Axis, at: number) => at - (axis === "x" ? My : Mx);
  const tileOf = (axis: Axis, a: number, i: number): [number, number] => (axis === "x" ? [i, a] : [a, i]);
  const insideAll = (axis: Axis, at: number, w: number, i: number) => {
    for (let k = 0; k < w; k++) if (!f.inside(...tileOf(axis, at + k, i))) return false;
    return true;
  };
  /** From `start`, step by `dir` while still inside the world; the last inside index. */
  const reach = (axis: Axis, at: number, w: number, start: number, dir: number) => {
    let i = start;
    while (insideAll(axis, at, w, i + dir)) i += dir;
    return i;
  };
  const add = (cls: RoadClass, axis: Axis, at: number, w: number, from: number, to: number, extra: Partial<RoadDef> = {}) => {
    if (Math.abs(to - from) < 1) return;
    const c = at + w / 2, a = from + 0.5, b = to + 0.5;
    const path: [number, number][] = axis === "x" ? [[a, c], [b, c]] : [[c, a], [c, b]];
    out.push({ id: `${cls}-w${serial++}`, cls, path, lanes: defaultLanes(cls), ...extra });
  };
  const reserved: Line[] = [];
  const near = (axis: Axis, at: number, w: number, gap: number) =>
    reserved.some((r) => r.axis === axis && r.at < at + w + gap && at - gap < r.at + r.width);
  const crossers: Line[] = [];

  // 1. The perimeter road and the frontage road.
  const box = (d: number) => {
    const top = cy0 - d, bottom = cy1 + d, left = cx0 - d, right = cx1 + d;
    add("local", "x", top, 1, left, right);
    add("local", "x", bottom, 1, left, right);
    add("local", "y", left, 1, top, bottom);
    add("local", "y", right, 1, top, bottom);
    reserved.push({ axis: "x", at: top, width: 1 }, { axis: "x", at: bottom, width: 1 }, { axis: "y", at: left, width: 1 }, { axis: "y", at: right, width: 1 });
  };
  box(1);
  if (S >= 4) box(S);

  // 2. Core streets that reach the core's edge continue outward, past the perimeter road.
  for (const r of core) {
    if (r.tram || r.path.length !== 2) continue;
    const [[ax, ay], [bx, by]] = r.path;
    const axis: Axis = ay === by ? "x" : "y";
    const w = roadWidth(r);
    const at = Math.round((axis === "x" ? ay : ax) - w / 2);
    const lo = Math.floor(Math.min(axis === "x" ? ax : ay, axis === "x" ? bx : by));
    const hi = Math.floor(Math.max(axis === "x" ? ax : ay, axis === "x" ? bx : by));
    const [a0, a1] = along(axis);
    const art = r.cls === "arterial";
    let used = false;
    for (const dir of [-1, 1]) {
      const end = dir < 0 ? lo : hi;
      if (end !== (dir < 0 ? a0 : a1)) continue;
      const start = end + 2 * dir;
      if (!insideAll(axis, at, w, start)) continue;
      used = true;
      if (art) add("arterial", axis, at, w, start, reach(axis, at, w, start, dir));
      else {
        add("collector", axis, at, w, start, end + S * dir);
        if (!f.ring && insideAll(axis, at, w, end + (S + 1) * dir))
          add("local", axis, at, w, end + (S + 1) * dir, reach(axis, at, w, end + (S + 1) * dir, dir), { rural: true });
      }
    }
    if (!used) continue;
    reserved.push({ axis, at, width: w });
    if (art) crossers.push({ axis, at, width: w });
  }

  // 3. The suburban grid: collectors every G, arterials every 2G.
  const accepted: Record<Axis, Map<number, number>> = { x: new Map(), y: new Map() };
  for (const axis of ["x", "y"] as const) {
    const [c0, c1] = across(axis), [a0, a1] = along(axis);
    for (let at = c0 - S + 1; at <= c1 + S - 1; at++) {
      if (!onLine(rel(axis, at), G)) continue;
      const art = onLine(rel(axis, at), 2 * G);
      const w = art ? 2 : 1;
      if (near(axis, at, w, 2)) continue;
      const crossesCore = at + w - 1 >= c0 - 1 && at <= c1 + 1;
      const lo = a0 - S, hi = a1 + S;
      const parts: [number, number][] = crossesCore ? [[lo, a0 - 1], [a1 + 1, hi]] : [[lo, hi]];
      for (const [p, q] of parts) {
        if (!art) {
          add("collector", axis, at, w, p, q);
          continue;
        }
        // Arterials run on to the world's edge on their outer ends.
        const from = p === lo && insideAll(axis, at, w, lo) ? reach(axis, at, w, lo, -1) : p;
        const to = q === hi && insideAll(axis, at, w, hi) ? reach(axis, at, w, hi, 1) : q;
        add("arterial", axis, at, w, from, to);
      }
      accepted[axis].set(at, w);
      reserved.push({ axis, at, width: w });
      if (art) crossers.push({ axis, at, width: w });
    }
  }

  // 4. A local street through each suburban block; some are cul-de-sacs.
  const occupied = new Set<string>();
  for (const d of [...core, ...out]) for (const [x, y] of roadTiles(d)) occupied.add(`${x},${y}`);
  for (const [lx, wx] of accepted.y)
    for (const [ly, wy] of accepted.x) {
      if (!accepted.y.has(lx + G) || !accepted.x.has(ly + G)) continue;
      const ix0 = lx + wx, ix1 = lx + G - 1, iy0 = ly + wy, iy1 = ly + G - 1;
      if (ix1 - ix0 < 3 || iy1 - iy0 < 3) continue;
      let clear = true;
      for (let y = iy0; y <= iy1 && clear; y++)
        for (let x = ix0; x <= ix1; x++) {
          const d = coreDist(f, x, y);
          if (d < 2 || d > S - 1 || occupied.has(`${x},${y}`) || !f.inside(x, y)) {
            clear = false;
            break;
          }
        }
      if (!clear) continue;
      const cul = cellHash(f.seed, "cul", lx, ly) < 0.3;
      if (cellHash(f.seed, "street", lx, ly) < 0.5) add("local", "x", Math.floor((iy0 + iy1) / 2), 1, ix0, cul ? ix1 - 2 : ix1);
      else add("local", "y", Math.floor((ix0 + ix1) / 2), 1, iy0, cul ? iy1 - 2 : iy1);
    }

  // 5. The highway ring, the radial highway, and interchanges.
  const d0 = S + 2;
  const yn = cy0 - d0, ys = cy1 + d0 + 1, xw = cx0 - d0, xe = cx1 + d0 + 1; // centerlines, on tile edges
  const ringFits = f.ring && [[xw - 1, yn - 1], [xe, yn - 1], [xw - 1, ys], [xe, ys]].every(([x, y]) => f.inside(x, y));
  if (ringFits) {
    const hwy = (id: string, path: [number, number][]) => out.push({ id, cls: "highway", path, lanes: [2, 2] });
    hwy("ring-n", [[xw - 0.5, yn], [xe + 0.5, yn]]);
    hwy("ring-s", [[xw - 0.5, ys], [xe + 0.5, ys]]);
    hwy("ring-w", [[xw, yn - 0.5], [xw, ys + 0.5]]);
    hwy("ring-e", [[xe, yn - 0.5], [xe, ys + 0.5]]);

    // Radial: the side with the least water straight out from its middle.
    type Side = "n" | "s" | "e" | "w";
    const mid = (side: Side) => {
      const vertical = side === "n" || side === "s";
      const base = vertical ? Mx + Math.round(cw / 2) : My + Math.round(ch / 2);
      const axisOfCrossers: Axis = vertical ? "y" : "x";
      for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
        const c = base + k;
        if (!crossers.some((l) => l.axis === axisOfCrossers && Math.abs(l.at + l.width / 2 - c) < 4)) return c;
      }
      return null;
    };
    const water = (side: Side, c: number) => {
      let wet = 0, len = 0;
      const step = side === "n" || side === "w" ? -1 : 1;
      const startAlong = side === "n" ? yn - 2 : side === "s" ? ys + 1 : side === "w" ? xw - 2 : xe + 1;
      for (let i = startAlong; ; i += step) {
        const [x, y] = side === "n" || side === "s" ? [c, i] : [i, c];
        if (!f.inside(x, y)) break;
        len++;
        if (f.tile(x, y) === "w") wet++;
      }
      return len >= 6 ? wet : Infinity;
    };
    let radial: { side: Side; c: number } | null = null;
    let best = Infinity;
    for (const side of ["s", "e", "n", "w"] as const) {
      const c = mid(side);
      if (c === null) continue;
      const wet = water(side, c);
      if (wet < best) {
        best = wet;
        radial = { side, c };
      }
    }
    if (radial) {
      const { side, c } = radial;
      if (side === "n") hwy("radial", [[c, yn], [c, reach("y", c - 1, 2, yn - 2, -1) + 0.5]]);
      if (side === "s") hwy("radial", [[c, ys], [c, reach("y", c - 1, 2, ys + 1, 1) + 0.5]]);
      if (side === "w") hwy("radial", [[xw, c], [reach("x", c - 1, 2, xw - 2, -1) + 0.5, c]]);
      if (side === "e") hwy("radial", [[xe, c], [reach("x", c - 1, 2, xe + 1, 1) + 0.5, c]]);
      reserved.push({ axis: side === "n" || side === "s" ? "y" : "x", at: c - 1, width: 2 });
    }

    const used: Record<Side, [number, number][]> = { n: [], s: [], e: [], w: [] };
    const ramps = (sideAxis: Axis, c: number, A: number) => {
      for (const D of [1, -1]) {
        const lat = sideAxis === "x" ? c + 1.5 * D : c - 1.5 * D;
        const p = (v: number): [number, number] => (sideAxis === "x" ? [v, lat] : [lat, v]);
        out.push({ id: `ramp-w${serial++}`, cls: "ramp", ramp: "off", path: [p(A - 5 * D), p(A - 1.5 * D)], lanes: [1, 0] });
        out.push({ id: `ramp-w${serial++}`, cls: "ramp", ramp: "on", path: [p(A + 1.5 * D), p(A + 5 * D)], lanes: [1, 0] });
      }
    };
    for (const l of crossers) {
      const A = l.at + l.width / 2;
      const sides: [Side, Axis, number, number, number][] =
        l.axis === "y" ? [["n", "x", yn, xw, xe], ["s", "x", ys, xw, xe]] : [["w", "y", xw, yn, ys], ["e", "y", xe, yn, ys]];
      for (const [side, sideAxis, c, s0, s1] of sides) {
        if (A - 5 < s0 + 3.5 || A + 5 > s1 - 3.5) continue;
        if (radial && radial.side === side && Math.abs(A - radial.c) < 8) continue;
        if (used[side].some(([u0, u1]) => A - 5.5 < u1 && u0 < A + 5.5)) continue;
        used[side].push([A - 5.5, A + 5.5]);
        ramps(sideAxis, c, A);
      }
    }
  }

  // 6. Country roads every 2G, well outside the suburbs (lines that cross the suburbs are arterials).
  const gapOut = S + (ringFits ? 7 : 2);
  for (const axis of ["x", "y"] as const) {
    const [c0, c1] = across(axis);
    for (let at = 0; at < f.N; at++) {
      if (!onLine(rel(axis, at), 2 * G)) continue;
      if (Math.max(c0 - at, at - c1) < gapOut) continue;
      if (near(axis, at, 1, 2)) continue;
      let first = -1, last = -1;
      for (let i = 0; i < f.N; i++)
        if (insideAll(axis, at, 1, i)) {
          if (first < 0) first = i;
          last = i;
        }
      if (first >= 0) add("local", axis, at, 1, first, last, { rural: true });
    }
  }
  return out;
}

/**
 * Split generated roads where they meet water too wide to bridge, or leave
 * the world. Pieces shorter than two tiles are dropped. Ends that stop at the
 * world's edge are flagged so cars can enter and leave there.
 */
export function fitRoads(defs: RoadDef[], f: Frame): RoadDef[] {
  const out: RoadDef[] = [];
  for (const d of defs) {
    const [[ax, ay], [bx, by]] = d.path;
    const horiz = ay === by;
    const w = roadWidth(d);
    const first = Math.round((horiz ? ay : ax) - w / 2);
    const a = horiz ? ax : ay, b = horiz ? bx : by;
    const lo = Math.min(a, b), hi = Math.max(a, b), rev = a > b;
    const i0 = Math.floor(lo), i1 = Math.floor(hi);
    const state = (i: number): "out" | "wet" | "land" => {
      let wet = false;
      for (let k = 0; k < w; k++) {
        const [X, Y] = horiz ? [i, first + k] : [first + k, i];
        if (!f.inside(X, Y)) return "out";
        if (f.tile(X, Y) === "w") wet = true;
      }
      return wet ? "wet" : "land";
    };
    const maxSpan = d.cls === "highway" ? 8 : 5;
    const states: ("out" | "wet" | "land")[] = [];
    for (let i = i0; i <= i1; i++) states.push(state(i));
    const keep = states.map((s) => s === "land");
    for (let k = 0; k < states.length; k++) {
      if (states[k] !== "wet") continue;
      let e = k;
      while (e + 1 < states.length && states[e + 1] === "wet") e++;
      if (e - k + 1 <= maxSpan && k > 0 && e + 1 < states.length && states[k - 1] === "land" && states[e + 1] === "land")
        for (let j = k; j <= e; j++) keep[j] = true;
      k = e;
    }
    let n = 0;
    for (let k = 0; k < keep.length; k++) {
      if (!keep[k]) continue;
      let e = k;
      while (e + 1 < keep.length && keep[e + 1]) e++;
      if (e > k) {
        const p = i0 + k, q = i0 + e;
        const from = k === 0 ? lo : p + 0.5, to = e === keep.length - 1 ? hi : q + 0.5;
        const edgeLo = state(p - 1) === "out", edgeHi = state(q + 1) === "out";
        const c = horiz ? ay : ax;
        const pt = (v: number): [number, number] => (horiz ? [v, c] : [c, v]);
        out.push({
          ...d,
          id: n === 0 ? d.id : `${d.id}.${n}`,
          path: rev ? [pt(to), pt(from)] : [pt(from), pt(to)],
          edge: rev ? [edgeHi, edgeLo] : [edgeLo, edgeHi],
        });
        n++;
      }
      k = e;
    }
  }
  return out;
}

/**
 * Stamp road tiles: highways first, then ramps, then everything else; a street
 * over a highway is an overpass. Returns the street tiles (not highways or
 * ramps) as "x,y" keys, for placing lots along them.
 */
export function stampRoads(g: TileChar[][], defs: RoadDef[]): Set<string> {
  const order = (r: RoadDef) => (r.cls === "highway" ? 0 : r.cls === "ramp" ? 1 : 2);
  const hwy = new Set<string>(), streets = new Set<string>();
  for (const d of [...defs].sort((a, b) => order(a) - order(b)))
    for (const [x, y] of roadTiles(d)) {
      const c = g[y]?.[x];
      if (c === undefined || c === " ") continue;
      const k = `${x},${y}`;
      if (c === "w" || c === "B") g[y][x] = "B";
      else if (hwy.has(k) && d.cls !== "highway") g[y][x] = "O";
      else if (c !== "O") g[y][x] = d.tram ? "t" : "=";
      if (d.cls === "highway") hwy.add(k);
      else if (d.cls !== "ramp") streets.add(k);
    }
  return streets;
}
```

- [ ] **Step 5: Replace `game/src/engine/world.ts`**

Replace the whole file with:

```ts
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
import { fitRoads, outskirtRoads, stampRoads, type Frame } from "./roads/outskirts.ts";
import type { RoadDef } from "./roads/types";
import { rngFor } from "./rng.ts";
import type { CityDef, FeatureSpec, LandmarkPlacement, Outskirts, TileChar, Zone } from "./types";

/** Half-width of the world in screen columns (dx - dy) and half-height in rows (dx + dy). */
export const RU = 58;
export const RV = 66;

const DEFAULTS: Outskirts = { terrain: "plains", farms: 0.35, forest: 0.25, suburbs: 10, grid: 6, beltway: true, features: [] };

const OPEN = new Set<TileChar>([".", "f", "F", "s", "~", "m"]);

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
  const frame: Frame = { N, Mx, My, cw, ch, S: o.suburbs, G: o.grid, ring: o.beltway, seed, inside: (X, Y) => inside(X, Y), tile: get };
  const roads = [...coreRoads, ...fitRoads(outskirtRoads(frame, coreRoads), frame)];
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
  // Strip malls where the frontage road meets the main roads.
  if (o.beltway) {
    const r = o.suburbs + 1;
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
```

Then append `terrainTile` and `findSpot` exactly as they are in the current file (lines 177-249), unchanged.

- [ ] **Step 6: Run the test**

Run: `node --test tests/roads-world.test.ts`
Expected: all tests pass.
If the live share is below 85% for a city, print the non-live lanes' road ids (`net.lanes.filter(l => !l.live).map(l => l.seg.road.id)`) and look for a class of road that never connects, such as a line that ends one tile short of the road it should meet; fix the generator, not the threshold.

- [ ] **Step 7: Typecheck, suite, look**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean.
Run `npm run dev` and look at Houston zoomed out: the ring, four ramps at each interchange, overpass tiles, the frontage road, cul-de-sacs, and the radial highway. Traffic still uses the old tile code, so cars may drive oddly on the new roads until Task 9.

- [ ] **Step 8: Commit**

```bash
git add src/engine/roads/outskirts.ts src/engine/world.ts src/engine/noise.ts src/engine/types.ts tests/roads-world.test.ts
git commit -m "World: a road hierarchy with a highway ring, interchanges, and cul-de-sacs"
```
