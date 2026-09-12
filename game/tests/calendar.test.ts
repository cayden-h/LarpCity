// The phone calendar's data: chips for past days, scheduled money for future
// days, and the forecast of the next decision day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { marksFor, scheduleFor, nextDecisionDay } from "../src/sim/calendar/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { PlayerLife, STARTER_PORTFOLIO, type LifeEvent, type Place } from "../src/sim/life/index.ts";
import { serialize } from "../src/sim/rewind/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const newLife = (o: { monthlyTakeHome?: number } = {}) =>
  new PlayerLife({ place: TX, day: 0, market: new MarketPath(7, START), holdings: STARTER_PORTFOLIO, ...o });

test("paydays and bills are red chips with their amounts", () => {
  const life = newLife();
  const events: LifeEvent[] = [
    { type: "paycheck", day: 20, takeHome: 1840, garnished: 0, unemployed: false },
    { type: "bill", day: 20, name: "Rent", amount: 1350, paid: 1350 },
  ];
  const marks = marksFor(events, life);
  assert.deepEqual(
    marks.map((m) => [m.tone, m.chip, m.amount]),
    [
      ["red", "Payday", 1840],
      ["red", "Rent", -1350],
    ],
  );
});

test("a bill the player couldn't cover says so", () => {
  const [m] = marksFor([{ type: "bill", day: 3, name: "Rent", amount: 1350, paid: 1000 }], newLife());
  assert.match(m.text, /short/i);
  assert.equal(m.amount, -1000);
});

test("the player's own trades are blue and come first; recurring buys, interest, and statements are left out", () => {
  const life = newLife();
  const marks = marksFor(
    [
      { type: "paycheck", day: 5, takeHome: 900, garnished: 0, unemployed: false },
      { type: "trade", day: 5, id: "LTM", side: "buy", amount: 200, units: 1, price: 200, recurring: true },
      { type: "savings_interest", day: 5, amount: 3 },
      { type: "trade", day: 5, id: "NNST", side: "sell", amount: 300, units: 2, price: 150, recurring: false },
    ],
    life,
  );
  assert.deepEqual(
    marks.map((m) => [m.tone, m.chip]),
    [
      ["blue", "Sold NNST"],
      ["red", "Payday"],
    ],
  );
  assert.equal(marks[0].amount, 300);
});

test("a debt payment is named after the debt", () => {
  const life = newLife();
  const card = life.book.debts.find((d) => d.kind === "credit_card")!;
  const [m] = marksFor([{ type: "payment", day: 7, debtId: card.id, amount: 180, interest: 20 }], life);
  assert.equal(m.tone, "red");
  assert.equal(m.chip, "Card");
  assert.match(m.text, new RegExp(card.name));
  assert.equal(m.amount, -180);
});

test("the schedule shows paydays, rent, living costs, and each open debt on its due day", () => {
  const life = newLife();
  const names = (y: number, mo: number, d: number) => scheduleFor(life, new Date(y, mo, d)).map((m) => m.chip);
  // The sample household: car loan due the 1st, furniture the 5th, card the 12th, student loans the 20th.
  assert.deepEqual(names(2026, 10, 1), ["Payday", "Rent", "Car"]);
  assert.deepEqual(names(2026, 10, 5), ["Loan"]);
  assert.deepEqual(names(2026, 10, 12), ["Card"]);
  assert.deepEqual(names(2026, 10, 15), ["Payday", "Living"]);
  assert.deepEqual(names(2026, 10, 20), ["Student"]);
  assert.deepEqual(names(2026, 10, 13), []);
  const [pay, rent] = scheduleFor(life, new Date(2026, 10, 1));
  assert.ok(pay.amount! > 0 && rent.amount === -life.rent);
  assert.ok(scheduleFor(life, dateOf(5)).every((m) => m.tone === "red"));
});

test("the forecast finds the first decision a real run hits, without touching the life", () => {
  for (const life of [newLife(), newLife({ monthlyTakeHome: 400 })]) {
    life.onDay(1, dateOf(1));
    const before = serialize(life.detached());
    const found = nextDecisionDay(life, dateOf, 1100);
    assert.equal(serialize(life.detached()), before);
    const run = life.detached();
    let first: number | null = null;
    for (let d = 2; d <= 1101 && first === null; d++) if (run.needsDecision(run.onDay(d, dateOf(d)))) first = d;
    assert.equal(found, first);
  }
});

test("a player who can't pay their bills has a decision coming soon", () => {
  const life = newLife({ monthlyTakeHome: 400 });
  const day = nextDecisionDay(life, dateOf, 120);
  assert.ok(day !== null && day > 0 && day <= 120, String(day));
});

test("no decision inside the horizon means none is shown", () => {
  const life = newLife();
  assert.equal(nextDecisionDay(life, dateOf, 0), null);
});
