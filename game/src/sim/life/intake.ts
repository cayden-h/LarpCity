// A new life's starting answers and the money life they build: gross pay and
// take-home, the rent, the total debt as a credit card plus a personal loan,
// and savings. Every new life starts from `defaultAnswers` (the title screen,
// ui/title.ts, only asks who's moving in); the rest of the answer helpers read
// numbers a player states, as the old voice and typed intake did.

import { creditCard, installment, newBook } from "../debt/factory.ts";
import type { Debt } from "../debt/types.ts";
import type { InstrumentId, MarketPath } from "../market/index.ts";
import type { Goal } from "../skip/types.ts";
import { withholdingForPaycheck } from "../tax/withholding.ts";
import {
  DEFAULT_CAR_INSURANCE_MONTHLY,
  DEFAULT_CAR_LOAN,
  DEFAULT_EXPENSE_TIERS,
  defaultAccounts,
  PlayerLife,
  type ExpenseCategory,
  type ExpenseTierLevel,
  type Place,
} from "./player.ts";
import { medianRent } from "./homes.ts";
import { applyOrders, currentOrders } from "../skip/orders.ts";
import type { Profile, ProfileSource } from "../save/client.ts";
import { BEGINNER_CARD_SLUGS } from "../../data/cards-beginner.ts";

import { DEFAULT_INSURANCE_PLAN_ID, INSURANCE_PLANS, type InsurancePlan } from "./insurance.ts";
export { DEFAULT_INSURANCE_PLAN_ID, INSURANCE_PLANS, type InsurancePlan };

/** The four goal categories the onboarding goal screen fills in, one goal each, permanently. */
export const REQUIRED_GOAL_KINDS = ["retirement_age", "marriage", "debt_free_by_age", "house"] as const;

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
  /** The player's name for the HUD ID card; a blank typed name falls back to "You". */
  name: string;
  /** Avatar preset chosen at onboarding; no further customization. Defaults to "male". */
  avatar: "male" | "female";
  /** Insurance tier chosen at onboarding (frontend-only for now); defaults to the middle tier. */
  insurancePlanId?: string;
  /** Beginner credit card chosen at onboarding (frontend-only for now); defaults to the first beginner card. */
  selectedCardId?: string;
  /** Emergency fund target chosen at onboarding, in months of rent, living costs, and minimum payments. Unset means no standing orders are set from intake. */
  emergencyMonths?: number;
  /** 401(k) contribution chosen at onboarding, as a share of gross pay (0.06 = 6%). */
  k401Pct?: number;
  /** Roth IRA contribution chosen at onboarding, as a share of gross pay; clamped so the yearly total never exceeds the IRS Roth limit. */
  rothPct?: number;
  /** Low/medium/high pick for each expense category, from the intake screen. Unset defaults to all-medium. */
  expenseTiers?: Record<ExpenseCategory, ExpenseTierLevel>;
  /** Set once at onboarding, permanent — no editing after (sim/skip's Goal union, one per required category). */
  goals: Goal[];
}

/** True once `goals` holds one goal of every required category (order doesn't matter, extras are fine). */
export function hasAllRequiredGoals(goals: Goal[] | undefined): goals is Goal[] {
  return REQUIRED_GOAL_KINDS.every((k) => goals?.some((g) => g.kind === k));
}

/** Goals for a life that never went through the onboarding goal screen (a skipped intake, or a profile resume with no local save — a server Profile never stores goals). */
export const DEFAULT_GOALS: Goal[] = [
  { kind: "retirement_age", targetAge: 65 },
  { kind: "marriage" },
  { kind: "debt_free_by_age", targetAge: 45 },
  { kind: "house", downPct: 0.1 },
];
// Assigned directly into PlayerLife.goals by multiple callers; frozen so none of them can mutate the shared array.
Object.freeze(DEFAULT_GOALS);

/** Caps that keep a typo or a joke answer from breaking the sim. */
export const INTAKE_LIMITS = { salary: 5_000_000, rent: 50_000, debt: 5_000_000, savings: 10_000_000 } as const;
const JOB_MAX_LENGTH = 60;
/** Debt up to this much is a credit card; the rest is a personal loan. */
export const CARD_PORTION = 5_000;
const CARD_APR = 0.2396;
const LOAN_APR = 0.11;
const LOAN_MONTHS = 60;
/**
 * Fixed auto-loan rate for the onboarding car loan: within Bankrate Q2 2026's
 * auto-loan range (4.41% super-prime to 16.11% deep-subprime, see
 * sim/debt/rates.ts's `offeredApr`), reasonable for the fixed 600 starting
 * credit score (subprime-ish) every fresh life starts with.
 */
export const CAR_LOAN_APR = 0.10;
/** The onboarding car loan's starting balance: `DEFAULT_CAR_LOAN`'s $500/mo over 72 months at `CAR_LOAN_APR`, inverting the standard amortization formula so balance and payment agree. */
export const CAR_LOAN_BALANCE = Math.round((((DEFAULT_CAR_LOAN.monthly * (1 - (1 + CAR_LOAN_APR / 12) ** -DEFAULT_CAR_LOAN.months)) / (CAR_LOAN_APR / 12)) * 100)) / 100;
const EXPENSE_CATEGORIES: ExpenseCategory[] = ["food", "houseBills", "fitness", "gas", "carMaintenance"];
const TIER_LEVELS: ExpenseTierLevel[] = ["low", "medium", "high"];

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
  if (r.avatar === "male" || r.avatar === "female") out.avatar = r.avatar;
  if (typeof r.insurancePlanId === "string" && INSURANCE_PLANS.some((p) => p.id === r.insurancePlanId)) out.insurancePlanId = r.insurancePlanId;
  if (typeof r.selectedCardId === "string" && (BEGINNER_CARD_SLUGS as readonly string[]).includes(r.selectedCardId)) out.selectedCardId = r.selectedCardId;
  if (typeof r.emergencyMonths === "number" && Number.isFinite(r.emergencyMonths) && r.emergencyMonths >= 0) out.emergencyMonths = r.emergencyMonths;
  if (typeof r.k401Pct === "number" && Number.isFinite(r.k401Pct) && r.k401Pct >= 0) out.k401Pct = r.k401Pct;
  if (typeof r.rothPct === "number" && Number.isFinite(r.rothPct) && r.rothPct >= 0) out.rothPct = r.rothPct;
  if (r.expenseTiers && typeof r.expenseTiers === "object") {
    const raw = r.expenseTiers as Record<string, unknown>;
    if (EXPENSE_CATEGORIES.every((c) => TIER_LEVELS.includes(raw[c] as ExpenseTierLevel))) {
      out.expenseTiers = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, raw[c]])) as Record<ExpenseCategory, ExpenseTierLevel>;
    }
  }
  for (const k of NUMBER_KEYS) {
    const n = parseDollars(r[k]);
    if (n !== undefined) out[k] = Math.min(Math.round(n), INTAKE_LIMITS[k]);
  }
  return out;
}

/**
 * The full answers, or null while any amount or a required goal is missing (the job, name, and
 * avatar may stay blank/default). `goals` only ever comes from the onboarding goal screen — voice
 * and typed-form answers never set it on their own.
 */
export function completeAnswers(p: Partial<IntakeAnswers>): IntakeAnswers | null {
  const { salary, rent, debt, savings, goals } = p;
  if (salary === undefined || rent === undefined || debt === undefined || savings === undefined) return null;
  if (!hasAllRequiredGoals(goals)) return null;
  return {
    job: p.job ?? "",
    salary,
    rent,
    debt,
    savings,
    name: p.name?.trim() || "You",
    avatar: p.avatar ?? "male",
    goals,
    ...(p.insurancePlanId ? { insurancePlanId: p.insurancePlanId } : {}),
    ...(p.selectedCardId ? { selectedCardId: p.selectedCardId } : {}),
    ...(p.emergencyMonths !== undefined ? { emergencyMonths: p.emergencyMonths } : {}),
    ...(p.k401Pct !== undefined ? { k401Pct: p.k401Pct } : {}),
    ...(p.rothPct !== undefined ? { rothPct: p.rothPct } : {}),
    ...(p.expenseTiers ? { expenseTiers: p.expenseTiers } : {}),
  };
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

/**
 * The onboarding's fixed car loan: `payment` a month for `months`, at
 * `CAR_LOAN_APR`. The starting balance is derived by inverting the standard
 * amortization formula (`monthlyPayment` in sim/debt/math.ts), so balance and
 * payment agree instead of one being an arbitrary guess.
 */
function carLoanDebt(o: { monthly: number; months: number }, day: number): Debt {
  const r = CAR_LOAN_APR / 12;
  const balance = Math.round(((o.monthly * (1 - (1 + r) ** -o.months)) / r) * 100) / 100;
  return installment({
    id: "car",
    kind: "auto",
    name: "Car loan",
    balance,
    apr: CAR_LOAN_APR,
    months: o.months,
    payment: o.monthly,
    day,
    openedDay: day - 30,
  });
}

/** The onboarding answers, minus the numbers a fresh (not-yet-stated) intake doesn't have yet. */
export type IntakeAnswersInput = Omit<IntakeAnswers, "salary" | "debt"> & Partial<Pick<IntakeAnswers, "salary" | "debt">>;

/** What a new life has in high-yield savings on day one (the old sample household's checking and savings together). */
export const DEFAULT_SAVINGS = 3_700;

/**
 * Every new life: only who moves in is chosen. The salary and debt are left for
 * `randomizeStarter`, the rent is the state's median, and the goals are the defaults.
 */
export function defaultAnswers(place: Place, avatar: "male" | "female"): IntakeAnswersInput {
  return { job: "", name: "You", avatar, rent: medianRent(place), savings: DEFAULT_SAVINGS, goals: DEFAULT_GOALS };
}

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
  // Every fresh life also gets a fixed car loan, separate from the randomized/stated
  // debt total debtsFor splits above (that's a different pool of debt entirely).
  book.debts.push(carLoanDebt(DEFAULT_CAR_LOAN, o.day));
  // Savings sit in the high-yield account. Checking fills with the first
  // paycheck, and bills draw on savings when it runs short (Ledger.wallet).
  const accounts = defaultAccounts(o.day).map((acct) => ({ ...acct, balance: acct.id === "savings" ? a.savings : 0 }));
  const life = new PlayerLife({
    place: o.place,
    day: o.day,
    grossAnnual: salary,
    monthlyTakeHome,
    job: a.job,
    avatar: a.avatar,
    insurancePlanId: a.insurancePlanId,
    selectedCardId: a.selectedCardId,
    expenseTiers: a.expenseTiers ?? { ...DEFAULT_EXPENSE_TIERS },
    carLoan: { ...DEFAULT_CAR_LOAN },
    carInsuranceMonthly: DEFAULT_CAR_INSURANCE_MONTHLY,
    rent: a.rent,
    book,
    accounts,
    market: o.market,
    holdings: o.holdings,
    goals: a.goals,
    name: a.name,
  });
  // The emergency-fund, 401(k), and Roth sliders on the intake screen (all optional; a
  // skipped or voice-only intake leaves the life with no standing orders at all).
  if (a.emergencyMonths !== undefined || a.k401Pct !== undefined || a.rothPct !== undefined) {
    applyOrders(life, {
      ...currentOrders(life),
      ...(a.emergencyMonths !== undefined ? { emergencyMonths: a.emergencyMonths } : {}),
      ...(a.k401Pct !== undefined ? { k401Pct: a.k401Pct } : {}),
      ...(a.rothPct !== undefined ? { rothPct: a.rothPct } : {}),
    });
  }
  return life;
}

/** The intake as the server's profile (server/src/routes/save.ts); a skip stores no numbers. */
export function profileFromIntake(a: IntakeAnswers | null, source: ProfileSource, state: string): Omit<Profile, "displayName"> {
  if (!a) return { job: null, salary: null, rent: null, debt: null, savings: null, state, source: "skipped" };
  return { job: a.job, salary: a.salary, rent: a.rent, debt: a.debt, savings: a.savings, state, source };
}

/**
 * The intake answers a stored profile holds, or null for a skipped intake (the sample household).
 * A profile never stores goals/name/avatar (local save state only, sim/skip's Goal union), so a
 * resumed profile gets `DEFAULT_GOALS` and the same name/avatar defaults a skipped intake gets —
 * not routed through `completeAnswers`, which would reject it for lacking a "chosen" goal set.
 */
export function answersFromProfile(p: Profile): IntakeAnswers | null {
  if (p.source === "skipped") return null;
  if (p.salary === null || p.rent === null || p.debt === null || p.savings === null) return null;
  return { job: p.job ?? "", salary: p.salary, rent: p.rent, debt: p.debt, savings: p.savings, name: "You", avatar: "male", goals: DEFAULT_GOALS };
}
