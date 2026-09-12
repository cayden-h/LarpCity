// Payment formulas shared by the daily engine, the previews, and the ghost lines.

import { CARD_MIN_FLOOR, CARD_MIN_PRINCIPAL_RATE } from "./rates.ts";

/** Fixed monthly payment that pays off `principal` in `months` at `aprAnnual`. */
export function monthlyPayment(principal: number, aprAnnual: number, months: number): number {
  if (months <= 0) return principal;
  const r = aprAnnual / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

/**
 * Card minimum: the greater of $25 or 1% of the principal plus this cycle's
 * interest, capped at what is owed. `principal` excludes `cycleInterest`.
 */
export function cardMinimum(principal: number, cycleInterest: number): number {
  const owed = principal + cycleInterest;
  if (owed <= 0) return 0;
  return Math.min(owed, Math.max(CARD_MIN_FLOOR, CARD_MIN_PRINCIPAL_RATE * principal + cycleInterest));
}

/**
 * Repayment Assistance Plan (from July 1, 2026): 1% of AGI for $10,001-20,000,
 * one more point per $10,000 up to 10% above $100,000, minus $50 per
 * dependent, minimum $10 a month.
 */
export function rapMonthlyPayment(agi: number, dependents = 0): number {
  if (agi <= 10_000) return 10;
  const pct = Math.min(10, Math.ceil((agi - 10_000) / 10_000));
  return Math.max(10, (agi * pct) / 100 / 12 - 50 * dependents);
}

/** Standard plan term for new borrowers: 10 to 25 years by balance. */
export function standardTermMonths(balance: number): number {
  if (balance < 25_000) return 120;
  if (balance < 50_000) return 180;
  if (balance < 100_000) return 240;
  return 300;
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
