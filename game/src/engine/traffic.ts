// Cars follow the road grid tile to tile, keep to the right lane, space
// themselves out, climb onto bridges, and switch on lights at night.
// Boats patrol the longest straight runs of water and pass under bridges.

import { Container, Graphics } from "pixi.js";
import { shade } from "./color";
import type { CityGrid } from "./grid";
import { BRIDGE_Z, WATER_Z } from "./ground";
import { DIRS, iso } from "./iso";
import { pick, pickWeighted, rngFor, type Rng } from "./rng";
import type { BoatKind, VehicleKind } from "./types";

const CAR_COLORS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0x263238, 0xfb8c00, 0x8e24aa, 0x00acc1];

interface Car {
  kind: VehicleKind;
  x: number; // current tile
  y: number;
  dir: number; // 0 N, 1 E, 2 S, 3 W
  t: number; // progress to the next tile, 0..1
  speed: number; // tiles per second
  cruise: number;
  view: Container;
  bodies: [Graphics, Graphics]; // [along x, along y]
  lamps: Graphics;
  leaving: boolean;
}

export class Traffic {
  private readonly cars: Car[] = [];
  private readonly boats: Boat[] = [];
  private readonly roadTiles: [number, number][] = [];
  /** Cable-car track tiles; cable cars never leave them. */
  private readonly tramTiles: [number, number][] = [];
  private target = 0;
  private readonly rng: Rng;
  /** Registered by the scene so cars take the time-of-day tint. */
  tint = 0xffffff;
  private readonly grid: CityGrid;
  private readonly objects: Container;
  private readonly waterLayer: Container;
  private readonly kinds: { kind: VehicleKind; weight: number }[];

  constructor(
    grid: CityGrid,
    objects: Container,
    waterLayer: Container,
    kinds: { kind: VehicleKind; weight: number }[],
    boatKinds: { kind: BoatKind; weight: number }[],
    seed: number,
  ) {
    this.grid = grid;
    this.objects = objects;
    this.waterLayer = waterLayer;
    this.kinds = kinds;
    this.rng =rngFor(seed, "traffic");
    for (const { x, y } of grid.cells()) {
      if (grid.at(x, y) === "t") this.tramTiles.push([x, y]);
      else if (grid.isRoad(x, y)) this.roadTiles.push([x, y]);
    }
    this.spawnBoats(boatKinds, seed);
  }

  setTarget(n: number): void {
    this.target = n;
  }

  get count(): number {
    return this.cars.filter((c) => !c.leaving).length;
  }

  update(dt: number, night: number): void {
    // Spawn or retire gradually so traffic swells and thins over a few seconds.
    const live = this.count;
    if (live < this.target && this.rng() < dt * 6) this.spawnCar();
    if (live > this.target) {
      const c = this.cars.find((car) => !car.leaving);
      if (c) c.leaving = true;
    }

    for (const car of this.cars) this.stepCar(car, dt);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car.leaving) {
        car.view.alpha -= dt * 1.5;
        if (car.view.alpha <= 0) {
          car.view.destroy({ children: true });
          this.cars.splice(i, 1);
        }
      } else if (car.view.alpha < 1) car.view.alpha = Math.min(1, car.view.alpha + dt * 2);
      car.lamps.alpha = night;
      for (const b of car.bodies) b.tint = this.tint;
    }
    for (const boat of this.boats) boat.step(dt, night, this.tint);
  }

  /** Road links a vehicle of this kind may take: cable cars stay on their tracks. */
  private links(kind: VehicleKind, x: number, y: number): boolean[] {
    const links = this.grid.roadLinks(x, y);
    if (kind !== "cable-car") return links;
    return links.map((ok, d) => ok && this.grid.at(x + DIRS[d].dx, y + DIRS[d].dy) === "t");
  }

  private spawnCar(): void {
    const kind = pickWeighted(this.rng, this.kinds.map((k) => ({ weight: k.weight, value: k.kind })));
    const pool = kind === "cable-car" ? this.tramTiles : this.roadTiles;
    if (!pool.length) return;
    const [x, y] = pick(this.rng, pool);
    const dirs = this.links(kind, x, y).map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    if (!dirs.length) return;
    const color = kind === "taxi" ? 0xffc928 : kind === "police" ? 0xffffff : kind === "bus" ? 0x2f7de1 : pick(this.rng, CAR_COLORS);
    const view = new Container();
    const bodies: [Graphics, Graphics] = [drawVehicle(kind, color, true), drawVehicle(kind, color, false)];
    const lamps = new Graphics();
    view.addChild(bodies[0], bodies[1], lamps);
    view.alpha = 0;
    const cruise = (kind === "bus" ? 0.75 : kind === "cable-car" ? 0.5 : 1.05) * (0.85 + this.rng() * 0.3);
    const car: Car = { kind, x, y, dir: pick(this.rng, dirs), t: this.rng() * 0.5, speed: cruise, cruise, view, bodies, lamps, leaving: false };
    this.cars.push(car);
    this.objects.addChild(view);
    this.place(car);
  }

  private stepCar(car: Car, dt: number): void {
    // Brake if another car is close ahead in the same lane.
    let gap = Infinity;
    const [ax, ay] = this.pos(car);
    for (const other of this.cars) {
      if (other === car || other.dir !== car.dir) continue;
      const [bx, by] = this.pos(other);
      const dx = bx - ax, dy = by - ay;
      const ahead = dx * DIRS[car.dir].dx + dy * DIRS[car.dir].dy;
      const side = Math.abs(dx * DIRS[car.dir].dy - dy * DIRS[car.dir].dx);
      if (ahead > 0 && side < 0.2) gap = Math.min(gap, ahead);
    }
    const want = gap < 0.42 ? 0 : gap < 0.8 ? car.cruise * 0.45 : car.cruise;
    car.speed += (want - car.speed) * Math.min(1, dt * 5);
    car.t += car.speed * dt;
    while (car.t >= 1) {
      car.t -= 1;
      car.x += DIRS[car.dir].dx;
      car.y += DIRS[car.dir].dy;
      car.dir = this.nextDir(car);
    }
    this.place(car);
  }

  private nextDir(car: Car): number {
    const links = this.links(car.kind, car.x, car.y);
    const back = (car.dir + 2) % 4;
    const options: { weight: number; value: number }[] = [];
    links.forEach((ok, d) => {
      if (!ok || d === back) return;
      options.push({ weight: d === car.dir ? 3 : 1, value: d });
    });
    return options.length ? pickWeighted(this.rng, options) : back;
  }

  /** Continuous tile-space position including the lane offset. */
  private pos(car: Car): [number, number] {
    const d = DIRS[car.dir];
    // Right-hand lane: offset to the right of the direction of travel.
    const laneX = -d.dy * 0.2, laneY = d.dx * 0.2;
    return [car.x + 0.5 + d.dx * car.t + laneX, car.y + 0.5 + d.dy * car.t + laneY];
  }

  private place(car: Car): void {
    const [px, py] = this.pos(car);
    const here = this.grid.at(car.x, car.y) === "B" ? BRIDGE_Z : 0;
    const nx = car.x + DIRS[car.dir].dx, ny = car.y + DIRS[car.dir].dy;
    const there = this.grid.at(nx, ny) === "B" ? BRIDGE_Z : 0;
    const z = here + (there - here) * car.t;
    const p = iso(px, py, z);
    car.view.position.set(p.x, p.y);
    car.view.zIndex = (px + py) * 100 + 40 + (z > 0 ? 30 : 0);
    const alongX = car.dir === 1 || car.dir === 3;
    car.bodies[0].visible = alongX;
    car.bodies[1].visible = !alongX;
    drawLamps(car.lamps, car.dir);
  }

  private spawnBoats(kinds: { kind: BoatKind; weight: number }[], seed: number): void {
    if (!kinds.length) return;
    const rng = rngFor(seed, "boats");
    const runs = waterRuns(this.grid).filter((r) => r.length >= 5).sort((a, b) => b.length - a.length);
    const n = Math.min(runs.length, 2 + Math.floor(runs.length / 3), 7);
    for (let i = 0; i < n; i++) {
      const run = runs[i];
      const kind = pickWeighted(rng, kinds.map((k) => ({ weight: k.weight, value: k.kind })));
      this.boats.push(new Boat(kind, run, rng, this.waterLayer));
    }
  }
}

/** A vehicle drawn as a small iso toy car, facing along x or along y. */
function drawVehicle(kind: VehicleKind, color: number, alongX: boolean): Graphics {
  const g = new Graphics();
  const len = kind === "bus" || kind === "cable-car" ? 0.62 : kind === "pickup" || kind === "van" || kind === "snowplow" ? 0.44 : 0.38;
  const wid = kind === "bus" || kind === "cable-car" ? 0.24 : 0.2;
  const hx = alongX ? len / 2 : wid / 2, hy = alongX ? wid / 2 : len / 2;
  const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, c: number) => {
    const T = iso(x0, y0, z1), R = iso(x1, y0, z1), B = iso(x1, y1, z1), L = iso(x0, y1, z1);
    const Bd = iso(x1, y1, z0), Ld = iso(x0, y1, z0), Rd = iso(x1, y0, z0);
    g.poly([L.x, L.y, B.x, B.y, Bd.x, Bd.y, Ld.x, Ld.y]).fill(shade(c, 0.9));
    g.poly([B.x, B.y, R.x, R.y, Rd.x, Rd.y, Bd.x, Bd.y]).fill(shade(c, 0.72));
    g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill(shade(c, 1.1));
  };
  // Shadow and wheels.
  const s = iso(0, 0);
  g.ellipse(s.x, s.y + 1, (hx + hy) * 34, (hx + hy) * 14).fill({ color: 0x000000, alpha: 0.16 });
  for (const [wx, wy] of [[-hx * 0.6, hy], [hx * 0.6, hy], [hx, -hy * 0.6], [hx, hy * 0.6]] as const) {
    const p = iso(alongX ? wx : wy === hy ? hx : wx, alongX ? wy : wx === hx ? wy : hy);
    g.circle(p.x, p.y - 1.5, 2.2).fill(0x1c1c1c);
  }
  const tall = kind === "bus" || kind === "cable-car" ? 16 : kind === "van" ? 13 : 8;
  box(-hx, -hy, hx, hy, 2, 2 + (kind === "bus" || kind === "cable-car" || kind === "van" ? tall : 6), color);
  if (kind === "cable-car") {
    box(-hx * 0.92, -hy * 0.92, hx * 0.92, hy * 0.92, 18, 20, 0x8d2b20);
    g.moveTo(iso(0, 0, 20).x, iso(0, 0, 20).y).lineTo(iso(0, 0, 26).x, iso(0, 0, 26).y).stroke({ width: 1, color: 0x333333 });
  } else if (kind !== "bus" && kind !== "van") {
    // Cabin with windows.
    const cx = alongX ? hx * 0.55 : hx, cy = alongX ? hy : hy * 0.55;
    if (kind === "pickup" || kind === "snowplow") box(alongX ? -hx * 0.1 : -cx, alongX ? -cy : -hy * 0.1, alongX ? cx : cx, alongX ? cy : cy, 8, 14, 0xb8e0f5);
    else if (kind === "convertible") box(-cx, -cy, cx, cy, 8, 9, 0x5d4037);
    else box(-cx, -cy, cx, cy, 8, 13, 0xb8e0f5);
    const roof = iso(0, 0, kind === "convertible" ? 9 : 13);
    if (kind !== "convertible" && kind !== "pickup" && kind !== "snowplow") g.ellipse(roof.x, roof.y, 4, 2).fill(shade(color, 1.05));
    if (kind === "taxi") g.rect(roof.x - 3, roof.y - 4, 6, 3).fill(0x222222);
    if (kind === "police") {
      g.rect(roof.x - 4, roof.y - 3, 4, 2.5).fill(0xe53935);
      g.rect(roof.x, roof.y - 3, 4, 2.5).fill(0x1e88e5);
    }
    if (kind === "snowplow") {
      const b0 = iso(alongX ? hx + 0.05 : -hy - 0.02, alongX ? -hy - 0.05 : hy + 0.05, 2);
      g.circle(b0.x, b0.y, 3).fill(0xff9800);
    }
  } else {
    // Bus and van windows as a band.
    for (let i = 0; i < 4; i++) {
      const t = -0.8 + i * 0.5;
      const p = alongX ? iso(hx * t, hy, 11) : iso(hx, hy * t, 11);
      g.rect(p.x - 2.5, p.y - 2, 5, 3.5).fill(0xb8e0f5);
    }
  }
  return g;
}

function drawLamps(g: Graphics, dir: number): void {
  g.clear();
  const d = DIRS[dir];
  const front = iso(d.dx * 0.24, d.dy * 0.24, 5);
  const back = iso(-d.dx * 0.22, -d.dy * 0.22, 5);
  g.ellipse(front.x + d.dx * 10 - d.dy * 10, front.y + (d.dx + d.dy) * 5, 11, 5).fill({ color: 0xfff1b8, alpha: 0.35 });
  g.circle(front.x, front.y, 1.8).fill(0xfff8d0);
  g.circle(back.x, back.y, 1.6).fill(0xff3b30);
  g.blendMode = "add";
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
