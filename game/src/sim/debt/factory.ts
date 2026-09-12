// Constructors for debts and books, plus the sample household used by the
// demo, the tests, and the research numbers.

import { monthlyPayment, rapMonthlyPayment, standardTermMonths } from "./math.ts";
import { offeredApr, primeRate, REFERENCE_CASH_RATE } from "./rates.ts";
import { scoreBreakdown } from "./score.ts";
import type { Debt, DebtBook, DebtKind, Strategy } from "./types.ts";

const base = (id: string, kind: DebtKind, name: string, balance: number, apr: number, day: number, dueDayOfMonth: number): Debt => ({
  id,
  kind,
  name,
  balance,
  accrued: 0,
  aprAnnual: apr,
  openedDay: day,
  dueDayOfMonth,
  autopay: "minimum",
  pastDue: 0,
  pastDueSince: null,
  ladderStep: 0,
  status: "current",
});

export function creditCard(o: { id: string; name: string; balance: number; limit: number; apr: number; day: number; dueDayOfMonth?: number; openedDay?: number }): Debt {
  const d = base(o.id, "credit_card", o.name, o.balance, o.apr, o.openedDay ?? o.day, o.dueDayOfMonth ?? 15);
  d.creditLimit = o.limit;
  d.variableMargin = o.apr - primeRate(REFERENCE_CASH_RATE);
  d.inGrace = o.balance === 0;
  return d;
}

export function installment(o: { id: string; kind: "auto" | "mortgage" | "personal"; name: string; balance: number; apr: number; months: number; day: number; dueDayOfMonth?: number; openedDay?: number; payment?: number }): Debt {
  const d = base(o.id, o.kind, o.name, o.balance, o.apr, o.openedDay ?? o.day, o.dueDayOfMonth ?? 1);
  d.termMonths = o.months;
  d.scheduledPayment = o.payment ?? monthlyPayment(o.balance, o.apr, o.months);
  if (o.kind === "auto") d.secured = "car";
  if (o.kind === "mortgage") d.secured = "home";
  return d;
}

export function studentLoan(o: { id: string; name: string; balance: number; apr?: number; plan: "standard" | "rap"; agi: number; dependents?: number; day: number; dueDayOfMonth?: number; openedDay?: number; payment?: number }): Debt {
  const apr = o.apr ?? offeredApr("student_federal", 0, REFERENCE_CASH_RATE);
  const d = base(o.id, "student_federal", o.name, o.balance, apr, o.openedDay ?? o.day, o.dueDayOfMonth ?? 20);
  d.plan = o.plan;
  d.termMonths = o.plan === "standard" ? standardTermMonths(o.balance) : 360;
  d.scheduledPayment = o.payment ?? (o.plan === "rap" ? rapMonthlyPayment(o.agi, o.dependents ?? 0) : monthlyPayment(o.balance, apr, d.termMonths));
  return d;
}

export function newBook(o: { debts: Debt[]; agi: number; monthlyTakeHome: number; dependents?: number; strategy?: Strategy; extraMonthly?: number; day: number; historyYears?: number }): DebtBook {
  const book: DebtBook = {
    debts: o.debts,
    profile: { lateMarks: [], inquiries: [], collections: [], historyStartDay: o.day - 365 * (o.historyYears ?? 5), score: 0 },
    strategy: o.strategy ?? "minimums",
    extraMonthly: o.extraMonthly ?? 0,
    rollover: 0,
    agi: o.agi,
    dependents: o.dependents ?? 0,
    monthlyTakeHome: o.monthlyTakeHome,
    interestPaid: 0,
    feesPaid: 0,
    lastBankruptcyNotice: null,
  };
  book.profile.score = scoreBreakdown(book.profile, book.debts, o.day, book.profile.historyStartDay).score;
  return book;
}

/**
 * The research doc's sample household: a $1,500 furniture loan at 11%, a
 * $7,000 card at 23.96%, a $14,000 car loan at 6.9%, and $22,000 of student
 * loans at 6.39%, on a $55,000 salary.
 */
export function sampleHousehold(day = 0, strategy: Strategy = "minimums", extraMonthly = 300): DebtBook {
  const opened = day - 365 * 4;
  return newBook({
    day,
    agi: 55_000,
    monthlyTakeHome: 3_650,
    strategy,
    extraMonthly,
    historyYears: 6,
    debts: [
      installment({ id: "furniture", kind: "personal", name: "Furniture loan", balance: 1_500, apr: 0.11, months: 28, payment: 60, day, openedDay: day - 200, dueDayOfMonth: 5 }),
      creditCard({ id: "card", name: "Brickstone Visa", balance: 7_000, limit: 9_000, apr: 0.2396, day, openedDay: opened, dueDayOfMonth: 12 }),
      installment({ id: "car", kind: "auto", name: "Car loan", balance: 14_000, apr: 0.069, months: 36, payment: 420, day, openedDay: day - 700, dueDayOfMonth: 1 }),
      studentLoan({ id: "student", name: "Student loans", balance: 22_000, apr: 0.0639, plan: "standard", agi: 55_000, payment: 250, day, openedDay: opened, dueDayOfMonth: 20 }),
    ],
  });
}
