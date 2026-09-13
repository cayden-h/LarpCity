// server/src/ai/player-facts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { newsPrompt } from "./coach.js";
import { newsFacts, playerFacts } from "./facts.js";

test("playerFacts keeps only the job and state, and nothing for a skipped intake", () => {
  assert.deepEqual(
    playerFacts({ displayName: null, job: "Nurse", salary: 72000, rent: 1400, debt: 0, savings: 500, state: "TX", source: "typed" }),
    { job: "Nurse", state: "TX" },
  );
  assert.deepEqual(playerFacts({ displayName: null, job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" }), { job: null, state: "CA" });
  assert.equal(playerFacts(null), undefined);
});

test("the newspaper prompt carries the player's job", () => {
  const f = { ...newsFacts(0, 30, [], []), player: { job: "Nurse", state: "TX" } };
  assert.match(newsPrompt(f), /"job":"Nurse"/);
});
