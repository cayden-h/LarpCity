// The live preview on the setup screen: the plan run month by month across
// 100 other possible markets, summarized as a net-worth band and when the goal
// is reached. It never uses the run's own seed, so moving a slider can't reveal
// the real future (research/10, "The live preview").

import { hashKeys } from "../../engine/rng.ts";
import { project } from "../debt/index.ts";
import { K401_LIMIT, K401_TAX_SAVING, MATCH_RATE, MATCH_UP_TO, type PlayerLife } from "../life/player.ts";
import { homePrice, isMet } from "./goals.ts";
import { createMarket, monthIndex, portfolioReturn } from "./market.ts";
import { LIFESTYLE_FACTOR, type Goal, type StandingOrders } from "./types.ts";

export interface Preview {
  /** Months from today to the age cap. */
  months: number;
  /** Net worth at the end of each month (index 0 is today): 10th, 50th, and 90th percentile. */
  p10: number[];
  p50: number[];
  p90: number[];
  runs: number;
  /** Futures that met the goal before the cap. */
  reached: number;
  /** Month the goal is typically met, and with 1-in-10 bad luck, among the futures that met it. */
  reachTypical: number | null;
  reachBadLuck: number | null;
  /** Futures that ran out of money. */
  broke: number;
  /** Month the last debt is paid off on this plan; 0 with no debt, null if never. */
  debtFreeMonth: number | null;
}

export function previewSeed(seed: number, i: number): number {
  return hashKeys(seed, "preview", i);
}

function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

export function runPreview(life: PlayerLife, orders: StandingOrders, goal: Goal, opts: { seed: number; startDate: Date; capAge: number; runs?: number }): Preview {
  const runs = opts.runs ?? 100;
  const horizon = Math.max(12, Math.min(600, Math.round((opts.capAge - life.age) * 12)));
  const gross = life.grossAnnual / 12;
  const k401 = life.employed ? Math.min(orders.k401Pct * gross, K401_LIMIT / 12) : 0;
  const match = k401 > 0 ? Math.min(orders.k401Pct, MATCH_UP_TO) * MATCH_RATE * gross : 0;
  const income = life.monthlyTakeHome - k401 * (1 - K401_TAX_SAVING);
  const rent = life.rent;
  const living = life.baseLiving * LIFESTYLE_FACTOR[orders.lifestyle];
  const minimums = life.minimums();
  const price = homePrice(life.place);

  // Debt follows the payoff projection; the total payment stays level until the last debt is gone.
  const plan = project(life.book.debts, orders.debtStrategy, orders.extraMonthly);
  const debtMonths = plan.stuck ? Number.POSITIVE_INFINITY : plan.months;
  const debtAt = (mo: number) => plan.series[Math.min(mo, plan.series.length - 1)] ?? 0;

  const balances = { cash: 0, emergency: 0, brokerage: 0, retirement: 0 };
  for (const a of life.ledger.accounts.values()) {
    if (a.kind === "checking" || a.kind === "savings") balances.cash += a.balance;
    else if (a.kind === "emergency") balances.emergency += a.balance;
    else if (a.kind === "brokerage") balances.brokerage += a.balance;
    else balances.retirement += a.balance;
  }

  const cols = horizon + 1;
  const worth = new Float64Array(runs * cols);
  const reachMonths: number[] = [];
  let broke = 0;
  const years = Math.ceil(horizon / 12) + 2;

  for (let i = 0; i < runs; i++) {
    const market = createMarket(previewSeed(opts.seed, i), opts.startDate, years);
    const m0 = monthIndex(market, opts.startDate);
    let { cash, emergency, brokerage, retirement } = balances;
    let reachedAt = -1;
    let out = false;
    for (let mo = 0; mo <= horizon; mo++) {
      const inDebt = mo < debtMonths;
      const service = inDebt ? minimums + orders.extraMonthly : 0;
      if (mo > 0 && !out) {
        cash += income - rent - living - service;
        retirement += k401 + match;
        if (cash < 0) {
          const fromEmergency = Math.min(emergency, -cash);
          emergency -= fromEmergency;
          cash += fromEmergency;
          const fromBrokerage = Math.min(brokerage, Math.max(0, -cash));
          brokerage -= fromBrokerage;
          cash += fromBrokerage;
          if (cash < 0) {
            out = true;
            broke++;
          }
        } else {
          let spare = cash - (rent + living + service);
          const topUp = Math.min(Math.max(0, spare), Math.max(0, orders.emergencyMonths * (rent + living + (inDebt ? minimums : 0)) - emergency));
          emergency += topUp;
          cash -= topUp;
          spare -= topUp;
          const deposit = Math.min(Math.max(0, spare), orders.depositMonthly);
          brokerage += deposit;
          cash -= deposit;
        }
        const r = portfolioReturn(market, m0 + mo - 1, orders.stockPct, orders.crashRule);
        brokerage *= 1 + r;
        retirement *= 1 + r;
      }
      const debt = debtAt(mo);
      worth[i * cols + mo] = cash + emergency + brokerage + retirement - debt;
      if (reachedAt < 0 && !out) {
        const view = {
          cash,
          emergency,
          brokerage,
          retirement,
          debt,
          minimums: inDebt ? minimums : 0,
          monthlyExpenses: rent + living + (inDebt ? minimums : 0),
          monthlyGross: gross,
          homePrice: price,
        };
        if (isMet(goal, view)) reachedAt = mo;
      }
    }
    if (reachedAt >= 0) reachMonths.push(reachedAt);
  }

  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  const col: number[] = new Array(runs);
  for (let mo = 0; mo < cols; mo++) {
    for (let i = 0; i < runs; i++) col[i] = worth[i * cols + mo];
    col.sort((a, b) => a - b);
    p10.push(quantile(col, 0.1));
    p50.push(quantile(col, 0.5));
    p90.push(quantile(col, 0.9));
  }
  reachMonths.sort((a, b) => a - b);
  return {
    months: horizon,
    p10,
    p50,
    p90,
    runs,
    reached: reachMonths.length,
    reachTypical: reachMonths.length ? quantile(reachMonths, 0.5) : null,
    reachBadLuck: reachMonths.length ? quantile(reachMonths, 0.9) : null,
    broke,
    debtFreeMonth: plan.stuck ? null : plan.months,
  };
}
