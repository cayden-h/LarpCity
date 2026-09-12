// Dallas landmarks, drawn as toy-brick models with animated lights.
// Stylized shapes only: no logos, team names, or real signage.

import { Container, Graphics } from "pixi.js";
import { buildBrick } from "../engine/bricks";
import { shade } from "../engine/color";
import { BRIDGE_Z } from "../engine/ground";
import { depthOf, iso } from "../engine/iso";
import { box, cylinder, layer, line3 } from "../engine/shapes";
import type { LandmarkFactory } from "../engine/types";

/** A slim concrete tower topped by a lattice sphere whose lights pulse and chase at night. */
export const sphereTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lights = new Graphics();
  const cx = x + w / 2, cy = y + d / 2;
  const concrete = 0xd8d2c4;
  box(g, x + 0.2, y + 0.2, w - 0.4, d - 0.4, 0, 6, 0xcfc8ba);
  // Three outer shafts around a central core, back to front.
  cylinder(g, cx - 0.22, cy - 0.22, 4, 6, 176, shade(concrete, 0.92));
  cylinder(g, cx + 0.25, cy - 0.1, 4, 6, 176, concrete);
  cylinder(g, cx - 0.1, cy + 0.25, 4, 6, 176, concrete);
  cylinder(g, cx, cy, 6, 6, 184, shade(concrete, 1.04));
  // Observation collar under the sphere.
  cylinder(g, cx, cy, 16, 176, 188, 0x9aa4ae);
  cylinder(g, cx, cy, 14, 188, 192, 0xcfd6dc);
  // The sphere: a silver ball with latitude and meridian struts.
  const R = 27;
  const base = iso(cx, cy, 192);
  const c = { x: base.x, y: base.y - R + 4 };
  g.circle(c.x, c.y, R).fill(0xb8c4ce);
  g.circle(c.x - R * 0.3, c.y - R * 0.3, R * 0.55).fill({ color: 0xffffff, alpha: 0.22 });
  for (const a of [-60, -30, 0, 30, 60]) {
    const r = (a * Math.PI) / 180;
    g.ellipse(c.x, c.y - R * Math.sin(r), R * Math.cos(r), R * Math.cos(r) * 0.22).stroke({ width: 1, color: 0x7f8c97, alpha: 0.8 });
  }
  for (const b of [30, 60]) {
    const r = (b * Math.PI) / 180;
    g.ellipse(c.x, c.y, R * Math.sin(r), R).stroke({ width: 1, color: 0x7f8c97, alpha: 0.8 });
  }
  g.moveTo(c.x, c.y - R).lineTo(c.x, c.y + R).stroke({ width: 1, color: 0x7f8c97, alpha: 0.8 });
  g.moveTo(c.x, c.y - R).lineTo(c.x, c.y - R - 12).stroke({ width: 2, color: 0xd6dbe1 });
  // Light bulbs on the visible half of the sphere, as (screen point, longitude, latitude).
  const bulbs: { px: number; py: number; lon: number; lat: number }[] = [];
  for (let lat = -70; lat <= 70; lat += 17.5)
    for (let lon = -80; lon <= 80; lon += 20) {
      const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
      bulbs.push({ px: c.x + R * Math.cos(a) * Math.sin(b), py: c.y - R * Math.sin(a), lon: b, lat: a });
    }
  const collar = iso(cx, cy, 182);
  lights.blendMode = "add";
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lights);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      lights.clear();
      if (n < 0.02) return;
      const pulse = 0.75 + 0.25 * Math.sin(t * 1.3);
      lights.circle(c.x, c.y, R + 7).fill({ color: 0xfff1b8, alpha: 0.1 * n * pulse });
      for (const bulb of bulbs) {
        const chase = 0.5 + 0.5 * Math.sin(t * 3.5 - bulb.lon * 4 + bulb.lat * 2);
        lights.circle(bulb.px, bulb.py, 2.1).fill({ color: 0xfff1b8, alpha: n * (0.25 + 0.75 * chase) * pulse });
      }
      for (let k = 0; k < 8; k++) lights.circle(collar.x - 13 + k * 3.7, collar.y, 1.3).fill({ color: 0xffd47e, alpha: n });
    },
  };
};

/** A tall glass tower whose edges are outlined in green neon at night. */
export const outlineTower: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const bx = x + 0.2, by = y + 0.2, bw = w - 0.4, bd = d - 0.4;
  const built = buildBrick({ x: bx, y: by, w: bw, d: bd, floors: 24, wall: 0x5f8f86, trim: 0xdfe6ec, roof: 0x8a969f, roofType: "flat", glass: true, seed: 7171, litShare: 0.5 });
  const top = built.topZ;
  const cap = new Graphics();
  const ix = bx + 0.2, iy = by + 0.2, iw = bw - 0.4, id = bd - 0.4, capTop = top + 22;
  box(cap, ix, iy, iw, id, top, capTop, 0x9fb4b0);
  line3(cap, [ix + iw / 2, iy + id / 2, capTop], [ix + iw / 2, iy + id / 2, capTop + 40], 2, 0xd6dbe1);
  // Neon: the three visible vertical edges and the top rims of the shaft and crown.
  const neon = new Graphics();
  const outline = (x0: number, y0: number, ww: number, dd: number, z0: number, z1: number) => {
    const edges: [number, number, number, number][] = [
      [x0, y0 + dd, z0, z1], [x0 + ww, y0 + dd, z0, z1], [x0 + ww, y0, z0, z1],
    ];
    const rim = [iso(x0, y0, z1), iso(x0 + ww, y0, z1), iso(x0 + ww, y0 + dd, z1), iso(x0, y0 + dd, z1)];
    for (const [width, alpha] of [[7, 0.22], [2, 1]] as const) {
      for (const [ex, ey, a, b] of edges) line3(neon, [ex, ey, a], [ex, ey, b], width, 0x3dff6e, alpha);
      neon.poly(rim.flatMap((p) => [p.x, p.y]), true).stroke({ width, color: 0x3dff6e, alpha });
    }
  };
  outline(bx, by, bw, bd, 4, top);
  outline(ix, iy, iw, id, top, capTop);
  const beacon = iso(ix + iw / 2, iy + id / 2, capTop + 41);
  neon.circle(beacon.x, beacon.y, 2.6).fill(0xff3b30);
  neon.blendMode = "add";
  neon.alpha = 0;
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), built.view, cap, neon);
  let t = 0;
  return {
    views: [view],
    tintables: [built.view.children[0] as Container, cap],
    update: (dt) => {
      t += dt;
      const n = ctx.night();
      built.lights.alpha = n;
      neon.alpha = n * (0.9 + 0.1 * Math.sin(t * 2.2));
    },
  };
};

/** A white single-arch bridge over a Trinity crossing: a parabolic arch with a fan of cables to the deck. */
export const archBridge: LandmarkFactory = ({ x, y, w }, ctx) => {
  const deckY0 = y + 0.04, deckY1 = y + 0.96, mid = y + 0.5;
  const x0 = x + 0.05, x1 = x + w - 0.05;
  const peak = 120 + w * 10;
  const archZ = (ax: number) => {
    const s = (ax - x0) / (x1 - x0);
    return BRIDGE_Z + 4 * (peak - BRIDGE_Z) * s * (1 - s);
  };
  const views: Container[] = [];
  const tintables: Container[] = [];
  const white = 0xf4f4f0;
  // One slice per tile so the arch sorts correctly against traffic on the deck.
  for (let i = 0; i < w; i++) {
    const g = new Graphics();
    const a = Math.max(x0, x + i), b = Math.min(x1, x + i + 1);
    // Cables fan from the arch down to both deck edges, the far edge first.
    for (const side of [deckY0, deckY1])
      for (let k = 0; k < 4; k++) {
        const ax = a + ((k + 0.5) * (b - a)) / 4;
        const lean = (ax - (x0 + x1) / 2) * 0.25;
        line3(g, [ax, mid, archZ(ax) - 3], [ax - lean, side, BRIDGE_Z + 5], 1, 0xffffff, side === deckY0 ? 0.7 : 0.9);
      }
    // The arch rib itself: a thick white stroke with a shaded underside.
    const steps = 10;
    const pts: number[] = [];
    for (let s = 0; s <= steps; s++) {
      const ax = a + ((b - a) * s) / steps;
      const p = iso(ax, mid, archZ(ax));
      pts.push(p.x, p.y);
    }
    g.moveTo(pts[0], pts[1]);
    for (let s = 2; s < pts.length; s += 2) g.lineTo(pts[s], pts[s + 1]);
    g.stroke({ width: 8, color: shade(white, 0.82), cap: "round", join: "round" });
    g.moveTo(pts[0], pts[1] - 1.5);
    for (let s = 2; s < pts.length; s += 2) g.lineTo(pts[s], pts[s + 1] - 1.5);
    g.stroke({ width: 5, color: white, cap: "round", join: "round" });
    views.push(layer(depthOf(x + i, y, 90), g));
    tintables.push(g);
  }
  // Night: a string of lights up the arch and along both deck edges.
  const lights = new Graphics();
  for (let k = 0; k <= 24; k++) {
    const ax = x0 + ((x1 - x0) * k) / 24;
    const p = iso(ax, mid, archZ(ax) + 3);
    lights.circle(p.x, p.y, 1.8).fill(0xffffff);
  }
  for (let k = 0; k <= w * 3; k++)
    for (const side of [deckY0, deckY1]) {
      const p = iso(x + k / 3, side, BRIDGE_Z + 6);
      lights.circle(p.x, p.y, 1.6).fill(0xfff1b8);
    }
  lights.blendMode = "add";
  views.push(layer(depthOf(x + w - 1, y, 95), lights));
  let t = 0;
  return {
    views,
    tintables,
    update: (dt) => {
      t += dt;
      lights.alpha = ctx.night() * (0.85 + 0.15 * Math.sin(t * 2));
    },
  };
};

/** A huge oval stadium: a glass wall, a sloped silver roof, twin arches, and field lights at night. */
export const stadium: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lights = new Graphics();
  const c = iso(x + w / 2, y + d / 2, 0);
  const rx = (w + d) * 15, ry = rx / 2;
  const wallH = 30;
  const rimY = c.y - wallH;
  // Concourse apron.
  g.ellipse(c.x, c.y, rx + 10, ry + 5).fill(0xa7abae);
  // Sloped glass wall: base ellipse, band, and vertical mullions on the front half.
  g.ellipse(c.x, c.y, rx, ry).fill(0x5f7d95);
  g.rect(c.x - rx, rimY, rx * 2, wallH).fill(0x6f8fa8);
  g.rect(c.x - rx, rimY, rx * 0.5, wallH).fill(0x86a7bf);
  for (let i = 1; i < 28; i++) {
    const a = (i / 28) * Math.PI;
    const px = c.x - Math.cos(a) * rx;
    g.moveTo(px, rimY + Math.sin(a) * ry).lineTo(px, c.y + Math.sin(a) * ry - 1).stroke({ width: 1, color: 0xdfe8ef, alpha: 0.5 });
  }
  // Twin arches span the long axis; the far one goes behind the roof.
  const arch = (off: number, color: number) => {
    const base = rimY + off;
    const pts: number[] = [];
    for (let k = 0; k <= 24; k++) {
      const s = k / 24;
      pts.push(c.x - rx * 1.04 + 2 * rx * 1.04 * s, base - 78 * 4 * s * (1 - s));
    }
    g.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
    g.stroke({ width: 7, color: shade(color, 0.8), cap: "round", join: "round" });
    g.moveTo(pts[0], pts[1] - 1.5);
    for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1] - 1.5);
    g.stroke({ width: 4, color, cap: "round", join: "round" });
    return pts;
  };
  arch(-ry * 0.28, 0xd9dee2);
  // Sloped roof rising in rings toward the retractable center panel.
  g.ellipse(c.x, rimY, rx, ry).fill(0xd4dade);
  g.ellipse(c.x, rimY - 7, rx * 0.86, ry * 0.86).fill(0xe3e8eb);
  g.ellipse(c.x, rimY - 13, rx * 0.68, ry * 0.7).fill(0xeef1f3);
  for (let k = 1; k < 4; k++) g.ellipse(c.x, rimY - k * 4, rx * (1 - k * 0.1), ry * (1 - k * 0.1)).stroke({ width: 1, color: 0xbfc7cd, alpha: 0.7 });
  g.ellipse(c.x, rimY - 16, rx * 0.38, ry * 0.42).fill(0xc4ccd3);
  g.moveTo(c.x, rimY - 16 - ry * 0.42).lineTo(c.x, rimY - 16 + ry * 0.42).stroke({ width: 1.5, color: 0x9aa4ae });
  const front = arch(ry * 0.28, 0xf2f4f5);
  // Night: a glowing roof panel over the field, a ring of rim lights, and arch lights.
  lights.ellipse(c.x, rimY - 16, rx * 0.38, ry * 0.42).fill({ color: 0xfff6d8, alpha: 0.55 });
  lights.ellipse(c.x, rimY - 16, rx * 0.55, ry * 0.6).fill({ color: 0xfff6d8, alpha: 0.12 });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    lights.circle(c.x + Math.cos(a) * rx, rimY + Math.sin(a) * ry, 2).fill(0xfff1b8);
  }
  for (let k = 2; k < front.length - 2; k += 4) lights.circle(front[k], front[k + 1] - 2, 1.6).fill(0xffffff);
  lights.blendMode = "add";
  lights.alpha = 0;
  const view = layer(depthOf(x + w - 1, y + d - 1, 55), g, lights);
  let t = 0;
  return {
    views: [view],
    tintables: [g],
    update: (dt) => {
      t += dt;
      lights.alpha = ctx.night() * (0.85 + 0.15 * Math.sin(t * 1.7));
    },
  };
};

/** A giant pair of cowboy boots on a plaza, uplit at night. */
export const cowboyBoots: LandmarkFactory = ({ x, y, w, d }, ctx) => {
  const g = new Graphics();
  const lights = new Graphics();
  box(g, x + 0.15, y + 0.15, w - 0.3, d - 0.3, 0, 5, 0xd9c29a);
  const leather = 0x8a4b2a, sole = 0x3e2a1e, stitch = 0xe8c07a;
  // Each boot: heel and sole, a foot pointing toward +x, and a tall shaft. Back boot first.
  const boot = (bx: number, by: number) => {
    box(g, bx, by, 1.0, 0.36, 5, 9, sole);
    box(g, bx, by, 0.3, 0.36, 9, 16, sole);
    box(g, bx + 0.02, by + 0.02, 0.92, 0.32, 9, 26, leather);
    box(g, bx + 0.82, by + 0.07, 0.16, 0.22, 9, 20, shade(leather, 0.9));
    box(g, bx + 0.02, by + 0.02, 0.36, 0.32, 26, 78, leather);
    box(g, bx + 0.0, by + 0.0, 0.4, 0.36, 78, 82, shade(leather, 1.15));
    // Decorative stitching on the shaft's front face.
    const f = by + 0.34;
    for (const [a, b] of [[34, 70], [40, 62]] as const) {
      line3(g, [bx + 0.08, f, a], [bx + 0.2, f, b], 1.2, stitch);
      line3(g, [bx + 0.32, f, a], [bx + 0.2, f, b], 1.2, stitch);
    }
    line3(g, [bx + 0.1, f, 28], [bx + 0.9, f, 28], 1, stitch, 0.8);
    const glow = iso(bx + 0.5, by + 0.5, 5);
    lights.ellipse(glow.x, glow.y, 28, 13).fill({ color: 0xffd47e, alpha: 0.3 });
  };
  boot(x + 0.35, y + 0.4);
  boot(x + 0.5, y + 1.15);
  lights.blendMode = "add";
  lights.alpha = 0;
  const view = layer(depthOf(x + w - 1, y + d - 1, 60), g, lights);
  return { views: [view], tintables: [g], update: () => (lights.alpha = ctx.night()) };
};

export const DALLAS_LANDMARKS: Record<string, LandmarkFactory> = {
  "dal-sphere-tower": sphereTower,
  "dal-outline-tower": outlineTower,
  "dal-arch-bridge": archBridge,
  "dal-stadium": stadium,
  "dal-cowboy-boots": cowboyBoots,
};
