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
    // Water splits never leave a generated road cut off from the network.
    const coreIds = new Set(source.roads.map((r) => r.id));
    const reached = new Set(net.lanes.filter((l) => l.live).map((l) => l.seg.road));
    for (const r of city.roads) if (!coreIds.has(r.id)) assert.ok(reached.has(r), `${r.id} is cut off from the network`);
  });

/** Chebyshev distance of a point from the core's rectangle. */
const coreDist = (core: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) =>
  Math.max(core.x - p.x, p.x - (core.x + core.w), core.y - p.y, p.y - (core.y + core.h), 0);

test("suburbs have cul-de-sacs", () => {
  for (const source of [houston, dallas, austin, miami, newYork, sanFrancisco, ...STATES.slice(0, 4).map(templateCity)]) {
    const { city } = expandWorld(source, 7);
    const core = city.core!;
    const S = source.outskirts?.suburbs ?? 10;
    const net = buildGraph(city.roads, { core });
    const culs = net.nodes.filter((n) => {
      const road = n.arms[0]?.seg.road;
      const d = coreDist(core, n.p);
      return n.kind === "end" && n.arms.length === 1 && road.cls === "local" && !road.rural && d >= 2 && d <= S && n.movements.some((m) => m.turn === "uturn" && m.live);
    });
    assert.ok(culs.length > 0, `${source.id}: no cul-de-sac in the suburbs`);
  }
});

const EVERY_WORLD: CityDef[] = [houston, dallas, austin, miami, newYork, sanFrancisco, ...STATES.map(templateCity)];

test("every arterial is four lanes", () => {
  for (const source of EVERY_WORLD)
    for (const r of expandWorld(source, 7).city.roads)
      if (r.cls === "arterial") assert.deepEqual(r.lanes, [2, 2], `${source.id}: ${r.id} is an arterial with lanes ${r.lanes}`);
});

test("no highway dead-ends in a U-turn", () => {
  for (const source of EVERY_WORLD) {
    const { city } = expandWorld(source, 7);
    const net = buildGraph(city.roads, { core: city.core });
    const uturns = net.movements.filter((m) => m.turn === "uturn" && !m.portal && m.from.seg.road.cls === "highway");
    assert.equal(uturns.length, 0, `${source.id}: highway U-turns at ${uturns.map((m) => `${m.node.p.x},${m.node.p.y}`).join(" ")}`);
  }
});

test("Houston's main arterials get interchanges where they cross the ring", () => {
  const { city } = expandWorld(houston, 7);
  const core = city.core!;
  // Centerlines of the arterials on core columns 13-14 and rows 8-9.
  const X = core.x + 14, Y = core.y + 9;
  const streetEnds = city.roads.filter((r) => r.cls === "ramp").map((r) => (r.ramp === "off" ? r.path[r.path.length - 1] : r.path[0]));
  const north = streetEnds.filter(([x, y]) => Math.abs(x - X) < 1.51 && y < core.y);
  const south = streetEnds.filter(([x, y]) => Math.abs(x - X) < 1.51 && y > core.y + core.h);
  const west = streetEnds.filter(([x, y]) => Math.abs(y - Y) < 1.51 && x < core.x);
  for (const [side, ends] of [["north", north], ["south", south], ["west", west]] as const)
    assert.ok(ends.length >= 2, `${side}: ${ends.length} ramps meet the main arterial`);
});

test("a city with a beltway gets a highway ring, interchanges, and overpasses", () => {
  const withRing = [houston, dallas, austin, miami, newYork]
    .map((c) => expandWorld(c, 7).city)
    .filter((c) => c.roads.some((r) => r.cls === "highway"));
  assert.ok(withRing.length > 0, "no city got a ring");
  let full = 0;
  for (const city of withRing) {
    const net = buildGraph(city.roads, { core: city.core });
    // Where water cuts the ring, it ends at a half interchange (a terminal), so a short ring may have only two merges.
    const merges = net.nodes.filter((n) => n.kind === "merge").length;
    assert.ok(merges >= 2, `${city.id}: no interchange`);
    assert.ok(net.movements.some((m) => m.turn === "merge" && m.live), `${city.id}: no live on-ramp`);
    if (merges >= 4 && city.layout.some((row) => row.includes("O"))) full++;
  }
  assert.ok(full >= 3, `only ${full} cities have a full interchange and an overpass`);
});

test("the world is the same for the same seed", () => {
  const a = expandWorld(houston, 7).city, b = expandWorld(houston, 7).city;
  assert.deepEqual(a.layout, b.layout);
  assert.deepEqual(a.roads, b.roads);
});
