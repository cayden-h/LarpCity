// Miami's landmarks, drawn as toy-brick models with animated parts: the Art
// Deco hotel strip with neon trim, swaying palms, the cruise terminal with a
// docked ship, curved Brickell condo towers, and beach lifeguard huts.
// Stylized shapes only: no logos, brand names, or signage.

import { Container, Graphics } from "pixi.js";
import { mix, shade } from "../engine/color";
import { WATER_Z } from "../engine/ground";
import { depthOf, flat, iso, type Pt } from "../engine/iso";
import { rngFor, type Rng } from "../engine/rng";
import { box, layer, line3 } from "../engine/shapes";
import type { LandmarkFactory } from "../engine/types";

type P2 = [number, number];

const LIT = 0xffd47e;
const GLASS = 0x8ec9ea;
const NEON_PINK = 0xff4fa3;
const NEON_TEAL = 0x3ff0e0;

// ------------------------------------------------------------ prism helpers

/** A rounded rectangle footprint in tile space, corners sampled as arcs. */
function roundRect(x: number, y: number, w: number, d: number, r: number, seg = 4): P2[] {
  const pts: P2[] = [];
  const corners: P2[] = [[x + w - r, y + r], [x + w - r, y + d - r], [x + r, y + d - r], [x + r, y + r]];
  corners.forEach(([cx, cy], i) => {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 2;
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  });
  return pts;
}

interface Edge {
  a: P2;
  b: P2;
  len: number;
  /** Face brightness: 0.95 facing +y (left face), 0.74 facing +x (right face). */
  light: number;
}

/** Edges of a convex footprint whose faces point toward the viewer. */
function visibleEdges(pts: P2[]): Edge[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const out: Edge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    let nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (nx + ny <= 1e-6) continue;
    const k = Math.min(1, Math.max(0, (nx - ny + 1) / 2));
    out.push({ a, b, len, light: 0.95 - 0.21 * k });
  }
  return out;
}

const at = (e: Edge, t: number, z: number): Pt => iso(e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t, z);

/** The visible side walls of a convex footprint between z0 and z1. */
function walls(g: Graphics, pts: P2[], z0: number, z1: number, color: number): void {
  for (const e of visibleEdges(pts)) g.poly(flat([at(e, 0, z0), at(e, 1, z0), at(e, 1, z1), at(e, 0, z1)])).fill(shade(color, e.light));
}

function top(g: Graphics, pts: P2[], z: number, color: number): void {
  g.poly(flat(pts.map(([px, py]) => iso(px, py, z)))).fill(color);
}

/** A solid extruded footprint: walls plus a lit top. */
function prism(g: Graphics, pts: P2[], z0: number, z1: number, color: number, lid?: number): void {
  walls(g, pts, z0, z1, color);
  top(g, pts, z1, lid ?? shade(color, 1.1));
}

/** Rows of windows on the straight visible faces; some glow at night. */
function windows(g: Graphics, lit: Graphics, pts: P2[], z0: number, z1: number, fh: number, color: number, rng: Rng, share: number, perTile: number): void {
  for (const e of visibleEdges(pts)) {
    if (e.len < 0.25) continue;
    const n = Math.max(1, Math.floor(e.len * perTile));
    for (let z = z0; z + fh <= z1 + 0.01; z += fh)
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.2) / n, t1 = (i + 0.8) / n;
        const q = flat([at(e, t0, z + fh * 0.28), at(e, t1, z + fh * 0.28), at(e, t1, z + fh * 0.82), at(e, t0, z + fh * 0.82)]);
        g.poly(q).fill(shade(color, e.light + 0.05));
        if (rng() < share) lit.poly(q).fill(LIT);
      }
  }
}

/** A neon tube along the visible faces at height z: pale by day, glowing at night. */
function neonRing(g: Graphics, lit: Graphics, pts: P2[], z: number, color: number): void {
  for (const e of visibleEdges(pts)) {
    const p = at(e, 0, z), q = at(e, 1, z);
    g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 1.6, color: mix(color, 0xffffff, 0.55), cap: "round" });
    lit.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 5, color, alpha: 0.45, cap: "round" });
    lit.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 1.8, color: mix(color, 0xffffff, 0.5), cap: "round" });
  }
}

// ------------------------------------------------------------ deco hotels

const DECO = [
  { wall: 0xf8bbd0, trim: 0x26a69a, neon: NEON_TEAL, h: 66 },
  { wall: 0xb2f0dc, trim: 0xf06292, neon: NEON_PINK, h: 86 },
  { wall: 0xfff1a8, trim: 0x4db6ac, neon: NEON_PINK, h: 58 },
  { wall: 0xb3e5fc, trim: 0xf48fb1, neon: NEON_TEAL, h: 76 },
  { wall: 0xd9c8f0, trim: 0x26a69a, neon: NEON_TEAL, h: 70 },
];

/**
 * A row of pastel Art Deco hotels along a strip (long in y), facing the beach
 * on the +x side: rounded corners, racing stripes, eyebrow ledges, a stepped
 * central fin, and neon trim that glows pink or teal at night.
 */
export const decoHotels: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const count = Math.max(1, Math.round(d / 3));
  const span = d / count;
  const views: Container[] = [];
  const tintables: Container[] = [];
  const lits: Graphics[] = [];
  for (let i = 0; i < count; i++) {
    const s = DECO[i % DECO.length];
    const rng = rngFor("mia-deco", x, y, i);
    const g = new Graphics();
    const lit = new Graphics();
    const hx = x + 0.12, hy = y + i * span + 0.2, hw = w - 0.32, hd = span - 0.4;
    const body = roundRect(hx, hy, hw, hd, 0.35);
    // Terrace plinth and the walls.
    prism(g, roundRect(hx - 0.06, hy - 0.06, hw + 0.24, hd + 0.12, 0.4), 0, 4, 0xf1ebdf);
    walls(g, body, 4, s.h, s.wall);
    // Eyebrow ledges over each floor, windows under them.
    const fh = 14;
    for (let z = 10; z + fh <= s.h - 22; z += fh) walls(g, body, z + fh * 0.84, z + fh * 0.84 + 1.6, shade(s.wall, 0.82));
    windows(g, lit, body, 10, s.h - 22, fh, GLASS, rng, 0.55, 2.2);
    // Racing stripes near the top, and a base band.
    for (let k = 0; k < 3; k++) walls(g, body, s.h - 11 - k * 4.5, s.h - 9 - k * 4.5, s.trim);
    walls(g, body, 4, 7, s.trim);
    // Parapet with an inset roof.
    walls(g, body, s.h, s.h + 3, shade(s.wall, 1.04));
    top(g, body, s.h + 3, shade(s.wall, 1.14));
    top(g, roundRect(hx + 0.1, hy + 0.1, hw - 0.2, hd - 0.2, 0.26), s.h + 3, shade(s.wall, 0.9));
    // Entrance canopy on the beach face.
    box(g, hx + hw - 0.02, hy + hd / 2 - 0.38, 0.22, 0.76, 11, 14, s.trim);
    // Stepped central fin rising above the roof.
    const fx = hx + hw - 0.06, fy = hy + hd / 2 - 0.11;
    box(g, fx, fy, 0.14, 0.22, 16, s.h + 20, 0xffffff);
    box(g, fx + 0.02, fy + 0.04, 0.1, 0.14, s.h + 20, s.h + 30, s.trim);
    // Neon: a band below the parapet and a vertical tube up the fin.
    neonRing(g, lit, body, s.h - 15, s.neon);
    const f0 = iso(fx + 0.14, fy + 0.22, 20), f1 = iso(fx + 0.14, fy + 0.22, s.h + 18);
    g.moveTo(f0.x, f0.y).lineTo(f1.x, f1.y).stroke({ width: 1.6, color: mix(s.neon, 0xffffff, 0.55) });
    lit.moveTo(f0.x, f0.y).lineTo(f1.x, f1.y).stroke({ width: 5, color: s.neon, alpha: 0.45 });
    lit.moveTo(f0.x, f0.y).lineTo(f1.x, f1.y).stroke({ width: 1.8, color: mix(s.neon, 0xffffff, 0.5) });
    lit.alpha = 0;
    lit.blendMode = "add";
    lits.push(lit);
    views.push(layer(depthOf(x + w - 1, Math.floor(hy + hd), 60), g, lit));
    tintables.push(g);
  }
  let t = 0;
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lits.forEach((l, i) => (l.alpha = n * (0.86 + 0.14 * Math.sin(t * 3 + i * 1.7))));
    },
  };
};

// ------------------------------------------------------------ palms

interface Palm {
  bx: number;
  by: number;
  h: number;
  lean: number;
  s: number;
  phase: number;
  fronds: number[];
}

function drawPalm(g: Graphics, p: Palm, t: number, storm: number): void {
  // In a storm the whole crown leans downwind and whips in the gusts.
  const gust = storm * (16 + Math.sin(t * 3.4 + p.phase) * 6 + Math.sin(t * 7.1 + p.phase) * 2);
  const sway = Math.sin(t * 1.1 + p.phase) * 2.2 + Math.sin(t * 2.3 + p.phase * 2) * 0.7 + gust;
  const tip = { x: p.bx + p.lean + sway, y: p.by - p.h };
  const ctl = { x: p.bx + p.lean * 0.15, y: p.by - p.h * 0.5 };
  g.ellipse(p.bx + 7 * p.s, p.by + 1, 13 * p.s, 4.5 * p.s).fill({ color: 0x000000, alpha: 0.12 });
  // Curved, ringed trunk.
  const N = 9;
  let prev = { x: p.bx, y: p.by };
  for (let i = 1; i <= N; i++) {
    const u = i / N, v = 1 - u;
    const q = { x: v * v * p.bx + 2 * v * u * ctl.x + u * u * tip.x, y: v * v * p.by + 2 * v * u * ctl.y + u * u * tip.y };
    g.moveTo(prev.x, prev.y).lineTo(q.x, q.y).stroke({ width: (5.5 - 2.3 * u) * p.s, color: i % 2 ? 0x9c7650 : 0x86623f, cap: "round" });
    prev = q;
  }
  // Fronds: back ones first, then coconuts, then the front ones.
  const order = p.fronds.map((a, i) => ({ a, i })).sort((m, n) => Math.sin(m.a) - Math.sin(n.a));
  const frond = (a: number, i: number) => {
    const len = (21 + (i % 3) * 3) * p.s;
    const wob = Math.sin(t * 2.1 + i + p.phase) * 1.4;
    const ca = Math.cos(a), sa = Math.sin(a);
    const end = { x: tip.x + ca * len * (1 - storm * 0.35) + sway * 0.5 + gust * 0.9, y: tip.y + sa * len * 0.45 + 10 * p.s + wob * (1 + storm * 2) };
    const mid = { x: tip.x + ca * len * 0.55, y: tip.y + sa * len * 0.25 - 4 * p.s };
    const nl = Math.hypot(ca, sa * 0.5) || 1;
    const px = (-sa * 0.5 / nl) * 4.2 * p.s, py = (ca / nl) * 4.2 * p.s;
    g.poly([tip.x, tip.y, mid.x + px, mid.y + py, end.x, end.y, mid.x - px, mid.y - py]).fill(i % 2 ? 0x3fa34d : 0x2f8f3f);
    g.moveTo(tip.x, tip.y).quadraticCurveTo(mid.x, mid.y, end.x, end.y).stroke({ width: 1, color: 0x7fd36f, alpha: 0.8 });
  };
  const back = order.filter((f) => Math.sin(f.a) < 0), front = order.filter((f) => Math.sin(f.a) >= 0);
  for (const f of back) frond(f.a, f.i);
  for (const [dx, dy] of [[-2.5, 3], [2.5, 3.5], [0, 5]] as const) g.circle(tip.x + dx * p.s, tip.y + dy * p.s, 2.3 * p.s).fill(0x6d4c2f);
  g.circle(tip.x, tip.y + 1, 3.5 * p.s).fill(0x2f7d38);
  for (const f of front) frond(f.a, f.i);
}

/** One or two palm trees per footprint tile, swaying in the sea breeze, uplit at night. */
export const palms: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const glow = new Graphics();
  const trees: Palm[] = [];
  for (let j = y; j < y + d; j++)
    for (let i = x; i < x + w; i++) {
      const rng = rngFor("mia-palm", i, j);
      const n = rng() < 0.45 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const base = iso(i + 0.25 + rng() * 0.5, j + 0.25 + rng() * 0.5);
        const s = 0.85 + rng() * 0.3;
        const fronds = Array.from({ length: 8 }, (_, f) => (f / 8) * Math.PI * 2 + rng() * 0.4);
        trees.push({ bx: base.x, by: base.y, h: (54 + rng() * 22) * s, lean: (rng() - 0.5) * 30, s, phase: rng() * 6.28, fronds });
      }
    }
  trees.sort((a, b) => a.by - b.by);
  for (const p of trees) {
    glow.ellipse(p.bx + p.lean * 0.3, p.by - p.h * 0.45, 8 * p.s, p.h * 0.5).fill({ color: 0xffe6b0, alpha: 0.16 });
    glow.ellipse(p.bx, p.by, 12 * p.s, 5 * p.s).fill({ color: 0xffd9a0, alpha: 0.3 });
  }
  const draw = (t: number) => {
    g.clear();
    const storm = ctx.storm();
    for (const p of trees) drawPalm(g, p, t, storm);
  };
  draw(0);
  glow.alpha = 0;
  glow.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 58), glow, g);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      draw(t);
      glow.alpha = ctx.night();
    },
  };
};

// ------------------------------------------------------------ cruise terminal

/**
 * The cruise terminal: a white hall with a glass band and a row of tensile
 * sail roofs, with a cruise ship docked along its north side over the water.
 */
export const cruiseTerminal: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const rng = rngFor("mia-cruise", x, y);
  // Gangways out to the ship (behind the hall, so drawn first).
  for (const gx of [x + 1.3, x + w - 1.6]) line3(g, [gx, y + 0.4, 22], [gx, y - 0.76, 20], 3, 0xbdbdbd);
  box(g, x + 0.05, y + 0.05, w - 0.1, d - 0.1, 0, 3, 0xd6d3cc);
  const hall = roundRect(x + 0.3, y + 0.35, w - 0.6, d - 0.7, 0.3);
  walls(g, hall, 3, 30, 0xf7f7f4);
  walls(g, hall, 11, 25, 0x7fc4e0);
  windows(g, lit, hall, 11, 25, 14, 0x7fc4e0, rng, 0.8, 3);
  top(g, hall, 30, 0xeeeeea);
  // Sail roofs, back to front.
  const n = 4, sw = (w - 0.9) / n;
  const peaks: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const sx0 = x + 0.45 + i * sw, sx1 = sx0 + sw;
    const pz = 62 + (i % 2) * 8;
    const pk = iso(sx0 + sw * 0.35, y + d / 2 - 0.05, pz);
    const bk = iso(sx0, y + 0.45, 30), rt = iso(sx1, y + 0.45, 30), fr = iso(sx1, y + d - 0.45, 30), lf = iso(sx0, y + d - 0.45, 30);
    g.poly([bk.x, bk.y, rt.x, rt.y, pk.x, pk.y]).fill(0xd9d9d6);
    g.poly([bk.x, bk.y, lf.x, lf.y, pk.x, pk.y]).fill(0xf0f0ec);
    g.poly([lf.x, lf.y, fr.x, fr.y, pk.x, pk.y]).fill(0xffffff);
    g.poly([fr.x, fr.y, rt.x, rt.y, pk.x, pk.y]).fill(0xc9cdd0);
    line3(g, [sx0 + sw * 0.35, y + d / 2 - 0.05, 30], [sx0 + sw * 0.35, y + d / 2 - 0.05, pz + 12], 1.5, 0x9ea4a8);
    lit.poly([lf.x, lf.y, fr.x, fr.y, pk.x, pk.y]).fill({ color: i % 2 ? NEON_TEAL : 0xb388ff, alpha: 0.28 });
    peaks.push(iso(sx0 + sw * 0.35, y + d / 2 - 0.05, pz + 12));
  }
  for (const p of peaks) lit.circle(p.x, p.y, 2.4).fill(0xff3b30);
  lit.alpha = 0;
  lit.blendMode = "add";
  const hallView = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit);

  // The ship, bow toward +x, docked just north of the footprint.
  const sg = new Graphics();
  const slit = new Graphics();
  const s0 = x + 0.05, s1 = x + w - 0.05, sy0 = y - 1.45, sy1 = y - 0.75, sm = (sy0 + sy1) / 2;
  const hull: P2[] = [[s0, sy0], [s1 - 0.6, sy0], [s1, sm], [s1 - 0.6, sy1], [s0, sy1]];
  prism(sg, hull, WATER_Z, 2, 0x243f63);
  walls(sg, hull, 2, 16, 0xfafafa);
  windows(sg, slit, hull, 5, 14, 9, 0x2b4a6f, rng, 0.85, 5);
  top(sg, hull, 16, 0xe8e4da);
  const decks: [P2[], number, number][] = [
    [[[s0 + 0.15, sy0 + 0.08], [s1 - 0.9, sy0 + 0.08], [s1 - 0.5, sm], [s1 - 0.9, sy1 - 0.08], [s0 + 0.15, sy1 - 0.08]], 16, 30],
    [[[s0 + 0.3, sy0 + 0.13], [s1 - 1.2, sy0 + 0.13], [s1 - 0.85, sm], [s1 - 1.2, sy1 - 0.13], [s0 + 0.3, sy1 - 0.13]], 30, 40],
    [[[s0 + 0.6, sy0 + 0.18], [s1 - 1.7, sy0 + 0.18], [s1 - 1.4, sm], [s1 - 1.7, sy1 - 0.18], [s0 + 0.6, sy1 - 0.18]], 40, 47],
  ];
  decks.forEach(([pts, z0, z1], k) => {
    walls(sg, pts, z0, z1, 0xffffff);
    windows(sg, slit, pts, z0, z1, (z1 - z0) / (k === 0 ? 2 : 1), k === 2 ? 0x5fa8d3 : 0x7fb8d8, rng, 0.7, 6);
    top(sg, pts, z1, k === 2 ? 0x8fd4c8 : 0xf0ede6);
  });
  // Funnel with a colored band, set back toward the stern.
  const funnel = roundRect(s0 + 0.55, sm - 0.12, 0.45, 0.24, 0.1);
  prism(sg, funnel, 47, 66, 0x2a9fd6, 0x333333);
  walls(sg, funnel, 55, 59, 0xffffff);
  // Deck string lights, alternating pink and teal.
  const rail = visibleEdges(decks[0][0]);
  let k = 0;
  for (const e of rail)
    for (let t = 0; t <= 1; t += 0.12 / e.len) {
      const p = at(e, t, 31);
      slit.circle(p.x, p.y, 1.4).fill(k++ % 2 ? NEON_PINK : NEON_TEAL);
    }
  slit.alpha = 0;
  slit.blendMode = "add";
  const ship = layer(depthOf(Math.floor(s1 - 0.01), Math.floor(sy1), 50), sg, slit);

  let t = 0;
  return {
    views: [ship, hallView],
    tintables: [g, sg],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      slit.alpha = n;
      sg.y = slit.y = Math.sin(t * 0.8) * 0.8;
    },
  };
};

// ------------------------------------------------------------ condo towers

/**
 * Brickell glass condo towers: two or three curved towers on podiums with
 * white balcony stripes on every floor, crown lights, and a red aviation light.
 */
export const condoTowers: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const specs = [
    { fy: 0.12, inset: 0.12, fd: 1.25, h: 330, glass: 0x7fc4e0, crown: NEON_TEAL },
    { fy: 1.55, inset: 0.18, fd: 1.1, h: 262, glass: 0x92d0e6, crown: 0xb388ff },
    { fy: 2.85, inset: 0.22, fd: 0.95, h: 196, glass: 0x86c8df, crown: NEON_PINK },
  ].filter((s) => s.fy + s.fd <= d - 0.05);
  const views: Container[] = [];
  const tintables: Container[] = [];
  const lits: Graphics[] = [];
  const blinkers: Graphics[] = [];
  specs.forEach((s, i) => {
    const g = new Graphics();
    const lit = new Graphics();
    const rng = rngFor("mia-condo", x, y, i);
    const fx = x + s.inset, fw = w - s.inset * 2, fy = y + s.fy;
    prism(g, roundRect(fx - 0.06, fy - 0.06, fw + 0.12, s.fd + 0.12, 0.2), 0, 14, 0xf2efe8);
    const pts = roundRect(fx, fy, fw, s.fd, Math.min(fw, s.fd) * 0.42, 6);
    const glass = mix(s.glass, 0xffffff, 0.08);
    walls(g, pts, 14, s.h, glass);
    windows(g, lit, pts, 17, s.h - 8, 16, shade(glass, 1.06), rng, 0.6, 3);
    for (let z = 30; z < s.h - 6; z += 16) walls(g, pts, z, z + 3, 0xffffff);
    top(g, pts, s.h, 0xf5f5f5);
    // Crown: a narrower white cap with a lit rim.
    const cap = roundRect(fx + 0.14, fy + 0.12, fw - 0.28, s.fd - 0.24, Math.min(fw, s.fd) * 0.3, 6);
    prism(g, cap, s.h, s.h + 12, 0xffffff);
    neonRing(g, lit, pts, s.h - 3, s.crown);
    lit.alpha = 0;
    lit.blendMode = "add";
    lits.push(lit);
    const parts: Container[] = [g, lit];
    if (i === 0) {
      const c = iso(fx + fw / 2, fy + s.fd / 2, s.h + 12);
      g.moveTo(c.x, c.y).lineTo(c.x, c.y - 26).stroke({ width: 2, color: 0xd6dbe1 });
      const blink = new Graphics().circle(c.x, c.y - 27, 2.6).fill(0xff3b30);
      blink.blendMode = "add";
      blinkers.push(blink);
      parts.push(blink);
    }
    views.push(layer(depthOf(x + w - 1, Math.floor(fy + s.fd - 0.01), 60), ...parts));
    tintables.push(g);
  });
  let t = 0;
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      for (const l of lits) l.alpha = n;
      for (const b of blinkers) b.alpha = Math.max(0.15, n) * (0.5 + 0.5 * Math.sin(t * 3));
    },
  };
};

// ------------------------------------------------------------ lifeguard huts

const HUT_COLORS = [0xff8fb1, 0xffe066, 0x5ee0d0, 0xffa94d, 0xb39ddb];

function umbrella(g: Graphics, ux: number, uy: number, color: number): void {
  const base = iso(ux, uy), c = iso(ux, uy, 24);
  g.ellipse(base.x + 4, base.y + 1, 12, 5).fill({ color: 0x000000, alpha: 0.1 });
  box(g, ux + 0.08, uy + 0.05, 0.28, 0.14, 0, 0.6, color);
  g.moveTo(base.x, base.y).lineTo(c.x, c.y).stroke({ width: 1.5, color: 0xf5f5f5 });
  const wedges = Array.from({ length: 8 }, (_, i) => i).sort((a, b) => Math.sin(((a + 0.5) / 8) * Math.PI * 2) - Math.sin(((b + 0.5) / 8) * Math.PI * 2));
  for (const i of wedges) {
    const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
    g.poly([c.x, c.y - 4, c.x + Math.cos(a0) * 14, c.y + 3 + Math.sin(a0) * 7, c.x + Math.cos(a1) * 14, c.y + 3 + Math.sin(a1) * 7]).fill(i % 2 ? color : 0xffffff);
  }
}

/**
 * Colorful lifeguard huts on stilts along a strip of beach (long in y), each
 * with a ramp to the sand, a waving flag, and a striped umbrella nearby.
 */
export const lifeguardTowers: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const views: Container[] = [];
  const tintables: Container[] = [];
  const flags: { g: Graphics; pole: Pt; phase: number }[] = [];
  const lamps: Graphics[] = [];
  const cx = x + w / 2;
  let k = 0;
  for (let j = y + 1; j < y + d; j += 6, k++) {
    const cy = j + 0.5;
    const c = HUT_COLORS[k % HUT_COLORS.length];
    const roof = HUT_COLORS[(k + 2) % HUT_COLORS.length];
    const g = new Graphics();
    const flag = new Graphics();
    const lamp = new Graphics();
    g.ellipse(iso(cx, cy).x + 6, iso(cx, cy).y + 2, 20, 8).fill({ color: 0x000000, alpha: 0.1 });
    // Stilts, back legs first, with a cross brace.
    for (const [dx, dy] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]] as const) line3(g, [cx + dx, cy + dy, 0], [cx + dx * 0.85, cy + dy * 0.85, 17], 2.4, 0xe8e2d4);
    line3(g, [cx - 0.18, cy + 0.18, 2], [cx + 0.16, cy + 0.16, 15], 1.4, 0xd7cfbd);
    // Ramp down to the sand on the ocean side.
    line3(g, [cx + 0.2, cy + 0.05, 17], [cx + 0.48, cy + 0.05, 0], 4, 0xd7c9a8);
    box(g, cx - 0.25, cy - 0.25, 0.5, 0.5, 16, 19, 0xf4f1ea);
    box(g, cx - 0.17, cy - 0.17, 0.34, 0.34, 19, 34, c);
    // A white stripe on the front face and a window toward the ocean.
    const st = [iso(cx - 0.17, cy + 0.17, 26), iso(cx + 0.17, cy + 0.17, 26), iso(cx + 0.17, cy + 0.17, 28.5), iso(cx - 0.17, cy + 0.17, 28.5)];
    g.poly(flat(st)).fill(0xffffff);
    const win = flat([iso(cx + 0.17, cy - 0.1, 23), iso(cx + 0.17, cy + 0.1, 23), iso(cx + 0.17, cy + 0.1, 31), iso(cx + 0.17, cy - 0.1, 31)]);
    g.poly(win).fill(GLASS);
    lamp.poly(win).fill(LIT);
    // Hip roof with an overhang.
    const T = iso(cx - 0.24, cy - 0.24, 34), R = iso(cx + 0.24, cy - 0.24, 34), B = iso(cx + 0.24, cy + 0.24, 34), L = iso(cx - 0.24, cy + 0.24, 34), A = iso(cx, cy, 43);
    g.poly([T.x, T.y, R.x, R.y, A.x, A.y]).fill(shade(roof, 0.8));
    g.poly([T.x, T.y, L.x, L.y, A.x, A.y]).fill(shade(roof, 0.9));
    g.poly([L.x, L.y, B.x, B.y, A.x, A.y]).fill(shade(roof, 1.05));
    g.poly([B.x, B.y, R.x, R.y, A.x, A.y]).fill(shade(roof, 0.75));
    const pole = iso(cx, cy, 58);
    g.moveTo(A.x, A.y).lineTo(pole.x, pole.y).stroke({ width: 1.3, color: 0x777777 });
    lamp.alpha = 0;
    lamp.blendMode = "add";
    flags.push({ g: flag, pole, phase: k * 1.3 });
    lamps.push(lamp);
    views.push(layer(depthOf(Math.floor(cx), j, 55), g, flag, lamp));
    tintables.push(g, flag);
    if (j + 2 < y + d) {
      const u = new Graphics();
      umbrella(u, x + 0.35, j + 2.45, HUT_COLORS[(k + 1) % HUT_COLORS.length]);
      views.push(layer(depthOf(x, j + 2, 52), u));
      tintables.push(u);
    }
  }
  let t = 0;
  const wave = () => {
    for (const f of flags) {
      const a = Math.sin(t * 5 + f.phase) * 1.8, b = Math.sin(t * 5 + f.phase + 1) * 1.8;
      const { x: px, y: py } = f.pole;
      f.g.clear();
      f.g.poly([px, py, px + 7, py + 0.5 + a * 0.5, px + 14, py + 1 + b, px + 14, py + 8 + b, px + 7, py + 7.5 + a * 0.5, px, py + 7]).fill(0xe53935);
      f.g.poly([px + 7, py + 0.5 + a * 0.5, px + 14, py + 1 + b, px + 14, py + 8 + b, px + 7, py + 7.5 + a * 0.5]).fill(0xffd600);
    }
  };
  wave();
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      wave();
      const n = ctx.night();
      for (const l of lamps) l.alpha = n;
    },
  };
};

export const MIAMI_LANDMARKS: Record<string, LandmarkFactory> = {
  "mia-deco-hotels": decoHotels,
  "mia-palms": palms,
  "mia-cruise-terminal": cruiseTerminal,
  "mia-condo-towers": condoTowers,
  "mia-lifeguard-towers": lifeguardTowers,
};
