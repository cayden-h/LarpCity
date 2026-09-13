// Life events (sim/life/events.ts): seeded rolls, the choices they leave, and
// the year-1 tax tutorial (sim/tax/tutorial.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, type LifeEvent, type Place } from "../src/sim/life/index.ts";
import {
  CHOICE_DAYS,
  HEALTH_DEDUCTIBLE,
  HEALTH_OOP_MAX,
  NEW_CAR,
  RECESSION_BEAR_DAYS,
  TRADE_IN,
  carBreakdownRateFor,
  outOfPocket,
  paymentFor,
  pennyStock,
  principalFor,
  rollEvents,
  type EventView,
} from "../src/sim/life/events.ts";
import { bottomLine, isCorrect, tutorialOptions } from "../src/sim/tax/tutorial.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const NEW_TYPES = new Set(["car_breakdown", "injury", "divorce", "penny_stock_tip", "penny_stock_result", "recession", "recession_over", "choice"]);

/** Plays days from `from` until an event matches, returning the day and the event (or null past `maxDays`). */
function runUntil(life: PlayerLife, match: (e: LifeEvent) => boolean, maxDays: number, from = life.today): { day: number; event: LifeEvent } | null {
  for (let day = from + 1; day <= from + maxDays; day++) {
    const hit = life.onDay(day, dateOf(day)).find(match);
    if (hit) return { day, event: hit };
  }
  return null;
}

const view = (o: Partial<EventView> = {}): EventView => ({ married: false, hasCar: true, carAgeDays: 0, employed: true, inRecession: false, ...o });

test("a car's daily breakdown chance climbs as it ages", () => {
  assert.ok(carBreakdownRateFor(365 * 8) > carBreakdownRateFor(365 * 2));
  assert.ok(carBreakdownRateFor(365 * 2) > carBreakdownRateFor(0));
});

test("rolls are seeded: the same seed and day always give the same events", () => {
  for (let day = 0; day < 2_000; day++) assert.deepEqual(rollEvents(7, day, view()), rollEvents(7, day, view()));
});

test("no divorce while single, no breakdown without a car, no recession layoff outside a recession", () => {
  for (let day = 0; day < 40_000; day++) {
    const kinds = rollEvents(11, day, view({ hasCar: false }));
    assert.ok(!kinds.includes("divorce") && !kinds.includes("car_breakdown") && !kinds.includes("recession_layoff"), `day ${day}: ${kinds}`);
  }
});

test("injuries land near their yearly rate over a long run", () => {
  let injuries = 0;
  for (let day = 0; day < 365 * 300; day++) if (rollEvents(3, day, view()).includes("injury")) injuries++;
  // 0.1 a year over 300 years is about 30.
  assert.ok(injuries > 12 && injuries < 55, `${injuries} injuries`);
});

test("insurance pays after the deductible, up to the out-of-pocket maximum; uninsured pays it all", () => {
  assert.equal(outOfPocket(10_000, true), HEALTH_DEDUCTIBLE + 0.2 * (10_000 - HEALTH_DEDUCTIBLE));
  assert.equal(outOfPocket(1_000, true), 1_000);
  assert.equal(outOfPocket(60_000, true), HEALTH_OOP_MAX);
  assert.equal(outOfPocket(10_000, false), 10_000);
});

test("the replacement car is the meeting's $500 a month for 72 months", () => {
  const balance = principalFor(NEW_CAR.monthly, NEW_CAR.months, NEW_CAR.apr);
  assert.ok(balance > 29_000 && balance < 30_500, `${balance}`);
  assert.ok(Math.abs(paymentFor(balance, NEW_CAR.months, NEW_CAR.apr) - NEW_CAR.monthly) < 0.02);
  assert.equal(paymentFor(1_200, 12, 0), 100);
});

test("a penny stock's outcome is fixed the day it's offered", () => {
  assert.deepEqual(pennyStock(5, 400), pennyStock(5, 400));
  let busts = 0;
  for (let day = 0; day < 2_000; day++) if (pennyStock(9, day).multiple < 0.5) busts++;
  assert.ok(busts > 1_200 && busts < 1_600, `${busts} busts of 2000`);
});

test("a life replays its events exactly", () => {
  const a = new PlayerLife({ place: TX, day: 0 });
  const b = new PlayerLife({ place: TX, day: 0 });
  for (let day = 1; day <= 2_500; day++) {
    a.onDay(day, dateOf(day));
    b.onDay(day, dateOf(day));
  }
  assert.deepEqual(a.log, b.log);
  assert.equal(a.netWorth(), b.netWorth());
});

test("with life events off, none of them happen", () => {
  const life = new PlayerLife({ place: TX, day: 0, lifeEvents: false });
  assert.equal(runUntil(life, (e) => NEW_TYPES.has(e.type), 3_000), null);
});

test("a breakdown waits for a choice and pauses the city; repair pays the shop", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const hit = runUntil(life, (e) => e.type === "car_breakdown", 365 * 20);
  assert.ok(hit, "the sample household's car breaks down within 20 years");
  assert.ok(life.needsDecision([hit.event]));
  const cost = (hit.event as Extract<LifeEvent, { type: "car_breakdown" }>).repairCost;
  assert.deepEqual(life.pendingChoices().map((c) => c.kind), ["car_breakdown"]);
  const before = life.cash();
  const debtBefore = life.totalDebt();
  const e = life.choose("car_breakdown", "repair", hit.day);
  assert.equal(e?.type, "choice");
  // Paid in cash, or the part cash couldn't cover became shop financing.
  assert.ok(Math.abs(before - life.cash() + (life.totalDebt() - debtBefore) - cost) < 1);
  assert.equal(life.pendingChoices().length, 0);
});

test("replacing the car takes a new $500 loan and credits the trade-in", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const hit = runUntil(life, (e) => e.type === "car_breakdown", 365 * 20)!;
  const checking = life.ledger.get("checking").balance;
  life.choose("car_breakdown", "replace", hit.day);
  const loan = life.book.debts.find((d) => d.id === `car-${hit.day}`);
  assert.equal(loan?.kind, "auto");
  assert.equal(loan?.scheduledPayment, NEW_CAR.monthly);
  assert.equal(life.ledger.get("checking").balance, Math.round((checking + TRADE_IN) * 100) / 100);
});

test("a choice left unanswered takes its default after a week", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const hit = runUntil(life, (e) => e.type === "car_breakdown", 365 * 20)!;
  const auto = runUntil(life, (e) => e.type === "choice", CHOICE_DAYS + 1);
  assert.ok(auto);
  assert.equal(auto.day, hit.day + CHOICE_DAYS);
  assert.deepEqual(auto.event, { ...auto.event, kind: "car_breakdown", option: "repair", auto: true });
});

test("a wedding asks about a prenup; without one, divorce takes half of everything", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.marry(0);
  assert.ok(life.needsDecision([{ type: "marriage", day: 0 }]));
  assert.deepEqual(life.pendingChoices().map((c) => c.kind), ["prenup"]);
  life.choose("prenup", "skip", 0);
  const cash = life.cash();
  const e = life.divorce(1) as Extract<LifeEvent, { type: "divorce" }>;
  assert.equal(e.prenup, false);
  assert.ok(Math.abs(life.cash() - cash / 2) < 0.05, `${life.cash()} vs ${cash / 2}`);
  assert.ok(e.lost > cash / 2 - 0.05);
  assert.equal(life.relationship, "single");
});

test("with a signed prenup, divorce keeps the money", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.marry(0);
  life.choose("prenup", "sign", 0);
  const worth = life.netWorth();
  const e = life.divorce(1) as Extract<LifeEvent, { type: "divorce" }>;
  assert.equal(e.prenup, true);
  assert.equal(e.lost, 0);
  assert.equal(life.netWorth(), worth);
});

test("an injury bills what insurance leaves, and a crash raises car insurance", () => {
  const life = new PlayerLife({ place: TX, day: 0, carInsuranceMonthly: 200 });
  const hit = runUntil(life, (e) => e.type === "injury", 365 * 30);
  assert.ok(hit);
  const inj = hit.event as Extract<LifeEvent, { type: "injury" }>;
  assert.equal(inj.outOfPocket, outOfPocket(inj.bill, inj.insured));
  assert.ok(life.needsDecision([inj]));
  assert.equal(life.carInsurance(hit.day), inj.cause === "car_crash" ? 250 : 200);
  life.choose("injury", "payment_plan", hit.day);
  const plan = life.book.debts.find((d) => d.name === "Hospital payment plan");
  assert.ok(plan && Math.abs(plan.balance - inj.outOfPocket) < 0.01);
});

test("a recession is only ever called after a long bear market", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  for (let day = 1; day <= 365 * 12; day++) {
    for (const e of life.onDay(day, dateOf(day))) {
      if (e.type !== "recession") continue;
      for (let d = day - RECESSION_BEAR_DAYS; d <= day; d++) assert.equal(life.market.regime(d), "bear", `day ${d} before the recession on ${day}`);
    }
  }
});

test("tax tutorial: the bottom line is among the answers, and only it is correct", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  runUntil(life, (e) => e.type === "tax_ready", 400);
  const ret = life.pendingTaxReturn()!;
  const options = tutorialOptions(ret);
  assert.equal(options.length, 3);
  assert.equal(options.filter((o) => isCorrect(ret, o.amount)).length, 1);
  assert.ok(options.some((o) => o.amount === bottomLine(ret)));
});

test("tax tutorial passed in year 1: next year's return files itself on tax day", () => {
  const life = new PlayerLife({ place: TX, day: 0, lifeEvents: false });
  const ready = runUntil(life, (e) => e.type === "tax_ready", 400)!;
  assert.ok(life.pendingTaxReturn(), "the first return waits for the player");
  life.fileTaxes(ready.day, false, bottomLine(life.pendingTaxReturn()!));
  assert.deepEqual(life.taxTutorial, { done: true, passed: true });
  const next = runUntil(life, (e) => e.type === "tax_filed", 400)!;
  assert.equal((next.event as Extract<LifeEvent, { type: "tax_filed" }>).auto, true);
  assert.equal(life.pendingTaxReturn(), null);
  assert.ok(next.day > ready.day + 300);
});

test("tax tutorial missed: next year's return asks again", () => {
  const life = new PlayerLife({ place: TX, day: 0, lifeEvents: false });
  const ready = runUntil(life, (e) => e.type === "tax_ready", 400)!;
  const ret = life.pendingTaxReturn()!;
  const wrong = tutorialOptions(ret).find((o) => !isCorrect(ret, o.amount))!;
  life.fileTaxes(ready.day, false, wrong.amount);
  assert.deepEqual(life.taxTutorial, { done: true, passed: false });
  runUntil(life, (e) => e.type === "tax_ready", 400);
  assert.ok(life.pendingTaxReturn(), "the second return waits for the player too");
});

test("events and the tutorial survive a save", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.marry(0);
  const back = PlayerLife.fromSave(life.toSave(), { market: life.market });
  assert.deepEqual(back.pendingChoices(), life.pendingChoices());
  assert.deepEqual(back.taxTutorial, life.taxTutorial);
});
