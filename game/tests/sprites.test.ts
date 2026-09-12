// Sprite choice tests. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findLandmark, pickSprite, placeShelters, spriteOrigin, type SpriteEntry, type SpriteManifest } from "../src/engine/sprite-pick.ts";

const entry = (id: string, w: number, d: number, floors: number, zones: string[], unique = false): SpriteEntry => ({
  id, w, d, floors, zones, unique, brand: unique ? id : null, ax: 72, ay: 400, topZ: 330, day: `${id}.png`, night: `${id}.night.png`,
});

const manifest: SpriteManifest = {
  scale: 2,
  sprites: [
    entry("hero", 2, 2, 16, ["downtown"], true),
    entry("tall", 2, 2, 14, ["downtown"]),
    entry("short", 2, 2, 7, ["downtown", "midtown"]),
    entry("small", 1, 1, 5, ["midtown"]),
    entry("jenis", 1, 1, 3, ["midtown"], true),
    { ...entry("salesforce-lm", 2, 2, 3, ["downtown"]), kind: "landmark", landmark: "sf-glass-tower" },
    { ...entry("shelter-sy", 1, 1, 1, ["downtown", "midtown"]), kind: "prop", prop: "shelter", side: "sy" },
  ],
};

const always = (v: number) => () => v;

test("a unique branded sprite is placed first on a hero spot, then never again", () => {
  const used = new Set<string>();
  const lot = { zone: "downtown", w: 2, d: 2, maxFloors: 8, cap: Infinity, heroSpot: true };
  assert.equal(pickSprite(manifest, lot, used, always(0))?.id, "hero");
  assert.notEqual(pickSprite(manifest, lot, used, always(0))?.id, "hero");
});

test("off a hero spot, branded sprites only sometimes take the lot", () => {
  const edge = { zone: "downtown", w: 2, d: 2, maxFloors: 8, cap: Infinity, heroSpot: false };
  const skipped = new Set<string>();
  assert.equal(pickSprite(manifest, edge, skipped, always(0.5))?.id, "short");
  assert.equal(skipped.size, 0);
  const taken = new Set<string>();
  assert.equal(pickSprite(manifest, edge, taken, always(0.1))?.id, "hero");
  assert.ok(taken.has("hero"));
});

test("a unique sprite can take a hero spot in midtown too", () => {
  const used = new Set<string>();
  const lot = { zone: "midtown", w: 1, d: 1, maxFloors: 6, cap: Infinity, heroSpot: true };
  assert.equal(pickSprite(manifest, lot, used, always(0))?.id, "jenis");
  assert.equal(pickSprite(manifest, lot, used, always(0))?.id, "small");
});

test("landmark and prop sprites are never picked as buildings", () => {
  const used = new Set(["hero"]);
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const big = pickSprite(manifest, { zone: "downtown", w: 2, d: 2, maxFloors: 20, cap: Infinity, heroSpot: false }, used, always(r));
    assert.ok(big && !big.kind, `picked ${big?.id}`);
    const small = pickSprite(manifest, { zone: "downtown", w: 1, d: 1, maxFloors: 20, cap: Infinity, heroSpot: true }, used, always(r));
    assert.equal(small, null);
  }
});

test("a landmark sprite is found by the landmark it replaces", () => {
  assert.equal(findLandmark(manifest, "sf-glass-tower")?.id, "salesforce-lm");
  assert.equal(findLandmark(manifest, "sf-ferry-building"), null);
});

// A grid with two long streets: a road along row 5 and one down column 10.
const street = (x: number, y: number) => (y === 5 || x === 10 ? "=" : ".");
const shelters = (m: SpriteManifest, seed = 1) => {
  let a = seed;
  const rng = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  return placeShelters(m, { w: 20, h: 12, at: street, zone: () => "downtown", blocked: (x, y) => x === 3 && y === 4 }, rng);
};

test("shelters stand beside a road, facing it, spread apart", () => {
  const sx = { ...entry("shelter-sx", 1, 1, 1, ["downtown"]), kind: "prop" as const, prop: "shelter" as const, side: "sx" as const };
  const placed = shelters({ ...manifest, sprites: [...manifest.sprites, sx] });
  assert.ok(placed.length > 2 && placed.length <= 8);
  for (const p of placed) {
    assert.equal(street(p.x, p.y), ".");
    if (p.entry.side === "sy") assert.equal(street(p.x, p.y + 1), "=");
    else assert.equal(street(p.x + 1, p.y), "=");
    assert.ok(!(p.x === 3 && p.y === 4));
  }
  for (const p of placed) for (const q of placed) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 4);
  assert.ok(placed.some((p) => p.entry.side === "sx") && placed.some((p) => p.entry.side === "sy"));
  assert.deepEqual(shelters({ ...manifest, sprites: [...manifest.sprites, sx] }), placed);
});

test("no shelter sprites, no shelters; none outside city streets", () => {
  assert.deepEqual(shelters({ ...manifest, sprites: manifest.sprites.filter((s) => s.kind !== "prop") }), []);
  let a = 1;
  const rng = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  assert.deepEqual(placeShelters(manifest, { w: 20, h: 12, at: street, zone: () => "industrial", blocked: () => false }, rng), []);
});

test("generic sprites respect the zone's height and the footprint", () => {
  // Every branded sprite already placed, so only generic ones are left to choose from.
  const used = new Set(["hero", "jenis"]);
  assert.equal(pickSprite(manifest, { zone: "downtown", w: 2, d: 2, maxFloors: 8, cap: Infinity, heroSpot: true }, used, always(0))?.id, "short");
  assert.equal(pickSprite(manifest, { zone: "midtown", w: 1, d: 1, maxFloors: 6, cap: Infinity, heroSpot: false }, used, always(0))?.id, "small");
  assert.equal(pickSprite(manifest, { zone: "midtown", w: 2, d: 1, maxFloors: 9, cap: Infinity, heroSpot: false }, used, always(0)), null);
});

test("the sightline cap applies to heroes too", () => {
  const lot = { zone: "downtown", w: 2, d: 2, maxFloors: 20, cap: 8, heroSpot: true };
  assert.equal(pickSprite(manifest, lot, new Set(), always(0))?.id, "short");
});

test("the sprite's anchor pixel sits on the tile's top corner", () => {
  const e = manifest.sprites[0];
  assert.deepEqual(spriteOrigin(e, 3, 1), { x: (3 - 1) * 32 - 72, y: (3 + 1) * 16 - 400 });
});
