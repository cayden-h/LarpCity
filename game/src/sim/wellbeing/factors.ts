import type { FactorBreakdown, FactorName } from "./types.ts";

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const round1 = (value: number) => Math.round(value * 10) / 10;

export const WEIGHTS = {
  work: 20,
  cashCushion: 18,
  debtLoad: 14,
  realIncome: 12,
  relationships: 10,
  retirementOnTrack: 8,
  healthCoverage: 8,
  commute: 6,
  homeStability: 4,
} as const;

function result(name: FactorName, raw: number, note: string): FactorBreakdown {
  const s = clamp01(raw);
  const weight = WEIGHTS[name];
  return { name, weight, s, points: weight * s, note };
}

export function work(life: { employed: boolean; reemployedDay: number | null }, today = 0): FactorBreakdown {
  if (!life.employed) return result("work", 0, "Unemployed");
  if (life.reemployedDay === null) return result("work", 1, "Employed");
  const years = Math.max(0, today - life.reemployedDay) / 365.25;
  return result("work", 1 - 0.5 * 0.5 ** years, years < 3 ? "Recently back to work" : "Employed");
}

export function cashCushion(life: { cash(): number; monthlyExpenses(): number }): FactorBreakdown {
  const cash = Math.max(0, life.cash());
  const expenses = Math.max(0, life.monthlyExpenses());
  if (cash < 400) return result("cashCushion", 0, "Below the $400 emergency-expense test");
  const months = expenses > 0 ? cash / expenses : 6;
  return result("cashCushion", months / 6, `${round1(months)} months of expenses in cash`);
}

interface DebtLife {
  dti(): number;
  hasPastDue(): boolean;
  inCollectionsOrRecentBankruptcy(today?: number): boolean;
}

export function debtLoad(life: DebtLife, today = 0): FactorBreakdown {
  if (life.inCollectionsOrRecentBankruptcy(today)) return result("debtLoad", 0, "Debt in collections or recent bankruptcy");
  const pastDue = life.hasPastDue();
  let s = clamp01(1 - Math.max(0, life.dti()) / 0.4);
  if (pastDue) s *= 0.5;
  return result("debtLoad", s, pastDue ? "A payment is past due" : `Debt payments are ${round1(Math.max(0, life.dti()) * 100)}% of take-home`);
}

export function realIncome(life: { grossAnnual: number; place: { rpp: { all: number } } }): FactorBreakdown {
  const rpp = life.place.rpp.all > 0 ? life.place.rpp.all : 100;
  const adjusted = Math.max(0, life.grossAnnual) * 100 / rpp;
  const s = adjusted > 0 ? Math.log(adjusted / 25_000) / Math.log(8) : 0;
  return result("realIncome", s, `About $${Math.round(adjusted).toLocaleString("en-US")} in price-adjusted income`);
}

export function relationships(life: { relationship: "single" | "partnered" }): FactorBreakdown {
  return result("relationships", life.relationship === "partnered" ? 1 : 0.9, life.relationship === "partnered" ? "Partnered" : "Single");
}

const TARGETS: readonly (readonly [number, number])[] = [[30, 1], [40, 3], [50, 6], [60, 8], [67, 10]];
function targetMultiple(age: number): number {
  if (age <= TARGETS[0][0]) return TARGETS[0][1];
  for (let i = 1; i < TARGETS.length; i++) {
    const [age1, multiple1] = TARGETS[i];
    if (age <= age1) {
      const [age0, multiple0] = TARGETS[i - 1];
      return multiple0 + (multiple1 - multiple0) * (age - age0) / (age1 - age0);
    }
  }
  return TARGETS[TARGETS.length - 1][1];
}

export function retirementOnTrack(life: { age: number; grossAnnual: number; retirementSavings(): number }): FactorBreakdown {
  const multiple = targetMultiple(life.age);
  const salary = Math.max(0, life.grossAnnual);
  const savings = Math.max(0, life.retirementSavings());
  const target = multiple * salary;
  const s = target > 0 ? savings / target : savings > 0 ? 1 : 0;
  const savedMultiple = salary > 0 ? savings / salary : 0;
  return result("retirementOnTrack", s, `${round1(savedMultiple)}x salary saved, target ${round1(multiple)}x`);
}

/** Employment is the current gameplay approximation for health coverage. */
export function healthCoverage(life: { insured: boolean; book: { debts: { kind: string; status: string }[] } }): FactorBreakdown {
  const medicalCollections = life.book.debts.some((debt) => debt.kind === "medical" && debt.status === "collections");
  if (medicalCollections) return result("healthCoverage", 0, "Medical debt in collections");
  return result("healthCoverage", life.insured ? 1 : 0.4, life.insured ? "Insured" : "Uninsured");
}

/** Commute time is a static player-life input until job locations exist. */
export function commute(life: { employed: boolean; commuteMinutes: number }): FactorBreakdown {
  if (!life.employed) return result("commute", 1, "No work commute");
  const minutes = Math.max(0, life.commuteMinutes);
  return result("commute", 1 - minutes / 60, `${round1(minutes)} minute commute`);
}

/** The tent tier represents housing instability; ownership itself gets no bonus. */
export function homeStability(life: { homeTier(): number }): FactorBreakdown {
  return result("homeStability", life.homeTier() > 0 ? 1 : 0, life.homeTier() > 0 ? "Housed" : "No stable home");
}
