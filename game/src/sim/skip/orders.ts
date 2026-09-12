// Standing orders for a goal fast-forward: what the player does now (the
// setup screen's pre-fill, decided 2026-09-12), a recommended plan to compare
// against, and the monthly budget both are checked against.

import { DEFAULT_STOCK_PCT, K401_LIMIT, K401_TAX_SAVING, MATCH_RATE, MATCH_UP_TO, type PlayerLife } from "../life/player.ts";
import { LIFESTYLE_FACTOR, type StandingOrders } from "./types.ts";

const roundTo = (x: number, step: number) => Math.round(x / step) * step;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The plan in force, or the player's habits if they have never set one. */
export function currentOrders(life: PlayerLife): StandingOrders {
  if (life.orders) return { ...life.orders };
  const expenses = life.monthlyExpenses();
  const emergency = life.ledger.accounts.get("emergency")?.balance ?? 0;
  return {
    depositMonthly: 0,
    k401Pct: 0,
    stockPct: DEFAULT_STOCK_PCT,
    debtStrategy: life.book.strategy,
    extraMonthly: life.book.extraMonthly,
    emergencyMonths: expenses > 0 ? roundTo(emergency / expenses, 0.5) : 0,
    lifestyle: "normal",
    crashRule: "hold",
  };
}

/**
 * The plan research/10 recommends: the full employer match, 3 months of
 * emergency fund, stocks by age (110 minus age, between 50% and 90%),
 * avalanche on debt, hold through crashes, and the spare money split between
 * extra debt payments and a recurring deposit.
 */
export function recommendedOrders(life: PlayerLife): StandingOrders {
  const o: StandingOrders = {
    ...currentOrders(life),
    k401Pct: MATCH_UP_TO,
    stockPct: clamp(roundTo((110 - life.age) / 100, 0.05), 0.5, 0.9),
    debtStrategy: "avalanche",
    emergencyMonths: 3,
    crashRule: "hold",
    extraMonthly: 0,
    depositMonthly: 0,
  };
  const free = Math.max(0, budget(life, o).surplus);
  o.extraMonthly = life.totalDebt() > 0 ? roundTo(free * 0.4, 25) : 0;
  // Leave about a third of the rest to build the emergency fund.
  o.depositMonthly = roundTo((free - o.extraMonthly) * 0.6, 25);
  return o;
}

export interface Budget {
  takeHome: number;
  /** Monthly 401(k) contribution and what it costs in take-home after the tax it saves. */
  k401: number;
  k401Cost: number;
  match: number;
  rent: number;
  living: number;
  minimums: number;
  extra: number;
  deposit: number;
  /** What's left each month; negative means the plan drains savings. */
  surplus: number;
}

export function budget(life: PlayerLife, o: StandingOrders): Budget {
  const gross = life.grossAnnual / 12;
  const k401 = life.employed ? Math.min(o.k401Pct * gross, K401_LIMIT / 12) : 0;
  const k401Cost = k401 * (1 - K401_TAX_SAVING);
  const match = k401 > 0 ? Math.min(o.k401Pct, MATCH_UP_TO) * MATCH_RATE * gross : 0;
  const living = life.baseLiving * LIFESTYLE_FACTOR[o.lifestyle];
  const minimums = life.minimums();
  const takeHome = life.monthlyTakeHome;
  const surplus = takeHome - k401Cost - life.rent - living - minimums - o.extraMonthly - o.depositMonthly;
  return {
    takeHome: round2(takeHome),
    k401: round2(k401),
    k401Cost: round2(k401Cost),
    match: round2(match),
    rent: life.rent,
    living: round2(living),
    minimums,
    extra: o.extraMonthly,
    deposit: o.depositMonthly,
    surplus: round2(surplus),
  };
}

/** Employer match left on the table each year at this contribution. */
export function missedMatch(life: PlayerLife, o: StandingOrders): number {
  return Math.round(Math.max(0, MATCH_UP_TO - o.k401Pct) * MATCH_RATE * life.grossAnnual);
}

export function clampOrders(o: StandingOrders): StandingOrders {
  return {
    ...o,
    depositMonthly: Math.max(0, Math.round(o.depositMonthly)),
    k401Pct: clamp(o.k401Pct, 0, 0.75),
    stockPct: clamp(o.stockPct, 0, 1),
    extraMonthly: Math.max(0, Math.round(o.extraMonthly)),
    emergencyMonths: clamp(o.emergencyMonths, 0, 12),
  };
}

/** Puts the plan in force from today, for live play and fast-forwards alike. */
export function applyOrders(life: PlayerLife, o: StandingOrders): void {
  const orders = clampOrders(o);
  life.orders = orders;
  life.book.strategy = orders.debtStrategy;
  life.book.extraMonthly = orders.extraMonthly;
}
