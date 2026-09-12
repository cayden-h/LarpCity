// The player's money life in the city. Each game day it lands paychecks,
// pays rent and living costs scaled to the current state, runs the debt
// engine through the accounts ledger's shortfall waterfall, and pays savings
// interest on the 1st. With standing orders set (sim/skip), paychecks also fund
// the 401(k), the emergency fund, and a recurring deposit, and investments
// move with the seeded market on the 1st. The city scene calls onDay from
// Clock.onDay; skips and goal fast-forwards run the same method headless.

import {
  compareStrategies,
  garnishmentRate,
  isOpen,
  owed,
  sampleHousehold,
  scoreBand,
  tickDay,
  type DebtBook,
  type DebtEvent,
  type Projection,
} from "../debt/index.ts";
import { Ledger } from "../money/accounts.ts";
import type { Account } from "../money/types.ts";
import { monthIndex, portfolioReturn, type MarketPath } from "../skip/market.ts";
import { LIFESTYLE_FACTOR, type StandingOrders } from "../skip/types.ts";
import { cashRateOn } from "./rates.ts";

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
/** Stock share when the player hasn't chosen one (research/10: 90/10). */
export const DEFAULT_STOCK_PCT = 0.9;

const ACCOUNT_NAMES = { emergency: "Emergency fund", brokerage: "Brokerage", k401: "401(k)" } as const;

export type LifeEvent =
  | DebtEvent
  | { type: "paycheck"; day: number; takeHome: number; garnished: number; unemployed: boolean; retirement?: number }
  | { type: "bill"; day: number; name: string; amount: number; paid: number }
  | { type: "savings_interest"; day: number; amount: number }
  | { type: "moved"; day: number; from: string; to: string; rent: number; living: number }
  | { type: "job"; day: number; employed: boolean };

export interface LifeSnapshot {
  day: number;
  cash: number;
  investments: number;
  debt: number;
  netWorth: number;
  score: number;
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
  book?: DebtBook;
  accounts?: Account[];
  /** Cash rate for a date; defaults to the FRED Fed funds snapshot. */
  cashRate?: (date: Date) => number;
  /** The seeded market path; without one, investments hold their value. */
  market?: MarketPath;
}

/** Checking, a high-yield savings account, an emergency fund, a brokerage account, and a 401(k). */
export function defaultAccounts(day: number): Account[] {
  return [
    { id: "checking", kind: "checking", name: "Checking", balance: 1_200, apy: 0.0001, openedDay: day - 1_500 },
    { id: "savings", kind: "savings", name: "High-yield savings", balance: 2_500, apy: 0.04, openedDay: day - 900 },
    { id: "emergency", kind: "emergency", name: "Emergency fund", balance: 0, apy: 0.04, openedDay: day },
    { id: "brokerage", kind: "brokerage", name: "Brokerage", balance: 0, apy: 0, openedDay: day },
    { id: "k401", kind: "k401", name: "401(k)", balance: 0, apy: 0, openedDay: day },
  ];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const CASH_KINDS = new Set(["checking", "savings", "emergency"]);

/** Home tiers match engine/hero.ts HOME_TIERS: tent, studio, small house, townhouse, large house, villa. */
export const HOME_TIER_NET_WORTH = [25_000, 100_000, 250_000, 1_000_000] as const;

export class PlayerLife {
  readonly ledger: Ledger;
  book: DebtBook;
  place: Place;
  employed = true;
  /** Age in years, advancing with the calendar. */
  age: number;
  monthlyTakeHome: number;
  /** Gross yearly pay, for the 401(k), its match, and the mortgage test. */
  grossAnnual: number;
  /** The plan from the fast-forward setup screen, in force from the day it was set. */
  orders: StandingOrders | null = null;
  market: MarketPath | null;
  readonly history: LifeSnapshot[] = [];
  private readonly startDay: number;
  private readonly startAge: number;
  private readonly cashRate: (date: Date) => number;
  private readonly listeners: ((events: LifeEvent[], life: PlayerLife) => void)[] = [];
  private k401Year = -1;
  private k401Ytd = 0;

  constructor(o: LifeOptions) {
    this.place = o.place;
    this.startDay = o.day;
    this.startAge = o.age ?? 27;
    this.age = this.startAge;
    this.book = o.book ?? sampleHousehold(o.day, "avalanche", 300);
    this.monthlyTakeHome = o.monthlyTakeHome ?? this.book.monthlyTakeHome;
    this.grossAnnual = o.grossAnnual ?? Math.round((this.monthlyTakeHome * 12) / TAKE_HOME_SHARE);
    // The engine's bankruptcy test compares minimums with the book's take-home, so keep them in sync.
    this.book.monthlyTakeHome = this.monthlyTakeHome;
    this.ledger = new Ledger(o.accounts ?? defaultAccounts(o.day));
    this.cashRate = o.cashRate ?? cashRateOn;
    this.market = o.market ?? null;
    this.record(o.day);
  }

  /** Monthly rent for the current state. */
  get rent(): number {
    return Math.round((US_MEDIAN_RENT * this.place.rpp.housing) / 100);
  }

  /** Monthly living costs besides rent for the current state, at a normal lifestyle. */
  get baseLiving(): number {
    return Math.round((US_LIVING * this.place.rpp.goods) / 100);
  }

  /** Monthly living costs besides rent, at the plan's lifestyle. */
  get living(): number {
    return Math.round(this.baseLiving * LIFESTYLE_FACTOR[this.orders?.lifestyle ?? "normal"]);
  }

  cash(): number {
    let s = 0;
    for (const a of this.ledger.accounts.values()) if (CASH_KINDS.has(a.kind)) s += a.balance;
    return round2(s);
  }

  investments(): number {
    let s = 0;
    for (const a of this.ledger.accounts.values()) if (!CASH_KINDS.has(a.kind)) s += a.balance;
    return round2(s);
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

  /** Rent, living costs, and minimum payments: what an emergency fund month has to cover. */
  monthlyExpenses(): number {
    return round2(this.rent + this.living + this.minimums());
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

  /** One game day. `date` is the calendar date of `day`. */
  onDay(day: number, date: Date): LifeEvent[] {
    const events: LifeEvent[] = [];
    this.age = this.startAge + (day - this.startDay) / 365.25;
    this.ledger.settle(day);
    const wallet = this.ledger.wallet();
    const dom = date.getDate();

    if (dom === 1 || dom === 15) {
      const pay = (this.monthlyTakeHome / 2) * (this.employed ? 1 : UNEMPLOYMENT_SHARE);
      const garnished = round2(pay * garnishmentRate(this.book));
      const retirement = this.contribute401k(date);
      const takeHome = round2(pay - retirement.cost - garnished);
      const checking = this.ledger.get("checking");
      checking.balance = round2(checking.balance + takeHome);
      events.push({ type: "paycheck", day, takeHome, garnished, unemployed: !this.employed, retirement: retirement.added });
    }
    // Rent on the 1st and living costs on the 15th come before debt payments.
    const bill = dom === 1 ? { name: "Rent", amount: this.rent } : dom === 15 ? { name: "Living costs", amount: this.living } : null;
    if (bill) events.push({ type: "bill", day, name: bill.name, amount: bill.amount, paid: wallet.withdraw(bill.amount, bill.name) });

    events.push(...tickDay(this.book, { day, date, env: { cashRateAnnual: this.cashRate(date) }, wallet }));

    // Mid-month, after living costs: the emergency fund target, then the recurring deposit.
    if (dom === 15 && this.orders) this.allocate();

    if (dom === 1) {
      const interest = this.ledger.payInterest();
      this.ledger.newMonth();
      if (interest > 0) events.push({ type: "savings_interest", day, amount: interest });
      if (this.market) this.applyReturns(date);
    }
    this.record(day);
    for (const fn of this.listeners) fn(events, this);
    return events;
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

  /** Moves spare checking cash to the emergency fund target, then to the recurring deposit. */
  private allocate(): void {
    const orders = this.orders!;
    const checking = this.ledger.get("checking");
    // Keep a month of bills in checking.
    let spare = checking.balance - (this.rent + this.living + this.minimums());
    const move = (id: "emergency" | "brokerage", want: number) => {
      const amount = round2(Math.min(Math.max(0, want), Math.max(0, spare)));
      if (amount <= 0) return;
      checking.balance = round2(checking.balance - amount);
      const to = this.account(id);
      to.balance = round2(to.balance + amount);
      spare -= amount;
    };
    move("emergency", orders.emergencyMonths * this.monthlyExpenses() - this.account("emergency").balance);
    move("brokerage", orders.depositMonthly);
  }

  /** On the 1st, investments earn last month's market return under the plan's stock share and crash rule. */
  private applyReturns(date: Date): void {
    const market = this.market!;
    const r = portfolioReturn(market, monthIndex(market, date) - 1, this.orders?.stockPct ?? DEFAULT_STOCK_PCT, this.orders?.crashRule ?? "hold");
    if (r === 0) return;
    for (const a of this.ledger.accounts.values()) if (!CASH_KINDS.has(a.kind) && a.balance > 0) a.balance = round2(a.balance * (1 + r));
  }

  /** The account with this id, opened now if a custom account list left it out. */
  private account(id: keyof typeof ACCOUNT_NAMES): Account {
    let a = this.ledger.accounts.get(id);
    if (!a) {
      a = { id, kind: id, name: ACCOUNT_NAMES[id], balance: 0, apy: id === "emergency" ? 0.04 : 0, openedDay: this.startDay };
      this.ledger.accounts.set(id, a);
    }
    return a;
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
      if (this.stopsSkip(events)) return { daysRun: i, stoppedBy: "bankruptcy", events: all };
    }
    return { daysRun: days, stoppedBy: null, events: all };
  }

  /** Bankruptcy stops skips and fast-forwards and pauses time. */
  stopsSkip(events: LifeEvent[]): boolean {
    return events.some((e) => e.type === "bankruptcy_eligible");
  }

  /** Events that should pause time for a decision once there is a UI for it. */
  needsDecision(events: LifeEvent[]): boolean {
    return events.some((e) => e.type === "cannot_cover" || e.type === "bankruptcy_eligible");
  }

  setPlace(place: Place, day: number): LifeEvent {
    const from = this.place.abbr;
    this.place = place;
    const e: LifeEvent = { type: "moved", day, from, to: place.abbr, rent: this.rent, living: this.living };
    for (const fn of this.listeners) fn([e], this);
    return e;
  }

  setEmployed(employed: boolean, day: number): LifeEvent {
    this.employed = employed;
    this.book.monthlyTakeHome = this.monthlyTakeHome * (employed ? 1 : UNEMPLOYMENT_SHARE);
    const e: LifeEvent = { type: "job", day, employed };
    for (const fn of this.listeners) fn([e], this);
    return e;
  }

  /** Balances right now, as a history row. */
  snapshot(day: number): LifeSnapshot {
    const cash = this.cash();
    const investments = this.investments();
    const debt = this.totalDebt();
    return { day, cash, investments, debt, netWorth: round2(cash + investments - debt), score: this.book.profile.score };
  }

  private record(day: number) {
    this.history.push(this.snapshot(day));
  }
}
