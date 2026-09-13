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
