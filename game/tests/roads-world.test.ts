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
