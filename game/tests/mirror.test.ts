// Bank mirror tests: the month-end statement always reaches the sim's
// balances to the dollar, fast-forwards collapse into one summary, nothing is
// dropped while the server is down, and the sync client's request flow.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, type Place } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { BankSync, lastDayOf, MonthMirror, type MirrorBalances, type MirrorEntry } from "../src/sim/mirror/index.ts";
import { npcLife } from "../src/sim/npcs/index.ts";
import { NPCS } from "../src/data/npcs.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const dayOf = (iso: string) => Math.round((new Date(`${iso}T00:00:00`).getTime() - START.getTime()) / 86_400_000);

function apply(b: MirrorBalances, entries: MirrorEntry[]): MirrorBalances {
  const out = { ...b };
  for (const e of entries) out[e.account] += e.kind === "deposit" ? e.amount : -e.amount;
  return out;
}

const jordan = () => npcLife(NPCS.find((n) => n.id === "npc-jordan")!, { place: TX, day: 0, market: new MarketPath(7, START) });

test("each month's entries reach the sim's month-end balances exactly", () => {
  const life = jordan();
  const mirror = new MonthMirror(life, START);
  let implied = mirror.open();
  const endOfDay = new Map<number, MirrorBalances>();
  let batches = 0;
  for (let day = 1; day <= 130; day++) {
    life.onDay(day, dateOf(day));
    endOfDay.set(day, mirror.balances());
    const batch = mirror.prepare(day);
    if (!batch) continue;
    batches++;
    assert.equal(batch.months.length, 1);
    implied = apply(implied, batch.entries);
    assert.deepEqual(implied, batch.closing);
    assert.deepEqual(batch.closing, endOfDay.get(dayOf(lastDayOf(batch.months[0]))), `closing of ${batch.months[0]}`);
    assert.ok(batch.entries.every((e) => Number.isInteger(e.amount) && e.amount > 0), "whole dollars above zero");
    mirror.commit(batch);
  }
  assert.equal(batches, 4); // Sep, Oct, Nov, Dec 2026
});

test("the statement explains the month with categories, and the card account tracks what's owed", () => {
  const life = jordan();
  const mirror = new MonthMirror(life, START);
  const opening = mirror.open();
  assert.ok(opening.credit > 3000, "Jordan's store card is on the credit account");
  for (let day = 1; day <= 20; day++) life.onDay(day, dateOf(day)); // through Oct 1
  mirror.commit(mirror.prepare(20)!); // September goes out on Oct 1
  for (let day = 21; day <= 51; day++) life.onDay(day, dateOf(day)); // through Nov 1
  const batch = mirror.prepare(51)!;
  assert.deepEqual(batch.months, ["2026-10"]);
  const memos = new Set(batch.entries.map((e) => e.memo));
  for (const m of ["Paycheck", "Rent", "Living costs", "Card payment", "Payment"]) assert.ok(memos.has(m), `has ${m}: ${[...memos].join(", ")}`);
  assert.equal(new Set(batch.entries.map((e) => e.key)).size, batch.entries.length, "keys are unique");
});

test("months that pile up (a fast-forward) collapse into one summary batch", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: new MarketPath(3, START) });
  const mirror = new MonthMirror(life, START);
  const opening = mirror.open();
  life.runHeadless(0, 800, START);
  const batch = mirror.prepare(800)!;
  assert.ok(batch.months.length > 20, `${batch.months.length} months`);
  assert.ok(batch.entries.every((e) => e.key.startsWith(`${batch.months[0]}..`)));
  assert.ok(batch.entries.some((e) => /\(\d+ months\)$/.test(e.memo)));
  assert.deepEqual(apply(opening, batch.entries), batch.closing);
});

test("an uncommitted batch (server down) is folded into the next one", () => {
  const life = jordan();
  const mirror = new MonthMirror(life, START);
  const opening = mirror.open();
  for (let day = 1; day <= 25; day++) life.onDay(day, dateOf(day));
  const failed = mirror.prepare(25)!;
  assert.deepEqual(failed.months, ["2026-09"]);
  for (let day = 26; day <= 60; day++) life.onDay(day, dateOf(day));
  const later = mirror.prepare(60)!;
  assert.deepEqual(later.months, ["2026-09", "2026-10"]);
  assert.deepEqual(apply(opening, later.entries), later.closing);
});

test("rebase continues from what the server already holds", () => {
  const life = jordan();
  const mirror = new MonthMirror(life, START);
  mirror.open();
  mirror.rebase({ checking: 10, savings: 0, credit: 0 });
  for (let day = 1; day <= 25; day++) life.onDay(day, dateOf(day));
  const batch = mirror.prepare(25)!;
  assert.deepEqual(apply({ checking: 10, savings: 0, credit: 0 }, batch.entries), batch.closing);
});

function fakeServer(opts: { statusOk?: boolean; entriesStatus?: () => number } = {}) {
  const calls: { path: string; body: any; credentials?: RequestCredentials }[] = [];
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body, credentials: init.credentials });
    if (path.endsWith("/status")) return new Response("{}", { status: opts.statusOk === false ? 503 : 200 });
    if (path.endsWith("/open")) return new Response(JSON.stringify({ run: body.run, reused: 0, balances: body.opening }), { status: 200 });
    const status = opts.entriesStatus?.() ?? 200;
    return new Response(JSON.stringify({ posted: body.entries.length, skipped: 0 }), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

test("sync stays off when the server can't reach Nessie", async () => {
  const server = fakeServer({ statusOk: false });
  const sync = new BankSync({ run: "r1", start: START, fetchFn: server.fetchFn, log: () => {} });
  sync.add("player", "Player", jordan());
  assert.equal(await sync.begin(), false);
  await sync.tick(40);
  assert.deepEqual(server.calls.map((c) => c.path), ["/api/bank/status"]);
});

test("a spend event becomes a checking withdrawal memo'd by category", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  life.ledger.get("checking").balance = 200;
  const mirror = new MonthMirror(life, START);
  mirror.rebase({ checking: 200, savings: 0, credit: 0 });
  life.spend(5, "Dining out", 25);
  // Force the month to close by advancing to October (day 20 is Oct 1)
  for (let day = 1; day <= 20; day++) life.onDay(day, dateOf(day));
  const batch = mirror.prepare(20)!;
  const entry = batch.entries.find((e) => e.memo === "Dining out");
  assert.ok(entry, "Dining out should appear as its own line item");
  assert.equal(entry!.account, "checking");
  assert.equal(entry!.kind, "withdrawal");
  assert.equal(entry!.amount, 25);
});

test("sync opens each life, posts finished months with the session cookie, and reopens after a 409", async () => {
  let entriesStatus = 200;
  const server = fakeServer({ entriesStatus: () => entriesStatus });
  const sync = new BankSync({ run: "r1", start: START, fetchFn: server.fetchFn, log: () => {} });
  const life = jordan();
  sync.add("npc-jordan", "Jordan", life);
  assert.equal(await sync.begin(), true);
  const open = server.calls.find((c) => c.path === "/api/bank/npc-jordan/open")!;
  assert.equal(open.body.name, "Jordan");
  assert.equal(open.credentials, "include");

  for (let day = 1; day <= 25; day++) {
    life.onDay(day, dateOf(day));
    await sync.tick(day);
  }
  const posts = server.calls.filter((c) => c.path.endsWith("/entries"));
  assert.equal(posts.length, 1);
  assert.ok(posts[0].body.entries.every((e: MirrorEntry) => e.key.startsWith("2026-09:")));

  entriesStatus = 409;
  for (let day = 26; day <= 55; day++) {
    life.onDay(day, dateOf(day));
    await sync.tick(day);
  }
  await sync.idle();
  assert.equal(server.calls.filter((c) => c.path.endsWith("/open")).length > 1, true, "reopened after the server lost the run");
});
