import { test } from "node:test";
import assert from "node:assert/strict";
import { isMet, progressOf } from "../src/sim/skip/goals.ts";
import type { GoalView } from "../src/sim/skip/types.ts";

const baseView: GoalView = {
  cash: 0,
  emergency: 0,
  brokerage: 0,
  retirement: 0,
  debt: 0,
  minimums: 0,
  monthlyExpenses: 2000,
  monthlyGross: 6000,
  homePrice: 400000,
  relationship: "single",
  grossAnnual: 72000,
};

test("retirement_age goal is met once currentAge reaches targetAge", () => {
  const goal = { kind: "retirement_age" as const, targetAge: 60 };
  assert.equal(isMet(goal, baseView, 59), false);
  assert.equal(isMet(goal, baseView, 60), true);
  assert.equal(isMet(goal, baseView, 61), true);
});

test("retirement_age progress increases from 18 to targetAge", () => {
  const goal = { kind: "retirement_age" as const, targetAge: 60 };
  // At age 18 (start of career): progress should be 0
  assert.equal(progressOf(goal, baseView, 18), 0);
  // At age 39 (midway between 18 and 60): progress should be ~0.5
  const progress39 = progressOf(goal, baseView, 39);
  assert(progress39 > 0.45 && progress39 < 0.55, `progress at 39 should be ~0.5, got ${progress39}`);
  // At age 60 or beyond: progress should be 1
  assert.equal(progressOf(goal, baseView, 60), 1);
  assert.equal(progressOf(goal, baseView, 70), 1);
});

test("debt_free_by_age is met when debt is paid off", () => {
  const goal = { kind: "debt_free_by_age" as const, targetAge: 40 };
  const viewNoDebt = { ...baseView, debt: 0 };
  const viewWithDebt = { ...baseView, debt: 5000 };
  assert.equal(isMet(goal, viewNoDebt, 30), true);
  assert.equal(isMet(goal, viewWithDebt, 30), false);
});

test("debt_free_by_age progress returns 1 when debt is paid off", () => {
  const goal = { kind: "debt_free_by_age" as const, targetAge: 40 };
  const viewNoDebt = { ...baseView, debt: 0 };
  assert.equal(progressOf(goal, viewNoDebt, 30), 1);
});

test("debt_free_by_age progress returns 0 when debt remains", () => {
  const goal = { kind: "debt_free_by_age" as const, targetAge: 40 };
  const viewWithDebt = { ...baseView, debt: 5000 };
  assert.equal(progressOf(goal, viewWithDebt, 30), 0);
});

test("progressOf with currentAge <= 0 returns binary result", () => {
  const retirementGoal = { kind: "retirement_age" as const, targetAge: 60 };
  // With no age provided (default 0), should return 0 or 1 based on whether goal is met
  assert.equal(progressOf(retirementGoal, baseView), 0);

  const metGoal = { kind: "retirement_age" as const, targetAge: 0 };
  assert.equal(progressOf(metGoal, baseView, 0), 1);
});

test("progressOf for other goal kinds returns 0", () => {
  const debtFreeGoal = { kind: "debt_free" as const };
  // Other goal kinds should return 0
  assert.equal(progressOf(debtFreeGoal, baseView), 0);
});
