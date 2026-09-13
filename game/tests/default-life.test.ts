// Every new life is the same default start (sim/life/intake.ts, defaultAnswers):
// the title screen only asks who's moving in, and the rest comes from the
// revamp's starting rules and the state.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CREDIT_SCORE_START,
  DEBT_RANGE,
  DEFAULT_GOALS,
  DEFAULT_SAVINGS,
  defaultAnswers,
  HIGH_COST_SALARY_MULTIPLIER,
  lifeFromIntake,
  SALARY_RANGE,
} from "../src/sim/life/intake.ts";
import { medianRent } from "../src/sim/life/homes.ts";
import { STARTER_PORTFOLIO, type Place } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};

test("the only thing a default life takes from the player is who moves in", () => {
  const a = defaultAnswers(TX, "female");
  assert.equal(a.avatar, "female");
  assert.equal(a.salary, undefined);
  assert.equal(a.debt, undefined);
  assert.equal(a.rent, medianRent(TX));
  assert.equal(a.savings, DEFAULT_SAVINGS);
  assert.deepEqual(a.goals, DEFAULT_GOALS);
});

test("a default life starts on the revamp's rules: salary and debt in range, a 600 score, the chosen avatar", () => {
  for (const [place, lift] of [[TX, 1], [CA, HIGH_COST_SALARY_MULTIPLIER]] as const) {
    for (let i = 0; i < 20; i++) {
      const life = lifeFromIntake(defaultAnswers(place, "male"), { place, day: 0, market: new MarketPath() });
      assert.ok(life.grossAnnual >= Math.round(SALARY_RANGE.min * lift) && life.grossAnnual <= Math.round(SALARY_RANGE.max * lift), `${place.abbr} salary ${life.grossAnnual}`);
      assert.equal(life.book.profile.score, CREDIT_SCORE_START);
      assert.equal(life.avatar, "male");
      assert.equal(life.rent, medianRent(place));
    }
  }
  const debts = lifeFromIntake(defaultAnswers(TX, "female"), { place: TX, day: 0, market: new MarketPath() }).book.debts;
  // The randomized starter debt, plus the fixed car loan every fresh life gets.
  const starter = debts.filter((d) => d.kind !== "auto").reduce((s, d) => s + d.balance, 0);
  assert.ok(starter >= DEBT_RANGE.min && starter <= DEBT_RANGE.max, `starter debt ${starter}`);
});

test("a default life pays its way through the first three months without missing anything", () => {
  const life = lifeFromIntake(defaultAnswers(TX, "male"), { place: TX, day: 0, market: new MarketPath(), holdings: STARTER_PORTFOLIO, rng: () => 0 });
  const events = [];
  for (let day = 1; day <= 90; day++) events.push(...life.onDay(day, dateOf(day)));
  const bad = events.filter((e) => /missed|late|collection|bankrupt|evict/i.test(e.type));
  assert.deepEqual(bad, []);
});
