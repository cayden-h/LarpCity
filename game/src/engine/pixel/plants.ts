// Pixel-art trees and plants: oak, Monterey cypress, pine, palm, and bush,
// four seeded variants each, plus cacti, boulders, and reeds. Canopies are
// clusters of blobs lit from the upper left in three flat tones, with an ink
// outline around the whole plant. Pure drawing (no Pixi), so it is tested in
// Node; plant-views.ts turns these into atlas sprites.

import { mix, shade } from "../color.ts";
import { hashKeys, mulberry32, type Rng } from "../rng.ts";
import { PixelCanvas } from "./canvas.ts";
import { ramp } from "./tones.ts";

export type Species = "oak" | "cypress" | "pine" | "palm" | "bush";
export const SPECIES: readonly Species[] = ["oak", "cypress", "pine", "palm", "bush"];
export const VARIANTS = 4;

export interface PlantLook {
  leaf: number;
  bare?: boolean;
  snow?: boolean;
}

const BARK = 0x6e4a33;
const BARK_LIT = 0x93633f;
const SNOW = 0xf4f7fb;

/** One tree of a species and variant (0..3), anchored at the trunk's foot. */
export function treeArt(species: Species, variant: number, look: PlantLook): PixelCanvas {
  const rng = mulberry32(hashKeys("tree", species, variant));
  const c = new PixelCanvas(48, 64, 24, 58);
  const k = [0.86, 1, 1.1, 1.2][variant % VARIANTS];
  switch (species) {
    case "oak":
      return oak(c, rng, k, look);
    case "cypress":
      return cypress(c, rng, k, look);
    case "pine":
      return pine(c, k, variant, look);
    case "palm":
      return palm(c, rng, k, look);
    case "bush":
      return bush(c, rng, k, look);
  }
}

function trunk(c: PixelCanvas, h: number): void {
  c.rect(-1, -h, 3, h, BARK, { part: 1 });
  c.rect(-1, -h, 1, h, BARK_LIT, { part: 1 });
}

/** A lit clump: shade tone, mid tone up-left, and a lit spot at the top left. */
function clump(c: PixelCanvas, x: number, y: number, rx: number, ry: number, leaf: number, part: number, lit = true): void {
  const r = ramp(leaf);
  c.ellipse(x, y, rx, ry, r.right, { part });
  c.ellipse(x - 1, y - 1, rx * 0.78, ry * 0.74, r.left, { part });
  if (lit) c.ellipse(x - rx * 0.35, y - ry * 0.4, rx * 0.36, ry * 0.32, r.top, { part });
}

/** Snow on the first one or two solid pixels below the outline of every column. */
function snowCap(c: PixelCanvas, rows: number): void {
  for (let x = 0; x < c.w; x++) {
    let y = 0;
    while (y < c.h && c.at(x, y).alpha !== 255) y++;
    // Skip the outline pixel, then cap.
    for (let k = 1; k <= rows && y + k < c.h; k++) if (c.at(x, y + k).alpha === 255) c.put(x, y + k, SNOW);
  }
}

/** Winter limbs: short 2 px boughs from the trunk top, outlined, with 1 px twigs. */
function bareCrown(c: PixelCanvas, rng: Rng, th: number, k: number, snow: boolean): PixelCanvas {
  const limbs = [
    { x: -7 * k - rng() * 2, y: -th - 9 * k },
    { x: 6 * k + rng() * 2, y: -th - 11 * k },
    { x: rng() * 2 - 1, y: -th - 14 * k },
  ];
  for (const l of limbs) c.poly([-1, -th + 3, 1, -th + 3, l.x + 1, l.y, l.x - 0.5, l.y], BARK, { part: 1 });
  c.outline({ outside: true });
  for (const l of limbs) {
    const s = l.x < -1 ? -1 : l.x > 1 ? 1 : 0;
    c.line(l.x, l.y - 1, l.x + s * 2 - 1, l.y - 4, BARK);
    c.line(l.x, l.y - 1, l.x + s * 2 + 2, l.y - 3, BARK);
  }
  if (snow) snowCap(c, 1);
  return c;
}

function oak(c: PixelCanvas, rng: Rng, k: number, look: PlantLook): PixelCanvas {
  const th = Math.round(11 * k);
  c.shadowEllipse(4, -1, 12 * k, 4.5 * k);
  trunk(c, th);
  if (look.bare) return bareCrown(c, rng, th, k, !!look.snow);
  const cy = -th - 9 * k;
  const blobs = [{ x: 0, y: cy, rx: 10 * k, ry: 8 * k }];
  const n = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.6;
    blobs.push({ x: Math.cos(a) * 7 * k, y: cy + Math.sin(a) * 4.5 * k - 1, rx: (5 + rng() * 2.5) * k, ry: (4.5 + rng() * 2) * k });
  }
  // Back (higher on screen) clumps first, so the front ones overlap them.
  blobs.sort((a, b) => a.y - b.y);
  for (const b of blobs) clump(c, b.x, b.y, b.rx, b.ry, look.leaf, 2);
  c.outline({ outside: true });
  if (look.snow) snowCap(c, 2);
  return c;
}

function cypress(c: PixelCanvas, rng: Rng, k: number, look: PlantLook): PixelCanvas {
  const leaf = mix(look.leaf, 0x2f5d2a, 0.45);
  const th = Math.round(12 * k), lean = rng() < 0.5 ? -2 : 2;
  c.shadowEllipse(5, -1, 14 * k, 4.5 * k);
  c.poly([-1, 0, 2, 0, 2 + lean, -th, -1 + lean, -th], BARK, { part: 1 });
  c.line(-1, -1, -1 + lean, -th, BARK_LIT, { part: 1 });
  // Wind-shaped flat slabs, widest at the top.
  const slabs = [
    { x: lean, y: -th - 3 * k, rx: 12 * k, ry: 4 * k },
    { x: lean + (rng() - 0.5) * 4, y: -th - 8 * k, rx: 14 * k, ry: 4.5 * k },
    { x: lean + 2 + (rng() - 0.5) * 4, y: -th - 12 * k, rx: 10 * k, ry: 3.5 * k },
  ];
  slabs.sort((a, b) => a.y - b.y);
  for (const s of slabs) clump(c, s.x, s.y, s.rx, s.ry, leaf, 2);
  c.outline({ outside: true });
  if (look.snow) snowCap(c, 1);
  return c;
}

function pine(c: PixelCanvas, k: number, variant: number, look: PlantLook): PixelCanvas {
  const leaf = shade(mix(look.leaf, 0x2f6b3a, 0.55), 0.92);
  const r = ramp(leaf);
  const th = Math.round(6 * k);
  c.shadowEllipse(4, -1, 9 * k, 3.5 * k);
  trunk(c, th);
  const tiers = 3 + (variant % 2);
  for (let t = 0; t < tiers; t++) {
    const w = (11 - t * 2.4) * k, base = -th - t * 7 * k, apex = base - 12 * k;
    const part = 2 + t;
    c.poly([0, apex, w, base, -w, base], r.right, { part });
    c.poly([0, apex, 0, base, -w, base], r.left, { part });
    c.poly([0, apex, -w * 0.45, base - 2, -w, base], r.top, { part });
  }
  c.outline({ outside: true });
  if (look.snow) snowCap(c, 2);
  return c;
}

function palm(c: PixelCanvas, rng: Rng, k: number, look: PlantLook): PixelCanvas {
  const leaf = mix(look.leaf, 0x4f9a3a, 0.4);
  const r = ramp(leaf);
  const h = Math.round(26 * k), bend = rng() < 0.5 ? -3 : 3;
  c.shadowEllipse(6, -1, 10, 3.5);
  let tx = 0;
  for (let i = 0; i < h; i++) {
    tx = Math.round(bend * (i / h) ** 2);
    c.rect(tx - 1, -i - 1, 2, 1, i % 4 === 0 ? BARK : BARK_LIT, { part: 1 });
    c.rect(tx + 1, -i - 1, 1, 1, BARK, { part: 1 });
  }
  const top = -h;
  // Fronds: broad drooping leaves, the back ones darkest, the front left lit.
  const len = (12 + rng() * 2) * k;
  const fronds: [number, number][] = [[-0.6, -0.8], [0.6, -0.8], [0, -1], [-1, 0], [1, 0], [-0.75, 0.6], [0.75, 0.6]];
  for (const [dx, dy] of fronds) {
    const ex = tx + dx * len, ey = top + dy * 4 + (1 - Math.abs(dy)) * 7 + 3;
    const mx = tx + dx * len * 0.55, my = top + dy * 4 - 2;
    const tone = dy < -0.5 ? r.right : dx <= 0 ? r.top : r.left;
    c.poly([tx, top - 2, mx, my - 2.2, ex, ey, mx, my + 2.2, tx, top + 2], tone, { part: 2 });
  }
  c.rect(tx - 1, top + 1, 3, 2, 0x6b4a2a, { part: 3 });
  c.outline({ outside: true });
  return c;
}

function bush(c: PixelCanvas, rng: Rng, k: number, look: PlantLook): PixelCanvas {
  c.shadowEllipse(3, -1, 8 * k, 3 * k);
  const n = 3 + Math.floor(rng() * 2);
  const blobs = Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * 4 * k, y: -4 * k - rng() * 3 * k, rx: (4 + rng() * 1.5) * k, ry: (3.5 + rng()) * k }));
  blobs.sort((a, b) => a.y - b.y);
  for (const b of blobs) clump(c, b.x, b.y, b.rx, b.ry, shade(look.leaf, 0.92), 2);
  c.outline({ outside: true });
  if (look.snow) snowCap(c, 1);
  return c;
}

/** A saguaro-ish cactus for desert tiles. */
export function cactusArt(variant: number): PixelCanvas {
  const rng = mulberry32(hashKeys("cactus", variant));
  const r = ramp(0x4f9a55);
  const c = new PixelCanvas(24, 36, 12, 32);
  const h = Math.round(16 + rng() * 10);
  c.shadowEllipse(3, -1, 6, 2.5);
  const col = (x: number, y: number, w: number, hh: number) => {
    c.rect(x, y, w, hh, r.left, { part: 1 });
    c.rect(x, y, 1, hh, r.top, { part: 1 });
    c.rect(x + w - 1, y, 1, hh, r.right, { part: 1 });
  };
  col(-2, -h, 5, h);
  if (rng() < 0.85) {
    col(-7, -Math.round(h * 0.72), 3, Math.round(h * 0.34));
    col(-7, -Math.round(h * 0.42), 6, 3);
  }
  if (rng() < 0.6) {
    col(5, -Math.round(h * 0.82), 3, Math.round(h * 0.3));
    col(2, -Math.round(h * 0.55), 6, 3);
  }
  return c.outline({ outside: true });
}

/** A mountain boulder, two stacked lumps, optionally snowy. */
export function boulderArt(variant: number, snow: boolean): PixelCanvas {
  const rng = mulberry32(hashKeys("boulder", variant));
  const c = new PixelCanvas(36, 26, 18, 22);
  const s = 0.75 + rng() * 0.5;
  c.shadowEllipse(4, 0, 12 * s, 4 * s);
  clump(c, 0, -5 * s, 10 * s, 5.5 * s, 0x857e74, 1);
  clump(c, -2, -11 * s, 6.5 * s, 4.5 * s, 0x938d84, 2);
  c.line(3 * s, -6 * s, 6 * s, -3 * s, 0x6a645c, { part: 2 });
  c.outline({ outside: true });
  if (snow) snowCap(c, 2);
  return c;
}

/** A clump of marsh reeds with cattails (thin stalks stay un-outlined). */
export function reedsArt(variant: number): PixelCanvas {
  const rng = mulberry32(hashKeys("reeds", variant));
  const c = new PixelCanvas(56, 40, 28, 32);
  const stalks = Array.from({ length: 7 }, () => ({ x: Math.round((rng() - 0.5) * 36), y: Math.round((rng() - 0.5) * 14), h: 8 + Math.round(rng() * 8), lean: Math.round((rng() - 0.5) * 4), head: rng() < 0.5 }));
  stalks.sort((a, b) => a.y - b.y);
  for (const s of stalks) if (s.head) c.rect(s.x + s.lean - 1, s.y - s.h - 5, 3, 5, 0x7a4e2d, { part: 1 });
  c.outline({ outside: true });
  for (const s of stalks) {
    c.line(s.x, s.y, s.x + s.lean, s.y - s.h, 0x6f9a3c);
    c.line(s.x + 1, s.y, s.x + s.lean + 1, s.y - s.h + 3, 0x557a2c);
    if (s.head) c.put(s.x + s.lean + c.ox - 1, s.y - s.h - 4 + c.oy, 0x9a6a40);
  }
  return c;
}
