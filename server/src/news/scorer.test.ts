import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligible, score, assignScores, type ScorableEvent } from "./scorer.js";

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

test("routine events are dropped, eligible ones keep their key/day", () => {
  const events: ScorableEvent[] = [
    { key: "1:0", day: 1, kind: "paycheck", payload: { takeHome: 2000 } },
    { key: "1:1", day: 1, kind: "paid_off", payload: { debtId: "d1", name: "Car loan" } },
  ];
  const out = assignScores(events, 50_000, new Map());
  assert.equal(out.length, 1);
  assert.equal(out[0].key, "1:1");
  assert.equal(out[0].day, 1);
  assert.equal(out[0].kind, "paid_off");
});

test("three late_marks in one batch decay against each other, not just against prior history", () => {
  const events: ScorableEvent[] = [0, 1, 2].map((i) => ({
    key: `${i}:0`,
    day: i,
    kind: "late_mark",
    payload: { severity: 30, scoreBefore: 700 - i * 10, scoreAfter: 690 - i * 10 },
  }));
  const out = assignScores(events, 50_000, new Map());
  assert.equal(out.length, 3);
  assert.ok(out[0].score > out[1].score, `1st ${out[0].score} > 2nd ${out[1].score}`);
  assert.ok(out[1].score > out[2].score, `2nd ${out[1].score} > 3rd ${out[2].score}`);
});

test("prior history from earlier requests lowers the first event in a new batch", () => {
  const events: ScorableEvent[] = [{ key: "10:0", day: 10, kind: "job", payload: { employed: false } }];
  const fresh = assignScores(events, 50_000, new Map())[0];
  const seenBefore = assignScores(events, 50_000, new Map([["job", 5]]))[0];
  assert.ok(fresh.score > seenBefore.score, `fresh ${fresh.score} > seenBefore ${seenBefore.score}`);
});
