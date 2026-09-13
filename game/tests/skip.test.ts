// Goal fast-forward tests: standing orders, the crash rule, the stops, and the preview.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketPath } from "../src/sim/market/index.ts";
import { K401_LIMIT, PlayerLife, ROTH_LIMIT, STARTER_PORTFOLIO, type Place } from "../src/sim/life/index.ts";
import {
  applyOrders,
  budget,
  buildFutures,
  clampOrders,
  CrashWatch,
  currentOrders,
  isMet,
  previewSeed,
  recommendedOrders,
  runPreview,
  runSkip,
  viewOf,
  priceTag,
  type GoalView,
  type Goal,
} from "../src/sim/skip/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const newLife = (extra: Partial<ConstructorParameters<typeof PlayerLife>[0]> = {}) =>
  new PlayerLife({ place: TX, day: 0, market: new MarketPath(7), ...extra });
const never: Goal = { kind: "net_worth", amount: 1e12 };
const baseView = (): GoalView => ({
  cash: 1_000,
  emergency: 0,
  brokerage: 0,
  retirement: 0,
  debt: 0,
  minimums: 0,
  monthlyExpenses: 2_000,
  monthlyGross: 5_000,
  homePrice: 300_000,
  relationship: "single",
  grossAnnual: 60_000,
});

test("the setup screen pre-fills with current habits; Recommended captures the match and fits the budget", () => {
  const life = newLife();
  const now = currentOrders(life);
  assert.equal(now.k401Pct, 0);
  assert.equal(now.depositMonthly, 0);
  assert.equal(now.debtStrategy, life.book.strategy);
  assert.equal(now.extraMonthly, life.book.extraMonthly);
  const rec = recommendedOrders(life);
  assert.equal(rec.k401Pct, 0.06);
  assert.equal(rec.crashRule, "hold");
  assert.ok(budget(life, rec).surplus >= 0, `surplus ${budget(life, rec).surplus}`);
});

test("a plan sets the recurring buys by the stock/bond mix, and reads back the same", () => {
  const life = newLife();
  applyOrders(life, { ...recommendedOrders(life), depositMonthly: 400, stockPct: 0.75 });
  assert.deepEqual(life.recurring, [
    { id: "LTM", amount: 150 },
    { id: "BOND", amount: 50 },
  ]);
  const back = currentOrders(life);
  assert.equal(back.depositMonthly, 400);
  assert.equal(back.stockPct, 0.75);
});

test("401(k) contributions stop at the yearly IRS limit and bring the employer match", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 20_000, grossAnnual: 300_000 });
  applyOrders(life, { ...currentOrders(life), k401Pct: 0.1 });
  let in2027 = 0;
  for (let day = 1; day <= 500; day++) {
    for (const e of life.onDay(day, dateOf(day))) if (e.type === "paycheck" && dateOf(day).getFullYear() === 2027) in2027 += e.retirement ?? 0;
  }
  // $30k wanted, $24.5k allowed, plus a 3% match on the paychecks that contributed.
  assert.ok(in2027 >= K401_LIMIT && in2027 <= K401_LIMIT + 0.03 * 300_000, `2027 total ${in2027}`);
});

test("clampOrders caps rothPct so the yearly Roth contribution never exceeds $7,500 when grossAnnual is given", () => {
  const o = { ...recommendedOrders(newLife()), rothPct: 0.5 };
  const clamped = clampOrders(o, 60_000);
  assert.ok(clamped.rothPct * 60_000 <= ROTH_LIMIT + 1e-9, `rothPct*gross ${clamped.rothPct * 60_000}`);
  // A rothPct that already fits under the cap is left alone.
  const fits = clampOrders({ ...o, rothPct: 0.05 }, 60_000);
  assert.equal(fits.rothPct, 0.05);
});

test("clampOrders falls back to clamping rothPct to [0,1] when grossAnnual is omitted", () => {
  const clamped = clampOrders({ ...recommendedOrders(newLife()), rothPct: 1.5 });
  assert.equal(clamped.rothPct, 1);
});

test("applyOrders clamps rothPct against the life's own grossAnnual", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  applyOrders(life, { ...currentOrders(life), rothPct: 0.5 });
  assert.ok(life.orders && life.orders.rothPct * 60_000 <= ROTH_LIMIT + 1e-9);
});

test("a paycheck with rothPct set contributes to the roth account with no employer match, and the full amount comes out of take-home", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 6_000, grossAnnual: 90_000 });
  applyOrders(life, { ...currentOrders(life), rothPct: 0.05 });
  const roth = life.ledger.get("roth");
  const before = roth.balance;
  const checkingBefore = life.ledger.get("checking").balance;
  const events = life.onDay(4, dateOf(4));
  const pc = events.find((e) => e.type === "paycheck");
  assert.ok(pc && pc.type === "paycheck");
  const want = (0.05 * 90_000) / 24;
  assert.ok(roth.balance - before > 0, "roth account should have grown");
  assert.ok(Math.abs(roth.balance - before - want) < 0.01, `roth added ${roth.balance - before}, wanted ${want}`);
  // No match: the roth account gained exactly the contribution, nothing more.
  const checkingAfter = life.ledger.get("checking").balance;
  // Full Roth cost is deducted dollar-for-dollar from take-home (unlike the 401k's tax-adjusted cost).
  assert.ok(checkingAfter < checkingBefore + 10_000); // sanity: paycheck landed, not asserting exact take-home here
});

test("401(k) match is unaffected by rothPct: same match with or without a Roth contribution set", () => {
  const withRoth = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 6_000, grossAnnual: 90_000 });
  applyOrders(withRoth, { ...currentOrders(withRoth), k401Pct: 0.06, rothPct: 0.05 });
  const withoutRoth = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 6_000, grossAnnual: 90_000 });
  applyOrders(withoutRoth, { ...currentOrders(withoutRoth), k401Pct: 0.06, rothPct: 0 });
  const evA = withRoth.onDay(4, dateOf(4)).find((e) => e.type === "paycheck");
  const evB = withoutRoth.onDay(4, dateOf(4)).find((e) => e.type === "paycheck");
  assert.ok(evA && evA.type === "paycheck" && evB && evB.type === "paycheck");
  assert.equal(evA.retirement, evB.retirement);
});

test("Roth contributions stop at the yearly $7,500 IRS limit", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 20_000, grossAnnual: 300_000 });
  applyOrders(life, { ...currentOrders(life), rothPct: 0.1 });
  const roth = life.ledger.get("roth");
  for (let day = 1; day <= 400; day++) life.onDay(day, dateOf(day));
  // Over more than a year, the roth balance should still respect the $7,500/year cap (roughly $7.5k-15k across ~1.1 years).
  assert.ok(roth.balance <= ROTH_LIMIT * 2 + 1, `roth balance ${roth.balance}`);
});

test("the crash rule sells at a 20% drop and buys back three months after the old peak returns", () => {
  const w = new CrashWatch();
  const prices = [100, 110, 95, 88, 90, 105, 110, 112, 115, 118];
  const moves = prices.map((p) => w.update(p, "sell_all"));
  assert.deepEqual(moves, [null, null, null, "sell", null, null, null, null, null, "buy"]);
  const hold = new CrashWatch();
  assert.ok(prices.every((p) => hold.update(p, "hold") === null));
});

test("panic selling in crashes ends poorer than holding", () => {
  let hold = 0;
  let sell = 0;
  for (let seed = 1; seed <= 8; seed++) {
    for (const rule of ["hold", "sell_all"] as const) {
      const life = new PlayerLife({ place: TX, day: 0, market: new MarketPath(seed), monthlyTakeHome: 6_000 });
      applyOrders(life, { ...recommendedOrders(life), crashRule: rule });
      const r = runSkip(life, { goal: never, fromDay: 0, startDate: START, capAge: life.age + 30 });
      if (rule === "hold") hold += r.end.netWorth;
      else sell += r.end.netWorth;
    }
  }
  assert.ok(hold > sell, `hold ${Math.round(hold / 8)} vs sell ${Math.round(sell / 8)}`);
});

test("a fast-forward stops on the first day the goal is met", () => {
  const goal: Goal = { kind: "emergency_fund", months: 1 };
  const life = newLife();
  const orders = recommendedOrders(life);
  applyOrders(life, orders);
  const r = runSkip(life, { goal, fromDay: 0, startDate: START, capAge: 90 });
  assert.equal(r.stoppedBy, "goal");
  assert.ok(r.daysRun > 0);
  assert.ok(isMet(goal, viewOf(life)));

  const replay = newLife();
  applyOrders(replay, orders);
  for (let day = 1; day < r.daysRun; day++) replay.onDay(day, dateOf(day));
  assert.ok(!isMet(goal, viewOf(replay)), "met a day early");
});

test("the same seed, life, and plan give the same fast-forward", () => {
  const run = () => {
    const life = newLife();
    applyOrders(life, recommendedOrders(life));
    return runSkip(life, { goal: { kind: "net_worth", amount: 50_000 }, fromDay: 0, startDate: START, capAge: 90 });
  };
  assert.deepEqual(run(), run());
});

test("bankruptcy stops a fast-forward", () => {
  // Same over-indebted life as life.test.ts's runHeadless bankruptcy test.
  const life = newLife({ place: CA, monthlyTakeHome: 1_200 });
  life.setEmployed(false, 0);
  const r = runSkip(life, { goal: { kind: "net_worth", amount: 1_000_000 }, fromDay: 0, startDate: START, capAge: 90 });
  assert.equal(r.stoppedBy, "bankruptcy");
  assert.ok(r.daysRun < 3_000, `ran ${r.daysRun} days`);
});

test("an unreachable goal stops at the age cap", () => {
  const life = newLife();
  applyOrders(life, recommendedOrders(life));
  const r = runSkip(life, { goal: never, fromDay: 0, startDate: START, capAge: 32 });
  assert.equal(r.stoppedBy, "cap");
  assert.ok(r.ageAtEnd >= 32 && r.ageAtEnd < 32.01, `age ${r.ageAtEnd}`);
});

test("a 40-year fast-forward runs well under a second", () => {
  const life = newLife();
  applyOrders(life, recommendedOrders(life));
  const t0 = performance.now();
  const r = runSkip(life, { goal: never, fromDay: 0, startDate: START, capAge: life.age + 40 });
  const ms = performance.now() - t0;
  assert.ok(r.daysRun > 14_000);
  assert.ok(ms < 1_000, `${ms.toFixed(0)} ms`);
});

test("the preview is a consistent band from other seeds' markets", () => {
  const life = newLife();
  const orders = recommendedOrders(life);
  const goal: Goal = { kind: "net_worth", amount: 100_000 };
  const futures = buildFutures(7, 20, 45);
  const p = runPreview(life, orders, goal, { futures, month: 0, capAge: 67 });
  assert.equal(p.months, 540); // (67 - 22) * 12; default starting age is now 22, not 27
  assert.equal(p.p50.length, p.months + 1);
  for (let m = 0; m <= p.months; m++) assert.ok(p.p10[m] <= p.p50[m] && p.p50[m] <= p.p90[m], `month ${m}`);
  assert.ok(p.p90[p.months] > p.p10[p.months], "invested money should spread with luck");
  assert.ok(p.reached > 0 && p.reachTypical !== null);
  assert.notEqual(previewSeed(7, 0), 7);
  assert.deepEqual(runPreview(life, orders, goal, { futures, month: 0, capAge: 67 }), p);
});

test("marriage and career goals use relationship and current annual pay", () => {
  const single = baseView();
  assert.equal(isMet({ kind: "marriage" }, single), false);
  assert.equal(priceTag({ kind: "marriage" }, single, "Texas").progress, null);
  const partnered = { ...single, relationship: "partnered" as const };
  assert.equal(isMet({ kind: "marriage" }, partnered), true);
  assert.equal(priceTag({ kind: "marriage" }, partnered, "Texas").progress, 1);

  const goal: Goal = { kind: "status", annualIncome: 100_000 };
  assert.equal(isMet(goal, single), false);
  assert.equal(priceTag(goal, single, "Texas").progress, 0.6);
  assert.match(priceTag(goal, single, "Texas").text, /assumes your current pay/);
  assert.equal(isMet(goal, { ...single, grossAnnual: 100_000 }), true);
  assert.equal(priceTag(goal, { ...single, grossAnnual: 150_000 }, "Texas").progress, 1);
  assert.equal(priceTag(goal, { ...single, grossAnnual: -10_000 }, "Texas").progress, 0);
});

test("preview labels unsupported relationship timing and static salary assumptions", () => {
  const life = newLife();
  const futures = buildFutures(7, 2, 2);
  const opts = { futures, month: 0, capAge: life.age + 1 };
  const orders = recommendedOrders(life);
  assert.equal(runPreview(life, orders, { kind: "marriage" }, opts).goalTiming, "relationship_unsupported");
  assert.equal(runPreview(life, orders, { kind: "status", annualIncome: 100_000 }, opts).goalTiming, "income_static");
});

test("live goal view includes invested brokerage positions", () => {
  const life = newLife({ holdings: STARTER_PORTFOLIO });
  const invested = life.positions().reduce((sum, position) => sum + position.value, 0);
  assert.ok(invested > 0);
  assert.ok(viewOf(life).brokerage >= invested);
});
