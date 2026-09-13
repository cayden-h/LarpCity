// Traffic: draws the road sim's cars (moving, parked, and fading out) and
// runs the boats. The sim (roads/sim.ts) steps at a fixed 1/20 s; each frame
// runs the steps the frame covers and draws every car between its last two
// poses. Boats patrol the longest straight runs of water under the bridges.

import { Container, Sprite, type Texture } from "pixi.js";
import { PixelCanvas } from "./pixel/canvas";
import { pixelTexture } from "./pixel/atlas";
import { boatArt } from "./pixel/boats";
import { lampArt, vehicleArt } from "./pixel/vehicles";
import type { CityGrid } from "./grid";
import { WATER_Z } from "./ground";
import { depthOf, iso } from "./iso";
import type { Pose } from "./roads/geometry";
import type { RoadNet } from "./roads/graph";
import { elevation, facingOf, lerpPose } from "./roads/pose";
import { DT, Sim, type Car } from "./roads/sim";
import { buildSpots, spotPose, Trips, type Ghost, type Look, type Parked, type Place } from "./roads/trips";
import { pickWeighted, rngFor, type Rng } from "./rng";
import type { BoatKind, VehicleKind } from "./types";

interface CarView {
  view: Container;
  body: Sprite;
  lamps: Sprite;
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
      const body = new Sprite(vehicleTexture(look, 0));
      const lamps = new Sprite(lampTexture(0));
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
    v.view.position.set(Math.round(p.x), Math.round(p.y));
    // A highway car under an overpass sorts below the deck (drawn at its tile's depth + 60).
    const tx = Math.floor(pose.x), ty = Math.floor(pose.y);
    v.view.zIndex = underpass && this.grid.at(tx, ty) === "O" ? depthOf(tx, ty, 50) : (pose.x + pose.y) * 100 + 40 + (z > 0 ? 45 : 0);
    const facing = facingOf(pose.h);
    if (facing !== v.facing) {
      v.facing = facing;
      v.body.texture = vehicleTexture(v.look, facing);
      v.lamps.texture = lampTexture(facing);
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

/** A vehicle's pixel art at a facing, drawn once per look and facing into the shared atlas (pixel/vehicles.ts). */
function vehicleTexture(look: Look, facing: number): Texture {
  return pixelTexture(`car:${look.kind}:${look.color.toString(16)}:${facing}`, () => vehicleArt(look, facing));
}

function lampTexture(facing: number): Texture {
  return pixelTexture(`car-lamps:${facing}`, () => lampArt(facing));
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
  private readonly hull = new Sprite();
  private readonly lamp: Sprite;
  /** Pixel art per direction (forward, back) and wake frame (pixel/boats.ts). */
  private readonly frames: Texture[][];
  private bob = 0;
  private readonly speed: number;
  private readonly run: { x0: number; y0: number; x1: number; y1: number; length: number };

  constructor(kind: BoatKind, run: { x0: number; y0: number; x1: number; y1: number; length: number }, rng: Rng, layer: Container) {
    this.run = run;
    this.t = rng();
    this.speed = (kind === "cruise" || kind === "tanker" ? 0.12 : kind === "kayak" ? 0.2 : 0.3) / run.length;
    const alongX = run.y0 === run.y1;
    this.frames = [false, true].map((reverse) =>
      [0, 1].map((f) => pixelTexture(`boat:${kind}:${alongX ? "x" : "y"}:${reverse ? 1 : 0}:${f}`, () => boatArt(kind, alongX, reverse, f))),
    );
    this.lamp = new Sprite(pixelTexture("boat-lamp", () => new PixelCanvas(2, 2, 1, 1).rect(-1, -1, 2, 2, 0xfff2b0, { glow: true })));
    this.lamp.position.set(0, -10);
    this.lamp.blendMode = "add";
    this.view.addChild(this.hull, this.lamp);
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
    // The bob moves in whole pixels.
    const p = iso(x, y, WATER_Z + Math.round(Math.sin(this.bob) * 0.8));
    this.view.position.set(Math.round(p.x), Math.round(p.y));
    this.hull.texture = this.frames[this.forward ? 0 : 1][Math.floor(this.bob) % 2];
    this.lamp.alpha = night;
    this.hull.tint = tint;
  }
}
