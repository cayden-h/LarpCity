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
import { instrument, MarketPath, type InstrumentId } from "../market/index.ts";
import { Ledger } from "../money/accounts.ts";
import type { Account, Holding } from "../money/types.ts";
import { CrashWatch, PANIC_DRAWDOWN } from "../skip/crash.ts";
import { LIFESTYLE_FACTOR, type StandingOrders } from "../skip/types.ts";
import { withholdingForPaycheck } from "../tax/withholding.ts";
import { cashRateOn } from "./rates.ts";
import { Twins } from "./twins.ts";

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

const ACCOUNT_NAMES = { emergency: "Emergency fund", k401: "401(k)" } as const;

export type LifeEvent =
  | DebtEvent
  | { type: "paycheck"; day: number; takeHome: number; garnished: number; unemployed: boolean; retirement?: number; federalWithheld: number; stateWithheld: number }
  | { type: "bill"; day: number; name: string; amount: number; paid: number }
  | { type: "savings_interest"; day: number; amount: number }
  | { type: "moved"; day: number; from: string; to: string; rent: number; living: number }
  | { type: "job"; day: number; employed: boolean }
  | { type: "trade"; day: number; id: InstrumentId; side: "buy" | "sell"; amount: number; units: number; price: number; recurring: boolean }
  | { type: "trade_skipped"; day: number; id: InstrumentId; amount: number; reason: string }
  | { type: "bear_market"; day: number; drop: number; stocks: number }
  | { type: "market_recovered"; day: number; you: number; held: number; autopilot: number };

export interface LifeSnapshot {
  day: number;
  cash: number;
  investments: number;
  debt: number;
  netWorth: number;
  score: number;
  /** Brokerage holdings at the day's prices. */
  brokerage: number;
  /** The player's investing line: brokerage plus the cash sells took out (sim/life/twins.ts). */
  you: number;
  /** The same buys, never sold. */
  held: number;
  /** The same dollars at 90/10 LTM/BOND, never sold. */
  autopilot: number;
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

/** Checking, a high-yield savings account, an emergency fund, an empty brokerage account, and an empty 401(k). */
export function defaultAccounts(day: number): Account[] {
  return [
    { id: "checking", kind: "checking", name: "Checking", balance: 1_200, apy: 0.0001, openedDay: day - 1_500 },
    { id: "savings", kind: "savings", name: "High-yield savings", balance: 2_500, apy: 0.04, openedDay: day - 900 },
    { id: "emergency", kind: "emergency", name: "Emergency fund", balance: 0, apy: 0.04, openedDay: day },
    { id: "brokerage", kind: "brokerage", name: "Brokerage", balance: 0, apy: 0, openedDay: day, holdings: {} },
    { id: "k401", kind: "k401", name: "401(k)", balance: 0, apy: 0, openedDay: day },
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
  /** Age in years, advancing with the calendar. */
  age: number;
  monthlyTakeHome: number;
  /** Gross yearly pay, for the 401(k), its match, and the mortgage test. */
  grossAnnual: number;
  /** Job title from onboarding; empty for the sample household. */
  job: string;
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
  /** Shadow portfolios of the player's buys, for "if you had held" and "autopilot". */
  readonly twins: Twins;
  private readonly startDay: number;
  private readonly startAge: number;
  /** The stated rent and the housing price parity it was stated at; null means the state's median rent. */
  private readonly rentAnchor: { amount: number; housing: number } | null;
  private readonly cashRate: (date: Date) => number;
  private readonly listeners: ((events: LifeEvent[], life: PlayerLife) => void)[] = [];
  private readonly crash = new CrashWatch();
  /** Proceeds of the crash rule's panic sale, waiting to buy back in. */
  private crashCash = 0;
  /** Stock and bond prices on the last 1st of the month, for the 401(k)'s monthly return. */
  private lastFirst: { stock: number; bond: number } | null = null;
  private k401Year = -1;
  private k401Ytd = 0;
  private taxYear = 0; // 0 is a sentinel meaning "not initialized yet"; set on first payday
  private wagesYtdAmount = 0;
  private federalWithheldYtd = 0;
  private stateWithheldYtd = 0;

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

  constructor(o: LifeOptions) {
    this.place = o.place;
    this.startDay = o.day;
    this.startAge = o.age ?? 27;
    this.age = this.startAge;
    this.today = o.day;
    this.book = o.book ?? sampleHousehold(o.day, "avalanche", 300);
    this.monthlyTakeHome = o.monthlyTakeHome ?? this.book.monthlyTakeHome;
    this.grossAnnual = o.grossAnnual ?? Math.round((this.monthlyTakeHome * 12) / TAKE_HOME_SHARE);
    this.job = o.job ?? "";
    this.rentAnchor = o.rent === undefined ? null : { amount: o.rent, housing: o.place.rpp.housing };
    // The engine's bankruptcy test compares minimums with the book's take-home, so keep them in sync.
    this.book.monthlyTakeHome = this.monthlyTakeHome;
    this.ledger = new Ledger(o.accounts ?? defaultAccounts(o.day));
    this.market = o.market ?? new MarketPath();
    this.ltmPeak = this.market.price("LTM", o.day);
    this.cashRate = o.cashRate ?? cashRateOn;
    this.twins = new Twins(this.market);
    if (o.holdings) this.seedHoldings(o.holdings, o.day);
    this.startSnap = this.snapshot(o.day);
    this.record(o.day);
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

  /** Monthly living costs besides rent, at the plan's lifestyle. */
  get living(): number {
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
    this.today = day;
    this.age = this.startAge + (day - this.startDay) / 365.25;
    this.ledger.settle(day);
    const wallet = this.ledger.wallet();
    const dom = date.getDate();
    const payday = dom === 1 || dom === 15;

    if (payday) {
      const year = date.getFullYear();
      if (year !== this.taxYear) {
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
      const takeHome = round2(pay - retirement.cost - garnished);
      const checking = this.ledger.get("checking");
      checking.balance = round2(checking.balance + takeHome);
      events.push({
        type: "paycheck", day, takeHome, garnished, unemployed: !this.employed, retirement: retirement.added,
        federalWithheld: withheld.federalIncomeTax, stateWithheld: withheld.stateIncomeTax,
      });
    }
    // Rent on the 1st and living costs on the 15th come before debt payments.
    const bill = dom === 1 ? { name: "Rent", amount: this.rent } : dom === 15 ? { name: "Living costs", amount: this.living } : null;
    if (bill) events.push({ type: "bill", day, name: bill.name, amount: bill.amount, paid: wallet.withdraw(bill.amount, bill.name) });

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
      a = { id, kind: id, name: ACCOUNT_NAMES[id], balance: 0, apy: id === "emergency" ? 0.04 : 0, openedDay: this.startDay };
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
