// New York's landmarks, drawn as toy-brick models with animated parts.
// Stylized shapes only: no logos or real signage.

import { Container, Graphics } from "pixi.js";
import { mix, shade } from "../engine/color";
import { BRIDGE_Z, WATER_Z } from "../engine/ground";
import { depthOf, flat, iso, type Pt } from "../engine/iso";
import { box, cone, cylinder, layer, line3 } from "../engine/shapes";
import type { LandmarkFactory } from "../engine/types";

const GLASS = 0x6f8fa8;
const LIT = 0xffd47e;

/** Deterministic "is this window lit" pick so the pattern never flickers. */
const litPick = (a: number, b: number, c: number, share: number) => ((a * 73 + b * 37 + c * 11) % 100) / 100 < share;

/**
 * Rows of windows on the two visible faces of a box: the left face runs along
 * y = y0 + d, the right face along x = x0 + w. Dark glass by day on `g`, warm
 * lit panes on `lit` for the night layer.
 */
function faceWindows(g: Graphics, lit: Graphics, x0: number, y0: number, w: number, d: number, z0: number, z1: number, step = 12, perTile = 3, share = 0.55): void {
  let row = 0;
  for (let z = z0 + 4; z + 7 < z1; z += step, row++) {
    for (const side of ["left", "right"] as const) {
      const span = side === "left" ? w : d;
      const n = Math.max(1, Math.round(span * perTile));
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.25) / n, t1 = (i + 0.75) / n;
        const at = (t: number, zz: number): Pt => (side === "left" ? iso(x0 + t * w, y0 + d, zz) : iso(x0 + w, y0 + d - t * d, zz));
        const q = [at(t0, z), at(t1, z), at(t1, z + 7), at(t0, z + 7)];
        g.poly(flat(q)).fill(side === "left" ? GLASS : shade(GLASS, 0.8));
        if (litPick(row, i, side === "left" ? 1 : 2, share)) lit.poly(flat(q)).fill(LIT);
      }
    }
  }
}

/** Centered square tier of half-width hw around (cx, cy). */
function tier(g: Graphics, cx: number, cy: number, hw: number, z0: number, z1: number, color: number): void {
  box(g, cx - hw, cy - hw, hw * 2, hw * 2, z0, z1, color);
}

/** Vertical Art Deco piers on the visible faces of a tier. */
function piers(g: Graphics, cx: number, cy: number, hw: number, z0: number, z1: number, color: number, n = 4): void {
  for (let i = 1; i < n; i++) {
    const t = -hw + (2 * hw * i) / n;
    line3(g, [cx + t, cy + hw + 0.01, z0], [cx + t, cy + hw + 0.01, z1], 1.6, shade(color, 1.12));
    line3(g, [cx + hw + 0.01, cy + t, z0], [cx + hw + 0.01, cy + t, z1], 1.6, shade(color, 0.9));
  }
}

/** Empire-style stepped Art Deco tower: setbacks, a mooring mast, and a crown that changes color at night. */
export const decoSpire: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const crown = new Graphics();
  const blink = new Graphics();
  const stone = 0xd9cdb4;
  const cx = x + w / 2, cy = y + d / 2;
  const tiers: [number, number, number][] = [
    [0.9, 0, 70],
    [0.72, 70, 210],
    [0.55, 210, 270],
    [0.4, 270, 300],
    [0.26, 300, 320],
  ];
  tiers.forEach(([hw, z0, z1], i) => {
    const c = shade(stone, 1 - i * 0.02);
    tier(g, cx, cy, hw, z0, z1, c);
    faceWindows(g, lit, cx - hw, cy - hw, hw * 2, hw * 2, z0, z1, 12, i < 2 ? 4 : 3, 0.5);
    piers(g, cx, cy, hw, z0 + 4, z1 - 2, c, i < 2 ? 5 : 3);
    box(g, cx - hw - 0.03, cy - hw - 0.03, hw * 2 + 0.06, hw * 2 + 0.06, z1 - 3, z1, shade(c, 0.88));
  });
  // Floodlit crown bands on the top tiers, drawn white and tinted in update.
  for (const [hw, , z1] of tiers.slice(2)) {
    const a = iso(cx - hw, cy + hw, z1 + 1), b = iso(cx + hw, cy + hw, z1 + 1), c = iso(cx + hw, cy - hw, z1 + 1);
    for (const k of [0, 8, 16]) {
      crown.moveTo(a.x, a.y + k).lineTo(b.x, b.y + k).lineTo(c.x, c.y + k).stroke({ width: 5, color: 0xffffff, alpha: 1 - k / 24 });
    }
  }
  // Mooring mast and needle.
  cylinder(g, cx, cy, 6, 320, 350, 0xcfd8dc);
  cylinder(g, cx, cy, 4, 350, 368, 0xb0bec5);
  cone(g, cx, cy, 4, 368, 10, 0xb0bec5);
  line3(g, [cx, cy, 376], [cx, cy, 420], 2, 0xd6dbe1);
  const tip = iso(cx, cy, 421);
  blink.circle(tip.x, tip.y, 3).fill(0xff3b30);
  for (const b of [lit, crown, blink]) {
    b.alpha = 0;
    b.blendMode = "add";
  }
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit, crown, blink);
  const colors = [0xff4d4d, 0xffffff, 0x4d7dff, 0x5cff9d, 0xffc24d, 0xc07dff];
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      const phase = t / 4;
      const k = Math.floor(phase) % colors.length;
      crown.tint = mix(colors[k], colors[(k + 1) % colors.length], Math.max(0, (phase % 1) * 4 - 3));
      crown.alpha = n * 0.9;
      blink.alpha = n * (Math.sin(t * 3) > 0.3 ? 1 : 0.15);
    },
  };
};

/** Chrysler-like tower: slim brick shaft, a stepped steel crown of arches with triangular windows, and a needle. */
export const sunburstSpire: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const crownLit = new Graphics();
  const brick = 0xe6e1d6;
  const steel = 0xcfd8dc;
  const cx = x + w / 2, cy = y + d / 2;
  tier(g, cx, cy, 0.85, 0, 50, 0xd8d2c4);
  faceWindows(g, lit, cx - 0.85, cy - 0.85, 1.7, 1.7, 0, 50, 12, 4, 0.6);
  tier(g, cx, cy, 0.62, 50, 250, brick);
  faceWindows(g, lit, cx - 0.62, cy - 0.62, 1.24, 1.24, 50, 250, 12, 3, 0.5);
  // Dark decorative bands with steel corner ornaments.
  for (const z of [60, 150, 246]) box(g, cx - 0.64, cy - 0.64, 1.28, 1.28, z, z + 4, 0x455a64);
  for (const [dx, dy] of [[0.62, 0.62], [-0.62, 0.62], [0.62, -0.62]] as const) {
    const p = iso(cx + dx, cy + dy, 252);
    g.poly([p.x - 4, p.y, p.x + 4, p.y, p.x, p.y - 9]).fill(steel);
  }
  // Stepped crown: each ring is a short box with arches rising on both visible faces.
  let z = 250;
  for (let k = 0; k < 5; k++) {
    const hw = 0.5 - k * 0.09;
    const archH = 18 - k * 1.5;
    tier(g, cx, cy, hw, z, z + 6, steel);
    const faces: [Pt, Pt, number][] = [
      [iso(cx - hw, cy + hw, z + 6), iso(cx + hw, cy + hw, z + 6), 1.05],
      [iso(cx + hw, cy + hw, z + 6), iso(cx + hw, cy - hw, z + 6), 0.78],
    ];
    for (const [a, b, s] of faces) {
      const pts: number[] = [a.x, a.y];
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        const px = a.x + (b.x - a.x) * u, py = a.y + (b.y - a.y) * u;
        pts.push(px, py - Math.sin(Math.PI * u) * archH);
      }
      pts.push(b.x, b.y);
      g.poly(pts).fill(shade(steel, s));
      g.poly(pts).stroke({ width: 1, color: shade(steel, 0.6), alpha: 0.6 });
      // Triangular windows set into the arch.
      for (const u of [0.3, 0.5, 0.7]) {
        const px = a.x + (b.x - a.x) * u, py = a.y + (b.y - a.y) * u;
        const hgt = Math.sin(Math.PI * u) * archH * 0.6;
        const tri = [px - 2, py - 2, px + 2, py - 2, px, py - 2 - hgt];
        g.poly(tri).fill(0x37474f);
        crownLit.poly(tri).fill(0xfff6d8);
      }
    }
    z += 6 + archH * 0.7;
  }
  cone(g, cx, cy, 5, z, 26, steel);
  line3(g, [cx, cy, z + 24], [cx, cy, z + 80], 2, 0xeceff1);
  for (const b of [lit, crownLit]) {
    b.alpha = 0;
    b.blendMode = "add";
  }
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit, crownLit);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      crownLit.alpha = n * (0.85 + 0.15 * Math.sin(t * 2));
    },
  };
};

/** One WTC-like tower: a square base twisting into a smaller rotated top, eight glass facets, and a spire. */
export const glassTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const beacon = new Graphics();
  const cx = x + w / 2, cy = y + d / 2;
  const glass = 0x7fb2d9;
  const zb = 34, zt = 380;
  // Podium.
  tier(g, cx, cy, 0.88, 0, zb, 0xb0bcc6);
  faceWindows(g, lit, cx - 0.88, cy - 0.88, 1.76, 1.76, 0, zb, 10, 4, 0.8);
  const s = 0.8, r = 0.52;
  const bot: [number, number][] = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];
  const top: [number, number][] = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
  type Facet = { pts: [number, number, number][]; up: boolean };
  const facets: Facet[] = [];
  for (let i = 0; i < 4; i++) {
    const b0 = bot[i], b1 = bot[(i + 1) % 4];
    // Upward triangle: a bottom edge and the top corner facing it.
    const tc = top[i];
    facets.push({ pts: [[b0[0], b0[1], zb], [b1[0], b1[1], zb], [tc[0], tc[1], zt]], up: true });
    // Downward triangle: a top edge and the bottom corner under it.
    const t0 = top[i], t1 = top[(i + 1) % 4];
    const bc = bot[(i + 1) % 4];
    facets.push({ pts: [[t0[0], t0[1], zt], [t1[0], t1[1], zt], [bc[0], bc[1], zb]], up: false });
  }
  const visible = facets
    .map((f) => {
      const mx = f.pts.reduce((a, p) => a + p[0], 0) / 3 - cx;
      const my = f.pts.reduce((a, p) => a + p[1], 0) / 3 - cy;
      return { f, mx, my };
    })
    .filter(({ mx, my }) => mx + my > 0.001)
    .sort((a, b) => a.mx + a.my - (b.mx + b.my));
  for (const { f, mx, my } of visible) {
    const len = Math.hypot(mx, my) || 1;
    const c = shade(glass, 0.86 + 0.16 * ((my - mx) / len));
    const pts = f.pts.map(([px, py, pz]) => iso(px, py, pz));
    g.poly(flat(pts)).fill(c);
    // Floor bands: segments that shrink toward the apex of each facet.
    const [p0, p1, p2] = f.up ? [pts[0], pts[1], pts[2]] : [pts[2], pts[0], pts[1]];
    for (let k = 1; k < 26; k++) {
      const u = k / 26;
      const a = { x: p0.x + (p2.x - p0.x) * u, y: p0.y + (p2.y - p0.y) * u };
      const b = { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u };
      if (!f.up) {
        a.x = p0.x + (p1.x - p0.x) * u; a.y = p0.y + (p1.y - p0.y) * u;
        b.x = p0.x + (p2.x - p0.x) * u; b.y = p0.y + (p2.y - p0.y) * u;
      }
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: 0xffffff, alpha: 0.18 });
      if (litPick(k, Math.round(mx * 10), Math.round(my * 10) + 5, 0.55)) lit.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.6, color: LIT });
    }
    g.poly(flat(pts)).stroke({ width: 1, color: 0xe3f2fd, alpha: 0.5 });
  }
  // Roof parapet and spire.
  const roof = top.map(([px, py]) => iso(px, py, zt));
  g.poly(flat(roof)).fill(0xcfd8dc);
  cylinder(g, cx, cy, 5, zt, zt + 10, 0xb0bec5);
  line3(g, [cx, cy, zt + 10], [cx, cy, zt + 96], 2.5, 0xeceff1);
  for (let k = 1; k < 5; k++) line3(g, [cx - 0.05, cy, zt + 10 + k * 16], [cx + 0.05, cy, zt + 10 + k * 16], 1, 0x90a4ae);
  const tip = iso(cx, cy, zt + 98);
  beacon.circle(tip.x, tip.y, 3).fill(0xffffff);
  beacon.circle(tip.x, tip.y, 8).fill({ color: 0xe3f2fd, alpha: 0.35 });
  for (const b of [lit, beacon]) {
    b.alpha = 0;
    b.blendMode = "add";
  }
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit, beacon);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      beacon.alpha = n * (0.6 + 0.4 * Math.sin(t * 1.5));
    },
  };
};

/** Flatiron-like wedge: a triangular limestone block with its prow toward the viewer. */
export const flatiron: LandmarkFactory = ({ x, y }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const stone = 0xe8dcc2;
  const H = 170;
  const P: [number, number] = [x + 1.85, y + 1.85];
  const A: [number, number] = [x + 0.15, y + 0.95];
  const B: [number, number] = [x + 0.95, y + 0.15];
  // Two front faces meeting at the prow.
  const faces: [[number, number], [number, number], number][] = [
    [A, P, 0.97],
    [P, B, 0.76],
  ];
  for (const [a, b, s] of faces) {
    const q = [iso(a[0], a[1], 0), iso(b[0], b[1], 0), iso(b[0], b[1], H), iso(a[0], a[1], H)];
    g.poly(flat(q)).fill(shade(stone, s));
    // Rusticated base and window rows.
    const base = [iso(a[0], a[1], 0), iso(b[0], b[1], 0), iso(b[0], b[1], 18), iso(a[0], a[1], 18)];
    g.poly(flat(base)).fill(shade(0xc9b79c, s));
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.round(span * 4);
    let row = 0;
    for (let z = 24; z + 8 < H - 10; z += 11, row++) {
      for (let i = 0; i < n; i++) {
        const u0 = (i + 0.28) / n, u1 = (i + 0.72) / n;
        const at = (u: number, zz: number) => iso(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, zz);
        const win = [at(u0, z), at(u1, z), at(u1, z + 7), at(u0, z + 7)];
        g.poly(flat(win)).fill(shade(GLASS, s));
        if (litPick(row, i, s > 0.9 ? 3 : 4, 0.55)) lit.poly(flat(win)).fill(LIT);
      }
    }
    // Terracotta cornice.
    const cq = [iso(a[0], a[1], H - 8), iso(b[0], b[1], H - 8), iso(b[0], b[1], H), iso(a[0], a[1], H)];
    g.poly(flat(cq)).fill(shade(0xc98b5e, s));
  }
  // Rounded prow column and the roof.
  const pb = iso(P[0], P[1], 0), pt = iso(P[0], P[1], H);
  g.rect(pb.x - 2, pt.y, 4, pb.y - pt.y).fill(shade(stone, 1.06));
  g.poly(flat([iso(A[0], A[1], H), iso(P[0], P[1], H), iso(B[0], B[1], H)])).fill(0x8d6e63);
  g.poly(flat([iso(A[0], A[1], H), iso(P[0], P[1], H), iso(B[0], B[1], H)])).stroke({ width: 2, color: 0xc98b5e });
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + 1, y + 1, 60), g, lit);
  return { views: [view], tintables: [g], update: () => (lit.alpha = ctx.night()) };
};

/**
 * Brooklyn-like suspension bridge over the deck row: two stone towers with
 * pointed gothic arches, drooping main cables with suspenders and diagonal
 * stays, and a necklace of lights at night. The back cables sit behind cars,
 * the front cables in front of them.
 */
export const stoneBridge: LandmarkFactory = ({ x, y, w }, ctx) => {
  const back = new Graphics();
  const front = new Graphics();
  const lights = new Graphics();
  const stone = 0xc9b391;
  const sides = [y + 0.1, y + 0.9];
  const towerX = [x + 0.6, x + w - 0.6];
  const topZ = 118, cableTop = 112, sag = 78;
  const cableZ = (px: number): number => {
    const [t0, t1] = towerX;
    if (px <= t0) return BRIDGE_Z + 6 + ((px - x) / (t0 - x)) * (cableTop - BRIDGE_Z - 6);
    if (px >= t1) return BRIDGE_Z + 6 + ((x + w - px) / (x + w - t1)) * (cableTop - BRIDGE_Z - 6);
    const u = (px - t0) / (t1 - t0);
    return cableTop - sag * 4 * u * (1 - u);
  };
  const views: Container[] = [];
  const tintables: Container[] = [];
  sides.forEach((sy, si) => {
    const g = si === 0 ? back : front;
    const col = si === 0 ? 0x8d8d8d : 0x6e6e6e;
    // Diagonal stays fanning from each tower top down to the deck.
    for (const tx of towerX)
      for (const k of [-3, -2, -1, 1, 2, 3]) {
        const ex = tx + k * 0.16;
        if (ex < x || ex > x + w) continue;
        line3(g, [tx, sy, cableTop - 4], [ex, sy, BRIDGE_Z + 5], 0.8, 0xbdbdbd, 0.85);
      }
    // Vertical suspenders.
    for (let px = x + 0.08; px < x + w; px += 0.12) line3(g, [px, sy, cableZ(px)], [px, sy, BRIDGE_Z + 5], 0.7, 0xa8a8a8, 0.8);
    // Main cable.
    const p0 = iso(x, sy, cableZ(x));
    g.moveTo(p0.x, p0.y);
    for (let px = x; px <= x + w + 0.001; px += 0.05) {
      const p = iso(px, sy, cableZ(px));
      g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 2.2, color: col });
    for (let px = x + 0.1; px < x + w; px += 0.2) {
      const p = iso(px, sy, cableZ(px));
      lights.circle(p.x, p.y, 1.5).fill(0xfff1b8);
    }
  });
  views.push(layer(depthOf(x, y, 0), back));
  tintables.push(back);
  // Stone towers straddling the deck, with two pointed arches on the river-facing face.
  towerX.forEach((tx) => {
    const g = new Graphics();
    const x0 = tx - 0.16, x1 = tx + 0.16;
    box(g, x0, y - 0.02, x1 - x0, 1.04, WATER_Z, topZ, stone);
    for (const z of [BRIDGE_Z - 2, 90, topZ - 6]) box(g, x0 - 0.02, y - 0.04, x1 - x0 + 0.04, 1.08, z, z + 5, shade(stone, 0.9));
    // Pointed arches on the east (+x) face, where the road runs through.
    for (const c of [y + 0.28, y + 0.72]) {
      const hw = 0.13, z0 = BRIDGE_Z, zs = 64, zp = 84;
      const pts: Pt[] = [iso(x1 + 0.005, c + hw, z0), iso(x1 + 0.005, c + hw, zs)];
      for (let k = 1; k <= 6; k++) {
        const u = k / 6;
        pts.push(iso(x1 + 0.005, c + hw * (1 - u), zs + (zp - zs) * Math.sin((u * Math.PI) / 2)));
      }
      for (let k = 1; k <= 6; k++) {
        const u = k / 6;
        pts.push(iso(x1 + 0.005, c - hw * u, zp - (zp - zs) * (1 - Math.cos((u * Math.PI) / 2))));
      }
      pts.push(iso(x1 + 0.005, c - hw, z0));
      g.poly(flat(pts)).fill(0x5d5345);
    }
    // Same arches as shallow recesses on the south face.
    const pa = [iso(x0 + 0.06, y + 1.025, 70), iso(x1 - 0.06, y + 1.025, 70), iso(x1 - 0.06, y + 1.025, 96), iso(tx, y + 1.025, 108), iso(x0 + 0.06, y + 1.025, 96)];
    g.poly(flat(pa)).fill(shade(stone, 0.8));
    const top = iso(tx, y + 0.5, topZ + 2);
    lights.circle(top.x, top.y, 2.5).fill(0xff3b30);
    views.push(layer((tx + y + 0.5) * 100 + 72, g));
    tintables.push(g);
  });
  views.push(layer(depthOf(x + w, y + 1, 50), front));
  tintables.push(front);
  // Deck lights along both edges.
  for (let k = 0; k <= w * 4; k++)
    for (const sy of sides) {
      const p = iso(x + k / 4, sy, BRIDGE_Z + 6);
      lights.circle(p.x, p.y, 1.4).fill(0xffe082);
    }
  lights.alpha = 0;
  lights.blendMode = "add";
  views.push(layer(depthOf(x + w, y + 1, 55), lights));
  let t = 0;
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      lights.alpha = ctx.night() * (0.85 + 0.15 * Math.sin(t * 2.5));
    },
  };
};

/** Green copper statue on a star-shaped fort and a granite pedestal, torch glowing at night. */
export const statue: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const flame = new Graphics();
  const glow = new Graphics();
  const cx = x + w / 2, cy = y + d / 2;
  // Trees around the island edge, behind the fort first.
  const trees: [number, number][] = [[x + 0.25, y + 0.3], [x + 1.75, y + 0.25], [x + 0.2, y + 1.7], [x + 1.8, y + 1.75]];
  const drawTree = ([tx, ty]: [number, number]) => {
    const p = iso(tx, ty, 0);
    g.rect(p.x - 1.5, p.y - 8, 3, 8).fill(0x7a5035);
    g.roundRect(p.x - 9, p.y - 22, 18, 15, 6).fill(0x3f8f3a);
    g.roundRect(p.x - 6, p.y - 27, 12, 9, 5).fill(0x5fae4f);
  };
  trees.slice(0, 2).forEach(drawTree);
  // Eleven-point star fort as a low stone ring.
  const star: Pt[] = [];
  const top: Pt[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const rr = i % 2 === 0 ? 0.78 : 0.58;
    star.push(iso(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0));
    top.push(iso(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 10));
  }
  for (let i = 0; i < 22; i++) {
    const j = (i + 1) % 22;
    const q = [star[i], star[j], top[j], top[i]];
    if (star[i].y + star[j].y > 2 * iso(cx, cy, 0).y) g.poly(flat(q)).fill(0xa89c82);
  }
  g.poly(flat(top)).fill(0xc2b79b);
  // Stepped granite pedestal.
  box(g, cx - 0.36, cy - 0.36, 0.72, 0.72, 10, 22, 0xb8ab8e);
  box(g, cx - 0.28, cy - 0.28, 0.56, 0.56, 22, 64, 0xcdbf9f);
  for (const z of [34, 48]) {
    const q = [iso(cx - 0.12, cy + 0.285, z), iso(cx + 0.12, cy + 0.285, z), iso(cx + 0.12, cy + 0.285, z + 10), iso(cx - 0.12, cy + 0.285, z + 10)];
    g.poly(flat(q)).fill(0x9e9076);
  }
  box(g, cx - 0.32, cy - 0.32, 0.64, 0.64, 64, 70, 0xb8ab8e);
  box(g, cx - 0.2, cy - 0.2, 0.4, 0.4, 70, 76, 0xcdbf9f);
  // The copper figure, drawn in screen space above the pedestal.
  const copper = 0x5fae8f;
  const c = iso(cx, cy, 76);
  g.poly([c.x - 8, c.y, c.x + 8, c.y, c.x + 5, c.y - 44, c.x - 5, c.y - 44]).fill(shade(copper, 0.92));
  g.poly([c.x - 8, c.y, c.x - 1, c.y, c.x - 2, c.y - 44, c.x - 5, c.y - 44]).fill(shade(copper, 1.1));
  for (const dx of [-4, 0, 4]) g.moveTo(c.x + dx, c.y - 2).lineTo(c.x + dx * 0.6, c.y - 36).stroke({ width: 1, color: shade(copper, 0.72), alpha: 0.7 });
  // Tablet held in the left arm.
  g.poly([c.x - 9, c.y - 26, c.x - 3, c.y - 29, c.x - 3, c.y - 17, c.x - 9, c.y - 14]).fill(shade(copper, 0.8));
  // Head and crown rays.
  g.circle(c.x, c.y - 49, 4.5).fill(shade(copper, 1.05));
  for (let k = 0; k < 7; k++) {
    const a = Math.PI + (k / 6) * Math.PI;
    const bx = c.x + Math.cos(a) * 4, by = c.y - 51 + Math.sin(a) * 4;
    g.poly([bx - 1, by, bx + 1, by, c.x + Math.cos(a) * 9, c.y - 51 + Math.sin(a) * 9]).fill(shade(copper, 1.15));
  }
  // Raised right arm and torch.
  g.moveTo(c.x + 4, c.y - 40).lineTo(c.x + 8, c.y - 66).stroke({ width: 4, color: shade(copper, 0.95), cap: "round" });
  g.poly([c.x + 5, c.y - 70, c.x + 11, c.y - 70, c.x + 9.5, c.y - 66, c.x + 6.5, c.y - 66]).fill(shade(copper, 1.1));
  const torch = { x: c.x + 8, y: c.y - 72 };
  trees.slice(2).forEach(drawTree);
  glow.blendMode = "add";
  glow.alpha = 0;
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, flame, glow);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      const f = 1 + 0.15 * Math.sin(t * 11) + 0.1 * Math.sin(t * 6.7);
      flame.clear();
      flame.ellipse(torch.x, torch.y - 3 * f, 3 * f, 5 * f).fill(0xf2b134);
      flame.ellipse(torch.x, torch.y - 2 * f, 1.5 * f, 3 * f).fill(0xfff176);
      glow.clear();
      glow.circle(torch.x, torch.y - 3, 14 * f).fill({ color: 0xffb74d, alpha: 0.35 });
      glow.circle(torch.x, torch.y - 3, 6 * f).fill({ color: 0xfff3c4, alpha: 0.8 });
      glow.ellipse(c.x, c.y - 30, 18, 42).fill({ color: 0xcff5e6, alpha: 0.12 });
      glow.alpha = n;
    },
  };
};

export const NY_LANDMARKS: Record<string, LandmarkFactory> = {
  "ny-deco-spire": decoSpire,
  "ny-sunburst-spire": sunburstSpire,
  "ny-glass-tower": glassTower,
  "ny-flatiron": flatiron,
  "ny-stone-bridge": stoneBridge,
  "ny-statue": statue,
};
