// Repeating textures for the ground patterns (ground-art.ts). Pattern fills
// need the whole texture to repeat, so each is its own small source rather
// than an atlas frame; they are cached by terrain and color.

import { BufferImageSource, Texture } from "pixi.js";
import { patternArt, PATTERN, type Terrain } from "./ground-art";

const cache = new Map<string, Texture>();

export function groundPattern(kind: Terrain, base: number): Texture {
  const key = `${kind}:${base.toString(16)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = patternArt(kind, base);
  const source = new BufferImageSource({ resource: c.rgba, width: PATTERN, height: PATTERN });
  source.style.addressMode = "repeat";
  source.style.magFilter = "nearest";
  source.style.minFilter = "linear";
  const texture = new Texture({ source, label: `ground:${key}` });
  cache.set(key, texture);
  return texture;
}
