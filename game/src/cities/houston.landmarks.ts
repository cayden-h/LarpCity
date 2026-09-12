// Houston's landmarks, drawn as toy-brick models with animated parts.
// Stylized shapes only: no logos or real signage.

import { Container, Graphics } from "pixi.js";
import { buildBrick } from "../engine/bricks";
import { shade } from "../engine/color";
import { BRIDGE_Z } from "../engine/ground";
import { depthOf, iso } from "../engine/iso";
import { box, cone, cylinder, layer, line3 } from "../engine/shapes";
import type { LandmarkFactory } from "../engine/types";

/** Rice University's Lovett Hall: tan arcade, red tile roof, central sallyport tower. */
export const lovettHall: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lit = new Graphics();
  const wall = 0xdcc39b;
  const x0 = x + 0.1, y0 = y + 0.2, ww = w - 0.2, dd = d - 0.4;
  box(g, x0, y0, ww, dd, 0, 40, wall);
  // Arcade of arches on the front face, windows above.
  const face = y0 + dd;
  for (let i = 0; i < 10; i++) {
    const t = x0 + ((i + 0.5) * ww) / 10;
    if (Math.abs(t - (x0 + ww / 2)) < 0.3) continue;
    const pts: number[] = [];
    for (const [dx, z] of [[-0.1, 3], [0.1, 3], [0.1, 13]] as const) {
      const p = iso(t + dx, face, z);
      pts.push(p.x, p.y);
    }
    for (let k = 0; k <= 6; k++) {
      const ang = (k / 6) * Math.PI;
      const p = iso(t + Math.cos(ang) * 0.1, face, 13 + Math.sin(ang) * 5);
      pts.push(p.x, p.y);
    }
    const p = iso(t - 0.1, face, 3);
    pts.push(p.x, p.y);
    g.poly(pts).fill(0x6d4c3b);
    const wq = [iso(t - 0.06, face, 26), iso(t + 0.06, face, 26), iso(t + 0.06, face, 34), iso(t - 0.06, face, 34)];
    g.poly(wq.flatMap((q) => [q.x, q.y])).fill(0x8ec9ea);
    lit.poly(wq.flatMap((q) => [q.x, q.y])).fill(0xffd47e);
  }
  // Hip roof in red tile.
  const T = iso(x0, y0, 40), R = iso(x0 + ww, y0, 40), B = iso(x0 + ww, y0 + dd, 40), L = iso(x0, y0 + dd, 40);
  const r0 = iso(x0 + 0.4, y0 + dd / 2, 54), r1 = iso(x0 + ww - 0.4, y0 + dd / 2, 54);
  g.poly([T.x, T.y, R.x, R.y, r1.x, r1.y, r0.x, r0.y]).fill(0x9c3f2c);
  g.poly([R.x, R.y, B.x, B.y, r1.x, r1.y]).fill(0x8a3526);
  g.poly([L.x, L.y, B.x, B.y, r1.x, r1.y, r0.x, r0.y]).fill(0xb5543c);
  // Central tower with the sallyport arch.
  const cx = x0 + ww / 2 - 0.35;
  box(g, cx, y0 - 0.05, 0.7, dd + 0.1, 0, 66, shade(wall, 1.03));
  const arch = [iso(cx + 0.18, face + 0.05, 0), iso(cx + 0.52, face + 0.05, 0), iso(cx + 0.52, face + 0.05, 22), iso(cx + 0.35, face + 0.05, 30), iso(cx + 0.18, face + 0.05, 22)];
  g.poly(arch.flatMap((q) => [q.x, q.y])).fill(0x4e342e);
  const tT = iso(cx, y0 - 0.05, 66), tR = iso(cx + 0.7, y0 - 0.05, 66), tB = iso(cx + 0.7, y0 + dd + 0.05, 66), tL = iso(cx, y0 + dd + 0.05, 66);
  const apex = iso(cx + 0.35, y0 + dd / 2, 84);
  g.poly([tT.x, tT.y, tR.x, tR.y, apex.x, apex.y]).fill(0x8a3526);
  g.poly([tL.x, tL.y, tB.x, tB.y, apex.x, apex.y]).fill(0xb5543c);
  g.poly([tB.x, tB.y, tR.x, tR.y, apex.x, apex.y]).fill(0x7a2f22);
  lit.alpha = 0;
  lit.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lit);
  return { views: [view], tintables: [g], update: () => (lit.alpha = ctx.night()) };
};

/** A standing moon rocket on its pad with a red launch tower and venting steam. */
export const spaceRocket: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const steam = new Graphics();
  const lights = new Graphics();
  box(g, x + 0.05, y + 0.05, w - 0.1, d - 0.1, 0, 6, 0xb0b5ba);
  // Launch tower lattice.
  const tx = x + 0.25, ty = y + 0.25;
  box(g, tx, ty, 0.35, 0.35, 6, 176, 0xc0392b);
  for (let z = 16; z < 176; z += 14) {
    line3(g, [tx, ty + 0.35, z], [tx + 0.35, ty + 0.35, z + 10], 1.4, 0x7f1d14);
    line3(g, [tx + 0.35, ty + 0.35, z], [tx + 0.35, ty, z + 10], 1.4, 0x6b1810);
  }
  line3(g, [tx + 0.35, ty + 0.3, 130], [x + 1.15, y + 1.0, 130], 3, 0x9e9e9e);
  // Rocket body with black bands, nose cone, and fins.
  const cx = x + 1.2, cy = y + 1.2;
  cylinder(g, cx, cy, 11, 6, 150, 0xf4f4f4);
  for (const [z0, z1] of [[30, 38], [86, 92], [122, 126]] as const) cylinder(g, cx, cy, 11.2, z0, z1, 0x2b2b2b);
  cone(g, cx, cy, 11, 150, 26, 0xf4f4f4);
  line3(g, [cx, cy, 176], [cx, cy, 190], 1.5, 0xdddddd);
  const base = iso(cx, cy, 8);
  for (const dx of [-15, 15]) g.poly([base.x + dx * 0.7, base.y - 22, base.x + dx * 1.2, base.y + 2, base.x + dx * 0.55, base.y + 2]).fill(0x2b2b2b);
  lights.circle(iso(tx + 0.17, ty + 0.17, 178).x, iso(tx + 0.17, ty + 0.17, 178).y, 3).fill(0xff3b30);
  lights.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, steam, lights);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      steam.clear();
      for (let i = 0; i < 5; i++) {
        const k = (t * 0.5 + i / 5) % 1;
        const p = iso(cx + 0.25, cy + 0.1, 10 + k * 28);
        steam.circle(p.x + k * 14, p.y, 5 + k * 9).fill({ color: 0xffffff, alpha: 0.55 * (1 - k) });
      }
      lights.alpha = ctx.night() * (0.5 + 0.5 * Math.sin(t * 4));
    },
  };
};

/** Cable-stayed ship channel bridge: two A-frame pylons and fans of cables over the deck. */
export const shipChannelBridge: LandmarkFactory = ({ x, y, w }, ctx) => {
  const deckY0 = y + 0.04, deckY1 = y + 0.96;
  const pylonX = [x + 0.75, x + w - 0.75];
  const top = 150;
  const views: Container[] = [];
  const tintables: Container[] = [];
  const lights = new Graphics();
  pylonX.forEach((px, i) => {
    const g = new Graphics();
    // Fan of cables from the pylon top down to both deck edges.
    for (const side of [deckY0, deckY1])
      for (let k = -4; k <= 4; k++) {
        if (k === 0) continue;
        line3(g, [px, y + 0.5, top - 10], [px + k * 0.3, side, BRIDGE_Z + 4], 1, 0xf3f3f3, 0.9);
      }
    // A-frame legs from the deck edges meeting at the top.
    const legColor = 0xd8d2c4;
    for (const side of [deckY0, deckY1]) {
      const a = iso(px, side, BRIDGE_Z - 20), b = iso(px, y + 0.5, top);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 7, color: side === deckY0 ? shade(legColor, 0.8) : legColor, cap: "round" });
    }
    line3(g, [px, deckY0, 60], [px, deckY1, 60], 5, shade(legColor, 0.9));
    const apex = iso(px, y + 0.5, top + 4);
    lights.circle(apex.x, apex.y, 3).fill(0xff3b30);
    views.push(layer(depthOf(Math.floor(px), y, 90 + i), g));
    tintables.push(g);
  });
  // Deck edge lights.
  for (let k = 0; k <= w * 3; k++) {
    for (const side of [deckY0, deckY1]) {
      const p = iso(x + k / 3, side, BRIDGE_Z + 6);
      lights.circle(p.x, p.y, 1.6).fill(0xfff1b8);
    }
  }
  lights.blendMode = "add";
  views.push(layer(depthOf(x + w, y, 95), lights));
  let t = 0;
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      lights.alpha = ctx.night() * (0.8 + 0.2 * Math.sin(t * 3));
    },
  };
};

/** Refinery by the channel: storage tanks, striped stacks with a flickering flare. */
export const refinery: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const flare = new Graphics();
  const lights = new Graphics();
  box(g, x + 0.05, y + 0.05, w - 0.1, d - 0.1, 0, 3, 0xa7a9ac);
  const tanks: [number, number][] = [[x + 0.7, y + 0.8], [x + 0.7, y + 2.1], [x + 1.9, y + 1.4]];
  // Pipes first so tanks overlap them.
  line3(g, [x + 0.7, y + 0.8, 10], [x + 2.4, y + 3.2, 10], 3, 0x8d8f93);
  line3(g, [x + 0.7, y + 2.1, 14], [x + 1.9, y + 1.4, 14], 3, 0x8d8f93);
  for (const [tx, ty] of tanks) {
    cylinder(g, tx, ty, 19, 3, 30, 0xf1f1ee);
    cylinder(g, tx, ty, 19.2, 18, 21, 0xd84315);
  }
  const stacks: [number, number][] = [[x + 2.4, y + 3.2], [x + 2.6, y + 2.4]];
  stacks.forEach(([sx, sy], i) => {
    const hgt = i === 0 ? 118 : 92;
    cylinder(g, sx, sy, 5, 3, hgt, 0xeeeeee);
    for (let z = 12; z < hgt; z += 22) cylinder(g, sx, sy, 5.2, z, z + 10, 0xd84315);
    const p = iso(sx, sy, hgt);
    lights.circle(p.x, p.y + 20, 2).fill(0xffd47e);
  });
  lights.blendMode = "add";
  const flareAt = iso(stacks[0][0], stacks[0][1], 118);
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, flare, lights);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const f = 0.8 + 0.25 * Math.sin(t * 13) + 0.15 * Math.sin(t * 7.3);
      flare.clear();
      flare.ellipse(flareAt.x, flareAt.y - 8 * f, 5 * f, 10 * f).fill({ color: 0xff9800, alpha: 0.9 });
      flare.ellipse(flareAt.x, flareAt.y - 5 * f, 2.5 * f, 5 * f).fill({ color: 0xfff176, alpha: 0.95 });
      lights.alpha = ctx.night();
    },
  };
};

/** The domed stadium: stacked rings, a white lattice dome, and a ring of lights at night. */
export const astrodome: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lights = new Graphics();
  const c = iso(x + w / 2, y + d / 2, 0);
  const rx = (w + d) * 17, ry = rx / 2;
  g.ellipse(c.x, c.y, rx + 8, ry + 4).fill(0x9ea3a8);
  g.rect(c.x - rx, c.y - 22, rx * 2, 22).fill(0xcfd3d6);
  g.ellipse(c.x, c.y, rx, ry).fill(0xb9bec2);
  g.rect(c.x - rx, c.y - 22, rx * 2, 22).fill(0xdfe3e6);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI;
    const px = c.x - Math.cos(a) * rx;
    g.moveTo(px, c.y - 22 + Math.sin(a) * ry * 0.05).lineTo(px, c.y + Math.sin(a) * ry - 2).stroke({ width: 1, color: 0xaab0b5 });
  }
  g.ellipse(c.x, c.y - 22, rx, ry).fill(0xeef1f3);
  g.ellipse(c.x, c.y - 30, rx * 0.88, ry * 0.9).fill(0xf8fafb);
  g.ellipse(c.x, c.y - 36, rx * 0.66, ry * 0.7).fill(0xffffff);
  for (let k = 1; k < 6; k++) g.ellipse(c.x, c.y - 26 - k * 2, rx * (1 - k * 0.13), ry * (1 - k * 0.12)).stroke({ width: 1, color: 0xc8ced3, alpha: 0.8 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    lights.circle(c.x + Math.cos(a) * rx, c.y - 22 + Math.sin(a) * ry, 2).fill(0xfff1b8);
  }
  lights.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 55), g, lights);
  return { views: [view], tintables: [g], update: () => (lights.alpha = ctx.night()) };
};

/** A tall glass tower with a rotating beacon on top. */
export const beaconTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const built = buildBrick({ x: x + 0.1, y: y + 0.1, w: w - 0.2, d: d - 0.2, floors: 22, wall: 0x6a8fb3, trim: 0xdfe6ec, roof: 0x9aa4ae, roofType: "flat", glass: true, seed: 4242 });
  const beam = new Graphics();
  const top = iso(x + w / 2, y + d / 2, built.topZ + 10);
  const cap = new Graphics();
  box(cap, x + 0.45, y + 0.45, w - 0.9, d - 0.9, built.topZ, built.topZ + 10, 0xdfe6ec);
  beam.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), built.view, cap, beam);
  let t = 0;
  return {
    views: [view],
    tintables: [built.view.children[0] as Container, cap],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      built.lights.alpha = n;
      beam.clear();
      if (n > 0.05) {
        const a = t * 1.2;
        const len = 260;
        const ex = Math.cos(a) * len, ey = Math.sin(a) * len * 0.5;
        const px = -Math.sin(a) * 14, py = Math.cos(a) * 7;
        beam.poly([top.x, top.y, top.x + ex + px, top.y + ey + py, top.x + ex - px, top.y + ey - py]).fill({ color: 0xfff6c8, alpha: 0.22 * n });
        beam.circle(top.x, top.y, 4).fill({ color: 0xfffbe0, alpha: n });
      }
    },
  };
};
