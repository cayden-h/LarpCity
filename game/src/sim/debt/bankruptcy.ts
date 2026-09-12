// Bankruptcy as a real choice, not a game over. Stops skips and the age
// teleport (the meeting's rule) and offers Chapter 7 or Chapter 13.

import { owed, isOpen } from "./engine.ts";
import { monthlyPayment } from "./math.ts";
import type { Debt, DebtBook } from "./types.ts";

/** ACS 2024 national median household income, from research/data/states-sample.json. */
export const US_MEDIAN_HOUSEHOLD_INCOME = 81_604;

export const CH7 = { courtFee: 338, attorney: 1_500, months: 4 } as const;
export const CH13 = { courtFee: 313, attorney: 3_500, planMonths: 60, repayShare: 0.4 } as const;

/**
 * Simplified means test: Chapter 7 is open if income is at or below the
 * state median. We approximate the state median from the national median
 * scaled by the state's price parity until states.json carries ACS medians.
 */
export function passesMeansTest(annualIncome: number, stateRppAll: number): boolean {
  return annualIncome <= US_MEDIAN_HOUSEHOLD_INCOME * (stateRppAll / 100);
}

/** Debts bankruptcy cannot erase: federal student loans (and secured debt stays tied to its collateral). */
const dischargeable = (d: Debt) => isOpen(d) && d.kind !== "student_federal" && !d.secured;

export interface BankruptcyResult {
  chapter: 7 | 13;
  discharged: number;
  kept: string[];
  cost: number;
  planPayment?: number;
}

export function fileBankruptcy(book: DebtBook, chapter: 7 | 13, day: number): BankruptcyResult {
  const targets = book.debts.filter(dischargeable);
  const total = targets.reduce((s, d) => s + owed(d), 0);
  const kept = book.debts.filter((d) => isOpen(d) && !dischargeable(d)).map((d) => d.name);
  for (const d of targets) {
    d.balance = 0;
    d.accrued = 0;
    d.pastDue = 0;
    d.pastDueSince = null;
    d.status = "discharged";
  }
  book.profile.bankruptcy = { day, chapter };

  if (chapter === 7) {
    return { chapter, discharged: total, kept, cost: CH7.courtFee + CH7.attorney };
  }
  // Chapter 13: a 5-year plan repays part of the unsecured debt at 0%; the attorney is paid through the plan.
  const planBalance = total * CH13.repayShare + CH13.attorney;
  const planPayment = monthlyPayment(planBalance, 0, CH13.planMonths);
  book.debts.push({
    id: `ch13-${day}`,
    kind: "personal",
    name: "Chapter 13 plan",
    balance: planBalance,
    accrued: 0,
    aprAnnual: 0,
    openedDay: day,
    dueDayOfMonth: 1,
    autopay: "minimum",
    termMonths: CH13.planMonths,
    scheduledPayment: planPayment,
    pastDue: 0,
    pastDueSince: null,
    ladderStep: 0,
    status: "current",
  });
  return { chapter, discharged: total - total * CH13.repayShare, kept, cost: CH13.courtFee, planPayment };
}
