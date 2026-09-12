// Save and restore: every stateful sim piece encodes to plain JSON and comes
// back identical, and a restored life plays on exactly like one never saved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Twins } from "../src/sim/life/twins.ts";
import { Ledger } from "../src/sim/money/accounts.ts";
import { CrashWatch } from "../src/sim/skip/crash.ts";
import { MarketPath } from "../src/sim/market/index.ts";

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
