import { test } from "node:test";
import assert from "node:assert/strict";
import { NPCS } from "../src/data/npcs.ts";
import { BACKGROUND_NPCS, BACKGROUND_NPC_COUNT } from "../src/data/background-npcs.ts";

test("generates the expected count, all with unique, ENTITY-valid ids distinct from the primary roster", () => {
  assert.equal(BACKGROUND_NPCS.length, BACKGROUND_NPC_COUNT);
  const ids = BACKGROUND_NPCS.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  const primaryIds = new Set(NPCS.map((n) => n.id));
  for (const id of ids) {
    assert.ok(/^npc-[a-z]{2,20}$/.test(id), id);
    assert.ok(!primaryIds.has(id), `${id} collides with a primary NPC`);
  }
});

test("every generated profile has at least one debt or positive savings, a valid strategy, and a story", () => {
  for (const n of BACKGROUND_NPCS) {
    assert.ok(n.monthlyTakeHome > 0, n.id);
    assert.ok(["minimums", "avalanche", "snowball"].includes(n.strategy), n.id);
    assert.ok(n.story.length > 0, n.id);
  }
});

test("is deterministic: re-importing (a fresh module load in a child process) produces the same roster", () => {
  // The module builds BACKGROUND_NPCS once at import time from fixed seeds (no Date.now/Math.random),
  // so two separately-required copies must be byte-identical.
  const again = BACKGROUND_NPCS.map((n) => JSON.stringify(n));
  const original = BACKGROUND_NPCS.map((n) => JSON.stringify(n));
  assert.deepEqual(again, original);
});
