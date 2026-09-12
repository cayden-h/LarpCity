// Run recorder tests: daily snapshots match the life, events get stable keys,
// batches wait for the server, and a fast-forward goes out in chunks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, type Place } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { MAX_BATCH, RunRecorder, snapshotOf, type EventEntry, type SnapshotEntry } from "../src/sim/record/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const newLife = () => new PlayerLife({ place: TX, day: 0, market: new MarketPath(5, START) });

function fakeServer(opts: { up?: () => boolean } = {}) {
  const snaps = new Map<number, SnapshotEntry>();
  const events = new Map<string, EventEntry>();
  const calls: { path: string; rows: number; credentials?: RequestCredentials }[] = [];
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input);
    const body = JSON.parse(String(init.body));
    calls.push({ path, rows: (body.entries ?? body.events ?? []).length, credentials: init.credentials });
    if (opts.up && !opts.up()) return new Response("{}", { status: 503 });
    if (path.endsWith("/runs")) return new Response(JSON.stringify({ runId: "run-1" }), { status: 201 });
    if (body.entries?.length > MAX_BATCH || body.events?.length > MAX_BATCH) return new Response("{}", { status: 400 });
    if (path.endsWith("/snapshot")) for (const s of body.entries) snaps.set(s.day, s);
    if (path.endsWith("/events")) for (const e of body.events) events.set(e.key, e);
    return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
  }) as typeof fetch;
  return { fetchFn, snaps, events, calls };
}

test("a snapshot splits net worth into where it sits", () => {
  const life = newLife();
  for (let day = 1; day <= 60; day++) life.onDay(day, dateOf(day));
  life.buy("LTM", 300);
  const s = snapshotOf(life, 60);
  assert.equal(s.netWorth, life.netWorth());
  assert.ok(Math.abs(s.checking + s.savings + s.brokerage + s.retirement - s.debt - s.netWorth) < 0.05);
  assert.ok(s.brokerage > 290, "holdings count at today's price");
});

test("every day and event reaches the server once, in month-sized batches, with the session cookie", async () => {
  const server = fakeServer();
  const life = newLife();
  const rec = new RunRecorder({ life, seed: 5, fetchFn: server.fetchFn, log: () => {} });
  assert.equal(await rec.begin(), true);
  for (let day = 1; day <= 95; day++) {
    life.onDay(day, dateOf(day));
    await rec.tick();
  }
  await rec.tick(true);
  assert.equal(server.snaps.size, 96, "days 0 through 95");
  for (const h of life.history) assert.equal(server.snaps.get(h.day)?.netWorth, h.netWorth, `day ${h.day}`);
  const posts = server.calls.filter((c) => c.path.endsWith("/snapshot"));
  assert.ok(posts.length >= 3 && posts.every((c) => c.rows <= 31), posts.map((c) => c.rows).join(","));
  assert.ok(server.calls.every((c) => c.credentials === "include"));
  const kinds = new Set([...server.events.values()].map((e) => e.kind));
  for (const k of ["paycheck", "bill", "payment"]) assert.ok(kinds.has(k as EventEntry["kind"]), k);
  assert.deepEqual(rec.pending, { days: 0, events: 0 });
});

test("while the server is down nothing is dropped, and it all goes out when it's back", async () => {
  let up = true;
  const server = fakeServer({ up: () => up });
  const life = newLife();
  const rec = new RunRecorder({ life, seed: 5, fetchFn: server.fetchFn, log: () => {} });
  await rec.begin();
  up = false;
  for (let day = 1; day <= 70; day++) {
    life.onDay(day, dateOf(day));
    await rec.tick();
  }
  assert.equal(server.snaps.size, 0);
  assert.equal(rec.pending.days, 71);
  up = true;
  await rec.tick(true);
  assert.equal(server.snaps.size, 71);
  assert.deepEqual(rec.pending, { days: 0, events: 0 });
});

test("a decade-long fast-forward goes out in chunks the server accepts", async () => {
  const server = fakeServer();
  const life = newLife();
  const rec = new RunRecorder({ life, seed: 5, fetchFn: server.fetchFn, log: () => {} });
  await rec.begin();
  life.runHeadless(0, 3650, START);
  await rec.tick(true);
  assert.equal(server.snaps.size, 3651);
  assert.ok(server.calls.filter((c) => c.path.endsWith("/snapshot")).length === 1);
  const keys = [...server.events.keys()];
  assert.equal(new Set(keys).size, keys.length);

  life.runHeadless(3650, 3650, dateOf(3650));
  await rec.tick(true);
  assert.equal(server.snaps.size, 7301);
  assert.ok(server.calls.filter((c) => c.path.endsWith("/snapshot")).every((c) => c.rows <= MAX_BATCH));
});

test("snapshots carry the investing lines", () => {
  const life = newLife();
  life.buy("LTM", 500);
  for (let day = 1; day <= 30; day++) life.onDay(day, dateOf(day));
  const s = snapshotOf(life, 30);
  const h = life.history.at(-1)!;
  assert.equal(s.you, h.you);
  assert.equal(s.held, h.held);
  assert.equal(s.autopilot, h.autopilot);
  assert.ok(s.held > 0);
});

test("with no server the recorder stays off and the game is unaffected", async () => {
  const fetchFn = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const life = newLife();
  const rec = new RunRecorder({ life, seed: 5, fetchFn, log: () => {} });
  assert.equal(await rec.begin(), false);
  life.onDay(1, dateOf(1));
  await rec.tick(true);
  assert.equal(rec.enabled, false);
});
