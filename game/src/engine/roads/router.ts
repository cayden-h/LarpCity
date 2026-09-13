// A* over lanes. The cost of a lane is the time to reach its end; a movement
// adds its own time and the next lane's; a lane change costs a flat 1.2 s.

import type { Lane, RoadNet } from "./graph.ts";
import type { Step } from "./sim.ts";

export interface RouteOptions {
  /** Lanes the vehicle may use (buses and cable cars are restricted). */
  allow?: (lane: Lane) => boolean;
  /** Extra seconds for a lane, for congestion. */
  load?: (lane: Lane) => number;
}

interface Item {
  lane: Lane;
  g: number;
  f: number;
}

class Heap {
  private readonly a: Item[] = [];
  get size(): number {
    return this.a.length;
  }
  push(x: Item): void {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Item {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  peek(): Item | undefined {
    return this.a[0];
  }
}

export function route(net: RoadNet, from: Lane, fromS: number, to: Lane, toS: number, opts: RouteOptions = {}): Step[] | null {
  void net;
  if (from === to && toS >= fromS) return [];
  const allow = opts.allow ?? (() => true);
  const load = opts.load ?? (() => 0);
  const goal = to.path.at(0);
  const h = (l: Lane) => {
    const p = l.path.at(l.path.length);
    return Math.hypot(p.x - goal.x, p.y - goal.y) / 2;
  };
  const best = new Map<Lane, number>();
  const prev = new Map<Lane, { from: Lane; step: Step }>();
  const heap = new Heap();
  const g0 = (from.path.length - fromS) / from.speed;
  best.set(from, g0);
  heap.push({ lane: from, g: g0, f: g0 + h(from) });
  let bestGoal = Infinity;
  let goalPrev: { from: Lane; step: Step } | null = null;
  const relax = (lane: Lane, g: number, p: { from: Lane; step: Step }) => {
    if (g >= (best.get(lane) ?? Infinity)) return;
    best.set(lane, g);
    prev.set(lane, p);
    heap.push({ lane, g, f: g + h(lane) });
  };
  while (heap.size) {
    const { lane: L, g, f } = heap.pop();
    if (f >= bestGoal) break;
    if (g > (best.get(L) ?? Infinity)) continue;
    for (const m of L.out) {
      if (!m.live || m.portal || !allow(m.to)) continue;
      const through = g + m.path.length / m.speed;
      const step: Step = { kind: "move", m };
      if (m.to === to && through + toS / to.speed < bestGoal) {
        bestGoal = through + toS / to.speed;
        goalPrev = { from: L, step };
      }
      relax(m.to, through + m.to.path.length / m.to.speed + load(m.to), { from: L, step });
    }
    for (const side of [L.left, L.right]) {
      if (!side || !allow(side)) continue;
      const step: Step = { kind: "change", to: side };
      if (side === to && L === from && toS > fromS + 0.5 && g + 1.2 < bestGoal) {
        bestGoal = g + 1.2;
        goalPrev = { from: L, step };
      }
      relax(side, g + 1.2, { from: L, step });
    }
  }
  if (!goalPrev) return null;
  const steps: Step[] = [goalPrev.step];
  let cur = goalPrev.from;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    steps.unshift(p.step);
    cur = p.from;
  }
  return steps;
}
