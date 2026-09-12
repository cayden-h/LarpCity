import { test } from "node:test";
import assert from "node:assert/strict";
import { progressiveTax, type Bracket } from "../src/sim/tax/types.ts";

const SAMPLE: Bracket[] = [
  { upTo: 10_000, rate: 0.1 },
  { upTo: 40_000, rate: 0.2 },
  { upTo: Infinity, rate: 0.3 },
];

test("progressiveTax taxes each bracket's slice at its own rate", () => {
  assert.equal(progressiveTax(5_000, SAMPLE), 500); // all in the 10% bracket
  assert.equal(progressiveTax(10_000, SAMPLE), 1_000); // exactly the first bracket
  assert.equal(progressiveTax(25_000, SAMPLE), 1_000 + 15_000 * 0.2); // 1000 + 3000 = 4000
  assert.equal(progressiveTax(50_000, SAMPLE), 1_000 + 30_000 * 0.2 + 10_000 * 0.3); // 1000+6000+3000=10000
});

test("progressiveTax never goes negative and treats 0/negative income as 0 tax", () => {
  assert.equal(progressiveTax(0, SAMPLE), 0);
  assert.equal(progressiveTax(-500, SAMPLE), 0);
});
