export type FactorName =
  | "work"
  | "cashCushion"
  | "debtLoad"
  | "realIncome"
  | "relationships"
  | "retirementOnTrack"
  | "healthCoverage"
  | "commute"
  | "homeStability";

export interface FactorBreakdown {
  name: FactorName;
  weight: number;
  /** Normalized factor score, from 0 to 1. */
  s: number;
  points: number;
  note: string;
}

export interface WellbeingSnapshot {
  W: number;
  factors: FactorBreakdown[];
}

export interface Pulse {
  p0: number;
  halfLifeDays: number;
  startDay: number;
}
