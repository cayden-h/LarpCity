// Reusable "state signature" landmarks for river, coast, and heartland states:
// a paddle-wheel riverboat, a neon casino strip, a boardwalk ferris wheel, a
// fishing harbor, a music row, a monument obelisk, and a seasonal orchard.
// Toy-brick look: lit tops, shaded sides, studs. Stylized shapes only: no
// logos, brand names, or text. Static geometry is built once; animation only
// moves, rotates, scales, or fades small child objects.

import { Container, Graphics } from "pixi.js";
import type { Season } from "../../engine/clock";
import { mix, shade } from "../../engine/color";
import { WATER_Z } from "../../engine/ground";
import { HALF_H, HALF_W, depthOf, flat, iso, type Pt } from "../../engine/iso";
import { rngFor, type Rng } from "../../engine/rng";
import { box, cone, cylinder, layer, line3 } from "../../engine/shapes";
import type { LandmarkFactory } from "../../engine/types";

type P2 = [number, number];

const LIT = 0xffd47e;
const GLASS = 0x8ec9ea;
const WATER = 0x3d8fd1;
/** Skew that maps a local x axis onto the world +x tile direction (the x-z plane). */
const PLANE_X_SKEW = Math.atan2(HALF_H, HALF_W);

// ------------------------------------------------------------ helpers

/** A container whose local x runs along world +x and local y runs down in z. */
function planeX(cx: number, cy: number, z: number): Container {
  const c = new Container();
  const p = iso(cx, cy, z);
  c.position.set(p.x, p.y);
  c.skew.y = PLANE_X_SKEW;
  return c;
}

function quadY(x0: number, x1: number, yf: number, z0: number, z1: number): number[] {
  return flat([iso(x0, yf, z0), iso(x1, yf, z0), iso(x1, yf, z1), iso(x0, yf, z1)]);
}

function quadX(xf: number, y0: number, y1: number, z0: number, z1: number): number[] {
  return flat([iso(xf, y0, z0), iso(xf, y1, z0), iso(xf, y1, z1), iso(xf, y0, z1)]);
}

/** A small toy stud standing on a flat top at tile point (tx, ty). */
function stud(g: Graphics, tx: number, ty: number, z: number, base: number): void {
  const p = iso(tx, ty, z);
  g.ellipse(p.x, p.y + 1.4, 4.2, 2.2).fill(shade(base, 0.72));
  g.rect(p.x - 4.2, p.y - 0.4, 8.4, 1.8).fill(shade(base, 0.84));
  g.ellipse(p.x, p.y - 0.4, 4.2, 2.2).fill(shade(base, 1.14));
}

/** Studs on a grid across a flat rectangle top. */
function studGrid(g: Graphics, x0: number, y0: number, w: number, d: number, z: number, base: number, step = 0.5): void {
  const nx = Math.max(1, Math.floor(w / step)), ny = Math.max(1, Math.floor(d / step));
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) stud(g, x0 + ((i + 0.5) * w) / nx, y0 + ((j + 0.5) * d) / ny, z, base);
}

/** A glowing bulb: soft halo plus a bright core (for additive layers). */
function bulb(g: Graphics, p: Pt, r: number, color: number): void {
  g.circle(p.x, p.y, r * 2.4).fill({ color, alpha: 0.28 });
  g.circle(p.x, p.y, r).fill(mix(color, 0xffffff, 0.45));
}

/** A glowing tube between two screen points (for additive layers). */
function tube(g: Graphics, a: Pt, b: Pt, color: number, width = 1.8): void {
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 2.8, color, alpha: 0.4, cap: "round" });
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color: mix(color, 0xffffff, 0.5), cap: "round" });
}

/** Rows of windows on the two visible faces of a box; some light up at night. */
function boxWindows(
  g: Graphics,
  lit: Graphics,
  bx: number,
  by: number,
  bw: number,
  bd: number,
  z0: number,
  z1: number,
  fh: number,
  perTile: number,
  color: number,
  rng: Rng,
  share: number,
): void {
  const faces: [number, boolean][] = [[bw, true], [bd, false]];
  for (const [len, front] of faces) {
    const n = Math.max(1, Math.floor(len * perTile));
    for (let z = z0; z + fh <= z1 + 0.01; z += fh)
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.22) / n, t1 = (i + 0.78) / n;
        const za = z + fh * 0.25, zb = z + fh * 0.8;
        const q = front ? quadY(bx + bw * t0, bx + bw * t1, by + bd, za, zb) : quadX(bx + bw, by + bd * t0, by + bd * t1, za, zb);
        g.poly(q).fill(shade(color, front ? 1.0 : 0.8));
        if (rng() < share) lit.poly(q).fill(LIT);
      }
  }
}

/** Visible walls and lit top of a convex footprint (for hulls and odd shapes). */
function prism(g: Graphics, pts: P2[], z0: number, z1: number, color: number, lid?: number): void {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
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
    g.poly(flat([iso(a[0], a[1], z0), iso(b[0], b[1], z0), iso(b[0], b[1], z1), iso(a[0], a[1], z1)])).fill(shade(color, 0.95 - 0.21 * k));
  }
  g.poly(flat(pts.map(([px, py]) => iso(px, py, z1)))).fill(lid ?? shade(color, 1.1));
}

/** Gable roof over a box, ridge along x. */
function gableX(g: Graphics, x0: number, y0: number, w: number, d: number, z: number, h: number, color: number): void {
  const ym = y0 + d / 2;
  const T = iso(x0, y0, z), R = iso(x0 + w, y0, z), B = iso(x0 + w, y0 + d, z), L = iso(x0, y0 + d, z);
  const r0 = iso(x0, ym, z + h), r1 = iso(x0 + w, ym, z + h);
  g.poly([T.x, T.y, R.x, R.y, r1.x, r1.y, r0.x, r0.y]).fill(shade(color, 0.85));
  g.poly([L.x, L.y, B.x, B.y, r1.x, r1.y, r0.x, r0.y]).fill(shade(color, 1.08));
  g.poly([R.x, R.y, B.x, B.y, r1.x, r1.y]).fill(shade(color, 0.7));
}

/** HSV hue (0..1) to a saturated 0xRRGGBB color. */
function hue(h: number, s = 0.85, v = 1): number {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (Math.round(f(5) * 255) << 16) | (Math.round(f(3) * 255) << 8) | Math.round(f(1) * 255);
}

interface PalmParts {
  trunk: Graphics;
  crown: Graphics;
}

/** A small palm: a static curved trunk and a crown child that can sway. */
function makePalm(tx: number, ty: number, z: number, h: number, lean: number): PalmParts {
  const trunk = new Graphics();
  const base = iso(tx, ty, z);
  const tip = { x: base.x + lean, y: base.y - h };
  trunk.ellipse(base.x + 6, base.y + 1, 11, 4).fill({ color: 0x000000, alpha: 0.12 });
  const N = 7;
  let prev = base;
  for (let i = 1; i <= N; i++) {
    const u = i / N;
    const q = { x: base.x + lean * u * u, y: base.y - h * u };
    trunk.moveTo(prev.x, prev.y).lineTo(q.x, q.y).stroke({ width: 5 - 2 * u, color: i % 2 ? 0x9c7650 : 0x86623f, cap: "round" });
    prev = q;
  }
  const crown = new Graphics();
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const end = { x: ca * 19, y: sa * 8 + 9 };
    const mid = { x: ca * 10, y: sa * 4 - 3 };
    crown.poly([0, 0, mid.x - sa * 3.5, mid.y + ca * 2, end.x, end.y, mid.x + sa * 3.5, mid.y - ca * 2]).fill(i % 2 ? 0x3fa34d : 0x2f8f3f);
  }
  crown.circle(-2, 3, 2.2).fill(0x6d4c2f);
  crown.circle(2, 3.5, 2.2).fill(0x6d4c2f);
  crown.circle(0, 1, 3.2).fill(0x2f7d38);
  crown.position.set(tip.x, tip.y);
  return { trunk, crown };
}

// ------------------------------------------------------------ riverboat

/**
 * A white paddle-wheel steamboat on the water, bow toward -x: red hull band,
 * two decks with railings, a pilot house, twin black stacks puffing smoke,
 * a turning red stern wheel, and strings of lights at night. It gently bobs.
 */
export const riverboat: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor("coast-riverboat", x, y);
  const boat = new Container();
  const g = new Graphics();
  const lit = new Graphics();
  const wake = new Graphics();
  const zw = WATER_Z;
  const x0 = x + 0.12, x1 = x + w - 0.75, y0 = y + 0.2, y1 = y + d - 0.2, ym = (y0 + y1) / 2;
  const hs = Math.max(0.7, Math.min(1.2, d));
  // Foam behind the wheel and along the hull (on the water, does not bob).
  const wx = x + w - 0.45;
  for (let i = 0; i < 4; i++) {
    const p = iso(wx + 0.2 + i * 0.12, ym, zw);
    wake.ellipse(p.x, p.y, 10 - i * 1.5, 3.5 - i * 0.5).fill({ color: 0xffffff, alpha: 0.55 - i * 0.1 });
  }
  // Hull: pointed bow, red band at the waterline, white main deck walls.
  const hull: P2[] = [[x0 + 0.4, y0], [x1, y0], [x1, y1], [x0 + 0.4, y1], [x0, ym]];
  prism(g, hull, zw - 2, zw + 5, 0xc0392b);
  prism(g, hull, zw + 5, zw + 7, 0x2b2b2b);
  const deck1: P2[] = [[x0 + 0.5, y0 + 0.05], [x1 - 0.05, y0 + 0.05], [x1 - 0.05, y1 - 0.05], [x0 + 0.5, y1 - 0.05], [x0 + 0.18, ym]];
  prism(g, deck1, zw + 7, zw + 7 + 14 * hs, 0xfafafa, 0xe8e2d4);
  const z1 = zw + 7 + 14 * hs;
  boxWindows(g, lit, x0 + 0.55, y0 + 0.05, x1 - x0 - 0.6, y1 - y0 - 0.1, zw + 8, z1 - 1, 12 * hs, 4, 0x4a6f8f, rng, 0.75);
  // Second deck, inset, and the pilot house near the bow.
  const d2x0 = x0 + 0.75, d2x1 = x1 - 0.2, d2y0 = y0 + 0.1, d2d = y1 - y0 - 0.2;
  box(g, d2x0, d2y0, d2x1 - d2x0, d2d, z1, z1 + 12 * hs, 0xffffff, 0xece6d8);
  const z2 = z1 + 12 * hs;
  boxWindows(g, lit, d2x0, d2y0, d2x1 - d2x0, d2d, z1 + 1, z2 - 1, 11 * hs, 4, 0x5b7fa0, rng, 0.7);
  const px0 = d2x0 + 0.1;
  box(g, px0, ym - 0.14, 0.34, 0.28, z2, z2 + 9 * hs, 0xffffff);
  box(g, px0 - 0.03, ym - 0.17, 0.4, 0.34, z2 + 9 * hs, z2 + 11 * hs, 0xc0392b);
  lit.poly(quadY(px0 + 0.04, px0 + 0.3, ym + 0.14, z2 + 3, z2 + 7 * hs)).fill(LIT);
  g.poly(quadY(px0 + 0.04, px0 + 0.3, ym + 0.14, z2 + 3, z2 + 7 * hs)).fill(GLASS);
  // Railings on both deck edges (front face only reads at this scale).
  for (const [rz, rx0, rx1, ry] of [[z1, x0 + 0.5, x1 - 0.05, y1 - 0.05], [z2, d2x0, d2x1, d2y0 + d2d]] as const) {
    line3(g, [rx0, ry, rz + 4], [rx1, ry, rz + 4], 1.2, 0xffffff);
    for (let k = rx0; k <= rx1 + 1e-6; k += 0.12) line3(g, [k, ry, rz], [k, ry, rz + 4], 0.8, 0xd6d0c4);
  }
  // Twin black smokestacks with flared crowns.
  const stacks: P2[] = [[x0 + 0.62, y0 + 0.2], [x0 + 0.62, y1 - 0.2]];
  const stackTop = z2 + 34 * hs;
  const stackTops: Pt[] = [];
  for (const [sx, sy] of stacks) {
    cylinder(g, sx, sy, 3.2, z1, stackTop, 0x222222);
    cylinder(g, sx, sy, 4.6, stackTop - 3, stackTop, 0x333333);
    stackTops.push(iso(sx, sy, stackTop));
  }
  line3(g, [stacks[0][0], stacks[0][1], stackTop - 8], [stacks[1][0], stacks[1][1], stackTop - 8], 1, 0x555555);
  // Strings of lights: stack tops down to bow and stern, and along the upper rail.
  const strings: [[number, number, number], [number, number, number]][] = [
    [[stacks[1][0], stacks[1][1], stackTop - 2], [x0 + 0.1, ym, zw + 12]],
    [[stacks[1][0], stacks[1][1], stackTop - 2], [x1 - 0.05, y1 - 0.05, z2 + 2]],
  ];
  const bulbColors = [0xfff1b8, 0xff6f61, 0x7fe3ff, 0xffe066];
  let bk = 0;
  for (const [a, b] of strings) {
    line3(g, a, b, 0.7, 0x444444);
    for (let t = 0.06; t < 1; t += 0.08) {
      const p = iso(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - Math.sin(t * Math.PI) * 6);
      bulb(lit, p, 1.2, bulbColors[bk++ % bulbColors.length]);
    }
  }
  for (let k = x0 + 0.55; k < x1; k += 0.14) bulb(lit, iso(k, y1 - 0.05, z1 + 5), 1.1, bulbColors[bk++ % bulbColors.length]);
  lit.alpha = 0;
  lit.blendMode = "add";

  // Stern paddle wheel in the x-z plane; the wheel child rotates.
  const zc = zw + 11 * hs;
  const R = 13 * hs;
  line3(g, [x1 - 0.02, y1 - 0.02, z1 - 2], [wx, y1 + 0.02, zc], 2.5, 0x7a2f22);
  line3(g, [x1 - 0.02, y0 + 0.05, z1 - 2], [wx, y0 + 0.02, zc], 2.5, 0x5e241a);
  const frame = planeX(wx, y1 + 0.02, zc);
  const wheel = new Graphics();
  wheel.circle(0, 0, R).stroke({ width: 2.2, color: 0xb71c1c });
  wheel.circle(0, 0, R * 0.55).stroke({ width: 1.4, color: 0xd32f2f });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    wheel.moveTo(0, 0).lineTo(ca * R, sa * R).stroke({ width: 1.3, color: 0xc62828 });
    const px = ca * R, py = sa * R;
    wheel.poly([px - sa * 3.5 - ca * 1.5, py + ca * 3.5 - sa * 1.5, px + sa * 3.5 - ca * 1.5, py - ca * 3.5 - sa * 1.5, px + sa * 3.5 + ca * 2.5, py - ca * 3.5 + sa * 2.5, px - sa * 3.5 + ca * 2.5, py + ca * 3.5 + sa * 2.5]).fill(0xe53935);
  }
  wheel.circle(0, 0, 2.6).fill(0x3a3a3a);
  frame.addChild(wheel);

  // Smoke puffs: a few reused circles per stack, moved and faded each tick.
  const puffs: { g: Graphics; top: Pt; phase: number }[] = [];
  const smoke = new Container();
  stackTops.forEach((top, s) => {
    for (let i = 0; i < 4; i++) {
      const p = new Graphics().circle(0, 0, 1).fill({ color: 0xeeeeee, alpha: 0.85 });
      puffs.push({ g: p, top, phase: i / 4 + s * 0.13 });
      smoke.addChild(p);
    }
  });
  boat.addChild(g, frame, smoke, lit);
  const view = layer(depthOf(x + w - 1, y + d - 1, 50), wake, boat);
  let t = 0;
  return {
    views: [view],
    tintables: [g, wheel, ...puffs.map((p) => p.g), wake],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      boat.y = Math.sin(t * 1.1) * 1.2;
      wheel.rotation = -t * 1.6;
      wake.alpha = 0.7 + 0.3 * Math.sin(t * 3);
      for (const p of puffs) {
        const k = (t * 0.32 + p.phase) % 1;
        p.g.position.set(p.top.x + k * 18, p.top.y - 4 - k * 26);
        p.g.scale.set(2.5 + k * 6.5);
        p.g.alpha = 0.75 * (1 - k);
      }
    },
  };
};

// ------------------------------------------------------------ casino strip

const TOWER_STYLES = [
  { wall: 0xf2c14e, glass: 0xffe8a3, neon: 0xff4fa3, h: 150 },
  { wall: 0x2ec4b6, glass: 0xa6f0ea, neon: 0xffd600, h: 205 },
  { wall: 0xe84393, glass: 0xffb3d9, neon: 0x3ff0e0, h: 125 },
];

/**
 * A resort strip: two or three flashy towers behind a low red casino hall,
 * big marquee sign boxes framed in chasing neon bulbs, a fountain whose jets
 * pulse, and palms at the corners.
 */
export const casinoStrip: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor("coast-casino", x, y);
  const sc = Math.max(0.6, Math.min(w / 4, d / 2, 1.3));
  const g = new Graphics();
  const lit = new Graphics();
  const chase = [new Graphics(), new Graphics(), new Graphics()];
  // Plaza.
  box(g, x + 0.04, y + 0.04, w - 0.08, d - 0.08, 0, 3, 0xd9d2c2);
  // Towers along the back.
  const count = w >= 3.5 ? 3 : 2;
  const slot = (w - 0.4) / count;
  const ty0 = y + 0.15, tdd = d * 0.28;
  for (let i = 0; i < count; i++) {
    const s = TOWER_STYLES[i];
    const tx0 = x + 0.2 + i * slot + slot * 0.12, tw = slot * 0.76;
    const h = s.h * sc;
    box(g, tx0, ty0, tw, tdd, 3, h, s.wall);
    boxWindows(g, lit, tx0 + 0.04, ty0, tw - 0.08, tdd, 14, h - 10, 12, 4, s.glass, rng, 0.6);
    // Vertical accent fin and a stepped crown.
    box(g, tx0 + tw / 2 - 0.06, ty0 + tdd, 0.12, 0.05, 10, h + 8, 0xffffff);
    box(g, tx0 + 0.08, ty0 + 0.06, tw - 0.16, tdd - 0.12, h, h + 10, shade(s.wall, 1.08));
    box(g, tx0 + 0.18, ty0 + 0.12, tw - 0.36, tdd - 0.24, h + 10, h + 18, 0xffffff);
    // Crown neon on the two visible top edges.
    const cz = h - 3;
    tube(lit, iso(tx0, ty0 + tdd, cz), iso(tx0 + tw, ty0 + tdd, cz), s.neon);
    tube(lit, iso(tx0 + tw, ty0 + tdd, cz), iso(tx0 + tw, ty0, cz), s.neon);
    tube(lit, iso(tx0 + tw / 2, ty0 + tdd + 0.05, 14), iso(tx0 + tw / 2, ty0 + tdd + 0.05, h + 6), s.neon, 1.4);
  }
  // The low casino hall with a gold band and studded roof.
  const hx0 = x + 0.2, hx1 = x + w - 0.2, hy0 = y + d * 0.45, hy1 = y + d * 0.72;
  const hz = 26 * sc;
  box(g, hx0, hy0, hx1 - hx0, hy1 - hy0, 3, hz, 0xd62839);
  box(g, hx0 - 0.02, hy0 - 0.02, hx1 - hx0 + 0.04, hy1 - hy0 + 0.04, hz - 5, hz, 0xffc933);
  studGrid(g, hx0, hy0, hx1 - hx0, hy1 - hy0, hz, 0xffc933, 0.45);
  // Glass entry doors under a canopy.
  const ex = (hx0 + hx1) / 2;
  g.poly(quadY(ex - 0.4, ex + 0.4, hy1, 3, 15)).fill(GLASS);
  lit.poly(quadY(ex - 0.4, ex + 0.4, hy1, 3, 15)).fill({ color: LIT, alpha: 0.8 });
  box(g, ex - 0.5, hy1, 1.0, 0.16, 15, 18, 0xffffff);
  // Marquee sign boxes: a wide one on posts at the left, a tall pylon at the right.
  const signs: { x0: number; x1: number; yf: number; z0: number; z1: number; body: number; panel: number }[] = [];
  const s1x0 = x + 0.3, s1x1 = s1x0 + 0.95 * sc;
  line3(g, [s1x0 + 0.15, hy1 + 0.1, 3], [s1x0 + 0.15, hy1 + 0.1, hz + 6], 2.5, 0x9e9e9e);
  line3(g, [s1x1 - 0.15, hy1 + 0.1, 3], [s1x1 - 0.15, hy1 + 0.1, hz + 6], 2.5, 0x9e9e9e);
  signs.push({ x0: s1x0, x1: s1x1, yf: hy1 + 0.16, z0: hz + 6, z1: hz + 32 * sc, body: 0x283593, panel: 0xff4fa3 });
  const px = x + w - 1.0 * sc;
  box(g, px + 0.15, y + d * 0.78, 0.14, 0.14, 3, 60 * sc, 0xbdbdbd);
  signs.push({ x0: px - 0.05, x1: px + 0.5, yf: y + d * 0.78 + 0.14, z0: 56 * sc, z1: 96 * sc, body: 0x6a1b9a, panel: 0xffd600 });
  signs.forEach((s, si) => {
    const dep = 0.1;
    box(g, s.x0, s.yf - dep, s.x1 - s.x0, dep, s.z0, s.z1, s.body);
    // Stylized panels on the face: a band and a row of diamonds.
    const zm = (s.z0 + s.z1) / 2;
    g.poly(quadY(s.x0 + 0.06, s.x1 - 0.06, s.yf, zm - 4, zm + 4)).fill(s.panel);
    const nd = Math.max(2, Math.round((s.x1 - s.x0) / 0.18));
    for (let k = 0; k < nd; k++) {
      const cx = s.x0 + ((k + 0.5) * (s.x1 - s.x0)) / nd;
      const c = iso(cx, s.yf, s.z1 - 7);
      g.poly([c.x, c.y - 3.5, c.x + 3, c.y + 1.5, c.x, c.y + 3.5, c.x - 3, c.y - 1.5]).fill(0xffffff);
      bulb(lit, c, 1.2, s.panel);
    }
    // Neon border: bulbs around the face perimeter, split across chase groups.
    const corners = [iso(s.x0, s.yf, s.z0 + 1.5), iso(s.x1, s.yf, s.z0 + 1.5), iso(s.x1, s.yf, s.z1 - 1.5), iso(s.x0, s.yf, s.z1 - 1.5)];
    let k = si;
    for (let e = 0; e < 4; e++) {
      const a = corners[e], b = corners[(e + 1) % 4];
      const n = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 5));
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        g.circle(p.x, p.y, 1.2).fill(0xfff3c4);
        bulb(chase[k++ % 3], p, 1.3, si === 0 ? 0xff4fa3 : 0x3ff0e0);
      }
    }
  });
  // Fountain in the front center: a round basin; jets are separate children.
  const fc = iso(x + w * 0.5, y + d * 0.86, 3);
  const frx = 26 * sc, fry = frx / 2;
  g.ellipse(fc.x, fc.y + 3, frx + 3, fry + 1.5).fill(0xbdb6a6);
  g.rect(fc.x - frx - 3, fc.y - 1, (frx + 3) * 2, 4).fill(0xd6cfbf);
  g.ellipse(fc.x, fc.y - 1, frx + 3, fry + 1.5).fill(0xeae4d6);
  g.ellipse(fc.x, fc.y - 1, frx, fry).fill(WATER);
  g.ellipse(fc.x, fc.y - 1, frx * 0.6, fry * 0.6).stroke({ width: 1, color: 0xbfe6ff, alpha: 0.8 });
  lit.ellipse(fc.x, fc.y - 1, frx, fry).fill({ color: 0x3ff0e0, alpha: 0.35 });
  const jets: Graphics[] = [];
  const jetBox = new Container();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.55;
    const jg = new Graphics();
    const hgt = i === 0 ? 30 : 18;
    jg.poly([-1.6, 0, 1.6, 0, 0.7, -hgt, -0.7, -hgt]).fill({ color: 0xe6f7ff, alpha: 0.85 });
    jg.circle(0, -hgt, 3).fill({ color: 0xffffff, alpha: 0.7 });
    jg.position.set(fc.x + Math.cos(a) * frx * r, fc.y - 1 + Math.sin(a) * fry * r);
    jets.push(jg);
  }
  jets.sort((a, b) => a.y - b.y).forEach((j) => jetBox.addChild(j));
  // Palms at the front corners.
  const palmsList = [makePalm(x + 0.3, y + d - 0.25, 3, 46 * sc, -6), makePalm(x + w - 0.3, y + d - 0.25, 3, 52 * sc, 7)];
  lit.alpha = 0;
  lit.blendMode = "add";
  for (const c of chase) {
    c.alpha = 0;
    c.blendMode = "add";
  }
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, jetBox, ...palmsList.flatMap((p) => [p.trunk, p.crown]), lit, ...chase);
  let t = 0;
  return {
    views: [view],
    tintables: [g, ...jets, ...palmsList.flatMap((p) => [p.trunk, p.crown])],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      // Chase: one group bright at a time, with an occasional neon flicker.
      const step = Math.floor(t * 7) % 3;
      const flicker = Math.sin(t * 37.3) * Math.sin(t * 23.1) > 0.9 ? 0.35 : 1;
      chase.forEach((c, i) => (c.alpha = n * flicker * (i === step ? 1 : 0.22)));
      jets.forEach((j, i) => (j.scale.y = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.3))));
      const storm = ctx.storm();
      palmsList.forEach((p, i) => (p.crown.rotation = Math.sin(t * 1.2 + i * 2) * 0.06 + storm * (0.25 + 0.1 * Math.sin(t * 4 + i))));
    },
  };
};

// ------------------------------------------------------------ ferris wheel

const GONDOLA_COLORS = [0xe53935, 0xffb300, 0x43a047, 0x1e88e5, 0x8e24aa, 0xff7043, 0x26c6da, 0xec407a, 0xfdd835, 0x5c6bc0];

/**
 * A boardwalk pier with a big ferris wheel whose ring turns slowly while its
 * gondolas hang upright, plus a striped carousel and a ticket booth. The rim
 * lights glow and cycle through colors at night.
 */
export const ferrisWheel: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const fg = new Graphics();
  const lit = new Graphics();
  const carouselChase = [new Graphics(), new Graphics()];
  const sc = Math.max(0.6, Math.min(w, d) / 2);
  const deckZ = 10;
  const wood = 0xb07a4a;
  // Pilings down to the water, then the plank deck with studs along the edge.
  for (let i = 0; i <= Math.round(w * 2); i++) {
    const px = x + 0.08 + (i * (w - 0.16)) / Math.round(w * 2);
    line3(g, [px, y + d - 0.06, WATER_Z - 2], [px, y + d - 0.06, deckZ], 3.2, 0x6d4c33);
  }
  for (let j = 0; j <= Math.round(d * 2); j++) {
    const py = y + 0.08 + (j * (d - 0.16)) / Math.round(d * 2);
    line3(g, [x + w - 0.06, py, WATER_Z - 2], [x + w - 0.06, py, deckZ], 3.2, 0x5e412b);
  }
  box(g, x + 0.04, y + 0.04, w - 0.08, d - 0.08, deckZ - 4, deckZ, wood, 0xc68e5a);
  for (let k = y + 0.2; k < y + d - 0.05; k += 0.2) line3(g, [x + 0.04, k, deckZ], [x + w - 0.04, k, deckZ], 0.7, 0x9a6a3e, 0.7);
  for (let k = x + 0.2; k < x + w - 0.1; k += 0.4) stud(g, k, y + d - 0.14, deckZ, 0xc68e5a);
  // Railing on the two front edges.
  line3(g, [x + 0.06, y + d - 0.06, deckZ + 6], [x + w - 0.06, y + d - 0.06, deckZ + 6], 1.2, 0xffffff);
  line3(g, [x + w - 0.06, y + 0.06, deckZ + 6], [x + w - 0.06, y + d - 0.06, deckZ + 6], 1.2, 0xf0f0f0);
  // The wheel: center, radius, and the back A-frame legs.
  const cx = x + w * 0.5, cy = y + d * 0.42;
  const R = 34 * sc;
  const hubZ = deckZ + R + 9;
  const legC = 0xeceff1;
  line3(g, [cx - 0.6 * sc, cy - 0.14, deckZ], [cx, cy - 0.06, hubZ], 3.2, shade(legC, 0.78));
  line3(g, [cx + 0.6 * sc, cy - 0.14, deckZ], [cx, cy - 0.06, hubZ], 3.2, shade(legC, 0.7));
  const frame = planeX(cx, cy, hubZ);
  const ring = new Container();
  const ringG = new Graphics();
  ringG.circle(0, 0, R).stroke({ width: 3, color: 0xffffff });
  ringG.circle(0, 0, R * 0.82).stroke({ width: 1.4, color: 0xe53935 });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    ringG.moveTo(0, 0).lineTo(Math.cos(a) * R, Math.sin(a) * R).stroke({ width: 0.9, color: 0xdfe3e6 });
  }
  ringG.circle(0, 0, 4).fill(0xe53935);
  ringG.circle(0, 0, 1.8).fill(0xffffff);
  const ringLit = new Graphics();
  for (let i = 0; i < 20; i++) {
    const a = ((i + 0.5) / 20) * Math.PI * 2;
    ringLit.circle(Math.cos(a) * R, Math.sin(a) * R, 3.4).fill({ color: 0xffffff, alpha: 0.3 });
    ringLit.circle(Math.cos(a) * R, Math.sin(a) * R, 1.4).fill(0xffffff);
    ringLit.moveTo(0, 0).lineTo(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82).stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
  }
  ringLit.blendMode = "add";
  ringLit.alpha = 0;
  ring.addChild(ringG, ringLit);
  frame.addChild(ring);
  // Gondolas: children of the plane, repositioned each tick, never rotated.
  const gondolas: Graphics[] = [];
  const nG = 10;
  for (let i = 0; i < nG; i++) {
    const c = GONDOLA_COLORS[i % GONDOLA_COLORS.length];
    const gd = new Graphics();
    gd.moveTo(0, 0).lineTo(0, 4).stroke({ width: 1, color: 0x555555 });
    gd.roundRect(-4.5, 4, 9, 7.5, 2).fill(c);
    gd.rect(-4.5, 4, 3.2, 7.5).fill(shade(c, 1.12));
    gd.rect(-5.5, 3, 11, 2).fill(0xffffff);
    frame.addChild(gd);
    gondolas.push(gd);
  }
  // Front legs and the hub cap sit in front of the wheel.
  line3(fg, [cx - 0.6 * sc, cy + 0.14, deckZ], [cx, cy + 0.06, hubZ], 3.4, legC);
  line3(fg, [cx + 0.6 * sc, cy + 0.14, deckZ], [cx, cy + 0.06, hubZ], 3.4, shade(legC, 0.85));
  line3(fg, [cx - 0.3 * sc, cy + 0.12, deckZ + R * 0.5], [cx + 0.3 * sc, cy + 0.12, deckZ + R * 0.5], 2, shade(legC, 0.9));
  const hub = iso(cx, cy + 0.06, hubZ);
  fg.circle(hub.x, hub.y, 3).fill(0x9e9e9e);
  // Carousel on the front-right corner: base, striped poles, cone canopy.
  const kx = x + w - 0.42 * sc, ky = y + d - 0.4 * sc;
  const kr = 13 * sc;
  cylinder(fg, kx, ky, kr, deckZ, deckZ + 3, 0xf5f5f5);
  const kb = iso(kx, ky, deckZ + 3);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (Math.sin(a) < -0.2) continue;
    const px = kb.x + Math.cos(a) * kr * 0.8, py = kb.y + Math.sin(a) * kr * 0.4;
    fg.moveTo(px, py).lineTo(px, py - 17 * sc).stroke({ width: 1.5, color: 0xffd54f });
    fg.roundRect(px - 2.5, py - 9 * sc, 5, 3.5, 1).fill(GONDOLA_COLORS[i]);
  }
  const canZ = deckZ + 3 + 17 * sc;
  cylinder(fg, kx, ky, kr + 1, canZ, canZ + 4, 0xe53935);
  cone(fg, kx, ky, kr + 1, canZ + 4, 12 * sc, 0xffffff);
  const cTop = iso(kx, ky, canZ + 4 + 12 * sc);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI;
    fg.moveTo(cTop.x, cTop.y).lineTo(cTop.x + Math.cos(a) * (kr + 1), iso(kx, ky, canZ + 4).y + Math.sin(a) * (kr + 1) * 0.5).stroke({ width: 2.2, color: 0xe53935 });
  }
  fg.circle(cTop.x, cTop.y - 2, 2.2).fill(0xffd600);
  const cRim = iso(kx, ky, canZ + 2);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (Math.sin(a) < -0.3) continue;
    bulb(carouselChase[i % 2], { x: cRim.x + Math.cos(a) * (kr + 1), y: cRim.y + Math.sin(a) * (kr + 1) * 0.5 }, 1.2, 0xffe066);
  }
  // Ticket booth on the front-left with a striped roof.
  const bx = x + 0.18, by = y + d - 0.55 * sc;
  box(fg, bx, by, 0.32 * sc, 0.32 * sc, deckZ, deckZ + 16 * sc, 0x1e88e5);
  const win = quadY(bx + 0.06 * sc, bx + 0.26 * sc, by + 0.32 * sc, deckZ + 7 * sc, deckZ + 13 * sc);
  fg.poly(win).fill(GLASS);
  lit.poly(win).fill(LIT);
  box(fg, bx - 0.04, by - 0.04, 0.4 * sc, 0.4 * sc, deckZ + 16 * sc, deckZ + 19 * sc, 0xffffff, 0xe53935);
  // Deck lamps.
  for (const lx of [x + 0.7, x + w - 0.9]) {
    const lp = iso(lx, y + d - 0.1, deckZ + 20);
    line3(fg, [lx, y + d - 0.1, deckZ], [lx, y + d - 0.1, deckZ + 20], 1.3, 0x37474f);
    fg.circle(lp.x, lp.y, 2).fill(0xfff6d0);
    bulb(lit, lp, 2, 0xffe6a0);
  }
  lit.alpha = 0;
  lit.blendMode = "add";
  for (const c of carouselChase) {
    c.alpha = 0;
    c.blendMode = "add";
  }
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, frame, fg, lit, ...carouselChase);
  let t = 0;
  const place = () => {
    for (let i = 0; i < nG; i++) {
      const a = ring.rotation + (i / nG) * Math.PI * 2;
      gondolas[i].position.set(Math.cos(a) * R, Math.sin(a) * R);
    }
  };
  place();
  return {
    views: [view],
    tintables: [g, ringG, ...gondolas, fg],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      ring.rotation = t * 0.18;
      place();
      ringLit.alpha = n;
      ringLit.tint = hue((t * 0.06) % 1, 0.55);
      lit.alpha = n;
      const on = Math.floor(t * 3) % 2;
      carouselChase.forEach((c, i) => (c.alpha = n * (i === on ? 1 : 0.3)));
    },
  };
};

// ------------------------------------------------------------ fishing harbor

const BOAT_COLORS = [
  { hull: 0x1565c0, trim: 0xffffff, cabin: 0xf5f5f5 },
  { hull: 0xc62828, trim: 0xffe082, cabin: 0xfafafa },
];

/**
 * A fishing harbor: a gravel quay with a red fish shack (weathervane on the
 * ridge), stacked lobster traps and crates, a plank dock on pilings along the
 * slip, two small boats and a buoy bobbing in the water, and dock lamps.
 */
export const fishingHarbor: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor("coast-harbor", x, y);
  const g = new Graphics();
  const water = new Graphics();
  const front = new Graphics();
  const lit = new Graphics();
  const quayD = Math.min(0.95, d * 0.45);
  const qy1 = y + quayD;
  // The slip: open water across the front of the footprint.
  water.poly(flat([iso(x + 0.02, qy1, WATER_Z), iso(x + w - 0.02, qy1, WATER_Z), iso(x + w - 0.02, y + d - 0.02, WATER_Z), iso(x + 0.02, y + d - 0.02, WATER_Z)])).fill(WATER);
  for (let i = 0; i < 6; i++) {
    const p = iso(x + 0.3 + rng() * (w - 0.6), qy1 + 0.4 + rng() * (d - quayD - 0.5), WATER_Z);
    water.moveTo(p.x - 5, p.y).lineTo(p.x + 5, p.y).stroke({ width: 1, color: 0xbfe6ff, alpha: 0.7 });
  }
  // Quay: a stone seawall with a gravel top and studs.
  box(g, x + 0.02, y + 0.02, w - 0.04, quayD - 0.02, WATER_Z - 2, 3, 0x9e9e9e, 0xc2b79c);
  for (let k = x + 0.25; k < x + w - 0.1; k += 0.5) stud(g, k, y + 0.2, 3, 0xc2b79c);
  // Fish shack on the back-left: red board walls, gable roof, lit window.
  const sx = x + 0.15, sy = y + 0.12, sw = Math.min(1.1, w * 0.36), sd = quayD - 0.3;
  box(g, sx, sy, sw, sd, 3, 26, 0xb23a3a);
  for (let z = 7; z < 26; z += 4) line3(g, [sx, sy + sd, z], [sx + sw, sy + sd, z], 0.6, 0x8e2c2c, 0.8);
  const door = quadY(sx + sw * 0.62, sx + sw * 0.8, sy + sd, 3, 17);
  g.poly(door).fill(0x5d4037);
  const sWin = quadY(sx + sw * 0.18, sx + sw * 0.45, sy + sd, 11, 19);
  g.poly(sWin).fill(GLASS);
  lit.poly(sWin).fill(LIT);
  gableX(g, sx - 0.04, sy - 0.04, sw + 0.08, sd + 0.08, 26, 12, 0x455a64);
  // Weathervane: a pole on the ridge; the arrow turns (fake 3D via scale.x).
  const vx = sx + sw * 0.7, vy = sy + sd / 2;
  line3(g, [vx, vy, 38], [vx, vy, 52], 1.2, 0x333333);
  const vTop = iso(vx, vy, 52);
  g.circle(vTop.x, vTop.y + 3, 1.6).fill(0xb8860b);
  const vane = new Graphics();
  vane.moveTo(-8, 0).lineTo(8, 0).stroke({ width: 1.4, color: 0x2b2b2b });
  vane.poly([8, 0, 4, -3, 4, 3]).fill(0x2b2b2b);
  vane.poly([-8, 0, -11, -4, -6, -4, -4, 0, -6, 4, -11, 4]).fill(0xb8860b);
  vane.position.set(vTop.x, vTop.y);
  // Lobster traps and crates stacked on the quay.
  const trapC = [0xf9a825, 0x2e7d32, 0xe65100, 0x00838f];
  let tx = sx + sw + 0.2;
  for (let s = 0; s < 3 && tx + 0.3 < x + w - 0.2; s++, tx += 0.36) {
    const stack = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < stack; k++) {
      const c = trapC[(s + k) % trapC.length];
      const z0 = 3 + k * 7;
      box(g, tx, y + 0.2, 0.3, 0.28, z0, z0 + 7, c);
      line3(g, [tx, y + 0.48, z0 + 3.5], [tx + 0.3, y + 0.48, z0 + 3.5], 0.6, shade(c, 0.6));
      line3(g, [tx + 0.15, y + 0.48, z0], [tx + 0.15, y + 0.48, z0 + 7], 0.6, shade(c, 0.6));
    }
  }
  // Wooden crates with a coil of rope near the dock edge.
  box(g, x + w - 0.55, y + 0.52, 0.22, 0.2, 3, 9, 0x8d6e63);
  box(g, x + w - 0.32, y + 0.55, 0.2, 0.18, 3, 8, 0xa1887f);
  const rope = iso(x + w - 0.85, y + 0.62, 3);
  g.ellipse(rope.x, rope.y, 6, 3).stroke({ width: 2, color: 0xd7ccc8 });
  // Dock: a plank walk along the quay edge and a finger pier into the slip.
  const dz = 5;
  const dy0 = qy1, dy1 = qy1 + 0.28;
  const fx0 = x + w * 0.5 - 0.13, fx1 = fx0 + 0.26;
  const piling = (px: number, py: number) => {
    line3(front, [px, py, WATER_Z - 1], [px, py, dz + 4], 3, 0x5d4037);
    const top = iso(px, py, dz + 4);
    front.ellipse(top.x, top.y, 1.6, 0.8).fill(0x8d6e63);
  };
  box(front, x + 0.05, dy0, w - 0.1, dy1 - dy0, dz - 2, dz, 0xa1774f, 0xbc8f5f);
  box(front, fx0, dy1, fx1 - fx0, y + d - 0.1 - dy1, dz - 2, dz, 0xa1774f, 0xbc8f5f);
  for (let k = x + 0.15; k < x + w - 0.05; k += 0.18) line3(front, [k, dy0, dz], [k, dy1, dz], 0.6, 0x8a6240, 0.8);
  for (let k = x + 0.1; k <= x + w - 0.08; k += 0.45) piling(k, dy1);
  for (let k = dy1 + 0.35; k < y + d - 0.05; k += 0.35) {
    piling(fx0, k);
    piling(fx1, k);
  }
  // Dock lamps on posts.
  const lamps: Pt[] = [];
  for (const lx of [x + 0.35, fx1 - 0.02, x + w - 0.3]) {
    const ly = lx === fx1 - 0.02 ? y + d - 0.2 : dy1 - 0.04;
    line3(front, [lx, ly, dz], [lx, ly, dz + 22], 1.3, 0x37474f);
    const lp = iso(lx, ly, dz + 22);
    front.circle(lp.x, lp.y, 2.2).fill(0xfff6d0);
    lamps.push(lp);
  }
  for (const lp of lamps) {
    bulb(lit, lp, 2.2, 0xffe6a0);
    lit.ellipse(lp.x, lp.y + 24, 12, 5).fill({ color: 0xffe6a0, alpha: 0.18 });
  }
  // Two small fishing boats in the slip, one on each side of the finger pier.
  const boats: { c: Container; phase: number }[] = [];
  const boatSpots: [number, number][] = [[x + 0.2, fx0 - 0.12], [fx1 + 0.12, x + w - 0.15]];
  boatSpots.forEach(([bx0, bx1], i) => {
    const s = BOAT_COLORS[i % BOAT_COLORS.length];
    const bg = new Graphics();
    const len = Math.min(1.1, bx1 - bx0);
    const b0 = bx1 - len, by0 = dy1 + 0.2, by1 = Math.min(y + d - 0.12, by0 + 0.38), bm = (by0 + by1) / 2;
    const hull: P2[] = [[b0 + 0.25, by0], [b0 + len, by0 + 0.03], [b0 + len, by1 - 0.03], [b0 + 0.25, by1], [b0, bm]];
    prism(bg, hull, WATER_Z - 1, WATER_Z + 6, s.hull, 0xe0d6c2);
    prism(bg, hull, WATER_Z + 4, WATER_Z + 6, s.trim, 0xe0d6c2);
    const cbx = b0 + len * 0.55;
    box(bg, cbx, by0 + 0.07, 0.24, by1 - by0 - 0.14, WATER_Z + 6, WATER_Z + 17, s.cabin, s.hull);
    const cw = quadY(cbx + 0.04, cbx + 0.2, by1 - 0.07, WATER_Z + 10, WATER_Z + 15);
    bg.poly(cw).fill(GLASS);
    lit.poly(cw).fill({ color: LIT, alpha: 0.7 });
    // Mast with an outrigger boom.
    line3(bg, [b0 + len * 0.35, bm, WATER_Z + 6], [b0 + len * 0.35, bm, WATER_Z + 34], 1.4, 0x6d4c41);
    line3(bg, [b0 + len * 0.35, bm, WATER_Z + 30], [b0 + len * 0.1, bm + 0.2, WATER_Z + 16], 1, 0x6d4c41);
    const c = new Container();
    c.addChild(bg);
    boats.push({ c, phase: i * 2.1 });
  });
  // A red-and-white buoy near the front corner.
  const buoy = new Graphics();
  const bux = x + w - 0.3, buy = y + d - 0.25;
  cylinder(buoy, bux, buy, 3.6, WATER_Z - 1, WATER_Z + 5, 0xe53935);
  cylinder(buoy, bux, buy, 3.6, WATER_Z + 5, WATER_Z + 9, 0xffffff);
  cone(buoy, bux, buy, 3.6, WATER_Z + 9, 6, 0xe53935);
  const buoyTop = iso(bux, buy, WATER_Z + 16);
  const buoyLight = new Graphics();
  bulb(buoyLight, buoyTop, 1.6, 0xff3b30);
  buoyLight.blendMode = "add";
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 55), water, g, vane, ...boats.map((b) => b.c), front, buoy, lit, buoyLight);
  let t = 0;
  return {
    views: [view],
    tintables: [water, g, vane, ...boats.map((b) => b.c.children[0] as Container), front, buoy],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      const storm = ctx.storm();
      lit.alpha = n;
      for (const b of boats) b.c.y = Math.sin(t * 1.3 + b.phase) * (1.2 + storm * 2);
      buoy.y = buoyLight.y = Math.sin(t * 1.7 + 1) * (1.4 + storm * 2.5);
      buoyLight.alpha = Math.max(0.2, n) * (Math.sin(t * 2.5) > 0.4 ? 1 : 0.1);
      const ang = Math.sin(t * 0.25) * 1.4 + Math.sin(t * 1.7) * 0.15 * (1 + storm * 3);
      vane.scale.x = Math.cos(ang);
    },
  };
};

// ------------------------------------------------------------ music row

const VENUES = [
  { wall: 0x8e44ad, trim: 0xffd54f, marquee: 0xffffff, h: 60 },
  { wall: 0xe67e22, trim: 0x5d4037, marquee: 0xfff3c4, h: 78 },
  { wall: 0x1e88e5, trim: 0xffffff, marquee: 0xffe082, h: 52 },
];

/**
 * A row of three colorful music venues with bulb-framed marquees over the
 * sidewalk, a giant neon guitar on the middle roof that glows and blinks at
 * night, and a string of lights along the street side.
 */
export const musicRow: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const rng = rngFor("coast-music", x, y);
  const g = new Graphics();
  const lit = new Graphics();
  const chase = [new Graphics(), new Graphics()];
  const twinkle = [new Graphics(), new Graphics()];
  const sc = Math.max(0.7, Math.min(1.3, d));
  const walk = 0.3 * Math.min(1, d);
  const by0 = y + 0.12, byF = y + d - walk;
  box(g, x + 0.02, y + 0.02, w - 0.04, d - 0.04, 0, 2, 0xcfc8b8);
  const slot = (w - 0.1) / 3;
  const roofs: { cx: number; z: number }[] = [];
  VENUES.forEach((v, i) => {
    const vx0 = x + 0.05 + i * slot + 0.03, vw = slot - 0.06;
    const h = v.h * sc;
    box(g, vx0, by0, vw, byF - by0, 2, h, v.wall);
    // Storefront glass, door, and upper windows.
    const sf = quadY(vx0 + 0.08, vx0 + vw - 0.08, byF, 3, 17);
    g.poly(sf).fill(GLASS);
    lit.poly(sf).fill({ color: LIT, alpha: 0.9 });
    g.poly(quadY(vx0 + vw * 0.42, vx0 + vw * 0.58, byF, 3, 15)).fill(0x3e2723);
    boxWindows(g, lit, vx0, by0, vw, byF - by0, 34, h - 6, 13, 3, 0xbfe3f5, rng, 0.7);
    // Cornice with studs.
    box(g, vx0 - 0.02, by0 - 0.02, vw + 0.04, byF - by0 + 0.04, h, h + 4, v.trim);
    studGrid(g, vx0, by0, vw, byF - by0, h + 4, v.trim, 0.45);
    // Marquee box projecting over the sidewalk, framed in chasing bulbs.
    const mx0 = vx0 + 0.08, mx1 = vx0 + vw - 0.08, mz0 = 20, mz1 = 30;
    box(g, mx0, byF, mx1 - mx0, walk * 0.7, mz0, mz1, v.marquee, v.trim);
    const myF = byF + walk * 0.7;
    g.poly(quadY(mx0 + 0.05, mx1 - 0.05, myF, mz0 + 3, mz1 - 3)).fill(shade(v.wall, 1.15));
    let k = i;
    for (const z of [mz0 + 1, mz1 - 1]) {
      const n = Math.max(3, Math.round((mx1 - mx0) / 0.07));
      for (let j = 0; j <= n; j++) {
        const p = iso(mx0 + ((mx1 - mx0) * j) / n, myF, z);
        g.circle(p.x, p.y, 1).fill(0xfff3c4);
        bulb(chase[k++ % 2], p, 1.1, 0xffe066);
      }
    }
    roofs.push({ cx: vx0 + vw / 2, z: h + 4 });
  });
  // Giant guitar sign on the middle roof, in the x-z plane.
  const mid = roofs[1];
  const gy = (by0 + byF) / 2;
  line3(g, [mid.cx - 0.2, gy, mid.z], [mid.cx - 0.2, gy, mid.z + 16], 1.6, 0x616161);
  line3(g, [mid.cx + 0.2, gy, mid.z], [mid.cx + 0.2, gy, mid.z + 16], 1.6, 0x616161);
  const sign = planeX(mid.cx, gy, mid.z + 12);
  const guitar = new Graphics();
  const guitarLit = new Graphics();
  const gs = 0.9 * sc;
  const body: [number, number, number][] = [[0, -12 * gs, 11 * gs], [0, -27 * gs, 8 * gs]];
  const neck = [-2.2 * gs, -33 * gs, 4.4 * gs, -34 * gs];
  for (const [bx, byy, r] of body) guitar.circle(bx, byy, r).fill(0xd84315);
  guitar.circle(0, -18 * gs, 3.2 * gs).fill(0x3e2723);
  guitar.rect(neck[0], neck[1] + neck[3], neck[2], -neck[3]).fill(0x5d4037);
  guitar.rect(-3.5 * gs, -72 * gs, 7 * gs, 7 * gs).fill(0x3e2723);
  guitar.rect(-4 * gs, -9 * gs, 8 * gs, 2 * gs).fill(0x3e2723);
  for (const [bx, byy, r] of body) {
    guitarLit.circle(bx, byy, r).stroke({ width: 5, color: 0xff4fa3, alpha: 0.4 });
    guitarLit.circle(bx, byy, r).stroke({ width: 1.6, color: 0xffb3d9 });
  }
  guitarLit.rect(neck[0], neck[1] + neck[3], neck[2], -neck[3]).stroke({ width: 4, color: 0x3ff0e0, alpha: 0.4 });
  guitarLit.rect(neck[0], neck[1] + neck[3], neck[2], -neck[3]).stroke({ width: 1.4, color: 0xb2fff6 });
  guitarLit.rect(-3.5 * gs, -72 * gs, 7 * gs, 7 * gs).stroke({ width: 1.4, color: 0xb2fff6 });
  for (let s = -1; s <= 1; s++) guitarLit.moveTo(s * 1.1 * gs, -10 * gs).lineTo(s * 1.1 * gs, -66 * gs).stroke({ width: 0.7, color: 0xfff3c4 });
  guitarLit.blendMode = "add";
  guitarLit.alpha = 0;
  const tilt = new Container();
  tilt.rotation = 0.35;
  tilt.addChild(guitar, guitarLit);
  sign.addChild(tilt);
  // String lights across the street side, sagging between posts.
  const sy = y + d - 0.05;
  const posts = [x + 0.06, x + w / 2, x + w - 0.06];
  for (const px of posts) line3(g, [px, sy, 2], [px, sy, 36], 1.4, 0x4e342e);
  const colors = [0xffe066, 0xff6f61, 0x7fe3ff, 0xb388ff, 0x9cff8a];
  let bk = 0;
  for (let s = 0; s < posts.length - 1; s++) {
    const a = posts[s], b = posts[s + 1];
    let prev = iso(a, sy, 35);
    for (let j = 1; j <= 24; j++) {
      const u = j / 24;
      const p = iso(a + (b - a) * u, sy, 35 - Math.sin(u * Math.PI) * 8);
      g.moveTo(prev.x, prev.y).lineTo(p.x, p.y).stroke({ width: 0.7, color: 0x3a3a3a });
      prev = p;
      if (j % 2 === 0 && j < 24) {
        g.circle(p.x, p.y + 1, 1).fill(0xf5f5f5);
        bulb(twinkle[bk % 2], { x: p.x, y: p.y + 1 }, 1.2, colors[bk % colors.length]);
        bk++;
      }
    }
  }
  lit.alpha = 0;
  lit.blendMode = "add";
  for (const c of [...chase, ...twinkle]) {
    c.alpha = 0;
    c.blendMode = "add";
  }
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, sign, lit, ...chase, ...twinkle);
  let t = 0;
  return {
    views: [view],
    tintables: [g, guitar],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lit.alpha = n;
      const step = Math.floor(t * 5) % 2;
      chase.forEach((c, i) => (c.alpha = n * (i === step ? 1 : 0.25)));
      twinkle.forEach((c, i) => (c.alpha = n * (0.7 + 0.3 * Math.sin(t * 2.2 + i * Math.PI))));
      // The guitar glows steadily, blinks off twice every few seconds.
      const cyc = t % 4;
      const blink = (cyc > 3.2 && cyc < 3.4) || (cyc > 3.6 && cyc < 3.8) ? 0.1 : 1;
      guitarLit.alpha = n * blink;
    },
  };
};

// ------------------------------------------------------------ monument

/**
 * A tall white obelisk on a stepped plaza with a long reflecting pool in
 * front and a ring of flags around its base. Floodlit at night, with a
 * blinking red aviation light at the tip; the pool shimmers.
 */
export const monument: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const back = new Graphics();
  const frontG = new Graphics();
  const flood = new Graphics();
  const shimmer = [new Graphics(), new Graphics()];
  const sc = Math.max(0.6, Math.min(w, d) / 2);
  const stone = 0xe8e2d0;
  box(back, x + 0.03, y + 0.03, w - 0.06, d - 0.06, 0, 4, stone);
  // Studs on the plaza corners, clear of the pool and the obelisk.
  for (const [sx, sy] of [[x + 0.2, y + 0.2], [x + w - 0.2, y + 0.2], [x + 0.2, y + d - 0.2], [x + w - 0.2, y + d - 0.2]] as const) stud(back, sx, sy, 4, stone);
  // Reflecting pool: stone rim, blue water, a pale reflection of the shaft.
  const cx = x + w / 2, cy = y + 0.55 * sc;
  const px0 = cx - 0.3 * sc, px1 = cx + 0.3 * sc, py0 = cy + 0.45 * sc, py1 = y + d - 0.14;
  box(back, px0 - 0.05, py0 - 0.05, px1 - px0 + 0.1, py1 - py0 + 0.1, 4, 6, 0xd6cfbc);
  back.poly(flat([iso(px0, py0, 5.5), iso(px1, py0, 5.5), iso(px1, py1, 5.5), iso(px0, py1, 5.5)])).fill(0x4aa3df);
  back.poly(flat([iso(px0, py0, 5.5), iso(px0 + 0.05, py0, 5.5), iso(px0 + 0.05, py1, 5.5), iso(px0, py1, 5.5)])).fill(0x3b8cc4);
  const refl = [iso(cx - 0.05, py0 + 0.05, 5.5), iso(cx + 0.05, py0 + 0.05, 5.5), iso(cx + 0.02, py1 - 0.1, 5.5), iso(cx - 0.02, py1 - 0.1, 5.5)];
  back.poly(flat(refl)).fill({ color: 0xffffff, alpha: 0.3 });
  for (let i = 0; i < 8; i++) {
    const u = (i + 0.5) / 8;
    const p = iso(px0 + (px1 - px0) * (0.2 + 0.6 * ((i * 0.37) % 1)), py0 + (py1 - py0) * u, 5.5);
    shimmer[i % 2].moveTo(p.x - 4, p.y).lineTo(p.x + 4, p.y).stroke({ width: 1.2, color: 0xe3f6ff });
  }
  // Stepped base and the tapered shaft with its pyramidion.
  box(g, cx - 0.32 * sc, cy - 0.32 * sc, 0.64 * sc, 0.64 * sc, 4, 8, 0xdcd6c4);
  box(g, cx - 0.25 * sc, cy - 0.25 * sc, 0.5 * sc, 0.5 * sc, 8, 12, 0xe5dfcd);
  const b = 0.17 * sc, tp = 0.11 * sc, z0 = 12, H = 190 * sc;
  const white = 0xf7f5ee;
  const bL = iso(cx - b, cy + b, z0), bB = iso(cx + b, cy + b, z0), bR = iso(cx + b, cy - b, z0);
  const tL = iso(cx - tp, cy + tp, H), tB = iso(cx + tp, cy + tp, H), tR = iso(cx + tp, cy - tp, H), tT = iso(cx - tp, cy - tp, H);
  const leftFace = [bL.x, bL.y, bB.x, bB.y, tB.x, tB.y, tL.x, tL.y];
  const rightFace = [bB.x, bB.y, bR.x, bR.y, tR.x, tR.y, tB.x, tB.y];
  g.poly(leftFace).fill(shade(white, 0.95));
  g.poly(rightFace).fill(shade(white, 0.74));
  const apex = iso(cx, cy, H + 18 * sc);
  g.poly([tL.x, tL.y, tB.x, tB.y, apex.x, apex.y]).fill(shade(white, 1.02));
  g.poly([tB.x, tB.y, tR.x, tR.y, apex.x, apex.y]).fill(shade(white, 0.8));
  g.poly([tT.x, tT.y, tL.x, tL.y, apex.x, apex.y]).fill(shade(white, 1.1));
  // A subtle color line a third of the way up (the old stone change).
  const zc = z0 + (H - z0) * 0.3;
  const k = (zc - z0) / (H - z0), bk = b + (tp - b) * k;
  g.poly(flat([iso(cx - bk, cy + bk, zc), iso(cx + bk, cy + bk, zc), iso(cx + bk, cy - bk, zc)])).stroke({ width: 1, color: 0xd8d0bc });
  // Floodlight: warm wash over the faces and beams from the ground.
  flood.poly(leftFace).fill({ color: 0xfff1c8, alpha: 0.4 });
  flood.poly(rightFace).fill({ color: 0xffe0a0, alpha: 0.25 });
  for (const [fx, fy] of [[cx - 0.45 * sc, cy + 0.45 * sc], [cx + 0.45 * sc, cy + 0.45 * sc]] as const) {
    const f = iso(fx, fy, 4), top = iso(cx, cy, H * 0.75);
    flood.poly([f.x, f.y, top.x - 6, top.y, top.x + 6, top.y]).fill({ color: 0xfff6d8, alpha: 0.1 });
    flood.circle(f.x, f.y, 2.5).fill(0xfff6d8);
  }
  const redLight = new Graphics();
  bulb(redLight, iso(cx, cy, H + 20 * sc), 2.2, 0xff3b30);
  redLight.blendMode = "add";
  // Flags on poles in a ring around the base: back ones behind the shaft.
  const flags: { g: Graphics; phase: number }[] = [];
  const nF = 8;
  const flagColors: [number, number][] = [[0xe53935, 0xffffff], [0x1e40af, 0xffffff]];
  for (let i = 0; i < nF; i++) {
    const a = (i / nF) * Math.PI * 2 + 0.2;
    const fx = cx + Math.cos(a) * 0.42 * sc, fy = cy + Math.sin(a) * 0.42 * sc;
    const isBack = fx + fy < cx + cy;
    const pole = isBack ? back : frontG;
    line3(pole, [fx, fy, 4], [fx, fy, 40 * sc], 1.1, 0xbdbdbd);
    const top = iso(fx, fy, 40 * sc);
    const f = new Graphics();
    const [c1, c2] = flagColors[i % 2];
    for (let s = 0; s < 4; s++) f.rect(0, s * 2, 11, 2).fill(s % 2 ? c2 : c1);
    f.rect(0, 0, 4.5, 4).fill(0x1e3a8a);
    f.position.set(top.x, top.y);
    flags.push({ g: f, phase: i * 0.9 });
  }
  const backFlags = flags.filter((_, i) => {
    const a = (i / nF) * Math.PI * 2 + 0.2;
    return Math.cos(a) + Math.sin(a) < 0;
  });
  const frontFlags = flags.filter((f) => !backFlags.includes(f));
  flood.alpha = 0;
  flood.blendMode = "add";
  for (const s of shimmer) s.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 58), back, ...shimmer, ...backFlags.map((f) => f.g), g, frontG, ...frontFlags.map((f) => f.g), flood, redLight);
  let t = 0;
  return {
    views: [view],
    tintables: [back, g, frontG, ...flags.map((f) => f.g)],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      const storm = ctx.storm();
      flood.alpha = n;
      shimmer.forEach((s, i) => (s.alpha = (0.25 + 0.35 * (1 - n * 0.5)) * (0.5 + 0.5 * Math.sin(t * 1.8 + i * Math.PI))));
      redLight.alpha = Math.max(0.1, n) * (t % 2 < 0.5 ? 1 : 0.08);
      for (const f of flags) {
        f.g.scale.x = 0.82 + 0.18 * Math.sin(t * (3 + storm * 4) + f.phase);
        f.g.skew.y = 0.12 * Math.sin(t * (4 + storm * 5) + f.phase * 1.3);
      }
    },
  };
};

// ------------------------------------------------------------ orchard

interface OrchardTree {
  px: number;
  py: number;
  seed: number;
}

const FRUIT_SUMMER = [0xe53935, 0xffa726];

/** Draw one tree's seasonal crown (trunk is static and drawn elsewhere). */
function drawCrown(g: Graphics, tr: OrchardTree, season: Season): void {
  const rng = rngFor("coast-orchard-crown", tr.seed);
  const c = { x: tr.px, y: tr.py - 20 };
  if (season === "winter") {
    for (const [dx, dy] of [[-8, -8], [7, -9], [-3, -13], [4, -4], [-6, -2]] as const) {
      g.moveTo(tr.px, tr.py - 12).lineTo(c.x + dx, c.y + dy).stroke({ width: 1.2, color: 0x6d4c41, cap: "round" });
      g.moveTo(c.x + dx * 0.6, c.y + dy * 0.6).lineTo(c.x + dx * 1.2, c.y + dy * 1.2 - 3).stroke({ width: 0.8, color: 0x6d4c41, cap: "round" });
    }
    return;
  }
  const leaf = season === "spring" ? 0x7cc464 : season === "summer" ? 0x2e8b3a : rng() < 0.5 ? 0xe67e22 : 0xd35400;
  g.circle(c.x + 3, c.y + 2, 10.5).fill(shade(leaf, 0.72));
  g.circle(c.x - 2, c.y, 10.5).fill(leaf);
  g.circle(c.x - 4, c.y - 3.5, 5.5).fill(shade(leaf, 1.18));
  if (season === "spring") {
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2, r = rng() * 9;
      g.circle(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.9, 1.7).fill(i % 3 ? 0xf8bbd0 : 0xffffff);
    }
  } else if (season === "summer") {
    const fruit = FRUIT_SUMMER[tr.seed % 2];
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2, r = 3 + rng() * 6;
      const fx = c.x + Math.cos(a) * r, fy = c.y + Math.sin(a) * r * 0.9 + 2;
      g.circle(fx, fy, 1.9).fill(fruit);
      g.circle(fx - 0.6, fy - 0.6, 0.6).fill(0xffffff);
    }
  } else {
    // Fall: a few leaves on the ground under the tree.
    for (let i = 0; i < 5; i++) g.circle(tr.px + (rng() - 0.5) * 16, tr.py + (rng() - 0.3) * 5, 1.3).fill(i % 2 ? 0xe67e22 : 0xc0392b);
  }
}

/**
 * Neat rows of small round fruit trees whose look follows the season (pink
 * blossoms, green with fruit, orange leaves, bare branches) and a fruit stand
 * with a striped awning at the front corner.
 */
export const orchard: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const ground = new Graphics();
  const soil = 0x7cae4a;
  box(ground, x + 0.03, y + 0.03, w - 0.06, d - 0.06, 0, 2, soil, 0x8fc257);
  const step = 0.75;
  const nx = Math.max(1, Math.floor((w - 0.2) / step)), ny = Math.max(1, Math.floor((d - 0.2) / step));
  const colX = (i: number) => x + ((i + 0.5) * w) / nx;
  const rowY = (j: number) => y + ((j + 0.5) * d) / ny;
  // Stand in the front-left corner; trees in that cell are skipped.
  const standX = x + 0.12, standY = y + d - 0.75, standW = Math.min(0.95, w * 0.34), standD = 0.5;
  for (let j = 0; j < ny; j++) {
    const a = iso(x + 0.15, rowY(j), 2), b = iso(x + w - 0.15, rowY(j), 2);
    ground.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 5, color: 0x8b6b43, alpha: 0.45, cap: "round" });
  }
  const views: Container[] = [layer(depthOf(x, y, 5), ground)];
  const tintables: Container[] = [ground];
  const crowns: { g: Graphics; trees: OrchardTree[] }[] = [];
  for (let j = 0; j < ny; j++) {
    const trunks = new Graphics();
    const crown = new Graphics();
    const trees: OrchardTree[] = [];
    for (let i = 0; i < nx; i++) {
      const tx = colX(i), ty = rowY(j);
      if (tx < standX + standW + 0.15 && ty > standY - 0.15) continue;
      const p = iso(tx, ty, 2);
      trunks.ellipse(p.x + 4, p.y + 1, 11, 4.5).fill({ color: 0x000000, alpha: 0.14 });
      trunks.moveTo(p.x, p.y).lineTo(p.x, p.y - 13).stroke({ width: 3, color: 0x6d4c41, cap: "round" });
      trees.push({ px: p.x, py: p.y, seed: (i * 31 + j * 17 + x * 7 + y * 13) >>> 0 });
    }
    if (!trees.length) continue;
    crowns.push({ g: crown, trees });
    views.push(layer(depthOf(x + w - 1, Math.floor(rowY(j)), 50), trunks, crown));
    tintables.push(trunks, crown);
  }
  let season = ctx.clock.season;
  const paint = () => {
    for (const c of crowns) {
      c.g.clear();
      for (const tr of c.trees) drawCrown(c.g, tr, season);
    }
  };
  paint();
  // Fruit stand: counter, crates of produce, and a striped awning on posts.
  const sg = new Graphics();
  const sLit = new Graphics();
  const crates = new Graphics();
  box(sg, standX, standY, standW, standD, 2, 12, 0xa1774f, 0xc49a6c);
  for (const px of [standX + 0.03, standX + standW - 0.05]) {
    line3(sg, [px, standY + 0.03, 2], [px, standY + 0.03, 30], 1.4, 0x8d6e63);
    line3(sg, [px, standY + standD, 2], [px, standY + standD, 24], 1.4, 0x6d4c41);
  }
  const nStripe = 6;
  for (let s = 0; s < nStripe; s++) {
    const xa = standX - 0.04 + ((standW + 0.08) * s) / nStripe, xb = standX - 0.04 + ((standW + 0.08) * (s + 1)) / nStripe;
    const col = s % 2 ? 0xffffff : 0xe53935;
    sg.poly(flat([iso(xa, standY, 30), iso(xb, standY, 30), iso(xb, standY + standD + 0.1, 23), iso(xa, standY + standD + 0.1, 23)])).fill(col);
    sg.poly(quadY(xa, xb, standY + standD + 0.1, 20, 23)).fill(shade(col, 0.92));
  }
  sg.poly(quadX(standX + standW + 0.04, standY, standY + standD + 0.1, 23, 30)).fill(0xc62828);
  const bulbs: Pt[] = [];
  for (let s = 0; s <= 5; s++) bulbs.push(iso(standX + (standW * s) / 5, standY + standD + 0.1, 19.5));
  for (const p of bulbs) bulb(sLit, p, 1.2, 0xffe6a0);
  sLit.alpha = 0;
  sLit.blendMode = "add";
  const paintCrates = () => {
    crates.clear();
    const fruit = season === "spring" ? [0xff5a7a, 0xffd54f] : season === "summer" ? [0xe53935, 0xffa726] : season === "fall" ? [0xc62828, 0xff8f00] : [0xff8f00, 0xf5f5f5];
    for (let k = 0; k < 3; k++) {
      const cx0 = standX + 0.06 + k * ((standW - 0.12) / 3);
      const cw = (standW - 0.12) / 3 - 0.03;
      box(crates, cx0, standY + 0.12, cw, standD - 0.2, 12, 16, 0x8d6e63);
      for (let f = 0; f < 5; f++) {
        const p = iso(cx0 + cw * (0.2 + (f % 3) * 0.3), standY + 0.2 + (standD - 0.35) * (f < 3 ? 0.3 : 0.75), 16);
        crates.circle(p.x, p.y - 1, 2).fill(fruit[(k + f) % 2]);
      }
    }
  };
  paintCrates();
  views.push(layer(depthOf(Math.floor(standX + standW), Math.floor(standY + standD), 56), sg, crates, sLit));
  tintables.push(sg, crates);
  return {
    views,
    tintables,
    update: () => {
      sLit.alpha = ctx.night();
      const s = ctx.clock.season;
      if (s !== season) {
        season = s;
        paint();
        paintCrates();
      }
    },
  };
};

export const COAST_LANDMARKS: Record<string, LandmarkFactory> = {
  riverboat,
  "casino-strip": casinoStrip,
  "ferris-wheel": ferrisWheel,
  "fishing-harbor": fishingHarbor,
  "music-row": musicRow,
  monument,
  orchard,
};
