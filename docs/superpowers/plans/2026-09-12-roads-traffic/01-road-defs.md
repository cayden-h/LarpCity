# Task 1: Road types, `LayoutBuilder` records roads, the `O` tile

**Files:**
- Create: `game/src/engine/roads/types.ts`
- Modify: `game/src/engine/layout.ts`
- Modify: `game/src/engine/types.ts` (TileChar)
- Modify: `game/src/engine/grid.ts:5-6`
- Modify: `game/src/engine/world.ts:27` (ROADS set)
- Modify: `game/src/engine/ground.ts:135,165` (asphalt for `O`)
- Test: `game/tests/roads-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-layout.test.ts`:

```ts
// LayoutBuilder records every road it stamps as a RoadDef. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutBuilder } from "../src/engine/layout.ts";
import { roadTiles, roadWidth } from "../src/engine/roads/types.ts";

test("roadX records a local road through tile centers", () => {
  const L = new LayoutBuilder(10, 6);
  L.roadX(2, 1, 8);
  const [r] = L.roads();
  assert.equal(r.cls, "local");
  assert.deepEqual(r.lanes, [1, 1]);
  assert.deepEqual(r.path, [[1.5, 2.5], [8.5, 2.5]]);
  assert.equal(L.get(1, 2), "=");
  assert.equal(L.get(8, 2), "=");
});

test("arterialX stamps two rows and puts the centerline on their shared edge", () => {
  const L = new LayoutBuilder(10, 6);
  L.arterialX(2, 0, 9);
  const [r] = L.roads();
  assert.equal(r.cls, "arterial");
  assert.equal(roadWidth(r), 2);
  assert.deepEqual(r.path, [[0.5, 3], [9.5, 3]]);
  for (let x = 0; x < 10; x++) {
    assert.equal(L.get(x, 2), "=");
    assert.equal(L.get(x, 3), "=");
  }
});

test("arterialY centerline sits between its two columns", () => {
  const L = new LayoutBuilder(8, 8);
  L.arterialY(3, 0, 7);
  assert.deepEqual(L.roads()[0].path, [[4, 0.5], [4, 7.5]]);
});

test("short water becomes a bridge inside one road; wide water splits it", () => {
  const L = new LayoutBuilder(20, 4);
  L.rect(4, 0, 2, 4, "w"); // 2 wide: bridged
  L.rect(10, 0, 6, 4, "w"); // 6 wide: too wide
  L.roadX(1, 0, 19, "=", 5);
  const roads = L.roads();
  assert.equal(roads.length, 2);
  assert.deepEqual(roads[0].path, [[0.5, 1.5], [9.5, 1.5]]);
  assert.deepEqual(roads[1].path, [[16.5, 1.5], [19.5, 1.5]]);
  assert.equal(L.get(4, 1), "B");
  assert.equal(L.get(12, 1), "w");
});

test("tiles painted over after stamping trim the road", () => {
  const L = new LayoutBuilder(12, 4);
  L.roadX(1, 0, 11);
  L.rect(5, 1, 1, 1, "p");
  const roads = L.roads();
  assert.equal(roads.length, 2);
  assert.deepEqual(roads[0].path, [[0.5, 1.5], [4.5, 1.5]]);
  assert.deepEqual(roads[1].path, [[6.5, 1.5], [11.5, 1.5]]);
  assert.notEqual(roads[0].id, roads[1].id);
});

test("tram roads carry the tram flag", () => {
  const L = new LayoutBuilder(6, 6);
  L.roadY(2, 0, 5, "t");
  assert.equal(L.roads()[0].tram, true);
});

test("roadTiles lists exactly the stamped tiles", () => {
  const L = new LayoutBuilder(10, 10);
  L.arterialY(4, 1, 8);
  const tiles = roadTiles(L.roads()[0]).map(([x, y]) => `${x},${y}`).sort();
  const want: string[] = [];
  for (let y = 1; y <= 8; y++) for (const x of [4, 5]) want.push(`${x},${y}`);
  assert.deepEqual(tiles, want.sort());
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-layout.test.ts`
Expected: FAIL, `Cannot find module '.../src/engine/roads/types.ts'`.

- [ ] **Step 3: Create `game/src/engine/roads/types.ts`**

```ts
// Road network data: road classes and the RoadDef vectors cities and the
// world builder emit. The tile grid is stamped from these; the graph
// (graph.ts) and the traffic sim (sim.ts) read them.

export type RoadClass = "local" | "collector" | "arterial" | "highway" | "ramp";

export interface RoadDef {
  id: string;
  cls: RoadClass;
  /** Centerline in tile coordinates, axis-aligned pieces only. */
  path: [number, number][];
  /** Lanes along the path's direction and against it (0 against = one-way). */
  lanes: [number, number];
  tram?: boolean;
  /** A country road: local class, driven faster. */
  rural?: boolean;
  /** Whether the path's start and end stop at the world's edge, where cars enter and leave. */
  edge?: [boolean, boolean];
  /**
   * Ramps only: an "off" ramp's path starts beside the highway (it diverges),
   * an "on" ramp's path ends beside it (it merges). The path runs in the
   * direction of travel.
   */
  ramp?: "on" | "off";
}

/** Every lane is half a tile wide, so a 1-tile row of road holds two lanes. */
export const LANE_W = 0.5;

/** Desired speed in tiles per second. */
const SPEED: Record<RoadClass, number> = { local: 0.8, collector: 1.0, arterial: 1.25, highway: 1.8, ramp: 1.2 };

/** Importance, used to pick intersection control. */
export const RANK: Record<RoadClass, number> = { local: 0, ramp: 1, collector: 1, arterial: 2, highway: 3 };

export function defaultLanes(cls: RoadClass): [number, number] {
  if (cls === "ramp") return [1, 0];
  if (cls === "arterial" || cls === "highway") return [2, 2];
  return [1, 1];
}

/** Width in tiles: half the total lane count, at least one tile. */
export function roadWidth(r: Pick<RoadDef, "lanes">): number {
  return Math.max(1, Math.ceil((r.lanes[0] + r.lanes[1]) / 2));
}

export function roadSpeed(r: Pick<RoadDef, "cls" | "rural">): number {
  return r.rural ? 1.3 : SPEED[r.cls];
}

/** Every tile a road covers. */
export function roadTiles(r: RoadDef): [number, number][] {
  const w = roadWidth(r);
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < r.path.length; k++) {
    const [ax, ay] = r.path[k], [bx, by] = r.path[k + 1];
    const horiz = ay === by;
    const across = horiz ? ay : ax;
    const first = Math.round(across - w / 2);
    const lo = Math.floor(Math.min(horiz ? ax : ay, horiz ? bx : by));
    const hi = Math.floor(Math.max(horiz ? ax : ay, horiz ? bx : by));
    for (let i = lo; i <= hi; i++)
      for (let j = first; j < first + w; j++) {
        const t: [number, number] = horiz ? [i, j] : [j, i];
        const key = `${t[0]},${t[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(t);
        }
      }
  }
  return out;
}
```

- [ ] **Step 4: Add the `O` tile**

In `game/src/engine/types.ts`, change the layout comment and `TileChar`:

```ts
/**
 * Layout characters, one per tile:
 *   .  grass           =  road            B  bridge (road over water)
 *   w  water           s  sand / beach    ~  marsh / reeds
 *   b  building lot    p  park (trees)    P  plaza (paved, for landmarks)
 *   h  player's home   t  tram road (road with rails)
 *   O  overpass (a road over another road)
 *   f  farmland        F  forest          m  mountain rock
 *   ' ' (space) is outside the map; the world builder fills it in.
 */
export type TileChar = "." | "=" | "B" | "w" | "s" | "~" | "b" | "p" | "P" | "h" | "t" | "O" | "f" | "F" | "m" | " ";
```

In `game/src/engine/grid.ts` replace lines 5-6:

```ts
const ROADLIKE = new Set<TileChar>(["=", "B", "t", "O"]);
const LAND = new Set<TileChar>([".", "=", "s", "~", "b", "p", "P", "h", "t", "O", "f", "F", "m"]);
```

In `game/src/engine/world.ts` line 27:

```ts
const ROADS = new Set<TileChar>(["=", "B", "t", "O"]);
```

In `game/src/engine/ground.ts`, line 135 becomes `c === "=" || c === "t" || c === "O"` and line 165 becomes:

```ts
        if (c === "=" || c === "t" || c === "O") this.drawRoad(marks, x, y, c === "t");
```

- [ ] **Step 5: Make `LayoutBuilder` record roads**

In `game/src/engine/layout.ts`, replace the imports, the class fields, `roadX`, `roadY`, and the private `road` method with the following (keep `set`, `get`, `rect`, `path`, `replace`, `frontage`, `shore`, `clipCorners`, `build` as they are):

```ts
import { defaultLanes, roadWidth, type RoadClass, type RoadDef } from "./roads/types.ts";
import type { TileChar } from "./types";

const ROADISH = new Set<TileChar>(["=", "B", "t", "O"]);

export class LayoutBuilder {
  private readonly g: TileChar[][];
  private readonly defs: RoadDef[] = [];
  readonly w: number;
  readonly h: number;
```

```ts
  /**
   * A local street along row y. Water crossings up to `maxSpan` tiles become
   * bridges; wider water (a lake or open coast) splits the road at the shore.
   */
  roadX(y: number, x0 = 0, x1 = this.w - 1, c: TileChar = "=", maxSpan = Infinity): this {
    return this.run("local", "x", y, 1, x0, x1, c, maxSpan);
  }

  roadY(x: number, y0 = 0, y1 = this.h - 1, c: TileChar = "=", maxSpan = Infinity): this {
    return this.run("local", "y", x, 1, y0, y1, c, maxSpan);
  }

  /** A four-lane arterial on rows y and y + 1. */
  arterialX(y: number, x0 = 0, x1 = this.w - 1, maxSpan = Infinity): this {
    return this.run("arterial", "x", y, 2, x0, x1, "=", maxSpan);
  }

  /** A four-lane arterial on columns x and x + 1. */
  arterialY(x: number, y0 = 0, y1 = this.h - 1, maxSpan = Infinity): this {
    return this.run("arterial", "y", x, 2, y0, y1, "=", maxSpan);
  }

  private run(cls: RoadClass, axis: "x" | "y", line: number, width: number, from: number, to: number, c: TileChar, maxSpan: number): this {
    const tile = (i: number, k: number): [number, number] => (axis === "x" ? [i, line + k] : [line + k, i]);
    const wet = (i: number) => {
      for (let k = 0; k < width; k++) {
        const t = this.get(...tile(i, k));
        if (t === "w" || t === "B") return true;
      }
      return false;
    };
    const stamp = (i: number, ch: TileChar) => {
      for (let k = 0; k < width; k++) this.set(...tile(i, k), ch);
    };
    let start = -1;
    const close = (end: number) => {
      if (start >= 0 && end > start) this.record(cls, axis, line, width, start, end, c === "t");
      start = -1;
    };
    for (let i = from; i <= to; i++) {
      if (!wet(i)) {
        stamp(i, c);
        if (start < 0) start = i;
        continue;
      }
      let end = i;
      while (end + 1 <= to && wet(end + 1)) end++;
      if (end - i + 1 <= maxSpan) {
        for (let k = i; k <= end; k++) stamp(k, "B");
        if (start < 0) start = i;
      } else close(i - 1);
      i = end;
    }
    close(to);
    return this;
  }

  private record(cls: RoadClass, axis: "x" | "y", line: number, width: number, from: number, to: number, tram: boolean): void {
    const c = line + width / 2;
    const path: [number, number][] = axis === "x" ? [[from + 0.5, c], [to + 0.5, c]] : [[c, from + 0.5], [c, to + 0.5]];
    const def: RoadDef = { id: `${cls}-${this.defs.length}`, cls, path, lanes: defaultLanes(cls) };
    if (tram) def.tram = true;
    this.defs.push(def);
  }

  /**
   * The recorded roads, trimmed to what is still road in the final layout
   * (parks, landmarks, and clipped corners painted later cut them).
   */
  roads(): RoadDef[] {
    const out: RoadDef[] = [];
    for (const d of this.defs) {
      const [[ax, ay], [bx, by]] = d.path;
      const horiz = ay === by;
      const w = roadWidth(d);
      const first = Math.round((horiz ? ay : ax) - w / 2);
      const lo = Math.floor(Math.min(horiz ? ax : ay, horiz ? bx : by));
      const hi = Math.floor(Math.max(horiz ? ax : ay, horiz ? bx : by));
      const ok = (i: number) => {
        for (let k = first; k < first + w; k++) if (!ROADISH.has(horiz ? this.get(i, k) : this.get(k, i))) return false;
        return true;
      };
      let start = -1;
      let n = 0;
      for (let i = lo; i <= hi + 1; i++) {
        if (i <= hi && ok(i)) {
          if (start < 0) start = i;
          continue;
        }
        if (start >= 0 && i - 1 > start) {
          const c = horiz ? ay : ax;
          const path: [number, number][] = horiz ? [[start + 0.5, c], [i - 0.5, c]] : [[c, start + 0.5], [c, i - 0.5]];
          out.push({ ...d, id: n === 0 ? d.id : `${d.id}.${n}`, path });
          n++;
        }
        start = -1;
      }
    }
    return out;
  }
```

Delete the old private `road(from, to, at, c, maxSpan)` method; `run` replaces it.

- [ ] **Step 6: Run the test and watch it pass**

Run: `node --test tests/roads-layout.test.ts`
Expected: 7 tests pass.

- [ ] **Step 7: Typecheck and the full suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/engine/roads/types.ts src/engine/layout.ts src/engine/types.ts src/engine/grid.ts src/engine/world.ts src/engine/ground.ts tests/roads-layout.test.ts
git commit -m "Roads: LayoutBuilder records every road it stamps as a RoadDef"
```
