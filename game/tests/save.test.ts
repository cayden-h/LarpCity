// Save and restore: every stateful sim piece encodes to plain JSON and comes
// back identical, and a restored life plays on exactly like one never saved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Twins } from "../src/sim/life/twins.ts";
import { Ledger } from "../src/sim/money/accounts.ts";
import { CrashWatch } from "../src/sim/skip/crash.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { PlayerLife, SAVE_DAILY_DAYS, STARTER_PORTFOLIO, compactHistory, type LifeEvent, type Place } from "../src/sim/life/index.ts";
import { lifeFromIntake } from "../src/sim/life/intake.ts";
import { applyOrders } from "../src/sim/skip/orders.ts";
import { NpcTown } from "../src/sim/npcs/index.ts";
import { LifeTimeline, serialize } from "../src/sim/rewind/index.ts";

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
        // The calendar and the recorder's fork read the log: the days after the save match, and the saved days came along.
        assert.deepEqual(restored.log.filter((e) => e.day > saveDay), control.log.filter((e) => e.day > saveDay));
        assert.deepEqual(restored.log.filter((e) => e.day <= saveDay), json(before.log.filter((e) => e.day > saveDay - SAVE_DAILY_DAYS)));
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

test("the NPC town restores and keeps living like one never saved", () => {
  const make = (saved?: ReturnType<NpcTown["toSave"]>) => new NpcTown({ place: TX, day: 0, market: new MarketPath(9, START), start: START, saved });
  const control = make();
  for (let d = 1; d <= 120; d++) control.onDay(d);
  const before = make();
  for (let d = 1; d <= 60; d++) before.onDay(d);
  const restored = make(json(before.toSave()));
  for (let d = 61; d <= 120; d++) restored.onDay(d);
  assert.deepEqual(restored.toSave(), control.toSave());
});

test("a saved log keeps the same recent days as the saved history", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: new MarketPath(5, START), holdings: STARTER_PORTFOLIO });
  play(life, 0, 500);
  const save = life.toSave(100);
  assert.ok(save.log.length > 0);
  assert.ok(save.log.every((e) => e.day > 400));
  assert.deepEqual(save.log, json(life.log.filter((e) => e.day > 400)));
});

test("a restored life has exactly the fields of a fresh one, so rewind copies it whole", () => {
  const fresh = new PlayerLife({ place: TX, day: 0, market: new MarketPath(5, START), holdings: STARTER_PORTFOLIO });
  play(fresh, 0, 30);
  const restored = PlayerLife.fromSave(json(fresh.toSave()), { market: new MarketPath(5, START) });
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(fresh).sort());
});

for (const [name, make] of LIVES) {
  test(`${name}: a restored life rewinds on its timeline exactly like one never saved`, () => {
    const seed = 20260912;
    const control = make(new MarketPath(seed, START));
    const controlLine = new LifeTimeline(control, { start: START });
    play(control, 0, 320);

    const before = make(new MarketPath(seed, START));
    play(before, 0, 250);
    const restored = PlayerLife.fromSave(json(before.toSave()), { market: new MarketPath(seed, START) });
    const restoredLine = new LifeTimeline(restored, { start: START });
    play(restored, 250, 320);

    // Back to before the unemployment on day 300, then a different life from there.
    controlLine.rewindTo(270);
    restoredLine.rewindTo(270);
    assert.equal(restored.today, 270);
    assert.equal(serialize(restored.detached()), serialize(control.detached()));
    assert.deepEqual(restored.toSave(), control.toSave());
    for (const life of [control, restored]) {
      for (let day = 271; day <= 330; day++) {
        life.onDay(day, dateOf(day));
        if (day === 280) life.buy("LTM", 150, day);
      }
    }
    assert.deepEqual(restored.toSave(), control.toSave());
  });
}

test("a restored NPC town rewinds like one never saved", () => {
  const make = (saved?: ReturnType<NpcTown["toSave"]>) => new NpcTown({ place: TX, day: 0, market: new MarketPath(9, START), start: START, saved });
  const control = make();
  for (let d = 1; d <= 120; d++) control.onDay(d);
  const before = make();
  for (let d = 1; d <= 60; d++) before.onDay(d);
  const restored = make(json(before.toSave()));
  for (let d = 61; d <= 120; d++) restored.onDay(d);
  control.rewind(90);
  restored.rewind(90);
  for (const life of restored.lives.values()) assert.equal(life.today, 90);
  assert.deepEqual(restored.toSave(), control.toSave());
  for (let d = 91; d <= 110; d++) {
    control.onDay(d);
    restored.onDay(d);
  }
  assert.deepEqual(restored.toSave(), control.toSave());
});
