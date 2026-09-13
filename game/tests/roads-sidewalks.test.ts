// People walk the sidewalks and cross only when it is safe. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { walkAllowed } from "../src/engine/roads/control.ts";
import { buildGraph } from "../src/engine/roads/graph.ts";
import { Sidewalks } from "../src/engine/roads/sidewalks.ts";
import { DT, Sim } from "../src/engine/roads/sim.ts";
import type { RoadDef } from "../src/engine/roads/types.ts";
import { mulberry32 } from "../src/engine/rng.ts";

const grid = () =>
  buildGraph([
    { id: "x", cls: "arterial", path: [[0.5, 10], [30.5, 10]], lanes: [2, 2] } as RoadDef,
    { id: "y", cls: "arterial", path: [[15, 0.5], [15, 30.5]], lanes: [2, 2] } as RoadDef,
    { id: "z", cls: "collector", path: [[0.5, 20.5], [30.5, 20.5]], lanes: [1, 1] } as RoadDef,
  ]);

test("people start crossing at a signal only on the walk light", () => {
  const net = grid();
  const sim = new Sim(net);
  const walk = new Sidewalks(net, sim, mulberry32(4));
  for (let i = 0; i < 80; i++) walk.spawn();
  const signal = net.nodes.find((n) => n.control === "signal")!;
  const plan = sim.signals.get(signal.id)!;
  const was = new Map<number, string | null>();
  let crossings = 0;
  for (let i = 0; i < 180 / DT; i++) {
    sim.step();
    walk.step(DT);
    for (const p of walk.peds) {
      const before = was.get(p.id) ?? null;
      if (p.crossingKey && p.crossingKey !== before && p.crossingKey.startsWith(`${signal.id}:`)) {
        crossings++;
        const arm = signal.arms[Number(p.crossingKey.split(":")[1])];
        assert.ok(walkAllowed(plan, arm, sim.time), `crossed against the light at t=${sim.time.toFixed(2)}`);
      }
      was.set(p.id, p.crossingKey);
    }
  }
  assert.ok(crossings > 5, `only ${crossings} crossings at the signal`);
});

test("walkers stay on the sidewalk unless crossing, and crossing counts stay in step", () => {
  const net = grid();
  const sim = new Sim(net);
  const walk = new Sidewalks(net, sim, mulberry32(8));
  for (let i = 0; i < 60; i++) walk.spawn();
  for (let i = 0; i < 90 / DT; i++) {
    sim.step();
    walk.step(DT);
    for (const p of walk.peds) {
      if (!p.street || p.queue.length) continue;
      const s = p.street.seg;
      const d = s.dir, n = { x: -d.y, y: d.x };
      const off = Math.abs((p.x - s.ca.x) * n.x + (p.y - s.ca.y) * n.y);
      assert.ok(off >= s.width / 2, `a walker is ${off.toFixed(2)} from the centerline of a ${s.width}-tile road`);
    }
    const counted = [...sim.crossing.values()].reduce((a, b) => a + b, 0);
    assert.equal(counted, walk.peds.filter((p) => p.crossingKey).length);
  }
  for (const p of [...walk.peds]) walk.remove(p);
  assert.equal([...sim.crossing.values()].reduce((a, b) => a + b, 0), 0);
});
