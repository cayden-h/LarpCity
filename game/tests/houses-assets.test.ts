// Real shipped assets, not a synthetic manifest: this gate runs after Blender and the pixel pass.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { sanFrancisco } from '../src/cities/san-francisco.ts';
import { CityGrid } from '../src/engine/grid.ts';
import { expandWorld } from '../src/engine/world.ts';
import { planHomeLots } from '../src/engine/home-lots.ts';
import { planLots } from '../src/engine/lots.ts';
import { zoneAt as zone } from '../src/engine/zones.ts';
import type { SpriteManifest } from '../src/engine/sprite-pick.ts';

const root = new URL('../public/sprites/', import.meta.url);
const manifest = (city: string): SpriteManifest => JSON.parse(readFileSync(new URL(`${city}/sprites.json`, root), 'utf8'));

test('shipped SF catalog includes 16 complete four-facing house models', () => {
  const m = manifest('san-francisco');
  assert.equal(m.scale, 1);
  const houses = m.sprites.filter(e => e.style);
  assert.equal(houses.length, 64);
  assert.equal(m.sprites.filter(e => !e.style).length, 61); // 2 landmarks, 43 branded entries (33 buildings, 4 freeway V boards, 6 shelters), 16 generic buildings
  const groups = Map.groupBy(houses, e => e.id.slice(0, -2));
  assert.equal(groups.size, 16);
  for (const [id, entries] of groups) {
    assert.deepEqual(new Set(entries.map(e => e.facing)), new Set(['n', 'e', 's', 'w']), id);
    assert.ok(entries.every(e => !!e.walls && e.zones.includes('residential') && !e.unique));
    const s = entries.find(e => e.facing === 's')!;
    const e = entries.find(e => e.facing === 'e')!;
    assert.equal(s.w, e.d); assert.equal(s.d, e.w);
  }
});

test('all six hero homes and both property signs have all four facings', () => {
  const m = manifest('common/home');
  assert.equal(m.sprites.length, 24);
  for (let tier = 0; tier < 6; tier++) assert.deepEqual(new Set(m.sprites.filter(e => e.tier === tier).map(e => e.facing)), new Set(['n', 'e', 's', 'w']));
  const signs = manifest('common/property');
  assert.equal(signs.sprites.length, 8);
  for (const label of ['sale', 'rent']) for (const facing of ['n', 'e', 's', 'w']) assert.ok(signs.sprites.some(e => e.id === `${label}-${facing}`));
});

test('every final SF residential lot uses a real house sprite after home reservation', () => {
  const m = manifest('san-francisco');
  for (const seed of [1, 7, 42]) {
    const city = expandWorld(sanFrancisco, seed).city;
    const grid = new CityGrid(city.layout);
    for (const h of planHomeLots(grid, city)) grid.set(h.x, h.y, 'h');
    // Check zoning directly so absence of an entry cannot exclude a failed residential lot.
    const all = planLots(grid, city, seed, m);
    const residential = all.filter(p => zone(city, p.x, p.y) === 'residential');
    assert.ok(residential.length > 100);
    assert.deepEqual(residential.filter(p => !p.entry?.style).map(p => [p.x, p.y]), [], `seed ${seed}`);
  }
});

test('sprite layers exist, share canvas dimensions, and total less than 8 MB', () => {
  let bytes = 0;
  for (const city of ['san-francisco', 'common/home', 'common/property']) {
    const m = manifest(city);
    assert.equal(m.scale, 1);
    const files = new Set<string>();
    for (const e of m.sprites) {
      const dimensions: string[] = [];
      for (const f of [e.day, e.night, e.walls, e.crown].filter((f): f is string => !!f)) {
        const path = new URL(`${city}/${f}`, root);
        const png = readFileSync(path);
        assert.equal(png.subarray(1, 4).toString(), 'PNG', f);
        dimensions.push(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
        if (!files.has(f)) { bytes += statSync(path).size; files.add(f); }
      }
      assert.equal(new Set(dimensions).size, 1, e.id);
    }
  }
  assert.ok(bytes < 8 * 1024 * 1024, `${bytes} sprite bytes`);
});
