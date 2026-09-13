import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEndgameScore, retirementReady } from "../src/ui/endgame.ts";
import { PlayerLife, type Place } from "../src/sim/life/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };

test("retiring before 65 passes; at or after 65 does not", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const scoreYoung = buildEndgameScore(life, 58, 0);
  assert.equal(scoreYoung.passed, true);
  const scoreOld = buildEndgameScore(life, 65, 0);
  assert.equal(scoreOld.passed, false);
});

test("buildEndgameScore reports the same RR/Wlife/final finalScore computes", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const score = buildEndgameScore(life, 60, 0);
  assert.equal(typeof score.RR, "number");
  assert.equal(typeof score.Wlife, "number");
  assert.equal(score.final, Math.round((0.6 * score.RR + 0.4 * score.Wlife) * 10) / 10);
});

test("retirementReady reflects retirementReadiness's real 0-100 scale (fully ready at 100)", () => {
  const notReady = {
    retirementSavings: () => 0, grossAnnual: 100_000,
    book: { profile: { score: 300 } }, netWorth: () => 0, totalDebt: () => 100_000,
  };
  assert.equal(retirementReady(notReady), false);

  const fullyReady = {
    retirementSavings: () => 10 * 100_000, grossAnnual: 100_000,
    book: { profile: { score: 850 } }, netWorth: () => 10 * 100_000, totalDebt: () => 0,
  };
  assert.equal(retirementReady(fullyReady), true);
});
