// Onboarding answers (the owl narrator's voice interview or the typed form, see
// ui/intake.ts) and the starting money life they build: gross pay and
// take-home, the stated rent, the total debt as a credit card plus a personal
// loan, and savings.

import { creditCard, installment, newBook } from "../debt/factory.ts";
import type { Debt } from "../debt/types.ts";
import type { InstrumentId, MarketPath } from "../market/index.ts";
import { withholdingForPaycheck } from "../tax/withholding.ts";
import { defaultAccounts, PlayerLife, type Place } from "./player.ts";
import type { Profile, ProfileSource } from "../save/client.ts";

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

/** Every fresh life (voice, typed, or randomized) starts the debt engine's credit score here, not wherever the seeded debts happen to score. */
export const CREDIT_SCORE_START = 600;
/** A starter salary lands somewhere in here before any cost-of-living scaling. */
export const SALARY_RANGE = { min: 35_000, max: 50_000 } as const;
/** A starter debt load lands somewhere in here, split into a card and a loan by `debtsFor`. */
export const DEBT_RANGE = { min: 20_000, max: 40_000 } as const;
/** Applied to the randomized salary when the place's cost of living clears `HIGH_COST_RPP_THRESHOLD`. */
export const HIGH_COST_SALARY_MULTIPLIER = 1.2;
/** BEA RPP-all (US = 100) at or above this counts as high cost of living (TX is 97.4, CA is 110.72). */
const HIGH_COST_RPP_THRESHOLD = 105;

/** A starting salary and debt for a fresh life with no stated numbers, scaled up for a high cost-of-living place. */
export function randomizeStarter(place: Place, rng: () => number = Math.random): { salary: number; debt: number; creditScore: number } {
  const highCost = place.rpp.all >= HIGH_COST_RPP_THRESHOLD;
  const salaryBase = SALARY_RANGE.min + rng() * (SALARY_RANGE.max - SALARY_RANGE.min);
  const salary = Math.round(highCost ? salaryBase * HIGH_COST_SALARY_MULTIPLIER : salaryBase);
  const debt = Math.round(DEBT_RANGE.min + rng() * (DEBT_RANGE.max - DEBT_RANGE.min));
  return { salary, debt, creditScore: CREDIT_SCORE_START };
}

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

/** Monthly take-home for a gross yearly salary in the given state (real federal + state withholding, sim/tax). */
export function takeHomeFor(salary: number, state: string): number {
  const perPeriod = salary / 24;
  const w = withholdingForPaycheck({ state, wagesThisPeriod: perPeriod });
  return Math.round((perPeriod - w.federalIncomeTax - w.fica - w.stateIncomeTax) * 2);
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

/** The onboarding answers, minus the numbers a fresh (not-yet-stated) intake doesn't have yet. */
type IntakeAnswersInput = Omit<IntakeAnswers, "salary" | "debt"> & Partial<Pick<IntakeAnswers, "salary" | "debt">>;

/**
 * The player's starting life from the onboarding answers. A stated salary or
 * debt always wins; either one left unstated is filled in by
 * `randomizeStarter`, scaled to the place. A fresh life's credit score always
 * starts at `CREDIT_SCORE_START`, regardless of the seeded debts' own score.
 */
export function lifeFromIntake(a: IntakeAnswersInput, o: { place: Place; day: number; market: MarketPath; holdings?: Partial<Record<InstrumentId, number>>; rng?: () => number }): PlayerLife {
  const seeded = a.salary === undefined || a.debt === undefined ? randomizeStarter(o.place, o.rng) : undefined;
  const salary = a.salary ?? seeded!.salary;
  const debt = a.debt ?? seeded!.debt;
  const monthlyTakeHome = takeHomeFor(salary, o.place.abbr);
  const book = newBook({ debts: debtsFor(debt, o.day), agi: salary, monthlyTakeHome, strategy: "avalanche", day: o.day });
  book.profile.score = CREDIT_SCORE_START;
  // Savings sit in the high-yield account. Checking fills with the first
  // paycheck, and bills draw on savings when it runs short (Ledger.wallet).
  const accounts = defaultAccounts(o.day).map((acct) => ({ ...acct, balance: acct.id === "savings" ? a.savings : 0 }));
  return new PlayerLife({
    place: o.place,
    day: o.day,
    grossAnnual: salary,
    monthlyTakeHome,
    job: a.job,
    rent: a.rent,
    book,
    accounts,
    market: o.market,
    holdings: o.holdings,
  });
}

/** The intake as the server's profile (server/src/routes/save.ts); a skip stores no numbers. */
export function profileFromIntake(a: IntakeAnswers | null, source: ProfileSource, state: string): Omit<Profile, "displayName"> {
  if (!a) return { job: null, salary: null, rent: null, debt: null, savings: null, state, source: "skipped" };
  return { job: a.job, salary: a.salary, rent: a.rent, debt: a.debt, savings: a.savings, state, source };
}

/** The intake answers a stored profile holds, or null for a skipped intake (the sample household). */
export function answersFromProfile(p: Profile): IntakeAnswers | null {
  if (p.source === "skipped") return null;
  return completeAnswers({ job: p.job ?? "", salary: p.salary ?? undefined, rent: p.rent ?? undefined, debt: p.debt ?? undefined, savings: p.savings ?? undefined });
}
