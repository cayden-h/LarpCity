// Chart helpers that don't need a DOM: direct-label placement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { placeTags } from "../src/debt-demo/chart.ts";

test("labels far apart stay where their lines end", () => {
  assert.deepEqual(placeTags([40, 120], 14, 226, 16), [40, 120]);
});

test("close labels are pushed apart, in input order", () => {
  assert.deepEqual(placeTags([100, 95], 14, 226, 16), [111, 95]);
});

test("labels at the bottom edge are pulled back inside", () => {
  const ys = placeTags([225, 226, 224], 14, 226, 16);
  assert.ok(Math.max(...ys) <= 226 && Math.min(...ys) >= 14, ys.join(","));
  const sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 16 - 1e-9, sorted.join(","));
});

test("labels above the top edge are pushed inside", () => {
  assert.deepEqual(placeTags([0], 14, 226, 16), [14]);
});
