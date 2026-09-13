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
  private readonly sim: Sim;
  private readonly rng: Rng;
  private readonly segs: Segment[];
  private readonly deckAt: (x: number, y: number) => boolean;
  private nextId = 1;

  /** `deckAt` says whether a tile is a bridge or overpass deck, where people keep to the deck's edge instead of stepping off it. */
  constructor(net: RoadNet, sim: Sim, rng: Rng, deckAt: (x: number, y: number) => boolean = () => false) {
    this.sim = sim;
    this.rng = rng;
    this.deckAt = deckAt;
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
    const s = st.seg, n = right(s.dir);
    const cx = s.ca.x + s.dir.x * st.t, cy = s.ca.y + s.dir.y * st.t;
    // Off a deck the sidewalk is just past the curb; on one, it is just inside the railing.
    const off = st.sigma * (s.width / 2 + (this.deckAt(Math.floor(cx), Math.floor(cy)) ? -0.08 : 0.05));
    return { x: cx + n.x * off, y: cy + n.y * off };
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
