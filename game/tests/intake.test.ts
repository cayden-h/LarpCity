// Onboarding answers: reading what Sammy's tool call, the post-call
// webhook, or the typed form hands over, and the starting life they build.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAR_LOAN_BALANCE,
  CARD_PORTION,
  coerceAnswers,
  completeAnswers,
  CREDIT_SCORE_START,
  DEBT_RANGE,
  debtsFor,
  DEFAULT_INSURANCE_PLAN_ID,
  HIGH_COST_SALARY_MULTIPLIER,
  INSURANCE_PLANS,
  INTAKE_LIMITS,
  lifeFromIntake,
  parseDollars,
  randomizeStarter,
  SALARY_RANGE,
  takeHomeFor,
  type IntakeAnswers,
} from "../src/sim/life/intake.ts";
import {
  EXPENSE_TIER_AMOUNTS,
  MATCH_UP_TO,
  PlayerLife,
  ROTH_LIMIT,
  STARTER_PORTFOLIO,
  type ExpenseCategory,
  type Place,
} from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { BEGINNER_CARD_SLUGS, BEGINNER_CARDS } from "../src/data/cards-beginner.ts";

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
  assert.equal(Math.round(life.totalDebt()), Math.round(20_000 + CAR_LOAN_BALANCE));
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

test("moving replaces the stated rent with the destination studio rent", () => {
  const life = lifeFor();
  life.setPlace(CA, 1);
  assert.equal(life.rent, Math.round((1_487 * 154.346 * 0.6) / 100));
  assert.equal(life.homeTier(), 1);
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

import { DEFAULT_SAVINGS, profileFromIntake, STARTER_JOBS, starterFor } from "../src/sim/life/intake.ts";
import { rngFor } from "../src/engine/rng.ts";

test("intake answers become a profile of the money fields only", () => {
  const a: IntakeAnswers = { job: "Nurse", salary: 72_000, rent: 1_400, debt: 9_000, savings: 3_000, name: "Alex", avatar: "female", goals: GOALS };
  const p = profileFromIntake(a, "voice", "TX");
  assert.deepEqual(p, { job: a.job, salary: a.salary, rent: a.rent, debt: a.debt, savings: a.savings, state: "TX", source: "voice" });
});

test("a skipped intake is a profile with no numbers", () => {
  const p = profileFromIntake(null, "skipped", "CA");
  assert.deepEqual(p, { job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" });
});

test("starterFor generates a new life's money from the seed, the same every time", () => {
  const CA = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 104, housing: 154.9 } };
  const a = starterFor(CA, rngFor("starter", 20260912));
  assert.deepEqual(starterFor(CA, rngFor("starter", 20260912)), a);
  assert.ok((STARTER_JOBS as readonly string[]).includes(a.job));
  assert.equal(a.savings, DEFAULT_SAVINGS);
  assert.equal(a.creditScore, 600);
});

test("randomizeStarter stays within the base range for a normal cost-of-living place", () => {
  const rng = () => 0.5;
  const { salary, debt, creditScore } = randomizeStarter(TX, rng);
  assert.ok(salary >= SALARY_RANGE.min && salary <= SALARY_RANGE.max, `salary ${salary} out of range`);
  assert.ok(debt >= DEBT_RANGE.min && debt <= DEBT_RANGE.max, `debt ${debt} out of range`);
  assert.equal(creditScore, CREDIT_SCORE_START);
});

test("randomizeStarter scales salary up for a high cost-of-living place like California", () => {
  const rng = () => 0.5;
  const { salary } = randomizeStarter(CA, rng);
  assert.ok(salary > SALARY_RANGE.max, `expected CA salary above ${SALARY_RANGE.max}, got ${salary}`);
  assert.ok(salary <= Math.round(SALARY_RANGE.max * HIGH_COST_SALARY_MULTIPLIER));
});

test("randomizeStarter's debt does not depend on cost of living", () => {
  const rng = () => 0.5;
  assert.equal(randomizeStarter(TX, rng).debt, randomizeStarter(CA, rng).debt);
});

test("lifeFromIntake randomizes salary and debt when they're left unstated, scaled to the place", () => {
  const rng = () => 0.5;
  const { job, rent, savings } = NURSE;
  const life = lifeFromIntake({ job, rent, savings }, { place: TX, day: 0, market: new MarketPath(), rng });
  const { salary: expectedSalary, debt: expectedDebt } = randomizeStarter(TX, rng);
  assert.equal(life.grossAnnual, expectedSalary);
  assert.equal(Math.round(life.totalDebt()), Math.round(expectedDebt + CAR_LOAN_BALANCE));
});

test("a stated salary or debt overrides randomization even when the other is missing", () => {
  const rng = () => 0.5;
  const life = lifeFromIntake({ job: "Nurse", rent: 1_500, savings: 5_000, salary: 85_000 }, { place: TX, day: 0, market: new MarketPath(), rng });
  assert.equal(life.grossAnnual, 85_000);
  const { debt: expectedDebt } = randomizeStarter(TX, rng);
  assert.equal(Math.round(life.totalDebt()), Math.round(expectedDebt + CAR_LOAN_BALANCE));
});

test("an explicit typed intake (both salary and debt stated) is never randomized", () => {
  const life = lifeFor();
  assert.equal(life.grossAnnual, 85_000);
  assert.equal(Math.round(life.totalDebt()), Math.round(20_000 + CAR_LOAN_BALANCE));
});

test("a freshly-built life always starts with a 600 credit score", () => {
  assert.equal(lifeFor().book.profile.score, CREDIT_SCORE_START);
  assert.equal(lifeFromIntake(NURSE, { place: CA, day: 0, market: new MarketPath() }).book.profile.score, CREDIT_SCORE_START);
});

test("a freshly-built life defaults to age 22 when the intake states no age", () => {
  assert.equal(lifeFor().age, 22);
});

test("a freshly-built life defaults to the male avatar preset when the intake states no avatar", () => {
  assert.equal(lifeFor().avatar, "male");
});

test("an explicit female avatar choice round-trips through lifeFromIntake onto the life", () => {
  const life = lifeFromIntake({ ...NURSE, avatar: "female" }, { place: TX, day: 0, market: new MarketPath() });
  assert.equal(life.avatar, "female");
});

test("exactly 3 curated cards are flagged as beginner cards via the overlay slug list", () => {
  assert.equal(BEGINNER_CARD_SLUGS.length, 3);
  assert.equal(BEGINNER_CARDS.length, 3);
  assert.deepEqual(
    BEGINNER_CARDS.map((c) => c.slug).sort(),
    [...BEGINNER_CARD_SLUGS].sort(),
  );
});

test("INSURANCE_PLANS has 3 tiers and DEFAULT_INSURANCE_PLAN_ID names the middle one", () => {
  assert.equal(INSURANCE_PLANS.length, 3);
  assert.ok(INSURANCE_PLANS.some((p) => p.id === DEFAULT_INSURANCE_PLAN_ID));
  assert.equal(DEFAULT_INSURANCE_PLAN_ID, INSURANCE_PLANS[1].id);
});

test("a freshly-built life defaults to the middle insurance tier and the first beginner card when the intake states neither", () => {
  const life = lifeFor();
  assert.equal(life.insurancePlanId, DEFAULT_INSURANCE_PLAN_ID);
  assert.equal(life.selectedCardId, BEGINNER_CARD_SLUGS[0]);
});

test("an explicit insurancePlanId and selectedCardId round-trip through lifeFromIntake onto the life", () => {
  const life = lifeFromIntake({ ...NURSE, insurancePlanId: "gold", selectedCardId: BEGINNER_CARD_SLUGS[2] }, { place: TX, day: 0, market: new MarketPath() });
  assert.equal(life.insurancePlanId, "gold");
  assert.equal(life.selectedCardId, BEGINNER_CARD_SLUGS[2]);
});

test("a freshly-built life has no standing orders when the intake states no emergencyMonths, k401Pct, or rothPct", () => {
  assert.equal(lifeFor().orders, null);
});

test("stated emergencyMonths, k401Pct, and rothPct round-trip through lifeFromIntake into the life's standing orders", () => {
  const life = lifeFromIntake({ ...NURSE, emergencyMonths: 6, k401Pct: MATCH_UP_TO, rothPct: 0.02 }, { place: TX, day: 0, market: new MarketPath() });
  assert.ok(life.orders);
  assert.equal(life.orders?.emergencyMonths, 6);
  assert.equal(life.orders?.k401Pct, MATCH_UP_TO);
  assert.equal(life.orders?.rothPct, 0.02);
});

test("lifeFromIntake clamps a stated rothPct so the yearly Roth contribution never exceeds the IRS limit", () => {
  const life = lifeFromIntake({ ...NURSE, rothPct: 0.5 }, { place: TX, day: 0, market: new MarketPath() });
  assert.ok(life.orders);
  assert.ok((life.orders?.rothPct ?? 0) * life.grossAnnual <= ROTH_LIMIT + 1e-9);
});

test("a payroll Roth contribution is tracked as tax-free basis (rothContributions), not just balance", () => {
  const life = lifeFromIntake({ ...NURSE, rothPct: 0.02 }, { place: TX, day: 0, market: new MarketPath() });
  // Sept 11 + a few days is Sept 15: a payday.
  for (let day = 1; day <= 5; day++) life.onDay(day, dateOf(day));
  const roth = life.ledger.get("roth");
  assert.ok(roth.balance > 0, "expected a Roth contribution to have landed");
  assert.equal(roth.rothContributions, roth.balance, "the whole contribution should count as basis, since there's been no market growth yet");
});

test("EXPENSE_TIER_AMOUNTS has high > medium > low for every expense category", () => {
  const categories = Object.keys(EXPENSE_TIER_AMOUNTS) as ExpenseCategory[];
  assert.ok(categories.length === 5);
  for (const cat of categories) {
    const t = EXPENSE_TIER_AMOUNTS[cat];
    assert.ok(t.high > t.medium, `${cat} high should exceed medium`);
    assert.ok(t.medium > t.low, `${cat} medium should exceed low`);
  }
});

test("a fresh lifeFromIntake life defaults all expense tiers to medium and has a medium-tier living cost", () => {
  const life = lifeFor();
  assert.deepEqual(life.expenseTiers, { food: "medium", houseBills: "medium", fitness: "medium", gas: "medium", carMaintenance: "medium" });
  const mediumTotal = (Object.keys(EXPENSE_TIER_AMOUNTS) as ExpenseCategory[]).reduce((s, c) => s + EXPENSE_TIER_AMOUNTS[c].medium, 0);
  assert.equal(life.living, Math.round((mediumTotal * TX.rpp.goods) / 100));
});

test("a sample household or any fresh construction also defaults its expense tiers to medium", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.deepEqual(life.expenseTiers, { food: "medium", houseBills: "medium", fitness: "medium", gas: "medium", carMaintenance: "medium" });
});

test("a save from before expense tiers existed restores with expenseTiers left undefined, keeping the legacy lifestyle-based living calc", () => {
  const market = new MarketPath();
  const life = lifeFromIntake(NURSE, { place: TX, day: 0, market });
  const save = life.toSave();
  delete (save as { expenseTiers?: unknown }).expenseTiers;
  const restored = PlayerLife.fromSave(save, { market });
  assert.equal(restored.expenseTiers, undefined);
  assert.equal(restored.living, restored.baseLiving);
});

test("a fresh lifeFromIntake life has a $500/mo, 72-month auto loan alongside the card and personal loan", () => {
  const life = lifeFor();
  const car = life.book.debts.find((d) => d.kind === "auto");
  assert.ok(car, "expected an auto debt");
  assert.equal(car?.scheduledPayment, 500);
  assert.equal(car?.termMonths, 72);
});

test("a full P1 intake (avatar, insurance, card, standing orders, and expense tiers all at once) lands on the life exactly as answered", () => {
  const fullAnswers: IntakeAnswers = {
    ...NURSE,
    avatar: "female",
    insurancePlanId: "gold",
    selectedCardId: BEGINNER_CARD_SLUGS[2],
    emergencyMonths: 3,
    k401Pct: MATCH_UP_TO,
    rothPct: 0.02,
    expenseTiers: { food: "high", houseBills: "high", fitness: "high", gas: "high", carMaintenance: "high" },
  };
  const life = lifeFromIntake(fullAnswers, { place: TX, day: 0, market: new MarketPath() });

  // Fixed defaults every fresh intake-built life gets, regardless of what was answered.
  assert.equal(life.age, 22);
  assert.equal(life.book.profile.score, CREDIT_SCORE_START);

  // Every field the player actually chose round-trips onto the life.
  assert.equal(life.avatar, "female");
  assert.equal(life.insurancePlanId, "gold");
  assert.equal(life.selectedCardId, BEGINNER_CARD_SLUGS[2]);
  assert.ok(life.orders);
  assert.equal(life.orders?.emergencyMonths, 3);
  assert.equal(life.orders?.k401Pct, MATCH_UP_TO);
  assert.equal(life.orders?.rothPct, 0.02);
  assert.deepEqual(life.expenseTiers, fullAnswers.expenseTiers);

  // The fixed onboarding auto loan is always present, alongside the card/personal-loan split.
  const car = life.book.debts.find((d) => d.kind === "auto");
  assert.ok(car, "expected an auto debt");
  assert.equal(car?.scheduledPayment, 500);
  assert.equal(car?.termMonths, 72);
  assert.equal(Math.round(life.totalDebt()), Math.round(20_000 + CAR_LOAN_BALANCE));

  // All-high expense tiers cost strictly more per month than all-low.
  const lowLife = lifeFromIntake(
    { ...fullAnswers, expenseTiers: { food: "low", houseBills: "low", fitness: "low", gas: "low", carMaintenance: "low" } },
    { place: TX, day: 0, market: new MarketPath() },
  );
  assert.ok(life.living > lowLife.living, `expected high-tier living (${life.living}) to exceed low-tier living (${lowLife.living})`);
  assert.ok(life.monthlyExpenses() > lowLife.monthlyExpenses());
});

test("a fresh lifeFromIntake life bills $200/mo car insurance on the 5th", () => {
  const life = lifeFor({ job: "", salary: 0, rent: 0, debt: 0, savings: 5_000 });
  // Sept 11 + 24 days is Oct 5: car insurance day.
  const events = [];
  for (let day = 1; day <= 24; day++) events.push(...life.onDay(day, dateOf(day)));
  const insurance = events.find((e) => e.type === "bill" && e.name === "Car insurance");
  assert.ok(insurance && insurance.type === "bill");
  assert.equal(insurance.amount, 200);
  assert.equal(insurance.paid, 200);
});
