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
  /** Every pulse moving the score today, with its points after cushion softening. */
  pulses: PulseBreakdown[];
}

export interface Pulse {
  p0: number;
  halfLifeDays: number;
  startDay: number;
  /** The `PULSE_TABLE` entry it came from; pulses saved before names existed have none. */
  name?: string;
}

export interface PulseBreakdown {
  /** The `PULSE_TABLE` entry, or null when a nameless pulse matches no single entry. */
  name: string | null;
  startDay: number;
  points: number;
}
