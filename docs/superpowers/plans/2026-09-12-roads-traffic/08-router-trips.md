# Task 8: Router, places, parking, and trips

**Files:**
- Create: `game/src/engine/zones.ts` (moved `zoneAt`)
- Modify: `game/src/engine/populate.ts:28-39` (re-export `zoneAt`)
- Create: `game/src/engine/roads/router.ts`
- Create: `game/src/engine/roads/trips.ts`
- Test: `game/tests/roads-trips.test.ts`

- Routing is A* over lanes: a movement costs its length over its speed plus the next lane's time and load; a lane change costs 1.2 s. Portal movements (U-turns at the world's edge) are never routed through; a through trip appends one as its last step.
- Places are lots tied to the lane in front of them (the lane whose right side faces the lot), tagged `home` (residential), `work` (downtown, industrial, campus, half of midtown), or `shop` (the other half of midtown).
- Parking spots are every tile along local (non-rural) lanes, drawn 0.17 tiles to the right of the lane.
- Trip purpose follows the hour: 6:30 to 9:30 mostly home to work; 16:00 to 19:00 mostly work to home; 11:00 to 14:00 errands; otherwise anything. 12% of trips come from or leave by the world's edge.
- A trip starts from a parked car of the right kind of place when one is ready (so the evening commute drives the morning's cars home), otherwise a new car pulls out of the lot. It ends parked at a free spot near the goal, or, with no spot, the car pulls into a garage (fades out).
- Buses ping-pong between two far collector or arterial lanes, stopping every 5 tiles; cable cars ping-pong on the tram line; taxis and police chain random trips without parking.
- One game hour is `hourSeconds` of real time (the scene passes `visualDaySeconds / 24`, 3 s today).

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-trips.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-trips.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Move `zoneAt` into `game/src/engine/zones.ts`**

```ts
// Which zone a tile belongs to: the nearest zone by distance over radius.
// Kept free of PixiJS so the traffic sim and tests can use it.

import type { CityDef, ZoneKind } from "./types";

export function zoneAt(city: Pick<CityDef, "zones">, x: number, y: number): ZoneKind {
  let best: ZoneKind = "residential";
  let bestScore = Infinity;
  for (const z of city.zones) {
    const score = Math.hypot(x - z.x, y - z.y) / z.r;
    if (score < bestScore) {
      bestScore = score;
      best = z.kind;
    }
  }
  return bestScore <= 1.35 ? best : "residential";
}
```

In `game/src/engine/populate.ts` delete the `zoneAt` function (lines 28-39) and add after the imports:

```ts
import { zoneAt } from "./zones.ts";

export { zoneAt };
```

- [ ] **Step 4: Create `game/src/engine/roads/router.ts`**

```ts
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
```

- [ ] **Step 5: Create `game/src/engine/roads/trips.ts`**

```ts
// Trips: where cars come from and go. Lots become places on the lane in front
// of them; the hour decides who drives where (to work in the morning, home in
// the evening, errands at midday); arriving cars park at the curb and the
// next trip of the right kind drives them away again. Buses, cable cars,
// taxis, and police keep going instead of parking.

import { pick, pickWeighted, rngFor, type Rng } from "../rng.ts";
import type { VehicleKind, ZoneKind } from "../types";
import type { Lane, RoadNet } from "./graph.ts";
import type { Pose } from "./geometry.ts";
import { route } from "./router.ts";
import { DT, type Car, type Sim, type Step } from "./sim.ts";

export type PlaceKind = "home" | "work" | "shop";
type Purpose = "commute-in" | "commute-out" | "errand" | "any";

export interface Place {
  x: number;
  y: number;
  kind: PlaceKind;
  lane: Lane;
  s: number;
}

export interface Spot {
  lane: Lane;
  s: number;
  car: Parked | null;
}

export interface Look {
  kind: VehicleKind;
  color: number;
}

export interface Parked {
  id: number;
  look: Look;
  spot: Spot;
  place: Place;
  until: number;
}

/** A car that just left the map or pulled into a garage, fading out where it was. */
export interface Ghost {
  pose: Pose;
  look: Look;
  t: number;
}

interface TripData {
  look: Look;
  role: "trip" | "roam" | "bus" | "cable";
  purpose: Purpose;
  dest: Place | null;
  destLane: Lane;
  destS: number;
  edge: boolean;
  born: number;
  ends?: [Lane, number][];
  leg?: number;
}

export const CAR_COLORS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0x263238, 0xfb8c00, 0x8e24aa, 0x00acc1];
const PARK_OFFSET = 0.17;

/** Share of peak traffic on the road at an hour of the day (0-24). */
export function demand(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return 0.15;
  if (h < 7) return 0.15 + ((h - 5) / 2) * 0.85;
  if (h < 9) return 1;
  if (h < 11) return 0.6;
  if (h < 14) return 0.75;
  if (h < 16) return 0.6;
  if (h < 19) return 1;
  if (h < 22) return 0.5;
  return 0.25;
}

const STREET = new Set(["local", "collector", "arterial"]);

/** Every lot tied to the street lane in front of it. */
export function buildPlaces(net: RoadNet, lots: { x: number; y: number; w: number; d: number }[], zoneOf: (x: number, y: number) => ZoneKind): Place[] {
  const byTile = new Map<string, Lane[]>();
  for (const l of net.lanes) {
    if (!l.live || !STREET.has(l.seg.road.cls)) continue;
    for (let s = 0; s <= l.path.length; s += 0.25) {
      const p = l.path.at(s);
      const key = `${Math.floor(p.x)},${Math.floor(p.y)}`;
      const list = byTile.get(key) ?? [];
      if (!list.includes(l)) list.push(l);
      byTile.set(key, list);
    }
  }
  const places: Place[] = [];
  for (const lot of lots) {
    const cx = lot.x + lot.w / 2, cy = lot.y + lot.d / 2;
    let best: { lane: Lane; s: number; d: number } | null = null;
    for (let y = lot.y - 2; y < lot.y + lot.d + 2; y++)
      for (let x = lot.x - 2; x < lot.x + lot.w + 2; x++)
        for (const lane of byTile.get(`${x},${y}`) ?? []) {
          const s = Math.max(0.3, Math.min(lane.path.length - 0.3, lane.path.project({ x: cx, y: cy })));
          const a = lane.path.at(s);
          const side = Math.cos(a.h) * (cy - a.y) - Math.sin(a.h) * (cx - a.x);
          const d = Math.hypot(cx - a.x, cy - a.y);
          if (side > 0 && (!best || d < best.d)) best = { lane, s, d };
        }
    if (!best || best.d > 3) continue;
    const zone = zoneOf(cx, cy);
    const kind: PlaceKind =
      zone === "residential" ? "home" : zone === "midtown" ? ((lot.x * 7 + lot.y * 13) % 2 === 0 ? "work" : "shop") : "work";
    places.push({ x: lot.x, y: lot.y, kind, lane: best.lane, s: best.s });
  }
  return places;
}

/** Curb parking every tile along local streets. */
export function buildSpots(net: RoadNet): Spot[] {
  const spots: Spot[] = [];
  for (const l of net.lanes) {
    if (!l.live || l.seg.road.cls !== "local" || l.seg.road.rural) continue;
    for (let s = 0.6; s <= l.path.length - 0.6; s += 1) spots.push({ lane: l, s, car: null });
  }
  return spots;
}

export function spotPose(spot: Spot): Pose {
  const p = spot.lane.path.at(spot.s);
  return { x: p.x - Math.sin(p.h) * PARK_OFFSET, y: p.y + Math.cos(p.h) * PARK_OFFSET, h: p.h };
}

export class Trips {
  /** How many cars should be moving (set by the scene from the hour, economy, and weather). */
  target = 0;
  /** Hour of the day, 0-24. */
  hour = 12;
  readonly parked: Parked[] = [];
  readonly ghosts: Ghost[] = [];
  readonly arrivals: Record<PlaceKind | "edge", number> = { home: 0, work: 0, shop: 0, edge: 0 };
  private readonly sim: Sim;
  private readonly rng: Rng;
  private readonly hourSeconds: number;
  private readonly all: Place[];
  private readonly byKind: Record<PlaceKind, Place[]> = { home: [], work: [], shop: [] };
  private readonly spotsByLane = new Map<number, Spot[]>();
  private readonly entries: Lane[];
  private readonly exits: Lane[];
  private readonly mix: { weight: number; value: VehicleKind }[];
  private readonly wantBus: boolean;
  private readonly wantCable: boolean;
  private budget = 0;
  private nextPark = 1;
  private sinceSpecials = 5;

  constructor(sim: Sim, places: Place[], spots: Spot[], vehicles: { kind: VehicleKind; weight: number }[], seed: number, hourSeconds = 3) {
    this.sim = sim;
    this.rng = rngFor(seed, "trips");
    this.hourSeconds = hourSeconds;
    this.all = places;
    for (const p of places) this.byKind[p.kind].push(p);
    for (const s of spots) {
      const list = this.spotsByLane.get(s.lane.id) ?? [];
      list.push(s);
      this.spotsByLane.set(s.lane.id, list);
    }
    const lanes = sim.net.lanes.filter((l) => l.live);
    this.entries = lanes.filter((l) => l.from.kind === "edge");
    this.exits = lanes.filter((l) => l.to.kind === "edge" && l.out.some((m) => m.portal));
    this.mix = vehicles.filter((v) => v.kind !== "bus" && v.kind !== "cable-car").map((v) => ({ weight: v.weight, value: v.kind }));
    this.wantBus = vehicles.some((v) => v.kind === "bus");
    this.wantCable = vehicles.some((v) => v.kind === "cable-car") && lanes.some((l) => l.seg.road.tram);
    sim.onDone = (car) => this.finish(car);
    sim.onStuck = (car) => this.reroute(car);
  }

  /** Call once after every sim step. */
  tick(): void {
    this.budget = Math.min(3, this.budget + DT * 5);
    if (this.sim.cars.length < this.target && this.budget >= 1) {
      this.budget -= 1;
      this.startTrip();
    }
    this.sinceSpecials += DT;
    if (this.sinceSpecials >= 5) {
      this.sinceSpecials = 0;
      this.keepSpecials();
    }
    while (this.parked.length > 400) this.unpark(this.parked[0], true);
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].t += DT;
      if (this.ghosts[i].t > 0.6) this.ghosts.splice(i, 1);
    }
  }

  lookOf(car: Car): Look {
    return (car.data as TripData).look;
  }

  /** Seconds since the car appeared (for fading in). */
  ageOf(car: Car): number {
    return this.sim.time - (car.data as TripData).born;
  }

  private purpose(): Purpose {
    const h = this.hour, r = this.rng();
    if (h >= 6.5 && h < 9.5) return r < 0.7 ? "commute-in" : r < 0.8 ? "errand" : "any";
    if (h >= 16 && h < 19) return r < 0.7 ? "commute-out" : r < 0.8 ? "errand" : "any";
    if (h >= 11 && h < 14) return r < 0.5 ? "errand" : "any";
    return "any";
  }

  private place(kind: PlaceKind | null): Place | null {
    const list = kind && this.byKind[kind].length ? this.byKind[kind] : this.all;
    return list.length ? pick(this.rng, list) : null;
  }

  private newLook(kind: VehicleKind): Look {
    const color = kind === "taxi" ? 0xffc928 : kind === "police" ? 0xffffff : kind === "bus" ? 0x2f7de1 : pick(this.rng, CAR_COLORS);
    return { kind, color };
  }

  private startTrip(): void {
    const purpose = this.purpose();
    const [okind, dkind]: [PlaceKind | null, PlaceKind | null] =
      purpose === "commute-in" ? ["home", "work"] : purpose === "commute-out" ? ["work", "home"] : purpose === "errand" ? [this.rng() < 0.7 ? "home" : "work", "shop"] : [null, null];
    const through = this.entries.length > 0 && this.exits.length > 0 && this.rng() < 0.12;
    const fromEdge = through && this.rng() < 0.5;
    const kind: VehicleKind = this.mix.length ? pickWeighted(this.rng, this.mix) : "sedan";
    const roam = kind === "taxi" || kind === "police";

    let lane: Lane, s: number, parked: Parked | null = null;
    if (fromEdge) {
      lane = pick(this.rng, this.entries);
      s = 0.6;
    } else {
      parked = roam ? null : this.parked.find((p) => p.until <= this.sim.time && (okind === null || p.place.kind === okind)) ?? null;
      const origin = parked ? null : this.place(okind);
      if (!parked && !origin) return;
      lane = parked ? parked.spot.lane : origin!.lane;
      s = parked ? parked.spot.s : origin!.s;
    }
    const toEdge = through && !fromEdge;
    const dest = toEdge ? null : this.place(dkind);
    const destLane = toEdge ? pick(this.rng, this.exits) : dest?.lane;
    if (!destLane) return;
    const destS = toEdge ? destLane.path.length - 0.05 : dest!.s;
    const steps = this.plan(lane, s, destLane, destS, toEdge);
    if (!steps) return;
    const look = parked ? parked.look : this.newLook(kind);
    const data: TripData = { look, role: roam ? "roam" : "trip", purpose, dest, destLane, destS, edge: toEdge, born: this.sim.time };
    const car = this.sim.spawn({ kind: look.kind, lane, s, steps, goal: toEdge ? null : destS, pace: 0.9 + this.rng() * 0.2, data });
    if (!car) return;
    if (parked) {
      this.unpark(parked, false);
      car.lat = PARK_OFFSET;
      data.born = -Infinity; // already visible at the curb
    }
  }

  private plan(lane: Lane, s: number, destLane: Lane, destS: number, toEdge: boolean, allow?: (l: Lane) => boolean): Step[] | null {
    const steps = route(this.sim.net, lane, s, destLane, destS, { allow, load: (l) => this.sim.carsOn(l).length * 0.4 });
    if (!steps) return null;
    if (toEdge) {
      const portal = destLane.out.find((m) => m.portal);
      if (!portal) return null;
      steps.push({ kind: "move", m: portal });
    }
    return steps;
  }

  private finish(car: Car): void {
    const d = car.data as TripData;
    if (car.dropped || d.edge) {
      if (d.edge && !car.dropped) this.arrivals.edge++;
      this.vanish(car);
      return;
    }
    if (d.role === "bus" || d.role === "cable") {
      if (!this.nextLeg(car)) this.vanish(car);
      return;
    }
    if (d.dest) this.arrivals[d.dest.kind]++;
    if (d.role === "roam") {
      if (!this.chain(car)) this.vanish(car);
      return;
    }
    const spot = this.freeSpot(car.track as Lane, car.s);
    if (!spot || !d.dest) {
      this.vanish(car);
      return;
    }
    this.sim.remove(car);
    const hours = d.purpose === "commute-in" ? 8 : d.purpose === "commute-out" ? 10 : d.purpose === "errand" ? 1 : 2;
    const p: Parked = { id: this.nextPark++, look: d.look, spot, place: d.dest, until: this.sim.time + hours * this.hourSeconds * (0.7 + this.rng() * 0.6) };
    spot.car = p;
    this.parked.push(p);
  }

  private vanish(car: Car): void {
    this.ghosts.push({ pose: this.sim.pose(car), look: (car.data as TripData).look, t: 0 });
    this.sim.remove(car);
  }

  private freeSpot(lane: Lane, s: number): Spot | null {
    let best: Spot | null = null;
    for (const sp of this.spotsByLane.get(lane.id) ?? [])
      if (!sp.car && Math.abs(sp.s - s) <= 2 && (!best || Math.abs(sp.s - s) < Math.abs(best.s - s))) best = sp;
    return best && this.parked.length < 400 ? best : null;
  }

  private unpark(p: Parked, fade: boolean): void {
    const i = this.parked.indexOf(p);
    if (i >= 0) this.parked.splice(i, 1);
    p.spot.car = null;
    if (fade) this.ghosts.push({ pose: spotPose(p.spot), look: p.look, t: 0 });
  }

  /** Give a finished car a new route from where it stands. */
  private restart(car: Car, destLane: Lane, destS: number, allow?: (l: Lane) => boolean): boolean {
    const lane = car.track as Lane;
    const steps = this.plan(lane, car.s, destLane, destS, false, allow);
    if (!steps || (!steps.length && destS <= car.s)) return false;
    car.steps = steps;
    car.step = 0;
    car.goal = destS;
    car.done = false;
    const d = car.data as TripData;
    d.destLane = destLane;
    d.destS = destS;
    return true;
  }

  private chain(car: Car): boolean {
    const dest = this.place(null);
    if (!dest) return false;
    (car.data as TripData).dest = dest;
    return this.restart(car, dest.lane, dest.s);
  }

  private reroute(car: Car): void {
    const d = car.data as TripData;
    if (car.track.kind !== "lane") return;
    const steps = this.plan(car.track, car.s, d.destLane, d.destS, d.edge, d.role === "bus" ? busLane : d.role === "cable" ? tramLane : undefined);
    if (!steps) return;
    car.steps = steps;
    car.step = 0;
    car.halts = [];
  }

  private nextLeg(car: Car): boolean {
    const d = car.data as TripData;
    d.leg = (d.leg ?? 0) ^ 1;
    const [lane, s] = d.ends![d.leg];
    const allow = d.role === "bus" ? busLane : tramLane;
    if (!this.restart(car, lane, s, allow)) return false;
    car.halts = haltsFor(car.track as Lane, car.steps, d.role === "bus" ? 5 : 4);
    return true;
  }

  private keepSpecials(): void {
    const count = (k: VehicleKind) => this.sim.cars.filter((c) => c.kind === k).length;
    const buses = this.wantBus ? Math.max(1, Math.min(3, Math.round(this.target / 40))) : 0;
    if (count("bus") < buses) this.spawnLoop("bus", busLane, 5);
    if (this.wantCable && count("cable-car") < 2) this.spawnLoop("cable-car", tramLane, 4);
  }

  private spawnLoop(kind: VehicleKind, allow: (l: Lane) => boolean, every: number): void {
    const lanes = this.sim.net.lanes.filter((l) => l.live && allow(l) && l.path.length > 1.5);
    if (lanes.length < 2) return;
    for (let tries = 0; tries < 20; tries++) {
      const a = pick(this.rng, lanes), b = pick(this.rng, lanes);
      const pa = a.path.at(0), pb = b.path.at(0);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 15) continue;
      const steps = route(this.sim.net, a, 0.7, b, b.path.length / 2, { allow });
      if (!steps) continue;
      const data: TripData = {
        look: this.newLook(kind), role: kind === "bus" ? "bus" : "cable", purpose: "any", dest: null, destLane: b, destS: b.path.length / 2,
        edge: false, born: this.sim.time, ends: [[a, 0.7], [b, b.path.length / 2]], leg: 1,
      };
      const car = this.sim.spawn({ kind, lane: a, s: 0.7, steps, goal: b.path.length / 2, halts: haltsFor(a, steps, every), data });
      if (car) return;
    }
  }
}

const busLane = (l: Lane) => (l.seg.road.cls === "collector" || l.seg.road.cls === "arterial") && !l.seg.road.tram;
const tramLane = (l: Lane) => !!l.seg.road.tram;

/** Stops every `every` tiles along the lanes a route drives, skipping lanes it leaves by a lane change. */
function haltsFor(start: Lane, steps: Step[], every: number): Car["halts"] {
  const halts: Car["halts"] = [];
  let lane = start;
  for (let i = 0; i <= steps.length; i++) {
    const st = steps[i];
    if (!st || st.kind === "move")
      for (let s = every / 2; s < lane.path.length - 1; s += every) halts.push({ lane, s, wait: 3 });
    if (!st) break;
    lane = st.kind === "move" ? st.m.to : st.to;
  }
  return halts;
}
```

- [ ] **Step 6: Run the test**

Run: `node --test tests/roads-trips.test.ts`
Expected: 7 tests pass (the three simulations take about 30 s together).
If the rush-hour tests fail on counts, print `trips.arrivals` and `sim.cars.length`: few cars means `startTrip` keeps returning early (no route between places: check that places sit on live lanes).

- [ ] **Step 7: Typecheck, suite, commit**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean.

```bash
git add src/engine/zones.ts src/engine/populate.ts src/engine/roads/router.ts src/engine/roads/trips.ts src/engine/roads/sim.ts tests/roads-trips.test.ts
git commit -m "Roads: routed trips with rush hours, curb parking, buses, and cable cars"
```
