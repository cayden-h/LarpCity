// The whole-city lot plan: which house (or building) goes on every lot. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CityDef, HouseStyle } from "../src/engine/types.ts";
import { sanFrancisco } from "../src/cities/san-francisco.ts";
import { CityGrid } from "../src/engine/grid.ts";
import { houseStyles, inCore, planLots, zoneAt } from "../src/engine/lots.ts";
import { facingOf, type SpriteManifest } from "../src/engine/sprite-pick.ts";
import { expandWorld } from "../src/engine/world.ts";

// Synthetic catalog: verifies planner contracts, not availability of rendered SF assets.
const manifest: SpriteManifest = { scale: 1, sprites: [] };
for (const style of ["victorian", "edwardian", "stucco", "suburban", "walkup"] as HouseStyle[]) {
  for (const facing of ["s", "e", "n", "w"] as const) {
    const sizes = style === "walkup" ? [[1, 1], facing === "s" || facing === "n" ? [2, 1] : [1, 2]] : [[1, 1]];
    for (const [w, d] of sizes) manifest.sprites.push({
      id: `${style}-${facing}-${w}x${d}`, w, d, facing, style,
      floors: style === "walkup" ? (w * d > 1 ? 4 : 3) : style === "suburban" ? 1 : 2,
      zones: ["residential"], unique: false, brand: null, ax: 32, ay: 64, topZ: 64,
      day: "synthetic.png", night: "synthetic.night.png", walls: "synthetic.walls.png",
    });
  }
}
const { city } = expandWorld({ ...sanFrancisco, zones: sanFrancisco.zones.map((z) => z.kind !== "residential" ? z : {
  ...z, houses: (z.x === 13 ? ["stucco"] : z.x === 24 ? ["victorian", "edwardian"] : ["suburban"]) as HouseStyle[],
}) }, 7);
const plans = planLots(new CityGrid(city.layout), city, 7, manifest);
const homes = plans.filter((p) => zoneAt(city, p.x, p.y) === "residential");

test("synthetic catalog covers every SF residential and suburb lot", () => {
  const missing = homes.filter((p) => !p.entry);
  assert.ok(homes.length > 200, `only ${homes.length} residential lots`);
  assert.equal(missing.length, 0, `${missing.length} of ${homes.length} fell back to bricks, e.g. ${JSON.stringify(missing.slice(0, 3).map(({ x, y, w, d }) => ({ x, y, w, d })))}`);
});

test("suburb-ring houses are suburban and core houses follow their zone", () => {
  for (const p of homes) {
    if (!p.entry?.style) continue;
    if (!inCore(city, p.x, p.y)) assert.equal(p.entry.style, "suburban", `${p.x},${p.y}`);
    else if (p.entry.style !== "walkup") assert.ok(houseStyles(city, p.x, p.y).includes(p.entry.style), `${p.x},${p.y} ${p.entry.style}`);
  }
  assert.deepEqual(houseStyles(city, city.core!.x + 13, city.core!.y + 26), ["stucco"]); // the Sunset
});

test("walk-ups break up about one core lot in eight", () => {
  const core = homes.filter((p) => inCore(city, p.x, p.y) && p.entry);
  const share = core.filter((p) => p.entry!.style === "walkup").length / core.length;
  assert.ok(share > 0.05 && share < 0.25, `walk-up share ${share.toFixed(2)}`);
});

test("rows stay coherent: a house matches its neighbor on the same street side when it can", () => {
  const at = new Map(homes.map((p) => [`${p.x},${p.y}`, p]));
  let pairs = 0, mismatched = 0;
  for (const p of homes) {
    const e = p.entry;
    if (!e?.style || e.style === "walkup" || p.w * p.d > 1) continue;
    const q = at.get(e.facing === "s" || e.facing === "n" ? `${p.x - 1},${p.y}` : `${p.x},${p.y - 1}`);
    const f = q?.entry;
    if (!f?.style || f.style === "walkup" || f.facing !== e.facing) continue;
    if (!houseStyles(city, p.x, p.y).includes(f.style)) continue;
    pairs++;
    if (f.style !== e.style) mismatched++;
  }
  assert.ok(pairs > 50, `only ${pairs} neighbor pairs`);
  assert.equal(mismatched, 0);
});

test("the plan is deterministic", () => {
  const again = planLots(new CityGrid(city.layout), city, 7, manifest);
  assert.deepEqual(again, plans);
});

test("planning covers buildable tiles exactly once without changing the grid", () => {
  const grid = new CityGrid(city.layout);
  const before = [...grid.cells()];
  const occupied = new Set<string>();
  for (const p of planLots(grid, city, 7, manifest)) {
    assert.ok(city.palette.walls.includes(p.tint));
    for (let y = p.y; y < p.y + p.d; y++) for (let x = p.x; x < p.x + p.w; x++) {
      const key = `${x},${y}`;
      assert.equal(grid.at(x, y), "b");
      assert.ok(!occupied.has(key), `overlapping lot at ${key}`);
      occupied.add(key);
    }
    if (p.entry?.style) {
      assert.equal(p.entry.w, p.w);
      assert.equal(p.entry.d, p.d);
      assert.equal(p.entry.facing, facingOf((x, y) => grid.isRoad(x, y), p.x, p.y, p.w, p.d));
    }
  }
  assert.equal(occupied.size, grid.count("b"));
  assert.deepEqual([...grid.cells()], before);
});

test("missing assets retain deterministic brick fallbacks", () => {
  const run = () => planLots(new CityGrid(city.layout), city, 7, null);
  const fallback = run();
  assert.ok(fallback.length > 200);
  assert.ok(fallback.every((p) => p.entry === null && p.spec.floors >= 1));
  assert.deepEqual(run(), fallback);
});

test("core boundaries and absent or empty house families have stable defaults", () => {
  const c = { ...city, core: { x: 10, y: 20, w: 3, h: 4 }, zones: [] };
  assert.ok(inCore(c, 10, 20));
  assert.ok(inCore(c, 12, 23));
  for (const [x, y] of [[9, 20], [13, 20], [10, 19], [10, 24]]) {
    assert.equal(inCore(c, x, y), false);
    assert.deepEqual(houseStyles(c, x, y), ["suburban"]);
  }
  assert.deepEqual(houseStyles(c, 10, 20), ["victorian", "edwardian"]);
  assert.ok(inCore({ ...c, core: undefined }, -100, -100));
  assert.deepEqual(houseStyles({ ...c, zones: [{ x: 10, y: 20, r: 3, kind: "residential", houses: [] }] }, 10, 20), ["victorian", "edwardian"]);
});

const fixture = (layout: string[]): CityDef => ({ ...sanFrancisco, id: "house-regressions", layout, core: undefined, landmarks: [],
  zones: [{ x: 2, y: 0, r: 100, kind: "residential", houses: ["victorian", "edwardian"] }] });
const runFixture = (c: CityDef, seed: number, m = manifest) => planLots(new CityGrid(c.layout), c, seed, m);

test("same-facing houses keep a family across yards along an uninterrupted road", () => {
  const c = fixture(["b.b.b", "====="]);
  // Suppress walk-ups with a two-floor sightline cap to inspect the row family directly.
  c.landmarks = [0, 2, 4].map((x) => ({ id: `test-${x}`, x, y: -1, w: 1, d: 1 }));
  for (let seed = 0; seed < 40; seed++) {
    const row = runFixture(c, seed).filter((p) => p.entry?.style !== "walkup");
    assert.equal(row.length, 3);
    assert.ok(row.every((p) => p.entry?.facing === "s"));
    assert.equal(new Set(row.map((p) => p.entry?.style)).size, 1, `seed ${seed}`);
  }
});

test("a corner facing a different street does not inherit the previous house family", () => {
  const withNeighbor = fixture(["bb=", "=.."]);
  const alone = fixture([".b=", "=.."]);
  withNeighbor.landmarks = alone.landmarks = [0, 1].map((x) => ({ id: `test-${x}`, x, y: -1, w: 1, d: 1 }));
  // Per-lot randomness makes the corner independent of the differently facing neighbor.
  for (let seed = 0; seed < 40; seed++) {
    const row = runFixture(withNeighbor, seed);
    assert.equal(row[0].entry?.facing, "s");
    assert.equal(row[1].entry?.facing, "e");
    assert.equal(row[1].entry?.style, runFixture(alone, seed)[0].entry?.style);
  }
});

test("larger footprints with stricter sightlines or missing compatible art stay single lots", () => {
  const c = fixture([".....", "...b=", "...b=", "....="]);
  c.landmarks = [{ id: "test", x: 0, y: 0, w: 1, d: 1 }];
  const missingFacing = { ...manifest, sprites: manifest.sprites.filter((e) => !(e.w === 1 && e.d === 2 && e.facing === "e")) };
  for (const m of [manifest, missingFacing]) for (const seed of [9, ...Array.from({ length: 100 }, (_, i) => i)]) {
    const row = runFixture(c, seed, m);
    assert.equal(row.length, 2, `seed ${seed}`);
    assert.ok(row.every((p) => p.w === 1 && p.d === 1 && p.entry), `seed ${seed}`);
  }
  // Without a landmark, available long-side art should actually allow some two-tile lots.
  const open = { ...c, landmarks: [] };
  assert.ok(Array.from({ length: 100 }, (_, seed) => runFixture(open, seed)).some((row) => row.some((p) => p.d === 2)));
  assert.ok(Array.from({ length: 100 }, (_, seed) => runFixture(open, seed, missingFacing)).every((row) => row.length === 2));
});

test("house styles and catalog additions leave commercial choices unchanged", () => {
  const c = fixture(["b.b.b...bbbb", "========bbbb", "........bbbb"]);
  c.zones[0].r = 3;
  c.zones.push({ x: 9, y: 1, r: 3, kind: "downtown" });
  const changed = { ...c, zones: c.zones.map((z) => z.kind === "residential" ? { ...z, houses: ["suburban"] as HouseStyle[] } : z) };
  const commercial = (plans: ReturnType<typeof planLots>) => plans.filter((p) => p.x >= 8);
  // Lock the original populate stream, including footprint and height draws after residential lots.
  assert.deepEqual(commercial(runFixture(c, 9, { scale: 1, sprites: [] })).map((p) =>
    [p.x, p.y, p.w, p.d, p.spec.floors, p.spec.wall, p.spec.roofType]), [
    [8, 0, 2, 2, 6, 14272748, "antenna"], [10, 0, 2, 2, 12, 8369109, "flat"],
    [8, 2, 2, 1, 10, 16448250, "flat"], [10, 2, 1, 1, 14, 16306088, "flat"],
    [11, 2, 1, 1, 5, 11458289, "flat"],
  ]);
  for (let seed = 0; seed < 20; seed++) {
    assert.deepEqual(commercial(runFixture(c, seed, { scale: 1, sprites: [] })), commercial(runFixture(changed, seed)));
  }
});
