import { test } from "node:test";
import assert from "node:assert/strict";
import { feedQuery } from "./news.js";

test("from/to default to the full day range", () => {
  const q = feedQuery.parse({});
  assert.equal(q.from, 0);
  assert.ok(q.to > 0);
});

test("from/to reject out-of-range or non-numeric values", () => {
  assert.equal(feedQuery.safeParse({ from: -1 }).success, false);
  assert.equal(feedQuery.safeParse({ from: "not-a-number" }).success, false);
});
