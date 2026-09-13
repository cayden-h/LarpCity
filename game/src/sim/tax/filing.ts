// Once-a-year reconciliation: the year's real recorded wages and withholding
// (accumulated paycheck by paycheck in PlayerLife) become a TaxReturn. Every
// field traces back to a real recorded paycheck event — nothing here is
// invented (the same "facts only" rule as server/src/ai/facts.ts).
import { FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, childlessEic, federalTax } from "./federal.ts";
import { stateTax } from "./state.ts";
import type { TaxReturn } from "./types.ts";

const round2 = (x: number) => Math.round(x * 100) / 100;

export function fileReturn(o: { year: number; state: string; wagesYtd: number; federalWithheldYtd: number; stateWithheldYtd: number }): TaxReturn {
  const federalStandardDeduction = FEDERAL_STANDARD_DEDUCTION_SINGLE_2026;
  const federalTaxableIncome = round2(Math.max(0, o.wagesYtd - federalStandardDeduction));
  const federalTax_ = federalTax(federalTaxableIncome);
  const eic = childlessEic(o.wagesYtd);
  const stateTax_ = stateTax(o.state, federalTaxableIncome);
  return {
    year: o.year,
    filingStatus: "single",
    state: o.state,
    wages: round2(o.wagesYtd),
    federalStandardDeduction,
    federalTaxableIncome,
    federalTax: federalTax_,
    eic,
    federalWithheld: round2(o.federalWithheldYtd),
    federalRefundOrOwed: round2(o.federalWithheldYtd + eic - federalTax_),
    stateTax: stateTax_,
    stateWithheld: round2(o.stateWithheldYtd),
    stateRefundOrOwed: round2(o.stateWithheldYtd - stateTax_),
    filedDay: null,
  };
}
