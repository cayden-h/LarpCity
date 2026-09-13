const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const round1 = (value: number) => Math.round(value * 10) / 10;

export interface RetirementLife {
  retirementSavings(): number;
  grossAnnual: number;
  book: { profile: { score: number } };
  netWorth(): number;
  totalDebt(): number;
}

/** The adopted retirement-readiness formula from research/09 section 3.4. */
export function retirementReadiness(life: RetirementLife): number {
  const salary = Math.max(1, life.grossAnnual);
  const savings = Math.max(0, life.retirementSavings());
  const netWorth = Math.max(0, life.netWorth());
  const debt = Math.max(0, life.totalDebt());
  const savingsTerm = 50 * clamp01(savings / (10 * salary));
  const creditTerm = 20 * clamp01((life.book.profile.score - 300) / 550);
  const netWorthTerm = 15 * clamp01(netWorth / (10 * salary));
  const debtRatio = clamp01(debt / salary);
  return round1(savingsTerm + creditTerm + netWorthTerm + 15 * (1 - debtRatio));
}
