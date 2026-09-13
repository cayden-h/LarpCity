// SaveManager tests: debounced writes, the rev chain, conflicts, offline
// retries, the keepalive size limit, and the no-retry "failed" statuses.
// Timers are driven by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/net/api.ts";
import { KEEPALIVE_MAX, RUN_WAIT_MS, RUN_WAIT_TRIES, SaveManager, type SaveStatus } from "../src/sim/save/manager.ts";
import type { Me, SaveApi, SavePut } from "../src/sim/save/client.ts";
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

function fakeApi(o: { fail?: () => number | null; me?: () => Me } = {}) {
  const puts: SavePut[] = [];
  const keepalive: string[] = [];
  let rev = 0;
  const api: SaveApi = {
    me: async () => o.me?.() ?? { player: { id: "p", name: null }, profile: null, save: null },
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
    putSaveKeepalive: (json) => void keepalive.push(json),
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

test("with no run ever to save under, it reports offline after its checks, and sends nothing", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  const m = new SaveManager({ api, build: () => game(1), runId: () => null, baseRev: null, timers: t.timers });
  await m.flush();
  for (let i = 0; i < RUN_WAIT_TRIES; i++) {
    assert.notEqual(m.status, "offline");
    t.run();
    await settle();
  }
  assert.equal(m.status, "offline");
  assert.equal(puts.length, 0);
});

test("a save requested while the run is forking (no runId yet) retries and lands on the new run", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  let runId: string | null = null;
  const m = new SaveManager({ api, build: () => game(4), runId: () => runId, baseRev: null, timers: t.timers });
  m.request();
  t.run();
  await settle();
  assert.notEqual(m.status, "offline");
  assert.equal(puts.length, 0);
  assert.equal(t.pending.size, 1, "a retry is scheduled instead of dropping the save");
  runId = "forked";
  t.run();
  await settle();
  assert.equal(m.status, "saved");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].runId, "forked");
  assert.equal(puts[0].gameDay, 4);
});

test("a manager that is off never writes, not even on the way out", async () => {
  const t = fakeTimers();
  const { api, puts, keepalive } = fakeApi();
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers, off: true });
  assert.equal(m.status, "offline");
  m.request();
  await m.flush();
  m.flushOnUnload();
  assert.equal(t.pending.size, 0);
  assert.equal(puts.length, 0);
  assert.equal(keepalive.length, 0);
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

test("a 400 fails for good, with no retry scheduled", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi({ fail: () => 400 });
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "failed");
  assert.equal(puts.length, 0);
  assert.equal(t.pending.size, 0);
});

test("a 403 fails for good, with no retry scheduled", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi({ fail: () => 403 });
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "failed");
  assert.equal(puts.length, 0);
  assert.equal(t.pending.size, 0);
});

test("a lost response that actually committed is not a permanent conflict: /me confirms it and the next write lands", async () => {
  const t = fakeTimers();
  let sent = 0;
  let stored: { runId: string; rev: number; state: unknown } | null = null;
  const api: SaveApi = {
    me: async () => ({
      player: { id: "p", name: null },
      profile: null,
      save: stored ? { runId: stored.runId, seed: 1, version: 1, gameDay: 1, state: stored.state, rev: stored.rev, updatedAt: "" } : null,
    }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: async (b) => {
      sent++;
      if (sent === 1) {
        // The server commits the write, but the response never makes it back.
        stored = { runId: b.runId, rev: 1, state: b.state };
        throw new TypeError("network down");
      }
      if (b.baseRev !== (stored?.rev ?? null)) throw new ApiError(409, "conflict");
      stored = { runId: b.runId, rev: (stored?.rev ?? 0) + 1, state: b.state };
      return { rev: stored.rev };
    },
    putSaveKeepalive: () => undefined,
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run(); // write #1: commits server-side, but the manager sees a network failure
  await settle();
  assert.equal(m.status, "offline");
  t.run(); // the retry: still thinks baseRev is null, so the server answers 409
  await settle();
  // The manager should have asked /me, matched the remembered state, and adopted rev 1,
  // then scheduled another write rather than declaring a conflict.
  assert.notEqual(m.status as SaveStatus, "conflict");
  t.run(); // the scheduled write, now with the correct baseRev
  await settle();
  assert.equal(m.status, "saved");
  assert.equal(sent, 3);
});

test("a lost response whose state doesn't match what the server has is a real conflict", async () => {
  const t = fakeTimers();
  let sent = 0;
  const api: SaveApi = {
    me: async () => ({
      player: { id: "p", name: null },
      profile: null,
      save: { runId: "run", seed: 1, version: 1, gameDay: 1, state: game(999), rev: 9, updatedAt: "" },
    }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: async () => {
      sent++;
      if (sent === 1) throw new TypeError("network down");
      throw new ApiError(409, "conflict");
    },
    putSaveKeepalive: () => undefined,
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "offline");
  t.run();
  await settle();
  assert.equal(m.status, "conflict");
});

test("if /me itself fails while resolving an uncertain write, stay offline and retry rather than guess conflict", async () => {
  const t = fakeTimers();
  let sent = 0;
  let meFails = true;
  let stored: { runId: string; rev: number; state: unknown } | null = null;
  const api: SaveApi = {
    me: async () => {
      if (meFails) throw new TypeError("network down");
      return {
        player: { id: "p", name: null },
        profile: null,
        save: stored ? { runId: stored.runId, seed: 1, version: 1, gameDay: 1, state: stored.state, rev: stored.rev, updatedAt: "" } : null,
      };
    },
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: async (b) => {
      sent++;
      if (sent === 1) {
        // Commits server-side, but the response is lost.
        stored = { runId: b.runId, rev: 1, state: b.state };
        throw new TypeError("network down");
      }
      if (b.baseRev !== (stored?.rev ?? null)) throw new ApiError(409, "conflict");
      stored = { runId: b.runId, rev: (stored?.rev ?? 0) + 1, state: b.state };
      return { rev: stored.rev };
    },
    putSaveKeepalive: () => undefined,
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run(); // write #1: commits server-side, response lost
  await settle();
  t.run(); // the retry: still thinks baseRev is null -> 409, and /me is down too
  await settle();
  assert.equal(m.status, "offline");
  assert.equal(t.pending.size, 1, "a retry is scheduled instead of declaring conflict");
  meFails = false;
  t.run(); // another 409, but /me now confirms the earlier commit and a write gets scheduled
  await settle();
  t.run(); // that scheduled write, now with the adopted rev
  await settle();
  assert.equal(m.status, "saved");
});

test("while offline with a retry pending, request() keeps its backoff delay instead of resetting to the debounce", async () => {
  const t = fakeTimers();
  const { api } = fakeApi({ fail: () => 0 });
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "offline");
  assert.equal(t.pending.size, 1);
  const before = [...t.pending.values()][0].ms;
  assert.equal(before, 2_000);
  m.request();
  m.request();
  assert.equal(t.pending.size, 1);
  assert.equal([...t.pending.values()][0].ms, before);
});

test("a timer firing while a write is in flight waits for it, then reuses the rev it returned", async () => {
  const t = fakeTimers();
  let resolvePut: ((v: { rev: number }) => void) | null = null;
  const puts: SavePut[] = [];
  const api: SaveApi = {
    me: async () => ({ player: { id: "p", name: null }, profile: null, save: null }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: (b) => {
      puts.push(b);
      return new Promise((res) => (resolvePut = res));
    },
    putSaveKeepalive: () => undefined,
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run(); // write #1 starts and hangs mid-flight
  m.request(); // a second change arrives while it's in flight
  t.run(); // the debounce timer for the second change fires
  assert.equal(puts.length, 1, "the second write waits for the first instead of racing it");
  resolvePut!({ rev: 7 });
  await settle();
  assert.equal(puts.length, 2);
  assert.equal(puts[1].baseRev, 7, "the second write carries the rev the first one returned");
});

test("flush() doesn't recurse into another write right after one fails offline", async () => {
  const t = fakeTimers();
  let calls = 0;
  const api: SaveApi = {
    me: async () => ({ player: { id: "p", name: null }, profile: null, save: null }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: async () => {
      calls++;
      throw new TypeError("down");
    },
    putSaveKeepalive: () => undefined,
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  const p1 = m.flush();
  const p2 = m.flush(); // piles onto the in-flight write, setting `again`
  await Promise.all([p1, p2]);
  assert.equal(calls, 1, "did not immediately retry after failing offline");
  assert.equal(m.status, "offline");
  assert.equal(t.pending.size, 1, "the scheduled retry stands instead");
});

test("visibilitychange's flush and pagehide's keepalive don't both fire for the same write", async () => {
  const t = fakeTimers();
  let resolvePut: ((v: { rev: number }) => void) | null = null;
  const keepalive: string[] = [];
  const api: SaveApi = {
    me: async () => ({ player: { id: "p", name: null }, profile: null, save: null }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: () => new Promise((res) => (resolvePut = res)),
    putSaveKeepalive: (json) => void keepalive.push(json),
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run(); // simulates visibilitychange -> flush(), now in flight
  m.flushOnUnload(); // pagehide, moments later, same write still in flight
  assert.equal(keepalive.length, 0, "flushOnUnload defers to the in-flight write");
  resolvePut!({ rev: 1 });
  await settle();
  assert.equal(m.status, "saved");
  m.flushOnUnload(); // nothing changed since that save landed
  assert.equal(keepalive.length, 0);
});

test("a stopped manager sends nothing, even on unload", async () => {
  const t = fakeTimers();
  const { api, puts, keepalive } = fakeApi();
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  m.stop();
  assert.equal(t.pending.size, 0);
  m.request();
  await m.flush();
  m.flushOnUnload();
  assert.equal(puts.length + keepalive.length, 0);
});

test("a rewind's fork gap is not offline: a saved game checks for the new run every second, without backing off", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  const statuses: SaveStatus[] = [];
  let runId: string | null = "run";
  const m = new SaveManager({ api, build: () => game(1), runId: () => runId, baseRev: null, timers: t.timers, onStatus: (s) => statuses.push(s) });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "saved");
  runId = null; // the rewind is forking the run
  m.request();
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(t.run(), [i === 0 ? 1000 : RUN_WAIT_MS]);
    await settle();
  }
  runId = "forked";
  t.run();
  await settle();
  assert.ok(!statuses.includes("offline"), `statuses were ${statuses.join(", ")}`);
  assert.equal(m.status, "saved");
  assert.equal(puts.at(-1)!.runId, "forked");
});

test("stop() resolves once the write in flight answers, and its 409 raises no conflict", async () => {
  const t = fakeTimers();
  let fail: (e: Error) => void = () => undefined;
  const statuses: SaveStatus[] = [];
  const api: SaveApi = {
    me: async () => ({ player: { id: "p", name: null }, profile: null, save: null }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: () => new Promise((_, rej) => (fail = rej)),
    putSaveKeepalive: () => undefined,
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: 3, timers: t.timers, onStatus: (s) => statuses.push(s) });
  m.request();
  t.run(); // the write is in flight
  let stopped = false;
  const done = m.stop().then(() => (stopped = true));
  await settle();
  assert.equal(stopped, false, "stop() waits for the write in flight");
  fail(new ApiError(409, "conflict")); // it lands against the save being erased
  await done;
  assert.equal(stopped, true);
  assert.ok(!statuses.includes("conflict"));
  assert.notEqual(m.status, "conflict");
  assert.equal(t.pending.size, 0);
});

test("stop() while an uncertain write's /me check is pending wins: no conflict, and resume() writes again", async () => {
  const t = fakeTimers();
  let sent = 0;
  let resolveMe: ((v: Me) => void) | null = null;
  // A state that differs from what this write sent (game(1)), so the /me check finds a mismatch.
  const stored: { runId: string; rev: number; state: unknown } = { runId: "run", rev: 1, state: game(2) };
  const api: SaveApi = {
    me: () => new Promise((res) => (resolveMe = res)),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: async (b) => {
      sent++;
      if (sent === 1) {
        // Commits server-side, but the response is lost, leaving the write "uncertain".
        throw new TypeError("network down");
      }
      // The retry, still carrying the old baseRev, gets a 409 and triggers resolveUncertain().
      throw new ApiError(409, "conflict");
    },
    putSaveKeepalive: () => undefined,
  };
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run(); // write #1: network failure, marks uncertain
  await settle();
  t.run(); // the retry: 409, kicks off resolveUncertain() -> me() (pending)
  await settle();
  assert.notEqual(m.status, "conflict", "still waiting on /me");
  m.stop();
  // /me resolves after stop(), reporting a different stored state than what this write sent.
  resolveMe!({ player: { id: "p", name: null }, profile: null, save: { runId: stored.runId, seed: 1, version: 1, gameDay: 1, state: stored.state, rev: stored.rev, updatedAt: "" } });
  await settle();
  assert.notEqual(m.status, "conflict");
  m.resume();
  assert.equal(t.pending.size, 1, "resume() schedules a write instead of being a no-op");
  t.run();
  await settle();
  assert.equal(sent, 3, "resume() actually wrote again");
});

test("resume() after a stop whose erase failed saves the change that was waiting", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  const m = new SaveManager({ api, build: () => game(2), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  await m.stop();
  assert.equal(t.pending.size, 0);
  m.resume();
  assert.deepEqual(t.run(), [1000]);
  await settle();
  assert.equal(puts.length, 1);
  assert.equal(m.status, "saved");
  m.request();
  assert.equal(t.pending.size, 1, "requests work again");
});
