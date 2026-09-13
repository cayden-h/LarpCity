// Types for fast-forwarding to a goal (research/10-teleport-and-goal-skips.md,
// the hackathon version): the player's standing orders, the goals, and what a
// fast-forward returns. The age teleport was removed on 2026-09-12, so every
// fast-forward runs until a goal is met, bankruptcy, or an age cap.

import type { Strategy } from "../debt/types.ts";
import type { LifeSnapshot } from "../life/player.ts";

export type Lifestyle = "frugal" | "normal" | "comfortable" | "lavish";

/** Living costs besides rent, relative to a normal lifestyle (research/10, section 6). */
export const LIFESTYLE_FACTOR: Record<Lifestyle, number> = {
  frugal: 0.85,
  normal: 1,
  comfortable: 1.25,
  lavish: 1.5,
};

/** What the plan does when a bear market starts. */
export type CrashRule = "hold" | "sell_half" | "sell_all";

/** The plan a fast-forward follows. Set on the setup screen and applied from that day on. */
export interface StandingOrders {
  /** Recurring brokerage deposit, dollars a month. */
  depositMonthly: number;
  /** 401(k) contribution as a share of gross pay (0.06 = 6%). */
  k401Pct: number;
  /** Roth IRA contribution as a share of gross pay; clamped so the yearly total never exceeds the IRS Roth limit (no employer match). */
  rothPct: number;
  /** Share of investments in stocks; the rest is bonds. */
  stockPct: number;
  debtStrategy: Strategy;
  /** Dollars a month on top of the minimums, routed by the strategy. */
  extraMonthly: number;
  /** Emergency fund target, in months of rent, living costs, and minimum payments. */
  emergencyMonths: number;
  lifestyle: Lifestyle;
  crashRule: CrashRule;
}

export type Goal =
  | { kind: "debt_free" }
  | { kind: "emergency_fund"; months: number }
  | { kind: "net_worth"; amount: number }
  | { kind: "house"; downPct: number }
  | { kind: "marriage" }
  | { kind: "status"; annualIncome: number };

/** What a goal check reads. The daily life and the monthly preview both build one, so they agree. */
export interface GoalView {
  /** Checking and savings. */
  cash: number;
  emergency: number;
  brokerage: number;
  /** 401(k) and Roth IRA; not spendable on a house. */
  retirement: number;
  /** Owned home asset value; its mortgage is already included in debt. Not spendable cash. */
  homeValue: number;
  debt: number;
  minimums: number;
  /** Rent, living costs, and minimum payments. */
  monthlyExpenses: number;
  monthlyGross: number;
  /** A typical home in the player's state. */
  homePrice: number;
  relationship: "single" | "partnered";
  grossAnnual: number;
}

export type StopReason = "goal" | "bankruptcy" | "cap";

export interface SkipResult {
  fromDay: number;
  toDay: number;
  daysRun: number;
  stoppedBy: StopReason;
  start: LifeSnapshot;
  end: LifeSnapshot;
  low: LifeSnapshot;
  high: LifeSnapshot;
  ageAtEnd: number;
  /** Bear markets that started during the fast-forward. */
  bearMarkets: number;
  /** The total market's worst fall from a peak during the fast-forward (0.34 = 34%). */
  worstDrop: number;
  /** How many of each life event happened (paycheck, paid_off, ...). */
  counts: Record<string, number>;
}
