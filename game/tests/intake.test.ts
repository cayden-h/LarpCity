// Onboarding answers: reading what the narrator's tool call, the post-call
// webhook, or the typed form hands over, and the starting life they build.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_PORTION,
  coerceAnswers,
  completeAnswers,
  debtsFor,
  INTAKE_LIMITS,
  lifeFromIntake,
  parseDollars,
  takeHomeFor,
  type IntakeAnswers,
} from "../src/sim/life/intake.ts";
import { PlayerLife, STARTER_PORTFOLIO, type Place } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const GOALS = [
  { kind: "retirement_age" as const, targetAge: 65 },
  { kind: "marriage" as const },
  { kind: "debt_free_by_age" as const, targetAge: 45 },
  { kind: "house" as const, downPct: 0.1 },
];
const NURSE: IntakeAnswers = { job: "Nurse", salary: 85_000, rent: 1_500, debt: 20_000, savings: 5_000, name: "You", avatar: "male", goals: GOALS };
const lifeFor = (a: IntakeAnswers = NURSE, place: Place = TX) => lifeFromIntake(a, { place, day: 0, market: new MarketPath() });

test("parseDollars reads numbers, plain and formatted strings, and k/m shorthand", () => {
  assert.equal(parseDollars(85_000), 85_000);
  assert.equal(parseDollars("85000"), 85_000);
  assert.equal(parseDollars(" $85,000 "), 85_000);
  assert.equal(parseDollars("85k"), 85_000);
  assert.equal(parseDollars("1.2M"), 1_200_000);
  assert.equal(parseDollars("0"), 0);
});

test("parseDollars rejects blanks, negatives, and nonsense", () => {
  for (const v of ["", "  ", "abc", "-500", "12k5", null, undefined, {}, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseDollars(v), undefined, String(v));
  }
});

test("coerceAnswers keeps valid answers, rounds and caps them, and drops the rest", () => {
  assert.deepEqual(coerceAnswers({ job: "  Night   nurse ", salary: "85k", rent: 1499.6, debt: "", savings: "lots" }), {
    job: "Night nurse",
    salary: 85_000,
    rent: 1_500,
  });
  assert.equal(coerceAnswers({ salary: 99_000_000 }).salary, INTAKE_LIMITS.salary);
  assert.equal(coerceAnswers({ job: "x".repeat(200) }).job?.length, 60);
  assert.deepEqual(coerceAnswers({ job: "   " }), {});
  assert.deepEqual(coerceAnswers("nope"), {});
  assert.deepEqual(coerceAnswers(null), {});
});

test("completeAnswers needs all four amounts but allows zeros and a blank job", () => {
  assert.equal(completeAnswers({ job: "Nurse", salary: 85_000, rent: 1_500, debt: 20_000, goals: GOALS }), null);
  assert.deepEqual(completeAnswers({ salary: 0, rent: 0, debt: 0, savings: 0, goals: GOALS }), {
    job: "",
    salary: 0,
    rent: 0,
    debt: 0,
    savings: 0,
    name: "You",
    avatar: "male",
    goals: GOALS,
  });
});

test("completeAnswers requires goals: one of each required kind, defaulting name and avatar", () => {
  const money = { salary: 60_000, rent: 1_000, debt: 0, savings: 1_000 };
  assert.equal(completeAnswers(money), null, "no goals at all");
  assert.equal(completeAnswers({ ...money, goals: [] }), null, "empty goals");
  assert.equal(
    completeAnswers({ ...money, goals: [{ kind: "retirement_age", targetAge: 65 }, { kind: "marriage" }, { kind: "house", downPct: 0.1 }] }),
    null,
    "missing debt_free_by_age",
  );
  const full = completeAnswers({ ...money, goals: GOALS, name: "  Alex  ", avatar: "female" });
  assert.deepEqual(full, { job: "", ...money, name: "Alex", avatar: "female", goals: GOALS });
});

test("take-home is real per-paycheck withholding, by the month, for the given state", () => {
  assert.equal(takeHomeFor(0, "TX"), 0);
  assert.ok(takeHomeFor(85_000, "TX") > 0);
  assert.ok(takeHomeFor(85_000, "TX") < 85_000 / 12); // withholding is never negative or over 100%
});

test("takeHomeFor is lower in a state with income tax than in one without, same salary", () => {
  const noTax = takeHomeFor(80_000, "TX");
  const withTax = takeHomeFor(80_000, "CA");
  assert.ok(withTax < noTax);
});

test("debt splits into a credit card for the first $5,000 and a personal loan for the rest", () => {
  assert.deepEqual(debtsFor(0, 0), []);
  const small = debtsFor(3_000, 0);
  assert.deepEqual(small.map((d) => [d.kind, d.balance]), [["credit_card", 3_000]]);
  const big = debtsFor(20_000, 0);
  assert.deepEqual(big.map((d) => [d.kind, d.balance]), [["credit_card", CARD_PORTION], ["personal", 15_000]]);
});

test("lifeFromIntake sets pay, job, rent, debt, and savings from the answers", () => {
  const life = lifeFor();
  assert.equal(life.grossAnnual, 85_000);
  assert.equal(life.monthlyTakeHome, 5_719);
  assert.equal(life.book.monthlyTakeHome, 5_719);
  assert.equal(life.job, "Nurse");
  assert.equal(life.rent, 1_500);
  assert.equal(Math.round(life.totalDebt()), 20_000);
  assert.equal(life.ledger.get("savings").balance, 5_000);
  assert.equal(life.ledger.get("checking").balance, 0);
});

test("lifeFromIntake passes starting holdings through, leaving the stated savings alone", () => {
  const life = lifeFromIntake(NURSE, { place: TX, day: 0, market: new MarketPath(), holdings: STARTER_PORTFOLIO });
  const holdings = life.ledger.get("brokerage").holdings ?? {};
  assert.deepEqual(Object.keys(holdings).sort(), Object.keys(STARTER_PORTFOLIO).sort());
  assert.ok(life.investments() > 0);
  assert.equal(life.ledger.get("savings").balance, 5_000);
  assert.equal(Object.keys(lifeFor().ledger.get("brokerage").holdings ?? {}).length, 0);
});

test("a stated rent scales with housing costs after a move", () => {
  const life = lifeFor();
  life.setPlace(CA, 1);
  assert.equal(life.rent, Math.round((1_500 * 154.346) / 88.6));
});

test("the sample household still pays its state's median rent and has no job", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.job, "");
  assert.equal(life.rent, Math.round((1_487 * 88.6) / 100));
});

test("rent is paid from savings while checking is still empty", () => {
  const life = lifeFor({ job: "", salary: 0, rent: 1_200, debt: 0, savings: 5_000 });
  // Sept 11 + 20 days is Oct 1: rent day.
  const events = [];
  for (let day = 1; day <= 20; day++) events.push(...life.onDay(day, dateOf(day)));
  const rent = events.find((e) => e.type === "bill" && e.name === "Rent");
  assert.ok(rent && rent.type === "bill");
  assert.equal(rent.paid, 1_200);
});

import { answersFromProfile, profileFromIntake } from "../src/sim/life/intake.ts";

test("intake answers become a profile, which never carries goals/name/avatar back", () => {
  const a: IntakeAnswers = { job: "Nurse", salary: 72_000, rent: 1_400, debt: 9_000, savings: 3_000, name: "Alex", avatar: "female", goals: GOALS };
  const p = profileFromIntake(a, "voice", "TX");
  assert.deepEqual(p, { job: a.job, salary: a.salary, rent: a.rent, debt: a.debt, savings: a.savings, state: "TX", source: "voice" });
  // The server profile is local money-only state (job/salary/rent/debt/savings); goals/name/avatar
  // never leave the browser, so a profile alone can no longer rebuild a complete IntakeAnswers.
  // Resuming "fromProfile" without a local save falls back to the sample household instead
  // (main.ts's SAMPLE_HOUSEHOLD_GOALS).
  assert.equal(answersFromProfile({ ...p, displayName: null }), null);
});

test("a skipped intake is a profile with no numbers, and no answers", () => {
  const p = profileFromIntake(null, "skipped", "CA");
  assert.deepEqual(p, { job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" });
  assert.equal(answersFromProfile({ ...p, displayName: null }), null);
});
