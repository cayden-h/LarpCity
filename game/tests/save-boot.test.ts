// Boot decisions: which path the city takes from the /me outcome and the URL,
// retrying /me on a transient failure, and where a resumed game is placed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/net/api.ts";
import { bootPath, fetchMe, offlineNotice, resumePlace, type MeOutcome } from "../src/sim/save/boot.ts";
import type { Me } from "../src/sim/save/client.ts";

const profile = { displayName: null, job: "Nurse", salary: 60000, rent: 1200, debt: 0, savings: 0, state: "TX", source: "typed" as const };
const save = { runId: "r", seed: 1, version: 1, gameDay: 3, state: {}, rev: 2, updatedAt: "" };
const ok = (p: Me["profile"], s: Me["save"]): MeOutcome => ({ ok: true, me: { player: { id: "p", name: null }, profile: p, save: s } });

test("a failed /me never starts the intake or a saved life: it goes offline", () => {
  assert.equal(bootPath({ ok: false }, { intake: false }), "offline");
  assert.equal(bootPath({ ok: false }, { intake: true }), "offline");
});

test("a save resumes; a profile without one builds the life; nothing asks the intake", () => {
  assert.equal(bootPath(ok(profile, save), { intake: false }), "resume");
  assert.equal(bootPath(ok(profile, null), { intake: false }), "fromProfile");
  assert.equal(bootPath(ok(null, null), { intake: false }), "intake");
});

test("?intake=1 starts a new life over a save or a profile", () => {
  assert.equal(bootPath(ok(profile, save), { intake: true }), "intake");
  assert.equal(bootPath(ok(profile, null), { intake: true }), "intake");
});

const noSleep = async () => undefined;
const me: Me = { player: { id: "p", name: null }, profile: null, save: null };

test("fetchMe retries network failures and 5xx, then succeeds", async () => {
  let calls = 0;
  const r = await fetchMe(async () => {
    calls++;
    if (calls === 1) throw new TypeError("network down");
    if (calls === 2) throw new ApiError(503, "busy");
    return me;
  }, { tries: 3, delayMs: 0, sleep: noSleep });
  assert.deepEqual(r, { ok: true, me });
  assert.equal(calls, 3);
});

test("fetchMe retries a rate limit (429) instead of booting offline", async () => {
  let calls = 0;
  const r = await fetchMe(async () => {
    calls++;
    if (calls === 1) throw new ApiError(429, "slow down");
    return me;
  }, { tries: 3, delayMs: 0, sleep: noSleep });
  assert.deepEqual(r, { ok: true, me });
  assert.equal(calls, 2);
});

test("fetchMe gives up after its tries", async () => {
  let calls = 0;
  const r = await fetchMe(async () => {
    calls++;
    throw new ApiError(500, "down");
  }, { tries: 3, delayMs: 0, sleep: noSleep });
  assert.deepEqual(r, { ok: false, status: 500 });
  assert.equal(calls, 3);
});

test("fetchMe that never reaches the server has no status", async () => {
  const r = await fetchMe(async () => {
    throw new TypeError("network down");
  }, { tries: 2, delayMs: 0, sleep: noSleep });
  assert.deepEqual(r, { ok: false });
});

test("fetchMe doesn't retry a 4xx answer, but it is still a failure, with its status", async () => {
  let calls = 0;
  const r = await fetchMe(async () => {
    calls++;
    throw new ApiError(401, "who");
  }, { tries: 3, delayMs: 0, sleep: noSleep });
  assert.deepEqual(r, { ok: false, status: 401 });
  assert.equal(calls, 1);
});

test("the boot notice tells a refused save (4xx) from a server it can't reach", () => {
  for (const status of [401, 403, 404]) {
    const n = offlineNotice({ ok: false, status });
    assert.equal(n.title, "Larp City couldn't open your save");
    assert.match(n.body, new RegExp(String(status)));
  }
  assert.equal(offlineNotice({ ok: false }).title, "Can't reach Larp City's server");
  assert.equal(offlineNotice({ ok: false, status: 503 }).title, "Can't reach Larp City's server");
});

const TX = { abbr: "TX", cityId: "houston" };
const CA = { abbr: "CA", cityId: "sf" };
const STATES = [TX, CA];
const pins: Record<string, { abbr: string; cityId: string }> = { dallas: { abbr: "TX", cityId: "dallas" }, sf: CA };
const lookup = (h: string) => STATES.find((s) => s.abbr === h.toUpperCase()) ?? pins[h.toLowerCase()];

test("a resumed game stays in its saved state; the hash only picks a city inside it", () => {
  assert.deepEqual(resumePlace("TX", "dallas", STATES, lookup), { home: TX, city: pins.dallas });
  assert.deepEqual(resumePlace("TX", "TX", STATES, lookup), { home: TX, city: TX });
  // A hash in another state, or none at all, falls back to the state itself.
  assert.deepEqual(resumePlace("TX", "CA", STATES, lookup), { home: TX, city: TX });
  assert.deepEqual(resumePlace("TX", "sf", STATES, lookup), { home: TX, city: TX });
  assert.deepEqual(resumePlace("TX", "", STATES, lookup), { home: TX, city: TX });
  assert.deepEqual(resumePlace("TX", "nowhere", STATES, lookup), { home: TX, city: TX });
});

test("a saved state that doesn't exist has no place", () => {
  assert.equal(resumePlace("ZZ", "TX", STATES, lookup), null);
  assert.equal(resumePlace(undefined, "TX", STATES, lookup), null);
});
