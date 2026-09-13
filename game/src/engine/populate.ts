// Fills a city's lots with buildings in the style of their zone, and plants
// trees and reeds. Which building goes where is planned in lots.ts; this draws it.

import { Container, Graphics } from "pixi.js";
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

function cactus(x: number, y: number, rng: () => number): Container {
  const g = new Graphics();
  const p = iso(x + 0.3 + rng() * 0.4, y + 0.3 + rng() * 0.4);
  const h = 16 + rng() * 12;
  const green = 0x4f9a55;
  g.ellipse(p.x, p.y, 6, 2.5).fill({ color: 0x000000, alpha: 0.12 });
  g.roundRect(p.x - 2.6, p.y - h, 5.2, h, 2.6).fill(green);
  g.roundRect(p.x - 2.6, p.y - h, 2, h, 1).fill(shade(green, 1.15));
  if (rng() < 0.8) g.roundRect(p.x - 8, p.y - h * 0.7, 2.4, h * 0.35, 1.2).fill(green).rect(p.x - 8, p.y - h * 0.4, 6, 2.2).fill(green);
  if (rng() < 0.6) g.roundRect(p.x + 5.6, p.y - h * 0.8, 2.4, h * 0.3, 1.2).fill(shade(green, 0.85)).rect(p.x + 2.6, p.y - h * 0.55, 5, 2.2).fill(shade(green, 0.85));
  const c = new Container();
  c.addChild(g);
  return c;
}

function boulder(x: number, y: number, rng: () => number, snow: number): Container {
  const g = new Graphics();
  const p = iso(x + 0.3 + rng() * 0.4, y + 0.3 + rng() * 0.4);
  const s = 0.7 + rng() * 0.6;
  g.ellipse(p.x, p.y + 1, 11 * s, 4 * s).fill({ color: 0x000000, alpha: 0.14 });
  g.roundRect(p.x - 10 * s, p.y - 10 * s, 20 * s, 11 * s, 4 * s).fill(0x7d7870);
  g.roundRect(p.x - 7 * s, p.y - 15 * s, 13 * s, 8 * s, 3.5 * s).fill(0x938d84);
  if (snow > 0.3) g.roundRect(p.x - 6 * s, p.y - 16 * s, 11 * s, 3.5 * s, 1.7 * s).fill({ color: 0xffffff, alpha: snow });
  const c = new Container();
  c.addChild(g);
  return c;
}

function reeds(x: number, y: number, rng: Rng): Container {
  const g = new Graphics();
  for (let i = 0; i < 6; i++) {
    const p = iso(x + 0.15 + rng() * 0.7, y + 0.15 + rng() * 0.7);
    const hgt = 8 + rng() * 8;
    g.moveTo(p.x, p.y).lineTo(p.x + (rng() - 0.5) * 4, p.y - hgt).stroke({ width: 1.6, color: 0x6f9a3c });
    if (rng() < 0.5) g.roundRect(p.x - 1.5, p.y - hgt - 5, 3, 6, 1.5).fill(0x7a4e2d);
  }
  const c = new Container();
  c.addChild(g);
  c.zIndex = depthOf(x, y, 50);
  return c;
}
