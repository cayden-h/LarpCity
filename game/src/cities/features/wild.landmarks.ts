// Wild "state signature" landmarks: mountains, a ski lift, a desert mission,
// saguaros, a volcano, and a glacier harbor. Reusable across many states, so
// geometry is built once and animation only moves small child objects.
// Stylized shapes only: no logos or real signage.

import { Container, Graphics } from "pixi.js";
import type { Season } from "../../engine/clock";
import { mix, shade } from "../../engine/color";
import { depthOf, iso } from "../../engine/iso";
import { rngFor } from "../../engine/rng";
import { box, cylinder, layer, line3 } from "../../engine/shapes";
import type { LandmarkFactory } from "../../engine/types";

const LIT = 0xffd47e;
const WARM = 0xffb456;
const GLASS = 0x8ec9ea;

type P3 = [number, number, number];

/** An axis-aligned block in tile space: footprint plus its bottom and top z. */
interface Tier {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Fill a polygon given in tile space (x, y, z). */
function poly3(g: Graphics, pts: P3[], color: number, alpha = 1): void {
  g.poly(pts.flatMap(([a, b, c]) => {
    const p = iso(a, b, c);
    return [p.x, p.y];
  })).fill({ color, alpha });
}

/** Quad on a face of constant y (the lit left face) or constant x (the shaded right face). */
function faceQuad(side: "y" | "x", plane: number, t0: number, t1: number, z0: number, z1: number): P3[] {
  return side === "y"
    ? [[t0, plane, z0], [t1, plane, z0], [t1, plane, z1], [t0, plane, z1]]
    : [[plane, t0, z0], [plane, t1, z0], [plane, t1, z1], [plane, t0, z1]];
}

/** Arched opening on a face: straight jambs and a half-round head. */
function archQuad(side: "y" | "x", plane: number, c: number, half: number, z0: number, z1: number): P3[] {
  const pts: P3[] = [];
  const at = (t: number, z: number): P3 => (side === "y" ? [t, plane, z] : [plane, t, z]);
  pts.push(at(c - half, z0), at(c + half, z0), at(c + half, z1 - half * 40));
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI;
    pts.push(at(c + Math.cos(a) * half, z1 - half * 40 + Math.sin(a) * half * 40));
  }
  return pts;
}

/** One toy stud, a little smaller than the ground studs. */
function stud(g: Graphics, tx: number, ty: number, z: number, base: number, r = 4.4): void {
  const p = iso(tx, ty, z);
  g.ellipse(p.x, p.y + 1.4, r, r / 2).fill(shade(base, 0.72));
  g.rect(p.x - r, p.y - 0.4, r * 2, 1.8).fill(shade(base, 0.82));
  g.ellipse(p.x, p.y - 0.4, r, r / 2).fill(shade(base, 1.12));
}

/** Studs on a tier's top, skipping the area covered by the next tier up. */
function studTier(g: Graphics, t: Tier, base: number, cover?: Tier, step = 0.5): void {
  const nx = Math.max(1, Math.round((t.x1 - t.x0) / step));
  const ny = Math.max(1, Math.round((t.y1 - t.y0) / step));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const tx = t.x0 + ((i + 0.5) * (t.x1 - t.x0)) / nx;
      const ty = t.y0 + ((j + 0.5) * (t.y1 - t.y0)) / ny;
      if (cover && tx > cover.x0 - 0.12 && tx < cover.x1 + 0.12 && ty > cover.y0 - 0.12 && ty < cover.y1 + 0.12) continue;
      stud(g, tx, ty, t.z1, base);
    }
}

function tierBox(g: Graphics, t: Tier, side: number, top: number): void {
  box(g, t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0, t.z0, t.z1, side, top);
}

/** A small brick pine: trunk and three cone tiers, lit on the left half. */
function pine(g: Graphics, tx: number, ty: number, z: number, s: number, leaf = 0x2e7d4f): void {
  const p = iso(tx, ty, z);
  g.ellipse(p.x, p.y, 7 * s, 3 * s).fill({ color: 0x000000, alpha: 0.14 });
  g.rect(p.x - 1.5 * s, p.y - 6 * s, 3 * s, 6 * s).fill(0x6d4c33);
  for (let k = 0; k < 3; k++) {
    const wdt = (9 - k * 2.4) * s, base = p.y - (5 + k * 6.5) * s, tip = base - 11 * s;
    g.poly([p.x - wdt, base, p.x + wdt, base, p.x, tip]).fill(shade(leaf, 0.78 + k * 0.08));
    g.poly([p.x - wdt, base, p.x - wdt * 0.1, base, p.x, tip]).fill(shade(leaf, 0.95 + k * 0.08));
  }
}

/** A palm: a curved trunk drawn into `g`, the crown in its own small Graphics so it can sway. */
function palm(g: Graphics, tx: number, ty: number, z: number, s: number, lean: number): Graphics {
  const p = iso(tx, ty, z);
  const topX = p.x + lean * 8 * s, topY = p.y - 38 * s;
  g.ellipse(p.x, p.y, 8 * s, 3.5 * s).fill({ color: 0x000000, alpha: 0.14 });
  g.moveTo(p.x, p.y).quadraticCurveTo(p.x + lean * 1 * s, p.y - 22 * s, topX, topY).stroke({ width: 4 * s, color: 0x8d6e4a, cap: "round" });
  for (let k = 1; k < 5; k++) {
    const q = p.y - k * 8 * s;
    g.moveTo(p.x + lean * k * 1.6 * s - 2 * s, q).lineTo(p.x + lean * k * 1.6 * s + 2 * s, q).stroke({ width: 1, color: 0x6d5236 });
  }
  const crown = new Graphics();
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI * 0.95 + (k / 5) * Math.PI * 0.9 + (k % 2) * 0.1;
    const len = 17 * s;
    const ex = Math.cos(a) * len, ey = Math.sin(a) * len * 0.55 + 7 * s;
    crown.poly([0, 0, ex * 0.5, ey * 0.5 - 4 * s, ex, ey, ex * 0.5, ey * 0.5 + 1 * s]).fill(k % 2 ? 0x3f9a45 : 0x2f7f38);
  }
  crown.circle(0, 1 * s, 2.6 * s).fill(0x6d4c2a);
  crown.position.set(topX, topY);
  return crown;
}

/** A saguaro: ribbed trunk with elbowed arms, drawn in screen space from its base. */
function saguaro(g: Graphics, tx: number, ty: number, z: number, h: number, arms: { side: number; at: number; up: number }[]): void {
  const p = iso(tx, ty, z);
  const r = 4.6, C = 0x4f9a3a;
  g.ellipse(p.x, p.y, 9, 4).fill({ color: 0x000000, alpha: 0.15 });
  for (const a of arms) {
    const ay = p.y - a.at, ax = p.x + a.side * (r + 6);
    g.roundRect(Math.min(p.x, ax) - 1, ay - r * 0.8, Math.abs(ax - p.x) + 2, r * 1.6, r * 0.8).fill(shade(C, a.side < 0 ? 0.95 : 0.78));
    g.roundRect(ax - r * 0.85, ay - a.up, r * 1.7, a.up + r * 0.8, r * 0.85).fill(shade(C, a.side < 0 ? 0.98 : 0.8));
    g.roundRect(ax - r * 0.85, ay - a.up, r * 0.7, a.up + r * 0.4, r * 0.4).fill(shade(C, 1.14));
  }
  g.roundRect(p.x - r, p.y - h, r * 2, h, r).fill(shade(C, 0.86));
  g.roundRect(p.x - r, p.y - h, r * 0.9, h, r * 0.6).fill(shade(C, 1.08));
  g.roundRect(p.x + r * 0.4, p.y - h + 2, r * 0.6, h - 2, r * 0.3).fill(shade(C, 0.72));
  for (const dx of [-1.6, 1.4]) g.moveTo(p.x + dx, p.y - h + 4).lineTo(p.x + dx, p.y - 2).stroke({ width: 0.8, color: shade(C, 0.6), alpha: 0.6 });
  g.circle(p.x - 1, p.y - h + 1, 1.6).fill(0xfff3d6);
  g.circle(p.x + 2, p.y - h + 2, 1.3).fill(0xffe082);
}

/** A prickly pear: a few flat oval pads with pink fruit. */
function pricklyPear(g: Graphics, tx: number, ty: number, z: number, s: number): void {
  const p = iso(tx, ty, z);
  const pads: [number, number, number][] = [[0, -6, 0], [-6, -13, -0.4], [5, -14, 0.4], [0, -20, 0]];
  g.ellipse(p.x, p.y, 9 * s, 3.5 * s).fill({ color: 0x000000, alpha: 0.14 });
  pads.forEach(([dx, dy], i) => {
    const cx = p.x + dx * s, cy = p.y + dy * s;
    g.ellipse(cx, cy, 5 * s, 6.5 * s).fill(shade(0x6fa84a, 0.85 + (i % 2) * 0.12));
    g.ellipse(cx - 1.4 * s, cy - 1 * s, 2 * s, 3.5 * s).fill({ color: 0xffffff, alpha: 0.12 });
  });
  for (const [dx, dy] of [[-8, -18], [8, -19], [1, -26]] as const) g.circle(p.x + dx * s, p.y + dy * s, 1.8 * s).fill(0xd8436e);
}

/** A rough desert rock: a squat box with a lighter chipped top. */
function rock(g: Graphics, tx: number, ty: number, sw: number, sd: number, h: number, color: number): void {
  box(g, tx, ty, sw, sd, 0, h, color);
  poly3(g, [[tx + sw * 0.2, ty + sd * 0.2, h], [tx + sw * 0.7, ty + sd * 0.15, h], [tx + sw * 0.6, ty + sd * 0.6, h]], shade(color, 1.22));
}

/** A puff of smoke drawn once around its origin; animation only moves, scales, and fades it. */
function puff(color: number): Graphics {
  const g = new Graphics();
  g.circle(0, 0, 8).fill(color);
  g.circle(-3, -3, 5).fill(shade(color, 1.12));
  g.circle(4, 1, 5).fill(shade(color, 0.9));
  return g;
}

const snowTiers = (season: Season, levels: number): number => {
  const want = season === "winter" ? Math.ceil(levels * 0.6) : season === "summer" ? 1 : 2;
  return Math.max(1, Math.min(levels - 2, want));
};

/**
 * A decorative rocky peak of stepped brick terraces with pines on the lower
 * ledges and a snow cap that grows in winter. Shape varies with the tile.
 */
export const mountain: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor(x, y, "mountain");
  const sc = Math.min(w, d) / 3;
  const levels = 5 + Math.floor(rng() * 3);
  const stepH = (13 + rng() * 6) * Math.max(0.6, sc);
  const px = x + w / 2 + (rng() - 0.5) * w * 0.3, py = y + d / 2 + (rng() - 0.5) * d * 0.3;
  const hs = (0.22 + rng() * 0.12) * Math.max(0.6, sc);
  const rocks = [0x8d7b6a, 0x7f7064, 0x978676, 0x857466];
  const tiers: Tier[] = [];
  let prev: Tier = { x0: x + 0.05, y0: y + 0.05, x1: x + w - 0.05, y1: y + d - 0.05, z0: 0, z1: 0 };
  for (let k = 0; k < levels; k++) {
    const f = k / (levels - 1);
    const j = () => (k === 0 ? 0 : (rng() - 0.3) * 0.16 * sc);
    const t: Tier = {
      x0: Math.max(prev.x0, x + 0.05 + (px - hs - x - 0.05) * f + j()),
      y0: Math.max(prev.y0, y + 0.05 + (py - hs - y - 0.05) * f + j()),
      x1: Math.min(prev.x1, x + w - 0.05 - (x + w - 0.05 - px - hs) * f - j()),
      y1: Math.min(prev.y1, y + d - 0.05 - (y + d - 0.05 - py - hs) * f - j()),
      z0: k * stepH,
      z1: (k + 1) * stepH,
    };
    if (t.x1 - t.x0 < 0.2) t.x1 = t.x0 + 0.2;
    if (t.y1 - t.y0 < 0.2) t.y1 = t.y0 + 0.2;
    tiers.push(t);
    prev = t;
  }

  const g = new Graphics();
  tiers.forEach((t, k) => {
    const side = rocks[Math.floor(rng() * rocks.length)];
    const top = k < 2 ? mix(0x6f9f4c, side, k * 0.35) : shade(side, 1.12);
    tierBox(g, t, side, top);
    // A few darker cracks on the lit face.
    const cx = t.x0 + (t.x1 - t.x0) * (0.2 + rng() * 0.6);
    line3(g, [cx, t.y1, t.z0 + 2], [cx + 0.05, t.y1, t.z1 - 3], 1, shade(side, 0.7), 0.6);
    studTier(g, t, top, tiers[k + 1]);
  });

  // Pines on the exposed front and right ledges of the two lowest tiers.
  const trees = new Graphics();
  const spots: [number, number, number][] = [];
  for (let k = 0; k < Math.min(2, levels - 1); k++) {
    const t = tiers[k], n = tiers[k + 1];
    for (let i = 0; i < 3; i++) {
      if (t.y1 - n.y1 > 0.22) spots.push([t.x0 + 0.12 + rng() * (t.x1 - t.x0 - 0.24), n.y1 + 0.1 + rng() * (t.y1 - n.y1 - 0.2), t.z1]);
      if (t.x1 - n.x1 > 0.22) spots.push([n.x1 + 0.1 + rng() * (t.x1 - n.x1 - 0.2), t.y0 + 0.12 + rng() * (t.y1 - t.y0 - 0.24), t.z1]);
    }
  }
  spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [tx, ty, z] of spots) pine(trees, tx, ty, z, (0.75 + rng() * 0.35) * Math.max(0.7, sc));

  // The snow cap is rebuilt only when the season changes.
  const snow = new Graphics();
  let season: Season | null = null;
  const drawSnow = (s: Season) => {
    season = s;
    snow.clear();
    const n = snowTiers(s, levels);
    for (let k = levels - n; k < levels; k++) {
      const t = tiers[k];
      const lowest = k === levels - n;
      const cap: Tier = lowest ? { ...t, z0: t.z1 - 5 } : t;
      tierBox(snow, cap, 0xe3edf5, 0xffffff);
      studTier(snow, cap, 0xf4f8fb, tiers[k + 1]);
      if (lowest) {
        // Drips down the faces below the snow line.
        const r = rngFor(x, y, "drip", k);
        for (let i = 0; i < 5; i++) {
          const a = t.x0 + ((i + 0.3 + r() * 0.4) * (t.x1 - t.x0)) / 5;
          poly3(snow, [[a - 0.06, t.y1, cap.z0], [a + 0.06, t.y1, cap.z0], [a, t.y1, cap.z0 - 4 - r() * 5]], 0xeef4f9);
          const b = t.y0 + ((i + 0.3 + r() * 0.4) * (t.y1 - t.y0)) / 5;
          poly3(snow, [[t.x1, b - 0.06, cap.z0], [t.x1, b + 0.06, cap.z0], [t.x1, b, cap.z0 - 4 - r() * 5]], 0xd5e2ec);
        }
      }
    }
  };
  drawSnow(ctx.clock.season);

  const view = layer(depthOf(x + w - 1, y + d - 1, 40), g, snow, trees);
  return {
    views: [view],
    tintables: [g, snow, trees],
    update: () => {
      const s = ctx.clock.season;
      if (s !== season) drawSnow(s);
    },
  };
};

/**
 * A snowy ski slope of stepped terraces, a lodge at the bottom, a chairlift
 * with chairs going up one cable and down the other, and a few tiny skiers.
 */
export const skiLift: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor(x, y, "ski-lift");
  const sc = Math.min(w / 3, d / 4);
  const levels = 6;
  const H = 15 * Math.max(0.6, sc);
  const x0 = x + 0.05, x1 = x + w - 0.05, yB = y + 0.05, yF = y + d - 0.05;
  const lodgeDepth = Math.min(1, d * 0.25);
  const stepD = (yF - lodgeDepth - (yB + 0.6)) / (levels - 2);
  const fronts: number[] = [];
  for (let k = 0; k < levels; k++) fronts.push(k === 0 ? yF : yF - lodgeDepth - (k - 1) * stepD);
  const tiers: Tier[] = fronts.map((f, k) => ({ x0: x0 + k * 0.03, y0: yB, x1: x1 - k * 0.03, y1: f, z0: k * H, z1: (k + 1) * H }));
  const groundZ = (yy: number): number => {
    let n = 0;
    for (const f of fronts) if (f >= yy) n++;
    return n * H;
  };

  const g = new Graphics();
  const lit = new Graphics();
  const SIDE = 0xc3ccd6, TOP = 0xf7fbff;
  tiers.forEach((t, k) => {
    tierBox(g, t, k % 2 ? shade(SIDE, 1.04) : SIDE, TOP);
    studTier(g, t, 0xf2f6fa, tiers[k + 1]);
  });

  // Pines along the left edge of each ledge.
  for (let k = 0; k < levels - 1; k++) {
    const t = tiers[k], n = tiers[k + 1];
    if (t.y1 - n.y1 < 0.2) continue;
    pine(g, t.x0 + 0.18 + rng() * 0.1, n.y1 + (t.y1 - n.y1) * 0.5, t.z1, 0.8 * Math.max(0.7, sc), 0x2b6e48);
  }

  // Lodge on the bottom strip: log walls, a red gable roof, glowing windows.
  const lx0 = x0 + 0.15, lw = Math.min(1.1, (x1 - x0) * 0.4), ly1 = yF - 0.15, ly0 = ly1 - Math.min(0.6, lodgeDepth * 0.65);
  const lz = H, lh = 24 * Math.max(0.7, sc);
  const LOG = 0x9a6436, ROOF = 0xb23a2e;
  box(g, lx0, ly0, lw, ly1 - ly0, lz, lz + lh, LOG);
  for (let zz = lz + 4; zz < lz + lh; zz += 5) {
    line3(g, [lx0, ly1, zz], [lx0 + lw, ly1, zz], 1, shade(LOG, 0.7), 0.5);
    line3(g, [lx0 + lw, ly1, zz], [lx0 + lw, ly0, zz], 1, shade(LOG, 0.55), 0.5);
  }
  for (let i = 0; i < 3; i++) {
    const c = lx0 + ((i + 0.5) * lw) / 3;
    const q = faceQuad("y", ly1, c - 0.09, c + 0.09, lz + 6, lz + 16);
    poly3(g, q, GLASS);
    poly3(lit, q, LIT);
  }
  const rh = 14 * Math.max(0.7, sc);
  const r0: P3 = [lx0 - 0.05, (ly0 + ly1) / 2, lz + lh + rh], r1: P3 = [lx0 + lw + 0.05, (ly0 + ly1) / 2, lz + lh + rh];
  poly3(g, [[lx0 - 0.05, ly0 - 0.05, lz + lh], [lx0 + lw + 0.05, ly0 - 0.05, lz + lh], r1, r0], shade(ROOF, 0.8));
  poly3(g, [[lx0 + lw, ly1, lz + lh], [lx0 + lw, ly0, lz + lh], [lx0 + lw, (ly0 + ly1) / 2, lz + lh + rh - 2]], shade(LOG, 0.72));
  poly3(g, [[lx0 - 0.05, ly1 + 0.05, lz + lh], [lx0 + lw + 0.05, ly1 + 0.05, lz + lh], r1, r0], ROOF);
  line3(g, r0, r1, 3, 0xffffff);
  box(g, lx0 + lw * 0.7, (ly0 + ly1) / 2 - 0.08, 0.14, 0.14, lz + lh + rh * 0.4, lz + lh + rh + 6, 0x8a8f96);

  // Lift line: bottom station, towers, and two cables.
  const lineX = x0 + (x1 - x0) * 0.74;
  const yS = yF - lodgeDepth * 0.5, yT = yB + 0.3;
  const zS = groundZ(yS), zT = groundZ(yT);
  const CAB = 24 * Math.max(0.7, sc);
  const up = lineX - 0.1, down = lineX + 0.1;
  const cableZ = (yy: number) => zS + CAB + ((zT - zS) * (yS - yy)) / (yS - yT);
  box(g, lineX - 0.22, yS - 0.18, 0.44, 0.3, zS, zS + 12, 0x5f6b78);
  box(g, lineX - 0.18, yT - 0.15, 0.36, 0.25, zT, zT + 12, 0x5f6b78);
  const TOWER = 0x8a9099;
  for (const f of [0.2, 0.45, 0.7]) {
    const ty = yS + (yT - yS) * f;
    const gz = groundZ(ty), cz = cableZ(ty);
    box(g, lineX - 0.03, ty - 0.03, 0.06, 0.06, gz, cz + 2, TOWER);
    line3(g, [up, ty, cz + 2], [down, ty, cz + 2], 2.2, shade(TOWER, 0.8));
    const lamp = iso(lineX, ty, cz + 5);
    g.circle(lamp.x, lamp.y, 1.6).fill(0x444a52);
    lit.circle(lamp.x, lamp.y, 2.4).fill(0xfff1b8);
  }
  for (const cx of [up, down]) {
    line3(g, [cx, yS, cableZ(yS) + 2], [cx, yT, cableZ(yT) + 2], 1.1, 0x33383e);
    const wheelA = iso(cx, yS, cableZ(yS) + 2), wheelB = iso(cx, yT, cableZ(yT) + 2);
    g.circle(wheelA.x, wheelA.y, 2).fill(0x33383e);
    g.circle(wheelB.x, wheelB.y, 2).fill(0x33383e);
  }

  // Chairs loop up the left cable and down the right one.
  const chairs = new Container();
  const N = 10;
  const chairColors = [0xd84343, 0x2f6fd8, 0xf2b632];
  const riderColors = [0xe53935, 0x43a047, 0x1e88e5, 0xfdd835, 0x8e24aa];
  const chairGs: Graphics[] = [];
  for (let i = 0; i < N; i++) {
    const c = new Graphics();
    c.moveTo(0, 0).lineTo(0, 8).stroke({ width: 1, color: 0x33383e });
    const col = chairColors[i % chairColors.length];
    if (rng() < 0.7) {
      c.rect(-2.5, 3.5, 5, 5).fill(riderColors[Math.floor(rng() * riderColors.length)]);
      c.circle(0, 2.5, 1.8).fill(0xf1c7a0);
    }
    c.rect(-4, 8, 8, 2.5).fill(col);
    c.rect(-4, 4, 1.6, 5).fill(shade(col, 0.8));
    chairGs.push(c);
    chairs.addChild(c);
  }

  // Skiers slide down the open middle of the slope in lazy zigzags.
  const skiers = new Container();
  const skiLane0 = lx0 + lw + 0.12, skiLane1 = up - 0.2;
  const skierGs: { g: Graphics; phase: number; speed: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new Graphics();
    const col = riderColors[Math.floor(rng() * riderColors.length)];
    s.moveTo(-4, 0).lineTo(4, -1).stroke({ width: 1.2, color: 0x263238 });
    s.rect(-1.6, -7, 3.2, 6).fill(col);
    s.circle(0, -8.5, 1.8).fill(0xf1c7a0);
    s.moveTo(-3, -5).lineTo(-4.5, 0).moveTo(3, -5).lineTo(4.5, 0).stroke({ width: 0.8, color: 0x555555 });
    skiers.addChild(s);
    skierGs.push({ g: s, phase: rng(), speed: 0.05 + rng() * 0.03 });
  }

  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, skiers, chairs, lit);
  let t = 0;
  const place = (u: number, c: Graphics) => {
    const goingUp = u < 1;
    const k = goingUp ? u : u - 1;
    const yy = goingUp ? yS + (yT - yS) * k : yT + (yS - yT) * k;
    const p = iso(goingUp ? up : down, yy, cableZ(yy) + 2);
    c.position.set(p.x, p.y);
  };
  const tick = (dt: number) => {
    t += dt;
    for (let i = 0; i < N; i++) place(((t * 0.035 + i / N) % 1) * 2, chairGs[i]);
    for (const s of skierGs) {
      const k = (t * s.speed + s.phase) % 1;
      const yy = yT + 0.1 + (yF - 0.25 - yT - 0.1) * k;
      const xx = skiLane0 + (skiLane1 - skiLane0) * (0.5 + 0.5 * Math.sin(k * Math.PI * 6 + s.phase * 6));
      const p = iso(xx, yy, groundZ(yy));
      s.g.position.set(p.x, p.y);
      s.g.alpha = Math.min(1, k * 12, (1 - k) * 12);
    }
    lit.alpha = ctx.night();
  };
  tick(0);
  return { views: [view], tintables: [g, chairs, skiers], update: tick };
};

/** A tan adobe mission: rounded parapets, a bell tower with a swinging bell, a courtyard wall, and lanterns. */
export const adobeMission: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const sc = Math.min(w, d) / 2;
  const g = new Graphics();
  const front = new Graphics();
  const lit = new Graphics();
  const TAN = 0xdcb27c, EARTH = 0xe4cb9c, WOOD = 0x7a4a2a, DARK = 0x3a2a1e;

  // Packed-earth courtyard.
  const yard: Tier = { x0: x + 0.04, y0: y + 0.04, x1: x + w - 0.04, y1: y + d - 0.04, z0: 0, z1: 3 };
  tierBox(g, yard, EARTH, shade(EARTH, 1.06));

  // The nave.
  const nx0 = x + 0.2 * sc, ny0 = y + 0.15 * sc, nw = 0.9 * sc, nd = 1.2 * sc;
  const nx1 = nx0 + nw, yf = ny0 + nd;
  const zb = 3, top = zb + 36 * sc;
  box(g, nx0, ny0, nw, nd, zb, top, TAN);
  poly3(g, [[nx0 + 0.06, ny0 + 0.06, top], [nx1 - 0.06, ny0 + 0.06, top], [nx1 - 0.06, yf - 0.06, top], [nx0 + 0.06, yf - 0.06, top]], shade(TAN, 0.88));
  // Rounded bumps along the right parapet.
  for (let i = 0; i < 3; i++) {
    const c = ny0 + ((i + 0.5) * nd) / 3;
    const pts: P3[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI;
      pts.push([nx1, c + Math.cos(a) * 0.14 * sc, top + Math.sin(a) * 5 * sc]);
    }
    poly3(g, pts, shade(TAN, 0.74));
  }
  // Small arched windows on the side.
  for (let i = 0; i < 2; i++) {
    const c = ny0 + ((i + 0.5) * nd) / 2;
    const q = archQuad("x", nx1 + 0.001, c, 0.06 * sc, zb + 14 * sc, zb + 26 * sc);
    poly3(g, q, 0x4a3524);
    poly3(lit, q, WARM, 0.85);
  }
  // Curved espadana facade rising above the roof line.
  const profile = (plane: number, color: number) => {
    const pts: P3[] = [[nx1, plane, top - 1], [nx0, plane, top - 1]];
    for (let k = 0; k <= 24; k++) {
      const u = k / 24;
      const hump = Math.max(0, Math.cos((u - 0.5) * Math.PI * 1.15));
      const shoulder = u > 0.08 && u < 0.92 ? 4 : 0;
      pts.push([nx0 + u * nw, plane, top + shoulder + 13 * sc * Math.pow(hump, 1.6)]);
    }
    poly3(g, pts, color);
  };
  profile(yf - 0.07, shade(TAN, 0.8));
  profile(yf, shade(TAN, 0.97));
  const ocu = iso(nx0 + nw / 2, yf, top + 7 * sc);
  g.circle(ocu.x, ocu.y, 3.2 * sc).fill(0x4a3524);
  lit.circle(ocu.x, ocu.y, 2.8 * sc).fill(WARM);
  // Arched wooden door and a step.
  const dc = nx0 + nw / 2;
  const door = archQuad("y", yf + 0.002, dc, 0.12 * sc, zb, zb + 22 * sc);
  poly3(g, door, WOOD);
  line3(g, [dc, yf + 0.003, zb], [dc, yf + 0.003, zb + 18 * sc], 1, shade(WOOD, 0.6));
  box(g, dc - 0.18 * sc, yf, 0.36 * sc, 0.1, zb, zb + 2, shade(EARTH, 0.9));
  // Wall lanterns beside the door.
  const lanterns: P3[] = [[dc - 0.2 * sc, yf + 0.01, zb + 20 * sc], [dc + 0.2 * sc, yf + 0.01, zb + 20 * sc]];

  // Bell tower on the front-right corner with an open belfry.
  const tx0 = nx1 + 0.02, tx1 = tx0 + 0.42 * sc, ty1 = yf + 0.02, ty0 = ty1 - 0.42 * sc;
  const tTop = top + 8 * sc, bTop = tTop + 24 * sc;
  box(g, tx0, ty0, tx1 - tx0, ty1 - ty0, zb, tTop, shade(TAN, 1.03));
  box(g, tx0 - 0.02, ty0 - 0.02, tx1 - tx0 + 0.04, ty1 - ty0 + 0.04, tTop, tTop + 3, shade(TAN, 0.92));
  box(g, tx0 + 0.02, ty0 + 0.02, tx1 - tx0 - 0.04, ty1 - ty0 - 0.04, tTop + 3, bTop, TAN);
  const bc = (tx0 + tx1) / 2, bcy = (ty0 + ty1) / 2;
  const openY = archQuad("y", ty1 - 0.019, bc, 0.1 * sc, tTop + 6, bTop - 3);
  const openX = archQuad("x", tx1 - 0.019, bcy, 0.1 * sc, tTop + 6, bTop - 3);
  poly3(g, openY, DARK);
  poly3(g, openX, shade(DARK, 0.8));
  poly3(lit, openY, WARM, 0.35);
  // Rounded cap with a small finial ball.
  box(g, tx0 - 0.01, ty0 - 0.01, tx1 - tx0 + 0.02, ty1 - ty0 + 0.02, bTop, bTop + 3, shade(TAN, 0.92));
  const capBase = iso(bc, bcy, bTop + 3);
  const cr = 12 * sc;
  g.moveTo(capBase.x - cr, capBase.y).arc(capBase.x, capBase.y, cr, Math.PI, 0).fill(shade(TAN, 1.06));
  g.moveTo(capBase.x - cr, capBase.y).arc(capBase.x, capBase.y, cr, Math.PI, Math.PI * 1.4).lineTo(capBase.x, capBase.y).fill({ color: 0xffffff, alpha: 0.18 });
  g.circle(capBase.x, capBase.y - cr - 2, 2).fill(shade(TAN, 0.9));
  // The bell hangs from its pivot so it can swing.
  const bell = new Graphics();
  bell.rect(-0.8, 0, 1.6, 2).fill(0x5d4a2e);
  bell.poly([-2.4, 2, 2.4, 2, 3.2, 5, 4.6, 9, -4.6, 9, -3.2, 5]).fill(0xc9a13b);
  bell.poly([-2.4, 2, -0.6, 2, -1.4, 9, -4.6, 9, -3.2, 5]).fill(0xe0bd5a);
  bell.ellipse(0, 9, 4.8, 1.4).fill(0x9c7a26);
  bell.circle(0, 10.2, 1.1).fill(0x5d4a2e);
  const pivot = iso(bc, ty1 - 0.02, bTop - 5);
  bell.position.set(pivot.x, pivot.y);
  bell.scale.set(sc);

  // Courtyard walls in front, with a gate lined up on the door.
  const wallH = 10 * sc, WALL = shade(TAN, 1.02);
  const fy = y + d - 0.16, fz = zb;
  box(front, x + 0.08, yf + 0.05, 0.1, fy - yf - 0.05, fz, fz + wallH, WALL);
  box(front, x + w - 0.18, ty1 + 0.05, 0.1, fy - ty1 - 0.05, fz, fz + wallH, WALL);
  box(front, x + 0.08, fy, dc - 0.2 * sc - (x + 0.08), 0.1, fz, fz + wallH, WALL);
  box(front, dc + 0.2 * sc, fy, x + w - 0.08 - (dc + 0.2 * sc), 0.1, fz, fz + wallH, WALL);
  for (const gx of [dc - 0.3 * sc, dc + 0.2 * sc]) {
    box(front, gx, fy - 0.02, 0.1 * sc + 0.04, 0.14, fz, fz + wallH + 6 * sc, shade(TAN, 0.96));
    lanterns.push([gx + 0.07 * sc, fy + 0.05, fz + wallH + 6 * sc + 3]);
  }
  pricklyPear(front, x + w - 0.45 * sc, y + d - 0.5 * sc, zb, 0.8 * sc);

  for (const [a, b, c] of lanterns) {
    const p = iso(a, b, c);
    g.rect(p.x - 1.6, p.y - 3, 3.2, 4).fill(0x3b2a1c);
    front.rect(p.x - 1.6, p.y - 3, 3.2, 4).fill(0x3b2a1c);
    lit.circle(p.x, p.y - 1, 2.2).fill(0xffe0a0);
    lit.circle(p.x, p.y - 1, 7).fill({ color: WARM, alpha: 0.28 });
  }

  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, bell, front, lit);
  let t = 0;
  return {
    views: [view],
    tintables: [g, bell, front],
    update: (dt) => {
      t += dt;
      bell.rotation = Math.sin(t * 2.2) * 0.35;
      lit.alpha = ctx.night() * (0.88 + 0.08 * Math.sin(t * 9) + 0.04 * Math.sin(t * 23));
    },
  };
};

/** A cheap desert garden: a sand patch, 3-5 saguaros, prickly pear, and rocks. */
export const saguaroGarden: LandmarkFactory = ({ x, y, w, d }) => {
  const rng = rngFor(x, y, "saguaro");
  const sc = Math.min(w, d) / 2;
  const g = new Graphics();
  const SAND = 0xe8c98c;
  const bed: Tier = { x0: x + 0.06, y0: y + 0.06, x1: x + w - 0.06, y1: y + d - 0.06, z0: 0, z1: 2 };
  tierBox(g, bed, SAND, shade(SAND, 1.05));
  studTier(g, bed, SAND, undefined, 0.7);

  type Item = { tx: number; ty: number; draw: () => void };
  const items: Item[] = [];
  const count = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    // Spread cacti on a loose grid with jitter so they do not overlap.
    const cell = i / count;
    const tx = x + 0.3 + (w - 0.6) * ((cell * 1.7 + rng() * 0.3) % 1);
    const ty = y + 0.3 + (d - 0.6) * ((i + 0.5) / count) + (rng() - 0.5) * 0.15;
    const h = (34 + rng() * 26) * Math.max(0.7, sc);
    const arms: { side: number; at: number; up: number }[] = [];
    const nArms = Math.floor(rng() * 3);
    for (let k = 0; k < nArms; k++) arms.push({ side: k === 0 ? (rng() < 0.5 ? -1 : 1) : -arms[0].side, at: h * (0.35 + rng() * 0.25), up: h * (0.22 + rng() * 0.18) });
    items.push({ tx, ty, draw: () => saguaro(g, tx, ty, 2, h, arms) });
  }
  for (let i = 0; i < 2; i++) {
    const tx = x + 0.2 + rng() * (w - 0.5), ty = y + 0.2 + rng() * (d - 0.5);
    items.push({ tx, ty, draw: () => pricklyPear(g, tx, ty, 2, 0.8 * Math.max(0.7, sc)) });
  }
  for (let i = 0; i < 3; i++) {
    const tx = x + 0.12 + rng() * (w - 0.5), ty = y + 0.12 + rng() * (d - 0.5);
    const sw = 0.15 + rng() * 0.2, sd = 0.12 + rng() * 0.18;
    items.push({ tx: tx + sw, ty: ty + sd, draw: () => rock(g, tx, ty, sw, sd, 5 + rng() * 7, rng() < 0.5 ? 0xb5835a : 0xa1745a) });
  }
  items.sort((a, b) => a.tx + a.ty - (b.tx + b.ty));
  for (const it of items) it.draw();
  return { views: [layer(depthOf(x + w - 1, y + d - 1, 30), g)], tintables: [g] };
};

/** A big stepped volcano: green lower slopes and palms, dark upper rock, a glowing crater, and a smoke plume. */
export const volcano: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor(x, y, "volcano");
  const sc = Math.min(w, d) / 4;
  const levels = 8;
  const H = 13 * Math.max(0.6, sc);
  const cx = x + w / 2, cy = y + d / 2;
  const topHalf = 0.42 * sc;
  const tiers: Tier[] = [];
  for (let k = 0; k < levels; k++) {
    const f = k / (levels - 1);
    const hx = (w / 2 - 0.05) * (1 - f) + topHalf * f;
    const hy = (d / 2 - 0.05) * (1 - f) + topHalf * f;
    tiers.push({ x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, z0: k * H, z1: (k + 1) * H });
  }
  const g = new Graphics();
  const glow = new Graphics();
  tiers.forEach((t, k) => {
    const green = k < 2;
    const side = green ? (k === 0 ? 0x4f8f3a : 0x5a7f3c) : k % 2 ? 0x4a403d : 0x3f3634;
    const topC = green ? 0x69b04c : shade(side, 1.25);
    tierBox(g, t, side, topC);
    studTier(g, t, topC, tiers[k + 1]);
  });
  // Lava streaks down the upper faces.
  const topT = tiers[levels - 1];
  for (const k of [levels - 1, levels - 2, levels - 3]) {
    const t = tiers[k];
    const a = cx - 0.12 * sc + (levels - 1 - k) * 0.03;
    const q = faceQuad("y", t.y1 + 0.002, a, a + 0.1 * sc, t.z0 + (k === levels - 3 ? 5 : 0), t.z1);
    poly3(g, q, 0xe2541b);
    poly3(glow, q, 0xff8a2a);
    const b = cy - 0.05 * sc;
    const q2 = faceQuad("x", t.x1 + 0.002, b, b + 0.08 * sc, t.z0 + (k === levels - 3 ? 7 : 2), t.z1);
    poly3(g, q2, 0xc2461a);
    poly3(glow, q2, 0xff7a1f, 0.8);
  }
  // Crater: a dark rim and a pool of lava on top.
  const ins = (topT.x1 - topT.x0) * 0.2;
  const rim: Tier = { x0: topT.x0 + ins, y0: topT.y0 + ins, x1: topT.x1 - ins, y1: topT.y1 - ins, z0: 0, z1: topT.z1 };
  poly3(g, [[rim.x0, rim.y0, rim.z1], [rim.x1, rim.y0, rim.z1], [rim.x1, rim.y1, rim.z1], [rim.x0, rim.y1, rim.z1]], 0x2a2220);
  const lv = ins * 0.6;
  poly3(g, [[rim.x0 + lv, rim.y0 + lv, rim.z1], [rim.x1 - lv, rim.y0 + lv, rim.z1], [rim.x1 - lv, rim.y1 - lv, rim.z1], [rim.x0 + lv, rim.y1 - lv, rim.z1]], 0xff6d1f);
  const craterC = iso(cx, cy, topT.z1);
  g.ellipse(craterC.x, craterC.y, 6 * sc, 3 * sc).fill(0xffc23a);
  const gr = (topT.x1 - topT.x0) * 32;
  glow.ellipse(craterC.x, craterC.y, gr * 0.7, gr * 0.35).fill({ color: 0xffb040, alpha: 0.9 });
  glow.ellipse(craterC.x, craterC.y - 6, gr * 1.3, gr * 0.8).fill({ color: 0xff6a1a, alpha: 0.35 });
  glow.ellipse(craterC.x, craterC.y - 14, gr * 2, gr * 1.3).fill({ color: 0xff4a10, alpha: 0.14 });
  glow.blendMode = "add";

  // Palms on the base ledge along the two front sides.
  const base = tiers[0], next = tiers[1];
  const palms = new Graphics();
  const crowns: Graphics[] = [];
  const spots: [number, number][] = [];
  for (let i = 0; i < 3; i++) spots.push([base.x0 + 0.3 + (i + rng() * 0.6) * ((base.x1 - base.x0 - 0.6) / 3), (next.y1 + base.y1) / 2 + (rng() - 0.5) * 0.08]);
  for (let i = 0; i < 2; i++) spots.push([(next.x1 + base.x1) / 2 + (rng() - 0.5) * 0.08, base.y0 + 0.4 + (i + rng() * 0.6) * ((base.y1 - base.y0 - 0.8) / 2)]);
  spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const crownLayer = new Container();
  for (const [tx, ty] of spots) {
    const c = palm(palms, tx, ty, base.z1, 0.75 * Math.max(0.7, sc), rng() < 0.5 ? -1 : 1);
    crowns.push(c);
    crownLayer.addChild(c);
  }

  // Smoke plume: puffs drift up, grow, and fade, with per-puff offsets from the seed.
  const smoke = new Container();
  const NP = 9;
  const sRng = rngFor(x, y, "volcano-smoke");
  const puffs: { g: Graphics; off: number; drift: number; size: number }[] = [];
  for (let i = 0; i < NP; i++) {
    const p = puff(i % 2 ? 0x8f8f8f : 0x7a7775);
    smoke.addChild(p);
    puffs.push({ g: p, off: sRng() * 0.08, drift: 0.6 + sRng() * 0.8, size: 0.8 + sRng() * 0.5 });
  }
  const rise = 120 * Math.max(0.6, sc);

  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, glow, palms, crownLayer, smoke);
  let t = 0;
  const tick = (dt: number) => {
    t += dt;
    const n = ctx.night();
    const flick = 0.85 + 0.1 * Math.sin(t * 5.3) + 0.05 * Math.sin(t * 13.7);
    glow.alpha = (0.3 + 0.7 * n) * flick;
    const wind = 1 + ctx.storm() * 2;
    for (let i = 0; i < NP; i++) {
      const p = puffs[i];
      const k = (t * 0.09 + i / NP + p.off) % 1;
      p.g.position.set(craterC.x + k * 34 * p.drift * wind + Math.sin(t * 0.8 + i) * 3, craterC.y - 6 - k * rise);
      p.g.scale.set((0.6 + k * 1.8) * p.size * Math.max(0.7, sc));
      p.g.alpha = 0.75 * Math.min(1, k * 8) * (1 - k);
    }
    const sway = 0.04 * (1 + ctx.storm() * 3);
    for (let i = 0; i < crowns.length; i++) crowns[i].rotation = Math.sin(t * 1.3 + i) * sway;
  };
  tick(0);
  return { views: [view], tintables: [g, palms, crownLayer, smoke], update: tick };
};

/** An icy glacier tongue meeting the water, two log cabins with smoking chimneys, a dock, and a bobbing boat. */
export const glacierHarbor: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor(x, y, "glacier");
  const sc = Math.min(w, d) / 3;
  const s = Math.max(0.7, sc);

  // Base: snowy shore on the left, water on the right. Flat, so it sorts first.
  const base = new Graphics();
  const shoreX = x + w * 0.5;
  const shore: Tier = { x0: x + 0.03, y0: y + 0.03, x1: shoreX, y1: y + d - 0.03, z0: 0, z1: 3 };
  tierBox(base, shore, 0xd9e4ec, 0xf2f7fa);
  studTier(base, shore, 0xf2f7fa, undefined, 0.6);
  const WATER = 0x2f86c8;
  poly3(base, [[shoreX, y + 0.03, 0], [x + w - 0.03, y + 0.03, 0], [x + w - 0.03, y + d - 0.03, 0], [shoreX, y + d - 0.03, 0]], WATER);
  for (let i = 0; i < 10; i++) {
    const a = shoreX + 0.15 + rng() * (x + w - shoreX - 0.4), b = y + 0.2 + rng() * (d - 0.4);
    line3(base, [a, b, 0], [a + 0.18, b, 0], 1.2, 0xa9dcff, 0.55);
  }

  // Glacier tongue: stacked ice tiers stepping down toward the water.
  const ice = new Graphics();
  const tiers: Tier[] = [];
  for (let k = 0; k < 5; k++) {
    tiers.push({
      x0: x + 0.05 + k * 0.08 * s,
      y0: y + 0.05 + k * 0.05 * s,
      x1: x + w * 0.66 - k * w * 0.1,
      y1: y + d * 0.5 - k * d * 0.05,
      z0: k * 12 * s,
      z1: (k + 1) * 12 * s,
    });
  }
  tiers.forEach((t, k) => {
    const side = k % 2 ? 0x9fd6f0 : 0xb8e3f6;
    tierBox(ice, t, side, 0xf2fbff);
    // Translucent look: a pale band and a deep blue seam on each face.
    poly3(ice, faceQuad("y", t.y1, t.x0, t.x1, t.z0 + 2, t.z0 + 4), 0x6fb6de, 0.7);
    poly3(ice, faceQuad("x", t.x1, t.y0, t.y1, t.z0 + 2, t.z0 + 4), 0x5aa2cc, 0.7);
    poly3(ice, faceQuad("y", t.y1, t.x0 + 0.05, t.x0 + 0.2, t.z0 + 5, t.z1 - 2), 0xffffff, 0.35);
    studTier(ice, t, 0xeaf6ff, tiers[k + 1]);
    const c = t.x0 + (t.x1 - t.x0) * (0.3 + rng() * 0.4);
    line3(ice, [c, t.y0 + 0.1, t.z1], [c + 0.25, t.y0 + 0.35, t.z1], 1, 0x6fb6de, 0.7);
  });
  // A couple of small bergs in the water.
  for (let i = 0; i < 2; i++) {
    const bx = x + w * 0.7 + rng() * (w * 0.2), by = y + 0.15 + rng() * d * 0.25;
    box(ice, bx, by, 0.16 * s, 0.14 * s, 0, 6 + rng() * 5, 0xb8e3f6, 0xf6fcff);
  }

  // Log cabins with smoking chimneys.
  const lit = new Graphics();
  const cabins = new Graphics();
  const chimneys: { x: number; y: number }[] = [];
  const cabin = (cx0: number, cy0: number, cw: number, cd: number, roofC: number) => {
    const LOG = 0x8b5a2b, h = 18 * s;
    box(cabins, cx0, cy0, cw, cd, 3, 3 + h, LOG);
    for (let zz = 7; zz < 3 + h; zz += 4.5) {
      line3(cabins, [cx0, cy0 + cd, zz], [cx0 + cw, cy0 + cd, zz], 1, shade(LOG, 0.68), 0.55);
      line3(cabins, [cx0 + cw, cy0 + cd, zz], [cx0 + cw, cy0, zz], 1, shade(LOG, 0.52), 0.55);
    }
    const dq = faceQuad("y", cy0 + cd + 0.002, cx0 + cw * 0.18, cx0 + cw * 0.36, 3, 3 + h * 0.7);
    poly3(cabins, dq, 0x4e3420);
    const wq = faceQuad("y", cy0 + cd + 0.002, cx0 + cw * 0.55, cx0 + cw * 0.82, 3 + h * 0.35, 3 + h * 0.75);
    poly3(cabins, wq, GLASS);
    poly3(lit, wq, LIT);
    const sq = faceQuad("x", cx0 + cw + 0.002, cy0 + cd * 0.3, cy0 + cd * 0.7, 3 + h * 0.35, 3 + h * 0.75);
    poly3(cabins, sq, shade(GLASS, 0.82));
    poly3(lit, sq, LIT, 0.85);
    const z = 3 + h, rh = 12 * s, my = cy0 + cd / 2;
    const r0: P3 = [cx0 - 0.04, my, z + rh], r1: P3 = [cx0 + cw + 0.04, my, z + rh];
    poly3(cabins, [[cx0 - 0.04, cy0 - 0.05, z], [cx0 + cw + 0.04, cy0 - 0.05, z], r1, r0], shade(roofC, 0.8));
    poly3(cabins, [[cx0 + cw, cy0 + cd, z], [cx0 + cw, cy0, z], [cx0 + cw, my, z + rh - 1]], shade(LOG, 0.7));
    poly3(cabins, [[cx0 - 0.04, cy0 + cd + 0.05, z], [cx0 + cw + 0.04, cy0 + cd + 0.05, z], r1, r0], roofC);
    // Snow along the ridge.
    poly3(cabins, [[cx0 - 0.04, my + cd * 0.18, z + rh * 0.64], [cx0 + cw + 0.04, my + cd * 0.18, z + rh * 0.64], r1, r0], 0xf4f8fb);
    const chx = cx0 + cw * 0.72, chy = cy0 + cd * 0.3;
    box(cabins, chx, chy, 0.1 * s, 0.1 * s, z + 2, z + rh + 8, 0x8a8f96);
    chimneys.push({ x: chx + 0.05 * s, y: chy + 0.05 * s });
    return z + rh + 8;
  };
  const cabinA = { x: x + w * 0.05, y: y + d * 0.6, w: w * 0.22, d: d * 0.16 };
  const cabinB = { x: x + w * 0.29, y: y + d * 0.79, w: w * 0.18, d: d * 0.14 };
  const topA = cabin(cabinA.x, cabinA.y, cabinA.w, cabinA.d, 0x7b2d26);
  pine(cabins, x + w * 0.4, y + d * 0.66, 3, 0.85 * s, 0x2b6e48);
  pine(cabins, x + w * 0.08, y + d * 0.9, 3, 0.75 * s, 0x2b6e48);
  const topB = cabin(cabinB.x, cabinB.y, cabinB.w, cabinB.d, 0x2e5d7a);
  const chimneyTops = [topA, topB];

  const smoke = new Container();
  const smokeGs: { g: Graphics; c: number; off: number }[] = [];
  for (let ci = 0; ci < chimneys.length; ci++) {
    for (let i = 0; i < 4; i++) {
      const p = puff(0xd4d4d4);
      smoke.addChild(p);
      smokeGs.push({ g: p, c: ci, off: i / 4 + rng() * 0.05 });
    }
  }
  const chimneyAt = chimneys.map((c, i) => iso(c.x, c.y, chimneyTops[i]));

  // Dock and a small fishing boat.
  const dockG = new Graphics();
  const dx0 = shoreX - 0.05, dx1 = x + w * 0.8, dy0 = y + d * 0.8, dy1 = dy0 + 0.22 * s;
  for (const px of [dx0 + 0.2, (dx0 + dx1) / 2, dx1 - 0.05])
    for (const py of [dy0 + 0.02, dy1 - 0.02]) cylinder(dockG, px, py, 1.8, -2, 5, 0x6d4c33);
  box(dockG, dx0, dy0, dx1 - dx0, dy1 - dy0, 4, 6, 0xa7794a);
  for (let i = 1; i < 8; i++) {
    const a = dx0 + ((dx1 - dx0) * i) / 8;
    line3(dockG, [a, dy0, 6], [a, dy1, 6], 0.8, 0x7a5533, 0.7);
  }
  const lampP = iso(dx1 - 0.05, dy0 + 0.02, 18);
  line3(dockG, [dx1 - 0.05, dy0 + 0.02, 6], [dx1 - 0.05, dy0 + 0.02, 18], 1.4, 0x3b3b3b);
  lit.circle(lampP.x, lampP.y, 2.4).fill(0xfff1b8);
  lit.circle(lampP.x, lampP.y, 8).fill({ color: LIT, alpha: 0.25 });

  const boat = new Graphics();
  const bs = s;
  boat.poly([-18 * bs, -4 * bs, 16 * bs, -8 * bs, 22 * bs, -12 * bs, 18 * bs, 0, -12 * bs, 5 * bs, -20 * bs, 0]).fill(0xd84343);
  boat.poly([-18 * bs, -4 * bs, 16 * bs, -8 * bs, 22 * bs, -12 * bs, 20 * bs, -9 * bs, -16 * bs, -1 * bs]).fill(0xf4f4f4);
  boat.rect(-6 * bs, -18 * bs, 10 * bs, 10 * bs).fill(0xf4f4f4);
  boat.rect(-6 * bs, -18 * bs, 10 * bs, 2.5 * bs).fill(0x2e5d7a);
  boat.rect(-4 * bs, -14 * bs, 3 * bs, 3 * bs).fill(GLASS);
  boat.moveTo(8 * bs, -8 * bs).lineTo(8 * bs, -30 * bs).lineTo(-10 * bs, -9 * bs).stroke({ width: 1, color: 0x5a4a3a });
  const boatAt = iso(x + w * 0.84, y + d * 0.58, 0);
  boat.position.set(boatAt.x, boatAt.y);
  const wake = new Graphics();
  wake.ellipse(boatAt.x, boatAt.y + 2, 24 * bs, 5 * bs).fill({ color: 0xffffff, alpha: 0.18 });

  lit.alpha = 0;
  lit.blendMode = "add";
  const baseView = layer(depthOf(x, y, 1), base);
  const iceView = layer(depthOf(x + Math.ceil(w * 0.66) - 1, y + Math.ceil(d * 0.5) - 1, 40), ice);
  const cabinView = layer(depthOf(x + Math.ceil(w * 0.47) - 1, y + d - 1, 50), cabins, smoke);
  const harborView = layer(depthOf(x + w - 1, y + d - 1, 60), wake, boat, dockG, lit);
  let t = 0;
  const tick = (dt: number) => {
    t += dt;
    const st = ctx.storm();
    boat.y = boatAt.y + Math.sin(t * 1.7) * (1.2 + st * 3);
    boat.rotation = Math.sin(t * 1.1) * (0.03 + st * 0.08);
    for (const p of smokeGs) {
      const k = (t * 0.22 + p.off) % 1;
      const o = chimneyAt[p.c];
      p.g.position.set(o.x + k * 14 * (1 + st * 2), o.y - 4 - k * 30 * s);
      p.g.scale.set((0.25 + k * 0.7) * s);
      p.g.alpha = 0.7 * Math.min(1, k * 6) * (1 - k);
    }
    lit.alpha = ctx.night();
  };
  tick(0);
  return {
    views: [baseView, iceView, cabinView, harborView],
    tintables: [base, ice, cabins, smoke, dockG, boat, wake],
    update: tick,
  };
};

export const WILD_LANDMARKS: Record<string, LandmarkFactory> = {
  mountain,
  "ski-lift": skiLift,
  "adobe-mission": adobeMission,
  "saguaro-garden": saguaroGarden,
  volcano,
  "glacier-harbor": glacierHarbor,
};
