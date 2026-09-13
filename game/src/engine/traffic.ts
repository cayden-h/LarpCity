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

/** Straight runs of open water, used as boat routes. */
function waterRuns(grid: CityGrid): { x0: number; y0: number; x1: number; y1: number; length: number }[] {
  const runs: { x0: number; y0: number; x1: number; y1: number; length: number }[] = [];
  for (let y = 0; y < grid.h; y++) {
    let start = -1;
    for (let x = 0; x <= grid.w; x++) {
      const wet = x < grid.w && grid.isWater(x, y);
      if (wet && start < 0) start = x;
      if (!wet && start >= 0) {
        runs.push({ x0: start, y0: y, x1: x - 1, y1: y, length: x - start });
        start = -1;
      }
    }
  }
  for (let x = 0; x < grid.w; x++) {
    let start = -1;
    for (let y = 0; y <= grid.h; y++) {
      const wet = y < grid.h && grid.isWater(x, y);
      if (wet && start < 0) start = y;
      if (!wet && start >= 0) {
        runs.push({ x0: x, y0: start, x1: x, y1: y - 1, length: y - start });
        start = -1;
      }
    }
  }
  // Skip runs that hug the same line as a longer parallel run.
  return runs.filter((r, i) => !runs.some((o, j) => j < i && o.length >= r.length && Math.abs(o.x0 - r.x0) + Math.abs(o.y0 - r.y0) <= 1 && (o.x0 === o.x1) === (r.x0 === r.x1)));
}

class Boat {
  private t: number;
  private forward = true;
  private readonly view = new Container();
  private readonly hull: [Graphics, Graphics];
  private readonly lamps = new Graphics();
  private bob = 0;
  private readonly speed: number;
  private readonly run: { x0: number; y0: number; x1: number; y1: number; length: number };

  constructor(kind: BoatKind, run: { x0: number; y0: number; x1: number; y1: number; length: number }, rng: Rng, layer: Container) {
    this.run = run;
    this.t = rng();
    this.speed = (kind === "cruise" || kind === "tanker" ? 0.12 : kind === "kayak" ? 0.2 : 0.3) / run.length;
    const alongX = run.y0 === run.y1;
    this.hull = [drawBoat(kind, alongX, false), drawBoat(kind, alongX, true)];
    this.view.addChild(this.hull[0], this.hull[1], this.lamps);
    this.lamps.circle(0, -10, 1.8).fill(0xfff2b0);
    this.lamps.blendMode = "add";
    layer.addChild(this.view);
    this.bob = rng() * 6;
  }

  step(dt: number, night: number, tint: number): void {
    this.t += (this.forward ? 1 : -1) * this.speed * dt;
    if (this.t > 1) {
      this.t = 1;
      this.forward = false;
    } else if (this.t < 0) {
      this.t = 0;
      this.forward = true;
    }
    this.bob += dt * 2;
    const r = this.run;
    const x = r.x0 + 0.5 + (r.x1 - r.x0) * this.t;
    const y = r.y0 + 0.5 + (r.y1 - r.y0) * this.t;
    const p = iso(x, y, WATER_Z + Math.sin(this.bob) * 0.8);
    this.view.position.set(p.x, p.y);
    this.hull[0].visible = this.forward;
    this.hull[1].visible = !this.forward;
    this.lamps.alpha = night;
    for (const h of this.hull) h.tint = tint;
  }
}

function drawBoat(kind: BoatKind, alongX: boolean, reverse: boolean): Graphics {
  const g = new Graphics();
  const size = kind === "cruise" ? 1.6 : kind === "tanker" ? 1.5 : kind === "ferry" ? 0.9 : kind === "kayak" ? 0.3 : 0.55;
  const sgn = reverse ? -1 : 1;
  const a = alongX ? iso(-size / 2, 0) : iso(0, -size / 2);
  const b = alongX ? iso(size / 2, 0) : iso(0, size / 2);
  const bow = { x: b.x + (b.x - a.x) * 0.12 * sgn, y: b.y + (b.y - a.y) * 0.12 * sgn };
  const w = kind === "kayak" ? 2.5 : kind === "cruise" || kind === "tanker" ? 9 : 6;
  // Wake.
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 2.4, color: 0xffffff, alpha: 0.25 });
  const hull = kind === "tanker" ? 0x8b2f2a : kind === "cruise" ? 0xffffff : kind === "ferry" ? 0xf08a24 : kind === "tug" ? 0xd84315 : kind === "kayak" ? 0xffb300 : 0xf4f4f4;
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 1.6, color: shade(hull, 0.75), cap: "round" });
  g.moveTo(a.x, a.y - 2).lineTo(bow.x, bow.y - 2).stroke({ width: w * 1.3, color: hull, cap: "round" });
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (kind === "sailboat") {
    g.poly([mid.x, mid.y - 3, mid.x, mid.y - 22, mid.x + 10, mid.y - 5]).fill(0xffffff);
    g.poly([mid.x, mid.y - 6, mid.x, mid.y - 18, mid.x - 7, mid.y - 6]).fill(0xe53935);
  } else if (kind === "cruise" || kind === "ferry") {
    for (let k = 0; k < (kind === "cruise" ? 3 : 2); k++) {
      g.moveTo(a.x + (b.x - a.x) * 0.15, a.y - 6 - k * 5).lineTo(a.x + (b.x - a.x) * 0.8, a.y + (b.y - a.y) * 0.65 - 6 - k * 5).stroke({ width: w * 1.1, color: k % 2 ? 0x1e88e5 : 0xffffff, cap: "round" });
    }
    g.rect(mid.x - 3, mid.y - 24, 5, 8).fill(kind === "cruise" ? 0xe53935 : 0x333333);
  } else if (kind === "tanker") {
    const stern = { x: a.x + (b.x - a.x) * (reverse ? 0.8 : 0.15), y: a.y + (b.y - a.y) * (reverse ? 0.8 : 0.15) };
    g.rect(stern.x - 5, stern.y - 16, 10, 12).fill(0xffffff);
    g.rect(stern.x - 2, stern.y - 22, 4, 6).fill(0x333333);
  } else if (kind === "speedboat" || kind === "tug") {
    g.rect(mid.x - 3, mid.y - 9, 6, 5).fill(kind === "tug" ? 0xffffff : 0x90caf9);
  }
  return g;
}
