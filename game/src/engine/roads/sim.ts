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
  /** Movements that end on each track, by tid. */
  private readonly into: Movement[][];
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
    this.into = net.tracks.map(() => []);
    for (const m of net.movements) this.into[m.to.tid].push(m);
  }

  carsOn(t: Track): readonly Car[] {
    return this.on[t.tid];
  }

  spawn(o: SpawnOptions): Car | null {
    const len = carLength(o.kind);
    const s = Math.max(Math.min(len, o.lane.path.length), Math.min(o.s, o.lane.path.length));
    if (s > o.lane.path.length - len) return null;
    for (const c of this.on[o.lane.tid]) if (c.s > s - len - 0.15 && c.s - c.len < s + 0.15) return null;
    // Nor in front of a car about to come off a movement into the lane.
    for (const m of this.into[o.lane.tid]) for (const c of this.on[m.tid]) if (c.s - m.path.length > s - len - 0.15 - c.v * 0.7) return null;
    // Nor onto the tail of a car still leaving down one of the lane's own outgoing movements.
    for (const m of o.lane.out) {
      const na = this.on[m.tid];
      const l = na[na.length - 1];
      if (l && l.s < l.len && s > o.lane.path.length + l.s - l.len - 0.15) return null;
    }
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
    // onStuck (via tryChange, called from accel's gapAhead) or onDone may
    // mutate this.cars, so iterate a snapshot in both passes.
    for (const car of [...this.cars]) car.a = this.accel(car);
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
      if (t.kind === "lane" && arr.length)
        for (const m of t.out) {
          const na = this.on[m.tid];
          const l = na[na.length - 1];
          if (l && l.s < l.len && arr[0].s > t.path.length + l.s - l.len + 1e-6) errs.push(`overlap entering movement ${m.id}`);
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
    // Fixed stop points (halts, goals, lines) sit S0 further on than a car
    // would, so IDM's standstill gap ends the car right on the point.
    const wall = (d: number) => take(d + S0, 0);
    if (halt && halt.lane === tr && halt.s >= car.s - 0.05) wall(halt.s - car.s);
    let dist = tr.path.length - car.s;
    if (tr.kind === "lane") {
      // A car that just entered one of this lane's outgoing movements may
      // still have its tail overlapping the lane's end.
      for (const m of tr.out) {
        const na = this.on[m.tid];
        const l = na[na.length - 1];
        if (l && l.s < l.len) take(dist + l.s - l.len, l.v);
      }
    }
    let next: Track | null;
    if (tr.kind === "lane") {
      const st = car.steps[car.step];
      if (!st) {
        wall((car.goal ?? tr.path.length - 0.05) - car.s);
        return { gap, lead };
      }
      if (st.kind === "change") {
        this.tryChange(car, st.to);
        if (car.track !== tr) return this.gapAhead(car);
        wall(dist - 0.3);
        return { gap, lead };
      }
      if (!car.committed && !(i === 0 && this.tryCommit(car, st.m, dist))) {
        wall(dist - 0.02);
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
        // Yellow: only a moving car that can no longer stop before the line goes.
        if (light === "Y") return car.v > 0.05 && (car.v * car.v) / (2 * BRAKE) > dist - 0.05;
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
      // A higher-priority front car stopped for its own reasons (not this
      // node) isn't about to take the road either; don't starve the minor
      // movement waiting on it forever.
      if (f.stopped > 1) continue;
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
    // Never cut in front of a car still working its way out of the intersection.
    let ok = car.s >= car.len + 0.25 && car.s <= to.path.length - 0.1;
    if (ok) {
      let ahead = Infinity, behind = Infinity, vb = 0;
      for (const c of this.on[to.tid]) {
        if (c.s >= car.s) ahead = Math.min(ahead, c.s - c.len - car.s);
        else if (car.s - car.len - c.s < behind) {
          behind = car.s - car.len - c.s;
          vb = c.v;
        }
      }
      // Cars still on a movement into the target lane are behind it too.
      for (const m of this.into[to.tid])
        for (const c of this.on[m.tid]) {
          const g = car.s - car.len - (c.s - m.path.length);
          if (g < behind) {
            behind = g;
            vb = c.v;
          }
        }
      ok = ahead >= 0.25 + car.v * 0.4 && behind >= 0.25 + vb * 0.7;
    }
    if (!ok) {
      car.stuck += DT;
      if (car.stuck > 8) {
        car.stuck = 0;
        this.unstick(car, from);
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

  /** A lane-change wait that has gone on too long: let the owner reroute, and
   * if it didn't, drop the change and take any live movement off this lane
   * instead of blocking the lane forever (two side-by-side cars each wanting
   * the other's lane would otherwise deadlock). */
  private unstick(car: Car, from: Lane): void {
    const before = car.steps[car.step];
    this.onStuck(car);
    if (car.steps[car.step] !== before) return;
    const outs = from.out.filter((m) => m.live);
    if (!outs.length) return;
    const m = outs.find((o) => o.turn === "straight") ?? outs[0];
    car.steps = [{ kind: "move", m }];
    car.step = 0;
    car.goal = null;
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
    } else if (i === 0) {
      // No leader on this track: don't run into one just across the boundary
      // on the next track either. A lane can lead into several movements
      // (whichever one the leader took), all sharing the same physical spot
      // at the lane's end, so check every one of them, not just this car's own.
      const nexts: Track[] = tr.kind === "lane" ? tr.out : [tr.to];
      for (const next of nexts) {
        const na = this.on[next.tid];
        const l = na[na.length - 1];
        if (!l) continue;
        const boundary = tr.path.length + l.s - l.len - 0.01;
        if (car.s > boundary) {
          car.s = boundary;
          car.v = Math.min(car.v, l.v);
        }
      }
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
    // A backstop for a car waiting on a lane change that tryChange's own
    // 8-second timer somehow never fired for (e.g. it stopped being ticked).
    for (const car of this.cars) {
      const st = car.steps[car.step];
      if (!car.done && st?.kind === "change" && car.track.kind === "lane" && car.stopped > 20) this.unstick(car, car.track);
    }
    const waiting = new Map<number, Car[]>();
    for (const car of this.cars) {
      const m = nextMove(car);
      if (!m || car.done || car.track.kind !== "lane" || car.committed || car.v > 0.05 || car.track.path.length - car.s > 0.3) continue;
      // A red light is a reason to wait, not a jam: never force a car through one.
      if (m.node.control === "signal" && signalState(this.signals.get(m.node.id)!, m, this.time) === "R") continue;
      const list = waiting.get(m.node.id) ?? [];
      list.push(car);
      waiting.set(m.node.id, list);
    }
    for (const [id, list] of waiting) {
      const car = list.reduce((a, b) => (b.stopped > a.stopped ? b : a));
      const idle = Math.min(this.time - this.flow[id], car.stopped);
      if (idle < 20) continue;
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
