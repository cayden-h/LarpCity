// The player's money life in the city. Each game day it lands paychecks,
// pays rent and living costs scaled to the current state, runs the debt
// engine through the accounts ledger's shortfall waterfall, runs any recurring
// investment, and pays savings interest on the 1st. The city scene calls onDay
// from Clock.onDay; skips and the age teleport run the same method headless
// through runHeadless.

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
import { MarketPath, type InstrumentId } from "../market/index.ts";
import { Ledger } from "../money/accounts.ts";
import type { Account, Holding } from "../money/types.ts";
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
  | { type: "job"; day: number; employed: boolean }
  | { type: "trade"; day: number; id: InstrumentId; side: "buy" | "sell"; amount: number; units: number; price: number; recurring: boolean }
  | { type: "trade_skipped"; day: number; id: InstrumentId; amount: number; reason: string };

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
  /** Prices for brokerage holdings; defaults to a market path with the default seed. */
  market?: MarketPath;
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

/** Checking, a high-yield savings account, an emergency fund, and an empty brokerage account. */
export function defaultAccounts(day: number): Account[] {
  return [
    { id: "checking", kind: "checking", name: "Checking", balance: 1_200, apy: 0.0001, openedDay: day - 1_500 },
    { id: "savings", kind: "savings", name: "High-yield savings", balance: 2_500, apy: 0.04, openedDay: day - 900 },
    { id: "emergency", kind: "emergency", name: "Emergency fund", balance: 0, apy: 0.04, openedDay: day },
    { id: "brokerage", kind: "brokerage", name: "Brokerage", balance: 0, apy: 0, openedDay: day, holdings: {} },
  ];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const CASH_KINDS = new Set(["checking", "savings", "emergency"]);
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
  age: number;
  monthlyTakeHome: number;
  /**
   * Buys to make on every payday once bills and debt payments are covered, in
   * order (a stock/bond mix is two entries). Empty = off.
   */
  recurring: RecurringBuy[] = [];
  /** The latest game day the life has seen; holdings are valued at this day's prices. */
  today: number;
  readonly history: LifeSnapshot[] = [];
  private readonly cashRate: (date: Date) => number;
  private readonly listeners: ((events: LifeEvent[], life: PlayerLife) => void)[] = [];

  constructor(o: LifeOptions) {
    this.place = o.place;
    this.age = o.age ?? 27;
    this.today = o.day;
    this.book = o.book ?? sampleHousehold(o.day, "avalanche", 300);
    this.monthlyTakeHome = o.monthlyTakeHome ?? this.book.monthlyTakeHome;
    // The engine's bankruptcy test compares minimums with the book's take-home, so keep them in sync.
    this.book.monthlyTakeHome = this.monthlyTakeHome;
    this.ledger = new Ledger(o.accounts ?? defaultAccounts(o.day));
    this.market = o.market ?? new MarketPath();
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

  /** Brokerage and retirement balances plus holdings at today's prices. */
  investments(): number {
    let s = 0;
    for (const a of this.ledger.accounts.values()) if (!CASH_KINDS.has(a.kind)) s += a.balance;
    return round2(s + this.positions().reduce((t, p) => t + p.value, 0));
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

  /** Buys `amount` dollars of an instrument from checking at today's price (fractional units). */
  buy(id: InstrumentId, amount: number, day = this.today, recurring = false): TradeResult {
    const result = this.fill(id, "buy", amount, day, recurring);
    if (result.ok) this.emit([result.event]);
    return result;
  }

  /** Sells `amount` dollars of an instrument (or all of it) into checking at today's price. */
  sell(id: InstrumentId, amount: number | "all", day = this.today): TradeResult {
    const pos = this.position(id);
    if (!pos) return { ok: false, error: "You don't own any." };
    const result = this.fill(id, "sell", amount === "all" ? pos.value : amount, day, false, amount === "all");
    if (result.ok) this.emit([result.event]);
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
    this.today = day;
    this.ledger.settle(day);
    const wallet = this.ledger.wallet();
    const dom = date.getDate();
    const payday = dom === 1 || dom === 15;

    if (payday) {
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

    // Recurring investments come last, from whatever checking has left, so they never starve a bill.
    if (payday) {
      for (const { id, amount } of this.recurring) {
        const r = this.fill(id, "buy", amount, day, true);
        events.push(r.ok ? r.event : { type: "trade_skipped", day, id, amount, reason: r.error });
      }
    }

    if (dom === 1) {
      const interest = this.ledger.payInterest();
      this.ledger.newMonth();
      if (interest > 0) events.push({ type: "savings_interest", day, amount: interest });
    }
    this.record(day);
    this.emit(events);
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
    this.emit([e]);
    return e;
  }

  setEmployed(employed: boolean, day: number): LifeEvent {
    this.employed = employed;
    this.book.monthlyTakeHome = this.monthlyTakeHome * (employed ? 1 : UNEMPLOYMENT_SHARE);
    const e: LifeEvent = { type: "job", day, employed };
    this.emit([e]);
    return e;
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
    } else {
      units = all ? h.units : Math.min(h.units, dollars / price);
      if (units <= 1e-9) return { ok: false, error: "You don't own any." };
      const proceeds = round2(units * price);
      // Cost basis leaves in proportion to the units sold (average cost).
      h.cost = round2(h.cost * (1 - units / h.units));
      h.units = all ? 0 : h.units - units;
      checking.balance = round2(checking.balance + proceeds);
      return { ok: true, event: { type: "trade", day, id, side, amount: proceeds, units, price, recurring } };
    }
    return { ok: true, event: { type: "trade", day, id, side, amount: dollars, units, price, recurring } };
  }

  private emit(events: LifeEvent[]) {
    for (const fn of this.listeners) fn(events, this);
  }

  private record(day: number) {
    const cash = this.cash();
    const investments = this.investments();
    const debt = this.totalDebt();
    const snap = { day, cash, investments, debt, netWorth: round2(cash + investments - debt), score: this.book.profile.score };
    // Trades and skips can record the same day twice; keep one snapshot per day.
    if (this.history.length && this.history[this.history.length - 1].day === day) this.history[this.history.length - 1] = snap;
    else this.history.push(snap);
  }
}
