// Pixel-art street props: traffic signals (the pole and head, plus a lamps
// layer per light state), stop signs, and yield signs, each anchored at the
// pole's foot. Pure drawing, tested in Node.

import { shade } from "../color.ts";
import { PixelCanvas } from "./canvas.ts";

const POLE = 0x7d848c;
const HEAD = 0x23262b;
const RED = 0xd32f2f;

/** The signal pole and dark head; the lamps are a separate layer so they glow. */
export function signalArt(leftArrow: boolean): PixelCanvas {
  const c = new PixelCanvas(16, 36, 7, 33);
  c.shadowEllipse(3, 0, 3, 1);
  c.rect(0, -22, 1, 22, POLE, { part: 1 });
  c.rect(-2, -31, 5, 11, HEAD, { part: 2 });
  for (const y of [-30, -27, -24]) c.rect(-1, y, 3, 2, shade(HEAD, 1.6), { part: 2 });
  if (leftArrow) c.rect(3, -25, 4, 4, HEAD, { part: 3 });
  return c.outline({ outside: true });
}

const LIT = { R: 0xff3b30, Y: 0xffc107, G: 0x3ddc84 };

/** The lit lamp of state `light` ("R", "Y", "G", or "P" for protected), and the arrow's state if any. */
export function signalLampArt(light: string, arrow: string): PixelCanvas {
  const c = new PixelCanvas(16, 36, 7, 33);
  const row = light === "R" ? -30 : light === "Y" ? -27 : light === "G" || light === "P" ? -24 : null;
  const color = light === "R" ? LIT.R : light === "Y" ? LIT.Y : LIT.G;
  if (row !== null) c.rect(-1, row, 3, 2, color, { glow: true });
  if (arrow === "G" || arrow === "Y") {
    const a = arrow === "G" ? LIT.G : LIT.Y;
    c.rect(4, -23, 2, 1, a, { glow: true });
    c.put(c.ox + 5, c.oy - 24, a, { glow: true });
  }
  return c;
}

export function stopSignArt(): PixelCanvas {
  const c = new PixelCanvas(14, 24, 6, 21);
  c.shadowEllipse(2, 0, 2.5, 1);
  c.rect(0, -13, 1, 13, POLE, { part: 1 });
  // A 7 x 7 octagon: red with a white rim and a white bar for the word.
  c.poly([-2, -21, 2, -21, 4, -19, 4, -16, 2, -14, -2, -14, -4, -16, -4, -19].map((v, i) => (i % 2 ? v : v + 0.5)), 0xf4f4f4, { part: 2 });
  c.poly([-1.5, -20, 2.5, -20, 3.5, -19, 3.5, -16, 2.5, -15, -1.5, -15, -2.5, -16, -2.5, -19], RED, { part: 2 });
  c.rect(-2, -18, 5, 1, 0xf4f4f4, { part: 2 });
  return c.outline({ outside: true });
}

export function yieldSignArt(): PixelCanvas {
  const c = new PixelCanvas(14, 24, 6, 21);
  c.shadowEllipse(2, 0, 2.5, 1);
  c.rect(0, -13, 1, 13, POLE, { part: 1 });
  c.poly([-4, -21, 5, -21, 0.5, -13], RED, { part: 2 });
  c.poly([-2, -20, 3, -20, 0.5, -16], 0xf4f4f4, { part: 2 });
  return c.outline({ outside: true });
}
