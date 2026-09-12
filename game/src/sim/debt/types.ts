// Data contracts for the debt system. See research/06-debt-and-credit.md and
// research/07-debt-system-design.md for where each rule comes from.

export type DebtKind =
  | "credit_card"
  | "student_federal"
  | "auto"
  | "mortgage"
  | "personal"
  | "bnpl"
  | "payday"
  | "medical";

export type DebtStatus =
  | "current"
  | "late" // 1-29 days past due
  | "delinquent" // 30-89 days past due, reported to the bureaus
  | "serious" // 90+ days past due
  | "default" // federal student loan at 270 days: wage garnishment
  | "collections" // charged off and sold (unsecured) or repossessed (auto)
  | "paid"
  | "discharged"; // wiped in bankruptcy

export type StudentPlan = "standard" | "rap";

/** How the player pays a debt each cycle. */
export type Autopay = "minimum" | "statement" | "none";

export interface Debt {
  id: string;
  kind: DebtKind;
  name: string;
  /** Principal owed, not counting interest accrued since the last payment. */
  balance: number;
  /** Simple daily interest accrued since the last payment or statement. */
  accrued: number;
  aprAnnual: number;
  /** Variable debts reset their APR to prime + margin each month. */
  variableMargin?: number;
  openedDay: number;
  dueDayOfMonth: number;
  autopay: Autopay;

  // Revolving (credit card)
  creditLimit?: number;
  /** Balance captured at the last statement close. */
  statementBalance?: number;
  /** Minimum due for the current statement. */
  minimumDue?: number;
  /** Paid toward the card since the last statement closed; the statement is covered once this reaches its balance. */
  statementPaid?: number;
  /**
   * The part of statementPaid that came from the payoff plan's monthly extra. A plan means
   * "the minimum plus extra", so it doesn't count toward the minimum; the player's own early
   * payments do, as they would with a real issuer.
   */
  planPaid?: number;
  /** Day index the current statement's payment is due. */
  statementDueDay?: number;
  /** True while the last statement was paid in full, so purchases don't accrue interest. */
  inGrace?: boolean;
  penaltyApr?: boolean;

  // Installment (auto, mortgage, personal, student standard)
  termMonths?: number;
  scheduledPayment?: number;

  // Federal student loan
  plan?: StudentPlan;

  // Hardship program: temporary APR until this day.
  hardshipAprUntil?: number;
  hardshipApr?: number;

  // Intro or balance transfer promo (cards): this APR until this day, then the contract APR.
  promoApr?: number;
  promoUntil?: number;

  // Delinquency
  /** Amount that was due and not paid. */
  pastDue: number;
  /** Day index of the oldest unpaid due date, or null when current. */
  pastDueSince: number | null;
  /** Worst late mark reported in the current past-due episode (0 = none). */
  ladderStep: 0 | 30 | 60 | 90 | 120;
  status: DebtStatus;
  secured?: "car" | "home";
}

export interface LateMark {
  day: number;
  debtId: string;
  severity: 30 | 60 | 90 | 120;
}

export interface CreditProfile {
  lateMarks: LateMark[];
  /** Day index of each hard inquiry. */
  inquiries: number[];
  collections: { day: number; debtId: string }[];
  bankruptcy?: { day: number; chapter: 7 | 13 };
  /** Day the player's credit history began; drives length of history for a thin file. */
  historyStartDay: number;
  score: number;
}

export type Strategy = "minimums" | "avalanche" | "snowball";

export interface DebtBook {
  debts: Debt[];
  profile: CreditProfile;
  strategy: Strategy;
  /** Extra dollars per month on top of all minimums, routed by the strategy. */
  extraMonthly: number;
  /** Payments freed by paid-off debts, rolled into the strategy (the "snowball"). */
  rollover: number;
  /** Adjusted gross income and dependents, for RAP and the bankruptcy test. */
  agi: number;
  dependents: number;
  monthlyTakeHome: number;
  /** Last day a bankruptcy_eligible event fired, so it doesn't repeat daily. */
  lastBankruptcyNotice: number | null;
  /** Lifetime totals, for recaps and the newspaper. */
  interestPaid: number;
  feesPaid: number;
}

/** Where debt payments come from. The game's shortfall waterfall sits behind this. */
export interface Wallet {
  /** Dollars available to pay debts right now. */
  available(): number;
  /** Takes up to `amount` and returns how much was actually taken. */
  withdraw(amount: number, memo: string): number;
}

/** Market inputs, from the seeded market path (decision-independent). */
export interface RateEnv {
  /** Fed funds / cash rate, as a fraction (0.043 = 4.3%). */
  cashRateAnnual: number;
}

export type DebtEvent =
  | { type: "payment"; day: number; debtId: string; amount: number; interest: number }
  | { type: "statement"; day: number; debtId: string; balance: number; minimum: number; interest: number }
  | { type: "missed"; day: number; debtId: string; due: number; fee: number }
  | { type: "late_mark"; day: number; debtId: string; severity: 30 | 60 | 90 | 120; scoreBefore: number; scoreAfter: number }
  | { type: "penalty_apr"; day: number; debtId: string; apr: number }
  | { type: "collections"; day: number; debtId: string; balance: number }
  | { type: "repossessed"; day: number; debtId: string; deficiency: number }
  | { type: "default"; day: number; debtId: string }
  | { type: "paid_off"; day: number; debtId: string; name: string }
  | { type: "cannot_cover"; day: number; debtId: string; due: number; available: number }
  | { type: "bankruptcy_eligible"; day: number; reason: string }
  | { type: "score_change"; day: number; from: number; to: number };
