// Twins tests: the "if you had held" and "autopilot" shadow portfolios, and the bear-market events.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, STARTER_PORTFOLIO, Twins, type Place } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";

const START = new Date(2026, 8, 11);
// An early AI arc so a test reaches the pop and the recovery in a few simulated years.
const earlyMarket = () => new MarketPath(5, START, { boom: new Date(2026, 9, 1), pop: new Date(2027, 0, 4) });

test("twins copy buys at the same price and ignore sells", () => {
  const m = earlyMarket();
  const t = new Twins(m);
  t.buy("NNST", 1_000, 0);
  t.sell(400);
  assert.equal(t.invested, 1_000);
  assert.equal(t.cashOut, 400);
  // Held owns exactly what $1,000 of NNST bought on day 0.
  assert.ok(Math.abs(t.held(50) - (1_000 / m.price("NNST", 0)) * m.price("NNST", 50)) < 0.01);
  // Autopilot put the same $1,000 in 90% LTM and 10% BOND.
  const auto = (900 / m.price("LTM", 0)) * m.price("LTM", 50) + (100 / m.price("BOND", 0)) * m.price("BOND", 50);
  assert.ok(Math.abs(t.autopilot(50) - auto) < 0.01);
  // You is the brokerage value plus the cash sells took out.
  assert.equal(t.you(250), 650);
});

test("an empty twin is worth nothing", () => {
  const t = new Twins(earlyMarket());
  assert.equal(t.held(10), 0);
  assert.equal(t.autopilot(10), 0);
});

test("buying back with sale proceeds doesn't feed the twins twice", () => {
  const m = earlyMarket();
  const t = new Twins(m);
  t.buy("LTM", 1_000, 0);
  t.sell(1_000);
  t.buy("LTM", 1_000, 10);
  assert.equal(t.invested, 1_000);
  assert.equal(t.cashOut, 0);
  assert.ok(Math.abs(t.held(20) - (1_000 / m.price("LTM", 0)) * m.price("LTM", 20)) < 0.01);

  t.sell(300);
  t.buy("BOND", 500, 20);
  assert.equal(t.cashOut, 0);
  assert.equal(t.invested, 1_200);
});

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const live = (life: PlayerLife, from: number, to: number) => {
  const all = [];
  for (let day = from + 1; day <= to; day++) all.push(...life.onDay(day, dateOf(day)));
  return all;
};

test("buying and holding keeps you equal to held", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: earlyMarket() });
  life.buy("LTM", 500);
  live(life, 0, 60);
  const s = life.history.at(-1)!;
  assert.equal(s.you, s.held);
  assert.equal(s.brokerage, s.you);
  assert.ok(s.autopilot > 0 && s.autopilot !== s.held);
});

test("selling at the pop's bottom leaves you below held after the recovery", () => {
  const m = earlyMarket();
  const life = new PlayerLife({ place: TX, day: 0, market: m });
  life.buy("LTM", 1_000);
  const bottom = m.presets.popEndDay - 1;
  const end = m.presets.popEndDay + 400;
  assert.ok(m.price("LTM", end) > m.price("LTM", bottom), "seed 5 recovers from the bottom by the end");
  live(life, 0, bottom);
  assert.ok(life.sell("LTM", "all").ok);
  live(life, bottom, end);
  const s = life.history.at(-1)!;
  assert.equal(s.brokerage, 0);
  assert.ok(s.you > 0, "the sale's cash still counts on your line");
  assert.ok(s.held > s.you, `held ${s.held} vs you ${s.you}`);
});

test("two trades on one day keep one snapshot with both buys", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: earlyMarket() });
  life.buy("LTM", 100);
  life.buy("BOND", 100);
  assert.equal(life.history.length, 1);
  assert.ok(Math.abs(life.history[0].held - 200) < 0.01);
});

test("a sell and a buy-back leave held on the original buy", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: earlyMarket() });
  life.buy("LTM", 1_000);
  live(life, 0, 30);
  const r = life.sell("LTM", "all");
  assert.ok(r.ok);
  const proceeds = r.ok && r.event.type === "trade" ? r.event.amount : 0;
  live(life, 30, 60);
  if (proceeds <= life.buyingPower()) life.buy("LTM", proceeds);
  assert.ok(Math.abs(life.twins.invested - 1_000) < 0.01);
  assert.ok(Math.abs(life.twins.cashOut) < 0.01);
  const s = life.history.at(-1)!;
  assert.equal(s.you, s.brokerage);
});

test("a bear market fires once per drawdown and re-arms after a new high", () => {
  const m = earlyMarket();
  const life = new PlayerLife({ place: TX, day: 0, market: m });
  life.buy("LTM", 1_000);
  const events = live(life, 0, m.presets.popEndDay + 800).filter((e) => e.type === "bear_market" || e.type === "market_recovered");
  assert.ok(events.some((e) => e.type === "bear_market" && e.day >= m.presets.popDay && e.day < m.presets.popEndDay), "the AI pop is a bear market");
  // They alternate: bear, recovered, bear, recovered...
  events.forEach((e, i) => assert.equal(e.type, i % 2 ? "market_recovered" : "bear_market"));
  for (const e of events) if (e.type === "bear_market") assert.ok(e.drop >= 0.2 && e.stocks > 0);
});

test("no stocks, no bear-market decision", () => {
  const m = earlyMarket();
  const life = new PlayerLife({ place: TX, day: 0, market: m });
  life.buy("BOND", 500);
  const events = live(life, 0, m.presets.popEndDay);
  assert.equal(events.filter((e) => e.type === "bear_market").length, 0);
  assert.equal(life.needsDecision([{ type: "bear_market", day: 1, drop: 0.2, stocks: 1 }]), true);
});

test("the starter portfolio starts every line in the same place", () => {
  const m = earlyMarket();
  const life = new PlayerLife({ place: TX, day: 0, market: m, holdings: STARTER_PORTFOLIO });
  const s = life.history[0];
  // On day 0 all three lines are the brokerage's value, so any later gap comes from the player's choices.
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  assert.ok(near(s.brokerage, 6_800), `brokerage ${s.brokerage}`);
  assert.ok(near(s.you, s.brokerage) && near(s.held, s.brokerage) && near(s.autopilot, s.brokerage), `you ${s.you} held ${s.held} autopilot ${s.autopilot}`);
  assert.ok(near(life.twins.invested, s.brokerage), `invested ${life.twins.invested}`);
  assert.equal(life.twins.cashOut, 0);
  const past = life.pastSnapshots(-30);
  assert.ok(past.length > 0 && past.every((p) => p.brokerage > 0 && p.you === p.held && p.held === p.autopilot));
});
