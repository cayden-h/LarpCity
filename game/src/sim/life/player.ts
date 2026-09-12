// The player's money life in the city. Each game day it lands paychecks,
// pays rent and living costs scaled to the current state, runs the debt
// engine through the accounts ledger's shortfall waterfall, and pays savings
// interest on the 1st. The city scene calls onDay from Clock.onDay; skips and
// the age teleport run the same method headless through runHeadless.

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

export type LifeEvent =
  | DebtEvent
  | { type: "paycheck"; day: number; takeHome: number; garnished: number; unemployed: boolean }
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
  book?: DebtBook;
  accounts?: Account[];
  /** Cash rate for a date; defaults to the FRED Fed funds snapshot. */
  cashRate?: (date: Date) => number;
}

/** Checking, a high-yield savings account, and an emergency fund. */
export function defaultAccounts(day: number): Account[] {
  return [
    { id: "checking", kind: "checking", name: "Checking", balance: 1_200, apy: 0.0001, openedDay: day - 1_500 },
    { id: "savings", kind: "savings", name: "High-yield savings", balance: 2_500, apy: 0.04, openedDay: day - 900 },
    { id: "emergency", kind: "emergency", name: "Emergency fund", balance: 0, apy: 0.04, openedDay: day },
    { id: "brokerage", kind: "brokerage", name: "Brokerage", balance: 0, apy: 0, openedDay: day },
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
  age: number;
  monthlyTakeHome: number;
  readonly history: LifeSnapshot[] = [];
  private readonly cashRate: (date: Date) => number;
  private readonly listeners: ((events: LifeEvent[], life: PlayerLife) => void)[] = [];

  constructor(o: LifeOptions) {
    this.place = o.place;
    this.age = o.age ?? 27;
    this.book = o.book ?? sampleHousehold(o.day, "avalanche", 300);
    this.monthlyTakeHome = o.monthlyTakeHome ?? this.book.monthlyTakeHome;
    // The engine's bankruptcy test compares minimums with the book's take-home, so keep them in sync.
    this.book.monthlyTakeHome = this.monthlyTakeHome;
    this.ledger = new Ledger(o.accounts ?? defaultAccounts(o.day));
    this.cashRate = o.cashRate ?? cashRateOn;
    this.record(o.day);
  }

  /** Monthly rent for the current state. */
  get rent(): number {
    return Math.round((US_MEDIAN_RENT * this.place.rpp.housing) / 100);
  }

  /** Monthly living costs besides rent for the current state. */
  get living(): number {
    return Math.round((US_LIVING * this.place.rpp.goods) / 100);
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
    this.ledger.settle(day);
    const wallet = this.ledger.wallet();
    const dom = date.getDate();

    if (dom === 1 || dom === 15) {
      const pay = (this.monthlyTakeHome / 2) * (this.employed ? 1 : UNEMPLOYMENT_SHARE);
      const garnished = round2(pay * garnishmentRate(this.book));
      const checking = this.ledger.get("checking");
      checking.balance = round2(checking.balance + pay - garnished);
      events.push({ type: "paycheck", day, takeHome: round2(pay - garnished), garnished, unemployed: !this.employed });
    }
    // Rent on the 1st and living costs on the 15th come before debt payments.
    const bill = dom === 1 ? { name: "Rent", amount: this.rent } : dom === 15 ? { name: "Living costs", amount: this.living } : null;
    if (bill) events.push({ type: "bill", day, name: bill.name, amount: bill.amount, paid: wallet.withdraw(bill.amount, bill.name) });

    events.push(...tickDay(this.book, { day, date, env: { cashRateAnnual: this.cashRate(date) }, wallet }));

    if (dom === 1) {
      const interest = this.ledger.payInterest();
      this.ledger.newMonth();
      if (interest > 0) events.push({ type: "savings_interest", day, amount: interest });
    }
    this.record(day);
    for (const fn of this.listeners) fn(events, this);
    return events;
  }

  /**
   * Runs days headless (skips, the age teleport, goal skips). Stops early on
   * bankruptcy, the meeting's rule; everything else resolves by the standing
   * strategy and the shortfall waterfall.
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

  /** Bankruptcy stops skips and the teleport and pauses time. */
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

  private record(day: number) {
    const cash = this.cash();
    const investments = this.investments();
    const debt = this.totalDebt();
    this.history.push({ day, cash, investments, debt, netWorth: round2(cash + investments - debt), score: this.book.profile.score });
  }
}
