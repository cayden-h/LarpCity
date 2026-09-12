// server/src/ai/facts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventRow, SnapshotRow } from "../store/runs.js";
import { crashAndRecovery, describe, feedbackFacts, gameDate, newsFacts, recoveryFacts, templateFeedback, templateNews } from "./facts.js";

const snap = (day: number, o: Partial<SnapshotRow> = {}): SnapshotRow => ({ day, netWorth: 1000 + day, checking: 500, savings: 500, brokerage: 100 + day, retirement: 0, debt: 400, ...o });
const ev = (day: number, kind: string, payload: Record<string, unknown> = {}, n = 0): EventRow => ({ key: `${day}:${n}`, day, kind, payload: { type: kind, day, ...payload } });

test("game days map to the game's calendar", () => {
  assert.equal(gameDate(0), "2026-09-11");
  assert.equal(gameDate(21), "2026-10-02");
  assert.equal(gameDate(366), "2027-09-12");
});

test("feedback facts come from the snapshots and events, and only compare 90 days when that window exists", () => {
  const snaps = Array.from({ length: 200 }, (_, d) => snap(d));
  const events = [ev(150, "missed", { due: 95, fee: 32 }), ev(160, "paid_off", { name: "Store card" }), ev(170, "trade", { side: "sell", amount: 500, id: "LTM" }), ev(171, "trade", { side: "buy" })];
  const f = feedbackFacts("swing", 199, snaps, events);
  assert.equal(f.date, gameDate(199));
  assert.equal(f.netWorth, 1199);
  assert.equal(feedbackFacts("goal", 10, [snap(10, { netWorth: 36475.26, debt: 999.5 })], []).netWorth, 36475, "whole dollars");
  assert.equal(f.cash, 1000);
  assert.equal(f.investments, 299);
  assert.equal(f.investmentsChange90d, 90);
  assert.deepEqual(f.recent, { missedPayments: 1, lateMarks: 0, cannotCover: 0, sales: 1, paidOff: ["Store card"] });
  assert.equal(feedbackFacts("goal", 30, snaps, []).netWorthChange90d, null, "a run only 30 days old has no 90-day change");
  assert.throws(() => feedbackFacts("goal", 5, [], []));
});

test("routine events make no headline; the rest read as plain sentences", () => {
  assert.equal(describe(ev(1, "paycheck", { takeHome: 1825 })), null);
  assert.equal(describe(ev(1, "trade", { side: "buy", amount: 10 })), null);
  assert.equal(describe(ev(1, "missed", { due: 95.2, fee: 32 })), "Missed a $95 payment and paid a $32 late fee");
  assert.equal(describe(ev(1, "late_mark", { severity: 30, scoreBefore: 700, scoreAfter: 640 })), "A 30-day late mark went on the credit report; the score went from 700 to 640");
  assert.equal(describe(ev(1, "job", { employed: false })), "Lost their job");
  assert.equal(describe(ev(1, "moved", { from: "TX", to: "CA", rent: 2295 })), "Moved from TX to CA, where rent is $2,295 a month");
});

test("news facts summarize the range and keep at most 12 headlines, rare ones first", () => {
  const snaps = Array.from({ length: 100 }, (_, d) => snap(d, { netWorth: d === 40 ? -50 : 1000 + d, debt: 400 - d }));
  const events = [
    ...Array.from({ length: 20 }, (_, i) => ev(10 + i, "missed", { due: 50, fee: 32 })),
    ev(50, "paid_off", { name: "Car loan" }),
    ev(60, "job", { employed: false }),
    ev(70, "paycheck"),
    ev(200, "paid_off", { name: "out of range" }),
  ];
  const f = newsFacts(0, 99, snaps, events);
  assert.equal(f.days, 100);
  assert.deepEqual(f.low, { date: gameDate(40), netWorth: -50 });
  assert.equal(f.notableCounts.missed, 20);
  assert.equal(f.notableCounts.paycheck, undefined, "routine activity isn't a notable count");
  assert.deepEqual(f.routine, { paychecks: 1, bills: 0, debtPayments: 0 });
  assert.equal(f.headlines.length, 12);
  assert.ok(f.headlines.some((h) => h.kind === "paid_off") && f.headlines.some((h) => h.kind === "job"), "the rare stories survive the cut");
  assert.ok(!f.headlines.some((h) => h.text.includes("out of range")));
  assert.deepEqual(f.headlines.map((h) => h.date), [...f.headlines.map((h) => h.date)].sort());
});

test("the fallbacks always say something true for every trigger and for a quiet stretch", () => {
  const snaps = Array.from({ length: 120 }, (_, d) => snap(d));
  for (const t of ["goal", "bankruptcy", "swing", "recovery"] as const) {
    const fb = templateFeedback(feedbackFacts(t, 119, snaps, [ev(100, "missed", { due: 1, fee: 1 }), ev(110, "bankruptcy_eligible", { reason: "x" })], "an emergency fund"));
    assert.ok(fb.headline && fb.tip && ["cheer", "warn", "console"].includes(fb.mood), t);
  }
  assert.match(templateFeedback(feedbackFacts("goal", 119, snaps, [], "an emergency fund")).headline, /an emergency fund/);
  assert.match(templateFeedback(feedbackFacts("bankruptcy", 119, snaps, [ev(100, "missed")])).tip, /missed 1 payment in/);
  const quiet = templateNews(newsFacts(0, 10, [], []));
  assert.equal(quiet[0].title, "A quiet stretch");
  const busy = templateNews(newsFacts(0, 119, snaps, [ev(50, "paid_off", { name: "Car loan" })]));
  assert.match(busy[0].title, /^Net worth up \$119$/);
  assert.equal(busy[1].title, "Paid off the Car loan");
});

test("recovery facts compare the player with holding, from the run's own events", () => {
  const events = [
    ev(100, "bear_market", { drop: 0.23, stocks: 900 }),
    ev(120, "trade", { side: "sell", amount: 700, id: "LTM", recurring: false }),
    ev(130, "trade", { side: "buy", amount: 100, id: "LTM", recurring: true }),
    ev(400, "market_recovered", { you: 850, held: 1400, autopilot: 1300 }),
  ];
  const f = feedbackFacts("recovery", 400, [snap(400)], [], undefined, events);
  assert.deepEqual(f.recovery, { dropPct: 23, months: 10, choice: "sold", sold: 700, bought: 0, you: 850, held: 1400, autopilot: 1300, costOfSelling: 550 });
  assert.equal(recoveryFacts(99, events), null, "no recovery yet");
  assert.equal(crashAndRecovery(399, events), null, "not until that day's recovery is stored");
  assert.equal(crashAndRecovery(400, events)?.bear.day, 100);
  assert.deepEqual(templateFeedback(f), {
    headline: "Selling cost you $550",
    tip: "Stocks fell 23% and took 10 months to get back to their high. You have $850; holding would be worth $1,400. Money you won't need for years can ride out a drop.",
    mood: "console",
  });

  const heldRun = [events[0], ev(400, "market_recovered", { you: 1400, held: 1400, autopilot: 1300 })];
  const h = feedbackFacts("recovery", 400, [snap(400)], [], undefined, heldRun);
  assert.equal(h.recovery?.choice, "held");
  assert.equal(templateFeedback(h).headline, "You rode it out");
  assert.equal(templateFeedback(feedbackFacts("recovery", 400, [snap(400)], [])).headline, "Stocks are back at their high", "no crash on record still says something true");
});

test("the recovery fallback follows what the player did", () => {
  const bear = ev(100, "bear_market", { drop: 0.3 });
  const at = (you: number, held: number, trades: EventRow[] = []) => feedbackFacts("recovery", 110, [snap(110)], [], undefined, [bear, ...trades, ev(110, "market_recovered", { you, held, autopilot: held })]);
  const dip = templateFeedback(at(1600, 1600, [ev(105, "trade", { side: "buy", amount: 500, recurring: false })]));
  assert.equal(dip.headline, "Buying the dip paid off");
  assert.match(dip.tip, /less than a month/);
  assert.equal(templateFeedback(at(1500, 1400, [ev(104, "trade", { side: "sell", amount: 900, recurring: false })])).headline, "Selling paid off by $100");
  assert.equal(templateFeedback(at(1400, 1400, [ev(104, "trade", { side: "sell", amount: 900, recurring: false })])).headline, "You came out even with holding");
});
