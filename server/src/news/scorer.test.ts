import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligible, score } from "./scorer.js";

test("routine kinds are never eligible", () => {
  assert.equal(isEligible("paycheck", {}), false);
  assert.equal(isEligible("bill", {}), false);
  assert.equal(isEligible("statement", {}), false);
  assert.equal(isEligible("payment", {}), false);
  assert.equal(isEligible("savings_interest", {}), false);
  assert.equal(isEligible("score_change", {}), false);
});

test("a buy trade is routine, but a sell trade is eligible (matches ai/facts.ts's describe())", () => {
  assert.equal(isEligible("trade", { side: "buy", amount: 500 }), false);
  assert.equal(isEligible("trade", { side: "sell", amount: 500 }), true);
});

test("a small missed payment doesn't clear the publish threshold", () => {
  const r = score({ kind: "missed", payload: { due: 20, fee: 5 }, netWorthBaseline: 500_000, priorCount: 3 });
  assert.equal(r, null);
});

test("the same dollar amount scores higher for a poorer player (magnitude is relative)", () => {
  const poor = score({ kind: "missed", payload: { due: 500, fee: 25 }, netWorthBaseline: 2_000, priorCount: 0 })!;
  const rich = score({ kind: "missed", payload: { due: 500, fee: 25 }, netWorthBaseline: 2_000_000, priorCount: 0 })!;
  assert.ok(poor.score > rich.score, `poor ${poor.score} should outscore rich ${rich.score}`);
});

test("bankruptcy_eligible always clears the floor regardless of baseline or history", () => {
  const r = score({ kind: "bankruptcy_eligible", payload: { reason: "180 days delinquent" }, netWorthBaseline: 10_000_000, priorCount: 50 })!;
  assert.ok(r.score >= 100, `expected the floor to hold, got ${r.score}`);
  assert.equal(r.category, "personal");
});

test("rarity decays: the same kind happening again scores lower, all else equal", () => {
  const first = score({ kind: "late_mark", payload: { severity: 30, scoreBefore: 700, scoreAfter: 660 }, netWorthBaseline: 50_000, priorCount: 0 })!;
  const third = score({ kind: "late_mark", payload: { severity: 30, scoreBefore: 700, scoreAfter: 660 }, netWorthBaseline: 50_000, priorCount: 2 })!;
  assert.ok(first !== null && third !== null, "late_mark has no magnitude term, so severity + rarity alone must still clear the threshold at priorCount 0 and 2");
  assert.ok(first.score > third.score, `first ${first.score} should outscore third ${third.score}`);
});

test("prominence tiers follow the score", () => {
  const big = score({ kind: "bankruptcy_eligible", payload: { reason: "x" }, netWorthBaseline: 1000, priorCount: 0 })!;
  assert.equal(big.prominence, "front_page");
  const mid = score({ kind: "job", payload: { employed: false }, netWorthBaseline: 50_000, priorCount: 0 })!;
  assert.ok(mid.prominence === "section" || mid.prominence === "front_page", mid.prominence);
});

test("category comes from a fixed per-kind table", () => {
  assert.equal(score({ kind: "bear_market", payload: { drop: 0.3, stocks: 10_000 }, netWorthBaseline: 40_000, priorCount: 0 })!.category, "world");
  assert.equal(score({ kind: "moved", payload: { from: "TX", to: "CA", rent: 2000, living: 1500 }, netWorthBaseline: 40_000, priorCount: 0 })!.category, "personal");
  assert.equal(score({ kind: "collections", payload: { balance: 3000 }, netWorthBaseline: 40_000, priorCount: 0 })!.category, "financial");
});
