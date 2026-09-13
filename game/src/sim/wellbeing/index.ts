import { cashCushion, commute, debtLoad, healthCoverage, homeStability, realIncome, relationships, retirementOnTrack, work } from "./factors.ts";
import { cushionSoftening, decay, PULSE_TABLE } from "./pulses.ts";
import { retirementReadiness, type RetirementLife } from "./retirement.ts";
import type { Pulse, WellbeingSnapshot } from "./types.ts";

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

export interface WellbeingLife extends RetirementLife {
  employed: boolean;
  reemployedDay: number | null;
  cash(): number;
  monthlyExpenses(): number;
  dti(): number;
  hasPastDue(): boolean;
  inCollectionsOrRecentBankruptcy(today?: number): boolean;
  book: RetirementLife["book"] & {
    debts: { kind: string; status: string }[];
  };
  place: { rpp: { all: number } };
  relationship: "single" | "partnered";
  age: number;
  insured: boolean;
  commuteMinutes: number;
  homeTier(): number;
  pulses: readonly Pulse[];
  history: readonly { wellbeing: number }[];
}

/** Pure current-state score; it deliberately never reads history or calls snapshot(). */
export function wellbeing(life: WellbeingLife, today: number): WellbeingSnapshot {
  const factors = [
    work(life, today), cashCushion(life), debtLoad(life, today), realIncome(life), relationships(life),
    retirementOnTrack(life), healthCoverage(life), commute(life), homeStability(life),
  ];
  const base = factors.reduce((sum, factor) => sum + factor.points, 0);
  const cushion = factors.find((factor) => factor.name === "cashCushion")?.s ?? 0;
  const pulsePoints = life.pulses.reduce((sum, pulse) => {
    const value = decay(pulse, today);
    return sum + (value < 0 ? value * cushionSoftening(cushion) : value);
  }, 0);
  return { W: round1(clamp(base + pulsePoints, 0, 100)), factors };
}

export function finalScore(life: WellbeingLife, today: number): { RR: number; Wlife: number; final: number } {
  const RR = retirementReadiness(life);
  const current = wellbeing(life, today).W;
  const lifetimeAverage = life.history.length > 0
    ? life.history.reduce((sum, snapshot) => sum + snapshot.wellbeing, 0) / life.history.length
    : current;
  const Wlife = round1(0.5 * lifetimeAverage + 0.5 * current);
  return { RR, Wlife, final: round1(0.6 * RR + 0.4 * Wlife) };
}

/**
 * Fires a named happiness pulse (e.g. "vacation") from `PULSE_TABLE` onto a life's
 * pulse list, via the existing `addPulse` mechanism (already used for marriage,
 * layoff, and bankruptcy). Kept name-and-signature-stable: P3 reuses this for the
 * injury/car-breakdown/divorce negative pulses.
 */
export function triggerPulse(
  life: { addPulse(p0: number, halfLifeDays: number, day: number): void },
  name: keyof typeof PULSE_TABLE,
  today: number,
): void {
  const { p0, halfLifeDays } = PULSE_TABLE[name];
  life.addPulse(p0, halfLifeDays, today);
}

export type { FactorBreakdown, FactorName, Pulse, WellbeingSnapshot } from "./types.ts";
export { PULSE_TABLE, cushionSoftening, decay } from "./pulses.ts";
export { WEIGHTS } from "./factors.ts";
export { retirementReadiness } from "./retirement.ts";
