// SaveManager tests: debounced writes, the rev chain, conflicts, offline
// retries, the keepalive size limit, and the no-retry "failed" statuses.
// Timers are driven by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/net/api.ts";
import { KEEPALIVE_MAX, SaveManager, type SaveStatus } from "../src/sim/save/manager.ts";
import type { SaveApi, SavePut } from "../src/sim/save/client.ts";
import type { GameSave } from "../src/sim/save/types.ts";

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    timers: { set: (fn: () => void, ms: number) => (pending.set(next, { fn, ms }), next++), clear: (id: number) => void pending.delete(id) },
    pending,
    /** Runs every due timer once. */
    run: () => {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, t] of due) t.fn();
      return due.map(([, t]) => t.ms);
    },
  };
}

const game = (day: number, size = 10): GameSave => ({ version: 1, seed: 1, day, hash: "TX", bankRun: "b", life: { pad: "x".repeat(size) } as never, npcs: {}, mail: { items: [], seq: 0 }, desk: null });

function fakeApi(o: { fail?: () => number | null } = {}) {
  const puts: SavePut[] = [];
  const keepalive: SavePut[] = [];
  let rev = 0;
  const api: SaveApi = {
    me: async () => ({ player: { id: "p", name: null }, profile: null, save: null }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: async (b) => {
      const status = o.fail?.() ?? null;
      if (status === 0) throw new TypeError("network down");
      if (status) throw new ApiError(status, "no");
      puts.push(b);
      if (b.baseRev !== (rev || null)) throw new ApiError(409, "conflict");
      return { rev: ++rev };
    },
    putSaveKeepalive: (b) => void keepalive.push(b),
  };
  return { api, puts, keepalive };
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

test("a burst of requests sends one save, and each save names the last rev", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  let day = 1;
  const m = new SaveManager({ api, build: () => game(day), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  m.request();
  m.request();
  assert.deepEqual(t.run(), [1000]);
  await settle();
  assert.equal(puts.length, 1);
  assert.equal(puts[0].baseRev, null);
  day = 2;
  m.request();
  t.run();
  await settle();
  assert.equal(puts[1].baseRev, 1);
  assert.equal(puts[1].gameDay, 2);
  assert.equal(m.status, "saved");
});

test("a conflict stops saving for good", async () => {
  const t = fakeTimers();
  const { api } = fakeApi();
  const statuses: SaveStatus[] = [];
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: 5, timers: t.timers, onStatus: (s) => statuses.push(s) });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "conflict");
  m.request();
  assert.equal(t.pending.size, 0);
  assert.ok(statuses.includes("conflict"));
});

test("while the server is down it retries with a growing wait, then recovers", async () => {
  const t = fakeTimers();
  let down = true;
  const { api, puts } = fakeApi({ fail: () => (down ? 0 : null) });
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "offline");
  assert.deepEqual(t.run(), [2000]);
  await settle();
  assert.deepEqual(t.run(), [4000]);
  await settle();
  down = false;
  t.run();
  await settle();
  assert.equal(m.status, "saved");
  assert.equal(puts.length, 1);
});

test("with no run to save under, it reports offline and sends nothing", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  const m = new SaveManager({ api, build: () => game(1), runId: () => null, baseRev: null, timers: t.timers });
  await m.flush();
  assert.equal(m.status, "offline");
  assert.equal(puts.length, 0);
});

test("the hide save uses keepalive only when it fits", () => {
  const t = fakeTimers();
  const { api, keepalive } = fakeApi();
  let size = 10;
  const m = new SaveManager({ api, build: () => game(1, size), runId: () => "run", baseRev: null, timers: t.timers });
  m.flushOnUnload();
  assert.equal(keepalive.length, 1);
  size = KEEPALIVE_MAX;
  m.flushOnUnload();
  assert.equal(keepalive.length, 1);
});

test("a 413 (too large) fails for good, with no retry scheduled", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi({ fail: () => 413 });
  const statuses: SaveStatus[] = [];
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers, onStatus: (s) => statuses.push(s) });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "failed");
  assert.equal(puts.length, 0);
  assert.equal(t.pending.size, 0);
  assert.ok(statuses.includes("failed"));
  m.request();
  assert.equal(t.pending.size, 0);
});
