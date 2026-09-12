// server/src/routes/save.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STATE_BYTES, profileBody, saveBody } from "./save.js";

const RUN = "aaaaaaaa-0000-4000-8000-000000000001";
const save = { runId: RUN, seed: 20260912, version: 1, gameDay: 40, state: { life: {} }, baseRev: null };

test("a save body takes a JSON object state and a null or positive base rev", () => {
  assert.equal(saveBody.safeParse(save).success, true);
  assert.equal(saveBody.safeParse({ ...save, baseRev: 3 }).success, true);
  assert.equal(saveBody.safeParse({ ...save, baseRev: 0 }).success, false);
  assert.equal(saveBody.safeParse({ ...save, state: "x" }).success, false);
  assert.equal(saveBody.safeParse({ ...save, runId: "nope" }).success, false);
});

test("a save body over the size cap is refused", () => {
  const big = { blob: "x".repeat(MAX_STATE_BYTES) };
  assert.equal(saveBody.safeParse({ ...save, state: big }).success, false);
});

test("a save body under the character cap but over the byte cap is refused", () => {
  // U+00E9 is one UTF-16 code unit but two UTF-8 bytes, so a naive .length
  // check would pass this state while Buffer.byteLength would not.
  const accented = String.fromCharCode(0xe9);
  const charCount = MAX_STATE_BYTES - 1000;
  const big = { blob: accented.repeat(charCount) };
  assert.equal(JSON.stringify(big).length <= MAX_STATE_BYTES, true);
  assert.equal(saveBody.safeParse({ ...save, state: big }).success, false);
});

test("a profile needs every number unless it was skipped", () => {
  const typed = { job: "Nurse", salary: 72000, rent: 1400, debt: 0, savings: 500, state: "TX", source: "typed" };
  assert.equal(profileBody.safeParse(typed).success, true);
  assert.equal(profileBody.safeParse({ ...typed, salary: null }).success, false);
  assert.equal(profileBody.safeParse({ job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" }).success, true);
  assert.equal(profileBody.safeParse({ ...typed, state: "Texas" }).success, false);
});

test("a profile state must be a real state or DC", () => {
  const typed = { job: "Nurse", salary: 72000, rent: 1400, debt: 0, savings: 500, state: "ZZ", source: "typed" };
  assert.equal(profileBody.safeParse(typed).success, false);
  assert.equal(profileBody.safeParse({ ...typed, state: "DC" }).success, true);
  assert.equal(profileBody.safeParse({ ...typed, state: "TX" }).success, true);
});
