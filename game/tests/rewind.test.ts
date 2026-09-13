// Rewind: the prototype-keeping copy, PlayerLife checkpoints, and the LifeTimeline that restores any past day exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deepCopy, serialize } from "../src/sim/rewind/copy.ts";
import { LifeTimeline } from "../src/sim/rewind/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { PlayerLife, STARTER_PORTFOLIO, type Place } from "../src/sim/life/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const newLife = () => new PlayerLife({ place: TX, day: 0, market: new MarketPath(7, START), holdings: STARTER_PORTFOLIO });
/** Lives days `from + 1` through `to`, calling `after(day)` after each day's tick (where the player acts). */
const live = (life: PlayerLife, from: number, to: number, after?: (day: number) => void) => {
  for (let day = from + 1; day <= to; day++) {
    life.onDay(day, dateOf(day));
    after?.(day);
  }
};
const stateOf = (life: PlayerLife) => serialize(life.detached());

class Box {
  items = new Map<string, { n: number }>();
  when = new Date(2026, 8, 11);
  list = [1, 2, 3];
  twice(): number {
    return this.list.length * 2;
  }
}

test("a copy keeps class prototypes and copies Maps, arrays, and Dates", () => {
  const a = new Box();
  a.items.set("x", { n: 1 });
  const b = deepCopy(a);
  assert.ok(b instanceof Box);
  assert.equal(b.twice(), 6);
  b.items.get("x")!.n = 9;
  b.list.push(4);
  b.when.setDate(1);
  assert.equal(a.items.get("x")!.n, 1);
  assert.equal(a.list.length, 3);
  assert.equal(a.when.getDate(), 11);
});

test("a copy shares the seeded market and functions, and survives cycles", () => {
  const market = new MarketPath(1, new Date(2026, 8, 11));
  const fn = () => 1;
  const a: { market: MarketPath; fn: () => number; self?: unknown; nested: { market: MarketPath } } = { market, fn, nested: { market } };
  a.self = a;
  const b = deepCopy(a);
  assert.equal(b.market, market);
  assert.equal(b.nested.market, market);
  assert.equal(b.fn, fn);
  assert.equal(b.self, b);
  assert.notEqual(b, a);
});

test("a life logs every event it emits, and a quiet run still logs but tells no listener", () => {
  const life = newLife();
  let heard = 0;
  life.onEvents(() => heard++);
  live(life, 0, 5);
  assert.equal(heard, 5);
  const logged = life.log.length;
  assert.ok(logged > 0);
  life.quietly(() => live(life, 5, 30));
  assert.equal(heard, 5);
  assert.ok(life.log.length > logged);
  assert.ok(life.log.every((e, i) => i === 0 || e.day >= life.log[i - 1].day));
});

test("a checkpoint restores the morning of its day, before a trade made later that day", () => {
  const life = newLife();
  live(life, 0, 40);
  const cp = life.checkpoint();
  const morning = stateOf(life);
  const morningRow = { ...life.history[life.history.length - 1] };
  const logged = life.log.length;
  assert.equal(life.buy("NNST", 500).ok, true);
  live(life, 40, 90);
  life.restore(cp);
  assert.equal(life.today, 40);
  assert.equal(stateOf(life), morning);
  assert.deepEqual(life.history[life.history.length - 1], morningRow);
  assert.equal(life.log.length, logged);
  // The same checkpoint can be restored again after playing on.
  live(life, 40, 60);
  life.restore(cp);
  assert.equal(stateOf(life), morning);
});

test("a detached copy runs on its own without touching the life", () => {
  const life = newLife();
  let heard = 0;
  life.onEvents(() => heard++);
  live(life, 0, 20);
  const before = stateOf(life);
  const copy = life.detached();
  live(copy, 20, 200);
  assert.equal(stateOf(life), before);
  assert.equal(heard, 20);
  assert.equal(copy.today, 200);
});

test("the timeline rewinds to any past day exactly, through trades and silent changes, after thinning", () => {
  const life = newLife();
  const timeline = new LifeTimeline(life, { start: START, window: 10, maxGap: 30 });
  const truth = new Map<number, string>();
  truth.set(0, stateOf(life));
  live(life, 0, 400, (day) => {
    truth.set(day, stateOf(life));
    if (day === 50) life.buy("NNST", 400);
    if (day === 120) life.book.extraMonthly = 450; // a desk setting that emits nothing
    if (day === 121) life.sell("LTM", 300);
  });
  assert.ok(timeline.size < 60, `kept ${timeline.size} checkpoints`);
  for (const day of [399, 250, 121, 120, 90, 50, 49, 3, 0]) {
    timeline.rewindTo(day);
    assert.equal(life.today, day);
    assert.equal(stateOf(life), truth.get(day), `day ${day}`);
    assert.equal(life.history[life.history.length - 1].day, day);
    assert.ok(life.log.every((e) => e.day <= day));
  }
});

test("after a rewind the city plays on, replays the same days identically, and rewinds again", () => {
  const life = newLife();
  const timeline = new LifeTimeline(life, { start: START, window: 5, maxGap: 20 });
  live(life, 0, 150);
  const at150 = stateOf(life);
  timeline.rewindTo(60);
  live(life, 60, 150);
  assert.equal(stateOf(life), at150);
  timeline.rewindTo(100);
  assert.equal(life.today, 100);
  live(life, 100, 101);
  timeline.rewindTo(101);
  assert.equal(life.today, 101);
});

test("the timeline takes one checkpoint per day during a headless run too", () => {
  const life = newLife();
  const timeline = new LifeTimeline(life, { start: START, window: 400, maxGap: 90 });
  life.runHeadless(0, 300, START);
  assert.equal(timeline.size, 301);
  assert.equal(timeline.firstDay, 0);
});
