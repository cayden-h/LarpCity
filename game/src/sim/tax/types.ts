// Shared shapes for the tax module (game/src/sim/tax/): a bracket-based
// progressive tax function used by both federal.ts and state.ts, and the
// TaxReturn record the annual filing produces. Single-filer only for now —
// the sim models no marital status or dependents anywhere yet (see
// docs/superpowers/specs/2026-09-12-tax-filing-design.md).

export type FilingStatus = "single";

/** One bracket: income up to `upTo` (exclusive of the bracket below it) is taxed at `rate`. The last bracket's `upTo` is Infinity. */
export interface Bracket {
  upTo: number;
  rate: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Marginal-bracket tax on `income`; each slice is taxed at its own bracket's rate. */
export function progressiveTax(income: number, brackets: Bracket[]): number {
  if (income <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = Math.min(income, b.upTo);
    if (upper > lower) tax += (upper - lower) * b.rate;
    lower = b.upTo;
    if (income <= b.upTo) break;
  }
  return round2(tax);
}

export interface TaxReturn {
  year: number;
  filingStatus: FilingStatus;
  state: string;
  wages: number;
  federalStandardDeduction: number;
  federalTaxableIncome: number;
  federalTax: number;
  /** Childless Earned Income Tax Credit only; 0 above the income limit. */
  eic: number;
  federalWithheld: number;
  /** Positive is a refund, negative is owed. */
  federalRefundOrOwed: number;
  stateTax: number;
  stateWithheld: number;
  stateRefundOrOwed: number;
  /** Game day the player filed, or null while still pending. */
  filedDay: number | null;
}
