// Goal fast-forward tests: the seeded market, standing orders, the stops, and the preview.

import { test } from "node:test";
import assert from "node:assert/strict";
import { K401_LIMIT, PlayerLife, type Place } from "../src/sim/life/index.ts";
import {
  AI_BUBBLE_POP_START,
  applyOrders,
  budget,
  createMarket,
  currentOrders,
  isMet,
  monthIndex,
  portfolioReturn,
  previewSeed,
  recommendedOrders,
  runPreview,
  runSkip,
  viewOf,
  type Goal,
} from "../src/sim/skip/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const newLife = (extra: Partial<ConstructorParameters<typeof PlayerLife>[0]> = {}) =>
  new PlayerLife({ place: TX, day: 0, market: createMarket(7, START), ...extra });

test("the market path depends only on its seed", () => {
  const a = createMarket(7, START);
  const b = createMarket(7, START);
  const c = createMarket(8, START);
  assert.deepEqual(Array.from(a.stock), Array.from(b.stock));
  assert.notDeepEqual(Array.from(a.stock.slice(0, 24)), Array.from(c.stock.slice(0, 24)));
});

test("long-run stock returns land near research/03's calibration", () => {
  const annual: number[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    const m = createMarket(seed, START, 40);
    let log = 0;
    for (const r of m.stock) log += Math.log(1 + r);
    annual.push(Math.exp(log / 40) - 1);
  }
  annual.sort((x, y) => x - y);
  const median = annual[50];
  assert.ok(median > 0.06 && median < 0.12, `median annual return ${median}`);
});

test("every run has the AI Bubble Pop on its preset date, and the market falls through it", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const m = createMarket(seed, START);
    const pop = m.episodes.find((e) => e.scripted);
    assert.ok(pop, `seed ${seed}`);
    assert.equal(pop.name, "AI Bubble Pop");
    assert.equal(pop.startMonth, monthIndex(m, AI_BUBBLE_POP_START));
    let v = 1;
    for (let i = pop.startMonth; i < pop.bottomMonth; i++) v *= 1 + m.stock[i];
    assert.ok(v < 0.95, `seed ${seed}: fell only to ${v}`);
  }
});

test("holding through the AI Bubble Pop beats panic selling on average", () => {
  let hold = 0;
  let sold = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const m = createMarket(seed, START);
    const pop = m.episodes.find((e) => e.scripted)!;
    let h = 1;
    let s = 1;
    for (let i = pop.startMonth; i < pop.endMonth + 12; i++) {
      h *= 1 + portfolioReturn(m, i, 1, "hold");
      s *= 1 + portfolioReturn(m, i, 1, "sell_all");
    }
    hold += h;
    sold += s;
  }
  assert.ok(hold > sold * 1.03, `hold ${hold / 40} vs sell ${sold / 40}`);
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
  applyOrders(life, rec);
  assert.deepEqual(currentOrders(life), rec);
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
  const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
  const life = newLife({ place: CA, monthlyTakeHome: 1_200 });
  life.setEmployed(false, 0);
  const r = runSkip(life, { goal: { kind: "net_worth", amount: 1_000_000 }, fromDay: 0, startDate: START, capAge: 90 });
  assert.equal(r.stoppedBy, "bankruptcy");
  assert.ok(r.daysRun < 3_000, `ran ${r.daysRun} days`);
});

test("an unreachable goal stops at the age cap", () => {
  const life = newLife();
  applyOrders(life, recommendedOrders(life));
  const r = runSkip(life, { goal: { kind: "net_worth", amount: 1e12 }, fromDay: 0, startDate: START, capAge: 32 });
  assert.equal(r.stoppedBy, "cap");
  assert.ok(r.ageAtEnd >= 32 && r.ageAtEnd < 32.01, `age ${r.ageAtEnd}`);
});

test("a 40-year fast-forward runs well under a second", () => {
  const life = newLife();
  applyOrders(life, recommendedOrders(life));
  const t0 = performance.now();
  const r = runSkip(life, { goal: { kind: "net_worth", amount: 1e12 }, fromDay: 0, startDate: START, capAge: life.age + 40 });
  const ms = performance.now() - t0;
  assert.ok(r.daysRun > 14_000);
  assert.ok(ms < 1_000, `${ms.toFixed(0)} ms`);
});

test("the preview is a consistent band from other seeds", () => {
  const life = newLife();
  const orders = recommendedOrders(life);
  const goal: Goal = { kind: "net_worth", amount: 100_000 };
  const p = runPreview(life, orders, goal, { seed: 7, startDate: START, capAge: 67 });
  assert.equal(p.p50.length, p.months + 1);
  for (let m = 0; m <= p.months; m++) assert.ok(p.p10[m] <= p.p50[m] && p.p50[m] <= p.p90[m], `month ${m}`);
  assert.ok(p.reached > 0 && p.reachTypical !== null);
  assert.notEqual(previewSeed(7, 0), 7);
  assert.deepEqual(runPreview(life, orders, goal, { seed: 7, startDate: START, capAge: 67 }), p);
});
