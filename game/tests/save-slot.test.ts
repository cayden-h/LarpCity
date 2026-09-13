// Which save slot a page plays (sim/save/slot.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSlot, parseSlot, rememberSlot } from "../src/sim/save/slot.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("only 0, 1, and 2 are slots", () => {
  assert.equal(parseSlot("0"), 0);
  assert.equal(parseSlot("2"), 2);
  for (const bad of ["3", "-1", "1.5", "", " ", "x", null, undefined]) assert.equal(parseSlot(bad), null, String(bad));
});

test("the URL's slot wins, then the one remembered, then slot 0", () => {
  const store = memory();
  assert.equal(activeSlot(new URLSearchParams(""), store), 0);
  rememberSlot(2, store);
  assert.equal(activeSlot(new URLSearchParams(""), store), 2);
  assert.equal(activeSlot(new URLSearchParams("slot=1"), store), 1);
  assert.equal(activeSlot(new URLSearchParams("slot=9"), store), 2);
});

test("blocked storage falls back to the URL or slot 0", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(activeSlot(new URLSearchParams(""), blocked), 0);
  assert.doesNotThrow(() => rememberSlot(1, blocked));
});
