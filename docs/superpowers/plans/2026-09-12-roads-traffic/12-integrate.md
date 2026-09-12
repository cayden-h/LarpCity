# Task 12: City-scale tests, docs, build, and the browser pass

**Files:**
- Test: `game/tests/roads-cities-sim.test.ts`
- Modify: `game/README.md` (the `src/engine/` bullet)
- Modify: `CLAUDE.md` (the repo root; "Rendering and world" paragraph)

- [ ] **Step 1: Write the city-scale test**

Create `game/tests/roads-cities-sim.test.ts`:

```ts
// The whole road stack on every hand-made city and a few templates: a
// morning rush with no collisions, steady arrivals, and few watchdog drops.
// Also reports the sim's step time with a full city of cars. Run with `npm test`.

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
import { CityGrid } from "../src/engine/grid.ts";
import { buildGraph } from "../src/engine/roads/graph.ts";
import { DT, Sim } from "../src/engine/roads/sim.ts";
import { buildPlaces, buildSpots, Trips } from "../src/engine/roads/trips.ts";
import type { CityDef } from "../src/engine/types.ts";
import { expandWorld } from "../src/engine/world.ts";
import { zoneAt } from "../src/engine/zones.ts";

function setup(source: CityDef) {
  const city = expandWorld(source, 7).city;
  const grid = new CityGrid(city.layout);
  const net = buildGraph(city.roads, { core: city.core });
  const lots: { x: number; y: number; w: number; d: number }[] = [];
  for (const { x, y, c } of grid.cells()) if (c === "b") lots.push({ x, y, w: 1, d: 1 });
  const sim = new Sim(net);
  const trips = new Trips(sim, buildPlaces(net, lots, (x, y) => zoneAt(city, x, y)), buildSpots(net), city.vehicles, 7);
  return { sim, trips };
}

const CITIES = [houston, dallas, austin, miami, newYork, sanFrancisco, ...[STATES[4], STATES[20], STATES[33], STATES[44]].map(templateCity)];

for (const source of CITIES)
  test(`${source.id}: a morning rush runs clean`, () => {
    const { sim, trips } = setup(source);
    trips.target = 150;
    trips.hour = 8;
    let dropped = 0;
    const finish = sim.onDone;
    sim.onDone = (c) => {
      if (c.dropped) dropped++;
      finish(c);
    };
    for (let i = 0; i < 90 / DT; i++) {
      sim.step();
      trips.tick();
      if (i % 20 === 0) {
        const errs = sim.check();
        if (errs.length) assert.fail(`t=${sim.time.toFixed(1)}: ${errs.slice(0, 3).join("; ")}`);
      }
    }
    const arrived = Object.values(trips.arrivals).reduce((a, b) => a + b, 0);
    assert.ok(arrived > 30, `only ${arrived} arrivals: ${JSON.stringify(trips.arrivals)}`);
    assert.ok(dropped <= Math.max(2, arrived * 0.03), `${dropped} cars dropped by the watchdog`);
  });

test("step time with 250 cars (reported)", () => {
  const { sim, trips } = setup(houston);
  trips.target = 250;
  trips.hour = 8;
  for (let i = 0; i < 60 / DT; i++) {
    sim.step();
    trips.tick();
  }
  const t0 = performance.now();
  const n = 400;
  for (let i = 0; i < n; i++) {
    sim.step();
    trips.tick();
  }
  const ms = (performance.now() - t0) / n;
  console.log(`[roads] ${sim.cars.length} cars: ${ms.toFixed(3)} ms per step`);
  assert.ok(sim.cars.length > 150);
});
```

- [ ] **Step 2: Run it**

Run: `node --test tests/roads-cities-sim.test.ts`
Expected: all pass; the report line shows the step time (the spec's goal is under 1 ms; if it is above 2 ms, profile with `node --cpu-prof --test tests/roads-cities-sim.test.ts` and fix the hot spot before moving on, most likely `indexOf` on long track arrays or `sim.cars.filter` in `keepSpecials`).
If a city fails with collisions or drops, reproduce it alone with `--test-name-pattern="<city id>"`, print the offending node's control and movements, and fix the rule in `sim.ts` or the geometry in `graph.ts`/`outskirts.ts`; do not loosen the test.

- [ ] **Step 3: Docs**

In `game/README.md`, replace the `src/engine/` bullet with:

```md
- `src/engine/`: the scene and camera, the world builder that wraps each city in suburbs, farms, and terrain (`world.ts`), isometric math, the chunked studded ground (`ground.ts`), the brick building builder (`bricks.ts`), traffic drawing and boats (`traffic.ts`), NPCs on foot (`people.ts`), weather effects, and the player's home.
- `src/engine/roads/`: the road network and traffic sim ([spec](../docs/superpowers/specs/2026-09-12-roads-traffic-design.md)).
  Cities and the world builder emit `RoadDef` vectors (`types.ts`, `outskirts.ts` for the generated roads, highway ring, and interchanges), and the layout's road tiles are stamped from them.
  `graph.ts` builds nodes, lanes, and movements with their conflicts; `control.ts` picks signals, stop signs, and yields and runs signal phases; `sim.ts` drives cars (car-following, intersection admission, lane changes, a watchdog); `router.ts` and `trips.ts` plan rush-hour trips, curb parking, buses, and cable cars; `sidewalks.ts` walks people and crosses them at crosswalks; `marks.ts` and `draw.ts` paint markings, signals, signs, and overpass decks.
  None of it but `draw.ts` imports PixiJS, so it is all tested headless (`tests/roads-*.test.ts`).
```

In the repo root `CLAUDE.md`, in the "Rendering and world" paragraph, after the sentence about `engine/world.ts`, add:

```md
Roads are vectors: `engine/roads/` turns each city's `RoadDef`s into a lane graph with controlled intersections, and a headless fixed-step sim (`roads/sim.ts`, `roads/trips.ts`) drives trip-based traffic and pedestrians that `traffic.ts` and `people.ts` only draw.
```

- [ ] **Step 4: Full verification**

Run from `game/`: `npm run build && npm test`
Expected: the typecheck and both page builds succeed; every test passes.

- [ ] **Step 5: The browser pass**

Run `npm run dev` and, for San Francisco, Houston, New York, and one template state, at zoom 0.72 (default), 1.5, and 3, by day and at night:

- signals cycle and queues clear; protected and permitted lefts behave; all-way stops take turns;
- highway merges and exits at every interchange, cars over and under overpasses with correct depth;
- parking and pulling out, buses at stops, SF cable cars on the tram line;
- people cross on the walk light and turning cars wait for them;
- no car overlaps another, pops without a fade, or flickers between facings;
- markings line up with lanes and curbs to the pixel.

Take a screenshot of each city and fix anything that looks off, then re-run Step 4.

- [ ] **Step 6: Commit and finish the branch**

```bash
git add tests/roads-cities-sim.test.ts README.md ../CLAUDE.md
git commit -m "Roads: city-scale sim tests and docs"
```

Then use superpowers:finishing-a-development-branch: fetch `origin/main`, rebase or merge it into `roads-traffic`, re-run Step 4, and open the PR (other sessions push to this repo, including the houses work on `blender-houses`, so check for conflicts in `world.ts`, `populate.ts`, `scene.ts`, and `san-francisco.ts`).
