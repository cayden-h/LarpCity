// PlayerLife tests: the city-scene wiring of paychecks, bills, the ledger, and the debt engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, STARTER_PORTFOLIO, cashRateOn, seriesOn, US_MEDIAN_RENT, type Place, type LifeEvent } from "../src/sim/life/index.ts";
import { MARKET } from "../src/data/market.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const live = (life: PlayerLife, days: number, from = 0) => {
  const all = [];
  for (let day = from + 1; day <= from + days; day++) all.push(...life.onDay(day, dateOf(day)));
  return all;
};

test("rent and living costs scale with the state's price parity", () => {
  const tx = new PlayerLife({ place: TX, day: 0 });
  const ca = new PlayerLife({ place: CA, day: 0 });
  assert.equal(tx.rent, Math.round((US_MEDIAN_RENT * 88.6) / 100));
  assert.ok(ca.rent > tx.rent * 1.6, `CA ${ca.rent} vs TX ${tx.rent}`);
  assert.ok(ca.living > tx.living);
});

test("paychecks land on the 1st and 15th and rent is paid on the 1st", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const events = live(life, 40);
  const pays = events.filter((e) => e.type === "paycheck");
  const rents = events.filter((e) => e.type === "bill" && e.name === "Rent");
  assert.equal(pays.length, 3); // Sep 15, Oct 1, Oct 15
  assert.equal(rents.length, 1);
  assert.ok(rents.every((e) => e.type === "bill" && e.paid === e.amount));
});

test("debt payments flow through the ledger's waterfall and the book shrinks", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const debt0 = life.totalDebt();
  live(life, 365);
  assert.ok(life.totalDebt() < debt0 - 8_000, `debt ${life.totalDebt()}`);
  assert.equal(life.book.profile.lateMarks.length, 0);
  assert.ok(life.history.length === 366);
});

test("the engine's cash rate comes from the real Fed funds snapshot", () => {
  const last = MARKET.series.DFF.points.at(-1)!;
  assert.equal(cashRateOn(new Date(2030, 0, 1)), last[1] / 100);
  assert.ok(cashRateOn(START) > 0.02 && cashRateOn(START) < 0.08);
  assert.equal(seriesOn("SP500", new Date(1999, 0, 1)), MARKET.series.SP500.points[0][1]);
});

test("a layoff in California leads to missed payments and a lower home tier", () => {
  const life = new PlayerLife({ place: CA, day: 0 });
  life.setEmployed(false, 0);
  const events = live(life, 200);
  assert.ok(events.some((e) => e.type === "missed"));
  assert.ok(life.book.profile.lateMarks.length > 0);
  assert.ok(life.homeTier() <= 1);
});

test("runHeadless stops at bankruptcy (the meeting's rule)", () => {
  const life = new PlayerLife({ place: CA, day: 0, monthlyTakeHome: 1_200 });
  life.setEmployed(false, 0);
  const r = life.runHeadless(0, 3_000, START);
  assert.equal(r.stoppedBy, "bankruptcy");
  assert.ok(r.daysRun < 3_000);
});

test("home tier follows net worth", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.homeTier(), 1); // about -$40k net worth: studio
  life.ledger.get("savings").balance = 200_000;
  assert.equal(life.homeTier(), 3); // about $160k: townhouse
});

test("a starter portfolio moves net worth with the market and gives charts a past", () => {
  const plain = new PlayerLife({ place: TX, day: 0 });
  const life = new PlayerLife({ place: TX, day: 0, holdings: STARTER_PORTFOLIO });
  const total = Object.values(STARTER_PORTFOLIO).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(life.investments() - total) < 0.02, `investments ${life.investments()}`);
  assert.ok(Math.abs(life.netWorth() - (plain.netWorth() + total)) < 0.02);
  // Bought a year ago at that day's real price, so the positions carry a gain or loss.
  assert.ok(life.positions().every((p) => p.cost > 0 && p.cost !== p.value));

  const past = life.pastSnapshots(-30);
  assert.deepEqual([past[0].day, past.at(-1)!.day, past.length], [-30, -1, 30]);
  // The past follows the real market: holdings move while cash and debt hold still.
  assert.ok(new Set(past.map((p) => p.investments)).size > 5);
  assert.ok(past.every((p) => p.cash === life.history[0].cash && p.debt === life.history[0].debt));
  assert.ok(plain.pastSnapshots(-30).every((p) => p.netWorth === plain.netWorth()));
  // The past is separate from the days lived.
  assert.equal(life.history.length, 1);
});

test("the life is deterministic", () => {
  const a = new PlayerLife({ place: TX, day: 0 });
  const b = new PlayerLife({ place: TX, day: 0 });
  assert.deepEqual(live(a, 300), live(b, 300));
  assert.deepEqual(a.history, b.history);
});

test("spend() withdraws through the wallet waterfall and emits a spend event", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  const checking = life.ledger.get("checking");
  checking.balance = 50;
  const events: LifeEvent[] = [];
  life.onEvents((e) => events.push(...e));

  const event = life.spend(10, "Dining out", 30);

  assert.equal(event.type, "spend");
  assert.equal(event.category, "Dining out");
  assert.equal(event.amount, 30, "fully covered by checking");
  assert.equal(life.ledger.get("checking").balance, 20);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], event);
});

test("spend() never pays more than the wallet has", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  life.ledger.get("checking").balance = 5;
  life.ledger.get("savings").balance = 0;
  const event = life.spend(10, "Shopping", 40);
  assert.equal(event.amount, 5, "capped at what the accounts actually held");
});
