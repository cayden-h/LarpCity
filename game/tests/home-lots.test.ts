import assert from 'node:assert/strict';
import test from 'node:test';
import { CityGrid } from '../src/engine/grid.ts';
import { expandWorld } from '../src/engine/world.ts';
import { planHomeLots } from '../src/engine/home-lots.ts';
import { zoneAt } from '../src/engine/zones.ts';
import { roadTiles } from '../src/engine/roads/types.ts';
import { STATES } from '../src/data/states.ts';
import { templateCity } from '../src/cities/templates.ts';
import { houston } from '../src/cities/houston.ts';
import { dallas } from '../src/cities/dallas.ts';
import { austin } from '../src/cities/austin.ts';
import { miami } from '../src/cities/miami.ts';
import { newYork } from '../src/cities/new-york.ts';
import { sanFrancisco } from '../src/cities/san-francisco.ts';
import type { CityDef } from '../src/engine/types.ts';

const handmade = [houston, dallas, austin, miami, newYork, sanFrancisco];
const sources = [...STATES.map(s => handmade.find(c => c.id === s.cityId) ?? templateCity(s)), dallas, austin];
const neighbors = (x: number, y: number) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];

assert.equal(STATES.length, 51);
for (const source of sources) test(`${source.state}/${source.id}: six safe, geographic, deterministic home lots`, () => {
  // Rules are tested independently of the city's curated overrides.
  const city = expandWorld({ ...source, homes: undefined }, 7).city;
  const grid = new CityGrid(city.layout);
  const before = [...grid.cells()];
  const definition = JSON.stringify(city);
  const lots = planHomeLots(grid, city);
  assert.deepEqual(lots.map(l => l.tier), [0, 1, 2, 3, 4, 5]);
  assert.equal(new Set(lots.map(l => `${l.x},${l.y}`)).size, 6);
  assert.deepEqual(planHomeLots(grid, city), lots);
  assert.deepEqual([...grid.cells()], before);
  assert.equal(JSON.stringify(city), definition);
  const restricted = new Set(city.roads.filter(r => r.cls === 'highway' || r.cls === 'ramp').flatMap(roadTiles).map(([x,y]) => `${x},${y}`));
  const core = city.core!;
  const inCore = (x: number, y: number) => x >= core.x && y >= core.y && x < core.x + core.w && y < core.y + core.h;
  for (const l of lots) {
    assert.ok(Number.isInteger(l.x) && Number.isInteger(l.y));
    assert.equal(l.w, 1); assert.equal(l.d, 1);
    assert.ok(['b', 'h', '.', 'p', 's', 'f'].includes(grid.at(l.x,l.y)));
    assert.ok(l.where.trim());
    assert.ok(neighbors(l.x,l.y).some(([x,y]) => ['=', 't'].includes(grid.at(x,y)) && !restricted.has(`${x},${y}`)), 'surface road frontage');
    for (const lm of city.landmarks) {
      assert.ok(!(l.x >= lm.x && l.x < lm.x + lm.w && l.y >= lm.y && l.y < lm.y + lm.d), lm.id);
      const ahead = l.x + l.y + 1 - (lm.x + lm.y + (lm.w + lm.d) / 2);
      const offset = Math.abs(l.x - l.y - (lm.x + lm.w / 2 - lm.y - lm.d / 2));
      if (l.tier === 1) assert.ok(!(ahead > 0 && ahead < 6 && offset <= (lm.w + lm.d) / 2 + .5), 'studio blocks landmark');
    }
  }
  const [tent, studio, small, town, large, villa] = lots;
  assert.ok(grid.at(tent.x,tent.y) === 'p' || neighbors(tent.x,tent.y).some(([x,y]) => grid.at(x,y) === 'p'), 'park edge');
  assert.ok(inCore(studio.x, studio.y)); assert.equal(zoneAt(city, studio.x, studio.y), 'midtown');
  assert.equal(grid.at(small.x,small.y), 'h');
  assert.ok(inCore(town.x,town.y)); assert.equal(zoneAt(city,town.x,town.y), 'residential');
  assert.ok(!inCore(large.x,large.y));
  assert.ok(Math.max(core.x-large.x, large.x-(core.x+core.w-1), core.y-large.y, large.y-(core.y+core.h-1)) <= (city.outskirts?.suburbs ?? 10));
  // The villa must reach the coastline or the actual clipped map boundary, not the core edge.
  let edgeDistance = Infinity;
  for (const c of grid.cells()) if (c.c === 'w' || c.c === ' ') edgeDistance = Math.min(edgeDistance, Math.abs(c.x-villa.x)+Math.abs(c.y-villa.y));
  assert.ok(edgeDistance <= 3, `villa distance to coast/map edge: ${edgeDistance}`);
});

test('honors safe explicit lots and labels; rejects invalid and conflicting overrides with reasons', () => {
  const city = expandWorld({ ...houston, homes: undefined }, 7).city;
  const grid = new CityGrid(city.layout);
  const defaults = planHomeLots(grid,city);
  const explicit: CityDef = { ...city, homes: defaults.map(l => ({ tier:l.tier, x:l.x, y:l.y, where:`District ${l.tier}` })) };
  assert.deepEqual(planHomeLots(grid,explicit).map(l => l.where), defaults.map(l => `District ${l.tier}`));
  for (const bad of [{ x:NaN,y:1 }, { x:1.5,y:1 }, { x:-1,y:1 }, city.landmarks[0], { x:defaults[2].x,y:defaults[2].y }]) {
    const result = planHomeLots(grid,{ ...city, homes:[{ tier:1, ...bad }] });
    assert.ok(result[1].rationale);
    assert.deepEqual([result[1].x,result[1].y], [defaults[1].x,defaults[1].y]);
  }
});

test('fails clearly when six safe lots cannot be placed', () => {
  const city = { ...houston, layout:['www'], roads:[], landmarks:[], homes:undefined };
  assert.throws(() => planHomeLots(new CityGrid(city.layout),city), /home lot/i);
});

test('explicit studio cannot use roads, water, bridges, or the foreground of a landmark', () => {
  const city = expandWorld({ ...houston, homes:undefined },7).city;
  const grid = new CityGrid(city.layout);
  const defaults = planHomeLots(grid,city);
  for (const tile of ['=', 't', 'B', 'O', 'w'] as const) {
    const p = [...grid.cells()].find(c => c.c === tile);
    if (!p) continue;
    const result = planHomeLots(grid,{ ...city, homes:[{ tier:1, x:p.x,y:p.y }] });
    assert.ok(result[1].rationale, tile);
    assert.notDeepEqual([result[1].x,result[1].y],[p.x,p.y]);
  }
  const studio = defaults[1];
  const blocked = { ...city, landmarks:[...city.landmarks,{ id:'sightline-fixture', x:studio.x-1,y:studio.y-1,w:1,d:1 }], homes:[{tier:1,x:studio.x,y:studio.y}] };
  const result = planHomeLots(grid,blocked);
  assert.ok(result[1].rationale);
  assert.notDeepEqual([result[1].x,result[1].y],[studio.x,studio.y]);
});

test('conflicting explicit lots have deterministic priority and do not overlap', () => {
  const city = expandWorld({ ...houston, homes:undefined },7).city;
  const grid = new CityGrid(city.layout);
  const p = planHomeLots(grid,city)[0];
  const homes = [{tier:0,x:p.x,y:p.y,where:'Chosen park'}, {tier:5,x:p.x,y:p.y}];
  const result = planHomeLots(grid,{...city,homes});
  assert.equal(result[0].where,'Chosen park');
  assert.ok(result[5].rationale);
  assert.equal(new Set(result.map(l => `${l.x},${l.y}`)).size,6);
  assert.deepEqual(planHomeLots(grid,{...city,homes:[...homes].reverse()}),result);
});

test('missing park terrain gives a documented safe fallback', () => {
  const city = expandWorld({...houston,homes:undefined},7).city;
  const grid = new CityGrid(city.layout.map(row => row.replaceAll('p','.')));
  const tent = planHomeLots(grid,city)[0];
  assert.equal(tent.where,'Residential fallback');
  assert.match(tent.rationale!, /No safe park edge/);
});

for (const seed of [1, 7, 42, 2026]) test(`SF curated home lots survive widened roads, seed ${seed}`, () => {
  const city = expandWorld(sanFrancisco, seed).city;
  const lots = planHomeLots(new CityGrid(city.layout), city);
  for (const requested of sanFrancisco.homes!) {
    const actual = lots.find(l => l.tier === requested.tier)!;
    assert.equal(actual.x, requested.x + city.core!.x);
    assert.equal(actual.y, requested.y + city.core!.y);
    assert.equal(actual.where, requested.where);
    assert.equal(actual.rationale, undefined);
  }
});
