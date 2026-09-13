// server/src/routes/save-slots.test.ts
// The save routes' `?slot=`: a client can only name slot 0, 1, or 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotQuery } from "./save.js";

test("the slot query takes 0, 1, or 2 and defaults to 0", () => {
  assert.equal(slotQuery.parse({}).slot, 0);
  assert.equal(slotQuery.parse({ slot: "0" }).slot, 0);
  assert.equal(slotQuery.parse({ slot: "2" }).slot, 2);
});

test("the slot query refuses anything but 0, 1, or 2", () => {
  for (const bad of ["3", "-1", "1.5", "abc", "1e9", ["1", "2"], { slot: 1 }]) {
    assert.equal(slotQuery.safeParse({ slot: bad }).success, false, JSON.stringify(bad));
  }
});
