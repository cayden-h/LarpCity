// Every SF brand is placed once, in its zones, whatever the seed. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sanFrancisco } from "../src/cities/san-francisco.ts";
import { CityGrid } from "../src/engine/grid.ts";
import { planLots, zoneAt } from "../src/engine/lots.ts";
import type { SpriteEntry, SpriteManifest } from "../src/engine/sprite-pick.ts";
import { expandWorld } from "../src/engine/world.ts";

const manifest: SpriteManifest = JSON.parse(readFileSync(new URL("../public/sprites/san-francisco/sprites.json", import.meta.url), "utf8"));
const brands = manifest.sprites.filter((s: SpriteEntry) => s.unique && !s.kind);

test("the SF roster has its branded buildings and freeway V boards", () => {
  assert.ok(brands.length >= 35, `only ${brands.length} branded buildings`);
  assert.equal(manifest.sprites.filter((s) => s.prop === "vboard").length, 4);
});

for (const seed of [1, 7, 20260912]) {
  test(`every SF brand is placed exactly once, in its zones (seed ${seed})`, () => {
    const { city } = expandWorld(sanFrancisco, seed);
    const plans = planLots(new CityGrid(city.layout), city, seed, manifest);
    for (const b of brands) {
      const lots = plans.filter((p) => p.entry?.id === b.id);
      assert.equal(lots.length, 1, `${b.id} placed ${lots.length} times`);
      assert.ok(b.zones.includes(zoneAt(city, lots[0].x, lots[0].y)), `${b.id} outside its zones`);
    }
  });
}

test("brands with an area stand in it on the default seed", () => {
  const seed = 20260912;
  const { city } = expandWorld(sanFrancisco, seed);
  const plans = planLots(new CityGrid(city.layout), city, seed, manifest);
  const inArea = brands.filter((b) => b.area).map((b) => {
    const p = plans.find((q) => q.entry?.id === b.id)!;
    const a = city.areas!.find((q) => q.id === b.area)!;
    return Math.hypot(p.x + p.w / 2 - a.x, p.y + p.d / 2 - a.y) <= a.r;
  });
  assert.ok(inArea.filter(Boolean).length >= inArea.length * 0.75, `${inArea.filter(Boolean).length} of ${inArea.length} in their areas`);
});
