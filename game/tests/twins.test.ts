// Twins tests: the "if you had held" and "autopilot" shadow portfolios, and the bear-market events.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Twins } from "../src/sim/life/index.ts";
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
