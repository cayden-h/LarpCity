// Facing, pose blending, and elevation for drawing cars. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { elevation, facingOf, lerpPose } from "../src/engine/roads/pose.ts";

test("headings map to the nearest of 8 facings", () => {
  assert.equal(facingOf(0), 0);
  assert.equal(facingOf(Math.PI / 2), 2);
  assert.equal(facingOf(Math.PI), 4);
  assert.equal(facingOf(-Math.PI / 2), 6);
  assert.equal(facingOf(-0.2), 0);
  assert.equal(facingOf(Math.PI / 4 + 0.1), 1);
});

test("pose blending turns the short way across the back", () => {
  const p = lerpPose({ x: 0, y: 0, h: Math.PI - 0.1 }, { x: 2, y: 0, h: -Math.PI + 0.1 }, 0.5);
  assert.equal(p.x, 1);
  assert.ok(Math.abs(Math.abs(p.h) - Math.PI) < 1e-9, `${p.h}`);
});

test("cars ride up on bridges, and on overpasses only when on the upper road", () => {
  const rows = ["=B=", "=O="];
  const grid = { at: (x: number, y: number) => rows[y]?.[x] ?? " " };
  assert.equal(elevation(grid, 0.5, 0.5, false), 0);
  assert.equal(elevation(grid, 1.5, 0.5, false), 7);
  assert.equal(elevation(grid, 1.5, 1.5, false), 7);
  assert.equal(elevation(grid, 1.5, 1.5, true), 0);
});
