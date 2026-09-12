// server/src/routes/snapshot.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayToTimestamp } from "./snapshot.js";

test("dayToTimestamp maps day 0 to 2000-01-01", () => {
  assert.equal(dayToTimestamp(0), "2000-01-01T00:00:00.000Z");
});

test("dayToTimestamp maps day 365 to 2001-01-01 (2000 is a leap year)", () => {
  assert.equal(dayToTimestamp(366), "2001-01-01T00:00:00.000Z");
});
