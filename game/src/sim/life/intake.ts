// Onboarding answers (Mayor Fleck's voice interview or the typed form, see
// ui/intake.ts) and the starting money life they build: gross pay and
// take-home, the stated rent, the total debt as a credit card plus a personal
// loan, and savings.

import { creditCard, installment, newBook } from "../debt/factory.ts";
import type { Debt } from "../debt/types.ts";
import type { MarketPath } from "../market/index.ts";
import { defaultAccounts, PlayerLife, TAKE_HOME_SHARE, type Place } from "./player.ts";

export interface IntakeAnswers {
  /** Job title; may be blank. */
  job: string;
  /** Gross yearly pay. */
  salary: number;
  /** Monthly rent or housing cost. */
  rent: number;
  /** Total debt. */
  debt: number;
  /** Total savings. */
  savings: number;
}

/** Caps that keep a typo or a joke answer from breaking the sim. */
export const INTAKE_LIMITS = { salary: 5_000_000, rent: 50_000, debt: 5_000_000, savings: 10_000_000 } as const;
const JOB_MAX_LENGTH = 60;
/** Debt up to this much is a credit card; the rest is a personal loan. */
export const CARD_PORTION = 5_000;
const CARD_APR = 0.2396;
const LOAN_APR = 0.11;
const LOAN_MONTHS = 60;

const NUMBER_KEYS = ["salary", "rent", "debt", "savings"] as const;

/**
 * A dollar amount from the agent's tool call, the webhook, or a form field:
 * a number, "85000", "$85,000", or "85k". Blank, negative, or nonsense is undefined.
 */
export function parseDollars(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = v.toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
}

/** Whichever answers `raw` holds, in whole dollars and capped. */
export function coerceAnswers(raw: unknown): Partial<IntakeAnswers> {
  const out: Partial<IntakeAnswers> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.job === "string" && r.job.trim()) out.job = r.job.trim().replace(/\s+/g, " ").slice(0, JOB_MAX_LENGTH);
  for (const k of NUMBER_KEYS) {
    const n = parseDollars(r[k]);
    if (n !== undefined) out[k] = Math.min(Math.round(n), INTAKE_LIMITS[k]);
  }
  return out;
}

/** The full answers, or null while any amount is missing (the job may stay blank). */
export function completeAnswers(p: Partial<IntakeAnswers>): IntakeAnswers | null {
  const { salary, rent, debt, savings } = p;
  if (salary === undefined || rent === undefined || debt === undefined || savings === undefined) return null;
  return { job: p.job ?? "", salary, rent, debt, savings };
}

/** Monthly take-home for a gross yearly salary. */
export function takeHomeFor(salary: number): number {
  return Math.round((salary * TAKE_HOME_SHARE) / 12);
}

/** The stated total debt as a credit card (the first $5,000) plus a personal loan for the rest. */
export function debtsFor(total: number, day: number): Debt[] {
  const card = Math.min(total, CARD_PORTION);
  const loan = total - card;
  const debts: Debt[] = [];
  if (card > 0) {
    debts.push(creditCard({ id: "card", name: "Credit card", balance: card, limit: Math.max(card * 2, 2_000), apr: CARD_APR, day, openedDay: day - 365 * 2 }));
  }
  if (loan > 0) {
    debts.push(installment({ id: "loan", kind: "personal", name: "Personal loan", balance: loan, apr: LOAN_APR, months: LOAN_MONTHS, day, openedDay: day - 180 }));
  }
  return debts;
}

/** The player's starting life from the onboarding answers. */
export function lifeFromIntake(a: IntakeAnswers, o: { place: Place; day: number; market: MarketPath }): PlayerLife {
  const monthlyTakeHome = takeHomeFor(a.salary);
  const book = newBook({ debts: debtsFor(a.debt, o.day), agi: a.salary, monthlyTakeHome, strategy: "avalanche", day: o.day });
  // Savings sit in the high-yield account. Checking fills with the first
  // paycheck, and bills draw on savings when it runs short (Ledger.wallet).
  const accounts = defaultAccounts(o.day).map((acct) => ({ ...acct, balance: acct.id === "savings" ? a.savings : 0 }));
  return new PlayerLife({
    place: o.place,
    day: o.day,
    grossAnnual: a.salary,
    monthlyTakeHome,
    job: a.job,
    rent: a.rent,
    book,
    accounts,
    market: o.market,
  });
}
