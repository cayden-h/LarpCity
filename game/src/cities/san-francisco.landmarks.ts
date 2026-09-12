// San Francisco's landmarks, drawn as toy-brick models with animated lights.
// Stylized shapes only: no logos or real signage.

import { Container, Graphics } from "pixi.js";
import { shade } from "../engine/color";
import { BRIDGE_Z, WATER_Z } from "../engine/ground";
import { depthOf, iso } from "../engine/iso";
import { box, cone, cylinder, layer, line3 } from "../engine/shapes";
import type { LandmarkFactory } from "../engine/types";

type P3 = [number, number, number];

const LIT = 0xffd47e;
const GG_RED = 0xc8452f;

/** Fill a polygon given in tile space. */
function poly3(g: Graphics, pts: P3[], color: number, alpha = 1): void {
  g.poly(pts.flatMap(([a, b, c]) => {
    const p = iso(a, b, c);
    return [p.x, p.y];
  })).fill({ color, alpha });
}

/** Deterministic on/off pattern for lit windows. */
const on = (i: number, j: number, share = 0.45) => ((i * 73 + j * 151 + i * j * 7) % 100) / 100 < share;

/**
 * The red-orange suspension bridge, drawn over a row of bridge tiles: two
 * stepped towers with portal struts, main cables drooping between the towers
 * and down to the anchorages, vertical suspenders, blinking aviation lights,
 * floodlit towers, and deck lights at night.
 */
export const goldenGate: LandmarkFactory = ({ x, y, w }, ctx) => {
  const y0 = y + 0.1, y1 = y + 0.9;
  const xEnd = x + w;
  const towers = [x + w * 0.2, x + w * 0.8];
  const [ta, tb] = towers;
  const top = 220;
  const deck = BRIDGE_Z + 4;
  const saddle = top - 8;
  const low = BRIDGE_Z + 20;
  const cableZ = (t: number): number => {
    if (t <= ta) {
      const k = (t - x) / (ta - x);
      return deck + (saddle - deck) * k * k;
    }
    if (t >= tb) {
      const k = (xEnd - t) / (xEnd - tb);
      return deck + (saddle - deck) * k * k;
    }
    const k = (t - (ta + tb) / 2) / ((tb - ta) / 2);
    return low + (saddle - low) * k * k;
  };

  // One side of the bridge: suspenders, the main cable, and the deck truss.
  const drawSide = (g: Graphics, side: number, far: boolean) => {
    const color = far ? shade(GG_RED, 0.78) : GG_RED;
    for (let t = x + 0.12; t < xEnd - 0.05; t += 0.14) {
      if (towers.some((p) => Math.abs(t - p) < 0.09)) continue;
      const cz = cableZ(t);
      if (cz - deck < 4) continue;
      line3(g, [t, side, deck], [t, side, cz], 0.8, shade(color, 0.92), 0.9);
    }
    const start = iso(x, side, cableZ(x));
    g.moveTo(start.x, start.y);
    for (let k = 1; k <= 80; k++) {
      const t = x + (w * k) / 80;
      const p = iso(t, side, cableZ(t));
      g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 2.6, color, cap: "round", join: "round" });
    line3(g, [x, side, BRIDGE_Z + 1], [xEnd, side, BRIDGE_Z + 1], 3, shade(GG_RED, far ? 0.6 : 0.82));
    for (let t = x + 0.1; t < xEnd; t += 0.2) line3(g, [t, side, BRIDGE_Z - 2], [t, side, BRIDGE_Z + 3], 1, shade(GG_RED, 0.55));
  };

  // A tower leg that steps in twice on the way up, with a cap.
  const leg = (g: Graphics, px: number, side: number, zFrom: number) => {
    const segs: P3[] = [[zFrom, 110, 0.085], [110, 170, 0.07], [170, top, 0.058]];
    for (const [a, b, r] of segs) box(g, px - r, side - r, r * 2, r * 2, a, b, GG_RED);
    box(g, px - 0.05, side - 0.05, 0.1, 0.1, top, top + 6, shade(GG_RED, 0.9));
  };

  const views: Container[] = [];
  const tintables: Container[] = [];

  // Far side sits behind all traffic on the deck.
  const far = new Graphics();
  drawSide(far, y0, true);
  for (const px of towers) leg(far, px, y0, BRIDGE_Z);
  views.push(layer(depthOf(x, y, 5), far));
  tintables.push(far);

  // Each tower's portal struts and near leg sort with the cars around it.
  for (const px of towers) {
    const g = new Graphics();
    for (const [z, h] of [[BRIDGE_Z + 56, 8], [122, 7], [174, 6], [top - 10, 9]]) box(g, px - 0.045, y0, 0.09, y1 - y0, z, z + h, shade(GG_RED, 0.92));
    box(g, px - 0.14, y1 - 0.12, 0.28, 0.26, WATER_Z, WATER_Z + 5, 0xa9a39a);
    leg(g, px, y1, WATER_Z);
    views.push(layer(depthOf(px, y1, 75), g));
    tintables.push(g);
  }

  // Near side sits in front of all traffic on the deck.
  const near = new Graphics();
  drawSide(near, y1, false);
  views.push(layer(depthOf(xEnd, y1, 80), near));
  tintables.push(near);

  const lights = new Graphics();
  const beacons = new Graphics();
  for (const px of towers)
    for (const side of [y0, y1]) {
      const a = iso(px, side, BRIDGE_Z), b = iso(px, side, top);
      lights.rect(a.x - 7, b.y, 14, a.y - b.y).fill({ color: 0xffb070, alpha: 0.16 });
      const p = iso(px, side, top + 9);
      beacons.circle(p.x, p.y, 7).fill({ color: 0xff3b30, alpha: 0.25 });
      beacons.circle(p.x, p.y, 2.8).fill(0xff3b30);
    }
  for (let k = 0; k <= w * 3; k++)
    for (const side of [y0, y1]) {
      const p = iso(x + k / 3, side, BRIDGE_Z + 6);
      lights.circle(p.x, p.y, 1.6).fill(0xfff1b8);
    }
  lights.alpha = 0;
  beacons.alpha = 0;
  lights.blendMode = "add";
  beacons.blendMode = "add";
  views.push(layer(depthOf(xEnd, y1, 90), lights, beacons));

  let t = 0;
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lights.alpha = n;
      beacons.alpha = n * (Math.sin(t * 2.5) > 0 ? 1 : 0.2);
    },
  };
};

/** The white pyramid skyscraper: tapering faces, side wings near the top, and a lit spire. */
export const pyramidTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const beacon = new Graphics();
  const white = 0xf2efe8;
  const cx = x + w / 2, cy = y + d / 2;
  const z0 = 8, z1 = 330, zs = 400;
  const s0 = Math.min(w, d) * 0.38, s1 = 0.1;
  const sAt = (z: number) => s0 + (s1 - s0) * ((z - z0) / (z1 - z0));
  // Plaza podium with a dark arcade.
  box(g, x + 0.08, y + 0.08, w - 0.16, d - 0.16, 0, z0, 0xbdb9b0);
  // The far wing peeks out behind the faces.
  box(g, cx - sAt(250) - 0.1, cy - 0.12, 0.14, 0.24, 215, 292, shade(white, 0.92));
  poly3(g, [[cx - s0, cy + s0, z0], [cx + s0, cy + s0, z0], [cx + s1, cy + s1, z1], [cx - s1, cy + s1, z1]], shade(white, 0.97));
  poly3(g, [[cx + s0, cy + s0, z0], [cx + s0, cy - s0, z0], [cx + s1, cy - s1, z1], [cx + s1, cy + s1, z1]], shade(white, 0.78));
  // Floor lines and window slots on both faces.
  let row = 0;
  for (let z = z0 + 14; z < z1 - 8; z += 9, row++) {
    const s = sAt(z);
    line3(g, [cx - s, cy + s, z], [cx + s, cy + s, z], 1, shade(white, 0.82), 0.8);
    line3(g, [cx + s, cy + s, z], [cx + s, cy - s, z], 1, shade(white, 0.6), 0.8);
    const n = Math.max(2, Math.round(s * 12));
    for (let i = 0; i < n; i++) {
      const a = -s + ((i + 0.3) * 2 * s) / n, b = -s + ((i + 0.7) * 2 * s) / n;
      line3(g, [cx + a, cy + s, z + 4], [cx + b, cy + s, z + 4], 1.6, 0x7d98ad);
      line3(g, [cx + s, cy - a, z + 4], [cx + s, cy - b, z + 4], 1.6, 0x5f7a8f);
      if (on(row, i)) line3(lit, [cx + a, cy + s, z + 4], [cx + b, cy + s, z + 4], 1.8, LIT);
      if (on(row + 5, i)) line3(lit, [cx + s, cy - a, z + 4], [cx + s, cy - b, z + 4], 1.8, LIT);
    }
  }
  // Near wing on the right face.
  box(g, cx + sAt(250) - 0.04, cy - 0.12, 0.14, 0.24, 215, 292, white);
  // Spire.
  poly3(g, [[cx - s1, cy + s1, z1], [cx + s1, cy + s1, z1], [cx, cy, zs]], shade(white, 0.95));
  poly3(g, [[cx + s1, cy + s1, z1], [cx + s1, cy - s1, z1], [cx, cy, zs]], shade(white, 0.74));
  poly3(lit, [[cx - s1, cy + s1, z1], [cx + s1, cy + s1, z1], [cx, cy, zs]], 0xfff1c4, 0.55);
  // Dark arcade at the base.
  for (let i = 0; i < 6; i++) {
    const a = x + 0.2 + i * ((w - 0.4) / 6);
    poly3(g, [[a + 0.04, y + d - 0.08, 0], [a + 0.2, y + d - 0.08, 0], [a + 0.2, y + d - 0.08, z0 - 1], [a + 0.04, y + d - 0.08, z0 - 1]], 0x4e5b66);
  }
  const tip = iso(cx, cy, zs + 2);
  beacon.circle(tip.x, tip.y, 7).fill({ color: 0xff3b30, alpha: 0.25 });
  beacon.circle(tip.x, tip.y, 2.6).fill(0xff3b30);
  lit.alpha = 0;
  beacon.alpha = 0;
  lit.blendMode = "add";
  beacon.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit, beacon);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      beacon.alpha = n * (0.4 + 0.6 * Math.max(0, Math.sin(t * 2)));
    },
  };
};

/** The tallest tower: a rounded glass column with an open lattice crown that shimmers at night. */
export const glassTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const crown = new Graphics();
  const glass = 0x9cc4dc;
  const cx = x + w / 2, cy = y + d / 2;
  const z0 = 8, z1 = 450, zc = 500;
  const r0 = 40, r1 = 31, rc = 29;
  const rAt = (z: number) => r0 + (r1 - r0) * ((z - z0) / (z1 - z0));
  const b = iso(cx, cy, z0), tp = iso(cx, cy, z1), tc = iso(cx, cy, zc);
  const rim = (base: { x: number; y: number }, u: number, r: number, sign = 1): [number, number] => [base.x + u * r, base.y + (sign * Math.sqrt(Math.max(0, 1 - u * u)) * r) / 2];
  box(g, x + 0.08, y + 0.08, w - 0.16, d - 0.16, 0, z0, 0xcfd4d8);
  g.ellipse(b.x, b.y, r0, r0 / 2).fill(shade(glass, 0.7));
  // Curved glass body as vertical strips, bright on the left, darker right.
  const N = 12;
  for (let i = 0; i < N; i++) {
    const u0 = -1 + (2 * i) / N, u1 = -1 + (2 * (i + 1)) / N;
    const f = i === 2 ? 1.2 : 1.1 - 0.44 * ((i + 0.5) / N);
    g.poly([...rim(tp, u0, r1), ...rim(tp, u1, r1), ...rim(b, u1, r0), ...rim(b, u0, r0)]).fill(shade(glass, f));
  }
  for (const u of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const [ax, ay] = rim(b, u, r0), [bx, by] = rim(tp, u, r1);
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1, color: 0xeaf3f8, alpha: 0.3 });
  }
  // Floor bands wrapping the front, with lit window runs between them.
  let band = 0;
  for (let z = z0 + 16; z < z1; z += 16, band++) {
    const r = rAt(z), p = iso(cx, cy, z);
    g.moveTo(p.x + r, p.y);
    for (let k = 1; k <= 16; k++) {
      const a = (Math.PI * k) / 16;
      g.lineTo(p.x + Math.cos(a) * r, p.y + (Math.sin(a) * r) / 2);
    }
    g.stroke({ width: 1, color: 0xeaf3f8, alpha: 0.45 });
    for (let s = 0; s < 6; s++) {
      if (!on(band, s, 0.5)) continue;
      const q = iso(cx, cy, z + 7), rq = rAt(z + 7);
      const a0 = (Math.PI * (s + 0.15)) / 6, a1 = (Math.PI * (s + 0.85)) / 6;
      lit.moveTo(q.x + Math.cos(a0) * rq, q.y + (Math.sin(a0) * rq) / 2);
      for (let k = 1; k <= 4; k++) {
        const a = a0 + ((a1 - a0) * k) / 4;
        lit.lineTo(q.x + Math.cos(a) * rq, q.y + (Math.sin(a) * rq) / 2);
      }
      lit.stroke({ width: 3, color: LIT, alpha: 0.85 });
    }
  }
  g.ellipse(tp.x, tp.y, r1, r1 / 2).fill(shade(glass, 1.15));
  // Open lattice crown: back bars, a translucent screen, then front bars and rings.
  const bars = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];
  for (const u of bars) {
    const [ax, ay] = rim(tp, u, r1, -1), [bx, by] = rim(tc, u, rc, -1);
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1.2, color: 0xdfe6ea });
  }
  g.poly([tp.x - r1, tp.y, tc.x - rc, tc.y, tc.x + rc, tc.y, tp.x + r1, tp.y]).fill({ color: 0xffffff, alpha: 0.18 });
  for (const u of bars) {
    const [ax, ay] = rim(tp, u, r1), [bx, by] = rim(tc, u, rc);
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 2, color: 0xf7f9fa });
  }
  for (const z of [z1 + 17, z1 + 34, zc]) {
    const p = iso(cx, cy, z), r = r1 + ((rc - r1) * (z - z1)) / (zc - z1);
    g.ellipse(p.x, p.y, r, r / 2).stroke({ width: 1.6, color: 0xf7f9fa });
  }
  const tipZ = zc + 14;
  line3(g, [cx, cy, zc], [cx, cy, tipZ], 1.5, 0xdfe6ea);
  const tipP = iso(cx, cy, tipZ);
  lit.circle(tipP.x, tipP.y, 2.6).fill(0xff3b30);
  lit.alpha = 0;
  crown.alpha = 0;
  lit.blendMode = "add";
  crown.blendMode = "add";
  const hues = [0x7fdcff, 0xffffff, 0xffb8ec, 0x9dffc0];
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit, crown);
  let t = 0;
  let drawn = false;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      crown.alpha = n;
      if (n < 0.02) {
        if (drawn) crown.clear();
        drawn = false;
        return;
      }
      drawn = true;
      crown.clear();
      bars.forEach((u, i) => {
        for (let lvl = 0; lvl < 4; lvl++) {
          const z = z1 + 6 + lvl * 12;
          const r = r1 + ((rc - r1) * (z - z1)) / (zc - z1);
          const [px, py] = rim(iso(cx, cy, z), u, r);
          const k = 0.5 + 0.5 * Math.sin(t * 1.6 + i * 0.9 + lvl * 1.3);
          crown.circle(px, py, 2.4).fill({ color: hues[(i + lvl + Math.floor(t * 0.5)) % hues.length], alpha: 0.35 + 0.65 * k });
        }
      });
    },
  };
};

/** A row of pastel Victorian houses with gables, bay windows, and white trim. */
export const paintedLadies: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const colors = [0xf6b8c8, 0xbfe6d0, 0xfbe7a1, 0xaed6f1, 0xd9c8ec, 0xf8cfa8];
  const trim = 0xffffff;
  const glassDark = 0x5a7184;
  const roofs = [0x5b6770, 0x6d5a52];
  for (let i = 0; i < w; i++) {
    const x0 = x + i + 0.06, x1 = x + i + 0.94, xm = (x0 + x1) / 2;
    const yb = y + 0.12, yf = y + d - 0.14;
    const col = colors[i % colors.length];
    const roof = roofs[i % roofs.length];
    const zt = 64, zr = zt + 28;
    box(g, x0, yb, x1 - x0, yf - yb, 0, zt, col);
    // Gable roof with the ridge running back from the street.
    poly3(g, [[x0, yb, zt], [xm, yb, zr], [xm, yf, zr], [x0, yf, zt]], shade(roof, 1.15));
    poly3(g, [[xm, yb, zr], [x1, yb, zt], [x1, yf, zt], [xm, yf, zr]], shade(roof, 0.85));
    poly3(g, [[x0, yf, zt], [x1, yf, zt], [xm, yf, zr]], shade(col, 0.97));
    line3(g, [x0 - 0.02, yf + 0.01, zt - 1], [xm, yf + 0.01, zr + 2], 2.2, trim);
    line3(g, [xm, yf + 0.01, zr + 2], [x1 + 0.02, yf + 0.01, zt - 1], 2.2, trim);
    line3(g, [x0, yf + 0.01, zt], [x1, yf + 0.01, zt], 3, trim);
    line3(g, [x0, yf + 0.01, 42], [x1, yf + 0.01, 42], 1.4, trim);
    line3(g, [x0, yf + 0.01, 22], [x1, yf + 0.01, 22], 1.4, trim);
    const attic = iso(xm, yf + 0.01, zt + 11);
    g.circle(attic.x, attic.y, 3.2).fill(glassDark);
    g.circle(attic.x, attic.y, 3.2).stroke({ width: 1, color: trim });
    if (on(i, 9)) lit.circle(attic.x, attic.y, 2.6).fill(LIT);
    // Bay window on the left half, one window per floor.
    const bx0 = x0 + 0.08, bx1 = x0 + 0.42, bf = yf + 0.1;
    box(g, bx0, yf, bx1 - bx0, 0.1, 4, zt - 4, shade(col, 1.04));
    for (let f = 0; f < 3; f++) {
      const z = 8 + f * 20;
      const win: P3[] = [[bx0 + 0.05, bf, z], [bx1 - 0.05, bf, z], [bx1 - 0.05, bf, z + 11], [bx0 + 0.05, bf, z + 11]];
      poly3(g, win, glassDark);
      line3(g, [bx0 + 0.04, bf + 0.005, z + 12], [bx1 - 0.04, bf + 0.005, z + 12], 1.4, trim);
      if (on(i, f)) poly3(lit, win, LIT);
    }
    // Front door up a stoop, windows above it.
    box(g, x0 + 0.5, yf, 0.26, 0.1, 0, 4, 0xe6e2da);
    poly3(g, [[x0 + 0.55, yf + 0.005, 4], [x0 + 0.71, yf + 0.005, 4], [x0 + 0.71, yf + 0.005, 19], [x0 + 0.55, yf + 0.005, 19]], 0x6d4c41);
    for (let f = 1; f < 3; f++) {
      const z = 8 + f * 20;
      const win: P3[] = [[x0 + 0.55, yf + 0.005, z], [x0 + 0.72, yf + 0.005, z], [x0 + 0.72, yf + 0.005, z + 12], [x0 + 0.55, yf + 0.005, z + 12]];
      poly3(g, win, glassDark);
      if (on(i + 3, f)) poly3(lit, win, LIT);
    }
    // Corner boards.
    line3(g, [x1, yf + 0.01, 0], [x1, yf + 0.01, zt], 1.4, trim);
    line3(g, [x0, yf + 0.01, 0], [x0, yf + 0.01, zt], 1.4, trim);
  }
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit);
  return { views: [view], tintables: [g], update: () => (lit.alpha = ctx.night()) };
};

/** A small rocky island prison: cliffs, a long cellblock, a water tower, and a lighthouse. */
export const islandPrison: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const beam = new Graphics();
  const rock = 0x9b8f7e, scrub = 0x6a9a4e, cream = 0xe8dcc0;
  box(g, x + 0.08, y + 0.08, w - 0.16, d - 0.16, 0, 12, rock, shade(scrub, 0.9));
  // Streaks on the cliff faces.
  for (let i = 0; i < 9; i++) {
    const t = x + 0.2 + i * ((w - 0.4) / 9);
    line3(g, [t, y + d - 0.08, 1], [t + 0.05, y + d - 0.08, 10], 1.4, shade(rock, 0.75), 0.7);
    const s = y + 0.2 + i * ((d - 0.4) / 9);
    line3(g, [x + w - 0.08, s, 1], [x + w - 0.08, s - 0.05, 10], 1.4, shade(rock, 0.6), 0.7);
  }
  box(g, x + 0.25, y + 0.25, w - 0.6, d - 0.75, 12, 18, shade(rock, 1.06), scrub);
  // Water tower on stilts at the back.
  const wx = x + w - 0.6, wy = y + 0.55;
  for (const [dx, dy] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) line3(g, [wx + dx, wy + dy, 18], [wx + dx * 0.6, wy + dy * 0.6, 44], 1.2, 0x5d5d5d);
  cylinder(g, wx, wy, 7, 44, 55, 0xb9b3a8);
  cone(g, wx, wy, 7, 55, 5, 0x8d8a84);
  // Cellblock with rows of window slits.
  const cx0 = x + 0.5, cy0 = y + 0.55, cw = 1.6, cd = 0.75, cz0 = 18, cz1 = 44;
  box(g, cx0, cy0, cw, cd, cz0, cz1, cream, shade(cream, 0.85));
  for (let i = 0; i < 5; i++) box(g, cx0 + 0.15 + i * 0.3, cy0 + 0.25, 0.14, 0.25, cz1, cz1 + 4, shade(cream, 0.9));
  for (const [r, z] of [[0, 25], [1, 34]] as const) {
    for (let i = 0; i < 10; i++) {
      const t = cx0 + 0.08 + i * 0.15;
      const win: P3[] = [[t, cy0 + cd + 0.005, z], [t + 0.05, cy0 + cd + 0.005, z], [t + 0.05, cy0 + cd + 0.005, z + 5], [t, cy0 + cd + 0.005, z + 5]];
      poly3(g, win, 0x4a4a4a);
      if (on(i, r, 0.3)) poly3(lit, win, LIT);
    }
    for (let j = 0; j < 4; j++) {
      const s = cy0 + 0.1 + j * 0.16;
      const win: P3[] = [[cx0 + cw + 0.005, s, z], [cx0 + cw + 0.005, s + 0.05, z], [cx0 + cw + 0.005, s + 0.05, z + 5], [cx0 + cw + 0.005, s, z + 5]];
      poly3(g, win, 0x3a3a3a);
      if (on(j + 11, r, 0.3)) poly3(lit, win, LIT);
    }
  }
  // Scrub trees along the front of the plateau.
  for (const [tx, ty, r] of [[x + 2.3, y + 1.85, 6], [x + 1.4, y + 1.95, 5], [x + 2.55, y + 1.3, 5], [x + 1.0, y + 1.9, 4]] as const) {
    const p = iso(tx, ty, 20);
    g.circle(p.x, p.y, r).fill(shade(scrub, 0.8));
    g.circle(p.x - r * 0.3, p.y - r * 0.3, r * 0.55).fill(shade(scrub, 1.05));
  }
  // Lighthouse on the front corner.
  const lx = x + 0.55, ly = y + 1.75;
  box(g, lx - 0.15, ly - 0.15, 0.3, 0.3, 18, 26, shade(cream, 0.92));
  cylinder(g, lx, ly, 5, 26, 92, 0xf2eee2);
  cylinder(g, lx, ly, 7, 92, 95, 0x3a3a3a);
  cylinder(g, lx, ly, 4.5, 95, 104, 0xcfe8f0);
  cone(g, lx, ly, 5.5, 104, 7, 0x3a3a3a);
  // Small dock at the waterline.
  box(g, x + 1.5, y + d - 0.14, 0.8, 0.12, 0, 3, 0x8d6e63);
  const lamp = iso(lx, ly, 99);
  lit.circle(lamp.x, lamp.y, 4).fill(0xfffbe0);
  lit.alpha = 0;
  lit.blendMode = "add";
  beam.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit, beam);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      beam.clear();
      if (n < 0.05) return;
      const a = t * 1.2;
      const ex = Math.cos(a) * 240, ey = Math.sin(a) * 120;
      beam.poly([lamp.x, lamp.y, lamp.x + ex - ey * 0.08, lamp.y + ey + ex * 0.04, lamp.x + ex + ey * 0.08, lamp.y + ey - ex * 0.04]).fill({ color: 0xfff6c8, alpha: 0.22 * n });
    },
  };
};

/** A white fluted column with an arched crown on top of a wooded park hill, floodlit at night. */
export const coitTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const white = 0xf1ede2;
  const cx = x + w / 2, cy = y + d / 2;
  const c = iso(cx, cy, 0);
  const rx = (w + d) * 15;
  // Stepped hill mound.
  for (let k = 0; k < 4; k++) {
    const r = rx * (1 - k * 0.2);
    g.ellipse(c.x, c.y - k * 7, r, r / 2).fill(shade(0x5f9e45, 0.82 + k * 0.08));
  }
  // Trees around the slopes, back ones first.
  const trees: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    trees.push([Math.cos(a) * rx * 0.72, Math.sin(a) * rx * 0.36]);
  }
  trees.sort((p, q) => p[1] - q[1]);
  for (const [dx, dy] of trees) {
    const px = c.x + dx, py = c.y + dy - 8;
    g.circle(px, py, 7).fill(0x3f7a34);
    g.circle(px - 2, py - 2, 4).fill(0x5a9a45);
  }
  const zb = 28, zt = 150;
  box(g, cx - 0.32, cy - 0.32, 0.64, 0.64, 20, zb + 6, shade(white, 0.95));
  cylinder(g, cx, cy, 11, zb, zt, white);
  const base = iso(cx, cy, zb), top = iso(cx, cy, zt);
  for (let k = -3; k <= 3; k++) g.rect(base.x + k * 3 - 0.5, top.y + 8, 1, base.y - top.y - 8).fill({ color: shade(white, 0.78), alpha: 0.8 });
  // Crown with arched openings and a flat cap.
  cylinder(g, cx, cy, 12.5, zt - 12, zt, shade(white, 1.02));
  const crownWins: [number, number][] = [];
  for (let k = -2; k <= 2; k++) {
    const px = top.x + k * 4.6;
    g.rect(px - 1.4, top.y + 3, 2.8, 7).fill(0x5a5a5a);
    g.circle(px, top.y + 3, 1.4).fill(0x5a5a5a);
    crownWins.push([px, top.y + 3]);
  }
  cylinder(g, cx, cy, 9, zt, zt + 6, shade(white, 0.95));
  // Floodlight wash on the column and glowing crown windows.
  lit.rect(base.x - 11, top.y, 22, base.y - top.y).fill({ color: 0xfff1d0, alpha: 0.2 });
  for (const [px, py] of crownWins) lit.rect(px - 1.4, py, 2.8, 7).fill(LIT);
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit);
  return { views: [view], tintables: [g], update: () => (lit.alpha = ctx.night()) };
};

export const SF_LANDMARKS: Record<string, LandmarkFactory> = {
  "sf-golden-gate": goldenGate,
  "sf-pyramid-tower": pyramidTower,
  "sf-glass-tower": glassTower,
  "sf-painted-ladies": paintedLadies,
  "sf-island-prison": islandPrison,
  "sf-coit-tower": coitTower,
};
