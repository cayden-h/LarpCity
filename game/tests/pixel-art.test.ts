// Art rules for every code-drawn pixel family: an ink outline, only the shadow
// may be translucent, few tones, and seeded variants that differ. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { INK, SHADOW_ALPHA, type PixelCanvas } from "../src/engine/pixel/canvas.ts";
import { contactFamilies } from "../src/engine/pixel/catalog.ts";
import { SPECIES, treeArt, VARIANTS } from "../src/engine/pixel/plants.ts";

const colors = (c: PixelCanvas) => {
  const out = new Set<number>();
  for (let i = 0; i < c.w * c.h; i++) if (c.rgba[i * 4 + 3] === 255) out.add((c.rgba[i * 4] << 16) | (c.rgba[i * 4 + 1] << 8) | c.rgba[i * 4 + 2]);
  return out;
};

for (const family of contactFamilies()) {
  test(`${family.name}: outlined, only the shadow translucent, a small palette`, () => {
    for (const c of family.art) {
      assert.ok(c.solidCount > 20, "draws something");
      assert.ok(colors(c).has(INK), "has an ink outline");
      for (let i = 3; i < c.rgba.length; i += 4) assert.ok([0, 255, SHADOW_ALPHA].includes(c.rgba[i]), `alpha ${c.rgba[i]}`);
      assert.ok(colors(c).size <= 14, `${colors(c).size} colors`);
      assert.ok(c.at(c.ox, c.oy - 1).alpha > 0 || c.at(c.ox, c.oy - 2).alpha > 0 || c.at(c.ox, c.oy).alpha > 0, "anchored at its foot");
    }
  });
}

test("tree variants differ and replay identically", () => {
  for (const s of SPECIES) {
    const art = Array.from({ length: VARIANTS }, (_, v) => Buffer.from(treeArt(s, v, { leaf: 0x5db43f }).rgba).toString("base64"));
    assert.equal(new Set(art).size, VARIANTS, s);
    assert.equal(Buffer.from(treeArt(s, 2, { leaf: 0x5db43f }).rgba).toString("base64"), art[2]);
  }
});
