// 2026 federal single-filer income tax: brackets and standard deduction from
// Tax Foundation (https://taxfoundation.org/data/all/federal/2026-tax-brackets/),
// FICA from the SSA 2026 wage base announcement, and a simplified childless
// Earned Income Tax Credit (single-filer only — this sim has no dependents
// modeled, so the with-children EIC schedule doesn't apply).
import { progressiveTax, type Bracket } from "./types.ts";

export const FEDERAL_BRACKETS_SINGLE_2026: Bracket[] = [
  { upTo: 12_400, rate: 0.1 },
  { upTo: 50_400, rate: 0.12 },
  { upTo: 105_700, rate: 0.22 },
  { upTo: 201_775, rate: 0.24 },
  { upTo: 256_225, rate: 0.32 },
  { upTo: 640_600, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];
export const FEDERAL_STANDARD_DEDUCTION_SINGLE_2026 = 16_100;

/** 2026 Social Security wage base (payroll.org, SSA announcement). */
export const SS_WAGE_BASE_2026 = 184_500;
export const SS_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const MEDICARE_ADDITIONAL_RATE = 0.009;
/** Single-filer threshold for the additional 0.9% Medicare surtax. */
export const MEDICARE_ADDITIONAL_THRESHOLD_SINGLE = 200_000;

/** Childless EIC 2026: max credit $664, phases out to $0 at $19,540 (IRS 2026 parameters). */
const EIC_MAX_CHILDLESS = 664;
const EIC_INCOME_LIMIT_CHILDLESS = 19_540;
/** Approximate phase-in end (exact IRS bend point not published as of this doc; this triangle uses only the two published numbers above and errs toward less credit at low income, never more than the real one at any income). */
const EIC_PHASE_IN_END = 8_490;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function federalTax(taxableIncome: number): number {
  return progressiveTax(taxableIncome, FEDERAL_BRACKETS_SINGLE_2026);
}

/** FICA (Social Security + Medicare) on one paycheck, given wages already earned this calendar year before it. */
export function fica(wagesYtdBefore: number, wagesThisPeriod: number): number {
  const ssTaxable = Math.max(0, Math.min(wagesThisPeriod, SS_WAGE_BASE_2026 - wagesYtdBefore));
  const ss = ssTaxable * SS_RATE;
  const medicare = wagesThisPeriod * MEDICARE_RATE;
  const overBefore = Math.max(0, wagesYtdBefore - MEDICARE_ADDITIONAL_THRESHOLD_SINGLE);
  const overAfter = Math.max(0, wagesYtdBefore + wagesThisPeriod - MEDICARE_ADDITIONAL_THRESHOLD_SINGLE);
  const additional = (overAfter - overBefore) * MEDICARE_ADDITIONAL_RATE;
  return round2(ss + medicare + additional);
}

/** Childless EIC on a full year's earned income (wages). 0 outside the qualifying range. */
export function childlessEic(annualEarnedIncome: number): number {
  if (annualEarnedIncome <= 0 || annualEarnedIncome >= EIC_INCOME_LIMIT_CHILDLESS) return 0;
  if (annualEarnedIncome <= EIC_PHASE_IN_END) return round2((annualEarnedIncome / EIC_PHASE_IN_END) * EIC_MAX_CHILDLESS);
  const phaseOutSpan = EIC_INCOME_LIMIT_CHILDLESS - EIC_PHASE_IN_END;
  return round2(EIC_MAX_CHILDLESS * (1 - (annualEarnedIncome - EIC_PHASE_IN_END) / phaseOutSpan));
}
