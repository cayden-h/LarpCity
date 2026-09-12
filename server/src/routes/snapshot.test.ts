// server/src/routes/snapshot.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayToTimestamp, forkBody, snapshotBody } from "./snapshot.js";

test("dayToTimestamp maps day 0 to 2000-01-01", () => {
  assert.equal(dayToTimestamp(0), "2000-01-01T00:00:00.000Z");
});

test("dayToTimestamp maps day 365 to 2001-01-01 (2000 is a leap year)", () => {
  assert.equal(dayToTimestamp(366), "2001-01-01T00:00:00.000Z");
});

const RUN = "aaaaaaaa-0000-4000-8000-000000000001";
const row = { day: 3, netWorth: 1, checking: 1, savings: 1, brokerage: 1, retirement: 0, debt: 0 };

test("snapshot rows may carry the investing lines", () => {
  assert.equal(snapshotBody.safeParse({ runId: RUN, entries: [row] }).success, true);
  const parsed = snapshotBody.parse({ runId: RUN, entries: [{ ...row, you: 5, held: 6, autopilot: 7 }] });
  assert.deepEqual(parsed.entries[0], { ...row, you: 5, held: 6, autopilot: 7 });
});

test("snapshot rows reject non-finite investing lines", () => {
  assert.equal(snapshotBody.safeParse({ runId: RUN, entries: [{ ...row, held: Infinity }] }).success, false);
  assert.equal(snapshotBody.safeParse({ runId: RUN, entries: [{ ...row, you: "5" }] }).success, false);
});

test("a fork names the last day the new branch keeps", () => {
  assert.equal(forkBody.safeParse({ throughDay: 40 }).success, true);
  assert.equal(forkBody.safeParse({ throughDay: 0 }).success, true);
  assert.equal(forkBody.safeParse({ throughDay: -1 }).success, false);
  assert.equal(forkBody.safeParse({ throughDay: 2.5 }).success, false);
  assert.equal(forkBody.safeParse({}).success, false);
});
