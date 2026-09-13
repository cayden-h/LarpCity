// The traffic sim core on small hand-built networks. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { signalState } from "../src/engine/roads/control.ts";
import { buildGraph, type Lane, type Movement } from "../src/engine/roads/graph.ts";
import { Sim, type Car, type Step } from "../src/engine/roads/sim.ts";
import type { RoadClass, RoadDef } from "../src/engine/roads/types.ts";
import { mulberry32 } from "../src/engine/rng.ts";

const road = (id: string, cls: RoadClass, path: [number, number][]): RoadDef => ({
  id, cls, path, lanes: cls === "arterial" ? [2, 2] : [1, 1],
});
const run = (sim: Sim, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds * 20; i++) {
    sim.step();
    each?.();
  }
};
const noErrors = (sim: Sim) => () => {
  const errs = sim.check();
  assert.deepEqual(errs, []);
};

test("a car speeds up to the limit and stops at its goal", () => {
  const net = buildGraph([road("a", "local", [[0.5, 2.5], [30.5, 2.5]])]);
  const sim = new Sim(net);
  const lane = net.lanes.find((l) => l.forward)!;
  let done: Car | null = null;
  let top = 0;
  sim.onDone = (c) => (done = c);
  sim.spawn({ kind: "sedan", lane, s: 1, steps: [], goal: 25 });
  run(sim, 60, () => (top = Math.max(top, sim.cars[0]?.v ?? 0)));
  assert.ok(done, "the car arrived");
  assert.ok(Math.abs(done!.s - 25) < 0.1, `stopped at ${done!.s}`);
  assert.ok(top <= lane.speed * 1.12 + 1e-6 && top > lane.speed * 0.8, `top speed ${top}`);
});

test("a follower never overlaps the car ahead and stops behind it", () => {
  const net = buildGraph([road("a", "local", [[0.5, 2.5], [30.5, 2.5]])]);
  const sim = new Sim(net);
  sim.onDone = () => {};
  const lane = net.lanes.find((l) => l.forward)!;
  const lead = sim.spawn({ kind: "sedan", lane, s: 5, steps: [], goal: 12 })!;
  const back = sim.spawn({ kind: "bus", lane, s: 1, steps: [], goal: 29 })!;
  run(sim, 40, noErrors(sim));
  assert.ok(back.s <= lead.s - lead.len - 0.05, `gap ${lead.s - lead.len - back.s}`);
});

test("four cars at an all-way stop all get through, and nothing collides", () => {
  const net = buildGraph([road("x", "collector", [[0.5, 10.5], [20.5, 10.5]]), road("y", "collector", [[10.5, 0.5], [10.5, 20.5]])]);
  const sim = new Sim(net);
  const node = net.nodes.find((n) => n.kind === "cross")!;
  assert.equal(node.control, "allway");
  let done = 0;
  sim.onDone = (c) => {
    done++;
    sim.remove(c);
  };
  for (const m of node.movements.filter((mv) => mv.turn === "straight"))
    sim.spawn({ kind: "sedan", lane: m.from, s: m.from.path.length - 3, steps: [{ kind: "move", m }], goal: m.to.path.length / 2 });
  run(sim, 40, noErrors(sim));
  assert.equal(done, 4);
});

test("at a signal a car only commits on green, permitted, or yellow", () => {
  const net = buildGraph([road("x", "arterial", [[0.5, 10], [30.5, 10]]), road("y", "arterial", [[15, 0.5], [15, 30.5]])]);
  const sim = new Sim(net);
  const node = net.nodes.find((n) => n.kind === "cross")!;
  const plan = sim.signals.get(node.id)!;
  sim.onDone = (c) => sim.remove(c);
  for (let k = 0; k < 6; k++) {
    const m = node.movements.filter((mv) => mv.turn === "straight")[k % 4];
    const car = sim.spawn({ kind: "sedan", lane: m.from, s: 1, steps: [{ kind: "move", m }], goal: m.to.path.length - 1 });
    if (!car) continue;
    let was = false;
    run(sim, 30, () => {
      if (car.committed && !was) assert.notEqual(signalState(plan, m, sim.time), "R", "committed on red");
      was = car.committed;
    });
  }
});

test("a car changes lanes before a right turn", () => {
  const net = buildGraph([road("x", "arterial", [[0.5, 10], [30.5, 10]]), road("y", "collector", [[15.5, 0.5], [15.5, 30.5]])]);
  const sim = new Sim(net);
  const inLeft = net.lanes.find((l) => l.seg.road.id === "x" && l.forward && l.index === 0 && l.to.kind === "cross")!;
  const right = inLeft.right!.out.find((m) => m.turn === "right")!;
  assert.ok(right, "the right turn leaves from the right lane");
  let done: Car | null = null;
  sim.onDone = (c) => (done = c);
  const steps: Step[] = [{ kind: "change", to: inLeft.right! }, { kind: "move", m: right }];
  sim.spawn({ kind: "sedan", lane: inLeft, s: 1, steps, goal: right.to.path.length / 2 });
  run(sim, 90, noErrors(sim));
  assert.ok(done, "the car made its turn");
});

/** Random-walk trips on a 3 x 3 arterial grid with local streets between. */
function stress(seed: number, seconds: number): { sim: Sim; trips: number; dropped: number } {
  const roads: RoadDef[] = [];
  for (const v of [6, 18, 30]) {
    roads.push(road(`h${v}`, "arterial", [[0.5, v], [36.5, v]]));
    roads.push(road(`v${v}`, "arterial", [[v, 0.5], [v, 36.5]]));
  }
  for (const v of [12.5, 24.5]) {
    roads.push(road(`lh${v}`, "local", [[0.5, v], [36.5, v]]));
    roads.push(road(`lv${v}`, "local", [[v, 0.5], [v, 36.5]]));
  }
  const net = buildGraph(roads);
  const sim = new Sim(net);
  const rng = mulberry32(seed);
  let trips = 0, dropped = 0;
  sim.onDone = (c) => {
    if (c.dropped) dropped++;
    else trips++;
    sim.remove(c);
  };
  const starts = net.lanes.filter((l) => l.live && l.from.kind === "end");
  let clock = 0;
  for (let i = 0; i < seconds * 20; i++) {
    clock += 1 / 20;
    if (clock >= 0.4) {
      clock = 0;
      const lane = starts[Math.floor(rng() * starts.length)];
      const steps: Step[] = [];
      let at: Lane = lane;
      for (let k = 0; k < 8; k++) {
        let outs: Movement[] = at.out.filter((m) => m.live && m.turn !== "uturn");
        if (!outs.length) outs = at.out.filter((m) => m.live);
        if (!outs.length) break;
        const m = outs[Math.floor(rng() * outs.length)];
        steps.push({ kind: "move", m });
        at = m.to;
      }
      sim.spawn({ kind: rng() < 0.1 ? "bus" : "sedan", lane, s: 0.7, steps, goal: at.path.length / 2 });
    }
    sim.step();
    const errs = sim.check();
    if (errs.length) assert.fail(`t=${sim.time.toFixed(2)}: ${errs.join("; ")}`);
  }
  return { sim, trips, dropped };
}

test("five minutes of random trips: no collisions, steady flow, almost no drops", () => {
  const { trips, dropped } = stress(3, 300);
  assert.ok(trips > 150, `only ${trips} trips finished`);
  assert.ok(dropped <= trips * 0.02, `${dropped} cars were dropped by the watchdog`);
});

test("the same seed gives the same traffic", () => {
  const a = stress(9, 60).sim.cars.map((c) => [c.id, c.track.tid, c.s.toFixed(6)]);
  const b = stress(9, 60).sim.cars.map((c) => [c.id, c.track.tid, c.s.toFixed(6)]);
  assert.deepEqual(a, b);
});
