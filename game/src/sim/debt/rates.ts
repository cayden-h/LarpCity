// 2026 rates and rules, and how a credit score turns into an APR.
// Sources are listed in research/06-debt-and-credit.md.

import type { DebtKind } from "./types.ts";

/** Real prime rate = Fed funds + 3 points. */
export const PRIME_SPREAD = 0.03;
/** Freddie Mac 30-year average was 6.76% on 2026-09-10 with cash near 4.3%. */
export const MORTGAGE_SPREAD = 0.0246;
/** Reference cash rate the 2026 averages were observed at. */
export const REFERENCE_CASH_RATE = 0.043;

/** Federal Direct undergraduate rate for loans first disbursed 2026-07-01 to 2027-06-30. */
export const STUDENT_UNDERGRAD_APR = 0.0652;
export const CARD_PENALTY_APR = 0.2999;
/** Typical card late fee (CFPB's $8 cap was vacated in April 2025). */
export const CARD_LATE_FEE = 32;
export const INSTALLMENT_LATE_FEE_RATE = 0.05;
export const CARD_MIN_FLOOR = 25;
export const CARD_MIN_PRINCIPAL_RATE = 0.01;
/** CARD Act minimum grace period between statement and due date. */
export const GRACE_DAYS = 25;

export function primeRate(cashRateAnnual: number): number {
  return cashRateAnnual + PRIME_SPREAD;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0 for a deep-subprime score (500), 1 for super prime (781+). */
export function scoreQuality(score: number): number {
  return clamp01((score - 500) / (781 - 500));
}

/** Variable card margin over prime: about 10 points for great credit, 20 for poor. */
export function cardMargin(score: number): number {
  return 0.2 - 0.1 * scoreQuality(score);
}

/** APR offered for a new debt of this kind, given a score and the market's cash rate. */
export function offeredApr(kind: DebtKind, score: number, cashRateAnnual: number): number {
  const q = scoreQuality(score);
  const drift = cashRateAnnual - REFERENCE_CASH_RATE;
  switch (kind) {
    case "credit_card":
      return primeRate(cashRateAnnual) + cardMargin(score);
    case "auto":
      // Bankrate Q2 2026: super prime 4.41%, deep subprime 16.11%.
      return 0.1611 - (0.1611 - 0.0441) * q + drift;
    case "mortgage":
      return cashRateAnnual + MORTGAGE_SPREAD + 0.015 * (1 - q);
    case "personal":
      return 0.08 + 0.2 * (1 - q) + drift;
    case "student_federal":
      return STUDENT_UNDERGRAD_APR;
    case "bnpl":
    case "medical":
      return 0;
    case "payday":
      // $15 per $100 for two weeks.
      return 0.15 * 26;
  }
}

/** Minimum score most lenders approve for each kind (secured cards always approve). */
export const APPROVAL_FLOOR: Record<DebtKind, number> = {
  credit_card: 580,
  auto: 500,
  mortgage: 620,
  personal: 600,
  student_federal: 0,
  bnpl: 0,
  payday: 0,
  medical: 0,
};
