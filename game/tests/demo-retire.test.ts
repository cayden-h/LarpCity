// The judges' "Ready to retire" demo (scripts/build-demo-slots.ts) must open with
// Retire already on and pass, every time it's loaded, so each judge sees the
// same end screen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STATES } from "../src/data/states.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { parseSave, restoreGame } from "../src/sim/save/codec.ts";
import { DEMOS } from "../src/sim/save/slot.ts";
import { isMet, viewOf } from "../src/sim/skip/goals.ts";
import { buildEndgameScore } from "../src/ui/endgame.ts";
import { retirementReadiness } from "../src/sim/wellbeing/retirement.ts";

const START = new Date(2026, 8, 11);
const CA = STATES.find((s) => s.abbr === "CA")!;

function load(id: string) {
  const save = parseSave(JSON.parse(readFileSync(new URL(`../public/demo/${id}.json`, import.meta.url), "utf8")));
  return { save, life: restoreGame(save, { market: new MarketPath(save.seed, START), place: CA, start: START }).life };
}

test("every demo life in DEMOS has a built file that loads", () => {
  for (const d of DEMOS) assert.ok(load(d.id).life, d.id);
});

test("the retirement demo can retire on load, and retiring passes", () => {
  const { save, life } = load("almost-retired");
  assert.ok(retirementReadiness(life) >= 85, `readiness ${retirementReadiness(life)}`);
  const score = buildEndgameScore(life, Math.floor(life.age), save.day);
  assert.equal(score.passed, true);
  assert.ok(score.retiredAge < 65);
});

test("the retirement demo owns its house, so the house goal reads as met", () => {
  const { life } = load("almost-retired");
  const house = life.goals.find((g) => g.kind === "house")!;
  assert.ok(life.homeTier() >= 2);
  assert.equal(isMet(house, viewOf(life), life.age), true);
});

test("loading the retirement demo twice gives the same end screen", () => {
  const a = load("almost-retired");
  const b = load("almost-retired");
  assert.deepEqual(buildEndgameScore(a.life, Math.floor(a.life.age), a.save.day), buildEndgameScore(b.life, Math.floor(b.life.age), b.save.day));
});
