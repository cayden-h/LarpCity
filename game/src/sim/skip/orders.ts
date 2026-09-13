// Standing orders for a goal fast-forward: what the player does now (the
// setup screen's pre-fill, decided 2026-09-12), a recommended plan to compare
// against, and the monthly budget both are checked against. Applying a plan
// sets the life's recurring buys (sim/market's LTM and BOND funds, split by the
// stock/bond mix), so the Money desk and the fast-forward share one setting.

import { K401_LIMIT, K401_TAX_SAVING, MATCH_RATE, MATCH_UP_TO, MIN_TRADE, ROTH_LIMIT, type PlayerLife, type RecurringBuy } from "../life/player.ts";
import { LIFESTYLE_FACTOR, type StandingOrders } from "./types.ts";

/** Stock share when the player hasn't chosen one (research/10: 90/10). */
export const DEFAULT_STOCK_PCT = 0.9;

const roundTo = (x: number, step: number) => Math.round(x / step) * step;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The stock share of what the player owns now, or null with nothing invested. */
function holdingsMix(life: PlayerLife): number | null {
  let stocks = 0;
  let total = 0;
  for (const p of life.positions()) {
    total += p.value;
    if (p.id !== "BOND") stocks += p.value;
  }
  return total > 0 ? stocks / total : null;
}

/** The plan in force, read back from the life so changes made elsewhere (the Money desk) show up. */
export function currentOrders(life: PlayerLife): StandingOrders {
  const perPayday = life.recurring.reduce((s, r) => s + r.amount, 0);
  const stocksPerPayday = life.recurring.filter((r) => r.id !== "BOND").reduce((s, r) => s + r.amount, 0);
  const expenses = life.monthlyExpenses();
  const emergency = life.ledger.accounts.get("emergency")?.balance ?? 0;
  const habits: StandingOrders = {
    depositMonthly: 0,
    k401Pct: 0,
    rothPct: 0,
    stockPct: DEFAULT_STOCK_PCT,
    debtStrategy: life.book.strategy,
    extraMonthly: life.book.extraMonthly,
    emergencyMonths: expenses > 0 ? roundTo(emergency / expenses, 0.5) : 0,
    lifestyle: "normal",
    crashRule: "hold",
  };
  return {
    ...(life.orders ?? habits),
    depositMonthly: round2(perPayday * 2),
    stockPct: perPayday > 0 ? stocksPerPayday / perPayday : (holdingsMix(life) ?? life.orders?.stockPct ?? DEFAULT_STOCK_PCT),
    debtStrategy: life.book.strategy,
    extraMonthly: life.book.extraMonthly,
  };
}

/**
 * The plan research/10 recommends: the full employer match, 3 months of
 * emergency fund, stocks by age (110 minus age, between 50% and 90%),
 * avalanche on debt, and hold through crashes. Spare money goes to
 * high-interest debt first (never less than today's extra payment), then half
 * of what's left to a recurring deposit, and the rest builds the emergency fund.
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
  const affordable = Math.floor(free / 25) * 25;
  o.extraMonthly = life.totalDebt() > 0 ? Math.min(affordable, Math.max(life.book.extraMonthly, roundTo(free * 0.7, 25))) : 0;
  o.depositMonthly = Math.floor((Math.max(0, free - o.extraMonthly) * 0.5) / 25) * 25;
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

/**
 * Clamps a plan's numbers. `rothPct` is clamped so the yearly Roth
 * contribution (rothPct * grossAnnual) never exceeds `ROTH_LIMIT`; without a
 * `grossAnnual` (a caller that has no income handy) it falls back to a plain
 * [0, 1] share clamp.
 */
export function clampOrders(o: StandingOrders, grossAnnual?: number): StandingOrders {
  // Defensive against a caller (or JSON restored from before rothPct existed) that
  // leaves it out: treat a missing/non-finite value as 0 rather than propagating NaN.
  const rothPctIn = Number.isFinite(o.rothPct) ? o.rothPct : 0;
  const rothPct = grossAnnual !== undefined && grossAnnual > 0 ? clamp(rothPctIn, 0, ROTH_LIMIT / grossAnnual) : clamp(rothPctIn, 0, 1);
  return {
    ...o,
    depositMonthly: Math.max(0, Math.round(o.depositMonthly)),
    k401Pct: clamp(o.k401Pct, 0, 0.75),
    rothPct,
    stockPct: clamp(o.stockPct, 0, 1),
    extraMonthly: Math.max(0, Math.round(o.extraMonthly)),
    emergencyMonths: clamp(o.emergencyMonths, 0, 12),
  };
}

/** The payday buys for a plan: half the monthly deposit each payday, split between the total market and bonds. */
export function recurringFor(o: StandingOrders): RecurringBuy[] {
  const perPayday = o.depositMonthly / 2;
  const buys: RecurringBuy[] = [
    { id: "LTM", amount: round2(perPayday * o.stockPct) },
    { id: "BOND", amount: round2(perPayday * (1 - o.stockPct)) },
  ];
  return buys.filter((b) => b.amount >= MIN_TRADE);
}

/** Puts the plan in force from today, for live play and fast-forwards alike. */
export function applyOrders(life: PlayerLife, o: StandingOrders): void {
  const orders = clampOrders(o, life.grossAnnual);
  life.orders = orders;
  life.recurring = recurringFor(orders);
  life.book.strategy = orders.debtStrategy;
  life.book.extraMonthly = orders.extraMonthly;
}
