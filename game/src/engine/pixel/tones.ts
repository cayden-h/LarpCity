// Stepped shading for code-drawn pixel art, matching the Blender pixel pass's
// one warm key light: the top lightest, the left face lit, the right shaded.

import { shade } from "../color.ts";

export interface Ramp {
  top: number;
  left: number;
  right: number;
}

/** The three tones of a surface of base color `base` under the key light. */
export function ramp(base: number): Ramp {
  return { top: shade(base, 1.14), left: base, right: shade(base, 0.76) };
}

/** The palette color nearest `color` (weighted RGB distance). */
export function snap(color: number, palette: readonly number[]): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  let best = palette[0], bestD = Infinity;
  for (const p of palette) {
    const dr = ((p >> 16) & 255) - r, dg = ((p >> 8) & 255) - g, db = (p & 255) - b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
