// Per-paycheck withholding via the "annualize and divide" method: treat this
// paycheck as if it repeated all year, tax that annual figure, divide back
// down. Real payroll withholding uses the same method (IRS Pub 15-T,
// percentage method), which is why a level salary's withholding stays level
// paycheck to paycheck — PlayerLife.onDay reconciles the real total once a
// year in filing.ts, since annualize-and-divide isn't exact when the Social
// Security wage base or the additional Medicare threshold is crossed mid-year.
import { FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, federalTax, fica } from "./federal.ts";
import { stateTax } from "./state.ts";

export interface Withholding {
  federalIncomeTax: number;
  fica: number;
  stateIncomeTax: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function withholdingForPaycheck(o: { state: string; wagesThisPeriod: number; wagesYtdBefore?: number; periodsPerYear?: number }): Withholding {
  const periods = o.periodsPerYear ?? 24;
  const annualWages = o.wagesThisPeriod * periods;
  const annualDeduction = FEDERAL_STANDARD_DEDUCTION_SINGLE_2026;
  const annualTaxableFederal = Math.max(0, annualWages - annualDeduction);
  const annualTaxableState = Math.max(0, annualWages - annualDeduction); // same taxable base for the state estimate; stateTax applies its own brackets/flat/none
  return {
    federalIncomeTax: round2(federalTax(annualTaxableFederal) / periods),
    fica: fica(o.wagesYtdBefore ?? 0, o.wagesThisPeriod),
    stateIncomeTax: round2(stateTax(o.state, annualTaxableState) / periods),
  };
}
