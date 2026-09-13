// Per-state income tax on taxable income (already net of the federal standard
// deduction — states.ts's 2-letter abbr keys are shared with game/src/data/states.ts).
import { progressiveTax } from "./types.ts";
import { STATE_TAX } from "../../data/state-tax.ts";

export function stateTax(abbr: string, taxableIncome: number): number {
  const t = STATE_TAX[abbr];
  if (!t) throw new Error(`No state tax data for "${abbr}"`);
  if (t.type === "none") return 0;
  if (t.type === "flat") return Math.round(taxableIncome * t.rate * 100) / 100;
  return progressiveTax(taxableIncome, t.brackets);
}
