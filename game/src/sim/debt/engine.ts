// The daily debt tick. Called once per game day by the calendar, and run
// headless for skips and the age teleport, so every number the player sees
// comes from this one path.
//
// Order each day, per debt:
//   1. accrue simple daily interest (cards skip it while in grace)
//   2. cards close a statement on their cycle day; payments fall due
//   3. pay through the Wallet (the game's shortfall waterfall); a shortfall
//      becomes past due plus a late fee
//   4. walk the delinquency ladder by days past due
// Then, on the 1st of each month: reset variable APRs from the market,
// route the strategy's extra money, recompute the credit score.

import {
  CARD_LATE_FEE,
  CARD_PENALTY_APR,
  GRACE_DAYS,
  INSTALLMENT_LATE_FEE_RATE,
  primeRate,
} from "./rates.ts";
import { cardMinimum, rapMonthlyPayment } from "./math.ts";
import { scoreBreakdown } from "./score.ts";
import { orderByStrategy } from "./strategy.ts";
import type { Debt, DebtBook, DebtEvent, RateEnv, Wallet } from "./types.ts";

export interface TickContext {
  day: number;
  date: Date;
  env: RateEnv;
  wallet: Wallet;
}

const EPS = 0.005;
const UNSECURED_COLLECTIONS_DAYS = 180;
const STUDENT_DEFAULT_DAYS = 270;
const REPO_DAYS = 90;
/** Auctions recover roughly two thirds of a repossessed car loan. */
const REPO_RECOVERY = 0.65;

export const isOpen = (d: Debt) => d.status !== "paid" && d.status !== "discharged";
export const owed = (d: Debt) => d.balance + d.accrued;
const isCard = (d: Debt) => d.kind === "credit_card";
const inCollections = (d: Debt) => d.status === "collections";

export function effectiveApr(d: Debt, day: number): number {
  if (d.hardshipAprUntil !== undefined && day < d.hardshipAprUntil) return d.hardshipApr ?? d.aprAnnual;
  if (d.penaltyApr) return Math.max(d.aprAnnual, CARD_PENALTY_APR);
  // A penalty APR (60 days late) cancels the promo, which is why it is checked first.
  if (d.promoUntil !== undefined && day < d.promoUntil) return d.promoApr ?? d.aprAnnual;
  return d.aprAnnual;
}

/** Applies money to accrued interest first, then principal. Returns the interest part. */
function applyPayment(book: DebtBook, d: Debt, amount: number): number {
  const interest = Math.min(amount, d.accrued);
  d.accrued -= interest;
  d.balance = Math.max(0, d.balance - (amount - interest));
  book.interestPaid += interest;
  return interest;
}

/** RAP: interest the payment doesn't cover is waived, and principal drops by at least min($50, payment). */
function applyRapPayment(book: DebtBook, d: Debt, amount: number): number {
  const interest = Math.min(amount, d.accrued);
  const principal = amount - interest;
  const match = Math.max(0, Math.min(50, amount) - principal);
  d.accrued = 0;
  d.balance = Math.max(0, d.balance - principal - match);
  book.interestPaid += interest;
  return interest;
}

/** The player's own card payments since the statement; the plan's extra is on top of the minimum. */
const paidTowardDue = (d: Debt) => Math.max(0, (d.statementPaid ?? 0) - (d.planPaid ?? 0));

/** What is due today for this debt, or 0 if nothing falls due. */
function dueToday(d: Debt, ctx: TickContext): number {
  if (isCard(d)) {
    if (d.statementDueDay !== ctx.day) return 0;
    // Autopay covers only what the player's payments since the statement haven't.
    const paid = paidTowardDue(d);
    if (d.autopay === "statement") return Math.max(0, (d.statementBalance ?? 0) - paid);
    if (d.autopay === "minimum") return Math.max(0, (d.minimumDue ?? 0) - paid);
    return 0;
  }
  if (ctx.date.getDate() !== d.dueDayOfMonth) return 0;
  if (d.autopay === "none") return 0;
  return Math.min(d.scheduledPayment ?? 0, owed(d));
}

/** The contractual amount that must be paid today to stay current (independent of autopay). */
function requiredToday(d: Debt, ctx: TickContext): number {
  // Issuers count what the player paid since the statement toward the minimum.
  if (isCard(d)) return d.statementDueDay === ctx.day ? Math.max(0, (d.minimumDue ?? 0) - paidTowardDue(d)) : 0;
  if (ctx.date.getDate() !== d.dueDayOfMonth) return 0;
  return Math.min(d.scheduledPayment ?? 0, owed(d));
}

function recomputeScore(book: DebtBook, day: number): number {
  const s = scoreBreakdown(book.profile, book.debts, day, book.profile.historyStartDay).score;
  book.profile.score = s;
  return s;
}

function reportMark(book: DebtBook, d: Debt, day: number, severity: 30 | 60 | 90 | 120, events: DebtEvent[]) {
  const before = book.profile.score;
  book.profile.lateMarks.push({ day, debtId: d.id, severity });
  d.ladderStep = severity;
  const after = recomputeScore(book, day);
  events.push({ type: "late_mark", day, debtId: d.id, severity, scoreBefore: before, scoreAfter: after });
}

function walkLadder(book: DebtBook, d: Debt, day: number, events: DebtEvent[]) {
  if (d.pastDueSince === null) return;
  const dpd = day - d.pastDueSince;
  if (dpd < 30) {
    d.status = "late";
    return;
  }
  for (const step of [30, 60, 90, 120] as const) {
    if (dpd >= step && d.ladderStep < step) reportMark(book, d, day, step, events);
  }
  d.status = dpd >= 90 ? "serious" : "delinquent";

  if (isCard(d) && dpd >= 60 && !d.penaltyApr) {
    d.penaltyApr = true;
    events.push({ type: "penalty_apr", day, debtId: d.id, apr: effectiveApr(d, day) });
  }
  if (d.kind === "auto" && dpd >= REPO_DAYS && d.secured === "car") {
    const deficiency = owed(d) * (1 - REPO_RECOVERY);
    d.balance = deficiency;
    d.accrued = 0;
    d.secured = undefined;
    d.status = "collections";
    d.scheduledPayment = 0;
    book.profile.collections.push({ day, debtId: d.id });
    recomputeScore(book, day);
    events.push({ type: "repossessed", day, debtId: d.id, deficiency });
    return;
  }
  if (d.kind === "student_federal" && dpd >= STUDENT_DEFAULT_DAYS) {
    d.status = "default";
    events.push({ type: "default", day, debtId: d.id });
    return;
  }
  const unsecured = d.kind === "credit_card" || d.kind === "personal" || d.kind === "medical" || d.kind === "bnpl" || d.kind === "payday";
  if (unsecured && dpd >= UNSECURED_COLLECTIONS_DAYS) {
    d.status = "collections";
    book.profile.collections.push({ day, debtId: d.id });
    recomputeScore(book, day);
    events.push({ type: "collections", day, debtId: d.id, balance: owed(d) });
  }
}

/** `fromPlan` marks the payoff plan's monthly extra, which is paid on top of the minimum. */
function payDebt(book: DebtBook, d: Debt, amount: number, ctx: TickContext, events: DebtEvent[], fromPlan = false) {
  if (amount <= EPS) return;
  const paid = ctx.wallet.withdraw(amount, `${d.name} payment`);
  if (paid <= EPS) return;
  const interest = d.plan === "rap" ? applyRapPayment(book, d, paid) : applyPayment(book, d, paid);
  if (isCard(d)) {
    d.statementPaid = (d.statementPaid ?? 0) + paid;
    if (fromPlan) d.planPaid = (d.planPaid ?? 0) + paid;
  }
  events.push({ type: "payment", day: ctx.day, debtId: d.id, amount: paid, interest });
}

/** Settles today's due amount plus anything past due. */
function settleDue(book: DebtBook, d: Debt, ctx: TickContext, events: DebtEvent[]) {
  const required = requiredToday(d, ctx);
  const planned = dueToday(d, ctx);
  if (required > EPS || planned > EPS) payDue(book, d, required, planned, ctx, events);
  // Extra payments made before the due date count toward paying the statement in full.
  if (isCard(d) && d.statementDueDay === ctx.day) {
    d.inGrace = (d.statementPaid ?? 0) + EPS >= (d.statementBalance ?? 0);
  }
}

function payDue(book: DebtBook, d: Debt, required: number, planned: number, ctx: TickContext, events: DebtEvent[]) {
  const want = Math.max(planned, required) + d.pastDue;
  const available = ctx.wallet.available();
  const pay = Math.min(want, available);
  payDebt(book, d, pay, ctx, events);

  const shortfall = required + d.pastDue - pay;
  if (shortfall > EPS) {
    if (required > EPS) {
      const fee = isCard(d) ? CARD_LATE_FEE : d.kind === "student_federal" ? 0 : (d.scheduledPayment ?? 0) * INSTALLMENT_LATE_FEE_RATE;
      d.balance += fee;
      book.feesPaid += fee;
      events.push({ type: "missed", day: ctx.day, debtId: d.id, due: required, fee });
      events.push({ type: "cannot_cover", day: ctx.day, debtId: d.id, due: want, available });
    }
    d.pastDue = shortfall;
    if (d.pastDueSince === null) d.pastDueSince = ctx.day;
    if (d.status === "current") d.status = "late";
  } else {
    d.pastDue = 0;
    d.pastDueSince = null;
    d.ladderStep = 0;
    if (d.status !== "collections" && d.status !== "default") d.status = "current";
  }
}

function closeStatement(d: Debt, ctx: TickContext, events: DebtEvent[]) {
  const interest = d.accrued;
  d.balance += interest;
  d.accrued = 0;
  d.statementBalance = d.balance;
  d.statementPaid = 0;
  d.planPaid = 0;
  d.minimumDue = cardMinimum(d.balance - interest, interest);
  d.statementDueDay = ctx.day + GRACE_DAYS;
  events.push({ type: "statement", day: ctx.day, debtId: d.id, balance: d.balance, minimum: d.minimumDue, interest });
}

function monthly(book: DebtBook, ctx: TickContext, events: DebtEvent[]) {
  const prime = primeRate(ctx.env.cashRateAnnual);
  for (const d of book.debts) {
    if (isOpen(d) && d.variableMargin !== undefined) d.aprAnnual = prime + d.variableMargin;
  }

  // Strategy extra plus the snowball rollover, to the first open debt in strategy order.
  let pool = book.strategy === "minimums" ? 0 : book.extraMonthly + book.rollover;
  for (const d of orderByStrategy(book.debts.filter((x) => isOpen(x) && x.status !== "collections"), book.strategy)) {
    if (pool <= EPS) break;
    const take = Math.min(pool, owed(d), ctx.wallet.available());
    if (take <= EPS) break;
    payDebt(book, d, take, ctx, events, true);
    pool -= take;
  }

  const before = book.profile.score;
  const after = recomputeScore(book, ctx.day);
  if (after !== before) events.push({ type: "score_change", day: ctx.day, from: before, to: after });

  // Bankruptcy becomes an option when unsecured debt is 90+ days late and
  // minimums eat more than half of take-home pay.
  const seriousUnsecured = book.debts.some((d) => isOpen(d) && !d.secured && d.kind !== "student_federal" && d.pastDueSince !== null && ctx.day - d.pastDueSince >= 90);
  const minimums = book.debts.filter(isOpen).reduce((s, d) => s + (isCard(d) ? d.minimumDue ?? 0 : d.scheduledPayment ?? 0), 0);
  if (seriousUnsecured && minimums > 0.5 * book.monthlyTakeHome) {
    if (book.lastBankruptcyNotice === null || ctx.day - book.lastBankruptcyNotice >= 90) {
      book.lastBankruptcyNotice = ctx.day;
      events.push({ type: "bankruptcy_eligible", day: ctx.day, reason: `Minimum payments ($${Math.round(minimums)}) exceed half of take-home pay and unsecured debt is 90+ days late.` });
    }
  }
}

export function tickDay(book: DebtBook, ctx: TickContext): DebtEvent[] {
  const events: DebtEvent[] = [];
  for (const d of book.debts) {
    if (!isOpen(d) || d.status === "collections") continue;

    // 1. Interest.
    const graceFree = isCard(d) && d.inGrace && d.pastDueSince === null;
    if (!graceFree) d.accrued += (d.balance * effectiveApr(d, ctx.day)) / 365;

    // 2-3. Statements and payments.
    if (isCard(d) && ctx.date.getDate() === d.dueDayOfMonth) closeStatement(d, ctx, events);
    settleDue(book, d, ctx, events);

    // 4. Delinquency ladder.
    walkLadder(book, d, ctx.day, events);

    // walkLadder may have just sent the debt to collections, so re-read its status.
    if (owed(d) <= EPS && d.pastDue <= EPS && !inCollections(d)) {
      d.balance = 0;
      d.accrued = 0;
      d.status = "paid";
      if (!isCard(d)) book.rollover += d.scheduledPayment ?? 0;
      events.push({ type: "paid_off", day: ctx.day, debtId: d.id, name: d.name });
    }
  }
  if (ctx.date.getDate() === 1) monthly(book, ctx, events);
  return events;
}

// ---- Recovery actions the player can take from a decision prompt ----

/** Lender hardship program: a low APR for 6 months and the account is re-aged to current. */
export function enrollHardship(book: DebtBook, debtId: string, day: number, apr = 0.09, days = 180): void {
  const d = book.debts.find((x) => x.id === debtId);
  if (!d || !isOpen(d) || d.status === "collections") return;
  d.hardshipApr = apr;
  d.hardshipAprUntil = day + days;
  // Past-due money is already part of the balance, so re-aging just clears the arrears.
  d.pastDue = 0;
  d.pastDueSince = null;
  d.ladderStep = 0;
  d.penaltyApr = false;
  d.status = "current";
}

/** Move a federal student loan to RAP; also rehabilitates a defaulted loan in the game. */
export function switchToRap(book: DebtBook, debtId: string): void {
  const d = book.debts.find((x) => x.id === debtId);
  if (!d || d.kind !== "student_federal") return;
  d.plan = "rap";
  d.scheduledPayment = rapMonthlyPayment(book.agi, book.dependents);
  d.pastDue = 0;
  d.pastDueSince = null;
  d.ladderStep = 0;
  d.status = "current";
}

/** Fraction of each paycheck garnished (15% of disposable pay while a federal loan is in default). */
export function garnishmentRate(book: DebtBook): number {
  return book.debts.some((d) => d.kind === "student_federal" && d.status === "default") ? 0.15 : 0;
}

/** Pay any amount toward one debt right now (the payment slider or a "pay extra" button). */
export function payNow(book: DebtBook, debtId: string, amount: number, ctx: TickContext): DebtEvent[] {
  const events: DebtEvent[] = [];
  const d = book.debts.find((x) => x.id === debtId);
  if (!d || !isOpen(d)) return events;
  const pay = Math.min(amount, owed(d));
  payDebt(book, d, pay, ctx, events);
  if (d.pastDue > 0) {
    d.pastDue = Math.max(0, d.pastDue - pay);
    if (d.pastDue <= EPS) {
      d.pastDue = 0;
      d.pastDueSince = null;
      d.ladderStep = 0;
      if (d.status !== "collections" && d.status !== "default") d.status = "current";
    }
  }
  return events;
}
