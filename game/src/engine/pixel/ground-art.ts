// Pixel patterns for the ground: seamless 16 x 16 tiles laid in world space
// (grass tufts, sand grains, soil clods, forest litter, rock cracks, asphalt
// grain, iso paving joints, lot gravel, marsh, deep and shallow water), plus
// the 3-frame water glints. Pure drawing, tested in Node.

import { mix, shade } from "../color.ts";
import { hashKeys, mulberry32 } from "../rng.ts";
import { PixelCanvas } from "./canvas.ts";

export type Terrain = "grass" | "sand" | "soil" | "forest" | "rock" | "asphalt" | "plaza" | "lot" | "marsh" | "deep" | "shallow";
export const TERRAINS: readonly Terrain[] = ["grass", "sand", "soil", "forest", "rock", "asphalt", "plaza", "lot", "marsh", "deep", "shallow"];
export const PATTERN = 16;

/** A seamless pattern of `base` with one lighter and one darker tone (at most three tones). */
export function patternArt(kind: Terrain, base: number): PixelCanvas {
  const c = new PixelCanvas(PATTERN, PATTERN);
  const rng = mulberry32(hashKeys("pattern", kind));
  const lit = shade(base, kind === "asphalt" ? 1.08 : 1.1);
  const dark = shade(base, kind === "asphalt" ? 0.88 : 0.86);
  const put = (x: number, y: number, color: number) => c.put(((x % PATTERN) + PATTERN) % PATTERN, ((y % PATTERN) + PATTERN) % PATTERN, color);
  const spot = () => [Math.floor(rng() * PATTERN), Math.floor(rng() * PATTERN)];
  c.rect(0, 0, PATTERN, PATTERN, base);
  switch (kind) {
    case "grass":
    case "marsh":
      for (let i = 0; i < 5; i++) {
        const [x, y] = spot();
        put(x, y, dark);
        put(x + 2, y, dark);
        put(x + 1, y - 1, lit);
      }
      for (let i = 0; i < 3; i++) put(...(spot() as [number, number]), lit);
      if (kind === "marsh")
        for (let i = 0; i < 2; i++) {
          const [x, y] = spot();
          for (let k = 0; k < 3; k++) put(x + k, y, mix(base, 0x5b8fb0, 0.55));
        }
      break;
    case "forest":
      for (let i = 0; i < 9; i++) put(...(spot() as [number, number]), dark);
      for (let i = 0; i < 3; i++) {
        const [x, y] = spot();
        put(x, y, lit);
        put(x + 1, y, lit);
      }
      break;
    case "sand":
    case "lot":
    case "asphalt":
      for (let i = 0; i < (kind === "lot" ? 8 : 5); i++) put(...(spot() as [number, number]), dark);
      for (let i = 0; i < (kind === "sand" ? 6 : 3); i++) put(...(spot() as [number, number]), lit);
      break;
    case "soil":
      for (let i = 0; i < 4; i++) {
        const [x, y] = spot();
        put(x, y, dark);
        put(x + 1, y, dark);
        put(x, y - 1, lit);
      }
      break;
    case "rock":
      for (let i = 0; i < 2; i++) {
        const [x, y] = spot();
        for (let k = 0; k < 5; k++) put(x + k, y + Math.floor(k / 2), dark);
      }
      for (let i = 0; i < 4; i++) put(...(spot() as [number, number]), lit);
      break;
    case "plaza":
      // Paving joints along both iso directions (2:1 lines), every 8 px.
      for (let x = 0; x < PATTERN; x++) {
        put(x, Math.floor(x / 2), dark);
        put(x, 8 + Math.floor(x / 2), dark);
        put(x, 8 - Math.floor(x / 2), dark);
        put(x, 16 - Math.floor(x / 2), dark);
      }
      put(4, 4, lit);
      put(12, 12, lit);
      break;
    case "deep":
    case "shallow": {
      const glint = mix(base, 0xffffff, kind === "shallow" ? 0.3 : 0.18);
      for (let i = 0; i < (kind === "shallow" ? 3 : 2); i++) {
        const [x, y] = spot();
        for (let k = 0; k < 3; k++) put(x + k, y, glint);
      }
      for (let i = 0; i < 2; i++) put(...(spot() as [number, number]), dark);
      break;
    }
  }
  return c;
}

/** A water glint: frame 0 a short dash, 1 a long dash with a bright core, 2 a broken dash. */
export function glintArt(frame: number, water: number): PixelCanvas {
  const c = new PixelCanvas(9, 3, 4, 1);
  const light = mix(water, 0xffffff, 0.45), bright = mix(water, 0xffffff, 0.75);
  if (frame === 0) c.rect(-1, 0, 3, 1, light);
  else if (frame === 1) {
    c.rect(-3, 0, 7, 1, light);
    c.rect(-1, 0, 3, 1, bright);
  } else {
    c.rect(-4, 0, 2, 1, light);
    c.rect(1, 0, 3, 1, light);
  }
  return c;
}
