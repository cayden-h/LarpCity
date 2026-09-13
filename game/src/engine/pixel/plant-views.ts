// Atlas sprites for the pixel plants (plants.ts), positioned on whole pixels.

import { Sprite, type Texture } from "pixi.js";
import { pixelTexture } from "./atlas";
import { boulderArt, cactusArt, reedsArt, treeArt, VARIANTS, type PlantLook, type Species } from "./plants";

/** Evergreens keep their needles and fronds when deciduous trees go bare. */
const EVERGREEN = new Set<Species>(["pine", "cypress", "palm"]);

function at(texture: Texture, x: number, y: number): Sprite {
  const s = new Sprite(texture);
  s.position.set(Math.round(x), Math.round(y));
  return s;
}

/** One tree whose trunk foot stands at screen point (x, y). */
export function treeSprite(species: Species, variant: number, look: PlantLook, x: number, y: number): Sprite {
  const v = variant % VARIANTS;
  const bare = !!look.bare && !EVERGREEN.has(species);
  const snow = !!look.snow && species !== "palm";
  const key = `tree:${species}:${v}:${look.leaf.toString(16)}:${bare ? 1 : 0}:${snow ? 1 : 0}`;
  return at(pixelTexture(key, () => treeArt(species, v, { leaf: look.leaf, bare, snow })), x, y);
}

export const cactusSprite = (variant: number, x: number, y: number) => at(pixelTexture(`cactus:${variant % VARIANTS}`, () => cactusArt(variant % VARIANTS)), x, y);

export const boulderSprite = (variant: number, snow: boolean, x: number, y: number) =>
  at(pixelTexture(`boulder:${variant % VARIANTS}:${snow ? 1 : 0}`, () => boulderArt(variant % VARIANTS, snow)), x, y);

export const reedsSprite = (variant: number, x: number, y: number) => at(pixelTexture(`reeds:${variant % VARIANTS}`, () => reedsArt(variant % VARIANTS)), x, y);
