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

import { FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, childlessEic, federalTax, fica } from "../src/sim/tax/federal.ts";

test("federalTax matches the 2026 single-filer brackets at bracket edges (research/02)", () => {
  assert.equal(federalTax(0), 0);
  assert.equal(federalTax(12_400), 1_240); // 10% bracket exactly
  assert.equal(federalTax(50_400), 1_240 + (50_400 - 12_400) * 0.12);
});

test("FEDERAL_STANDARD_DEDUCTION_SINGLE_2026 is the 2026 single filer amount", () => {
  assert.equal(FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, 16_100);
});

test("fica charges 6.2% SS + 1.45% Medicare below the wage base", () => {
  const tax = fica(0, 10_000);
  assert.equal(tax, Math.round(10_000 * (0.062 + 0.0145) * 100) / 100);
});

test("fica stops charging Social Security once YTD wages cross the wage base", () => {
  const tax = fica(184_500, 10_000); // already at the 2026 wage base
  assert.equal(tax, Math.round(10_000 * 0.0145 * 100) / 100); // Medicare only, no SS
});

test("fica charges the additional 0.9% Medicare only above $200,000 YTD", () => {
  const tax = fica(195_000, 10_000); // crosses $200k mid-period
  const medicare = 10_000 * 0.0145;
  const additional = 5_000 * 0.009; // only the $5,000 over $200k
  assert.equal(tax, Math.round((medicare + additional) * 100) / 100);
});

test("childlessEic is 0 at zero income, positive mid-range, 0 at/above the income limit", () => {
  assert.equal(childlessEic(0), 0);
  assert.ok(childlessEic(8_000) > 0);
  assert.equal(childlessEic(19_540), 0);
  assert.equal(childlessEic(30_000), 0);
});

test("childlessEic never exceeds the 2026 maximum of $664", () => {
  for (const income of [1_000, 5_000, 8_490, 12_000, 19_000]) assert.ok(childlessEic(income) <= 664);
});

import { STATE_TAX } from "../src/data/state-tax.ts";
import { STATES } from "../src/data/states.ts";

test("STATE_TAX has exactly one entry per state in STATES (51 with DC)", () => {
  assert.equal(Object.keys(STATE_TAX).length, STATES.length);
  for (const s of STATES) assert.ok(STATE_TAX[s.abbr], `missing state tax entry for ${s.abbr}`);
});

test("the 9 no-wage-income-tax states are typed none (research/02)", () => {
  for (const abbr of ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]) {
    assert.equal(STATE_TAX[abbr].type, "none", `${abbr} should be none`);
  }
});

test("a flat state (e.g. OH, 2026 flat 2.75% per research/02) has a single positive rate", () => {
  const oh = STATE_TAX.OH;
  assert.equal(oh.type, "flat");
  if (oh.type === "flat") assert.equal(oh.rate, 0.0275);
});

test("a graduated state (e.g. CA) has ascending bracket upTo values ending in Infinity", () => {
  const ca = STATE_TAX.CA;
  assert.equal(ca.type, "graduated");
  if (ca.type === "graduated") {
    assert.ok(ca.brackets.length > 1);
    assert.equal(ca.brackets[ca.brackets.length - 1].upTo, Infinity);
    for (let i = 1; i < ca.brackets.length; i++) assert.ok(ca.brackets[i].upTo > ca.brackets[i - 1].upTo);
  }
});
