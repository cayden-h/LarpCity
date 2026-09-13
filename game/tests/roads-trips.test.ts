// Routing, places, parking, and trips on a real city. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { houston } from "../src/cities/houston.ts";
import { CityGrid } from "../src/engine/grid.ts";
import { buildGraph, type Lane } from "../src/engine/roads/graph.ts";
import { route } from "../src/engine/roads/router.ts";
import { DT, Sim } from "../src/engine/roads/sim.ts";
import { buildPlaces, buildSpots, demand, Trips } from "../src/engine/roads/trips.ts";
import type { RoadDef } from "../src/engine/roads/types.ts";
import { expandWorld } from "../src/engine/world.ts";
import { zoneAt } from "../src/engine/zones.ts";

const plus = () =>
  buildGraph([
    { id: "x", cls: "arterial", path: [[0.5, 10], [30.5, 10]], lanes: [2, 2] } as RoadDef,
    { id: "y", cls: "collector", path: [[15.5, 0.5], [15.5, 30.5]], lanes: [1, 1] } as RoadDef,
  ]);

test("a route is a connected chain of movements and lane changes ending on the goal lane", () => {
  const net = plus();
  const from = net.lanes.find((l) => l.seg.road.id === "x" && l.forward && l.index === 0 && l.to.kind === "cross")!;
  const to = net.lanes.find((l) => l.seg.road.id === "y" && l.forward && l.from.kind === "cross")!;
  const steps = route(net, from, 1, to, 5)!;
  assert.ok(steps && steps.length > 0);
  let at: Lane = from;
  for (const st of steps) {
    if (st.kind === "move") {
      assert.equal(st.m.from, at);
      at = st.m.to;
    } else {
      assert.ok(at.left === st.to || at.right === st.to);
      at = st.to;
    }
  }
  assert.equal(at, to);
});

test("a route that is not allowed anywhere returns null", () => {
  const net = plus();
  const from = net.lanes[0], to = net.lanes[net.lanes.length - 1];
  assert.equal(route(net, from, 0.5, to, 1, { allow: () => false }), null);
});

const world = expandWorld(houston, 7).city;
const grid = new CityGrid(world.layout);
const net = buildGraph(world.roads, { core: world.core });
const lots: { x: number; y: number; w: number; d: number }[] = [];
for (const { x, y, c } of grid.cells()) if (c === "b") lots.push({ x, y, w: 1, d: 1 });
const places = buildPlaces(net, lots, (x, y) => zoneAt(world, x, y));

test("lots become places on the lane that faces them", () => {
  assert.ok(places.length > 200, `${places.length} places`);
  for (const p of places.slice(0, 300)) {
    const a = p.lane.path.at(p.s);
    const side = Math.cos(a.h) * (p.y + 0.5 - a.y) - Math.sin(a.h) * (p.x + 0.5 - a.x);
    assert.ok(side > 0, "the lot is on the lane's right");
  }
  assert.ok(places.some((p) => p.kind === "home") && places.some((p) => p.kind === "work"));
});

test("the demand curve peaks at rush hour", () => {
  assert.equal(demand(8), 1);
  assert.equal(demand(17.5), 1);
  assert.ok(demand(3) < 0.3);
});

function simulate(seed: number, hour: number, seconds: number) {
  const sim = new Sim(net);
  const vehicles = [{ kind: "sedan", weight: 4 }, { kind: "taxi", weight: 1 }, { kind: "bus", weight: 1 }] as const;
  const trips = new Trips(sim, places, buildSpots(net), [...vehicles], seed);
  trips.target = 90;
  trips.hour = hour;
  for (let i = 0; i < seconds / DT; i++) {
    sim.step();
    trips.tick();
    if (i % 20 === 0) {
      const errs = sim.check();
      if (errs.length) assert.fail(`t=${sim.time.toFixed(1)}: ${errs.join("; ")}`);
    }
  }
  return { sim, trips };
}

test("the morning rush drives people to work, safely", () => {
  const { trips } = simulate(5, 8, 150);
  const { home, work } = trips.arrivals;
  assert.ok(work > 20, `only ${work} arrivals at work`);
  assert.ok(work > home * 2, `work ${work} vs home ${home}`);
  assert.ok(trips.parked.length > 10, "cars park when they arrive");
});

test("the evening rush drives people home", () => {
  const { trips } = simulate(6, 17.5, 150);
  assert.ok(trips.arrivals.home > trips.arrivals.work * 2, JSON.stringify(trips.arrivals));
});

test("buses run and the same seed replays the same traffic", () => {
  const a = simulate(8, 12, 40), b = simulate(8, 12, 40);
  assert.ok(a.sim.cars.some((c) => c.kind === "bus"), "a bus is on the road");
  const snap = (s: Sim) => s.cars.map((c) => `${c.id}:${c.track.tid}:${c.s.toFixed(5)}`).join(",");
  assert.equal(snap(a.sim), snap(b.sim));
  assert.equal(a.trips.parked.length, b.trips.parked.length);
});
