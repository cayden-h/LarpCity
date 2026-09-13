// LayoutBuilder records every road it stamps as a RoadDef. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutBuilder } from "../src/engine/layout.ts";
import { roadTiles, roadWidth } from "../src/engine/roads/types.ts";

test("roadX records a local road through tile centers", () => {
  const L = new LayoutBuilder(10, 6);
  L.roadX(2, 1, 8);
  const [r] = L.roads();
  assert.equal(r.cls, "local");
  assert.deepEqual(r.lanes, [1, 1]);
  assert.deepEqual(r.path, [[1.5, 2.5], [8.5, 2.5]]);
  assert.equal(L.get(1, 2), "=");
  assert.equal(L.get(8, 2), "=");
});

test("arterialX stamps two rows and puts the centerline on their shared edge", () => {
  const L = new LayoutBuilder(10, 6);
  L.arterialX(2, 0, 9);
  const [r] = L.roads();
  assert.equal(r.cls, "arterial");
  assert.equal(roadWidth(r), 2);
  assert.deepEqual(r.path, [[0.5, 3], [9.5, 3]]);
  for (let x = 0; x < 10; x++) {
    assert.equal(L.get(x, 2), "=");
    assert.equal(L.get(x, 3), "=");
  }
});

test("arterialY centerline sits between its two columns", () => {
  const L = new LayoutBuilder(8, 8);
  L.arterialY(3, 0, 7);
  assert.deepEqual(L.roads()[0].path, [[4, 0.5], [4, 7.5]]);
});

test("short water becomes a bridge inside one road; wide water splits it", () => {
  const L = new LayoutBuilder(20, 4);
  L.rect(4, 0, 2, 4, "w"); // 2 wide: bridged
  L.rect(10, 0, 6, 4, "w"); // 6 wide: too wide
  L.roadX(1, 0, 19, "=", 5);
  const roads = L.roads();
  assert.equal(roads.length, 2);
  assert.deepEqual(roads[0].path, [[0.5, 1.5], [9.5, 1.5]]);
  assert.deepEqual(roads[1].path, [[16.5, 1.5], [19.5, 1.5]]);
  assert.equal(L.get(4, 1), "B");
  assert.equal(L.get(12, 1), "w");
});

test("tiles painted over after stamping trim the road", () => {
  const L = new LayoutBuilder(12, 4);
  L.roadX(1, 0, 11);
  L.rect(5, 1, 1, 1, "p");
  const roads = L.roads();
  assert.equal(roads.length, 2);
  assert.deepEqual(roads[0].path, [[0.5, 1.5], [4.5, 1.5]]);
  assert.deepEqual(roads[1].path, [[6.5, 1.5], [11.5, 1.5]]);
  assert.notEqual(roads[0].id, roads[1].id);
});

test("tram roads carry the tram flag", () => {
  const L = new LayoutBuilder(6, 6);
  L.roadY(2, 0, 5, "t");
  assert.equal(L.roads()[0].tram, true);
});

test("roadTiles lists exactly the stamped tiles", () => {
  const L = new LayoutBuilder(10, 10);
  L.arterialY(4, 1, 8);
  const tiles = roadTiles(L.roads()[0]).map(([x, y]) => `${x},${y}`).sort();
  const want: string[] = [];
  for (let y = 1; y <= 8; y++) for (const x of [4, 5]) want.push(`${x},${y}`);
  assert.deepEqual(tiles, want.sort());
});
