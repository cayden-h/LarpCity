// Pixel kit tests: hard edges, outlines, shadows, and determinism. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { INK, PixelCanvas, SHADOW_ALPHA } from "../src/engine/pixel/canvas.ts";
import { ramp, snap } from "../src/engine/pixel/tones.ts";

const alphas = (c: PixelCanvas) => new Set(Array.from({ length: c.w * c.h }, (_, i) => c.rgba[i * 4 + 3]));

test("fills have hard edges: every pixel is fully in or out", () => {
  const c = new PixelCanvas(24, 24).poly([2, 3, 21.3, 5.7, 12.2, 20.9], 0xff0000).ellipse(12, 12, 5.3, 3.1, 0x00ff00);
  assert.deepEqual([...alphas(c)].sort(), [0, 255]);
});

test("a rectangle covers exactly its whole pixels", () => {
  const c = new PixelCanvas(10, 10).rect(2, 3, 4, 2, 0x123456);
  let n = 0;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (c.at(x, y).alpha) n++;
  assert.equal(n, 8);
  assert.equal(c.at(2, 3).color, 0x123456);
  assert.equal(c.at(6, 3).alpha, 0);
});

test("the origin offsets drawing", () => {
  const c = new PixelCanvas(10, 10, 5, 8).rect(0, -1, 1, 1, 0xabcdef);
  assert.equal(c.at(5, 7).color, 0xabcdef);
});

test("outline inks the silhouette and keeps the inside", () => {
  const c = new PixelCanvas(8, 8).rect(1, 1, 6, 6, 0xffffff).outline();
  assert.equal(c.at(1, 1).color, INK);
  assert.equal(c.at(6, 3).color, INK);
  assert.equal(c.at(3, 3).color, 0xffffff);
});

test("outline inks the edge where a later part covers an earlier one, but not glow", () => {
  const c = new PixelCanvas(12, 8)
    .rect(0, 0, 12, 8, 0x0000ff, { part: 1 })
    .rect(4, 2, 4, 4, 0xff0000, { part: 2 })
    .rect(9, 3, 1, 1, 0xffff00, { part: 3, glow: true })
    .outline();
  assert.equal(c.at(3, 3).color, INK, "the earlier part next to the later one is inked");
  assert.equal(c.at(5, 3).color, 0xff0000, "the later part keeps its pixels");
  assert.equal(c.at(9, 3).color, 0xffff00, "glow stays lit");
});

test("shadows are the ink at the shadow alpha, only under empty pixels, and never outlined", () => {
  const c = new PixelCanvas(20, 10).rect(8, 2, 4, 4, 0xffffff).shadowEllipse(10, 6, 8, 3).outline();
  assert.deepEqual([...alphas(c)].sort((a, b) => a - b), [0, SHADOW_ALPHA, 255]);
  assert.equal(c.at(3, 6).alpha, SHADOW_ALPHA);
  assert.equal(c.at(3, 6).color, INK);
});

test("drawing is deterministic", () => {
  const draw = () => new PixelCanvas(16, 16, 8, 12).poly([-6, 0, 0, -3, 6, 0, 0, 3], 0x88aa33, { part: 1 }).line(-5, -9, 5, -2, 0x333333).outline().rgba;
  assert.deepEqual(draw(), draw());
});

test("ramp lights the top, keeps the left, shades the right", () => {
  const r = ramp(0x808080);
  assert.ok(r.top > r.left && r.left > r.right);
});

test("snap picks the nearest palette color", () => {
  assert.equal(snap(0xfe0101, [0x000000, 0xff0000, 0x00ff00]), 0xff0000);
});
