// Market path and brokerage tests: determinism, calibration against research/03,
// and PlayerLife's buy, sell, and recurring investments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketPath, INSTRUMENTS, AI_BOOM_START, AI_BUBBLE_POP_START } from "../src/sim/market/index.ts";
import { PlayerLife, type Place } from "../src/sim/life/index.ts";
import { MARKET } from "../src/data/market.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};

test("the same seed gives the same path, and query order doesn't matter", () => {
  const a = new MarketPath(42);
  const b = new MarketPath(42);
  const late = b.price("LTM", 900);
  for (let d = 0; d <= 900; d++) a.price("LTM", d);
  assert.equal(a.price("LTM", 900), late);
  assert.notEqual(new MarketPath(43).price("LTM", 900), late);
});

test("day 0 continues the real snapshot and the past is real history", () => {
  const m = new MarketPath();
  const sp = MARKET.series.SP500.points;
  assert.equal(m.level(0), sp[sp.length - 1][1]);
  assert.equal(m.price("LTM", 0), INSTRUMENTS.find((i) => i.id === "LTM")!.start);
  assert.ok(m.firstDay < -300, `history starts on day ${m.firstDay}`);
  assert.equal(m.series("SP500", -10_000, 0)[0].day, m.firstDay);
});

test("weekends hold Friday's close", () => {
  const m = new MarketPath(7);
  for (let d = 1; d < 60; d++) {
    const wd = dateOf(d).getDay();
    if (wd === 0 || wd === 6) assert.equal(m.level(d), m.level(d - 1));
  }
});

test("long-run growth and volatility match research/03's calibration", () => {
  const years = 30;
  const days = years * 365;
  let growth = 0;
  let bears = 0;
  const seeds = 24;
  for (let s = 1; s <= seeds; s++) {
    const m = new MarketPath(s);
    growth += Math.log(m.level(days) / m.level(0)) / years;
    for (let d = 0; d <= days; d += 7) if (m.regime(d) === "bear") { bears++; break; }
  }
  const avg = growth / seeds;
  // ~8% a year geometric, allowing for seed noise.
  assert.ok(avg > 0.04 && avg < 0.12, `average log growth ${avg.toFixed(3)}`);
  assert.ok(bears >= seeds * 0.8, `${bears} of ${seeds} runs saw a bear market`);

  const m = new MarketPath(3);
  const vol = (id: "LTM" | "BOND" | "NNST") => {
    const r: number[] = [];
    for (let d = 1; d <= 2000; d++) {
      const a = m.price(id, d - 1), b = m.price(id, d);
      if (a !== b) r.push(Math.log(b / a));
    }
    const mean = r.reduce((s, x) => s + x, 0) / r.length;
    return Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / r.length);
  };
  assert.ok(vol("BOND") < vol("LTM") && vol("LTM") < vol("NNST"), "bonds calmer than the index, the single stock wildest");
});

test("the AI boom and bubble pop land on their preset dates in every run", () => {
  for (const seed of [1, 2, 3, 20260911]) {
    const m = new MarketPath(seed);
    const { boomDay, popDay, popEndDay, boomMultiple, popDepth, nnstPopDepth } = m.presets;
    assert.equal(m.dateOf(boomDay).toDateString(), AI_BOOM_START.toDateString());
    assert.equal(m.dateOf(popDay).toDateString(), AI_BUBBLE_POP_START.toDateString()); // Sep 1, 2028 is a Friday
    assert.ok(boomMultiple >= 3 && boomMultiple <= 4 && popDepth >= 0.2 && popDepth <= 0.3 && nnstPopDepth >= 0.7 && nnstPopDepth <= 0.85);
    assert.ok(Math.abs(m.price("NNST", popDay - 1) / m.price("NNST", boomDay - 1) - boomMultiple) < 1e-9, `seed ${seed}: the boom lands on its multiple`);
    // The steered fall lands exactly on the preset depths.
    assert.ok(Math.abs(1 - m.level(popEndDay - 1) / m.level(popDay - 1) - popDepth) < 1e-9);
    assert.ok(Math.abs(1 - m.price("NNST", popEndDay - 1) / m.price("NNST", popDay - 1) - nnstPopDepth) < 1e-9);
    assert.equal(m.regime(popDay + 10), "bear");
    assert.equal(m.regime(popEndDay), "bull");
  }
  // Other dates can be passed in, for tests and for when the team picks them.
  const early = new MarketPath(5, START, { boom: new Date(2026, 9, 1), pop: new Date(2027, 0, 4) });
  assert.equal(early.presets.popDay, early.dayOf(new Date(2027, 0, 4)));
});

test("buying moves cash into holdings without changing net worth", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const before = life.netWorth();
  const r = life.buy("LTM", 500);
  assert.ok(r.ok);
  assert.equal(life.ledger.get("checking").balance, 700);
  assert.equal(life.investments(), 500);
  assert.equal(life.netWorth(), before);
  assert.equal(life.buy("LTM", 5_000).ok, false);
  assert.equal(life.buy("LTM", 0.5).ok, false);
});

test("holdings follow the market, and selling everything returns their value", () => {
  const market = new MarketPath(11);
  const life = new PlayerLife({ place: TX, day: 0, market });
  life.buy("NNST", 1_000);
  for (let d = 1; d <= 120; d++) life.onDay(d, dateOf(d));
  const pos = life.position("NNST")!;
  assert.ok(Math.abs(pos.value - (1_000 / market.price("NNST", 0)) * market.price("NNST", 120)) < 0.02);
  const cashBefore = life.ledger.get("checking").balance;
  const r = life.sell("NNST", "all");
  assert.ok(r.ok);
  assert.equal(life.position("NNST"), undefined);
  assert.ok(Math.abs(life.ledger.get("checking").balance - (cashBefore + pos.value)) < 0.02);
});

test("recurring investments buy on paydays after bills, and skip when checking is short", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  // A 80/20 stock/bond mix is two standing buys.
  life.recurring = [{ id: "LTM", amount: 80 }, { id: "BOND", amount: 20 }];
  const events = [];
  for (let d = 1; d <= 40; d++) events.push(...life.onDay(d, dateOf(d)));
  const buys = events.filter((e) => e.type === "trade" && e.recurring);
  assert.equal(buys.length, 6); // Sep 15, Oct 1, Oct 15, two funds each
  assert.ok(life.investments() > 250);
  assert.ok(Math.abs(life.position("BOND")!.cost - 60) < 0.01);

  const broke = new PlayerLife({ place: TX, day: 0 });
  broke.recurring = [{ id: "LTM", amount: 1_000_000 }];
  const ev = [];
  for (let d = 1; d <= 5; d++) ev.push(...broke.onDay(d, dateOf(d)));
  assert.ok(ev.some((e) => e.type === "trade_skipped"));
});

test("history keeps one snapshot per day", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.buy("LTM", 100);
  life.onDay(1, dateOf(1));
  assert.deepEqual(life.history.map((h) => h.day), [0, 1]);
});
