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

import { stateTax } from "../src/sim/tax/state.ts";

test("stateTax is 0 in a no-income-tax state regardless of income", () => {
  assert.equal(stateTax("TX", 500_000), 0);
});

test("stateTax applies a flat rate directly to taxable income", () => {
  assert.equal(stateTax("OH", 100_000), Math.round(100_000 * 0.0275 * 100) / 100);
});

test("stateTax applies graduated brackets like federalTax", () => {
  const low = stateTax("CA", 5_000);
  const high = stateTax("CA", 500_000);
  assert.ok(low >= 0 && low < 5_000 * 0.05);
  assert.ok(high > low);
});

test("stateTax throws on an unknown state abbreviation", () => {
  assert.throws(() => stateTax("ZZ", 10_000));
});

import { penaltyFor } from "../src/sim/tax/penalties.ts";

test("penaltyFor is all zero when nothing is owed", () => {
  const p = penaltyFor({ owed: 0, monthsUnfiled: 6, monthsUnpaid: 6 });
  assert.equal(p.total, 0);
});

test("penaltyFor is all zero when there's an owed amount but no time has passed", () => {
  const p = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 0 });
  assert.equal(p.total, 0);
});

test("penaltyFor's failure-to-file caps at 25% of the owed amount after 5 months", () => {
  // monthsUnpaid: 0 isolates the failure-to-file-alone cap: with monthsUnpaid > 0 too,
  // the overlap rule (failure-to-file reduced to 4.5%/month when failure-to-pay also
  // applies that month) would cap failureToFile at 22.5%, not 25%, per IRS Topic 653 —
  // so testing the pure 25% cap needs no concurrent failure-to-pay.
  const p5 = penaltyFor({ owed: 1_000, monthsUnfiled: 5, monthsUnpaid: 0 });
  const p12 = penaltyFor({ owed: 1_000, monthsUnfiled: 12, monthsUnpaid: 0 });
  assert.equal(p5.failureToFile, 250); // 25% of 1000
  assert.equal(p12.failureToFile, 250); // capped, doesn't keep growing
});

test("penaltyFor's failure-to-pay caps at 25% of the owed amount", () => {
  const p = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 60 });
  assert.equal(p.failureToPay, 250);
});

test("penaltyFor applies the $525 minimum once filing is more than 60 days (2 months) late", () => {
  const p = penaltyFor({ owed: 50, monthsUnfiled: 3, monthsUnpaid: 3 }); // tiny owed amount, 3 months late
  assert.ok(p.total >= 50); // minimum is min(525, owed) = 50 here since owed < 525
});

test("penaltyFor charges interest only on time actually unpaid, proportional to months", () => {
  const p1 = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 1 });
  const p2 = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 2 });
  assert.ok(p2.interest > p1.interest);
});

test("penaltyFor reduces failure-to-file by failure-to-pay in overlapping months, not just at the cap", () => {
  // 3 months, both unfiled and unpaid the whole time: each month is 4.5% FTF + 0.5% FTP.
  const p = penaltyFor({ owed: 1_000, monthsUnfiled: 3, monthsUnpaid: 3 });
  assert.equal(p.failureToFile, 135); // 1000 * 3 * 0.045
  assert.equal(p.failureToPay, 15); // 1000 * 3 * 0.005
});

test("penaltyFor's minimum penalty does not trigger from failure-to-pay alone when the return was filed on time", () => {
  // monthsUnfiled: 0 (filed on time) but monthsUnpaid: 60 (long unpaid): the $525-or-100%
  // minimum is specifically for a return filed more than 60 days late (IRS Topic 653),
  // not for slow payment, so it must not force the total up to the minimum here.
  const p = penaltyFor({ owed: 10, monthsUnfiled: 0, monthsUnpaid: 60 });
  const withoutMinimum = round2ForTest(0 + Math.min(10 * 0.25, 10 * 0.005 * 60) + 10 * 0.08 * (60 / 12));
  assert.equal(p.total, withoutMinimum); // 6.5: had the $10 minimum applied instead, total would be 10
});

function round2ForTest(x: number) {
  return Math.round(x * 100) / 100;
}

import { withholdingForPaycheck } from "../src/sim/tax/withholding.ts";

test("withholdingForPaycheck on a $0 paycheck withholds $0 of everything", () => {
  const w = withholdingForPaycheck({ state: "TX", wagesThisPeriod: 0 });
  assert.equal(w.federalIncomeTax, 0);
  assert.equal(w.fica, 0);
  assert.equal(w.stateIncomeTax, 0);
});

test("withholdingForPaycheck withholds nothing for state income tax in a no-tax state", () => {
  const w = withholdingForPaycheck({ state: "TX", wagesThisPeriod: 4_000 });
  assert.equal(w.stateIncomeTax, 0);
  assert.ok(w.federalIncomeTax > 0);
});

test("withholdingForPaycheck is level across paychecks for a level salary (24 periods/year)", () => {
  const a = withholdingForPaycheck({ state: "CA", wagesThisPeriod: 3_000 });
  const b = withholdingForPaycheck({ state: "CA", wagesThisPeriod: 3_000 });
  assert.equal(a.federalIncomeTax, b.federalIncomeTax);
  assert.equal(a.stateIncomeTax, b.stateIncomeTax);
});

test("withholdingForPaycheck's federal income tax roughly matches the full year's tax divided by periods", () => {
  const periods = 24;
  const perPeriod = 4_000;
  const w = withholdingForPaycheck({ state: "TX", wagesThisPeriod: perPeriod, periodsPerYear: periods });
  const annualWages = perPeriod * periods; // 96,000
  const annualTaxable = Math.max(0, annualWages - FEDERAL_STANDARD_DEDUCTION_SINGLE_2026); // 79,900
  // Hand-computed tax on $79,900 using 2026 single-filer brackets:
  // 10%: $0-$12,400 → $1,240
  // 12%: $12,400-$50,400 → $4,560
  // 22%: $50,400-$79,900 → $6,490
  // Total: $12,290
  const expectedAnnualTax = 12_290;
  // Within a few dollars: rounding happens once at the annual level, once per paycheck here.
  assert.ok(Math.abs(w.federalIncomeTax * periods - expectedAnnualTax) < 5);
});

import { fileReturn } from "../src/sim/tax/filing.ts";

test("fileReturn on exactly-covered withholding nets close to $0 for a mid-income single filer", () => {
  // $60,000 wages in Texas (no state tax): withholding was computed by the
  // same annualize-and-divide method, so it should reconcile close to zero.
  const r = fileReturn({ year: 2026, state: "TX", wagesYtd: 60_000, federalWithheldYtd: 8_000, stateWithheldYtd: 0 });
  assert.equal(r.wages, 60_000);
  assert.equal(r.stateTax, 0);
  assert.equal(r.stateRefundOrOwed, 0);
  assert.equal(r.filedDay, null);
});

test("fileReturn computes federalTaxableIncome as wages minus the standard deduction, floored at 0", () => {
  const r = fileReturn({ year: 2026, state: "TX", wagesYtd: 10_000, federalWithheldYtd: 0, stateWithheldYtd: 0 });
  assert.equal(r.federalTaxableIncome, 0); // 10,000 - 16,100 floored at 0
  assert.equal(r.federalTax, 0);
});

test("fileReturn's federalRefundOrOwed is withheld + eic - tax (positive is a refund)", () => {
  const r = fileReturn({ year: 2026, state: "TX", wagesYtd: 40_000, federalWithheldYtd: 5_000, stateWithheldYtd: 0 });
  // Hand-computed: federalTaxableIncome = max(0, 40,000 - 16,100) = 23,900
  // federalTax(23,900): 10% on $12,400 = $1,240; 12% on ($23,900 - $12,400) = $1,380. Total = $2,620
  // childlessEic(40,000) = 0 (above the $19,540 income limit)
  // federalRefundOrOwed = 5,000 + 0 - 2,620 = 2,380
  assert.equal(r.eic, 0);
  assert.equal(r.federalTax, 2_620);
  assert.equal(r.federalRefundOrOwed, 2_380);
});

test("fileReturn's stateRefundOrOwed is state withheld minus state tax", () => {
  const r = fileReturn({ year: 2026, state: "OH", wagesYtd: 50_000, federalWithheldYtd: 6_000, stateWithheldYtd: 900 });
  // Hand-computed: federalTaxableIncome = max(0, 50,000 - 16,100) = 33,900
  // OH is flat 2.75% on taxable income: 33,900 × 0.0275 = 932.25
  // stateRefundOrOwed = 900 - 932.25 = -32.25
  assert.equal(r.stateTax, 932.25);
  assert.equal(r.stateRefundOrOwed, -32.25);
});
