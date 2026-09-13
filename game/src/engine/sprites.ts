// Pre-rendered sprites (game/art/): loading a city's set and turning one entry
// (a building, a landmark, or a prop) into the same Built shape the brick
// builder returns.

import { Assets, Container, Sprite, type Texture } from "pixi.js";
import type { Built } from "./bricks";
import { findLandmark, spriteOrigin, type SpriteEntry, type SpriteManifest } from "./sprite-pick";

export interface SpriteSet {
  manifest: SpriteManifest;
  textures: Map<string, Texture>;
}

/** A city's sprites, or null when it has none yet (it then uses the brick builder). */
export async function loadSpriteSet(cityId: string): Promise<SpriteSet | null> {
  const base = `${import.meta.env.BASE_URL}sprites/${cityId}/`;
  try {
    const res = await fetch(`${base}sprites.json`);
    // Vite answers unknown paths with index.html, so check the type too.
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    const manifest = (await res.json()) as SpriteManifest;
    const files = manifest.sprites.flatMap((s) => (s.crown ? [s.day, s.night, s.crown] : [s.day, s.night]));
    const loaded: Record<string, Texture> = await Assets.load(files.map((f) => base + f));
    // Pixel art: square pixels when zoomed in; smooth when zoomed out, so small sprites don't shimmer while panning.
    for (const t of Object.values(loaded)) {
      t.source.style.magFilter = "nearest";
      t.source.style.minFilter = "linear";
      t.source.style.update();
    }
    return { manifest, textures: new Map(files.map((f) => [f, loaded[base + f]])) };
  } catch (err) {
    console.warn(`[larp] no sprites for ${cityId}`, err);
    return null;
  }
}

export function buildSprite(set: SpriteSet, e: SpriteEntry, x: number, y: number): Built {
  const o = spriteOrigin(e, x, y);
  const k = 1 / set.manifest.scale;
  const day = new Sprite(set.textures.get(e.day));
  const lights = new Sprite(set.textures.get(e.night));
  for (const s of [day, lights]) {
    s.position.set(o.x, o.y);
    s.scale.set(k);
  }
  // The night pass is black wherever nothing glows, so adding it only lights windows and signs.
  lights.blendMode = "add";
  lights.alpha = 0;
  const view = new Container();
  view.addChild(day, lights);
  return { view, lights, blinkers: [], topZ: e.topZ };
}

/** The sprite drawn for a landmark instead of its procedural model, if the set has one. */
export function spriteLandmark(set: SpriteSet | null, landmarkId: string): SpriteEntry | null {
  return set ? findLandmark(set.manifest, landmarkId) : null;
}

/** A landmark or prop sprite on tile (x, y): the same day and night pair as a building. */
export function buildSpriteView(set: SpriteSet, e: SpriteEntry, x: number, y: number): Built {
  return buildSprite(set, e, x, y);
}
