// The player's money life in the city. Each game day it lands paychecks,
// pays rent and living costs scaled to the current state, runs the debt
// engine through the accounts ledger's shortfall waterfall, runs any recurring
// investment, and pays savings interest on the 1st. With standing orders from
// the fast-forward setup screen (sim/skip), paychecks also fund the 401(k) and
// the emergency fund, and the crash rule watches the market on the 1st. The
// city scene calls onDay from Clock.onDay; skips and goal fast-forwards run the
// same method headless.

import {
  compareStrategies,
  fileBankruptcy,
  garnishmentRate,
  isOpen,
  owed,
  sampleHousehold,
  scoreBand,
  tickDay,
  type DebtBook,
  type DebtEvent,
  type BankruptcyResult,
  type Projection,
} from "../debt/index.ts";
import { instrument, MarketPath, type InstrumentId } from "../market/index.ts";
import { Ledger, type LedgerSave } from "../money/accounts.ts";
import type { Account, ApplicationRecord, Holding } from "../money/types.ts";
import { deepCopy } from "../rewind/copy.ts";
import { CrashWatch, PANIC_DRAWDOWN, type CrashSave } from "../skip/crash.ts";
import { LIFESTYLE_FACTOR, type StandingOrders } from "../skip/types.ts";
import { fileReturn } from "../tax/filing.ts";
import { penaltyFor } from "../tax/penalties.ts";
import type { TaxReturn } from "../tax/types.ts";
import { withholdingForPaycheck } from "../tax/withholding.ts";
import { installment } from "../debt/factory.ts";
import { cashRateOn } from "./rates.ts";
import { Twins, type TwinsSave } from "./twins.ts";
import { rngFor } from "../../engine/rng.ts";
import { BEGINNER_CARD_SLUGS } from "../../data/cards-beginner.ts";
import { PULSE_TABLE } from "../wellbeing/pulses.ts";
import { wellbeing } from "../wellbeing/index.ts";
import type { Pulse } from "../wellbeing/types.ts";

/** What the life needs to know about where the player lives (a StateInfo satisfies it). */
export interface Place {
  abbr: string;
  name: string;
  /** BEA Regional Price Parities (US = 100). */
  rpp: { all: number; goods: number; housing: number };
}

/** ACS 2024 national median gross rent (research/data/states-sample.json). */
export const US_MEDIAN_RENT = 1_487;
/**
 * National monthly living costs besides rent, from the same sample file:
 * thrifty groceries ($76/week), average electric bill ($142), gas (9.23 gal/week
 * at $4.30), plus about $300 for phone, internet, and everything else.
 */
export const US_LIVING = 950;
/** Unemployment benefits replace roughly 40% of pay (research/03). */
export const UNEMPLOYMENT_SHARE = 0.4;

/** The 5 expense categories the intake's low/medium/high toggles cover. */
export type ExpenseCategory = "food" | "houseBills" | "fitness" | "gas" | "carMaintenance";
export type ExpenseTierLevel = "low" | "medium" | "high";

/**
 * Monthly dollars for each category at each tier, at national-average cost of
 * living (place-scaled the same way `baseLiving` is, by `place.rpp.goods`).
 * The medium column sums to about $800, close to `US_LIVING` ($950) so a
 * medium-everything player's living cost doesn't wildly diverge from a life
 * that never went through intake.
 */
export const EXPENSE_TIER_AMOUNTS: Record<ExpenseCategory, Record<ExpenseTierLevel, number>> = {
  food: { low: 250, medium: 350, high: 500 },
  houseBills: { low: 150, medium: 220, high: 320 },
  fitness: { low: 0, medium: 40, high: 120 },
  gas: { low: 80, medium: 120, high: 200 },
  carMaintenance: { low: 40, medium: 70, high: 130 },
};

/** The expense tiers a fresh intake-built life defaults to when the player doesn't change anything. */
export const DEFAULT_EXPENSE_TIERS: Record<ExpenseCategory, ExpenseTierLevel> = {
  food: "medium",
  houseBills: "medium",
  fitness: "medium",
  gas: "medium",
  carMaintenance: "medium",
};

/** A car loan's terms as offered at onboarding: fixed $500/mo over 72 months. */
export const DEFAULT_CAR_LOAN = { monthly: 500, months: 72 } as const;
/** Monthly car insurance premium billed at onboarding; frontend-only default until real quotes exist. */
export const DEFAULT_CAR_INSURANCE_MONTHLY = 200;
/** Day of month car insurance bills, chosen to avoid the rent (1st) and living-costs (15th) bills. */
export const CAR_INSURANCE_BILL_DOM = 5;
/**
 * Take-home as a share of gross pay: roughly what a single filer near the
 * median keeps after federal income tax and FICA. Used only until onboarding
 * asks for gross salary (meeting 2026-09-12).
 */
export const TAKE_HOME_SHARE = 0.8;
/** 2026 401(k) employee limit (research/03). */
export const K401_LIMIT = 24_500;
/** A pre-tax contribution costs less take-home than it adds, by the 22% bracket's tax. */
export const K401_TAX_SAVING = 0.22;
/** The most common employer match: 50 cents per dollar on the first 6% of pay. */
export const MATCH_RATE = 0.5;
export const MATCH_UP_TO = 0.06;
/** 2026 Roth IRA yearly contribution limit (research/03); no employer match applies to Roth. */
export const ROTH_LIMIT = 7_500;

const ACCOUNT_NAMES = { emergency: "Emergency fund", k401: "401(k)", roth: "Roth IRA" } as const;

export type LifeEvent =
  | DebtEvent
  | { type: "paycheck"; day: number; takeHome: number; garnished: number; unemployed: boolean; retirement?: number; roth?: number; federalWithheld: number; stateWithheld: number }
  | { type: "bill"; day: number; name: string; amount: number; paid: number }
  | { type: "spend"; day: number; category: string; amount: number }
  | { type: "savings_interest"; day: number; amount: number }
  | { type: "moved"; day: number; from: string; to: string; rent: number; living: number }
  | { type: "job"; day: number; employed: boolean }
  | { type: "marriage"; day: number }
  | { type: "bankruptcy_filed"; day: number; chapter: 7 | 13 }
  | { type: "trade"; day: number; id: InstrumentId; side: "buy" | "sell"; amount: number; units: number; price: number; recurring: boolean }
  | { type: "trade_skipped"; day: number; id: InstrumentId; amount: number; reason: string }
  | { type: "bear_market"; day: number; drop: number; stocks: number }
  | { type: "market_recovered"; day: number; you: number; held: number; autopilot: number }
  | { type: "tax_ready"; day: number; year: number }
  | { type: "tax_filed"; day: number; year: number; refundOrOwed: number; auto: boolean }
  | { type: "tax_penalty"; day: number; amount: number };

export interface LifeSnapshot {
  day: number;
  cash: number;
  investments: number;
  debt: number;
  netWorth: number;
  score: number;
  wellbeing: number;
  /** Brokerage holdings at the day's prices. */
  brokerage: number;
  /** The player's investing line: brokerage plus the cash sells took out (sim/life/twins.ts). */
  you: number;
  /** The same buys, never sold. */
  held: number;
  /** The same dollars at 90/10 LTM/BOND, never sold. */
  autopilot: number;
}

/** A life's state on one day, for rewinding (sim/rewind). */
export interface LifeCheckpoint {
  day: number;
  /** A detached copy (no listeners, history, or log). */
  state: PlayerLife;
  historyLength: number;
  /** The day's history row as it was then; a trade later that day replaces it in place. */
  lastSnapshot: LifeSnapshot | null;
  logLength: number;
}

export interface LifeOptions {
  place: Place;
  /** Game day the life starts on. */
  day: number;
  /** Take-home pay per month, paid in halves on the 1st and 15th. */
  monthlyTakeHome?: number;
  age?: number;
  /** Gross yearly pay; estimated from take-home until onboarding asks for it. */
  grossAnnual?: number;
  /** Job title from onboarding. */
  job?: string;
  /** Avatar preset chosen at onboarding; no further customization. Defaults to "male". */
  avatar?: "male" | "female";
  /** Insurance tier id chosen at onboarding (frontend-only; sim/life/intake.ts INSURANCE_PLANS). Defaults to the middle tier, "silver". */
  insurancePlanId?: string;
  /** Beginner credit card slug chosen at onboarding (frontend-only; src/data/cards-beginner.ts). Defaults to the first beginner card. */
  selectedCardId?: string;
  /** One-way commute in minutes; defaults to the SOEP-inspired design approximation. */
  commuteMinutes?: number;
  /** Monthly rent the player stated in onboarding; after a move it scales with the new state's housing costs. */
  rent?: number;
  book?: DebtBook;
  accounts?: Account[];
  /** Cash rate for a date; defaults to the FRED Fed funds snapshot. */
  cashRate?: (date: Date) => number;
  /** Prices for brokerage holdings; defaults to a market path with the default seed. */
  market?: MarketPath;
  /** Dollars of each fund or stock already held on the first day, bought a year earlier. */
  holdings?: Partial<Record<InstrumentId, number>>;
  /**
   * Low/medium/high pick for each expense category, from the intake screen.
   * Defaults to all-medium for a fresh life; left `undefined` on an old
   * restored save (that predates this field) so it keeps its exact prior
   * `living` calculation instead of switching to the tier-based one.
   */
  expenseTiers?: Record<ExpenseCategory, ExpenseTierLevel>;
  /** Car loan terms offered at onboarding; defaults to `DEFAULT_CAR_LOAN` ($500/mo, 72 months). */
  carLoan?: { monthly: number; months: number };
  /** Monthly car insurance premium billed on `CAR_INSURANCE_BILL_DOM`; defaults to `DEFAULT_CAR_INSURANCE_MONTHLY`. */
  carInsuranceMonthly?: number;
}

/** A position valued at a day's price. */
export interface Position extends Holding {
  id: InstrumentId;
  price: number;
  value: number;
  gain: number;
}

/** One standing buy that runs every payday. */
export interface RecurringBuy {
  id: InstrumentId;
  amount: number;
}

export type TradeResult ={ ok: true; event: LifeEvent } | { ok: false; error: string };

/** A life as plain JSON, for the saved game (sim/save). Listeners are not saved: whoever restores the life re-attaches them. */
export interface LifeSave {
  place: Place;
  employed: boolean;
  age: number;
  monthlyTakeHome: number;
  grossAnnual: number;
  job: string;
  orders: StandingOrders | null;
  recurring: RecurringBuy[];
  today: number;
  history: LifeSnapshot[];
  /** Events from the same recent days as daily history, so the calendar's past and a rewind's fork survive a reload. */
  log: LifeEvent[];
  book: DebtBook;
  applications: ApplicationRecord[];
  ledger: LedgerSave;
  twins: TwinsSave;
  startDay: number;
  startAge: number;
  rentAnchor: { amount: number; housing: number } | null;
  crash: CrashSave;
  crashCash: number;
  lastFirst: { stock: number; bond: number } | null;
  k401Year: number;
  k401Ytd: number;
  /** Optional so a save from before the Roth IRA existed still loads, restored into the same defaults a fresh life starts with. */
  rothYear?: number;
  rothYtd?: number;
  ltmPeak: number;
  inBear: boolean;
  startUnits: [InstrumentId, number][];
  startSnap: LifeSnapshot;
  /**
   * GameEngine additions (life goals, wellbeing, taxes); all optional so a
   * save from before they existed still loads, read with the same defaults
   * the constructor otherwise sets.
   */
  relationship?: "single" | "partnered";
  commuteMinutes?: number;
  /** Avatar preset chosen at onboarding; optional so a save from before it existed still loads. */
  avatar?: "male" | "female";
  /** Insurance tier id chosen at onboarding (frontend-only); optional so a save from before it existed still loads. */
  insurancePlanId?: string;
  /** Beginner credit card slug chosen at onboarding (frontend-only); optional so a save from before it existed still loads. */
  selectedCardId?: string;
  reemployedDay?: number | null;
  pulses?: Pulse[];
  taxYear?: number;
  wagesYtdAmount?: number;
  federalWithheldYtd?: number;
  stateWithheldYtd?: number;
  priorYearWages?: number;
  priorYearFederalWithheld?: number;
  priorYearStateWithheld?: number;
  priorYearSnapshotYear?: number | null;
  pendingReturn?: TaxReturn | null;
  taxReadyDay?: number | null;
  unpaidTax?: { originalOwed: number; amount: number; dueDay: number; filedDay: number | null; penaltyCharged: number } | null;
  /** Saved as arrays (JSON has no Set); restored into a Set. */
  convertedTaxDueDays?: number[];
  marriageRollYears?: number[];
  bankruptcyPulseDays?: number[];
  /** Optional so a save from before expense tiers existed still loads with the legacy `living` calculation (see `LifeOptions.expenseTiers`). */
  expenseTiers?: Record<ExpenseCategory, ExpenseTierLevel>;
  /** Optional so a save from before car loan defaults existed still loads with its own defaults. */
  carLoan?: { monthly: number; months: number };
  /** Optional so a save from before car insurance existed still loads with its own default. */
  carInsuranceMonthly?: number;
}

/** Days of daily history a saved player life keeps; older days keep every 7th. */
export const SAVE_DAILY_DAYS = 400;

/** History for a save: every day in the last `keepDaily` days before `today`, and every 7th day before that. */
export function compactHistory(history: LifeSnapshot[], today: number, keepDaily: number): LifeSnapshot[] {
  return history.filter((s) => s.day > today - keepDaily || s.day % 7 === 0);
}

/** Checking, a high-yield savings account, an emergency fund, an empty brokerage account, and an empty 401(k). */
export function defaultAccounts(day: number): Account[] {
  return [
    { id: "checking", kind: "checking", name: "Checking", balance: 1_200, apy: 0.0001, openedDay: day - 1_500 },
    { id: "savings", kind: "savings", name: "High-yield savings", balance: 2_500, apy: 0.04, openedDay: day - 900 },
    { id: "emergency", kind: "emergency", name: "Emergency fund", balance: 0, apy: 0.04, openedDay: day },
    { id: "brokerage", kind: "brokerage", name: "Brokerage", balance: 0, apy: 0, openedDay: day, holdings: {} },
    { id: "k401", kind: "k401", name: "401(k)", balance: 0, apy: 0, openedDay: day },
    { id: "roth", kind: "roth_ira", name: "Roth IRA", balance: 0, apy: 0, openedDay: day },
  ];
}

/**
 * The player's starting brokerage: a total-market fund and a little of the
 * hyped AI stock, bought a year before the game starts, so net worth moves
 * with the market from the first day the way a real portfolio does.
 */
export const STARTER_PORTFOLIO: Partial<Record<InstrumentId, number>> = { LTM: 6_000, NNST: 800 };

/** Funds that hold bonds, not stocks: a crash sale keeps them and the bear market doesn't count them. */
export const BOND_FUNDS: ReadonlySet<InstrumentId> = new Set<InstrumentId>(["BOND"]);

/** One stock over this share of the portfolio earns the desk's concentration warning. */
export const CONCENTRATION_LIMIT = 0.2;

const round2 = (x: number) => Math.round(x * 100) / 100;
const CASH_KINDS = new Set(["checking", "savings", "emergency"]);
/** Fields a detached copy starts empty: it runs on its own and keeps no past. */
const FRESH_ON_COPY = new Set(["history", "log", "listeners"]);
/** Smallest trade the brokerage accepts, like most apps' $1 fractional minimum. */
export const MIN_TRADE = 1;

/** Home tiers match engine/hero.ts HOME_TIERS: tent, studio, small house, townhouse, large house, villa. */
export const HOME_TIER_NET_WORTH = [25_000, 100_000, 250_000, 1_000_000] as const;

export class PlayerLife {
  readonly ledger: Ledger;
  readonly market: MarketPath;
  book: DebtBook;
  place: Place;
  employed = true;
  relationship: "single" | "partnered" = "single";
  /** Static until the game has job and home locations; 23 is a SOEP-inspired design default, not a US average. */
  commuteMinutes: number;
  reemployedDay: number | null = null;
  readonly pulses: Pulse[] = [];
  /** Age in years, advancing with the calendar. */
  age: number;
  monthlyTakeHome: number;
  /** Gross yearly pay, for the 401(k), its match, and the mortgage test. */
  grossAnnual: number;
  /** Job title from onboarding; empty for the sample household. */
  job: string;
  /** Avatar preset chosen at onboarding ("male" or "female"); no further customization. */
  avatar: "male" | "female" = "male";
  /** Insurance tier chosen at onboarding (sim/life/intake.ts INSURANCE_PLANS); frontend-only for now, stored inert until P3's injury/hospital events read it. */
  insurancePlanId = "silver";
  /** Beginner credit card chosen at onboarding (src/data/cards-beginner.ts); frontend-only for now, no card is opened from this pick. */
  selectedCardId: string = BEGINNER_CARD_SLUGS[0];
  /**
   * Low/medium/high pick for each expense category, from the intake screen.
   * `undefined` only for a life restored from a save that predates this
   * field (or built outside intake, e.g. `sampleHousehold`); the `living`
   * getter falls back to the legacy lifestyle-factor calculation in that
   * case. A fresh life built through the constructor's non-restore branch
   * always has this set (defaulting to all "medium"), so it always uses the
   * tier-based calculation.
   */
  expenseTiers?: Record<ExpenseCategory, ExpenseTierLevel>;
  /** Car loan terms offered at onboarding (see `intake.ts`'s car loan debt). */
  carLoan: { monthly: number; months: number } = { ...DEFAULT_CAR_LOAN };
  /** Monthly car insurance premium, billed on `CAR_INSURANCE_BILL_DOM`. */
  carInsuranceMonthly: number = DEFAULT_CAR_INSURANCE_MONTHLY;
  /** The plan from the fast-forward setup screen (sim/skip), in force from the day it was set. */
  orders: StandingOrders | null = null;
  /**
   * Buys to make on every payday once bills and debt payments are covered, in
   * order (a stock/bond mix is two entries). Empty = off.
   */
  recurring: RecurringBuy[] = [];
  /** The latest game day the life has seen; holdings are valued at this day's prices. */
  today: number;
  readonly history: LifeSnapshot[] = [];
  /**
   * Every card and loan application, oldest first, for the issuer rules (5/24
   * and the like) and sign-up bonus eligibility. Ordinary state: saved, and a
   * rewind to before an application forgets it.
   */
  applications: ApplicationRecord[] = [];
  /** Every event the life has emitted, in order (the calendar reads it; a rewind truncates it). */
  readonly log: LifeEvent[] = [];
  /**
   * True while days replay for a rewind: events still go in the log, but no listener hears them.
   * Not saved: it is only true inside `quietly`, and a save is never taken there.
   */
  private muted = false;
  /** Shadow portfolios of the player's buys, for "if you had held" and "autopilot". */
  readonly twins: Twins;
  private readonly startDay: number;
  private readonly startAge: number;
  /** The stated rent and the housing price parity it was stated at; null means the state's median rent. */
  private readonly rentAnchor: { amount: number; housing: number } | null;
  private readonly cashRate: (date: Date) => number;
  private readonly listeners: ((events: LifeEvent[], life: PlayerLife) => void)[] = [];
  private readonly crash: CrashWatch;
  /** Proceeds of the crash rule's panic sale, waiting to buy back in. */
  private crashCash = 0;
  /** Stock and bond prices on the last 1st of the month, for the 401(k)'s monthly return. */
  private lastFirst: { stock: number; bond: number } | null = null;
  private k401Year = -1;
  private k401Ytd = 0;
  private rothYear = -1;
  private rothYtd = 0;
  private taxYear = 0; // 0 is a sentinel meaning "not initialized yet"; set on first payday
  private wagesYtdAmount = 0;
  private federalWithheldYtd = 0;
  private stateWithheldYtd = 0;
  /**
   * The just-closed calendar year's final wages/withholding, snapshotted at
   * the January 1 reset so the April 15 filing check (which runs after that
   * reset, in the same new year) reads the year that actually closed, not
   * whatever has re-accumulated since. `priorYearSnapshotYear` records which
   * year the snapshot is *for*, so the April 15 block can tell a real
   * snapshot apart from "no reset has ever happened" (e.g. a life whose very
   * first April 15 arrives before its first January 1) and fall back to the
   * live accumulators in that case.
   */
  private priorYearWages = 0;
  private priorYearFederalWithheld = 0;
  private priorYearStateWithheld = 0;
  private priorYearSnapshotYear: number | null = null;
  private pendingReturn: TaxReturn | null = null;
  /** The day the pending return became ready (~April 15) — the reference point penalties.ts measures lateness from, independent of when (or whether) the player actually files. */
  private taxReadyDay: number | null = null;
  /**
   * `originalOwed` is fixed (the actual unpaid tax) — `penaltyFor` (Task 11)
   * always computes off this, never off the inflated running balance, so
   * penalties are never charged on top of previously-added penalties. `amount`
   * is the running balance (original + all penalties/interest so far) that
   * becomes the eventual Debt's opening balance. `penaltyCharged` is how much
   * of `penaltyFor`'s cumulative total has already been folded into `amount`,
   * so each monthly tick adds only that month's new increment.
   */
  private unpaidTax: { originalOwed: number; amount: number; dueDay: number; filedDay: number | null; penaltyCharged: number } | null = null;

  /** dueDay values whose unpaid tax has already converted to a Debt, so a later year's distinct balance is never blocked by an older year's still-open "IRS balance" Debt. */
  private convertedTaxDueDays = new Set<number>();
  /** Calendar years already checked for marriage, preventing rerolls on duplicate ticks. */
  private readonly marriageRollYears = new Set<number>();
  private readonly bankruptcyPulseDays = new Set<number>();
  /** Coverage is an employment-derived approximation until insurance shopping exists. */
  get insured(): boolean {
    return this.employed;
  }

  /** Gross wages earned so far in the current calendar year (resets each January 1 payday); shown on the Taxes tab. */
  wagesYtd(): number {
    return this.wagesYtdAmount;
  }
  /** Highest LTM close seen, for the bear-market line. */
  private ltmPeak: number;
  /** A bear_market event fired and the market hasn't set a new high since. */
  private inBear = false;
  /** Units of each starting holding, for pastSnapshots. */
  private readonly startUnits: [InstrumentId, number][] = [];
  /** Balances on the first day, before anything the player does that day. */
  private readonly startSnap: LifeSnapshot;

  constructor(o: LifeOptions, saved?: LifeSave) {
    this.market = o.market ?? new MarketPath();
    this.cashRate = o.cashRate ?? cashRateOn;
    if (saved) {
      const s = structuredClone(saved);
      this.place = s.place;
      this.startDay = s.startDay;
      this.startAge = s.startAge;
      this.age = s.age;
      this.today = s.today;
      this.book = s.book;
      this.applications = s.applications ?? [];
      this.monthlyTakeHome = s.monthlyTakeHome;
      this.grossAnnual = s.grossAnnual;
      this.job = s.job;
      this.avatar = s.avatar ?? "male";
      this.insurancePlanId = s.insurancePlanId ?? "silver";
      this.selectedCardId = s.selectedCardId ?? BEGINNER_CARD_SLUGS[0];
      // Left as-is (undefined for an old save that predates this field), not
      // defaulted: defaulting here would switch every old restored save onto
      // the new tier-based `living` calculation, shifting its living costs
      // unexpectedly. Only a FRESH life (below) defaults to all-medium.
      this.expenseTiers = s.expenseTiers;
      this.carLoan = s.carLoan ?? { ...DEFAULT_CAR_LOAN };
      this.carInsuranceMonthly = s.carInsuranceMonthly ?? DEFAULT_CAR_INSURANCE_MONTHLY;
      this.employed = s.employed;
      this.rentAnchor = s.rentAnchor;
      this.orders = s.orders;
      this.recurring = s.recurring;
      this.ledger = Ledger.fromSave(s.ledger);
      this.twins = Twins.fromSave(s.twins, this.market);
      this.crash = CrashWatch.fromSave(s.crash);
      this.crashCash = s.crashCash;
      this.lastFirst = s.lastFirst;
      this.k401Year = s.k401Year;
      this.k401Ytd = s.k401Ytd;
      this.rothYear = s.rothYear ?? -1;
      this.rothYtd = s.rothYtd ?? 0;
      this.ltmPeak = s.ltmPeak;
      this.inBear = s.inBear;
      this.startUnits.push(...s.startUnits);
      this.history.push(...s.history);
      this.log.push(...s.log);
      this.startSnap = s.startSnap;
      // GameEngine additions: optional, so an older save (without them) restores the same defaults
      // the constructor otherwise sets for a fresh life.
      this.relationship = s.relationship ?? "single";
      this.commuteMinutes = s.commuteMinutes ?? 23;
      this.reemployedDay = s.reemployedDay ?? null;
      this.pulses.push(...(s.pulses ?? []));
      this.taxYear = s.taxYear ?? 0;
      this.wagesYtdAmount = s.wagesYtdAmount ?? 0;
      this.federalWithheldYtd = s.federalWithheldYtd ?? 0;
      this.stateWithheldYtd = s.stateWithheldYtd ?? 0;
      this.priorYearWages = s.priorYearWages ?? 0;
      this.priorYearFederalWithheld = s.priorYearFederalWithheld ?? 0;
      this.priorYearStateWithheld = s.priorYearStateWithheld ?? 0;
      this.priorYearSnapshotYear = s.priorYearSnapshotYear ?? null;
      this.pendingReturn = s.pendingReturn ?? null;
      this.taxReadyDay = s.taxReadyDay ?? null;
      this.unpaidTax = s.unpaidTax ?? null;
      for (const d of s.convertedTaxDueDays ?? []) this.convertedTaxDueDays.add(d);
      for (const y of s.marriageRollYears ?? []) this.marriageRollYears.add(y);
      for (const d of s.bankruptcyPulseDays ?? []) this.bankruptcyPulseDays.add(d);
      return;
    }
    this.crash = new CrashWatch();
    this.place = o.place;
    this.startDay = o.day;
    this.startAge = o.age ?? 22;
    this.age = this.startAge;
    this.today = o.day;
    this.book = o.book ?? sampleHousehold(o.day, "avalanche", 300);
    this.monthlyTakeHome = o.monthlyTakeHome ?? this.book.monthlyTakeHome;
    this.grossAnnual = o.grossAnnual ?? Math.round((this.monthlyTakeHome * 12) / TAKE_HOME_SHARE);
    this.job = o.job ?? "";
    this.avatar = o.avatar ?? "male";
    this.insurancePlanId = o.insurancePlanId ?? "silver";
    this.selectedCardId = o.selectedCardId ?? BEGINNER_CARD_SLUGS[0];
    // A fresh life always gets a tier set (defaulting to all-medium), so it
    // always uses the tier-based `living` calculation, not the legacy one.
    this.expenseTiers = o.expenseTiers ?? { ...DEFAULT_EXPENSE_TIERS };
    this.carLoan = o.carLoan ?? { ...DEFAULT_CAR_LOAN };
    this.carInsuranceMonthly = o.carInsuranceMonthly ?? DEFAULT_CAR_INSURANCE_MONTHLY;
    this.commuteMinutes = o.commuteMinutes ?? 23;
    this.rentAnchor = o.rent === undefined ? null : { amount: o.rent, housing: o.place.rpp.housing };
    // The engine's bankruptcy test compares minimums with the book's take-home, so keep them in sync.
    this.book.monthlyTakeHome = this.monthlyTakeHome;
    this.ledger = new Ledger(o.accounts ?? defaultAccounts(o.day));
    this.ltmPeak = this.market.price("LTM", o.day);
    this.twins = new Twins(this.market);
    if (o.holdings) this.seedHoldings(o.holdings, o.day);
    this.startSnap = this.snapshot(o.day);
    this.record(o.day);
  }

  /** The life from a save, on `market` (rebuilt from the save's seed; it isn't stored). */
  static fromSave(s: LifeSave, o: { market: MarketPath; cashRate?: (date: Date) => number }): PlayerLife {
    return new PlayerLife({ place: s.place, day: s.startDay, market: o.market, cashRate: o.cashRate }, s);
  }

  /** Everything needed to carry on from today, as plain JSON; history keeps `keepDaily` days daily and weekly before. */
  toSave(keepDaily = SAVE_DAILY_DAYS): LifeSave {
    // A JSON round trip, not structuredClone: the save is exactly what the server
    // stores, so a value JSON can't carry (a key set to undefined, NaN) shows up here.
    const save: LifeSave = {
      place: { abbr: this.place.abbr, name: this.place.name, rpp: this.place.rpp },
      employed: this.employed,
      age: this.age,
      monthlyTakeHome: this.monthlyTakeHome,
      grossAnnual: this.grossAnnual,
      job: this.job,
      avatar: this.avatar,
      insurancePlanId: this.insurancePlanId,
      selectedCardId: this.selectedCardId,
      expenseTiers: this.expenseTiers,
      carLoan: this.carLoan,
      carInsuranceMonthly: this.carInsuranceMonthly,
      orders: this.orders,
      recurring: this.recurring,
      today: this.today,
      history: compactHistory(this.history, this.today, keepDaily),
      log: this.log.filter((e) => e.day > this.today - keepDaily),
      book: this.book,
      applications: this.applications,
      ledger: this.ledger.toSave(),
      twins: this.twins.toSave(),
      startDay: this.startDay,
      startAge: this.startAge,
      rentAnchor: this.rentAnchor,
      crash: this.crash.toSave(),
      crashCash: this.crashCash,
      lastFirst: this.lastFirst,
      k401Year: this.k401Year,
      k401Ytd: this.k401Ytd,
      rothYear: this.rothYear,
      rothYtd: this.rothYtd,
      ltmPeak: this.ltmPeak,
      inBear: this.inBear,
      startUnits: this.startUnits,
      startSnap: this.startSnap,
      relationship: this.relationship,
      commuteMinutes: this.commuteMinutes,
      reemployedDay: this.reemployedDay,
      pulses: this.pulses,
      taxYear: this.taxYear,
      wagesYtdAmount: this.wagesYtdAmount,
      federalWithheldYtd: this.federalWithheldYtd,
      stateWithheldYtd: this.stateWithheldYtd,
      priorYearWages: this.priorYearWages,
      priorYearFederalWithheld: this.priorYearFederalWithheld,
      priorYearStateWithheld: this.priorYearStateWithheld,
      priorYearSnapshotYear: this.priorYearSnapshotYear,
      pendingReturn: this.pendingReturn,
      taxReadyDay: this.taxReadyDay,
      unpaidTax: this.unpaidTax,
      convertedTaxDueDays: [...this.convertedTaxDueDays],
      marriageRollYears: [...this.marriageRollYears],
      bankruptcyPulseDays: [...this.bankruptcyPulseDays],
    };
    return JSON.parse(JSON.stringify(save));
  }

  /**
   * Snapshots for the days before the life began, so charts have a past: cash,
   * debt, and score as they were on the first day, and the starting holdings at
   * each day's real price. Separate from `history`, which holds only days lived.
   * The investing comparison starts on the first day, so before it `held` and
   * `autopilot` equal `you`, the starting brokerage at that day's price.
   */
  pastSnapshots(from: number): LifeSnapshot[] {
    const first = this.startSnap;
    const held = (d: number) => this.startUnits.reduce((s, [id, units]) => s + units * this.market.price(id, d), 0);
    const other = first.investments - held(this.startDay);
    const otherBrokerage = first.brokerage - held(this.startDay);
    const out: LifeSnapshot[] = [];
    for (let d = Math.max(from, this.market.firstDay); d < this.startDay; d++) {
      const investments = round2(other + held(d));
      const brokerage = round2(otherBrokerage + held(d));
      // Nothing was sold before the start, and the lines only split after it.
      const you = this.twins.you(brokerage);
      out.push({
        day: d,
        cash: first.cash,
        investments,
        debt: first.debt,
        netWorth: round2(first.cash + investments - first.debt),
        score: first.score,
        wellbeing: first.wellbeing,
        brokerage,
        you,
        held: you,
        autopilot: you,
      });
    }
    return out;
  }

  /** Monthly rent for the current state: the stated rent (rescaled after a move), or the state's median. */
  get rent(): number {
    if (this.rentAnchor) return Math.round((this.rentAnchor.amount * this.place.rpp.housing) / this.rentAnchor.housing);
    return Math.round((US_MEDIAN_RENT * this.place.rpp.housing) / 100);
  }

  /** Monthly living costs besides rent for the current state, at a normal lifestyle. */
  get baseLiving(): number {
    return Math.round((US_LIVING * this.place.rpp.goods) / 100);
  }

  /**
   * Monthly living costs besides rent. When the intake's expense tiers are
   * set (every fresh life; see `expenseTiers`), this is the sum of each
   * category's tier amount, place-scaled the same way `baseLiving` is. That
   * replaces the legacy lifestyle-factor calculation entirely, so there is
   * exactly one source of truth for `living` at any given time (no double
   * counting). Only a life without tiers (an old restored save, or one built
   * outside intake, e.g. `sampleHousehold`) falls back to the legacy
   * `baseLiving * LIFESTYLE_FACTOR[...]` formula.
   */
  get living(): number {
    if (this.expenseTiers) {
      const tiers = this.expenseTiers;
      const total = (Object.keys(EXPENSE_TIER_AMOUNTS) as ExpenseCategory[]).reduce(
        (s, cat) => s + EXPENSE_TIER_AMOUNTS[cat][tiers[cat]],
        0,
      );
      return Math.round((total * this.place.rpp.goods) / 100);
    }
    return Math.round(this.baseLiving * LIFESTYLE_FACTOR[this.orders?.lifestyle ?? "normal"]);
  }

  cash(): number {
    let s = 0;
    for (const a of this.ledger.accounts.values()) if (CASH_KINDS.has(a.kind)) s += a.balance;
    return round2(s);
  }

  /** Brokerage and retirement balances plus holdings at today's prices. */
  investments(): number {
    return this.investmentsWith(this.positions());
  }

  /** Brokerage and retirement balances plus the given positions' value. */
  private investmentsWith(positions: Position[]): number {
    let s = 0;
    for (const a of this.ledger.accounts.values()) if (!CASH_KINDS.has(a.kind)) s += a.balance;
    return round2(s + positions.reduce((t, p) => t + p.value, 0));
  }

  /** Money in checking that can buy investments right now. */
  buyingPower(): number {
    return round2(Math.max(0, this.ledger.get("checking").balance));
  }

  positions(day = this.today): Position[] {
    const holdings = this.brokerage()?.holdings ?? {};
    return Object.entries(holdings)
      .filter(([, h]) => h.units > 1e-9)
      .map(([id, h]) => {
        const price = this.market.price(id as InstrumentId, day);
        const value = round2(h.units * price);
        return { id: id as InstrumentId, units: h.units, cost: h.cost, price, value, gain: round2(value - h.cost) };
      });
  }

  position(id: InstrumentId): Position | undefined {
    return this.positions().find((p) => p.id === id);
  }

  /** Every position that rides the stock market: all of them but the bond funds. */
  stockPositions(day = this.today): Position[] {
    return this.positions(day).filter((p) => !BOND_FUNDS.has(p.id));
  }

  /** The biggest single stock (not a fund) when it is over `limit` of the portfolio, or null. */
  concentration(limit = CONCENTRATION_LIMIT, day = this.today): { id: InstrumentId; share: number } | null {
    const positions = this.positions(day);
    const total = positions.reduce((s, p) => s + p.value, 0);
    if (total <= 0) return null;
    const top = positions.filter((p) => instrument(p.id).kind === "stock").sort((a, b) => b.value - a.value)[0];
    return top && top.value / total > limit ? { id: top.id, share: top.value / total } : null;
  }

  /** Buys `amount` dollars of an instrument from checking at today's price (fractional units). */
  buy(id: InstrumentId, amount: number, day = this.today, recurring = false): TradeResult {
    const result = this.fill(id, "buy", amount, day, recurring);
    if (result.ok) {
      this.record(day);
      this.emit([result.event]);
    }
    return result;
  }

  /** Sells `amount` dollars of an instrument (or all of it) into checking at today's price. */
  sell(id: InstrumentId, amount: number | "all", day = this.today): TradeResult {
    const pos = this.position(id);
    if (!pos) return { ok: false, error: "You don't own any." };
    const result = this.fill(id, "sell", amount === "all" ? pos.value : amount, day, false, amount === "all");
    if (result.ok) {
      this.record(day);
      this.emit([result.event]);
    }
    return result;
  }

  totalDebt(): number {
    return round2(this.book.debts.filter(isOpen).reduce((s, d) => s + owed(d), 0));
  }

  netWorth(): number {
    return round2(this.cash() + this.investments() - this.totalDebt());
  }

  /** Monthly minimum payments across open debts. */
  minimums(): number {
    return round2(
      this.book.debts.filter(isOpen).reduce((s, d) => s + (d.kind === "credit_card" ? d.minimumDue ?? 0 : d.scheduledPayment ?? 0), 0),
    );
  }

  /** Rent, living costs, car insurance, and minimum payments: what an emergency fund month has to cover. */
  monthlyExpenses(): number {
    return round2(this.rent + this.living + this.carInsuranceMonthly + this.minimums());
  }

  /** Debt-to-income: minimum payments over take-home pay. */
  dti(): number {
    return this.monthlyTakeHome > 0 ? this.minimums() / this.monthlyTakeHome : 0;
  }

  projection(): Projection {
    return compareStrategies(this.book.debts, this.book.extraMonthly)[this.book.strategy];
  }

  /** The home the city should show: a tent after bankruptcy or collections, then by net worth. */
  homeTier(): number {
    const broke = this.book.profile.bankruptcy !== undefined || this.book.debts.some((d) => d.status === "collections");
    if (broke) return 0;
    const nw = this.netWorth();
    let tier = 1;
    for (const floor of HOME_TIER_NET_WORTH) if (nw >= floor) tier++;
    return tier;
  }

  scoreBand(): string {
    return scoreBand(this.book.profile.score);
  }

  onEvents(fn: (events: LifeEvent[], life: PlayerLife) => void): void {
    this.listeners.push(fn);
  }

  /** Runs `fn` (days replayed for a rewind) without telling any listener; the log still records. */
  quietly(fn: () => void): void {
    const was = this.muted;
    this.muted = true;
    try {
      fn();
    } finally {
      this.muted = was;
    }
  }

  /** A copy of this life that runs on its own: the same state, but no listeners, history, or log. */
  detached(): PlayerLife {
    const self = this as unknown as Record<string, unknown>;
    const copy = Object.create(PlayerLife.prototype) as Record<string, unknown>;
    const seen = new Map<unknown, unknown>();
    for (const k of Object.keys(self)) copy[k] = FRESH_ON_COPY.has(k) ? [] : deepCopy(self[k], seen);
    return copy as unknown as PlayerLife;
  }

  /** Today's state, to come back to later with `restore`. Taken right after a day's tick, it's that day's morning. */
  checkpoint(): LifeCheckpoint {
    const last = this.history[this.history.length - 1];
    return { day: this.today, state: this.detached(), historyLength: this.history.length, lastSnapshot: last ? { ...last } : null, logLength: this.log.length };
  }

  /**
   * Puts a checkpoint's state back into this same life, so everything holding
   * it (the desk, the recorder, the bank mirror) keeps working. History and
   * the log are cut back to where they were; the checkpoint stays reusable.
   */
  restore(cp: LifeCheckpoint): void {
    const from = cp.state.detached() as unknown as Record<string, unknown>;
    const self = this as unknown as Record<string, unknown>;
    for (const k of Object.keys(from)) if (!FRESH_ON_COPY.has(k)) self[k] = from[k];
    this.history.length = cp.historyLength;
    // A trade later that day replaced the day's row; put the morning's back.
    if (cp.lastSnapshot) this.history[cp.historyLength - 1] = { ...cp.lastSnapshot };
    this.log.length = cp.logLength;
  }

  /**
   * A one-off discretionary purchase outside the daily bill/payday cycle
   * (sim/npcs' spending-habit engine calls this). Goes through the same
   * checking -> savings -> emergency waterfall as a bill, so it can never
   * overdraw, and emits like any other event so the bank mirror picks it up.
   */
  spend(day: number, category: string, amount: number): LifeEvent {
    const paid = this.ledger.wallet().withdraw(amount, category);
    const event: LifeEvent = { type: "spend", day, category, amount: paid };
    this.record(day);
    this.emit([event]);
    return event;
  }

  /** One game day. `date` is the calendar date of `day`. */
  onDay(day: number, date: Date): LifeEvent[] {
    const events: LifeEvent[] = [];
    this.today = day;
    this.age = this.startAge + (day - this.startDay) / 365.25;
    this.ledger.settle(day);
    const wallet = this.ledger.wallet();
    const dom = date.getDate();
    const payday = dom === 1 || dom === 15;

    const year = date.getFullYear();
    if (this.relationship === "single" && dom === 1 && date.getMonth() === 0 && !this.marriageRollYears.has(year)) {
      this.marriageRollYears.add(year);
      // Gameplay placeholder pending age-banded marriage-rate calibration.
      const ANNUAL_MARRIAGE_CHANCE = 0.08;
      if (rngFor("marriage", this.market.seed, year)() < ANNUAL_MARRIAGE_CHANCE) {
        this.relationship = "partnered";
        this.addPulse(PULSE_TABLE.marriage.p0, PULSE_TABLE.marriage.halfLifeDays, day);
        events.push({ type: "marriage", day });
      }
    }

    if (payday) {
      if (year !== this.taxYear) {
        if (this.taxYear !== 0) {
          this.priorYearWages = this.wagesYtdAmount;
          this.priorYearFederalWithheld = this.federalWithheldYtd;
          this.priorYearStateWithheld = this.stateWithheldYtd;
          this.priorYearSnapshotYear = this.taxYear;
        }
        this.taxYear = year;
        this.wagesYtdAmount = 0;
        this.federalWithheldYtd = 0;
        this.stateWithheldYtd = 0;
      }
      const grossThisPeriod = (this.grossAnnual / 24) * (this.employed ? 1 : UNEMPLOYMENT_SHARE);
      const withheld = withholdingForPaycheck({ state: this.place.abbr, wagesThisPeriod: grossThisPeriod, wagesYtdBefore: this.wagesYtdAmount });
      this.wagesYtdAmount = round2(this.wagesYtdAmount + grossThisPeriod);
      this.federalWithheldYtd = round2(this.federalWithheldYtd + withheld.federalIncomeTax);
      this.stateWithheldYtd = round2(this.stateWithheldYtd + withheld.stateIncomeTax);
      const pay = round2(grossThisPeriod - withheld.federalIncomeTax - withheld.fica - withheld.stateIncomeTax);
      const garnished = round2(pay * garnishmentRate(this.book));
      const retirement = this.contribute401k(date);
      const roth = this.contributeRoth(date);
      const takeHome = round2(pay - retirement.cost - roth.cost - garnished);
      const checking = this.ledger.get("checking");
      checking.balance = round2(checking.balance + takeHome);
      events.push({
        type: "paycheck", day, takeHome, garnished, unemployed: !this.employed, retirement: retirement.added, roth: roth.added,
        federalWithheld: withheld.federalIncomeTax, stateWithheld: withheld.stateIncomeTax,
      });
    }
    // Rent on the 1st, car insurance on the 5th, and living costs on the 15th
    // come before debt payments; each is its own bill event.
    const bills: { name: string; amount: number }[] = [];
    if (dom === 1) bills.push({ name: "Rent", amount: this.rent });
    if (dom === CAR_INSURANCE_BILL_DOM) bills.push({ name: "Car insurance", amount: this.carInsuranceMonthly });
    if (dom === 15) bills.push({ name: "Living costs", amount: this.living });
    for (const bill of bills) events.push({ type: "bill", day, name: bill.name, amount: bill.amount, paid: wallet.withdraw(bill.amount, bill.name) });

    events.push(...tickDay(this.book, { day, date, env: { cashRateAnnual: this.cashRate(date) }, wallet }));

    // The plan's emergency fund fills before anything is invested.
    if (dom === 15 && this.orders) this.topUpEmergency();

    // Recurring investments come last, from whatever checking has left, so they never starve a bill.
    if (payday) {
      // After a panic sale, the crash rule buys only the stocks it still holds until it buys back in.
      const held = this.orders ? this.crash.held(this.orders.crashRule) : 1;
      for (const { id, amount } of this.recurring) {
        const dollars = id === "BOND" ? amount : round2(amount * held);
        if (held < 1 && id !== "BOND" && dollars < MIN_TRADE) continue;
        const r = this.fill(id, "buy", dollars, day, true);
        events.push(r.ok ? r.event : { type: "trade_skipped", day, id, amount: dollars, reason: r.error });
      }
    }

    if (dom === 1) {
      const interest = this.ledger.payInterest();
      this.ledger.newMonth();
      if (interest > 0) events.push({ type: "savings_interest", day, amount: interest });
      if (this.orders) events.push(...this.onFirstOfMonth(day));
      this.tickTaxPenalty(day, events);
    }

    if (date.getMonth() === 3 && date.getDate() === 15 && !this.pendingReturn) {
      const priorYear = date.getFullYear() - 1;
      // Normally the January 1 reset already snapshotted the year that just
      // closed. But if this life's first April 15 arrives before its first
      // January 1 (it started partway through its very first year, and that
      // year hasn't closed yet), there is no snapshot for `priorYear` — the
      // live accumulators still hold that partial year's data, so use them.
      const useSnapshot = this.priorYearSnapshotYear === priorYear;
      this.pendingReturn = fileReturn({
        year: priorYear,
        state: this.place.abbr,
        wagesYtd: useSnapshot ? this.priorYearWages : this.wagesYtdAmount,
        federalWithheldYtd: useSnapshot ? this.priorYearFederalWithheld : this.federalWithheldYtd,
        stateWithheldYtd: useSnapshot ? this.priorYearStateWithheld : this.stateWithheldYtd,
      });
      this.taxReadyDay = day;
      events.push({ type: "tax_ready", day, year: priorYear });
    }

    events.push(...this.watchMarket(day));
    this.record(day);
    this.emit(events);
    return events;
  }

  /**
   * Runs days headless (skips). Stops early on bankruptcy, the meeting's rule;
   * everything else resolves by the standing strategy and the shortfall
   * waterfall. Goal fast-forwards use sim/skip's runSkip, which adds the goal
   * and age stops.
   */
  runHeadless(fromDay: number, days: number, startDate: Date): { daysRun: number; stoppedBy: "bankruptcy" | null; events: LifeEvent[] } {
    const all: LifeEvent[] = [];
    const date = new Date(startDate);
    for (let i = 1; i <= days; i++) {
      date.setDate(date.getDate() + 1);
      const events = this.onDay(fromDay + i, new Date(date));
      all.push(...events);
      const filed = this.autoFilePending(fromDay + i);
      if (filed) all.push(filed);
      if (this.stopsSkip(events)) return { daysRun: i, stoppedBy: "bankruptcy", events: all };
    }
    return { daysRun: days, stoppedBy: null, events: all };
  }

  /** Bankruptcy stops skips and fast-forwards and pauses time. */
  stopsSkip(events: LifeEvent[]): boolean {
    return events.some((e) => e.type === "bankruptcy_eligible");
  }

  /** Events that pause time for a decision in the desk. */
  needsDecision(events: LifeEvent[]): boolean {
    return events.some((e) => e.type === "cannot_cover" || e.type === "bankruptcy_eligible" || e.type === "bear_market");
  }

  setPlace(place: Place, day: number): LifeEvent {
    const from = this.place.abbr;
    this.place = place;
    const e: LifeEvent = { type: "moved", day, from, to: place.abbr, rent: this.rent, living: this.living };
    this.record(day);
    this.emit([e]);
    return e;
  }

  setEmployed(employed: boolean, day: number): LifeEvent {
    if (employed === this.employed) {
      const unchanged: LifeEvent = { type: "job", day, employed };
      this.emit([unchanged]);
      return unchanged;
    }
    if (employed) this.reemployedDay = day;
    else this.addPulse(PULSE_TABLE.layoff.p0, PULSE_TABLE.layoff.halfLifeDays, day);
    this.employed = employed;
    this.book.monthlyTakeHome = this.monthlyTakeHome * (employed ? 1 : UNEMPLOYMENT_SHARE);
    const e: LifeEvent = { type: "job", day, employed };
    this.record(day);
    this.emit([e]);
    return e;
  }

  addPulse(p0: number, halfLifeDays: number, day: number): void {
    this.pulses.push({ p0, halfLifeDays, startDay: day });
  }

  /** Files through the debt engine and records the researched wellbeing shock exactly once. */
  fileBankruptcy(chapter: 7 | 13, day: number): BankruptcyResult {
    const result = fileBankruptcy(this.book, chapter, day);
    if (!this.bankruptcyPulseDays.has(day)) {
      this.bankruptcyPulseDays.add(day);
      this.addPulse(PULSE_TABLE.bankruptcy.p0, PULSE_TABLE.bankruptcy.halfLifeDays, day);
    }
    const event: LifeEvent = { type: "bankruptcy_filed", day, chapter };
    this.record(day);
    this.emit([event]);
    return result;
  }

  /** 401(k) and Roth IRA balances used by retirement scoring. */
  retirementSavings(): number {
    let total = 0;
    for (const account of this.ledger.accounts.values()) {
      if (account.kind === "k401" || account.kind === "roth_ira") total += account.balance;
    }
    return round2(total);
  }

  hasPastDue(): boolean {
    return this.book.debts.some((debt) => isOpen(debt) && (debt.pastDue > 0 || debt.status === "late" || debt.status === "delinquent" || debt.status === "serious" || debt.status === "default"));
  }

  inCollectionsOrRecentBankruptcy(today = this.today): boolean {
    const bankruptcy = this.book.profile.bankruptcy;
    const elapsed = bankruptcy === undefined ? Number.POSITIVE_INFINITY : today - bankruptcy.day;
    return this.book.debts.some((debt) => debt.status === "collections") || (elapsed >= 0 && elapsed < 730);
  }

  /** The prior year's tax return, once ready (around April 15), until the player files it. */
  pendingTaxReturn(): TaxReturn | null {
    return this.pendingReturn;
  }

  /**
   * Fast-forwards (both `runHeadless` here and the player-facing `runSkip`)
   * must never silently blow past a filing deadline: if a return is waiting
   * to be filed, auto-file it with the standard deduction so a multi-year
   * skip can't rack up failure-to-file/failure-to-pay penalties the player
   * never saw form. Returns the `tax_filed` event so the caller can fold it
   * into whatever event list or count it's already collecting, or null if
   * there was nothing pending.
   */
  autoFilePending(day: number): LifeEvent | null {
    return this.pendingReturn ? this.fileTaxes(day, true) : null;
  }

  /** Any unpaid tax balance still owed (accumulates across unresolved years); null once paid off. */
  unpaidTaxBalance(): { originalOwed: number; amount: number; dueDay: number; filedDay: number | null; penaltyCharged: number } | null {
    return this.unpaidTax;
  }

  /**
   * Files the pending return: applies a refund to checking, or withdraws what's
   * owed (partially, if checking can't cover it). A shortfall becomes or
   * updates `unpaidTax` — same object Task 11's monthly tick creates if the
   * deadline passes with nothing filed yet, so the two paths never double-track
   * the same balance. Real-world-accurate detail this preserves: failure-to-pay
   * and interest run from the original April 15 due date regardless of when
   * (or whether) the player files; only failure-to-file stops the moment you file.
   */
  fileTaxes(day: number, auto = false): LifeEvent {
    const ret = this.pendingReturn;
    if (!ret) throw new Error("No pending tax return to file.");
    const refundOrOwed = round2(ret.federalRefundOrOwed + ret.stateRefundOrOwed);
    const checking = this.ledger.get("checking");
    if (refundOrOwed >= 0) checking.balance = round2(checking.balance + refundOrOwed);
    else {
      const owed = -refundOrOwed;
      const paid = Math.min(owed, checking.balance);
      checking.balance = round2(checking.balance - paid);
      const unpaid = round2(owed - paid);
      const dueDay = this.taxReadyDay ?? day;
      if (unpaid > 0 && this.convertedTaxDueDays.has(dueDay)) {
        // This due day already converted to a real "IRS balance" Debt (the
        // player let it sit unfiled past 180 days). Filing late now must not
        // spin up a second, parallel shadow balance for the same obligation —
        // the Debt already represents it, so just let this return close out.
      } else if (unpaid > 0) {
        if (this.unpaidTax) {
          // A prior year's shortfall is still outstanding; this year's adds to it
          // rather than overwriting, so the balance a later penalty-escalation
          // feature reads never silently shrinks.
          this.unpaidTax.originalOwed = round2(this.unpaidTax.originalOwed + unpaid);
          this.unpaidTax.amount = round2(this.unpaidTax.amount + unpaid);
          this.unpaidTax.filedDay = day;
        } else {
          this.unpaidTax = { originalOwed: unpaid, amount: unpaid, dueDay: this.taxReadyDay ?? day, filedDay: day, penaltyCharged: 0 };
        }
      }
    }
    ret.filedDay = day;
    this.pendingReturn = null;
    const e: LifeEvent = { type: "tax_filed", day, year: ret.year, refundOrOwed, auto };
    this.record(day);
    this.emit([e]);
    return e;
  }

  /**
   * Monthly: escalates an unfiled-and-owing or filed-with-a-balance tax debt
   * (failure-to-file/pay + interest, penalties.ts), and converts it to a real
   * Debt after 180 days unpaid so it flows through the existing debt engine's
   * delinquency and credit-score machinery unchanged.
   *
   * `unpaidTax` is created lazily, the first time it's needed, by whichever of
   * two paths gets there first: this tick (the deadline passes with nothing
   * filed and money owed) or `fileTaxes` (filed, but checking couldn't cover
   * it). Once created, `penaltyCharged` tracks how much of `penaltyFor`'s
   * cumulative total has already been folded into `amount`, so each tick adds
   * only that month's new increment instead of re-adding the running total.
   */
  private tickTaxPenalty(day: number, events: LifeEvent[]): void {
    if (
      !this.unpaidTax &&
      this.pendingReturn &&
      this.taxReadyDay !== null &&
      day > this.taxReadyDay &&
      !this.convertedTaxDueDays.has(this.taxReadyDay)
    ) {
      const owed = round2(-(this.pendingReturn.federalRefundOrOwed + this.pendingReturn.stateRefundOrOwed));
      if (owed > 0) this.unpaidTax = { originalOwed: owed, amount: owed, dueDay: this.taxReadyDay, filedDay: null, penaltyCharged: 0 };
    }
    if (!this.unpaidTax) return;
    const monthsSinceDue = Math.max(0, Math.floor((day - this.unpaidTax.dueDay) / 30));
    const monthsUnfiled = this.unpaidTax.filedDay === null ? monthsSinceDue : 0;
    const penalty = penaltyFor({ owed: this.unpaidTax.originalOwed, monthsUnfiled, monthsUnpaid: monthsSinceDue });
    const delta = round2(penalty.total - this.unpaidTax.penaltyCharged);
    if (delta > 0) {
      this.unpaidTax.penaltyCharged = penalty.total;
      this.unpaidTax.amount = round2(this.unpaidTax.amount + delta);
      events.push({ type: "tax_penalty", day, amount: delta });
    }
    if (monthsSinceDue >= 6 && !this.convertedTaxDueDays.has(this.unpaidTax.dueDay)) {
      this.book.debts.push(
        installment({
          id: `irs-${this.unpaidTax.dueDay}`,
          kind: "personal",
          name: "IRS balance",
          balance: this.unpaidTax.amount,
          apr: 0.08,
          months: 36,
          day,
          openedDay: day,
        }),
      );
      this.convertedTaxDueDays.add(this.unpaidTax.dueDay);
      // From here the balance lives entirely as a normal Debt (its own accrual,
      // payments, and delinquency via tickDay): clear the shadow tracker so it
      // doesn't keep escalating in parallel, forever diverging from what the
      // real Debt actually still owes.
      this.unpaidTax = null;
      // The pending return (if any) that fed this shortfall is now resolved by
      // the Debt: it will never be filed, so clear it. Otherwise it stays set
      // forever, which both permanently blocks next April 15's new return (the
      // `!this.pendingReturn` guard below never re-passes) and, if it somehow
      // got filed late anyway, would create a second shadow balance for a due
      // day that's already converted (see the `convertedTaxDueDays` guard in
      // `fileTaxes`).
      this.pendingReturn = null;
    }
  }

  /** The paycheck's 401(k) contribution and employer match, within the yearly IRS limit. */
  private contribute401k(date: Date): { cost: number; added: number } {
    const pct = this.orders?.k401Pct ?? 0;
    if (!this.employed || pct <= 0) return { cost: 0, added: 0 };
    if (date.getFullYear() !== this.k401Year) {
      this.k401Year = date.getFullYear();
      this.k401Ytd = 0;
    }
    const want = (pct * this.grossAnnual) / 24;
    const put = Math.min(want, Math.max(0, K401_LIMIT - this.k401Ytd));
    this.k401Ytd += put;
    const match = put > 0 ? (Math.min(pct, MATCH_UP_TO) * MATCH_RATE * this.grossAnnual) / 24 : 0;
    const k401 = this.account("k401");
    k401.balance = round2(k401.balance + put + match);
    return { cost: round2(put * (1 - K401_TAX_SAVING)), added: round2(put + match) };
  }

  /**
   * The paycheck's Roth IRA contribution, within the yearly IRS limit. Roth
   * money is already-taxed, so it costs exactly what's put in (no tax
   * saving), and there's no employer match (only the 401(k) gets one).
   */
  private contributeRoth(date: Date): { cost: number; added: number } {
    const pct = this.orders?.rothPct ?? 0;
    if (!this.employed || pct <= 0) return { cost: 0, added: 0 };
    if (date.getFullYear() !== this.rothYear) {
      this.rothYear = date.getFullYear();
      this.rothYtd = 0;
    }
    const want = (pct * this.grossAnnual) / 24;
    const put = Math.min(want, Math.max(0, ROTH_LIMIT - this.rothYtd));
    this.rothYtd += put;
    const roth = this.account("roth");
    roth.balance = round2(roth.balance + put);
    roth.rothContributions = round2((roth.rothContributions ?? 0) + put);
    return { cost: round2(put), added: round2(put) };
  }

  /** Moves spare checking cash (beyond a month of bills) into the emergency fund, up to the plan's target. */
  private topUpEmergency(): void {
    const checking = this.ledger.get("checking");
    const emergency = this.account("emergency");
    const month = this.monthlyExpenses();
    const amount = round2(Math.min(Math.max(0, checking.balance - month), Math.max(0, this.orders!.emergencyMonths * month - emergency.balance)));
    if (amount <= 0) return;
    checking.balance = round2(checking.balance - amount);
    emergency.balance = round2(emergency.balance + amount);
  }

  /**
   * On the 1st, with a plan in force: retirement accounts earn last month's
   * market return at the plan's stock/bond mix, then the crash rule looks at
   * the total market and may sell the LTM fund or buy it back.
   */
  private onFirstOfMonth(day: number): LifeEvent[] {
    const orders = this.orders!;
    const stock = this.market.price("LTM", day);
    const bond = this.market.price("BOND", day);
    if (this.lastFirst) {
      const held = orders.stockPct * this.crash.held(orders.crashRule);
      const r = held * (stock / this.lastFirst.stock - 1) + (1 - orders.stockPct) * (bond / this.lastFirst.bond - 1);
      for (const a of this.ledger.accounts.values()) if (a.kind === "k401" || a.kind === "roth_ira") a.balance = round2(a.balance * (1 + r));
    } else this.crash.peak = stock;
    this.lastFirst = { stock, bond };

    const move = this.crash.update(stock, orders.crashRule);
    const pos = this.position("LTM");
    if (move === "sell" && pos) {
      const all = orders.crashRule === "sell_all";
      const r = this.fill("LTM", "sell", all ? pos.value : pos.value / 2, day, false, all);
      if (r.ok && r.event.type === "trade") {
        this.crashCash += r.event.amount;
        return [r.event];
      }
    } else if (move === "buy" && this.crashCash > 0) {
      const amount = Math.min(this.crashCash, this.ledger.get("checking").balance - this.monthlyExpenses());
      this.crashCash = 0;
      if (amount >= MIN_TRADE) {
        const r = this.fill("LTM", "buy", amount, day, false);
        if (r.ok) return [r.event];
      }
    }
    return [];
  }

  /**
   * The desk's crash moment (research/03, event 1): the first close 20% below
   * LTM's high while the player owns stocks. It fires once, then re-arms when
   * LTM sets a new high, which also reports how each line came through.
   */
  private watchMarket(day: number): LifeEvent[] {
    const price = this.market.price("LTM", day);
    if (price >= this.ltmPeak) {
      this.ltmPeak = price;
      if (!this.inBear) return [];
      this.inBear = false;
      const snap = this.snapshot(day);
      return [{ type: "market_recovered", day, you: snap.you, held: snap.held, autopilot: snap.autopilot }];
    }
    const drop = 1 - price / this.ltmPeak;
    if (this.inBear || drop < PANIC_DRAWDOWN) return [];
    const stocks = round2(this.stockPositions(day).reduce((t, p) => t + p.value, 0));
    if (stocks <= 0) return [];
    this.inBear = true;
    return [{ type: "bear_market", day, drop, stocks }];
  }

  /** The account with this id, opened now if a custom account list left it out. */
  private account(id: keyof typeof ACCOUNT_NAMES): Account {
    let a = this.ledger.accounts.get(id);
    if (!a) {
      const kind = id === "roth" ? "roth_ira" : id;
      a = { id, kind, name: ACCOUNT_NAMES[id], balance: 0, apy: id === "emergency" ? 0.04 : 0, openedDay: this.startDay };
      this.ledger.accounts.set(id, a);
    }
    return a;
  }

  /** Opens the starting positions, bought a year before `day` at that day's real prices. */
  private seedHoldings(dollars: Partial<Record<InstrumentId, number>>, day: number): void {
    const acct = this.brokerage();
    if (!acct) return;
    acct.holdings ??= {};
    for (const [id, amount] of Object.entries(dollars) as [InstrumentId, number][]) {
      if (!(amount > 0)) continue;
      const units = amount / this.market.price(id, day);
      const cost = round2(units * this.market.price(id, day - 365));
      acct.holdings[id] = { units, cost };
      this.startUnits.push([id, units]);
      // The twins start where the player starts: the same value on the life's first day.
      this.twins.seedHolding(id, units, day);
    }
  }

  private brokerage(): Account | undefined {
    return [...this.ledger.accounts.values()].find((a) => a.kind === "brokerage");
  }

  /** Moves money between checking and a holding without notifying listeners. */
  private fill(id: InstrumentId, side: "buy" | "sell", amount: number, day: number, recurring: boolean, all = false): TradeResult {
    const acct = this.brokerage();
    if (!acct) return { ok: false, error: "No brokerage account." };
    const dollars = round2(amount);
    if (!(dollars >= MIN_TRADE)) return { ok: false, error: `The smallest trade is $${MIN_TRADE}.` };
    const checking = this.ledger.get("checking");
    const price = this.market.price(id, day);
    acct.holdings ??= {};
    const h = (acct.holdings[id] ??= { units: 0, cost: 0 });
    let units: number;
    if (side === "buy") {
      if (dollars > checking.balance + 1e-9) return { ok: false, error: "Not enough in checking." };
      units = dollars / price;
      checking.balance = round2(checking.balance - dollars);
      h.units += units;
      h.cost = round2(h.cost + dollars);
      this.twins.buy(id, dollars, day);
    } else {
      units = all ? h.units : Math.min(h.units, dollars / price);
      if (units <= 1e-9) return { ok: false, error: "You don't own any." };
      const proceeds = round2(units * price);
      // Cost basis leaves in proportion to the units sold (average cost).
      h.cost = round2(h.cost * (1 - units / h.units));
      h.units = all ? 0 : h.units - units;
      checking.balance = round2(checking.balance + proceeds);
      this.twins.sell(proceeds);
      return { ok: true, event: { type: "trade", day, id, side, amount: proceeds, units, price, recurring } };
    }
    return { ok: true, event: { type: "trade", day, id, side, amount: dollars, units, price, recurring } };
  }

  private emit(events: LifeEvent[]) {
    this.log.push(...events);
    if (this.muted) return;
    for (const fn of this.listeners) fn(events, this);
  }

  /** Balances right now, as a history row. */
  snapshot(day: number): LifeSnapshot {
    const cash = this.cash();
    const positions = this.positions(day);
    const investments = this.investmentsWith(positions);
    const debt = this.totalDebt();
    const brokerage = round2(positions.reduce((t, p) => t + p.value, 0));
    return {
      day,
      cash,
      investments,
      debt,
      netWorth: round2(cash + investments - debt),
      score: this.book.profile.score,
      wellbeing: wellbeing(this, day).W,
      brokerage,
      you: this.twins.you(brokerage),
      held: this.twins.held(day),
      autopilot: this.twins.autopilot(day),
    };
  }

  private record(day: number) {
    const snap = this.snapshot(day);
    // Trades and skips can record the same day twice; keep one snapshot per day.
    if (this.history.length && this.history[this.history.length - 1].day === day) this.history[this.history.length - 1] = snap;
    else this.history.push(snap);
  }
}
