// Pixel-art vehicles in eight facings: the same oriented boxes the vector
// cars used (body, glass band, roof, light bars), rasterized with hard edges
// at 1x, each box its own part so the ink runs between them, with 2 x 2 px
// wheels and a flat shadow. Lamps are a separate additive sprite. Pure
// drawing, tested in Node.

import { shade } from "../color.ts";
import { iso } from "../iso.ts";
import { PixelCanvas } from "./canvas.ts";

export interface VehicleLook {
  kind: string;
  color: number;
}

const GLASS = 0x9fd0ea;
const TIRE = 0x1c1c1c;

function size(kind: string): { len: number; wid: number } {
  if (kind === "bus" || kind === "cable-car") return { len: 0.62, wid: 0.24 };
  if (kind === "pickup" || kind === "van" || kind === "snowplow") return { len: 0.44, wid: 0.2 };
  return { len: 0.38, wid: 0.2 };
}

/** Draws an oriented box from z0 to z1: the faces turned to the camera, back to front, then the lit top. */
export function box(c: PixelCanvas, angle: number, fwd: [number, number], side: [number, number], z0: number, z1: number, color: number, part: number): void {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const at = (f: number, w: number) => ({ x: f * cs - w * sn, y: f * sn + w * cs });
  const pts = [at(fwd[1], side[0]), at(fwd[1], side[1]), at(fwd[0], side[1]), at(fwd[0], side[0])];
  const cx = (pts[0].x + pts[2].x) / 2, cy = (pts[0].y + pts[2].y) / 2;
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const nx = (a.x + b.x) / 2 - cx, ny = (a.y + b.y) / 2 - cy;
    if (nx + ny > 1e-6) faces.push({ a, b, nx, ny });
  }
  faces.sort((p, q) => p.a.x + p.a.y + p.b.x + p.b.y - (q.a.x + q.a.y + q.b.x + q.b.y));
  for (const f of faces) {
    // Faces toward +y (screen left) are lit, toward +x (screen right) shaded: two flat tones.
    const tone = f.ny >= f.nx ? shade(color, 0.92) : shade(color, 0.72);
    const A = iso(f.a.x, f.a.y, z0), B = iso(f.b.x, f.b.y, z0), B1 = iso(f.b.x, f.b.y, z1), A1 = iso(f.a.x, f.a.y, z1);
    c.poly([A.x, A.y, B.x, B.y, B1.x, B1.y, A1.x, A1.y], tone, { part });
  }
  c.poly(pts.flatMap((p) => { const q = iso(p.x, p.y, z1); return [q.x, q.y]; }), shade(color, 1.12), { part });
}

/** A vehicle of `look` at facing 0..7 (45 degree steps), anchored at its center on the road. */
export function vehicleArt(look: VehicleLook, facing: number): PixelCanvas {
  const { kind, color } = look;
  const { len, wid } = size(kind);
  const a = (facing * Math.PI) / 4, L = len / 2, W = wid / 2;
  const c = new PixelCanvas(56, 44, 28, 30);
  c.shadowEllipse(3, 1, (L + W) * 34, (L + W) * 13);
  for (const [f, w] of [[L * 0.62, W], [L * 0.62, -W], [-L * 0.62, W], [-L * 0.62, -W]]) {
    const p = iso(f * Math.cos(a) - w * Math.sin(a), f * Math.sin(a) + w * Math.cos(a), 1.5);
    c.rect(p.x - 1, p.y - 1, 2, 2, TIRE, { part: 1 });
  }
  if (kind === "bus" || kind === "van" || kind === "cable-car") {
    const band: [number, number] = kind === "van" ? [8, 11] : [9, 13];
    const top = kind === "van" ? 15 : 18;
    box(c, a, [-L, L], [-W, W], 2, band[0], color, 2);
    box(c, a, [-L * 0.98, L * 0.98], [-W * 0.98, W * 0.98], band[0], band[1], GLASS, 3);
    box(c, a, [-L, L], [-W, W], band[1], top, kind === "cable-car" ? 0xf3e2c0 : color, 4);
    if (kind === "cable-car") {
      const b = iso(0, 0, top), t = iso(0, 0, top + 7);
      c.line(b.x, b.y, t.x, t.y, 0x333333, { part: 5 });
    }
    return c.outline({ outside: true });
  }
  box(c, a, [-L, L], [-W, W], 2, 8, color, 2);
  if (kind === "snowplow") box(c, a, [L, L + 0.05], [-W * 1.2, W * 1.2], 1, 5, 0xff9800, 3);
  if (kind === "convertible") box(c, a, [-L * 0.5, L * 0.3], [-W * 0.85, W * 0.85], 8, 9, 0x5d4037, 4);
  else if (kind === "pickup" || kind === "snowplow") {
    box(c, a, [-L * 0.05, L * 0.55], [-W * 0.9, W * 0.9], 8, 12, GLASS, 4);
    box(c, a, [-L * 0.05, L * 0.55], [-W * 0.9, W * 0.9], 12, 13.5, color, 5);
  } else {
    box(c, a, [-L * 0.55, L * 0.45], [-W * 0.9, W * 0.9], 8, 12, GLASS, 4);
    box(c, a, [-L * 0.5, L * 0.4], [-W * 0.85, W * 0.85], 12, 13, color, 5);
    if (kind === "taxi") box(c, a, [-L * 0.12, L * 0.12], [-W * 0.4, W * 0.4], 13, 15, 0x222222, 6);
    if (kind === "police") {
      box(c, a, [-L * 0.1, L * 0.1], [-W * 0.8, 0], 13, 14.5, 0xe53935, 6);
      box(c, a, [-L * 0.1, L * 0.1], [0, W * 0.8], 13, 14.5, 0x1e88e5, 7);
    }
  }
  return c.outline({ outside: true });
}

/** Headlights, tail lights, and a stepped pool of light ahead, for additive drawing at night. */
export function lampArt(facing: number): PixelCanvas {
  const a = (facing * Math.PI) / 4, cs = Math.cos(a), sn = Math.sin(a);
  const at = (f: number, w: number, z: number) => iso(f * cs - w * sn, f * sn + w * cs, z);
  const c = new PixelCanvas(64, 48, 32, 24);
  const glow = at(0.5, 0, 0);
  // Additive light: dim solid pixels read as a soft pool, with a brighter core.
  c.ellipse(glow.x, glow.y, 11, 5, 0x4a4228, { glow: true });
  c.ellipse(glow.x, glow.y, 6, 2.5, 0x7a6c40, { glow: true });
  for (const w of [-0.07, 0.07]) {
    const f = at(0.2, w, 5), r = at(-0.2, w, 5);
    c.rect(f.x - 1, f.y - 1, 2, 2, 0xfff8d0, { glow: true });
    c.rect(r.x - 1, r.y, 2, 1, 0xff3b30, { glow: true });
  }
  return c;
}
