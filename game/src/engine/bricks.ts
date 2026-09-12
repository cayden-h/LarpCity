// The procedural brick builder. A building is a handful of numbers (footprint,
// floors, colors, roof type); this draws it in isometric view: lit top,
// shaded side faces, brick courses, windows, and a separate light layer whose
// windows glow at night. Cities with pre-rendered sprites (sprites.ts) use
// this only for lots no sprite fits.

import { Container, Graphics } from "pixi.js";
import { mix, shade } from "./color";
import { face, lerp } from "./ground";
import { iso, flat, footprintCorners } from "./iso";
import { rngFor } from "./rng";
import type { RoofType } from "./types";

export const FLOOR_H = 20;
const PLINTH = 4;

export type WindowStyle = "grid" | "bands" | "tall" | "none";

export interface BrickSpec {
  x: number;
  y: number;
  w: number;
  d: number;
  floors: number;
  wall: number;
  trim: number;
  roof: number;
  roofType: RoofType;
  windows?: WindowStyle;
  /** Ground floor with big shop windows and an awning in the trim color. */
  shopfront?: boolean;
  /** Glass curtain wall instead of brick. */
  glass?: boolean;
  seed: number;
  /** Extra lift, for stacking setbacks on top of a base. */
  z?: number;
  /** Fraction of windows lit at night. */
  litShare?: number;
}

export interface Built {
  view: Container;
  /** Faded in at night (scene.ts sets its alpha). */
  lights: Container;
  blinkers: Graphics[];
  topZ: number;
}

const GLASS = 0x8ec9ea;
const LIT = 0xffd47e;

export function buildBrick(spec: BrickSpec): Built {
  const view = new Container();
  const body = new Graphics();
  const lights = new Graphics();
  const blinkers: Graphics[] = [];
  const rng = rngFor(spec.seed, "brick");
  const { x, y, w, d } = spec;
  const z0 = spec.z ?? 0;
  const wall = spec.glass ? mix(spec.wall, GLASS, 0.55) : spec.wall;
  const height = PLINTH + spec.floors * FLOOR_H;
  const topZ = z0 + height;

  // Plinth in the trim color, then the wall faces.
  face(body, iso(x, y + d, z0 + PLINTH), iso(x + w, y + d, z0 + PLINTH), PLINTH, shade(spec.trim, 0.85));
  face(body, iso(x + w, y + d, z0 + PLINTH), iso(x + w, y, z0 + PLINTH), PLINTH, shade(spec.trim, 0.7));
  const leftTop = iso(x, y + d, topZ), bottomTop = iso(x + w, y + d, topZ), rightTop = iso(x + w, y, topZ);
  face(body, leftTop, bottomTop, height - PLINTH, shade(wall, 0.96));
  face(body, bottomTop, rightTop, height - PLINTH, shade(wall, 0.76));

  // Brick courses: faint horizontal lines every half floor.
  if (!spec.glass) {
    for (let zz = z0 + PLINTH + FLOOR_H / 2; zz < topZ - 2; zz += FLOOR_H / 2) {
      const a = iso(x, y + d, zz), b = iso(x + w, y + d, zz), c = iso(x + w, y, zz);
      body.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y);
    }
    body.stroke({ width: 1, color: shade(wall, 0.7), alpha: 0.25 });
  } else {
    // Mullions for curtain walls.
    for (let i = 1; i < w * 3; i++) {
      const p = iso(x + i / 3, y + d, z0 + PLINTH), q = iso(x + i / 3, y + d, topZ);
      body.moveTo(p.x, p.y).lineTo(q.x, q.y);
    }
    for (let i = 1; i < d * 3; i++) {
      const p = iso(x + w, y + i / 3, z0 + PLINTH), q = iso(x + w, y + i / 3, topZ);
      body.moveTo(p.x, p.y).lineTo(q.x, q.y);
    }
    body.stroke({ width: 1, color: 0xffffff, alpha: 0.28 });
    // At night, offices glow floor by floor behind the glass.
    const glowShare = spec.litShare ?? 0.6;
    for (let f = 0; f < spec.floors; f++) {
      const zLo = z0 + PLINTH + f * FLOOR_H + 5, zHi = zLo + 9;
      for (const side of ["left", "right"] as const) {
        const span = side === "left" ? w : d;
        const bays = Math.max(1, Math.round(span * 3));
        for (let i = 0; i < bays; i++) {
          if (rng() > glowShare) continue;
          const t0 = (i + 0.12) / (bays / span), t1 = (i + 0.88) / (bays / span);
          const at = (t: number, zz: number) => (side === "left" ? iso(x + t, y + d, zz) : iso(x + w, y + d - t, zz));
          lights.poly(flat([at(t0, zLo), at(t1, zLo), at(t1, zHi), at(t0, zHi)])).fill(0xffe2a0);
        }
      }
    }
  }

  // Windows.
  const style = spec.glass ? "none" : (spec.windows ?? "grid");
  const lit = spec.litShare ?? 0.6;
  for (let f = 0; f < spec.floors; f++) {
    const fz = z0 + PLINTH + f * FLOOR_H;
    const shop = spec.shopfront && f === 0;
    for (const side of ["left", "right"] as const) {
      const span = side === "left" ? w : d;
      const per = shop ? 1 : style === "tall" ? 2 : 2;
      for (let i = 0; i < span * per; i++) {
        if (style === "none" && !shop) continue;
        const t0 = (i + (shop ? 0.08 : 0.22)) / per, t1 = (i + (shop ? 0.92 : 0.78)) / per;
        const zLo = fz + (shop ? 2 : style === "tall" ? 3 : 6);
        const zHi = fz + (shop ? 14 : style === "tall" ? 17 : style === "bands" ? 13 : 15);
        const at = (t: number, zz: number) => (side === "left" ? iso(x + t, y + d, zz) : iso(x + w, y + d - t, zz));
        const quad = [at(t0, zLo), at(t1, zLo), at(t1, zHi), at(t0, zHi)];
        const glassTint = side === "left" ? GLASS : shade(GLASS, 0.82);
        body.poly(flat(quad)).fill(glassTint);
        // A small sky reflection in the upper corner.
        const hl = [at(t0, zHi - 3), at(t0 + (t1 - t0) * 0.4, zHi - 3), at(t0 + (t1 - t0) * 0.4, zHi), at(t0, zHi)];
        body.poly(flat(hl)).fill({ color: 0xffffff, alpha: 0.35 });
        if (style === "bands" && !shop) {
          body.poly(flat([at(t0, zLo - 2), at(t1, zLo - 2), at(t1, zLo), at(t0, zLo)])).fill(shade(spec.trim, 0.95));
        }
        if (rng() < (shop ? 0.95 : lit)) lights.poly(flat(quad)).fill(LIT);
      }
      if (shop) {
        // Striped awning over the shop windows.
        const a0 = side === "left" ? iso(x, y + d, fz + 16) : iso(x + w, y + d, fz + 16);
        const a1 = side === "left" ? iso(x + w, y + d, fz + 16) : iso(x + w, y, fz + 16);
        const out = side === "left" ? { x: -4, y: 6 } : { x: 6, y: 5 };
        const stripes = Math.max(2, span * 4);
        for (let s = 0; s < stripes; s++) {
          const p = lerp(a0, a1, s / stripes), q = lerp(a0, a1, (s + 1) / stripes);
          body
            .poly([p.x, p.y, q.x, q.y, q.x + out.x, q.y + out.y, p.x + out.x, p.y + out.y])
            .fill(s % 2 === 0 ? spec.trim : 0xffffff);
        }
      }
    }
  }

  drawRoof(body, blinkers, spec, topZ, rng);
  view.addChild(body, lights);
  for (const b of blinkers) view.addChild(b);
  lights.alpha = 0;
  return { view, lights, blinkers, topZ };
}

function drawRoof(
  g: Graphics,
  blinkers: Graphics[],
  spec: BrickSpec,
  topZ: number,
  rng: () => number,
): void {
  const { x, y, w, d, roof } = spec;
  const [T, R, B, L] = footprintCorners(x, y, w, d, topZ);
  const flatTop = () => {
    g.poly(flat([T, R, B, L])).fill(shade(roof, 1.08));
  };
  switch (spec.roofType) {
    case "flat":
    case "terrace":
      flatTop();
      break;
    case "antenna": {
      flatTop();
      const c = iso(x + w / 2, y + d / 2, topZ);
      g.moveTo(c.x, c.y).lineTo(c.x, c.y - 34).stroke({ width: 2, color: 0xd6dbe1 });
      g.moveTo(c.x - 5, c.y - 12).lineTo(c.x + 5, c.y - 12).stroke({ width: 1.5, color: 0xd6dbe1 });
      const blink = new Graphics().circle(c.x, c.y - 35, 2.6).fill(0xff3b30);
      blinkers.push(blink);
      break;
    }
    case "water-tower": {
      flatTop();
      const c = iso(x + w * 0.35, y + d * 0.35, topZ);
      for (const dx of [-5, 5]) g.moveTo(c.x + dx, c.y).lineTo(c.x + dx * 0.6, c.y - 10).stroke({ width: 1.5, color: 0x5b4636 });
      g.rect(c.x - 7, c.y - 22, 14, 13).fill(0x8b6a4e);
      g.rect(c.x - 7, c.y - 22, 5, 13).fill(0x9f7c5d);
      g.poly([c.x - 8, c.y - 22, c.x, c.y - 30, c.x + 8, c.y - 22]).fill(0x5b4636);
      break;
    }
    case "dome": {
      g.poly(flat([T, R, B, L])).fill(shade(roof, 0.95));
      const c = iso(x + w / 2, y + d / 2, topZ);
      const r = Math.min(w, d) * 17;
      g.rect(c.x - r * 0.75, c.y - 10, r * 1.5, 10).fill(shade(spec.wall, 0.95));
      g.ellipse(c.x, c.y - 10, r * 0.75, r * 0.3).fill(shade(spec.wall, 1.05));
      g.moveTo(c.x - r * 0.72, c.y - 10).arc(c.x, c.y - 10, r * 0.72, Math.PI, 0).fill(shade(roof, 1.15));
      g.moveTo(c.x - r * 0.72, c.y - 10).arc(c.x, c.y - 10, r * 0.72, Math.PI, Math.PI * 1.35).lineTo(c.x, c.y - 10).fill({ color: 0xffffff, alpha: 0.18 });
      g.rect(c.x - 2, c.y - 10 - r * 0.72 - 8, 4, 9).fill(shade(roof, 0.9));
      break;
    }
    case "gable": {
      const rh = 14 + Math.min(w, d) * 4;
      if (w >= d) {
        const r0 = iso(x, y + d / 2, topZ + rh), r1 = iso(x + w, y + d / 2, topZ + rh);
        g.poly(flat([T, R, r1, r0])).fill(shade(roof, 0.8));
        g.poly(flat([R, B, r1])).fill(shade(spec.wall, 0.72));
        g.poly(flat([L, B, r1, r0])).fill(shade(roof, 1.05));
        g.moveTo(r0.x, r0.y).lineTo(r1.x, r1.y).stroke({ width: 2, color: shade(roof, 0.65) });
        // Roof tile rows.
        for (let k = 1; k < 3; k++) {
          const p = lerp(L, r0, k / 3), q = lerp(B, r1, k / 3);
          g.moveTo(p.x, p.y).lineTo(q.x, q.y);
        }
        g.stroke({ width: 1, color: shade(roof, 0.8), alpha: 0.6 });
      } else {
        const r0 = iso(x + w / 2, y, topZ + rh), r1 = iso(x + w / 2, y + d, topZ + rh);
        g.poly(flat([T, L, r1, r0])).fill(shade(roof, 0.85));
        g.poly(flat([L, B, r1])).fill(shade(spec.wall, 0.9));
        g.poly(flat([R, B, r1, r0])).fill(shade(roof, 0.72));
        g.moveTo(r0.x, r0.y).lineTo(r1.x, r1.y).stroke({ width: 2, color: shade(roof, 0.6) });
      }
      // A little chimney.
      if (rng() < 0.6) {
        const c = iso(x + w * 0.7, y + d * 0.35, topZ + rh * 0.55);
        g.rect(c.x - 3, c.y - 12, 7, 12).fill(0x9c5a45);
        g.rect(c.x - 4, c.y - 14, 9, 3).fill(0x7c4535);
      }
      break;
    }
    case "hip": {
      const rh = 12 + Math.min(w, d) * 5;
      const apex = iso(x + w / 2, y + d / 2, topZ + rh);
      g.poly(flat([T, R, apex])).fill(shade(roof, 0.8));
      g.poly(flat([T, L, apex])).fill(shade(roof, 0.9));
      g.poly(flat([L, B, apex])).fill(shade(roof, 1.08));
      g.poly(flat([B, R, apex])).fill(shade(roof, 0.74));
      break;
    }
  }
}

/** A small round tree on a tile: trunk, two canopy blobs, studs on top. */
export function buildTree(tx: number, ty: number, seed: number, leaf: number, bare = false, snow = 0): Container {
  const rng = rngFor(seed, "tree", tx, ty);
  const g = new Graphics();
  drawTree(g, iso(tx + 0.3 + rng() * 0.4, ty + 0.3 + rng() * 0.4), 0.8 + rng() * 0.45, rng(), leaf, bare, snow);
  const c = new Container();
  c.addChild(g);
  return c;
}

/**
 * Several trees on one tile drawn into a single Graphics (forests have
 * thousands of trees, so one object per tile keeps them cheap).
 */
export function buildGrove(tx: number, ty: number, seed: number, leaf: number, count: number, conifers: number, bare = false, snow = 0): Container {
  const rng = rngFor(seed, "grove", tx, ty);
  const spots = Array.from({ length: count }, () => ({ ox: 0.18 + rng() * 0.64, oy: 0.18 + rng() * 0.64, s: 0.75 + rng() * 0.5, k: rng() < conifers ? 0.9 : 0.1, tone: 0.88 + rng() * 0.22 }));
  spots.sort((a, b) => a.ox + a.oy - (b.ox + b.oy));
  const g = new Graphics();
  for (const t of spots) drawTree(g, iso(tx + t.ox, ty + t.oy), t.s, t.k, shade(leaf, t.tone), bare && t.k < 0.5, snow);
  const c = new Container();
  c.addChild(g);
  return c;
}

function drawTree(g: Graphics, p: { x: number; y: number }, s: number, kind: number, leaf: number, bare: boolean, snow: number): void {
  g.ellipse(p.x, p.y, 10 * s, 4.5 * s).fill({ color: 0x000000, alpha: 0.12 });
  g.rect(p.x - 2.5, p.y - 14 * s, 5, 14 * s).fill(0x7a5035);
  g.rect(p.x - 2.5, p.y - 14 * s, 2, 14 * s).fill(0x93633f);
  if (!bare) {
    if (kind < 0.5) {
      // Round canopy made of stacked "bricks".
      g.roundRect(p.x - 13 * s, p.y - 30 * s, 26 * s, 18 * s, 6 * s).fill(shade(leaf, 0.85));
      g.roundRect(p.x - 10 * s, p.y - 38 * s, 20 * s, 14 * s, 6 * s).fill(leaf);
      g.roundRect(p.x - 6 * s, p.y - 37 * s, 8 * s, 5 * s, 2 * s).fill({ color: 0xffffff, alpha: 0.18 });
    } else {
      // Cone tree, three tiers.
      for (let k = 0; k < 3; k++) {
        const wdt = (14 - k * 3.5) * s, top = p.y - (14 + k * 9) * s;
        g.poly([p.x - wdt, top, p.x + wdt, top, p.x, top - 14 * s]).fill(shade(leaf, 0.8 + k * 0.1));
      }
    }
    if (snow > 0.3) g.ellipse(p.x, p.y - 36 * s, 9 * s, 3 * s).fill({ color: 0xffffff, alpha: snow });
  } else {
    g.moveTo(p.x, p.y - 12 * s).lineTo(p.x - 8 * s, p.y - 24 * s).moveTo(p.x, p.y - 14 * s).lineTo(p.x + 7 * s, p.y - 26 * s);
    g.stroke({ width: 2, color: 0x7a5035 });
  }
}
