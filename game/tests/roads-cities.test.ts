// Every city's recorded roads match its road tiles exactly. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { austin } from "../src/cities/austin.ts";
import { dallas } from "../src/cities/dallas.ts";
import { houston } from "../src/cities/houston.ts";
import { miami } from "../src/cities/miami.ts";
import { newYork } from "../src/cities/new-york.ts";
import { sanFrancisco } from "../src/cities/san-francisco.ts";
import { templateCity } from "../src/cities/templates.ts";
import { STATES } from "../src/data/states.ts";
import { roadTiles } from "../src/engine/roads/types.ts";
import type { CityDef } from "../src/engine/types.ts";

const ROADISH = new Set(["=", "B", "t", "O"]);
const HANDMADE = [houston, dallas, austin, miami, newYork, sanFrancisco];

function check(city: CityDef): void {
  const at = (x: number, y: number) => city.layout[y]?.[x] ?? " ";
  const covered = new Set<string>();
  for (const r of city.roads)
    for (const [x, y] of roadTiles(r)) {
      assert.ok(ROADISH.has(at(x, y)), `${city.id}: ${r.id} covers ${x},${y} = "${at(x, y)}"`);
      covered.add(`${x},${y}`);
    }
  city.layout.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (ROADISH.has(c)) assert.ok(covered.has(`${x},${y}`), `${city.id}: road tile ${x},${y} has no road`);
    }),
  );
}

for (const city of HANDMADE)
  test(`${city.id}: roads match road tiles and include an arterial`, () => {
    check(city);
    assert.ok(city.roads.some((r) => r.cls === "arterial"), `${city.id} has no arterial`);
  });

test("every template city's roads match its road tiles", () => {
  for (const s of STATES) check(templateCity(s));
});
