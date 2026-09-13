// Fills a city's lots with buildings in the style of their zone, and plants
// trees and reeds. Which building goes where is planned in lots.ts; this draws it.

import { Container } from "pixi.js";
import { boulderSprite, cactusSprite, reedsSprite } from "./pixel/plant-views";
import { buildBrick, buildGrove, buildTree, type Built } from "./bricks";
import { shade } from "./color";
import type { CityGrid } from "./grid";
import { depthOf, iso } from "./iso";
import { rngFor, type Rng } from "./rng";
import { planLots } from "./lots";
import { buildSprite, type SpriteSet } from "./sprites";
import type { CityDef } from "./types";
export { zoneAt } from "./lots";

export interface Placed {
  built: Built;
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface Plant {
  view: Container;
  x: number;
  y: number;
}

export function populate(grid: CityGrid, city: CityDef, seed: number, sprites: SpriteSet | null = null): { buildings: Placed[] } {
  const plans = planLots(grid, city, seed, sprites?.manifest ?? null);
  const buildings = plans.map((p) => ({
    built: p.entry && sprites ? buildSprite(sprites, p.entry, p.x, p.y, p.tint) : buildBrick(p.spec),
    x: p.x,
    y: p.y,
    w: p.w,
    d: p.d,
  }));
  return { buildings };
}

/**
 * Trees on parks, a sprinkle along streets, dense groves in forests, reeds in
 * marshes, boulders and pines on mountain rock, and cacti in the desert.
 * One object per tile keeps even very large forests cheap.
 */
export function plant(grid: CityGrid, city: CityDef, seed: number, leaf: number, bare: boolean, snow: number, desert = false): Plant[] {
  const rng = rngFor(seed, city.id, "plants");
  const out: Plant[] = [];
  for (const { x, y, c } of grid.cells()) {
    if (c === "F") out.push({ view: buildGrove(x, y, seed, shade(leaf, 0.85), 2 + (rng() < 0.5 ? 1 : 0), 0.55, bare, snow), x, y });
    else if (c === "p") out.push({ view: buildGrove(x, y, seed, leaf, rng() < 0.5 ? 2 : 1, 0.3, bare, snow), x, y });
    else if (c === "." && rng() < (desert ? 0.05 : 0.08))
      out.push({ view: desert ? cactus(x, y, rng) : buildTree(x, y, seed, shade(leaf, 0.9 + rng() * 0.2), bare, snow), x, y });
    else if (c === "s" && desert && rng() < 0.05) out.push({ view: cactus(x, y, rng), x, y });
    else if (c === "~" && rng() < 0.7) out.push({ view: reeds(x, y, rng), x, y });
    else if (c === "m" && rng() < 0.6) out.push({ view: rng() < 0.55 ? boulder(x, y, rng, snow) : buildGrove(x, y, seed, 0x2f6b3a, 1 + (rng() < 0.4 ? 1 : 0), 1, false, snow), x, y });
  }
  return out;
}

function cactus(x: number, y: number, rng: Rng): Container {
  const p = iso(x + 0.3 + rng() * 0.4, y + 0.3 + rng() * 0.4);
  const c = new Container();
  c.addChild(cactusSprite(Math.floor(rng() * 4), p.x, p.y));
  return c;
}

function boulder(x: number, y: number, rng: Rng, snow: number): Container {
  const p = iso(x + 0.3 + rng() * 0.4, y + 0.3 + rng() * 0.4);
  const c = new Container();
  c.addChild(boulderSprite(Math.floor(rng() * 4), snow > 0.3, p.x, p.y));
  return c;
}

function reeds(x: number, y: number, rng: Rng): Container {
  const p = iso(x + 0.5, y + 0.5);
  const c = new Container();
  c.addChild(reedsSprite(Math.floor(rng() * 4), p.x, p.y));
  c.zIndex = depthOf(x, y, 50);
  return c;
}
