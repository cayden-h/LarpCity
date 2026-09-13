# Task 11: Pedestrians on sidewalks and crosswalks

**Files:**
- Create: `game/src/engine/roads/sidewalks.ts` (pure walking logic)
- Modify: `game/src/engine/roads/sim.ts` (add `crosswalkBusy`)
- Modify: `game/src/engine/people.ts` (street walkers use `Sidewalks`; plaza strollers unchanged)
- Modify: `game/src/engine/scene.ts` (build `People` after `Traffic`)
- Test: `game/tests/roads-sidewalks.test.ts`

How a person walks:

- A person walks along one side of a street segment, just outside the curb (`half-width + 0.05` from the centerline), from one intersection corner to the next.
- At a corner (between the arm they came along, A, and the arm beside them, C) they choose: turn onto C; go straight on to the arm ahead, D (crossing C by its crosswalk if C exists); cross their own arm A and walk back on the other side; or, with nothing else, turn around.
- Crossing needs a crosswalk (signal and all-way nodes only). At a signal they wait for the walk light; anywhere, they wait until no car is in or reserved for a movement crossing that crosswalk. After 25 s of waiting they give up and turn instead.
- While crossing they count in `sim.crossing`, so turning cars wait for them.
- Highways and ramps have no sidewalks.

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-sidewalks.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-sidewalks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Add `crosswalkBusy` to `game/src/engine/roads/sim.ts`**

`Arm` and `RNode` are already imported as types. Add this public method to `Sim` (after `pose`):

```ts
  /** True while a car is in, reserved for, or clearing a movement that crosses this crosswalk. */
  crosswalkBusy(node: RNode, arm: Arm): boolean {
    for (const m of node.movements) if (m.crosswalks.includes(arm) && this.occupied(m)) return true;
    return false;
  }
```

- [ ] **Step 4: Create `game/src/engine/roads/sidewalks.ts`**

```ts
// People on foot along the road network: they walk one side of a street just
// outside the curb, choose a way at each corner, and cross only at crosswalks
// on the walk light (or when no car is coming through), counting themselves
// in sim.crossing so turning cars wait. No PixiJS; people.ts draws them.

import type { Rng } from "../rng.ts";
import { walkAllowed } from "./control.ts";
import type { P } from "./geometry.ts";
import type { Arm, RNode, RoadNet, Segment } from "./graph.ts";
import type { Sim } from "./sim.ts";

export interface Street {
  seg: Segment;
  /** Which side of the segment: +1 is right of its direction. */
  sigma: 1 | -1;
  /** +1 walks toward the segment's end, -1 toward its start. */
  dir: 1 | -1;
  /** Distance along the untrimmed centerline from its start. */
  t: number;
}

interface Waypoint {
  x: number;
  y: number;
  cross?: { node: RNode; arm: Arm; key: string };
  then?: Street;
}

export interface Ped {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  street: Street | null;
  queue: Waypoint[];
  wait: number;
  crossingKey: string | null;
}

const WALKABLE = new Set(["local", "collector", "arterial"]);
const right = (v: P): P => ({ x: -v.y, y: v.x });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;

export class Sidewalks {
  readonly peds: Ped[] = [];
  private readonly net: RoadNet;
  private readonly sim: Sim;
  private readonly rng: Rng;
  private readonly segs: Segment[];
  private nextId = 1;

  constructor(net: RoadNet, sim: Sim, rng: Rng) {
    this.net = net;
    this.sim = sim;
    this.rng = rng;
    this.segs = net.segments.filter((s) => WALKABLE.has(s.road.cls) && Math.hypot(s.cb.x - s.ca.x, s.cb.y - s.ca.y) > 1);
  }

  spawn(): Ped | null {
    if (!this.segs.length) return null;
    const seg = this.segs[Math.floor(this.rng() * this.segs.length)];
    const [lo, hi] = this.limits(seg);
    if (hi <= lo) return null;
    const street: Street = { seg, sigma: this.rng() < 0.5 ? 1 : -1, dir: this.rng() < 0.5 ? 1 : -1, t: lo + this.rng() * (hi - lo) };
    const p = this.pointOf(street);
    const ped: Ped = { id: this.nextId++, x: p.x, y: p.y, vx: 0, vy: 0, speed: 0.28 + this.rng() * 0.14, street, queue: [], wait: 0, crossingKey: null };
    this.peds.push(ped);
    return ped;
  }

  remove(ped: Ped): void {
    const i = this.peds.indexOf(ped);
    if (i >= 0) this.peds.splice(i, 1);
    this.leaveCrossing(ped);
  }

  step(dt: number): void {
    for (const ped of this.peds) this.stepPed(ped, dt);
  }

  // ------------------------------------------------------------------ walking

  private node(seg: Segment, end: 1 | -1): RNode {
    return end > 0 ? seg.b : seg.a;
  }

  private armOf(node: RNode, seg: Segment): Arm {
    return node.arms.find((a) => a.seg === seg)!;
  }

  /** How far a corner sits from a node along an arm: the crossing roads' half-width plus the sidewalk. */
  private cornerDist(node: RNode, arm: Arm): number {
    const across = node.arms.filter((o) => o !== arm && Math.abs(dot(o.dir, arm.dir)) < 0.5);
    return across.length ? Math.max(...across.map((o) => o.seg.width / 2)) + 0.05 : 0;
  }

  private limits(seg: Segment): [number, number] {
    const len = Math.hypot(seg.cb.x - seg.ca.x, seg.cb.y - seg.ca.y);
    return [this.cornerDist(seg.a, this.armOf(seg.a, seg)), len - this.cornerDist(seg.b, this.armOf(seg.b, seg))];
  }

  private pointOf(st: Street): P {
    const s = st.seg, n = right(s.dir), off = st.sigma * (s.width / 2 + 0.05);
    return { x: s.ca.x + s.dir.x * st.t + n.x * off, y: s.ca.y + s.dir.y * st.t + n.y * off };
  }

  private stepPed(ped: Ped, dt: number): void {
    if (ped.queue.length) {
      this.walkQueue(ped, dt);
      return;
    }
    const st = ped.street!;
    const [lo, hi] = this.limits(st.seg);
    st.t += st.dir * ped.speed * dt;
    const end = st.dir > 0 ? hi : lo;
    if ((st.dir > 0 && st.t >= end) || (st.dir < 0 && st.t <= end)) {
      st.t = end;
      this.atCorner(ped, st);
    }
    const p = this.pointOf(st);
    ped.vx = (p.x - ped.x) / dt;
    ped.vy = (p.y - ped.y) / dt;
    ped.x = p.x;
    ped.y = p.y;
  }

  private walkQueue(ped: Ped, dt: number): void {
    const wp = ped.queue[0];
    if (wp.cross && ped.crossingKey !== wp.cross.key) {
      const { node, arm } = wp.cross;
      const plan = this.sim.signals.get(node.id);
      const ok = (!plan || walkAllowed(plan, arm, this.sim.time)) && !this.sim.crosswalkBusy(node, arm);
      if (!ok) {
        ped.wait += dt;
        ped.vx = ped.vy = 0;
        if (ped.wait > 25) {
          ped.wait = 0;
          ped.queue = [];
          const st = ped.street!;
          st.dir = st.dir > 0 ? -1 : 1; // give up and walk back
        }
        return;
      }
      ped.wait = 0;
      ped.crossingKey = wp.cross.key;
      this.sim.crossing.set(wp.cross.key, (this.sim.crossing.get(wp.cross.key) ?? 0) + 1);
    }
    const dx = wp.x - ped.x, dy = wp.y - ped.y;
    const d = Math.hypot(dx, dy);
    const step = ped.speed * dt;
    if (d <= step) {
      ped.vx = dx / dt;
      ped.vy = dy / dt;
      ped.x = wp.x;
      ped.y = wp.y;
      if (wp.cross) this.leaveCrossing(ped);
      ped.queue.shift();
      if (wp.then) ped.street = wp.then;
      return;
    }
    ped.vx = (dx / d) * ped.speed;
    ped.vy = (dy / d) * ped.speed;
    ped.x += (dx / d) * step;
    ped.y += (dy / d) * step;
  }

  private leaveCrossing(ped: Ped): void {
    if (!ped.crossingKey) return;
    const n = (this.sim.crossing.get(ped.crossingKey) ?? 1) - 1;
    if (n > 0) this.sim.crossing.set(ped.crossingKey, n);
    else this.sim.crossing.delete(ped.crossingKey);
    ped.crossingKey = null;
  }

  /** A street on `arm`'s segment walking away from its node, on the given hand. */
  private away(arm: Arm, hand: 1 | -1): Street {
    const dir: 1 | -1 = arm.start ? 1 : -1;
    const sigma = (hand * dir) as 1 | -1;
    const [lo, hi] = this.limits(arm.seg);
    return { seg: arm.seg, sigma, dir, t: dir > 0 ? lo : hi };
  }

  private atCorner(ped: Ped, st: Street): void {
    const node = this.node(st.seg, st.dir);
    const A = this.armOf(node, st.seg);
    const hand = (st.sigma * st.dir) as 1 | -1; // +1: the curb is on the walker's right
    const w = { x: -A.dir.x, y: -A.dir.y };
    const c = hand > 0 ? right(w) : { x: -right(w).x, y: -right(w).y };
    const C = node.arms.find((a) => dot(a.dir, c) > 0.7) ?? null;
    const D = node.arms.find((a) => dot(a.dir, w) > 0.7) ?? null;
    const options: { weight: number; go: () => void }[] = [];
    const hwOf = (a: Arm) => a.seg.width / 2 + 0.05;
    const crossing = (arm: Arm, side: P): { from: P; to: P } => {
      const m = arm.trim - 0.19;
      const base = { x: node.p.x + arm.dir.x * m, y: node.p.y + arm.dir.y * m };
      const k = hwOf(arm);
      return { from: { x: base.x + side.x * k, y: base.y + side.y * k }, to: { x: base.x - side.x * k, y: base.y - side.y * k } };
    };
    const key = (arm: Arm) => `${node.id}:${node.arms.indexOf(arm)}`;
    if (C) {
      const rs = (dot(right(C.dir), A.dir) > 0 ? 1 : -1) as 1 | -1;
      options.push({ weight: 1, go: () => (ped.street = this.away(C, rs)) });
    }
    if (D && (!C || C.crosswalk)) {
      options.push({
        weight: 2,
        go: () => {
          const next = this.away(D, hand);
          if (!C) {
            ped.street = next;
            return;
          }
          const x = crossing(C, A.dir);
          ped.queue = [{ x: x.from.x, y: x.from.y }, { x: x.to.x, y: x.to.y, cross: { node, arm: C, key: key(C) } }];
          const p = this.pointOf(next);
          ped.queue.push({ x: p.x, y: p.y, then: next });
        },
      });
    }
    if (A.crosswalk) {
      options.push({
        weight: 0.7,
        go: () => {
          const x = crossing(A, c);
          const next = this.away(A, hand);
          ped.queue = [{ x: x.from.x, y: x.from.y }, { x: x.to.x, y: x.to.y, cross: { node, arm: A, key: key(A) } }];
          const p = this.pointOf(next);
          ped.queue.push({ x: p.x, y: p.y, then: next });
        },
      });
    }
    if (!options.length) options.push({ weight: 1, go: () => (st.dir = st.dir > 0 ? -1 : 1) });
    const total = options.reduce((s, o) => s + o.weight, 0);
    let roll = this.rng() * total;
    for (const o of options) {
      roll -= o.weight;
      if (roll <= 0) {
        o.go();
        return;
      }
    }
    options[options.length - 1].go();
  }
}
```

- [ ] **Step 5: Run the test**

Run: `node --test tests/roads-sidewalks.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Street walkers in `game/src/engine/people.ts` use `Sidewalks`**

- Imports: add `import type { RoadNet } from "./roads/graph";`, `import { Sidewalks, type Ped } from "./roads/sidewalks";`, `import type { Sim } from "./roads/sim";`; drop `DIRS` from the `./iso` import.
- `Walker`: replace the street fields (`x`, `y`, `dir`, `t`, `side`) with `ped: Ped | null;`.
- Fields: remove `sidewalks: [number, number][]`; add `private readonly walk: Sidewalks;`.
- Constructor signature: `constructor(grid: CityGrid, net: RoadNet, sim: Sim, objects: Container, seed: number)`; build `this.walk = new Sidewalks(net, sim, rngFor(seed, "sidewalks"));` and keep only the plaza collection in the cell loop.
- `update(dt, night)`: call `this.walk.step(dt);` first. When a walker fades out and is destroyed, call `if (w.ped) this.walk.remove(w.ped);`.
- `spawn()`: for a street walker, `const ped = this.walk.spawn(); if (!ped) return;` and store it on the walker (`ped`); plaza walkers get `ped: null`.
- Replace `stepStreet` with:

```ts
  private stepStreet(w: Walker): void {
    const p = w.ped!;
    const c = this.grid.at(Math.floor(p.x), Math.floor(p.y));
    const z = c === "B" || c === "O" ? BRIDGE_Z : 0;
    w.pause = p.vx === 0 && p.vy === 0 ? 1 : 0;
    const facing = p.vx - p.vy >= 0 ? 1 : -1;
    this.place(w, p.x, p.y, z, p.vx === 0 && p.vy === 0 ? w.view.scale.x : facing);
  }
```

and in `update` call `this.stepStreet(w)` (no `dt`) for street walkers. The walk cycle already keys off `w.pause`.

- [ ] **Step 7: Scene order**

In `game/src/engine/scene.ts`, move `this.people = new People(...)` to just after `this.traffic` and `this.roadProps` are built, and call it as:

```ts
    this.people = new People(this.grid, this.net, this.traffic.sim, this.objects, seed);
```

- [ ] **Step 8: Typecheck, suite, look**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean.
In the browser, at a downtown signal: people wait at the corner, cross on the walk phase inside the zebra, and turning cars stop for them; nobody walks down the middle of a road or across a highway.

- [ ] **Step 9: Commit**

```bash
git add src/engine/roads/sidewalks.ts src/engine/roads/sim.ts src/engine/people.ts src/engine/scene.ts tests/roads-sidewalks.test.ts
git commit -m "People: walk the sidewalks and cross at crosswalks on the walk light"
```
