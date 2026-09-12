// Austin's landmarks, drawn as toy-brick models with animated parts.
// Stylized shapes only: no logos, mascots, or real signage.

import { Container, Graphics } from "pixi.js";
import { buildBrick } from "../engine/bricks";
import { goldenAt } from "../engine/clock";
import { shade } from "../engine/color";
import { BRIDGE_Z, WATER_Z } from "../engine/ground";
import { depthOf, iso } from "../engine/iso";
import { rngFor } from "../engine/rng";
import { box, cone, cylinder, layer, line3 } from "../engine/shapes";
import type { LandmarkFactory } from "../engine/types";

const LIT = 0xffd47e;
const GLASS = 0x7fa7bd;

type P3 = [number, number, number];

/** Fill a polygon given in tile space (x, y, z). */
function poly3(g: Graphics, pts: P3[], color: number, alpha = 1): void {
  g.poly(pts.flatMap(([a, b, c]) => {
    const p = iso(a, b, c);
    return [p.x, p.y];
  })).fill({ color, alpha });
}

/** Window quad on a face of constant y (a "left" face) or constant x (a "right" face). */
function faceQuad(side: "y" | "x", plane: number, t0: number, t1: number, z0: number, z1: number): P3[] {
  return side === "y"
    ? [[t0, plane, z0], [t1, plane, z0], [t1, plane, z1], [t0, plane, z1]]
    : [[plane, t0, z0], [plane, t1, z0], [plane, t1, z1], [plane, t0, z1]];
}

/** The pink granite capitol: long columned wings, a tall drum and dome, and a statue on top. */
export const atxCapitol: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const PINK = 0xd08a78, CREAM = 0xf1e6cf, DOME = 0xe3ac98;
  const x0 = x + 0.2, y0 = y + 0.55, ww = w - 0.4, dd = d - 1.1;
  const cx = x + w / 2, cy = y0 + dd / 2;
  // Terrace and steps, then the main block with a cream cornice and taller end pavilions.
  box(g, x + 0.05, y + 0.3, w - 0.1, d - 0.45, 0, 6, 0xcfc4b0);
  box(g, x0, y0, ww, dd, 6, 48, PINK);
  const yf = y0 + dd, xf = x0 + ww;
  for (const [z0, z1] of [[12, 22], [28, 38]] as const) {
    for (let i = 0; i < 12; i++) {
      const t = x0 + ((i + 0.5) * ww) / 12;
      if (Math.abs(t - cx) < 0.55) continue;
      const q = faceQuad("y", yf, t - 0.06, t + 0.06, z0, z1);
      poly3(g, q, GLASS);
      poly3(lit, q, LIT);
    }
    for (let j = 0; j < 8; j++) {
      const t = y0 + ((j + 0.5) * dd) / 8;
      const q = faceQuad("x", xf, t - 0.06, t + 0.06, z0, z1);
      poly3(g, q, shade(GLASS, 0.82));
      poly3(lit, q, LIT);
    }
  }
  box(g, x0 - 0.03, y0 - 0.03, ww + 0.06, dd + 0.06, 48, 51, CREAM);
  box(g, x0, y0, 0.55, dd, 51, 60, PINK);
  box(g, x0 + ww - 0.55, y0, 0.55, dd, 51, 60, PINK);
  // Front portico: columns and a pediment.
  box(g, cx - 0.45, yf, 0.9, 0.22, 6, 46, CREAM);
  const pf = yf + 0.23;
  for (let i = 0; i < 6; i++) {
    const t = cx - 0.38 + (0.76 * i) / 5;
    line3(g, [t, pf, 8], [t, pf, 42], 3, 0xffffff);
  }
  poly3(g, [[cx - 0.47, pf, 46], [cx + 0.47, pf, 46], [cx, pf, 60]], shade(CREAM, 0.94));
  poly3(lit, faceQuad("y", pf - 0.01, cx - 0.3, cx + 0.3, 10, 30), LIT, 0.6);
  // Drum: a cream ring, a pink colonnade with lit windows, a cornice.
  cylinder(g, cx, cy, 31, 51, 62, CREAM);
  cylinder(g, cx, cy, 26, 62, 90, PINK);
  const d0 = iso(cx, cy, 62), d1 = iso(cx, cy, 90);
  for (let k = -5; k <= 5; k++) g.rect(d0.x + k * 4.5 - 1, d1.y, 2, d0.y - d1.y).fill(0xfbf3e4);
  for (let k = -4; k <= 4; k++) lit.rect(d0.x + k * 4.5 + 0.8, d1.y + 6, 2.4, 14).fill(LIT);
  cylinder(g, cx, cy, 28, 90, 94, CREAM);
  // Tall dome with ribs and a highlight.
  const base = iso(cx, cy, 94);
  const RX = 25, RY = 46;
  const dome: number[] = [];
  for (let k = 0; k <= 20; k++) {
    const a = (k / 20) * Math.PI;
    dome.push(base.x - Math.cos(a) * RX, base.y - Math.sin(a) * RY);
  }
  g.poly(dome).fill(DOME);
  const hl: number[] = [base.x, base.y];
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * (Math.PI / 2);
    hl.push(base.x - Math.cos(a) * RX, base.y - Math.sin(a) * RY);
  }
  g.poly(hl).fill({ color: 0xffffff, alpha: 0.2 });
  for (const k of [-0.66, -0.33, 0, 0.33, 0.66]) {
    for (let s = 0; s <= 10; s++) {
      const phi = (s / 10) * (Math.PI / 2);
      const px = base.x + k * RX * Math.cos(phi), py = base.y - RY * Math.sin(phi);
      if (s === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  }
  g.stroke({ width: 1, color: shade(DOME, 0.72), alpha: 0.7 });
  // Lantern, cap, and the statue with a raised star.
  const topZ = 94 + RY;
  cylinder(g, cx, cy, 7, topZ - 2, topZ + 14, CREAM);
  cone(g, cx, cy, 8, topZ + 14, 7, DOME);
  const s = iso(cx, cy, topZ + 21);
  const STATUE = 0xe6dcc2;
  g.rect(s.x - 2.5, s.y - 3, 5, 3).fill(shade(STATUE, 0.8));
  g.poly([s.x - 3, s.y - 3, s.x + 3, s.y - 3, s.x + 1.8, s.y - 15, s.x - 1.8, s.y - 15]).fill(STATUE);
  g.circle(s.x, s.y - 17, 2.2).fill(STATUE);
  g.moveTo(s.x + 1.2, s.y - 13).lineTo(s.x + 4.5, s.y - 23).stroke({ width: 1.6, color: STATUE, cap: "round" });
  const star: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 1.3 : 3.2;
    star.push(s.x + 4.5 + Math.cos(a) * r, s.y - 25.5 + Math.sin(a) * r);
  }
  g.poly(star).fill(0xf2d27a);
  const lantern = iso(cx, cy, topZ + 6);
  lit.ellipse(lantern.x, lantern.y, 5, 6).fill(LIT);
  lit.circle(lantern.x, lantern.y, 14).fill({ color: LIT, alpha: 0.18 });
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit);
  return { views: [view], tintables: [g], update: () => (lit.alpha = ctx.night()) };
};

/** A slim cream campus clock tower on its main building, with a red-tile cap whose top glows orange at night. */
export const atxCampusTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const CREAM = 0xefe4c8, TILE = 0xb5543c, SLOT = 0xb7a784;
  // The main building at the foot of the tower.
  box(g, x + 0.1, y + 0.25, w - 0.2, d - 0.5, 0, 34, CREAM);
  const bf = y + d - 0.25;
  for (let i = 0; i < 9; i++) {
    const t = x + 0.1 + ((i + 0.5) * (w - 0.2)) / 9;
    const q = faceQuad("y", bf, t - 0.05, t + 0.05, 8, 26);
    poly3(g, q, GLASS);
    poly3(lit, q, LIT);
  }
  box(g, x + 0.06, y + 0.21, w - 0.12, d - 0.42, 34, 38, TILE);
  // The shaft with recessed window slots.
  const tx = x + w / 2 - 0.28, ty = y + d / 2 - 0.28, s = 0.56;
  box(g, tx, ty, s, s, 38, 176, CREAM);
  for (const f of [0.3, 0.7]) {
    line3(g, [tx + s * f, ty + s, 50], [tx + s * f, ty + s, 146], 2, SLOT);
    line3(g, [tx + s, ty + s * f, 50], [tx + s, ty + s * f, 146], 2, shade(SLOT, 0.85));
  }
  // Clock faces on both visible sides.
  for (const c of [iso(tx + s / 2, ty + s, 158), iso(tx + s, ty + s / 2, 158)]) {
    g.circle(c.x, c.y, 6.5).fill(0x6d5a3a);
    g.circle(c.x, c.y, 5.2).fill(0xfbf6e8);
    g.moveTo(c.x, c.y).lineTo(c.x, c.y - 4).moveTo(c.x, c.y).lineTo(c.x + 3, c.y + 1).stroke({ width: 1, color: 0x3a3226 });
  }
  // Belvedere: a colonnade of openings.
  const bx = tx + 0.04, by = ty + 0.04, bs = s - 0.08;
  box(g, bx, by, bs, bs, 176, 196, CREAM);
  for (let i = 0; i < 3; i++) {
    const t0 = 0.08 + i * 0.3, t1 = t0 + 0.2;
    const qa = faceQuad("y", by + bs, bx + bs * t0, bx + bs * t1, 179, 193);
    const qb = faceQuad("x", bx + bs, by + bs * t0, by + bs * t1, 179, 193);
    poly3(g, qa, 0x4a3b2c);
    poly3(g, qb, 0x3b2f24);
    poly3(lit, qa, 0xffa040);
    poly3(lit, qb, 0xff9030);
  }
  box(g, tx - 0.03, ty - 0.03, s + 0.06, s + 0.06, 196, 200, CREAM);
  // Red-tile hip roof and finial.
  const ox = tx - 0.05, oy = ty - 0.05, os = s + 0.1;
  const T = iso(ox, oy, 200), R = iso(ox + os, oy, 200), B = iso(ox + os, oy + os, 200), L = iso(ox, oy + os, 200);
  const apex = iso(tx + s / 2, ty + s / 2, 224);
  g.poly([T.x, T.y, R.x, R.y, apex.x, apex.y]).fill(shade(TILE, 0.8));
  g.poly([T.x, T.y, L.x, L.y, apex.x, apex.y]).fill(shade(TILE, 0.9));
  g.poly([L.x, L.y, B.x, B.y, apex.x, apex.y]).fill(shade(TILE, 1.08));
  g.poly([B.x, B.y, R.x, R.y, apex.x, apex.y]).fill(shade(TILE, 0.74));
  g.moveTo(apex.x, apex.y).lineTo(apex.x, apex.y - 10).stroke({ width: 1.5, color: 0xd9c9a3 });
  // Night: the top floods orange.
  lit.poly([L.x, L.y, B.x, B.y, apex.x, apex.y]).fill({ color: 0xff8a1f, alpha: 0.75 });
  lit.poly([B.x, B.y, R.x, R.y, apex.x, apex.y]).fill({ color: 0xff7a14, alpha: 0.6 });
  const halo = iso(tx + s / 2, ty + s / 2, 200);
  lit.circle(halo.x, halo.y, 30).fill({ color: 0xff8a1f, alpha: 0.16 });
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit);
  return { views: [view], tintables: [g], update: () => (lit.alpha = ctx.night()) };
};

/** A glass tower whose crown has two pointed ears and two round eye windows. */
export const atxOwlTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const built = buildBrick({ x: x + 0.15, y: y + 0.15, w: w - 0.3, d: d - 0.3, floors: 16, wall: 0x7c9fb8, trim: 0xd9dfe4, roof: 0x9aa4ae, roofType: "flat", glass: true, seed: 5150 });
  const cr = new Graphics();
  const lit = new Graphics();
  const top = built.topZ;
  const GL = 0x8fb2c8;
  box(cr, x + 0.3, y + 0.3, w - 0.6, d - 0.6, top, top + 18, GL);
  // The head: a cap, then two faces cut into ears with a notch between them.
  const a = x + 0.45, b = x + w - 0.45, c = y + 0.45, e = y + d - 0.45;
  const mx = (a + b) / 2, my = (c + e) / 2;
  const h0 = top + 18, h1 = top + 40, notch = top + 48, ear = top + 64;
  box(cr, a, c, b - a, e - c, h0, h1, GL, shade(GL, 0.7));
  poly3(cr, [[a, e, h0], [a, e, ear], [mx, e, notch], [b, e, ear], [b, e, h0]], shade(GL, 0.97));
  poly3(cr, [[b, e, h0], [b, e, ear], [b, my, notch], [b, c, ear], [b, c, h0]], shade(GL, 0.76));
  line3(cr, [a, e, ear], [mx, e, notch], 1.5, 0xe8eef2);
  line3(cr, [mx, e, notch], [b, e, ear], 1.5, 0xe8eef2);
  line3(cr, [b, e, ear], [b, my, notch], 1.5, 0xd0d8de);
  line3(cr, [b, my, notch], [b, c, ear], 1.5, 0xd0d8de);
  // Eyes on both visible faces.
  const eyes = [iso(a + (b - a) * 0.27, e, top + 31), iso(a + (b - a) * 0.73, e, top + 31), iso(b, c + (e - c) * 0.27, top + 31), iso(b, c + (e - c) * 0.73, top + 31)];
  for (const p of eyes) {
    cr.circle(p.x, p.y, 7.5).fill(0xe8eef2);
    cr.circle(p.x, p.y, 5.8).fill(0x2f4b5f);
    cr.circle(p.x - 1.8, p.y - 1.8, 1.6).fill({ color: 0xffffff, alpha: 0.7 });
    lit.circle(p.x, p.y, 5.8).fill(0xfff0b0);
    lit.circle(p.x, p.y, 12).fill({ color: 0xfff0b0, alpha: 0.2 });
  }
  const mast = iso(x + w / 2, y + d / 2, h1);
  cr.moveTo(mast.x, mast.y).lineTo(mast.x, mast.y - 44).stroke({ width: 2, color: 0xd6dbe1 });
  const blink = new Graphics().circle(mast.x, mast.y - 45, 2.6).fill(0xff3b30);
  lit.alpha = 0;
  lit.blendMode = "add";
  blink.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), built.view, cr, lit, blink);
  let t = 0;
  return {
    views: [view],
    tintables: [built.view.children[0] as Container, cr],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      built.lights.alpha = n;
      lit.alpha = n;
      blink.alpha = (0.3 + 0.7 * n) * (Math.sin(t * 3) > 0.4 ? 1 : 0.15);
    },
  };
};

interface Bat {
  ox: number;
  oy: number;
  age: number;
  life: number;
  ph: number;
  spin: number;
  rise: number;
  size: number;
}

/**
 * The downtown avenue bridge: stone arches under the deck, lamps along the
 * rail, and at dusk a swarm of bats pouring out from under it and swirling up.
 */
export const atxBatBridge: LandmarkFactory = ({ x, y, d }, ctx) => {
  const views: Container[] = [];
  const tintables: Container[] = [];
  const STONE = 0xdccfb4;
  const xf = x + 1;
  const lamps = new Graphics();
  const glow = new Graphics();
  const crown = BRIDGE_Z - 3, foot = WATER_Z;
  for (let k = 0; k < d; k++) {
    const g = new Graphics();
    const y0 = y + k, y1 = y0 + 1;
    // Spandrel wall on the east face, with two arches per span.
    poly3(g, faceQuad("x", xf, y0, y1, foot, BRIDGE_Z), shade(STONE, 0.78));
    for (let a = 0; a < 2; a++) {
      const ya = y0 + a * 0.5 + 0.06, yb = y0 + a * 0.5 + 0.44;
      const pts: P3[] = [[xf, ya, foot]];
      for (let s = 0; s <= 10; s++) pts.push([xf, ya + ((yb - ya) * s) / 10, foot + 1 + Math.sin((s / 10) * Math.PI) * (crown - foot - 1)]);
      pts.push([xf, yb, foot]);
      poly3(g, pts, 0x2e4e5a);
      poly3(g, pts.slice(1, 6).concat([[xf, ya, foot]]), 0x3e6674, 0.5);
    }
    line3(g, [xf, y0, BRIDGE_Z], [xf, y1, BRIDGE_Z], 2, shade(STONE, 1.08));
    views.push(layer(depthOf(x, y + k, 8), g));
    tintables.push(g);
    // One lamp per span on the east rail.
    const lx = x + 0.93, ly = y0 + 0.5;
    line3(lamps, [lx, ly, BRIDGE_Z], [lx, ly, BRIDGE_Z + 20], 1.5, 0x3d3d3d);
    const head = iso(lx, ly, BRIDGE_Z + 21);
    lamps.circle(head.x, head.y, 2.4).fill(0xf5efe0);
    glow.circle(head.x, head.y, 2.4).fill(0xfff1b8);
    glow.circle(head.x, head.y, 8).fill({ color: 0xfff1b8, alpha: 0.25 });
  }
  glow.blendMode = "add";
  views.push(layer(depthOf(x, y + d - 1, 75), lamps, glow));
  tintables.push(lamps);

  // The bat swarm.
  const swarm = new Graphics();
  views.push(layer(depthOf(x + 2, y + d + 1, 90), swarm));
  const bats: Bat[] = [];
  // Seeded like everything else, so a dusk replays the same swarm.
  const rng = rngFor("atx-bats", x, y);
  let spawn = 0;
  let t = 0;
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      glow.alpha = ctx.night();
      const tod = ctx.clock.timeOfDay;
      const dusk = tod > 0.5 ? goldenAt(tod) : 0;
      if (dusk > 0.25) {
        spawn += dt * 110 * dusk;
        while (spawn >= 1 && bats.length < 240) {
          spawn -= 1;
          bats.push({
            ox: xf,
            oy: y + 0.2 + rng() * (d - 0.4),
            age: 0,
            life: 3.5 + rng() * 2.5,
            ph: rng() * Math.PI * 2,
            spin: (rng() < 0.5 ? -1 : 1) * (1.6 + rng() * 1.4),
            rise: 32 + rng() * 26,
            size: 2.6 + rng() * 1.6,
          });
        }
      } else spawn = 0;
      swarm.clear();
      for (let i = bats.length - 1; i >= 0; i--) {
        const bat = bats[i];
        bat.age += dt;
        if (bat.age >= bat.life) {
          bats.splice(i, 1);
          continue;
        }
        const k = bat.age;
        const ang = bat.ph + bat.spin * k;
        const r = 0.15 + 0.32 * k;
        const bx = bat.ox + 0.2 + 0.5 * k + Math.cos(ang) * r;
        const by = bat.oy + Math.sin(ang) * r - 0.3 * k;
        const bz = 1 + bat.rise * k + 8 * Math.sin(ang * 0.5);
        const p = iso(bx, by, bz);
        const flap = Math.sin(t * 26 + bat.ph * 5);
        const sz = bat.size;
        const alpha = Math.min(1, k * 3) * Math.min(1, (bat.life - k) * 1.2);
        swarm
          .poly([
            p.x - sz * 1.5, p.y - sz * 0.7 * flap - 1,
            p.x - sz * 0.4, p.y,
            p.x, p.y + sz * 0.4,
            p.x + sz * 0.4, p.y,
            p.x + sz * 1.5, p.y - sz * 0.7 * flap - 1,
            p.x, p.y - sz * 0.35,
          ])
          .fill({ color: 0x251d2c, alpha });
      }
    },
  };
};

/** A food-truck lot: colorful trucks with striped awnings, picnic tables, and string lights at night. */
export const atxFoodTrucks: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const BULBS = [0xffd47e, 0xff8a65, 0x80deea, 0xfff59d];
  const posts: P3[] = [[x + 0.08, y + 0.08, 0], [x + w - 0.08, y + 0.08, 0], [x + 0.08, y + d - 0.08, 0], [x + w - 0.08, y + d - 0.08, 0]];
  const POST_H = 38;
  const post = ([px, py]: P3) => {
    line3(g, [px, py, 0], [px, py, POST_H], 2.5, 0x5b4636);
  };
  const truck = (tx: number, ty: number, body: number, awning: number) => {
    const L = 0.68, D = 0.36;
    box(g, tx, ty, L, D, 4, 22, body);
    box(g, tx + L, ty + 0.04, 0.18, D - 0.06, 4, 15, shade(body, 0.88));
    poly3(g, faceQuad("x", tx + L + 0.18, ty + 0.08, ty + D - 0.06, 9, 14), 0x9fd3e6);
    box(g, tx + 0.2, ty + 0.1, 0.18, 0.14, 22, 26, 0xe6e6e6);
    const f = ty + D;
    for (const wx of [tx + 0.14, tx + L + 0.08]) {
      const c = iso(wx, f, 3);
      g.circle(c.x, c.y, 3.4).fill(0x2b2b2b);
      g.circle(c.x, c.y, 1.4).fill(0x9e9e9e);
    }
    const win = faceQuad("y", f, tx + 0.12, tx + 0.56, 9, 17);
    poly3(g, win, 0x3b2f2a);
    poly3(lit, win, LIT);
    const n = 6;
    for (let s = 0; s < n; s++) {
      const a = tx + 0.08 + (0.52 * s) / n, b = tx + 0.08 + (0.52 * (s + 1)) / n;
      poly3(g, [[a, f, 20], [b, f, 20], [b, f + 0.14, 16], [a, f + 0.14, 16]], s % 2 ? 0xffffff : awning);
    }
  };
  const table = (tx: number, ty: number, umbrella: number) => {
    box(g, tx, ty, 0.32, 0.16, 5, 7, 0xa0764f);
    box(g, tx, ty - 0.08, 0.32, 0.05, 2, 4, 0x8a6241);
    box(g, tx, ty + 0.19, 0.32, 0.05, 2, 4, 0x8a6241);
    const c: P3 = [tx + 0.16, ty + 0.08, 0];
    line3(g, [c[0], c[1], 7], [c[0], c[1], 26], 1.2, 0xeeeeee);
    const u = iso(c[0], c[1], 26);
    g.poly([u.x - 13, u.y + 4, u.x, u.y - 6, u.x + 13, u.y + 4]).fill(umbrella);
    g.poly([u.x - 13, u.y + 4, u.x - 3, u.y - 3, u.x, u.y - 6, u.x - 1, u.y + 4]).fill({ color: 0xffffff, alpha: 0.2 });
  };
  // Painter's order: back posts, back row of trucks, tables, front trucks, front posts, wires.
  post(posts[0]);
  post(posts[1]);
  truck(x + 0.12, y + 0.18, 0x3fb8af, 0xf06292);
  truck(x + 1.05, y + 0.18, 0xf2b134, 0x3a9e98);
  truck(x + 1.98, y + 0.22, 0xe57373, 0xfff176);
  table(x + 0.55, y + 1.25, 0xf06292);
  table(x + 1.35, y + 1.45, 0x4fb0c6);
  table(x + 2.15, y + 1.2, 0xf2b134);
  truck(x + 0.15, y + 2.3, 0x9ccc65, 0xff8a65);
  truck(x + 1.95, y + 2.35, 0x7e57c2, 0x80deea);
  post(posts[2]);
  post(posts[3]);
  let bulb = 0;
  for (const [i, j] of [[0, 3], [1, 2], [0, 1], [2, 3]] as const) {
    const [ax, ay] = posts[i], [bx, by] = posts[j];
    const at = (s: number): P3 => [ax + (bx - ax) * s, ay + (by - ay) * s, POST_H - 2 - Math.sin(s * Math.PI) * 10];
    for (let s = 0; s < 16; s++) line3(g, at(s / 16), at((s + 1) / 16), 1, 0x3a3226, 0.8);
    for (let s = 1; s < 12; s++) {
      const p = iso(...at(s / 12));
      const color = BULBS[bulb++ % BULBS.length];
      g.circle(p.x, p.y + 1.5, 1.5).fill(0xf3efe6);
      lit.circle(p.x, p.y + 1.5, 1.8).fill(color);
      lit.circle(p.x, p.y + 1.5, 5).fill({ color, alpha: 0.25 });
    }
  }
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      lit.alpha = ctx.night() * (0.88 + 0.12 * Math.sin(t * 2.5));
    },
  };
};

export const AUSTIN_LANDMARKS: Record<string, LandmarkFactory> = {
  "atx-capitol": atxCapitol,
  "atx-campus-tower": atxCampusTower,
  "atx-owl-tower": atxOwlTower,
  "atx-bat-bridge": atxBatBridge,
  "atx-food-trucks": atxFoodTrucks,
};
