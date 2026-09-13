import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligible, score, assignScores, baselineAt, type ScorableEvent } from "./scorer.js";

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
  const out = assignScores(events, events.map(() => 50_000), new Map());
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
  const out = assignScores(events, events.map(() => 50_000), new Map());
  assert.equal(out.length, 3);
  assert.ok(out[0].score > out[1].score, `1st ${out[0].score} > 2nd ${out[1].score}`);
  assert.ok(out[1].score > out[2].score, `2nd ${out[1].score} > 3rd ${out[2].score}`);
});

test("prior history from earlier requests lowers the first event in a new batch", () => {
  const events: ScorableEvent[] = [{ key: "10:0", day: 10, kind: "job", payload: { employed: false } }];
  const fresh = assignScores(events, events.map(() => 50_000), new Map())[0];
  const seenBefore = assignScores(events, events.map(() => 50_000), new Map([["job", 5]]))[0];
  assert.ok(fresh.score > seenBefore.score, `fresh ${fresh.score} > seenBefore ${seenBefore.score}`);
});

test("assignScores uses each event's own baseline, not the batch's final net worth", () => {
  // A fast-forward batch spanning ~40 years: the player was poor early and rich at the end. The same
  // $500 missed payment happens once near the start and once near the end.
  const events: ScorableEvent[] = [
    { key: "30:0", day: 30, kind: "missed", payload: { due: 500, fee: 25 } },
    { key: "14000:0", day: 14000, kind: "missed", payload: { due: 500, fee: 25 } },
  ];
  const checkpoints = [
    { day: 0, netWorth: 2_000 },
    { day: 14000, netWorth: 2_000_000 },
  ];
  const baselines = events.map((e) => baselineAt(e.day, checkpoints));
  assert.deepEqual(baselines, [2_000, 2_000_000], "each event resolves its own net worth as of its own day");

  // The fix: score each event against its OWN baseline. The bug: score the whole batch against the
  // final ($2M) net worth. Compare the SAME early event under both to isolate the effect. (The late
  // rich event is dropped either way: at $2M a repeated $500 miss decays below the publish threshold,
  // which is exactly why a two-published-events comparison isn't possible for this kind — the signal
  // lives in the early event's magnitude term, which only fires when its own low baseline is used.)
  const perEvent = assignScores(events, baselines, new Map());
  const finalOnly = assignScores(events, events.map(() => 2_000_000), new Map());
  const early = perEvent.find((s) => s.key === "30:0")!;
  const earlyIfRich = finalOnly.find((s) => s.key === "30:0")!;
  assert.ok(early && earlyIfRich, "the early $500 miss publishes either way (severity + rarity clear the bar)");
  assert.ok(
    early.score > earlyIfRich.score,
    `the early miss scored against its own $2k net worth (${early.score}) must outscore the same miss scored against the batch's final $2M (${earlyIfRich.score})`,
  );
});
