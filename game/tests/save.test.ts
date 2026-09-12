// Save and restore: every stateful sim piece encodes to plain JSON and comes
// back identical, and a restored life plays on exactly like one never saved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Twins } from "../src/sim/life/twins.ts";
import { Ledger } from "../src/sim/money/accounts.ts";
import { CrashWatch } from "../src/sim/skip/crash.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { PlayerLife, STARTER_PORTFOLIO, compactHistory, type LifeEvent, type Place } from "../src/sim/life/index.ts";
import { lifeFromIntake } from "../src/sim/life/intake.ts";
import { applyOrders } from "../src/sim/skip/orders.ts";

const START = new Date(2026, 8, 11);
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test("twins round-trip through JSON", () => {
  const market = new MarketPath(3, START);
  const t = new Twins(market);
  t.seedHolding("LTM", 10, 0);
  t.buy("NNST", 500, 20);
  t.sell(120);
  t.buy("LTM", 300, 60);
  const back = Twins.fromSave(json(t.toSave()), market);
  assert.deepEqual(back.toSave(), t.toSave());
  assert.equal(back.held(400), t.held(400));
  assert.equal(back.autopilot(400), t.autopilot(400));
});

test("a ledger round-trips with a pending transfer and keeps numbering transfers", () => {
  const l = new Ledger([
    { id: "checking", kind: "checking", name: "Checking", balance: 1000, apy: 0, openedDay: 0 },
    { id: "savings", kind: "savings", name: "Savings", balance: 0, apy: 0.04, openedDay: 0 },
  ]);
  const ctx = { day: 5, date: new Date(2026, 8, 16), age: 27 };
  l.transfer("checking", "savings", 100, "ach", ctx);
  const back = Ledger.fromSave(json(l.toSave()));
  assert.deepEqual(back.toSave(), l.toSave());
  const a = l.transfer("checking", "savings", 50, "internal", ctx);
  const b = back.transfer("checking", "savings", 50, "internal", ctx);
  assert.equal(b.id, a.id);
  assert.deepEqual(back.toSave(), l.toSave());
});

test("the crash watch keeps its private recovery count", () => {
  const c = new CrashWatch();
  c.update(100, "sell_all");
  c.update(70, "sell_all"); // sells
  c.update(101, "sell_all"); // recovered, month 0
  const back = CrashWatch.fromSave(json(c.toSave()));
  assert.deepEqual(back.toSave(), c.toSave());
  assert.equal(back.update(102, "sell_all"), c.update(102, "sell_all"));
});

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};

/** The player's choices, on fixed days, the same for the saved and the unsaved life. */
function decide(life: PlayerLife, day: number): void {
  if (day === 20) life.buy("LTM", 300, day);
  if (day === 45)
    applyOrders(life, { depositMonthly: 400, k401Pct: 0.06, stockPct: 0.9, debtStrategy: "avalanche", extraMonthly: 100, emergencyMonths: 3, lifestyle: "normal", crashRule: "sell_half" });
  if (day === 200) life.sell("NNST", "all", day);
  if (day === 260) {
    const ctx = { day, date: dateOf(day), age: life.age };
    if (life.ledger.quote("savings", "checking", 200, "internal", ctx).ok) life.ledger.transfer("savings", "checking", 200, "internal", ctx);
  }
  if (day === 300) life.setEmployed(false, day);
  if (day === 420) life.setEmployed(true, day);
  if (day === 500) life.setPlace(CA, day);
  if (day === 600) life.book.extraMonthly = 200;
}

function play(life: PlayerLife, from: number, to: number): LifeEvent[] {
  const all: LifeEvent[] = [];
  life.onEvents((events) => all.push(...events));
  for (let day = from + 1; day <= to; day++) {
    life.onDay(day, dateOf(day));
    decide(life, day);
  }
  return all;
}

const LIVES: [string, (market: MarketPath) => PlayerLife][] = [
  ["sample household", (market) => new PlayerLife({ place: TX, day: 0, market, holdings: STARTER_PORTFOLIO })],
  [
    "intake life",
    (market) =>
      lifeFromIntake({ job: "Nurse", salary: 72_000, rent: 1_400, debt: 15_000, savings: 3_000 }, { place: TX, day: 0, market, holdings: STARTER_PORTFOLIO }),
  ],
];
const END = 900;

for (const seed of [5, 20260912]) {
  for (const [name, make] of LIVES) {
    for (const saveDay of [1, 44, 301, 777]) {
      test(`${name}, seed ${seed}, saved on day ${saveDay}, plays on exactly like one never saved`, () => {
        const control = make(new MarketPath(seed, START));
        const controlEvents = play(control, 0, END).filter((e) => e.day > saveDay);

        const before = make(new MarketPath(seed, START));
        play(before, 0, saveDay);
        const restored = PlayerLife.fromSave(json(before.toSave()), { market: new MarketPath(seed, START) });
        const restoredEvents = play(restored, saveDay, END);

        assert.deepEqual(restoredEvents, controlEvents);
        assert.deepEqual(restored.toSave(), control.toSave());
        assert.equal(restored.netWorth(), control.netWorth());
      });
    }
  }
}

test("saved history is daily for the recent past and weekly before it", () => {
  const snaps = Array.from({ length: 1000 }, (_, day) => ({ day }) as never);
  const kept = compactHistory(snaps, 999, 400).map((s: { day: number }) => s.day);
  assert.ok(kept.includes(600) && kept.includes(999));
  assert.ok(kept.includes(0) && kept.includes(7) && !kept.includes(8));
  assert.equal(kept.length, 400 + Math.floor(599 / 7) + 1);
});

test("a restored life keeps its home state's rent after a move", () => {
  const life = new PlayerLife({ place: TX, day: 0, rent: 1_000 });
  life.setPlace(CA, 3);
  const back = PlayerLife.fromSave(json(life.toSave()), { market: new MarketPath() });
  assert.equal(back.rent, life.rent);
  assert.equal(back.place.abbr, "CA");
});
