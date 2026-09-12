// Run recorder tests: daily snapshots match the life, events get stable keys,
// batches wait for the server, and a fast-forward goes out in chunks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, type Place } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { MAX_BATCH, RunRecorder, snapshotOf, type EventEntry, type SnapshotEntry } from "../src/sim/record/index.ts";
import { LifeTimeline } from "../src/sim/rewind/index.ts";

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

test("a resumed recorder keeps its run and never starts a new one", async () => {
  const life = newLife();
  const server = fakeServer();
  const recorder = new RunRecorder({ life, seed: 5, fetchFn: server.fetchFn, runId: "saved-run", log: () => undefined });
  assert.equal(await recorder.begin(), true);
  assert.equal(recorder.runId, "saved-run");
  for (let day = 1; day <= 3; day++) life.onDay(day, dateOf(day));
  await recorder.tick(true);
  assert.ok(!server.calls.some((c) => c.path.endsWith("/runs")));
  assert.ok(server.calls.some((c) => c.path.endsWith("/snapshot")));
});

test("a resumed recorder rewinds by forking from the run it was resumed with", async () => {
  const life = newLife();
  const timeline = new LifeTimeline(life, { start: START });
  const server = fakeServer();
  const recorder = new RunRecorder({ life, seed: 5, fetchFn: server.fetchFn, runId: "saved-run", log: () => undefined });
  await recorder.begin();
  for (let day = 1; day <= 5; day++) life.onDay(day, dateOf(day));
  timeline.rewindTo(2);
  await recorder.rewind(2);
  await recorder.idle();
  assert.ok(server.calls.some((c) => c.path.endsWith("/runs/saved-run/fork")));
});

/** A server that keeps each run apart and can fork one, like server/src/store/runs.ts. */
function branchingServer() {
  const runs = new Map<string, { snaps: Map<number, SnapshotEntry>; events: Map<string, EventEntry> }>();
  let n = 0;
  const newRun = () => {
    const id = `run-${++n}`;
    runs.set(id, { snaps: new Map(), events: new Map() });
    return id;
  };
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input);
    const body = JSON.parse(String(init.body));
    const fork = path.match(/\/runs\/([^/]+)\/fork$/);
    if (fork) {
      const from = runs.get(fork[1])!;
      const id = newRun();
      const to = runs.get(id)!;
      for (const [d, s] of from.snaps) if (d <= body.throughDay) to.snaps.set(d, s);
      for (const [k, e] of from.events) if (e.day <= body.throughDay) to.events.set(k, e);
      return new Response(JSON.stringify({ runId: id }), { status: 201 });
    }
    if (path.endsWith("/runs")) return new Response(JSON.stringify({ runId: newRun() }), { status: 201 });
    const run = runs.get(body.runId);
    if (!run) return new Response("{}", { status: 403 });
    if (path.endsWith("/snapshot")) for (const s of body.entries) run.snaps.set(s.day, s);
    if (path.endsWith("/events")) for (const e of body.events) if (!run.events.has(e.key)) run.events.set(e.key, e);
    return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
  }) as typeof fetch;
  return { fetchFn, runs };
}

const isManualTrade = (e: EventEntry) => e.kind === "trade" && !(e.payload as { recurring: boolean }).recurring;

test("a rewind forks the run: the old branch keeps every day it lived, the new one relives what came after", async () => {
  const life = newLife();
  const timeline = new LifeTimeline(life, { start: START });
  const server = branchingServer();
  const rec = new RunRecorder({ life, seed: 5, fetchFn: server.fetchFn, log: () => {} });
  await rec.begin();
  for (let day = 1; day <= 50; day++) {
    life.onDay(day, dateOf(day));
    if (day === 20) life.buy("LTM", 300); // after day 20's tick, so the rewind undoes it
    await rec.tick();
  }
  timeline.rewindTo(20);
  await rec.rewind(20);
  for (let day = 21; day <= 30; day++) {
    life.onDay(day, dateOf(day));
    await rec.tick();
  }
  await rec.tick(true);
  await rec.idle();

  assert.notEqual(rec.runId, "run-1");
  const old = server.runs.get("run-1")!;
  const branch = server.runs.get(rec.runId!)!;
  assert.equal(Math.max(...old.snaps.keys()), 50);
  assert.ok([...old.events.values()].some(isManualTrade));
  assert.deepEqual([...branch.snaps.keys()].sort((a, b) => a - b), Array.from({ length: 31 }, (_, d) => d));
  assert.ok(![...branch.events.values()].some(isManualTrade));
  assert.ok([...branch.events.values()].every((e) => e.day <= 30));
  assert.deepEqual(branch.snaps.get(30), snapshotOf(life, 30));
  // Day 20's own events are that morning's, keyed from 0 the way they were first sent.
  const day20 = (events: Map<string, EventEntry>) => [...events.values()].filter((e) => e.day === 20 && !isManualTrade(e)).map((e) => [e.key, e.kind]);
  assert.deepEqual(day20(branch.events), day20(old.events));
});

test("with no server a rewind just drops the days after it from what's waiting", async () => {
  const life = newLife();
  const timeline = new LifeTimeline(life, { start: START });
  const rec = new RunRecorder({ life, seed: 5, fetchFn: (async () => new Response("{}", { status: 503 })) as typeof fetch, log: () => {} });
  await rec.begin();
  for (let day = 1; day <= 10; day++) life.onDay(day, dateOf(day));
  timeline.rewindTo(5);
  await rec.rewind(5);
  assert.equal(rec.enabled, false);
  assert.equal(rec.pending.days, 6); // days 0 through 5
});
