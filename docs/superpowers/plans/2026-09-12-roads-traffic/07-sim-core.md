# Task 7: The sim core

**Files:**
- Create: `game/src/engine/roads/sim.ts`
- Test: `game/tests/roads-sim.test.ts`

The sim owns every car. A car sits on a track (lane or movement) at distance `s` (its front bumper) with speed `v`, and follows a list of steps: `move` (take this movement at the end of the current lane) or `change` (move to this adjacent lane).

Each 1/20 s step:

1. For every car: find the gap to what is ahead (the car in front, a stop line it may not pass yet, a bus stop, its goal), trying to commit to its next movement or change lanes along the way; accelerate with the Intelligent Driver Model.
2. For every car: integrate, clamp at stop lines and behind the car in front, move onto the next track when it runs off the end, release the movement it has cleared.
3. Once a second, the watchdog frees intersections that have had cars waiting and no movement for 20 s (and removes the longest-waiting car after 45 s).

Admission to a movement (only the front car of a lane, within braking distance of the line):

- No conflicting movement is occupied, reserved, or being cleared; no person is in a crosswalk it crosses.
- The exit lane has room for the car (less the cars already in the movement).
- Control: signal (green, or permitted with a clear gap, or yellow when it cannot stop); all-way (a full stop of 0.5 s, then first come, first served among conflicting arrivals); stop (minor arms stop fully, then yield); yield and merge (yield to higher priority with a 3 s gap).

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-sim.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-sim.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `game/src/engine/roads/sim.ts`**

```ts
// The traffic simulation core: cars on lanes and movements, following with
// the Intelligent Driver Model, entering an intersection only when its
// control, its conflicts, its crosswalks, and room on the exit lane allow it.
// No PixiJS here, so it runs headless in tests; traffic.ts draws it.

import { assignPriorities, buildSignals, minorArms, signalState, type SignalPlan } from "./control.ts";
import type { Arm, Lane, Movement, RNode, RoadNet, Track } from "./graph.ts";
import type { Pose } from "./geometry.ts";
import type { VehicleKind } from "../types";

export const DT = 1 / 20;
const BRAKE = 2.0; // comfortable braking, tiles/s^2
const S0 = 0.1; // standstill gap, tiles
const HEADWAY = 0.7; // seconds
const GAP_TIME = 3; // seconds of clear road a yielding car needs

export type Step = { kind: "move"; m: Movement } | { kind: "change"; to: Lane };

export interface Car {
  id: number;
  kind: VehicleKind;
  len: number;
  /** Share of the speed limit this driver likes, around 1. */
  pace: number;
  accelMax: number;
  track: Track;
  /** Front bumper's distance along the track. */
  s: number;
  v: number;
  a: number;
  /** Sideways offset from the track, left over from a lane change, in tiles. */
  lat: number;
  steps: Step[];
  step: number;
  /** Holds a reservation on its next movement. */
  committed: boolean;
  /** Where on the last lane the trip ends; null for the lane's end. */
  goal: number | null;
  /** Bus stops ahead, in order. */
  halts: { lane: Lane; s: number; wait: number }[];
  /** Seconds standing still. */
  stopped: number;
  /** Seconds waiting for a lane change gap. */
  stuck: number;
  clearing: Movement | null;
  done: boolean;
  /** Removed by the watchdog rather than finishing. */
  dropped: boolean;
  data: unknown;
}

const LENGTH: Partial<Record<VehicleKind, number>> = { bus: 0.62, "cable-car": 0.62, pickup: 0.44, van: 0.44, snowplow: 0.44 };
export const carLength = (k: VehicleKind): number => LENGTH[k] ?? 0.38;
const ACCEL: Partial<Record<VehicleKind, number>> = { bus: 0.8, "cable-car": 0.7, taxi: 1.5 };

const nextMove = (car: Car): Movement | null => {
  const st = car.steps[car.step];
  return st?.kind === "move" ? st.m : null;
};
const armOf = (m: Movement): Arm => m.node.arms.find((a) => a.seg === m.from.seg)!;

export interface SpawnOptions {
  kind: VehicleKind;
  lane: Lane;
  s: number;
  steps: Step[];
  goal?: number | null;
  v?: number;
  pace?: number;
  halts?: Car["halts"];
  data?: unknown;
}

export class Sim {
  readonly net: RoadNet;
  readonly signals: Map<number, SignalPlan>;
  readonly cars: Car[] = [];
  time = 0;
  /** People inside a crosswalk, by `${node id}:${arm index}`. */
  readonly crossing = new Map<string, number>();
  /** Called when a car finishes its route or the watchdog gives up on it; the default removes it. */
  onDone: (car: Car) => void = (car) => this.remove(car);
  /** Called when a car cannot make a lane change for 8 s, so its owner can reroute it. */
  onStuck: (car: Car) => void = () => {};
  private readonly on: Car[][];
  private readonly reserved: number[];
  private readonly clearingCount: number[];
  private readonly flow: number[];
  private readonly queue = new Map<number, Map<Car, number>>();
  private readonly minor = new Map<number, Set<Arm>>();
  private nextId = 1;
  private sinceWatch = 0;

  constructor(net: RoadNet) {
    this.net = net;
    assignPriorities(net);
    this.signals = buildSignals(net);
    this.on = net.tracks.map(() => []);
    this.reserved = net.tracks.map(() => 0);
    this.clearingCount = net.tracks.map(() => 0);
    this.flow = net.nodes.map(() => 0);
    for (const n of net.nodes) this.minor.set(n.id, minorArms(n));
  }

  carsOn(t: Track): readonly Car[] {
    return this.on[t.tid];
  }

  spawn(o: SpawnOptions): Car | null {
    const len = carLength(o.kind);
    const s = Math.max(Math.min(len, o.lane.path.length), Math.min(o.s, o.lane.path.length));
    for (const c of this.on[o.lane.tid]) if (c.s > s - len - 0.15 && c.s - c.len < s + 0.15) return null;
    const car: Car = {
      id: this.nextId++, kind: o.kind, len, pace: o.pace ?? 1, accelMax: ACCEL[o.kind] ?? 1.2,
      track: o.lane, s, v: o.v ?? 0, a: 0, lat: 0, steps: o.steps, step: 0, committed: false,
      goal: o.goal ?? null, halts: o.halts ?? [], stopped: 0, stuck: 0, clearing: null, done: false, dropped: false, data: o.data,
    };
    this.insert(car, o.lane);
    this.cars.push(car);
    return car;
  }

  remove(car: Car): void {
    const i = this.cars.indexOf(car);
    if (i < 0) return;
    this.cars.splice(i, 1);
    this.detach(car);
    const m = nextMove(car);
    if (car.committed && m) this.reserved[m.tid]--;
    car.committed = false;
    if (car.clearing) this.clearingCount[car.clearing.tid]--;
    car.clearing = null;
    for (const q of this.queue.values()) q.delete(car);
  }

  /** Where a car is drawn: its point on the track plus any lane-change offset. */
  pose(car: Car): Pose {
    const p = car.track.path.at(car.s);
    return { x: p.x - Math.sin(p.h) * car.lat, y: p.y + Math.cos(p.h) * car.lat, h: p.h };
  }

  step(): void {
    this.time += DT;
    for (const car of this.cars) car.a = this.accel(car);
    for (const car of [...this.cars]) if (!car.done) this.move(car);
    this.sinceWatch += DT;
    if (this.sinceWatch >= 1) {
      this.sinceWatch = 0;
      this.watchdog();
    }
  }

  /** Overlaps and conflicting movements in use at once; empty when all is well. */
  check(): string[] {
    const errs: string[] = [];
    for (const t of this.net.tracks) {
      const arr = this.on[t.tid];
      for (let i = 1; i < arr.length; i++)
        if (arr[i].s > arr[i - 1].s - arr[i - 1].len + 1e-6) errs.push(`overlap on track ${t.tid}: cars ${arr[i - 1].id} and ${arr[i].id}`);
      if (t.kind === "move" && arr.length) {
        const last = this.on[t.to.tid][this.on[t.to.tid].length - 1];
        if (last && arr[0].s - t.path.length > last.s - last.len + 1e-6) errs.push(`overlap leaving movement ${t.id}`);
      }
    }
    const busy = (m: Movement) => this.on[m.tid].length > 0 || this.clearingCount[m.tid] > 0;
    for (const m of this.net.movements) {
      if (!busy(m)) continue;
      for (const c of m.conflicts) if (c.id > m.id && busy(c)) errs.push(`conflict at node ${m.node.id}: movements ${m.id} and ${c.id}`);
    }
    return errs;
  }

  // ---------------------------------------------------------------- tracks

  private insert(car: Car, t: Track): void {
    const arr = this.on[t.tid];
    const i = arr.findIndex((c) => c.s < car.s);
    if (i < 0) arr.push(car);
    else arr.splice(i, 0, car);
    car.track = t;
  }

  private detach(car: Car): void {
    const arr = this.on[car.track.tid];
    const i = arr.indexOf(car);
    if (i >= 0) arr.splice(i, 1);
  }

  private occupied(m: Movement): boolean {
    return this.on[m.tid].length > 0 || this.reserved[m.tid] > 0 || this.clearingCount[m.tid] > 0;
  }

  private queueAt(node: RNode): Map<Car, number> {
    let q = this.queue.get(node.id);
    if (!q) this.queue.set(node.id, (q = new Map()));
    return q;
  }

  // ---------------------------------------------------------------- driving

  private accel(car: Car): number {
    const { gap, lead } = this.gapAhead(car);
    const want = Math.max(0.05, car.track.speed * car.pace);
    const v = car.v;
    const sStar = S0 + Math.max(0, v * HEADWAY + (v * (v - lead)) / (2 * Math.sqrt(car.accelMax * BRAKE)));
    let a = car.accelMax * (1 - Math.pow(v / want, 4));
    if (gap < Infinity) a -= car.accelMax * Math.pow(sStar / Math.max(gap, 0.01), 2);
    return Math.max(-8, Math.min(car.accelMax, a));
  }

  private gapAhead(car: Car): { gap: number; lead: number } {
    const tr = car.track;
    let gap = Infinity, lead = 0;
    const take = (g: number, v: number) => {
      if (g < gap) {
        gap = g;
        lead = v;
      }
    };
    const arr = this.on[tr.tid];
    const i = arr.indexOf(car);
    if (i > 0) take(arr[i - 1].s - arr[i - 1].len - car.s, arr[i - 1].v);
    const halt = car.halts[0];
    if (halt && halt.lane === tr && halt.s >= car.s - 0.05) take(halt.s - car.s, 0);
    let dist = tr.path.length - car.s;
    let next: Track | null;
    if (tr.kind === "lane") {
      const st = car.steps[car.step];
      if (!st) {
        take((car.goal ?? tr.path.length - 0.05) - car.s, 0);
        return { gap, lead };
      }
      if (st.kind === "change") {
        this.tryChange(car, st.to);
        if (car.track !== tr) return this.gapAhead(car);
        take(dist - 0.3, 0);
        return { gap, lead };
      }
      if (!car.committed && !(i === 0 && this.tryCommit(car, st.m, dist))) {
        take(dist - 0.02, 0);
        return { gap, lead };
      }
      next = st.m;
    } else next = tr.to;
    for (let k = 0; next && k < 2; k++) {
      const na = this.on[next.tid];
      if (na.length) {
        const l = na[na.length - 1];
        take(dist + l.s - l.len, l.v);
        break;
      }
      dist += next.path.length;
      if (dist > 6) break;
      next = next.kind === "move" ? next.to : null;
    }
    return { gap, lead };
  }

  private tryCommit(car: Car, m: Movement, dist: number): boolean {
    const range = m.node.control === "none" ? 3 : (car.v * car.v) / (2 * BRAKE) + 0.35;
    if (dist > range || !this.admit(car, m, dist, false)) return false;
    this.commit(car, m);
    return true;
  }

  private commit(car: Car, m: Movement): void {
    car.committed = true;
    this.reserved[m.tid]++;
    this.flow[m.node.id] = this.time;
    this.queue.get(m.node.id)?.delete(car);
  }

  private admit(car: Car, m: Movement, dist: number, force: boolean): boolean {
    const node = m.node;
    for (const c of m.conflicts) if (this.occupied(c)) return false;
    for (const arm of m.crosswalks) if ((this.crossing.get(`${node.id}:${node.arms.indexOf(arm)}`) ?? 0) > 0) return false;
    if (force) return true;
    if (!m.portal && !this.roomAfter(car, m)) return false;
    const stoppedAtLine = car.v < 0.05 && dist < 0.3 && car.stopped >= 0.5;
    switch (node.control) {
      case "signal": {
        const plan = this.signals.get(node.id)!;
        const light = signalState(plan, m, this.time);
        if (light === "R") return false;
        if (light === "Y") return (car.v * car.v) / (2 * BRAKE) > dist - 0.05;
        if (light === "G") return true;
        return this.clear(m, (c) => {
          const l = signalState(plan, c, this.time);
          return l === "G" || l === "Y";
        });
      }
      case "allway": {
        if (!stoppedAtLine) return false;
        const q = this.queueAt(node);
        const mine = q.get(car) ?? this.time;
        for (const [other, t] of q) {
          if (other === car || t >= mine) continue;
          const om = nextMove(other);
          if (om && (om === m || m.conflicts.includes(om))) return false;
        }
        return true;
      }
      case "stop":
        if (this.minor.get(node.id)!.has(armOf(m)) && !stoppedAtLine) return false;
        return this.clear(m, (c) => c.priority > m.priority);
      default:
        return this.clear(m, (c) => c.priority > m.priority);
    }
  }

  /** True when no car is about to take a conflicting movement that goes first. */
  private clear(m: Movement, first: (c: Movement) => boolean): boolean {
    for (const c of m.conflicts) {
      if (!first(c)) continue;
      const f = this.on[c.from.tid][0];
      if (!f || nextMove(f) !== c) continue;
      const mustStop = c.node.control === "allway" || (c.node.control === "stop" && this.minor.get(c.node.id)!.has(armOf(c)));
      if (mustStop && f.v < 0.05) continue;
      if ((c.from.path.length - f.s) / Math.max(f.v, 0.3) < GAP_TIME) return false;
    }
    return true;
  }

  private roomAfter(car: Car, m: Movement): boolean {
    const arr = this.on[m.to.tid];
    const last = arr[arr.length - 1];
    let room = last ? last.s - last.len : m.to.path.length;
    for (const c of this.on[m.tid]) room -= c.len + 0.1;
    return room >= Math.min(car.len + 0.15, m.to.path.length - 0.01);
  }

  private tryChange(car: Car, to: Lane): void {
    const from = car.track as Lane;
    let ok = car.s <= to.path.length - 0.1;
    if (ok) {
      let ahead = Infinity, behind = Infinity, vb = 0;
      for (const c of this.on[to.tid]) {
        if (c.s >= car.s) ahead = Math.min(ahead, c.s - c.len - car.s);
        else if (car.s - car.len - c.s < behind) {
          behind = car.s - car.len - c.s;
          vb = c.v;
        }
      }
      ok = ahead >= 0.25 + car.v * 0.4 && behind >= 0.25 + vb * 0.7;
    }
    if (!ok) {
      car.stuck += DT;
      if (car.stuck > 8) {
        car.stuck = 0;
        this.onStuck(car);
      }
      return;
    }
    const p0 = from.path.at(car.s), p1 = to.path.at(car.s);
    car.lat = (p0.x - p1.x) * -Math.sin(p1.h) + (p0.y - p1.y) * Math.cos(p1.h);
    this.detach(car);
    this.insert(car, to);
    car.step++;
    car.stuck = 0;
  }

  private move(car: Car): void {
    car.v = Math.max(0, car.v + car.a * DT);
    car.s += car.v * DT;
    const tr = car.track;
    // Never pass a line the car may not cross, nor the car in front.
    if (tr.kind === "lane") {
      const st = car.steps[car.step];
      const limit = !st ? (car.goal ?? tr.path.length - 0.05) : st.kind === "move" && car.committed ? Infinity : tr.path.length - (st.kind === "move" ? 0.02 : 0.3);
      if (car.s > limit) {
        car.s = Math.max(limit, car.s - car.v * DT);
        car.v = 0;
      }
    }
    const arr = this.on[tr.tid];
    const i = arr.indexOf(car);
    if (i > 0 && car.s > arr[i - 1].s - arr[i - 1].len - 0.01) {
      car.s = arr[i - 1].s - arr[i - 1].len - 0.01;
      car.v = Math.min(car.v, arr[i - 1].v);
    }
    while (car.s >= car.track.path.length) {
      const t = car.track;
      const over = car.s - t.path.length;
      if (t.kind === "lane") {
        const st = car.steps[car.step];
        if (!st || st.kind !== "move" || !car.committed) break;
        this.reserved[st.m.tid]--;
        car.committed = false;
        this.detach(car);
        car.s = over;
        this.insert(car, st.m);
        car.step++;
        if (st.m.portal) {
          car.done = true;
          this.onDone(car);
          return;
        }
      } else {
        this.detach(car);
        car.s = over;
        this.insert(car, t.to);
        if (car.clearing) this.clearingCount[car.clearing.tid]--;
        car.clearing = t;
        this.clearingCount[t.tid]++;
      }
    }
    if (car.clearing && car.track.kind === "lane" && car.s >= car.len) {
      this.clearingCount[car.clearing.tid]--;
      car.clearing = null;
    }
    car.lat -= Math.sign(car.lat) * Math.min(Math.abs(car.lat), DT * 0.8);
    car.stopped = car.v < 0.05 ? car.stopped + DT : 0;
    const halt = car.halts[0];
    if (halt && halt.lane === car.track && Math.abs(car.s - halt.s) < 0.08 && car.v < 0.05) {
      halt.wait -= DT;
      if (halt.wait <= 0) car.halts.shift();
    } else if (halt && halt.lane === car.track && car.s > halt.s + 0.1) car.halts.shift(); // rolled past it

    const m = nextMove(car);
    if (m && car.track.kind === "lane" && m.node.control === "allway" && car.track.path.length - car.s < 0.3 && car.v < 0.05) {
      const q = this.queueAt(m.node);
      if (!q.has(car)) q.set(car, this.time);
    }
    if (car.track.kind === "lane" && car.step >= car.steps.length) {
      const g = car.goal ?? car.track.path.length - 0.05;
      if (car.s >= g - 0.05 && car.v < 0.05) {
        car.done = true;
        this.onDone(car);
      }
    }
  }

  private watchdog(): void {
    const waiting = new Map<number, Car[]>();
    for (const car of this.cars) {
      const m = nextMove(car);
      if (!m || car.done || car.track.kind !== "lane" || car.committed || car.v > 0.05 || car.track.path.length - car.s > 0.3) continue;
      const list = waiting.get(m.node.id) ?? [];
      list.push(car);
      waiting.set(m.node.id, list);
    }
    for (const [id, list] of waiting) {
      const idle = this.time - this.flow[id];
      if (idle < 20) continue;
      const car = list.reduce((a, b) => (b.stopped > a.stopped ? b : a));
      const m = nextMove(car)!;
      if (idle < 45) {
        if (this.admit(car, m, 0, true)) this.commit(car, m);
      } else {
        this.flow[id] = this.time;
        car.done = true;
        car.dropped = true;
        this.onDone(car);
      }
    }
  }
}
```

- [ ] **Step 4: Run the test**

Run: `node --test tests/roads-sim.test.ts`
Expected: 7 tests pass within about 20 s.
Likely failures and where to look:
- `overlap leaving movement`: a car entered a movement whose exit lane had no room; check `roomAfter` and that only the front car commits.
- `conflict at node`: two cars committed in the same step; `commit` must increment `reserved` before the next car's `admit`.
- Few trips finished in the stress test: print `sim.cars.filter(c => c.stopped > 20)` with their node's control to find the rule that never lets them go.

- [ ] **Step 5: Typecheck, suite, commit**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean.

```bash
git add src/engine/roads/sim.ts tests/roads-sim.test.ts
git commit -m "Roads: the traffic sim core with car-following and intersection admission"
```
