# Task 2: Six cities and the templates emit roads, with arterials

**Files:**
- Modify: `game/src/engine/layout.ts` (`build()` clears road tiles no road covers)
- Modify: `game/src/engine/types.ts` (`CityDef.roads`)
- Modify: `game/src/engine/world.ts:173` (carry core roads, offset)
- Modify: `game/src/cities/{san-francisco,houston,dallas,austin,new-york,miami,templates}.ts`
- Test: `game/tests/roads-cities.test.ts`

Arterial choices (checked against every landmark footprint and home tile):

| City | Arterials (2 tiles) | Replaces |
|---|---|---|
| San Francisco | rows 6-7 (x 10-34, the Embarcadero); cols 27-28 (y 6-29) | row 6 local, col 28 local |
| Houston | rows 8-9 (x 0-35, across the channel); cols 13-14 (y 0-31) | row 8 local, col 14 local |
| Dallas | rows 12-13 (full width); cols 23-24 (full height) | the doubled locals 12+13 and 23+24 |
| Austin | rows 14-15 (x 3-32); cols 24-25 (y 1-15 and 21-30) | row 15 local, col 24 local |
| New York | cols 19-20 (y 2-25, Fifth Avenue); rows 24-25 (x 5-26) | col 20 local, row 25 local |
| Miami | cols 6-7 (y 0-31); cols 24-25 (y 0-31, the island spine) | col 6 local, col 25 local |
| Templates | the grid line below the capitol block, full width | that grid line's local |

The Golden Gate approach (SF row 12), the Congress Avenue bat bridge (Austin col 17), and the Houston row 20 crossing stay two-lane because their bridge landmarks are one tile wide.

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-cities.test.ts`:

```ts
// Every city's recorded roads match its road tiles exactly. Run with `npm test`.

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
import { roadTiles } from "../src/engine/roads/types.ts";
import type { CityDef } from "../src/engine/types.ts";

const ROADISH = new Set(["=", "B", "t", "O"]);
const HANDMADE = [houston, dallas, austin, miami, newYork, sanFrancisco];

function check(city: CityDef): void {
  const at = (x: number, y: number) => city.layout[y]?.[x] ?? " ";
  const covered = new Set<string>();
  for (const r of city.roads)
    for (const [x, y] of roadTiles(r)) {
      assert.ok(ROADISH.has(at(x, y)), `${city.id}: ${r.id} covers ${x},${y} = "${at(x, y)}"`);
      covered.add(`${x},${y}`);
    }
  city.layout.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (ROADISH.has(c)) assert.ok(covered.has(`${x},${y}`), `${city.id}: road tile ${x},${y} has no road`);
    }),
  );
}

for (const city of HANDMADE)
  test(`${city.id}: roads match road tiles and include an arterial`, () => {
    check(city);
    assert.ok(city.roads.some((r) => r.cls === "arterial"), `${city.id} has no arterial`);
  });

test("every template city's roads match its road tiles", () => {
  for (const s of STATES) check(templateCity(s));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-cities.test.ts`
Expected: FAIL; the city modules import `../engine/layout` without an extension (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: `CityDef.roads`**

In `game/src/engine/types.ts` add `import type { RoadDef } from "./roads/types";` next to the other imports, and inside `CityDef` after `layout: string[];`:

```ts
  /** The road network; the layout's road tiles are stamped from it. */
  roads: RoadDef[];
```

- [ ] **Step 4: `build()` clears road tiles that no road covers**

In `game/src/engine/layout.ts` change the import to `import { defaultLanes, roadTiles, roadWidth, type RoadClass, type RoadDef } from "./roads/types.ts";` and replace `build()`:

```ts
  /** The layout strings. Road tiles no recorded road covers (1-tile stubs) go back to grass or water. */
  build(): string[] {
    const covered = new Set<number>();
    for (const r of this.roads()) for (const [x, y] of roadTiles(r)) covered.add(y * this.w + x);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.g[y][x];
        if (ROADISH.has(c) && !covered.has(y * this.w + x)) this.g[y][x] = c === "B" ? "w" : ".";
      }
    return this.g.map((row) => row.join(""));
  }
```

- [ ] **Step 5: San Francisco**

In `game/src/cities/san-francisco.ts`:

```ts
import { LayoutBuilder } from "../engine/layout.ts";
import type { RoadDef } from "../engine/roads/types";
import type { CityDef, Climate, LandmarkPlacement } from "../engine/types";
```

Change `function layout(): string[] {` to `function layout(): { layout: string[]; roads: RoadDef[] } {`, and replace the street lines 33-36:

```ts
  // City grid: the Embarcadero along the bay (four lanes), the bridge approach, and cross streets.
  L.arterialX(6, 10, 34);
  L.roadX(12, 3, 34); // crosses the strait as the Golden Gate
  for (const y of [17, 23, 29]) L.roadX(y, 10, 34);
  for (const x of [10, 34]) L.roadY(x, 6, 29);
  L.arterialY(27, 6, 29); // the main avenue, waterfront to the southern hills
```

Replace `return L.build();` with:

```ts
  const grid = L.build();
  return { layout: grid, roads: L.roads() };
```

At the top of the file after `layout()` add `const core = layout();` and in the `sanFrancisco` object replace `layout: layout(),` with:

```ts
  layout: core.layout,
  roads: core.roads,
```

- [ ] **Step 6: Houston**

In `game/src/cities/houston.ts` make the same import, signature, return, and `core` changes as Step 5, and replace lines 22-24:

```ts
  for (const y of [2, 14, 26]) L.roadX(y, 0, 29);
  L.roadX(20, 0, 35); // crosses the channel to the port
  L.arterialX(8, 0, 35); // four lanes across the channel to the port
  for (const x of [2, 8, 20, 26]) L.roadY(x, 0, 31);
  L.arterialY(13, 0, 31); // the main north-south avenue, west of the beacon tower
```

- [ ] **Step 7: Dallas**

In `game/src/cities/dallas.ts` make the same import and signature changes, and replace lines 28-32:

```ts
  // Surface streets and river crossings; the two freeways are four-lane arterials.
  for (const y of [4, 20, 27]) L.roadX(y);
  L.arterialX(12);
  L.roadX(8, 14, 24); // downtown cross street
  L.roadY(1, 4, 27); // Oak Cliff, on the west bank
  for (const x of [14, 19, 30]) L.roadY(x);
  L.arterialY(23);
```

Replace `return L.build();` with `const g = L.build();` then `return { layout: g, roads: L.roads() };`.
Replace `const grid = layout();` (line 62) with:

```ts
const core = layout();
const grid = core.layout;
```

and in the `dallas` object add `roads: core.roads,` after `layout: grid,`.

- [ ] **Step 8: Austin**

In `game/src/cities/austin.ts` make the import, signature, return, and `core` changes of Step 5, and replace lines 25-31:

```ts
  // East-west streets; the lakeshore drives are rows 14-15 (four lanes) and 21.
  for (const y of [1, 6, 10, 21, 26, 30]) L.roadX(y, 3, 32);
  L.arterialX(14, 3, 32);
  // North-south streets. Columns 3, 17 (the main avenue), and 32 bridge the lake.
  L.roadY(3, 1, 30);
  L.roadY(32, 1, 30);
  L.roadY(17, 10, 30); // the avenue starts at the capitol's front steps
  L.roadY(10, 1, 15).roadY(10, 21, 30);
  L.arterialY(24, 1, 15).arterialY(24, 21, 30);
```

- [ ] **Step 9: New York**

In `game/src/cities/new-york.ts` make the import, signature, return, and `core` changes of Step 5, and replace lines 24-28:

```ts
  // Manhattan avenues (north-south) and streets (east-west), three tiles apart; Fifth Avenue is four lanes.
  for (const x of [5, 8, 23, 26]) L.roadY(x, 2, 25);
  L.arterialY(19, 2, 25);
  for (const x of [11, 14, 17]) L.roadY(x, 10, 25); // these stop at the park
  L.roadX(2, 5, 26);
  for (const y of [16, 19]) L.roadX(y, 5, 26);
  L.arterialX(24, 5, 26);
```

- [ ] **Step 10: Miami**

In `game/src/cities/miami.ts` make the import, signature, return, and `core` changes of Step 5, replace line 32:

```ts
  L.roadY(2, 0, 31).roadY(11, 0, 31);
  L.arterialY(6, 0, 31); // Biscayne Boulevard
```

and replace line 39 (`L.roadY(25, 0, 31);`):

```ts
  L.arterialY(24, 0, 31);
```

- [ ] **Step 11: Templates**

In `game/src/cities/templates.ts` change the runtime imports:

```ts
import { LayoutBuilder } from "../engine/layout.ts";
import { hashKeys, rngFor } from "../engine/rng.ts";
import type { BackdropDef, BoatKind, CityDef, CityPalette, Climate, LandmarkPlacement, StateInfo, VehicleKind, WeatherKind } from "../engine/types";
import { DEFAULT_VIBE, VIBES, type Side, type StateVibe } from "./vibes.ts";
```

Replace the two road loops after `const S = vibe.grid;` with:

```ts
  const by = 2 + S * Math.max(0, Math.floor((H / 2 - 2) / S) - 1);
  // The main street: the grid line below the capitol block, widened to four lanes.
  const main = by + S + 1 < H - 1 ? by + S : -1;
  for (let y = 2; y < H - 1; y += S) if (y !== main) L.roadX(y, 0, W - 1, "=", 5);
  if (main >= 0) L.arterialX(main, 0, W - 1, 5);
  for (let x = 2; x < W - 1; x += S) L.roadY(x, 0, H - 1, "=", 5);
```

Change the later `const bx = ..., by = ...;` line to define only `bx` (same expression as today for `bx`).
In the returned object replace `layout: L.build(),` with:

```ts
    layout: L.build(),
    roads: L.roads(),
```

- [ ] **Step 12: The world builder carries the core's roads**

In `game/src/engine/world.ts` line 173, add `roads` to the expanded city (Task 6 replaces this with the full network):

```ts
  const roads = source.roads.map((r) => ({ ...r, path: r.path.map(([x, y]): [number, number] => [x + Mx, y + My]) }));
  const city: CityDef = { ...source, layout: g.map((row) => row.join("")), roads, landmarks, zones, traffic: Math.round(source.traffic * 2.4) };
```

- [ ] **Step 13: Run the test**

Run: `node --test tests/roads-cities.test.ts`
Expected: 7 tests pass.
If a `road tile ... has no road` failure names a tile, the tile was stamped by code outside `LayoutBuilder` road calls; find it with `grep -n '"="' src/cities/<city>.ts` and route it through `roadX`/`roadY`.

- [ ] **Step 14: Typecheck, the full suite, and a look**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean. If `tsc` reports a `CityDef` literal missing `roads` anywhere else, add `roads: []` there only if it is test or dev data; real cities must come from `LayoutBuilder`.
Run `npm run dev`, open San Francisco, and confirm the Embarcadero and the main avenue are two tiles wide and no lot or landmark was cut in half.

- [ ] **Step 15: Commit**

```bash
git add src tests/roads-cities.test.ts
git commit -m "Cities: record roads and widen each city's main streets into arterials"
```
