// Intersection control: kinds, priorities, and signal plans. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assignPriorities, buildSignals, controlKind, signalState, walkAllowed } from "../src/engine/roads/control.ts";
import { buildGraph } from "../src/engine/roads/graph.ts";
import type { RoadClass, RoadDef } from "../src/engine/roads/types.ts";

const road = (id: string, cls: RoadClass, path: [number, number][]): RoadDef => ({
  id, cls, path, lanes: cls === "arterial" || cls === "highway" ? [2, 2] : [1, 1],
});
const plus = (a: RoadClass, b: RoadClass) =>
  buildGraph([road("x", a, [[0.5, 10], [20.5, 10]]), road("y", b, [[10, 0.5], [10, 20.5]])]);

test("control follows the classes that meet", () => {
  const k = (a: RoadClass, b: RoadClass, core = false) =>
    controlKind("cross", [{ cls: a, axis: 0 }, { cls: a, axis: 0 }, { cls: b, axis: 1 }, { cls: b, axis: 1 }], core);
  assert.equal(k("arterial", "arterial"), "signal");
  assert.equal(k("arterial", "collector"), "signal");
  assert.equal(k("collector", "collector"), "allway");
  assert.equal(k("local", "collector"), "stop");
  assert.equal(k("local", "arterial"), "stop");
  assert.equal(k("local", "local"), "yield");
  assert.equal(k("local", "local", true), "allway");
  assert.equal(k("highway", "highway"), "yield");
  assert.equal(controlKind("bend", [], false), "none");
  assert.equal(controlKind("merge", [], false), "merge");
});

test("at a stop-controlled T the stem's movements have the lowest priority", () => {
  const net = buildGraph([road("a", "arterial", [[0.5, 7], [15.5, 7]]), road("s", "local", [[7.5, 8.5], [7.5, 14.5]])]);
  assignPriorities(net);
  const node = net.nodes.find((n) => n.kind === "cross")!;
  for (const m of node.movements) {
    if (m.from.seg.road.id === "s") assert.equal(m.priority, 0);
    else assert.equal(m.priority, m.turn === "left" ? 1 : 2);
  }
});

for (const [a, b] of [["arterial", "arterial"], ["arterial", "collector"]] as const)
  test(`${a} x ${b} signal: no two green movements conflict, and nothing starves`, () => {
    const net = plus(a, b);
    assignPriorities(net);
    const plans = buildSignals(net);
    const node = net.nodes.find((n) => n.kind === "cross")!;
    const plan = plans.get(node.id)!;
    assert.ok(plan, "the node has a signal plan");
    const served = new Set<number>();
    for (let t = 0; t < plan.cycle; t += 0.25) {
      const green = node.movements.filter((m) => signalState(plan, m, t) === "G");
      for (const m of green) {
        served.add(m.id);
        for (const c of m.conflicts) assert.ok(!green.includes(c), `t=${t}: ${m.id} and ${c.id} both green`);
      }
      for (const m of node.movements) if (signalState(plan, m, t) === "P") served.add(m.id);
    }
    for (const m of node.movements) assert.ok(served.has(m.id), `movement ${m.id} (${m.turn}) never gets to go`);
  });

test("straight movements never cross a crosswalk while it shows walk", () => {
  const net = plus("arterial", "arterial");
  assignPriorities(net);
  const node = net.nodes.find((n) => n.kind === "cross")!;
  const plan = buildSignals(net).get(node.id)!;
  let walked = false;
  for (let t = 0; t < plan.cycle; t += 0.25)
    for (const m of node.movements) {
      if (m.turn !== "straight" || signalState(plan, m, t) !== "G") continue;
      for (const arm of m.crosswalks) assert.ok(!walkAllowed(plan, arm, t), `t=${t}`);
    }
  for (let t = 0; t < plan.cycle; t += 0.25) if (node.arms.some((arm) => walkAllowed(plan, arm, t))) walked = true;
  assert.ok(walked, "people get a walk signal sometime");
});
