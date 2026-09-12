// Rural "state signature" landmarks: wind farm, oil pumpjacks, farmstead,
// power plant, and racetrack. Built once as static models; animation only
// moves, rotates, or fades small child objects so many can be on screen.
// Stylized shapes only: no logos or real signage.

import { Container, Graphics } from "pixi.js";
import { shade } from "../../engine/color";
import { depthOf, HALF_H, HALF_W, iso } from "../../engine/iso";
import { rngFor } from "../../engine/rng";
import { box, cylinder, line3 } from "../../engine/shapes";
import type { Season } from "../../engine/clock";
import type { LandmarkFactory } from "../../engine/types";

const GRASS = 0x6dbb4a;
const WHITE = 0xf4f4f0;

/** Screen angle of the tile x axis; a skewed container maps the world x-z plane to the screen. */
const SKEW = Math.atan2(HALF_H, HALF_W);
const COS = Math.cos(SKEW), SIN = Math.sin(SKEW);
/** Screen length of one tile step along x. */
const TILE_X = Math.hypot(HALF_W, HALF_H);

/** How much a landmark scales against its intended footprint, clamped to stay readable. */
function fit(w: number, d: number, W: number, D: number): number {
  return Math.min(1.3, Math.max(0.6, Math.min(w / W, d / D)));
}

/** A container whose local x runs along the tile x axis and local y is straight down (minus z). */
function planeX(at: { x: number; y: number }, ...children: Container[]): Container {
  const c = new Container();
  c.position.set(at.x, at.y);
  c.skew.set(0, SKEW);
  for (const child of children) c.addChild(child);
  return c;
}

/** Screen offset of a point (lx, ly) in a planeX container rotated by `a`. */
function planeOffset(lx: number, ly: number, a: number): { x: number; y: number } {
  const rx = lx * Math.cos(a) - ly * Math.sin(a);
  const ry = lx * Math.sin(a) + ly * Math.cos(a);
  return { x: rx * COS, y: rx * SIN + ry };
}

/** A low base slab under the footprint. */
function plate(g: Graphics, x: number, y: number, w: number, d: number, z: number, color: number): void {
  box(g, x + 0.04, y + 0.04, w - 0.08, d - 0.08, 0, z, color);
}

/** A tapered vertical mast with a lit left half and a shaded right half. */
function mast(g: Graphics, cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, color: number): void {
  const b = iso(cx, cy, z0), t = iso(cx, cy, z1);
  g.poly([b.x - r0, b.y, b.x, b.y, t.x, t.y, t.x - r1, t.y]).fill(shade(color, 1.02));
  g.poly([b.x, b.y, b.x + r0, b.y, t.x + r1, t.y, t.x, t.y]).fill(shade(color, 0.76));
  g.ellipse(t.x, t.y, r1, r1 / 2).fill(shade(color, 1.1));
}

// ---------------------------------------------------------------------------

/** White wind turbines on a grass patch; rotors spin faster in storms, red lights blink at night. */
export const windFarm: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const hs = fit(w, d, 3, 3);
  const root = new Container();
  const tintables: Container[] = [];
  const base = new Graphics();
  plate(base, x, y, w, d, 4, GRASS);
  const spots: [number, number][] =
    w * d >= 6 ? [[0.26, 0.24], [0.76, 0.3], [0.28, 0.74], [0.74, 0.78]] : [[0.28, 0.3], [0.74, 0.36], [0.5, 0.78]];
  const pts = spots.map(([u, v]) => [x + u * w, y + v * d] as [number, number]).sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  // Gravel service track linking the pads.
  for (let i = 1; i < pts.length; i++) line3(base, [pts[i - 1][0], pts[i - 1][1], 4.5], [pts[i][0], pts[i][1], 4.5], 3, 0xcdb68e);
  root.addChild(base);
  tintables.push(base);

  const rotors: { g: Graphics; speed: number }[] = [];
  const lights: { g: Graphics; phase: number }[] = [];
  const rng = rngFor("wind-farm", x, y);
  for (const [tx, ty] of pts) {
    const H = 118 * hs, top = 8 + H;
    const tower = new Graphics();
    box(tower, tx - 0.1, ty - 0.1, 0.2, 0.2, 4, 8, 0xc9c9c4);
    mast(tower, tx, ty, 8, top, 4.4 * hs, 2.2 * hs, WHITE);
    // Nacelle along y, the rotor on its +y (front-left) end.
    box(tower, tx - 0.05, ty - 0.16, 0.1, 0.24, top - 2, top + 6, WHITE);
    const rotor = new Graphics();
    const L = 38 * hs;
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      const blade: number[] = [];
      for (const [bx, by] of [[-2.4, -1], [2.4, -1], [0.9, -L], [-0.5, -L - 1.2]] as const) {
        blade.push(bx * Math.cos(a) - by * Math.sin(a), bx * Math.sin(a) + by * Math.cos(a));
      }
      rotor.poly(blade).fill(0xfbfbf8).stroke({ width: 0.8, color: 0xc4c6c2 });
    }
    rotor.circle(0, 0, 3.4 * hs).fill(0xe2e3df);
    rotor.circle(-0.8, -0.8, 1.6 * hs).fill(0xffffff);
    rotor.rotation = rng() * Math.PI * 2;
    const turbine = new Container();
    turbine.addChild(tower, planeX(iso(tx, ty + 0.1, top + 2), rotor));
    const light = new Graphics();
    const lp = iso(tx, ty - 0.03, top + 7);
    light.circle(lp.x, lp.y, 5).fill({ color: 0xff3b30, alpha: 0.35 });
    light.circle(lp.x, lp.y, 2).fill(0xff5a4f);
    light.blendMode = "add";
    light.alpha = 0;
    root.addChild(turbine, light);
    tintables.push(turbine);
    rotors.push({ g: rotor, speed: 0.9 + rng() * 0.35 });
    lights.push({ g: light, phase: rng() });
  }
  root.zIndex = depthOf(x + w - 1, y + d - 1, 60);
  let t = 0;
  return {
    views: [root],
    tintables,
    update: (dt) => {
      t += dt;
      const spin = 1.2 + 3.4 * ctx.storm();
      for (const r of rotors) r.g.rotation = (r.g.rotation + dt * spin * r.speed) % (Math.PI * 2);
      const n = ctx.night();
      for (const l of lights) l.g.alpha = n * ((t * 0.8 + l.phase) % 1 < 0.35 ? 1 : 0.1);
    },
  };
};

// ---------------------------------------------------------------------------

interface Pumpjack {
  beam: Graphics;
  crank: Graphics;
  pitman: Graphics;
  rod: Graphics;
  pivot: { x: number; y: number };
  crankAt: { x: number; y: number };
  wellTop: number;
  headLx: number;
  tailLx: number;
  crankR: number;
  phase: number;
  rate: number;
}

/** Walking-beam oil pumps nodding out of phase, a storage tank, a flare, and a work light. */
export const pumpjacks: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const hs = fit(w, d, 3, 2);
  const root = new Container();
  const tintables: Container[] = [];
  const base = new Graphics();
  plate(base, x, y, w, d, 3, 0xb58a58);
  // Storage tank in the back-right corner and a thin flare stack in the back-left.
  const tankX = x + w * 0.84, tankY = y + d * 0.24;
  cylinder(base, tankX, tankY, 12 * hs, 3, 30 * hs, 0xece6d6);
  cylinder(base, tankX, tankY, 12.2 * hs, 20 * hs, 24 * hs, 0x2f6fd6);
  line3(base, [tankX + 0.18, tankY + 0.12, 4], [tankX + 0.18, tankY + 0.12, 30 * hs], 1, 0x8d9196);
  const flareX = x + w * 0.1, flareY = y + d * 0.16, flareTop = 64 * hs;
  box(base, flareX - 0.06, flareY - 0.06, 0.12, 0.12, 3, 7, 0x6d7176);
  mast(base, flareX, flareY, 7, flareTop, 2.4, 1.8, 0xd8d8d4);
  cylinder(base, flareX, flareY, 2.2, flareTop - 10, flareTop - 5, 0xd84315);
  // Work light on a pole at the front-right corner, head aimed back at the pad.
  const poleX = x + w - 0.14, poleY = y + d - 0.14, poleTop = 44 * hs;
  line3(base, [poleX, poleY, 3], [poleX, poleY, poleTop], 2, 0x7b7f84);
  box(base, poleX - 0.08, poleY - 0.04, 0.14, 0.08, poleTop - 2, poleTop + 3, 0x3d4146);
  root.addChild(base);
  tintables.push(base);

  const colors = [0xf2c318, 0x2f6fd6, 0xd6452f];
  const n = w >= 2.5 ? 3 : 2;
  const jacks: Pumpjack[] = [];
  const rng = rngFor("pumpjacks", x, y);
  const spots = Array.from({ length: n }, (_, i) => ({
    px: x + 0.45 + (i * (w - 1)) / (n - 1),
    py: y + d * (0.52 + (i % 2) * 0.22),
    color: colors[i % colors.length],
  })).sort((a, b) => a.px + a.py - (b.px + b.py));
  for (const { px, py, color } of spots) {
    const g = new Graphics();
    const front = new Graphics();
    const pivZ = 40 * hs, crankZ = 15 * hs;
    const dark = 0x4e5257;
    box(g, px - 0.42, py - 0.08, 0.86, 0.16, 3, 6, dark);
    // Samson post: back legs behind the beam, front legs drawn over it.
    for (const dx of [-0.1, 0.1]) line3(g, [px + dx, py - 0.07, 6], [px, py, pivZ], 2.4, shade(color, 0.72));
    for (const dx of [-0.1, 0.1]) line3(front, [px + dx, py + 0.07, 6], [px, py, pivZ], 2.4, shade(color, 0.95));
    box(g, px - 0.38, py - 0.06, 0.16, 0.12, 6, crankZ + 2, dark);
    // Crank arms with counterweights, turning in the beam's plane.
    const crankR = 8 * hs;
    const crank = new Graphics();
    crank.rect(-crankR, -1.5, crankR * 2, 3).fill(0x3a3d41);
    for (const s of [-1, 1]) crank.roundRect(s * crankR - 3.5, -4.5, 7, 9, 2).fill(shade(color, 0.85));
    crank.circle(0, 0, 2).fill(0x9ea3a8);
    const crankAt = iso(px - 0.3, py + 0.02, crankZ);
    const pitman = new Graphics();
    pitman.rect(0, -1, 1, 2).fill(0x3a3d41);
    // Walking beam with the horse head at +x and the tail over the crank.
    const headLx = 0.36 * TILE_X, tailLx = -0.3 * TILE_X;
    const beam = new Graphics();
    beam.rect(tailLx, -2.8, headLx - tailLx, 5.6).fill(shade(color, 0.9));
    beam.rect(tailLx, -2.8, headLx - tailLx, 2).fill(shade(color, 1.12));
    beam.roundRect(tailLx - 3, -4, 7, 8, 1.5).fill(0x3a3d41);
    beam.poly([headLx - 3, -8, headLx + 4, -8, headLx + 8, -2, headLx + 8, 6, headLx + 5, 13, headLx, 13, headLx - 3, 4]).fill(shade(color, 1.0));
    beam.poly([headLx + 4, -8, headLx + 8, -2, headLx + 8, 6, headLx + 5, 13, headLx + 3, 13, headLx + 5, 4]).fill(shade(color, 0.78));
    beam.circle(0, 0, 2.2).fill(0x3a3d41);
    const pivot = iso(px, py, pivZ);
    const rod = new Graphics();
    rod.rect(-0.8, 0, 1.6, 1).fill(0x2b2d30);
    const wellX = px + (headLx + 4) / TILE_X;
    const well = new Graphics();
    box(well, wellX - 0.05, py - 0.05, 0.1, 0.1, 3, 9, 0x8d9196);
    line3(well, [wellX - 0.1, py, 6], [wellX + 0.1, py, 6], 2, 0x6d7176);
    const jack = new Container();
    jack.addChild(g, planeX(crankAt, crank), pitman, planeX(pivot, beam), front, rod, well);
    root.addChild(jack);
    tintables.push(jack);
    jacks.push({
      beam, crank, pitman, rod, pivot, crankAt, crankR, headLx, tailLx,
      wellTop: iso(wellX, py, 9).y,
      phase: rng() * Math.PI * 2,
      rate: 2.0 + rng() * 0.5,
    });
  }

  // Flame: a small pre-drawn shape that flickers by scale; glow and work light fade in at night.
  const flameAt = iso(flareX, flareY, flareTop);
  const flame = new Graphics();
  flame.ellipse(0, -8, 4.5, 9).fill({ color: 0xff8f00, alpha: 0.95 });
  flame.ellipse(0, -5, 2.2, 5).fill({ color: 0xfff176, alpha: 0.95 });
  flame.position.set(flameAt.x, flameAt.y);
  const glow = new Graphics();
  glow.circle(flameAt.x, flameAt.y - 6, 16).fill({ color: 0xff9800, alpha: 0.28 });
  const head = iso(poleX - 0.02, poleY, poleTop);
  const pool = iso(x + w * 0.55, y + d * 0.6, 3);
  glow.poly([head.x - 3, head.y, head.x + 3, head.y, pool.x + 40, pool.y, pool.x - 40, pool.y]).fill({ color: 0xfff3c4, alpha: 0.1 });
  glow.ellipse(pool.x, pool.y, 46, 22).fill({ color: 0xfff3c4, alpha: 0.14 });
  glow.circle(head.x, head.y, 3).fill(0xfffbe0);
  glow.blendMode = "add";
  glow.alpha = 0;
  root.addChild(flame, glow);
  root.zIndex = depthOf(x + w - 1, y + d - 1, 60);
  let t = 0;
  return {
    views: [root],
    tintables,
    update: (dt) => {
      t += dt;
      for (const j of jacks) {
        const th = t * j.rate + j.phase;
        const a = 0.2 * Math.sin(th);
        j.beam.rotation = a;
        j.crank.rotation = th;
        const tip = planeOffset(j.headLx + 4, 13, a);
        j.rod.position.set(j.pivot.x + tip.x, j.pivot.y + tip.y);
        j.rod.scale.y = Math.max(1, j.wellTop - (j.pivot.y + tip.y));
        const tail = planeOffset(j.tailLx, 2, a);
        const pin = planeOffset(-j.crankR, 0, th);
        const px = j.crankAt.x + pin.x, py = j.crankAt.y + pin.y;
        const dx = j.pivot.x + tail.x - px, dy = j.pivot.y + tail.y - py;
        j.pitman.position.set(px, py);
        j.pitman.rotation = Math.atan2(dy, dx);
        j.pitman.scale.x = Math.hypot(dx, dy);
      }
      const f = 0.85 + 0.18 * Math.sin(t * 13) + 0.1 * Math.sin(t * 7.3);
      flame.scale.set(0.9 + 0.1 * f, f);
      glow.alpha = ctx.night();
    },
  };
};

// ---------------------------------------------------------------------------

const CROP: Record<Season, number> = { spring: 0x9ccc65, summer: 0x2e7d32, fall: 0xd9a92e, winter: 0x8d6e4f };

/** Red barn with a gambrel roof, a domed silo, a paddock, seasonal crop rows, and a windmill pump. */
export const farmstead: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const hs = fit(w, d, 3, 3);
  const at = (u: number, v: number): [number, number] => [x + u * w, y + v * d];
  const root = new Container();
  const g = new Graphics();
  const lit = new Graphics();
  plate(g, x, y, w, d, 4, GRASS);

  // Crop field (front-left) is its own Graphics, redrawn only when the season turns.
  const [fx0, fy0] = at(0.06, 0.52), [fx1, fy1] = at(0.5, 0.95);
  const soil = new Graphics();
  box(soil, fx0, fy0, fx1 - fx0, fy1 - fy0, 4, 5, 0x8d5a3b);
  const crops = new Graphics();
  const rows = Math.max(3, Math.round((fy1 - fy0) / 0.16));
  const drawCrops = (season: Season) => {
    crops.clear();
    const c = CROP[season];
    const rng = rngFor("farmstead-crops", x, y, season);
    for (let i = 0; i < rows; i++) {
      const ry = fy0 + ((i + 0.5) * (fy1 - fy0)) / rows;
      const a: [number, number, number] = [fx0 + 0.06, ry, 5], b: [number, number, number] = [fx1 - 0.06, ry, 5];
      if (season === "winter") {
        line3(crops, a, b, 2.5, shade(c, 0.8));
        for (let k = 0; k < 6; k++) {
          const p = iso(fx0 + 0.08 + rng() * (fx1 - fx0 - 0.16), ry + (rng() - 0.5) * 0.08, 5.5);
          crops.ellipse(p.x, p.y, 3 + rng() * 2, 1.5).fill({ color: 0xffffff, alpha: 0.85 });
        }
        continue;
      }
      const tall = season === "summer" ? 6 : season === "fall" ? 5 : 3;
      line3(crops, [a[0], a[1], 5], [b[0], b[1], 5], 4.5, shade(c, 0.72));
      line3(crops, [a[0], a[1], 5 + tall], [b[0], b[1], 5 + tall], 4, c);
      if (season === "fall")
        for (let k = 0; k < 3; k++) {
          const p = iso(fx0 + 0.1 + rng() * (fx1 - fx0 - 0.2), ry, 12);
          crops.poly([p.x - 2.5, p.y + 5, p.x + 2.5, p.y + 5, p.x, p.y - 4]).fill(0xf2c14e);
        }
    }
  };
  let season = ctx.clock.season;
  drawCrops(season);

  // Silo (back-left) with metal bands and a domed cap.
  const silo = new Graphics();
  const [sx, sy] = at(0.2, 0.2);
  const siloTop = 104 * hs, siloR = 12 * hs;
  cylinder(silo, sx, sy, siloR, 4, siloTop, 0xe7e2d8);
  for (let z = 22; z < siloTop - 4; z += 20) cylinder(silo, sx, sy, siloR + 0.3, z, z + 2, 0xb9b4aa);
  const dome = iso(sx, sy, siloTop);
  silo.moveTo(dome.x - siloR, dome.y).arc(dome.x, dome.y, siloR, Math.PI, 0).fill(0xb0bec5);
  silo.moveTo(dome.x - siloR, dome.y).arc(dome.x, dome.y, siloR, Math.PI, Math.PI * 1.45).lineTo(dome.x, dome.y).fill({ color: 0xffffff, alpha: 0.35 });
  silo.circle(dome.x, dome.y - siloR, 1.8).fill(0x90a4ae);

  // Barn (back-right): ridge along y so the white-trimmed gambrel end faces front-left.
  const barn = new Graphics();
  const [bx0, by0] = at(0.44, 0.1), [bx1, by1] = at(0.92, 0.46);
  const red = 0xc0392b, roof = 0x4a4f57, trim = 0xffffff;
  const bw = bx1 - bx0, eave = 26 * hs;
  box(barn, bx0, by0, bw, by1 - by0, 4, eave, red);
  const prof: [number, number][] = [[bx0, eave], [bx0 + bw * 0.14, eave + 15 * hs], [bx0 + bw / 2, eave + 25 * hs], [bx1 - bw * 0.14, eave + 15 * hs], [bx1, eave]];
  const roofShade = [0.8, 1.12, 0.96, 0.76];
  for (const i of [0, 1, 2, 3]) {
    const [ax, az] = prof[i], [cx, cz] = prof[i + 1];
    const q = [iso(ax, by0 - 0.04, az), iso(cx, by0 - 0.04, cz), iso(cx, by1 + 0.04, cz), iso(ax, by1 + 0.04, az)];
    barn.poly(q.flatMap((p) => [p.x, p.y])).fill(shade(roof, roofShade[i]));
  }
  const gable = [iso(bx0, by1, 4), iso(bx1, by1, 4), ...prof.slice().reverse().map(([px, pz]) => iso(px, by1, pz))];
  barn.poly(gable.flatMap((p) => [p.x, p.y])).fill(shade(red, 0.95));
  barn.poly(gable.slice(1).flatMap((p) => [p.x, p.y]), false).stroke({ width: 2, color: trim, join: "round" });
  line3(barn, [bx0, by1, 4], [bx0, by1, eave], 2, trim);
  line3(barn, [bx1, by1, 4], [bx1, by1, eave], 2, trim);
  line3(barn, [bx1, by0, 4], [bx1, by0, eave], 2, shade(trim, 0.8));
  // Big sliding door with a white X, and a hay loft door above.
  const dm = bx0 + bw / 2, dh = eave - 6;
  const door = [iso(dm - bw * 0.22, by1 + 0.01, 4), iso(dm + bw * 0.22, by1 + 0.01, 4), iso(dm + bw * 0.22, by1 + 0.01, dh), iso(dm - bw * 0.22, by1 + 0.01, dh)];
  barn.poly(door.flatMap((p) => [p.x, p.y])).fill(shade(red, 0.82)).stroke({ width: 1.8, color: trim });
  barn.moveTo(door[0].x, door[0].y).lineTo(door[2].x, door[2].y).moveTo(door[1].x, door[1].y).lineTo(door[3].x, door[3].y).stroke({ width: 1.4, color: trim });
  const loft = [iso(dm - bw * 0.08, by1 + 0.01, eave + 4), iso(dm + bw * 0.08, by1 + 0.01, eave + 4), iso(dm + bw * 0.08, by1 + 0.01, eave + 13 * hs), iso(dm - bw * 0.08, by1 + 0.01, eave + 13 * hs)];
  barn.poly(loft.flatMap((p) => [p.x, p.y])).fill(0x5d2a1f).stroke({ width: 1.5, color: trim });
  lit.poly(loft.flatMap((p) => [p.x, p.y])).fill(0xffc86b);
  const lamp = iso(dm, by1 + 0.03, dh + 3);
  barn.circle(lamp.x, lamp.y, 1.6).fill(0x333333);
  lit.circle(lamp.x, lamp.y, 2.5).fill(0xfff1b8);
  lit.ellipse(lamp.x, iso(dm, by1 + 0.25, 4).y, 22, 10).fill({ color: 0xffd47e, alpha: 0.22 });

  // Windmill water pump (left): lattice tower, tail vane, and a slowly turning wheel.
  const mill = new Graphics();
  const [mx, my] = at(0.1, 0.44);
  const millTop = 72 * hs;
  cylinder(mill, mx + 0.16, my + 0.1, 7 * hs, 4, 10, 0x9ea3a8);
  cylinder(mill, mx + 0.16, my + 0.1, 6 * hs, 9, 10, 0x4fa3d9);
  const legs: [number, number][] = [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]];
  for (const [lx, ly] of legs) {
    line3(mill, [mx + lx, my + ly, 4], [mx + lx * 0.2, my + ly * 0.2, millTop], 1.6, 0x8a8f94);
    for (let z = 16; z < millTop - 8; z += 16) {
      const k = z / millTop;
      line3(mill, [mx + lx * (1 - 0.8 * k), my + ly * (1 - 0.8 * k), z], [mx - lx * (1 - 0.8 * k), my + ly * (1 - 0.8 * k), z], 0.8, 0xa6abb0);
    }
  }
  line3(mill, [mx, my, millTop], [mx, my - 0.3, millTop + 2], 1.6, 0x8a8f94);
  const vane = [iso(mx, my - 0.22, millTop + 8), iso(mx, my - 0.42, millTop + 8), iso(mx, my - 0.42, millTop - 3), iso(mx, my - 0.22, millTop)];
  mill.poly(vane.flatMap((p) => [p.x, p.y])).fill(0xd6452f);
  const wheel = new Graphics();
  const WR = 12 * hs;
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2, b = a + 0.26;
    wheel.poly([Math.cos(a) * 3, Math.sin(a) * 3, Math.cos(a) * WR, Math.sin(a) * WR, Math.cos(b) * WR, Math.sin(b) * WR]).fill(k % 2 ? 0xe9ecee : 0xc9cfd3);
  }
  wheel.circle(0, 0, WR).stroke({ width: 1, color: 0x8a8f94 });
  wheel.circle(0, 0, 2.4).fill(0x6d7176);

  // Paddock (front-right): trampled dirt, a white rail fence, and two cows.
  const pad = new Graphics();
  const [px0, py0] = at(0.58, 0.58), [px1, py1] = at(0.95, 0.95);
  box(pad, px0, py0, px1 - px0, py1 - py0, 4, 4.6, 0xb89464);
  const cow = (cx: number, cy: number) => {
    box(pad, cx, cy, 0.2, 0.09, 6, 13, 0xfafafa);
    box(pad, cx + 0.2, cy + 0.01, 0.06, 0.07, 10, 16, 0x3a3a3a);
    box(pad, cx + 0.05, cy, 0.07, 0.09, 9, 13.2, 0x2b2b2b);
    for (const lx of [0.02, 0.16]) line3(pad, [cx + lx, cy + 0.08, 4.6], [cx + lx, cy + 0.08, 7], 1.6, 0x3a3a3a);
  };
  cow(px0 + (px1 - px0) * 0.2, py0 + (py1 - py0) * 0.3);
  cow(px0 + (px1 - px0) * 0.45, py0 + (py1 - py0) * 0.65);
  const fence: [number, number][] = [[px0, py0], [px1, py0], [px1, py1], [px0, py1]];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = fence[i], [cx, cy] = fence[(i + 1) % 4];
    for (const z of [8, 12]) line3(pad, [ax, ay, z], [cx, cy, z], 1.4, 0xffffff);
    const len = Math.hypot(cx - ax, cy - ay), posts = Math.max(2, Math.round(len / 0.22));
    for (let k = 0; k < posts; k++) {
      const s = k / posts;
      line3(pad, [ax + (cx - ax) * s, ay + (cy - ay) * s, 4], [ax + (cx - ax) * s, ay + (cy - ay) * s, 14], 2, 0xf0f0ec);
    }
  }

  lit.blendMode = "add";
  lit.alpha = 0;
  const body = new Container();
  body.addChild(g, soil, crops, silo, barn, mill, planeX(iso(mx, my + 0.08, millTop), wheel), pad);
  root.addChild(body, lit);
  root.zIndex = depthOf(x + w - 1, y + d - 1, 60);
  return {
    views: [root],
    tintables: [body],
    update: (dt) => {
      if (ctx.clock.season !== season) {
        season = ctx.clock.season;
        drawCrops(season);
      }
      wheel.rotation = (wheel.rotation + dt * (0.7 + 2.6 * ctx.storm())) % (Math.PI * 2);
      lit.alpha = ctx.night();
    },
  };
};

// ---------------------------------------------------------------------------

/** A hyperboloid cooling tower: flared base, pinched waist, and a dark open top. */
function coolingTower(g: Graphics, cx: number, cy: number, R: number, H: number, color: number): { x: number; y: number } {
  const rw = R * 0.62, zw = H * 0.72;
  const c = zw / Math.sqrt((R / rw) ** 2 - 1);
  const r = (z: number) => rw * Math.sqrt(1 + ((z - zw) / c) ** 2);
  const b = iso(cx, cy, 4);
  const steps = 14;
  const band = (f0: number, f1: number, col: number) => {
    const pts: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = (H * i) / steps;
      pts.push(b.x + f0 * r(z), b.y - z + (i === 0 ? (r(0) / 2) * Math.sqrt(1 - f0 * f0) : 0));
    }
    for (let i = steps; i >= 0; i--) {
      const z = (H * i) / steps;
      pts.push(b.x + f1 * r(z), b.y - z + (i === 0 ? (r(0) / 2) * Math.sqrt(1 - f1 * f1) : 0));
    }
    g.poly(pts).fill(col);
  };
  g.ellipse(b.x, b.y, R, R / 2).fill(shade(color, 0.7));
  band(-1, -0.4, shade(color, 1.04));
  band(-0.4, 0.45, shade(color, 0.9));
  band(0.45, 1, shade(color, 0.74));
  // Support legs peeking out at the base.
  for (let k = -3; k <= 3; k++) {
    const f = k / 3.4;
    const px = b.x + f * R, py = b.y + (R / 2) * Math.sqrt(1 - f * f);
    g.rect(px - 1, py - 5, 2, 5).fill(shade(color, 0.55));
  }
  const top = { x: b.x, y: b.y - H };
  const rt = r(H);
  g.ellipse(top.x, top.y, rt, rt / 2).fill(shade(color, 1.12));
  g.ellipse(top.x, top.y + 0.5, rt - 2.5, rt / 2 - 1.5).fill(0x4a4d52);
  return top;
}

/** Two cooling towers venting steam, a turbine hall, and a striped stack. */
export const powerPlant: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const hs = fit(w, d, 3, 3);
  const at = (u: number, v: number): [number, number] => [x + u * w, y + v * d];
  const root = new Container();
  const tintables: Container[] = [];
  const base = new Graphics();
  plate(base, x, y, w, d, 4, 0xb7b9bc);
  root.addChild(base);
  tintables.push(base);
  const lights = new Graphics();
  const puffs: { g: Graphics; top: { x: number; y: number }; phase: number; drift: number; rate: number }[] = [];
  const rng = rngFor("power-plant", x, y);
  const R = 25 * hs, H = 96 * hs;
  for (const [u, v] of [[0.27, 0.27], [0.74, 0.25]] as const) {
    const [tx, ty] = at(u, v);
    const tower = new Graphics();
    const top = coolingTower(tower, tx, ty, R, H, 0xe4e1da);
    lights.circle(top.x - R * 0.66, top.y, 1.8).fill(0xff3b30);
    lights.circle(top.x + R * 0.66, top.y, 1.8).fill(0xff3b30);
    const steam = new Container();
    for (let i = 0; i < 9; i++) {
      const p = new Graphics();
      p.circle(0, 0, 8).fill(0xffffff);
      p.circle(-2.5, -2.5, 4.5).fill(0xffffff);
      steam.addChild(p);
      puffs.push({ g: p, top, phase: i / 9 + rng() * 0.05, drift: (rng() - 0.5) * 12, rate: 0.16 + rng() * 0.05 });
    }
    root.addChild(tower, steam);
    tintables.push(tower, steam);
  }
  // Striped stack and the turbine hall in front.
  const fg = new Graphics();
  const [sx, sy] = at(0.15, 0.83);
  const stackTop = 128 * hs;
  cylinder(fg, sx, sy, 5.5 * hs, 4, stackTop, 0xf2f2f2);
  for (let z = 14; z < stackTop - 4; z += 26) cylinder(fg, sx, sy, 5.7 * hs, z, z + 13, 0xd84315);
  const st = iso(sx, sy, stackTop);
  lights.circle(st.x, st.y - 2, 2.2).fill(0xff3b30);
  const [hx0, hy0] = at(0.38, 0.56), [hx1, hy1] = at(0.96, 0.95);
  const hallH = 36 * hs, hall = 0x3f78c2;
  box(fg, hx0, hy0, hx1 - hx0, hy1 - hy0, 4, hallH, hall);
  box(fg, hx0, hy0, hx1 - hx0, hy1 - hy0, hallH - 3, hallH, 0xf2f2f2);
  box(fg, hx0 + 0.15, hy0 + 0.12, 0.3, 0.2, hallH, hallH + 9, 0x9aa4ae);
  // Window bands on both visible faces: dark glass by day, warm light at night.
  const wz0 = hallH * 0.55, wz1 = hallH * 0.72;
  const faceL = [iso(hx0 + 0.06, hy1, wz0), iso(hx1 - 0.06, hy1, wz0), iso(hx1 - 0.06, hy1, wz1), iso(hx0 + 0.06, hy1, wz1)];
  const faceR = [iso(hx1, hy1 - 0.06, wz0), iso(hx1, hy0 + 0.06, wz0), iso(hx1, hy0 + 0.06, wz1), iso(hx1, hy1 - 0.06, wz1)];
  for (const q of [faceL, faceR]) {
    fg.poly(q.flatMap((p) => [p.x, p.y])).fill(0x263648);
    lights.poly(q.flatMap((p) => [p.x, p.y])).fill(0xffd47e);
  }
  const doorQ = [iso(hx0 + 0.2, hy1 + 0.01, 4), iso(hx0 + 0.45, hy1 + 0.01, 4), iso(hx0 + 0.45, hy1 + 0.01, 18 * hs), iso(hx0 + 0.2, hy1 + 0.01, 18 * hs)];
  fg.poly(doorQ.flatMap((p) => [p.x, p.y])).fill(0xd8dde2);
  // Transmission pylon line leaving the plant.
  line3(fg, [hx1 - 0.2, hy0 + 0.1, hallH + 2], [x + w - 0.05, y + 0.08, 60 * hs], 1, 0x5b5f64, 0.8);
  root.addChild(fg);
  tintables.push(fg);
  lights.blendMode = "add";
  lights.alpha = 0;
  root.addChild(lights);
  root.zIndex = depthOf(x + w - 1, y + d - 1, 60);
  let t = 0;
  return {
    views: [root],
    tintables,
    update: (dt) => {
      t += dt;
      const storm = ctx.storm();
      const wind = 16 + 46 * storm;
      for (const p of puffs) {
        const k = (t * p.rate * (1 + storm * 0.6) + p.phase) % 1;
        p.g.position.set(p.top.x + p.drift * k + wind * k * k, p.top.y - 4 - k * 64 * hs);
        p.g.scale.set(0.55 + k * 1.5);
        p.g.alpha = 0.8 * (1 - k) * Math.min(1, k * 8);
      }
      lights.alpha = ctx.night();
    },
  };
};

// ---------------------------------------------------------------------------

/** An oval track with a grass infield, a small grandstand, circling race cars, and field lights. */
export const racetrack: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const hs = fit(w, d, 4, 3);
  const root = new Container();
  const g = new Graphics();
  plate(g, x, y, w, d, 4, GRASS);
  // Oval in tile space, leaving the back strip for the grandstand.
  const oy0 = y + d * 0.22, oy1 = y + d - 0.1;
  const cx = x + w / 2, cy = (oy0 + oy1) / 2;
  const a = w / 2 - 0.12, b = (oy1 - oy0) / 2;
  const tw = Math.min(0.4, Math.min(a, b) * 0.4);
  const ring = (ra: number, rb: number, z: number) => {
    const pts: number[] = [];
    for (let i = 0; i < 56; i++) {
      const th = (i / 56) * Math.PI * 2;
      const p = iso(cx + ra * Math.cos(th), cy + rb * Math.sin(th), z);
      pts.push(p.x, p.y);
    }
    return pts;
  };
  g.poly(ring(a + 0.03, b + 0.03, 4)).fill(0x8f9396);
  g.poly(ring(a, b, 4.2)).fill(0x4a4b50);
  g.poly(ring(a - tw, b - tw, 4.4)).fill(0xeeeeee);
  g.poly(ring(a - tw - 0.03, b - tw - 0.03, 4.6)).fill(0x5fae45);
  g.poly(ring(a - tw * 0.5, b - tw * 0.5, 4.3), true).stroke({ width: 0.8, color: 0xffffff, alpha: 0.35 });
  // Checkered start line on the front straight.
  for (let k = 0; k < 6; k++) {
    const s0 = (k / 6) * tw, s1 = ((k + 1) / 6) * tw;
    const lx = cx + 0.1;
    const q = [iso(lx, cy + b - s0, 4.4), iso(lx + 0.06, cy + b - s0, 4.4), iso(lx + 0.06, cy + b - s1, 4.4), iso(lx, cy + b - s1, 4.4)];
    g.poly(q.flatMap((p) => [p.x, p.y])).fill(k % 2 ? 0x111111 : 0xffffff);
  }
  // Infield flag pole and a small infield hut.
  box(g, cx - 0.3, cy - 0.12, 0.34, 0.22, 4.6, 14, 0xf2f2f2, 0xe53935);
  // Grandstand: three stepped tiers with a crowd, and a colored roof over the back rows.
  const gx0 = x + w * 0.22, gx1 = x + w * 0.78, gy0 = y + 0.1, gy1 = oy0 - 0.08;
  const gw = gx1 - gx0, gd = gy1 - gy0;
  const crowd = rngFor("racetrack-crowd", x, y);
  const crowdColors = [0xe53935, 0xfdd835, 0x1e88e5, 0xffffff, 0x43a047, 0xfb8c00];
  for (let k = 0; k < 3; k++) {
    const depth = gd * (1 - k / 3);
    const z1 = 4 + (k + 1) * 7 * hs;
    box(g, gx0, gy0, gw, depth, 4 + k * 7 * hs, z1, k % 2 ? 0xdfe3e6 : 0x1e5fb4);
    for (let i = 0; i < Math.round(gw * 9); i++) {
      const p = iso(gx0 + 0.05 + crowd() * (gw - 0.1), gy0 + depth - 0.08, z1 + 2);
      g.circle(p.x, p.y, 1.6).fill(crowdColors[Math.floor(crowd() * crowdColors.length)]);
    }
  }
  const roofY = gy0 + gd * 0.6, roofZ = 36 * hs;
  for (const px of [gx0 + 0.04, gx0 + gw / 2, gx1 - 0.04]) line3(g, [px, roofY, 4 + 7 * hs], [px, roofY, roofZ], 1.8, 0xd0d4d8);
  box(g, gx0 - 0.04, gy0 - 0.02, gw + 0.08, roofY - gy0 + 0.06, roofZ, roofZ + 4, 0xe53935);

  // Light poles: the back one sits behind everything, the rest are drawn in front of the cars.
  const front = new Graphics();
  const lights = new Graphics();
  const poleTop = 76 * hs;
  const poles: [number, number, Graphics][] = [
    [x + 0.2, y + 0.2, g], [x + w - 0.2, y + 0.2, front], [x + 0.2, y + d - 0.2, front], [x + w - 0.2, y + d - 0.2, front],
  ];
  for (const [px, py, pg] of poles) {
    line3(pg, [px, py, 4], [px, py, poleTop], 2.2, 0x9aa0a6);
    const hd = iso(px, py, poleTop);
    pg.roundRect(hd.x - 7, hd.y - 6, 14, 7, 1.5).fill(0x3d4146);
    for (let k = 0; k < 3; k++) {
      pg.circle(hd.x - 4 + k * 4, hd.y - 2.5, 1.3).fill(0xe8e8e8);
      lights.circle(hd.x - 4 + k * 4, hd.y - 2.5, 2.2).fill(0xfffbe0);
    }
    lights.circle(hd.x, hd.y - 2.5, 10).fill({ color: 0xfff3c4, alpha: 0.2 });
  }
  const c0 = iso(cx, cy, 4);
  lights.ellipse(c0.x, c0.y, (a + b) * 26, (a + b) * 13).fill({ color: 0xfff6d8, alpha: 0.12 });
  lights.blendMode = "add";
  lights.alpha = 0;

  // Race cars: tiny brick bodies sorted by screen y each frame.
  const cars = new Container();
  cars.sortableChildren = true;
  const carColors = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa];
  const rng = rngFor("racetrack-cars", x, y);
  const n = w * d >= 9 ? 6 : 4;
  const racers: { g: Graphics; th: number; speed: number; lane: number }[] = [];
  for (let i = 0; i < n; i++) {
    const car = new Graphics();
    box(car, -0.08, -0.08, 0.16, 0.16, 0, 5, carColors[i]);
    box(car, -0.04, -0.05, 0.1, 0.1, 5, 8, 0x2b3b4f);
    cars.addChild(car);
    racers.push({ g: car, th: (i / n) * Math.PI * 2 + rng() * 0.3, speed: 0.85 + rng() * 0.3, lane: (rng() - 0.5) * tw * 0.5 });
  }
  const body = new Container();
  body.addChild(g, cars, front);
  root.addChild(body, lights);
  root.zIndex = depthOf(x + w - 1, y + d - 1, 60);
  const place = () => {
    for (const r of racers) {
      const ra = a - tw / 2 + r.lane, rb = b - tw / 2 + r.lane;
      const p = iso(cx + ra * Math.cos(r.th), cy + rb * Math.sin(r.th), 4.4);
      r.g.position.set(p.x, p.y);
      r.g.zIndex = p.y;
    }
  };
  place();
  let t = 0;
  return {
    views: [root],
    tintables: [body],
    update: (dt) => {
      t += dt;
      // Lap speed varies a little so the pack slowly reshuffles.
      for (const r of racers) r.th = (r.th + dt * r.speed * (0.9 + 0.1 * Math.sin(t * 0.3 + r.lane * 20))) % (Math.PI * 2);
      place();
      lights.alpha = ctx.night();
    },
  };
};

export const RURAL_LANDMARKS: Record<string, LandmarkFactory> = {
  "wind-farm": windFarm,
  pumpjacks,
  farmstead,
  "power-plant": powerPlant,
  racetrack,
};
