# Task 5: Priorities, signal plans, and crosswalks

**Files:**
- Modify: `game/src/engine/roads/control.ts` (append)
- Test: `game/tests/roads-control.test.ts`

Rules:

- Stop and yield nodes: arms on the minor axis (the lower-ranked road; on a tie, the axis with fewer arms; on a 4-way tie, the y axis) give way.
- Priorities (higher goes first): minor arms 0; major straight and right 2, major left 1; all-way stops all 1 (first come, first served); signals straight and right 2, left 1 (a permitted left yields); merges: straight and diverge 2, merge 0; elsewhere 2, U-turns 0.
- Signal phases per axis, in order x then y:
  - an axis with a multi-lane approach gets a protected left phase (5 s), then its through phase (12 s);
  - otherwise one phase (9 s) with lefts permitted;
  - each green is followed by 3 s of yellow and 1 s of all-red;
  - within a phase, movements are made green in order straight, right, U-turn, left, skipping any that conflicts with one already green (those are permitted instead).
- Crosswalks across an arm walk during the other axis's through phase (people walk alongside the cars that have green).
- Signal offsets follow position (`(x + y) / 1.25` seconds), so an arterial's lights roll green at arterial speed.

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-control.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-control.test.ts`
Expected: FAIL, `assignPriorities` is not exported.

- [ ] **Step 3: Append to `game/src/engine/roads/control.ts`**

Add to the imports at the top:

```ts
import type { Arm, Movement, RNode, RoadNet } from "./graph.ts";
```

(`import type` erases at runtime, so this does not create a load cycle with `graph.ts`.)

Then append:

```ts
const axisOf = (a: Arm): 0 | 1 => (Math.abs(a.dir.x) > 0.5 ? 0 : 1);

/** Arms that give way at a stop or yield node. */
export function minorArms(node: RNode): Set<Arm> {
  if (node.control !== "stop" && node.control !== "yield") return new Set();
  const rank = (axis: 0 | 1) => Math.max(-1, ...node.arms.filter((a) => axisOf(a) === axis).map((a) => RANK[a.seg.road.cls]));
  const count = (axis: 0 | 1) => node.arms.filter((a) => axisOf(a) === axis).length;
  const r0 = rank(0), r1 = rank(1);
  const minor: 0 | 1 = r0 !== r1 ? (r0 < r1 ? 0 : 1) : count(0) !== count(1) ? (count(0) < count(1) ? 0 : 1) : 1;
  return new Set(node.arms.filter((a) => axisOf(a) === minor));
}

const armOf = (node: RNode, m: Movement): Arm => node.arms.find((a) => a.seg === m.from.seg)!;

export function assignPriorities(net: RoadNet): void {
  for (const node of net.nodes) {
    const minor = minorArms(node);
    for (const m of node.movements) {
      switch (node.control) {
        case "stop":
        case "yield":
          m.priority = minor.has(armOf(node, m)) ? 0 : m.turn === "left" ? 1 : 2;
          break;
        case "allway":
          m.priority = 1;
          break;
        case "signal":
          m.priority = m.turn === "left" ? 1 : 2;
          break;
        case "merge":
          m.priority = m.turn === "merge" ? 0 : 2;
          break;
        default:
          m.priority = m.turn === "uturn" ? 0 : 2;
      }
    }
  }
}

export type Light = "G" | "P" | "Y" | "R";

export interface Phase {
  green: Set<Movement>;
  permitted: Set<Movement>;
  walk: Set<Arm>;
  dur: number;
}

export interface SignalPlan {
  node: RNode;
  phases: Phase[];
  cycle: number;
  offset: number;
}

const YELLOW = 3;
const ALL_RED = 1;
const ORDER: Record<string, number> = { straight: 0, right: 1, uturn: 2, left: 3 };

function phaseOf(ms: Movement[], dur: number, walk: Arm[]): Phase {
  const green = new Set<Movement>(), permitted = new Set<Movement>();
  for (const m of [...ms].sort((a, b) => ORDER[a.turn] - ORDER[b.turn] || a.id - b.id)) {
    if (m.conflicts.some((c) => green.has(c))) permitted.add(m);
    else green.add(m);
  }
  return { green, permitted, walk: new Set(walk), dur };
}

/** A signal plan for every signal node, keyed by node id. */
export function buildSignals(net: RoadNet): Map<number, SignalPlan> {
  const plans = new Map<number, SignalPlan>();
  for (const node of net.nodes) {
    if (node.control !== "signal") continue;
    const phases: Phase[] = [];
    for (const axis of [0, 1] as const) {
      const arms = node.arms.filter((a) => axisOf(a) === axis);
      const ms = node.movements.filter((m) => arms.some((a) => a.seg === m.from.seg));
      if (!ms.length) continue;
      const walk = node.arms.filter((a) => axisOf(a) !== axis && a.crosswalk);
      const lefts = ms.filter((m) => m.turn === "left");
      const thru = ms.filter((m) => m.turn !== "left");
      const multi = arms.some((a) => a.seg.lanes.filter((l) => l.to === node).length >= 2);
      if (multi && lefts.length) {
        phases.push(phaseOf(lefts, 5, []));
        phases.push(phaseOf(thru, 12, walk));
      } else phases.push(phaseOf(ms, 9, walk));
    }
    const cycle = phases.reduce((sum, p) => sum + p.dur + YELLOW + ALL_RED, 0);
    const offset = ((node.p.x + node.p.y) / 1.25) % cycle;
    plans.set(node.id, { node, phases, cycle, offset });
  }
  return plans;
}

/** Where in the cycle time t falls: the phase, and whether it is green, yellow, or all-red. */
function stage(plan: SignalPlan, t: number): { phase: Phase; part: "green" | "yellow" | "red"; left: number } {
  let u = (((t + plan.offset) % plan.cycle) + plan.cycle) % plan.cycle;
  for (const phase of plan.phases) {
    if (u < phase.dur) return { phase, part: "green", left: phase.dur - u };
    u -= phase.dur;
    if (u < YELLOW) return { phase, part: "yellow", left: YELLOW - u };
    u -= YELLOW;
    if (u < ALL_RED) return { phase, part: "red", left: ALL_RED - u };
    u -= ALL_RED;
  }
  return { phase: plan.phases[0], part: "red", left: 0 };
}

export function signalState(plan: SignalPlan, m: Movement, t: number): Light {
  const { phase, part } = stage(plan, t);
  const on = phase.green.has(m) ? "G" : phase.permitted.has(m) ? "P" : null;
  if (!on || part === "red") return "R";
  return part === "yellow" ? "Y" : on;
}

export function walkAllowed(plan: SignalPlan, arm: Arm, t: number): boolean {
  const { phase, part } = stage(plan, t);
  return part === "green" && phase.walk.has(arm);
}
```

- [ ] **Step 4: Run the test**

Run: `node --test tests/roads-control.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Typecheck, suite, commit**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean.

```bash
git add src/engine/roads/control.ts tests/roads-control.test.ts
git commit -m "Roads: priorities, signal phase plans, and walk signals"
```
