// Pixel-art people: a 7 x 18 px figure (hair or cap, face, shirt with arms,
// two-tone pants) in three walk frames, facing right or left. The light stays
// on the left in both facings (drawn, not mirrored). Pure drawing, tested in Node.

import { shade } from "../color.ts";
import { PixelCanvas } from "./canvas.ts";

export interface PersonLook {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  /** A cap color, or null for bare hair. */
  cap: number | null;
}

/** Frame 0 stands; 1 and 2 are the two strides. `dir` 1 faces right, -1 left. */
export function personArt(look: PersonLook, frame: number, dir: 1 | -1): PixelCanvas {
  const c = new PixelCanvas(16, 26, 8, 22);
  const { skin, hair, shirt, pants, cap } = look;
  c.shadowEllipse(1, 0, 4.5, 1.5);
  // Legs: the lit (left) leg and the shaded (right) leg; strides move them apart.
  const stride = frame === 0 ? 0 : 1;
  const lx = -3 + (frame === 1 ? -stride : 0), rx = 1 + (frame === 2 ? stride : 0);
  c.rect(lx, -6, 2, frame === 1 ? 5 : 6, pants);
  c.rect(rx, -6, 2, frame === 2 ? 5 : 6, shade(pants, 0.78));
  c.rect(-3, -6, 6, 1, pants);
  // Shirt, with the right column shaded and a lit corner.
  c.rect(-3, -12, 6, 6, shirt);
  c.rect(2, -12, 1, 6, shade(shirt, 0.78));
  c.rect(-3, -12, 1, 1, shade(shirt, 1.14));
  // Arms swing against the legs.
  const swing = frame === 0 ? 0 : frame === 1 ? 1 : -1;
  c.rect(-4, -11 + Math.max(0, -swing), 1, 4, shade(shirt, 0.9));
  c.rect(-4, -7 + Math.max(0, -swing), 1, 1, skin);
  c.rect(3, -11 + Math.max(0, swing), 1, 4, shade(shirt, 0.7));
  c.rect(3, -7 + Math.max(0, swing), 1, 1, shade(skin, 0.85));
  // Neck and head.
  c.rect(-1, -13, 2, 1, shade(skin, 0.85));
  c.rect(-2, -17, 4, 4, skin);
  c.rect(1, -17, 1, 4, shade(skin, 0.85));
  if (cap !== null) {
    c.rect(-2, -18, 4, 2, cap);
    c.rect(dir > 0 ? 2 : -3, -17, 1, 1, shade(cap, 0.78));
  } else {
    c.rect(-2, -18, 4, 1, hair);
    c.rect(dir > 0 ? -2 : 1, -17, 1, 2, hair);
  }
  // One eye on the side it faces.
  c.put(c.ox + (dir > 0 ? 1 : -2), c.oy - 15, 0x2b2233);
  return c.outline({ outside: true });
}

/** The gold ring at a named resident's feet. */
export function residentRingArt(): PixelCanvas {
  const c = new PixelCanvas(14, 6, 7, 3);
  c.ellipse(0, 0, 6, 2.5, 0xf4c430);
  c.ellipse(0, 0, 4.2, 1.4, 0x000000);
  // Punch the middle back out to transparent: a ring, not a disc.
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const p = c.at(x, y);
      if (p.alpha === 255 && p.color === 0) c.put(x, y, 0, {}, 0);
    }
  return c;
}
