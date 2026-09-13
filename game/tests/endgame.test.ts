import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEndgameScore, retirementReady } from "../src/ui/endgame.ts";
import { retirementReadiness } from "../src/sim/wellbeing/retirement.ts";
import { PlayerLife, type Place } from "../src/sim/life/index.ts";
import type { Goal, GoalView } from "../src/sim/skip/types.ts";

const emptyView: GoalView = {
  cash: 0, emergency: 0, brokerage: 0, retirement: 0, debt: 0, minimums: 0,
  monthlyExpenses: 0, monthlyGross: 0, homePrice: 0, relationship: "single", grossAnnual: 0,
};

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

test("retirementReady is true once readiness clears 85, without demanding a perfect 850 credit score", () => {
  const notReady = {
    retirementSavings: () => 0, grossAnnual: 100_000,
    book: { profile: { score: 300 } }, netWorth: () => 0, totalDebt: () => 100_000,
  };
  assert.equal(retirementReady(notReady, [], emptyView, 0), false);

  // Maxes savings/net worth/debt terms but keeps a merely good (not perfect) 750 credit score;
  // retirementReadiness lands above 85 without ever reaching the old, practically unreachable 100.
  const wellPrepared = {
    retirementSavings: () => 10 * 100_000, grossAnnual: 100_000,
    book: { profile: { score: 750 } }, netWorth: () => 10 * 100_000, totalDebt: () => 0,
  };
  assert.ok(retirementReadiness(wellPrepared) >= 85 && retirementReadiness(wellPrepared) < 100);
  assert.equal(retirementReady(wellPrepared, [], emptyView, 0), true);
});

test("retirementReady also passes on a met retirement_age goal, even with low readiness", () => {
  const belowThreshold = {
    retirementSavings: () => 0, grossAnnual: 100_000,
    book: { profile: { score: 300 } }, netWorth: () => 0, totalDebt: () => 100_000,
  };
  assert.ok(retirementReadiness(belowThreshold) < 85);
  const goals: Goal[] = [{ kind: "retirement_age", targetAge: 65 }];

  // The goal is met (player is 65): passes despite low readiness.
  assert.equal(retirementReady(belowThreshold, goals, emptyView, 65), true);
  // The goal is unmet (player is 40): still fails.
  assert.equal(retirementReady(belowThreshold, goals, emptyView, 40), false);
  // No retirement_age goal at all: falls through to the readiness gate, which fails too.
  assert.equal(retirementReady(belowThreshold, [], emptyView, 65), false);
});
