// The phone calendar's data: chips for past days, scheduled money for future
// days, and the forecast of the next decision day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { marksFor, scheduleFor, nextDecisionDay } from "../src/sim/calendar/index.ts";
import { GRACE_DAYS } from "../src/sim/debt/index.ts";
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
/** The game day of a calendar date. */
const dayOf = (date: Date) => Math.round((date.getTime() - START.getTime()) / 86_400_000);
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
      ["red", "Pay", 1840],
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
      ["blue", "Sell"],
      ["red", "Pay"],
    ],
  );
  assert.equal(marks[0].amount, 300);
  assert.equal(marks[0].text, "Sold NNST");
});

test("every chip is one short word, so it fits a month cell whole", () => {
  const life = newLife();
  const day = 5;
  const chips = [
    ...marksFor(life.log, life),
    ...Array.from({ length: 62 }, (_, i) => scheduleFor(life, i, dateOf(i))).flat(),
    ...marksFor(
      [
        { type: "trade", day, id: "NNST", side: "buy", amount: 1, units: 1, price: 1, recurring: false },
        { type: "moved", day, from: "TX", to: "CA", rent: 1, living: 1 },
        { type: "job", day, employed: false },
        { type: "bear_market", day, drop: 0.2, stocks: 1 },
        { type: "market_recovered", day, you: 1, held: 1, autopilot: 1 },
        { type: "bankruptcy_eligible", day, reason: "x" },
        { type: "paid_off", day, debtId: "car", name: "Car loan" },
      ],
      life,
    ),
  ].map((m) => m.chip);
  assert.ok(chips.length > 10);
  for (const c of chips) assert.ok(c.length <= 5 && !c.includes(" "), c);
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

test("the schedule shows paydays, rent, living costs, and each loan on its due day", () => {
  const life = newLife();
  const on = (date: Date) => scheduleFor(life, dayOf(date), date);
  const names = (y: number, mo: number, d: number) => on(new Date(y, mo, d)).map((m) => m.chip);
  // The sample household: car loan due the 1st, furniture the 5th, student loans the 20th.
  assert.deepEqual(names(2026, 10, 1), ["Pay", "Rent", "Car"]);
  assert.deepEqual(names(2026, 10, 5), ["Loan"]);
  assert.deepEqual(names(2026, 10, 15), ["Pay", "Bills"]);
  assert.deepEqual(names(2026, 10, 20), ["Loan"]);
  assert.deepEqual(names(2026, 10, 13), []);
  const [pay, rent] = on(new Date(2026, 10, 1));
  assert.ok(pay.amount! > 0 && rent.amount === -life.rent);
  assert.ok(scheduleFor(life, 5, dateOf(5)).every((m) => m.tone === "red"));
});

test("a card falls due on its statement's due day, then GRACE_DAYS after each later statement closes", () => {
  const life = newLife();
  const card = life.book.debts.find((d) => d.kind === "credit_card")!;
  const cardDays = Array.from({ length: 150 }, (_, d) => d).filter((d) => scheduleFor(life, d, dateOf(d)).some((m) => m.chip === "Card"));
  assert.ok(cardDays.length >= 4, cardDays.join(","));
  if (card.statementDueDay !== undefined) {
    assert.equal(cardDays[0], card.statementDueDay);
    const [known] = scheduleFor(life, card.statementDueDay, dateOf(card.statementDueDay)).filter((m) => m.chip === "Card");
    assert.equal(known.amount, -card.minimumDue!);
  }
  for (const d of cardDays.filter((d) => d !== card.statementDueDay)) assert.equal(dateOf(d - GRACE_DAYS).getDate(), card.dueDayOfMonth);
});

test("the schedule's card days are the days a real run pays the card on autopay", () => {
  const life = newLife();
  const card = life.book.debts.find((d) => d.kind === "credit_card")!;
  const scheduled = Array.from({ length: 200 }, (_, d) => d + 1).filter((d) => scheduleFor(life, d, dateOf(d)).some((m) => m.chip === "Card"));
  const paid: number[] = [];
  for (let d = 1; d <= 200; d++) {
    const events = life.onDay(d, dateOf(d));
    // The payoff plan's extra goes out on the 1st; the autopay minimum on the due day.
    if (dateOf(d).getDate() !== 1 && events.some((e) => e.type === "payment" && e.debtId === card.id)) paid.push(d);
  }
  assert.ok(paid.length >= 5, paid.join(","));
  // Every due day up to the last one the run reached was paid, and nothing else was.
  assert.deepEqual(paid, scheduled.filter((d) => d <= paid[paid.length - 1]));
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
