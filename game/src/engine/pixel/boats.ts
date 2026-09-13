// Pixel-art boats in four directions with a 2-frame wake: tanker, cruise
// ship, ferry, tug, sailboat, speedboat, and kayak, built from the vehicles'
// oriented boxes. Pure drawing, tested in Node.

import { iso } from "../iso.ts";
import { PixelCanvas } from "./canvas.ts";
import { box } from "./vehicles.ts";

export const BOAT_KINDS = ["tanker", "cruise", "ferry", "tug", "sailboat", "speedboat", "kayak"] as const;

const WAKE = 0xe6f3fa;

function dims(kind: string): { len: number; wid: number } {
  if (kind === "cruise") return { len: 1.6, wid: 0.3 };
  if (kind === "tanker") return { len: 1.5, wid: 0.3 };
  if (kind === "ferry") return { len: 0.9, wid: 0.22 };
  if (kind === "kayak") return { len: 0.3, wid: 0.07 };
  return { len: 0.55, wid: 0.18 };
}

/**
 * A boat heading along +x (alongX) or +y, reversed when `reverse`, anchored
 * at its middle on the water; `frame` 0 or 1 moves the wake's foam.
 */
export function boatArt(kind: string, alongX: boolean, reverse: boolean, frame: number): PixelCanvas {
  const { len, wid } = dims(kind);
  const L = len / 2, W = wid / 2;
  const a = ((alongX ? 0 : 2) + (reverse ? 4 : 0)) * (Math.PI / 4);
  const cs = Math.cos(a), sn = Math.sin(a);
  const at = (f: number, w: number, z = 0) => iso(f * cs - w * sn, f * sn + w * cs, z);
  const c = new PixelCanvas(128, 80, 64, 46);
  const hull = kind === "tanker" ? 0x8b2f2a : kind === "cruise" ? 0xf4f4f4 : kind === "ferry" ? 0xf08a24 : kind === "tug" ? 0xd84315 : kind === "kayak" ? 0xffb300 : 0xf4f4f4;
  const hz = kind === "kayak" ? 2 : kind === "cruise" || kind === "tanker" ? 6 : 4;
  box(c, a, [-L, L * 0.82], [-W, W], 0, hz, hull, 2);
  // The bow: a wedge on the front of the hull.
  const b0 = at(L * 0.82, -W, hz), b1 = at(L, 0, hz), b2 = at(L * 0.82, W, hz), b3 = at(L * 0.82, W, 0), b4 = at(L, 0, 0), b5 = at(L * 0.82, -W, 0);
  c.poly([b5.x, b5.y, b4.x, b4.y, b3.x, b3.y, b2.x, b2.y, b1.x, b1.y, b0.x, b0.y], hull, { part: 3 });
  if (kind === "cruise" || kind === "ferry") {
    const decks = kind === "cruise" ? 3 : 2;
    for (let d = 0; d < decks; d++) box(c, a, [-L * 0.7, L * 0.55], [-W * 0.8, W * 0.8], hz + d * 4, hz + d * 4 + 4, d % 2 ? 0x2e7fd0 : 0xf4f4f4, 4 + d);
    box(c, a, [-L * 0.2, -L * 0.05], [-W * 0.3, W * 0.3], hz + decks * 4, hz + decks * 4 + 7, kind === "cruise" ? 0xe53935 : 0x333333, 9);
  } else if (kind === "tanker") {
    box(c, a, [-L * 0.95, -L * 0.72], [-W * 0.8, W * 0.8], hz, hz + 11, 0xf4f4f4, 4);
    box(c, a, [-L * 0.9, -L * 0.82], [-W * 0.25, W * 0.25], hz + 11, hz + 17, 0x333333, 5);
    for (let k = 0; k < 4; k++) box(c, a, [-L * 0.55 + k * L * 0.32, -L * 0.4 + k * L * 0.32], [-W * 0.3, W * 0.3], hz, hz + 2, 0x6a6f76, 6 + k);
  } else if (kind === "tug" || kind === "speedboat") {
    box(c, a, [-L * 0.25, L * 0.2], [-W * 0.7, W * 0.7], hz, hz + 5, kind === "tug" ? 0xf4f4f4 : 0x9fd0ea, 4);
  } else if (kind === "sailboat") {
    const m = at(0, 0, hz), top = at(0, 0, hz + 22), clew = at(-L * 0.8, 0, hz + 3), jib = at(L * 0.75, 0, hz + 2);
    c.poly([m.x, m.y - 2, top.x, top.y, clew.x, clew.y], 0xf4f4f4, { part: 4 });
    c.poly([m.x + 1, m.y - 4, top.x + 1, top.y + 4, jib.x, jib.y], 0xe53935, { part: 5 });
  }
  c.outline({ outside: true });
  // Wake behind the stern and along the sides: foam dashes that shift between frames (no outline).
  for (let k = 0; k < 6; k++) {
    if ((k + frame) % 2) continue;
    const f = -L - 0.06 - k * 0.07;
    for (const side of [-1, 1]) {
      const p = at(f, side * (W + k * 0.02));
      if (c.at(Math.round(p.x + c.ox), Math.round(p.y + c.oy)).alpha === 255) continue;
      c.rect(p.x - 1, p.y, 2, 1, WAKE);
    }
  }
  return c;
}
