# Task 9: `Traffic` draws the sim; vehicles in 8 facings

**Files:**
- Create: `game/src/engine/roads/pose.ts`
- Modify: `game/src/engine/traffic.ts` (cars rewritten; boats kept)
- Modify: `game/src/engine/scene.ts:14-19,59,105-121,436-457`
- Test: `game/tests/roads-pose.test.ts`

The sim steps at a fixed 1/20 s; `Traffic.update(dt)` runs as many steps as the frame covers (at most 5) and draws each car between its previous and current pose.
Each vehicle look (kind, color, facing) is drawn once into a shared `GraphicsContext`, and a car swaps contexts as it turns, so 250 cars cost 250 small `Graphics` objects and a few hundred cached contexts.
Vehicles are oriented boxes projected into the isometric view, so the 8 facings come from one drawing routine (spec C swaps in pixel-art sprites behind the same interface).

- [ ] **Step 1: Write the failing test**

Create `game/tests/roads-pose.test.ts`:

```ts
// Facing, pose blending, and elevation for drawing cars. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { elevation, facingOf, lerpPose } from "../src/engine/roads/pose.ts";

test("headings map to the nearest of 8 facings", () => {
  assert.equal(facingOf(0), 0);
  assert.equal(facingOf(Math.PI / 2), 2);
  assert.equal(facingOf(Math.PI), 4);
  assert.equal(facingOf(-Math.PI / 2), 6);
  assert.equal(facingOf(-0.2), 0);
  assert.equal(facingOf(Math.PI / 4 + 0.1), 1);
});

test("pose blending turns the short way across the back", () => {
  const p = lerpPose({ x: 0, y: 0, h: Math.PI - 0.1 }, { x: 2, y: 0, h: -Math.PI + 0.1 }, 0.5);
  assert.equal(p.x, 1);
  assert.ok(Math.abs(Math.abs(p.h) - Math.PI) < 1e-9, `${p.h}`);
});

test("cars ride up on bridges, and on overpasses only when on the upper road", () => {
  const rows = ["=B=", "=O="];
  const grid = { at: (x: number, y: number) => rows[y]?.[x] ?? " " };
  assert.equal(elevation(grid, 0.5, 0.5, false), 0);
  assert.equal(elevation(grid, 1.5, 0.5, false), 7);
  assert.equal(elevation(grid, 1.5, 1.5, false), 7);
  assert.equal(elevation(grid, 1.5, 1.5, true), 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/roads-pose.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `game/src/engine/roads/pose.ts`**

```ts
// Small helpers for drawing sim cars: which of 8 facings a heading is, how
// to blend two poses, and how high the road is under a point.

import type { Pose } from "./geometry.ts";

/** Deck height of bridges and overpasses, in screen pixels (matches ground.ts). */
export const DECK_Z = 7;

/** The nearest of 8 facings: 0 = +x, 2 = +y, 4 = -x, 6 = -y (tile space). */
export function facingOf(h: number): number {
  return ((Math.round(h / (Math.PI / 4)) % 8) + 8) % 8;
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  let dh = b.h - a.h;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: a.h + dh * t };
}

/** Height of the road surface at a point: decks over water, and overpasses for the road on top. */
export function elevation(grid: { at(x: number, y: number): string }, x: number, y: number, underpass: boolean): number {
  const c = grid.at(Math.floor(x), Math.floor(y));
  if (c === "B") return DECK_Z;
  if (c === "O" && !underpass) return DECK_Z;
  return 0;
}
```

In `game/src/engine/ground.ts` change `export const BRIDGE_Z = 7;` to:

```ts
export const BRIDGE_Z = DECK_Z;
```

and add `import { DECK_Z } from "./roads/pose.ts";` to its imports.

- [ ] **Step 4: Run the test**

Run: `node --test tests/roads-pose.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Rewrite the car half of `game/src/engine/traffic.ts`**

Replace everything from the top of the file through the end of `drawLamps` (current lines 1-257) with the code below.
Keep `waterRuns`, `class Boat`, and `drawBoat` (current lines 259-363) exactly as they are, below it.

```ts
// Traffic: draws the road sim's cars (moving, parked, and fading out) and
// runs the boats. The sim (roads/sim.ts) steps at a fixed 1/20 s; each frame
// runs the steps the frame covers and draws every car between its last two
// poses. Boats patrol the longest straight runs of water under the bridges.

import { Container, Graphics, GraphicsContext } from "pixi.js";
import { shade } from "./color";
import type { CityGrid } from "./grid";
import { WATER_Z } from "./ground";
import { iso } from "./iso";
import type { Pose } from "./roads/geometry";
import type { RoadNet } from "./roads/graph";
import { elevation, facingOf, lerpPose } from "./roads/pose";
import { DT, Sim, type Car } from "./roads/sim";
import { buildSpots, spotPose, Trips, type Ghost, type Look, type Parked, type Place } from "./roads/trips";
import { pickWeighted, rngFor, type Rng } from "./rng";
import type { BoatKind, VehicleKind } from "./types";

interface CarView {
  view: Container;
  body: Graphics;
  lamps: Graphics;
  facing: number;
  look: Look;
}

export class Traffic {
  /** Registered by the scene so cars take the time-of-day tint. */
  tint = 0xffffff;
  readonly sim: Sim;
  readonly trips: Trips;
  private readonly boats: Boat[] = [];
  private readonly moving = new Map<Car, CarView>();
  private readonly parkedViews = new Map<Parked, CarView>();
  private readonly ghostViews = new Map<Ghost, CarView>();
  private readonly prev = new Map<Car, Pose>();
  private acc = 0;
  private readonly grid: CityGrid;
  private readonly objects: Container;

  constructor(
    net: RoadNet,
    grid: CityGrid,
    objects: Container,
    waterLayer: Container,
    vehicles: { kind: VehicleKind; weight: number }[],
    boatKinds: { kind: BoatKind; weight: number }[],
    places: Place[],
    seed: number,
    hourSeconds: number,
  ) {
    this.grid = grid;
    this.objects = objects;
    this.sim = new Sim(net);
    this.trips = new Trips(this.sim, places, buildSpots(net), vehicles, seed, hourSeconds);
    this.spawnBoats(boatKinds, seed, waterLayer);
  }

  setTarget(n: number): void {
    this.trips.target = Math.min(250, n);
  }

  setHour(hour: number): void {
    this.trips.hour = hour;
  }

  get count(): number {
    return this.sim.cars.length;
  }

  update(dt: number, night: number): void {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      for (const car of this.sim.cars) this.prev.set(car, this.sim.pose(car));
      this.sim.step();
      this.trips.tick();
      this.acc -= DT;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    const t = this.acc / DT;

    // Moving cars.
    const live = new Set(this.sim.cars);
    for (const [car, v] of this.moving)
      if (!live.has(car)) {
        v.view.destroy({ children: true });
        this.moving.delete(car);
        this.prev.delete(car);
      }
    for (const car of this.sim.cars) {
      const now = this.sim.pose(car);
      const pose = lerpPose(this.prev.get(car) ?? now, now, t);
      const road = car.track.kind === "lane" ? car.track.seg.road : car.track.from.seg.road;
      const v = this.viewFor(this.moving, car, this.trips.lookOf(car));
      this.place(v, pose, road.cls === "highway");
      v.view.alpha = Math.min(1, this.trips.ageOf(car) * 2);
      v.lamps.alpha = night;
    }

    // Parked cars.
    const parked = new Set(this.trips.parked);
    for (const [p, v] of this.parkedViews)
      if (!parked.has(p)) {
        v.view.destroy({ children: true });
        this.parkedViews.delete(p);
      }
    for (const p of this.trips.parked) {
      const v = this.viewFor(this.parkedViews, p, p.look);
      this.place(v, spotPose(p.spot), false);
      v.lamps.alpha = 0;
    }

    // Cars fading out where they left the road.
    const ghosts = new Set(this.trips.ghosts);
    for (const [g, v] of this.ghostViews)
      if (!ghosts.has(g)) {
        v.view.destroy({ children: true });
        this.ghostViews.delete(g);
      }
    for (const g of this.trips.ghosts) {
      const v = this.viewFor(this.ghostViews, g, g.look);
      this.place(v, g.pose, false);
      v.view.alpha = Math.max(0, 1 - g.t / 0.6);
      v.lamps.alpha = 0;
    }

    for (const views of [this.moving, this.parkedViews, this.ghostViews]) for (const v of views.values()) v.body.tint = this.tint;
    for (const boat of this.boats) boat.step(dt, night, this.tint);
  }

  private viewFor<K>(map: Map<K, CarView>, key: K, look: Look): CarView {
    let v = map.get(key);
    if (!v) {
      const view = new Container();
      const body = new Graphics(vehicleContext(look, 0));
      const lamps = new Graphics(lampContext(0));
      lamps.blendMode = "add";
      view.addChild(body, lamps);
      view.cullable = true;
      this.objects.addChild(view);
      v = { view, body, lamps, facing: 0, look };
      map.set(key, v);
    }
    return v;
  }

  private place(v: CarView, pose: Pose, underpass: boolean): void {
    const ahead = 0.3;
    const z =
      (elevation(this.grid, pose.x, pose.y, underpass) * 2 +
        elevation(this.grid, pose.x + Math.cos(pose.h) * ahead, pose.y + Math.sin(pose.h) * ahead, underpass) +
        elevation(this.grid, pose.x - Math.cos(pose.h) * ahead, pose.y - Math.sin(pose.h) * ahead, underpass)) /
      4;
    const p = iso(pose.x, pose.y, z);
    v.view.position.set(p.x, p.y);
    v.view.zIndex = (pose.x + pose.y) * 100 + 40 + (z > 0 ? 45 : 0);
    const facing = facingOf(pose.h);
    if (facing !== v.facing) {
      v.facing = facing;
      v.body.context = vehicleContext(v.look, facing);
      v.lamps.context = lampContext(facing);
    }
  }

  private spawnBoats(kinds: { kind: BoatKind; weight: number }[], seed: number, layer: Container): void {
    if (!kinds.length) return;
    const rng = rngFor(seed, "boats");
    const runs = waterRuns(this.grid).filter((r) => r.length >= 5).sort((a, b) => b.length - a.length);
    const n = Math.min(runs.length, 2 + Math.floor(runs.length / 3), 7);
    for (let i = 0; i < n; i++) {
      const kind = pickWeighted(rng, kinds.map((k) => ({ weight: k.weight, value: k.kind })));
      this.boats.push(new Boat(kind, runs[i], rng, layer));
    }
  }
}

// ------------------------------------------------------------------ vehicles

const contexts = new Map<string, GraphicsContext>();

interface VehicleShape {
  len: number;
  wid: number;
}

function shapeOf(kind: VehicleKind): VehicleShape {
  if (kind === "bus" || kind === "cable-car") return { len: 0.62, wid: 0.24 };
  if (kind === "pickup" || kind === "van" || kind === "snowplow") return { len: 0.44, wid: 0.2 };
  return { len: 0.38, wid: 0.2 };
}

/**
 * An oriented box in tile space around the car's center, `fwd` along the
 * car's heading and `side` across it, from z0 to z1 screen pixels. Faces
 * turned toward the camera (+x, +y) are drawn back to front, then the top.
 */
function box(g: GraphicsContext, angle: number, fwd: [number, number], side: [number, number], z0: number, z1: number, color: number): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  const at = (f: number, w: number) => ({ x: f * c - w * s, y: f * s + w * c });
  const pts = [at(fwd[1], side[0]), at(fwd[1], side[1]), at(fwd[0], side[1]), at(fwd[0], side[0])];
  const faces: { a: (typeof pts)[0]; b: (typeof pts)[0]; nx: number; ny: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const cx = (pts[0].x + pts[2].x) / 2, cy = (pts[0].y + pts[2].y) / 2;
    const nx = mx - cx, ny = my - cy;
    if (nx + ny > 1e-6) faces.push({ a, b, nx, ny });
  }
  faces.sort((p, q) => p.a.x + p.a.y + p.b.x + p.b.y - (q.a.x + q.a.y + q.b.x + q.b.y));
  for (const f of faces) {
    const l = Math.hypot(f.nx, f.ny);
    const k = 0.81 + 0.1 * ((f.ny - f.nx) / l);
    const A = iso(f.a.x, f.a.y, z0), B = iso(f.b.x, f.b.y, z0), B1 = iso(f.b.x, f.b.y, z1), A1 = iso(f.a.x, f.a.y, z1);
    g.poly([A.x, A.y, B.x, B.y, B1.x, B1.y, A1.x, A1.y]).fill(shade(color, k));
  }
  const top = pts.map((p) => iso(p.x, p.y, z1));
  g.poly(top.flatMap((p) => [p.x, p.y])).fill(shade(color, 1.1));
}

function vehicleContext(look: Look, facing: number): GraphicsContext {
  const key = `${look.kind}:${look.color}:${facing}`;
  const hit = contexts.get(key);
  if (hit) return hit;
  const g = new GraphicsContext();
  const { kind, color } = look;
  const { len, wid } = shapeOf(kind);
  const a = (facing * Math.PI) / 4;
  const L = len / 2, W = wid / 2;
  const glass = 0xb8e0f5;
  // Shadow and wheels.
  const s0 = iso(0, 0);
  g.ellipse(s0.x, s0.y + 1, (L + W) * 34, (L + W) * 14).fill({ color: 0x000000, alpha: 0.16 });
  for (const [f, w] of [[L * 0.62, W], [L * 0.62, -W], [-L * 0.62, W], [-L * 0.62, -W]]) {
    const p = iso(f * Math.cos(a) - w * Math.sin(a), f * Math.sin(a) + w * Math.cos(a), 1.5);
    g.circle(p.x, p.y, 2.2).fill(0x1c1c1c);
  }
  if (kind === "bus" || kind === "van" || kind === "cable-car") {
    const band: [number, number] = kind === "van" ? [8, 11] : [9, 13];
    const top = kind === "van" ? 15 : 18;
    box(g, a, [-L, L], [-W, W], 2, band[0], color);
    box(g, a, [-L * 0.98, L * 0.98], [-W * 0.98, W * 0.98], band[0], band[1], glass);
    box(g, a, [-L, L], [-W, W], band[1], top, kind === "cable-car" ? 0xf3e2c0 : color);
    if (kind === "cable-car") {
      const b = iso(0, 0, top), t = iso(0, 0, top + 8);
      g.moveTo(b.x, b.y).lineTo(t.x, t.y).stroke({ width: 1, color: 0x333333 });
    }
    return cache(key, g);
  }
  box(g, a, [-L, L], [-W, W], 2, 8, color);
  if (kind === "snowplow") box(g, a, [L, L + 0.05], [-W * 1.2, W * 1.2], 1, 5, 0xff9800);
  if (kind === "convertible") box(g, a, [-L * 0.5, L * 0.3], [-W * 0.85, W * 0.85], 8, 9, 0x5d4037);
  else if (kind === "pickup" || kind === "snowplow") {
    box(g, a, [-L * 0.05, L * 0.55], [-W * 0.9, W * 0.9], 8, 12, glass);
    box(g, a, [-L * 0.05, L * 0.55], [-W * 0.9, W * 0.9], 12, 13.5, color);
  } else {
    box(g, a, [-L * 0.55, L * 0.45], [-W * 0.9, W * 0.9], 8, 12, glass);
    box(g, a, [-L * 0.5, L * 0.4], [-W * 0.85, W * 0.85], 12, 13, color);
    if (kind === "taxi") box(g, a, [-L * 0.12, L * 0.12], [-W * 0.4, W * 0.4], 13, 15, 0x222222);
    if (kind === "police") {
      box(g, a, [-L * 0.1, L * 0.1], [-W * 0.8, 0], 13, 14.5, 0xe53935);
      box(g, a, [-L * 0.1, L * 0.1], [0, W * 0.8], 13, 14.5, 0x1e88e5);
    }
  }
  return cache(key, g);
}

function lampContext(facing: number): GraphicsContext {
  const key = `lamps:${facing}`;
  const hit = contexts.get(key);
  if (hit) return hit;
  const g = new GraphicsContext();
  const a = (facing * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
  const at = (f: number, w: number, z: number) => iso(f * c - w * s, f * s + w * c, z);
  const glow = at(0.5, 0, 0);
  g.ellipse(glow.x, glow.y, 11, 5).fill({ color: 0xfff1b8, alpha: 0.35 });
  for (const w of [-0.07, 0.07]) {
    const f = at(0.2, w, 5), r = at(-0.2, w, 5);
    g.circle(f.x, f.y, 1.5).fill(0xfff8d0);
    g.circle(r.x, r.y, 1.3).fill(0xff3b30);
  }
  return cache(key, g);
}

function cache(key: string, g: GraphicsContext): GraphicsContext {
  contexts.set(key, g);
  return g;
}
```

Fix up the kept boat code:

- `Boat`'s constructor takes `rng: Rng`, so keep `type Rng` in the rng import (it is there above).
- `drawBoat` uses `shade` and `iso`, both imported above; `WATER_Z` is imported for `Boat.step`.
- `CAR_COLORS` now lives in `roads/trips.ts`; delete it from this file.
- Remove the unused `pick` import if `tsc` reports it.

In `game/src/engine/roads/trips.ts`, `newLook`, give cable cars their color:

```ts
    const color = kind === "taxi" ? 0xffc928 : kind === "police" ? 0xffffff : kind === "bus" ? 0x2f7de1 : kind === "cable-car" ? 0xc8452f : pick(this.rng, CAR_COLORS);
```

- [ ] **Step 6: Wire the scene**

In `game/src/engine/scene.ts`:

Imports: add

```ts
import { buildGraph, type RoadNet } from "./roads/graph";
import { buildPlaces, demand } from "./roads/trips";
```

Fields: add `private readonly net: RoadNet;` next to `traffic`.

Constructor: after `this.grid` is built and the home yard is cleared, add:

```ts
    this.net = buildGraph(this.city.roads, { core: this.city.core });
```

Delete the current `this.traffic = new Traffic(...)` line (line 108), and after the `for (const b of this.buildings)` loop (after `this.replant();`) add:

```ts
    const places = buildPlaces(this.net, this.buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d })), (x, y) => zoneAt(this.city, x, y));
    this.traffic = new Traffic(this.net, this.grid, this.objects, this.ground.waterLayer, this.city.vehicles, this.city.boats, places, seed, clock.visualDaySeconds / 24);
```

In `update()`, replace `cars *= 1 - night * 0.35;` with:

```ts
    cars *= demand(this.clock.timeOfDay * 24);
```

and just before `this.traffic.setTarget(...)` add `this.traffic.setHour(this.clock.timeOfDay * 24);`.

- [ ] **Step 7: Typecheck, suite, and a look**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean.
Run `npm run dev`, open Houston and San Francisco, and watch for two minutes at 1x:

- cars follow lanes on the right, turn on smooth curves, and stop at stop lines;
- queues form at red lights and clear on green; left turns wait for oncoming cars;
- cars merge onto and leave the highway ring by the ramps and ride over the overpasses;
- cars park at the curb and pull out again; buses stop along their routes; the SF cable cars run on the tram line;
- no car pops in or out except with a fade, and none jitter between facings on a straight road.

Anything that looks off is a bug to fix now, per Cayden's standard (screenshots at 1x and at max zoom).

- [ ] **Step 8: Commit**

```bash
git add src/engine/roads/pose.ts src/engine/traffic.ts src/engine/scene.ts src/engine/ground.ts src/engine/roads/trips.ts tests/roads-pose.test.ts
git commit -m "Traffic: draw the road sim's cars, parked cars, and buses in 8 facings"
```
