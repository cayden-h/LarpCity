// The live preview on the setup screen: the plan run month by month across
// 100 other possible markets (futures.ts), summarized as a net-worth band and
// when the goal is reached (research/10, "The live preview").

import { project } from "../debt/index.ts";
import { K401_LIMIT, K401_TAX_SAVING, MATCH_RATE, MATCH_UP_TO, type PlayerLife } from "../life/player.ts";
import { homeMortgage, housingBills } from "../life/homes.ts";
import { CrashWatch } from "./crash.ts";
import type { Future } from "./futures.ts";
import { homePrice, isMet, netWorthOf } from "./goals.ts";
import { LIFESTYLE_FACTOR, type Goal, type GoalView, type StandingOrders } from "./types.ts";

export interface Preview {
  /** Months from today to the age cap (or to the end of the futures). */
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
  /** Whether this financial projection can estimate when the selected goal happens. */
  goalTiming: "modeled" | "relationship_unsupported" | "income_static";
}

export interface PreviewOptions {
  futures: Future[];
  /** Today's month offset into the futures (futureMonth). */
  month: number;
  capAge: number;
}

function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

export function runPreview(life: PlayerLife, orders: StandingOrders, goal: Goal, opts: PreviewOptions): Preview {
  const runs = opts.futures.length;
  const available = opts.futures[0].stock.length - 1 - opts.month;
  const horizon = Math.max(1, Math.min(available, Math.round((opts.capAge - life.age) * 12)));
  const gross = life.grossAnnual / 12;
  const k401 = life.employed ? Math.min(orders.k401Pct * gross, K401_LIMIT / 12) : 0;
  const match = k401 > 0 ? Math.min(orders.k401Pct, MATCH_UP_TO) * MATCH_RATE * gross : 0;
  const income = life.monthlyTakeHome - k401 * (1 - K401_TAX_SAVING);
  const rent = life.rent;
  const home = life.home;
  const ownerBills = life.housingBills();
  const living = life.baseLiving * LIFESTYLE_FACTOR[orders.lifestyle];
  const minimums = life.minimums();
  const price = homePrice(life.place);
  const goalTiming = goal.kind === "marriage" ? "relationship_unsupported" : goal.kind === "status" ? "income_static" : "modeled";

  // Debt follows the payoff projection; the total payment stays level until the last debt is gone.
  const plan = project(life.book.debts, orders.debtStrategy, orders.extraMonthly, Math.max(720, horizon), home.tenure === "own");
  const debtMonths = plan.stuck ? Number.POSITIVE_INFINITY : plan.months;
  // Track the mortgage within the complete payoff plan, so other debts and the
  // strategy's extra payments affect amortization without becoming home equity.
  const mortgage = homeMortgage(home, life.book);
  const mortgageBalances = mortgage ? plan.debtSeries?.[mortgage.id] : undefined;
  const housingCosts = Array.from({ length: horizon + 1 }, (_, mo) => {
    if (mo === 0 || !mortgage || !mortgageBalances) return ownerBills.taxAndInsurance + ownerBills.pmi;
    const balance = mortgageBalances[Math.min(mo, mortgageBalances.length - 1)];
    const bills = housingBills(home, { ...life.book, debts: [{ ...mortgage, balance, accrued: 0 }] });
    return bills.taxAndInsurance + bills.pmi;
  });
  const debtAt = (mo: number) => plan.series[Math.min(mo, plan.series.length - 1)] ?? 0;

  const start = { cash: 0, emergency: 0, brokerage: 0, retirement: 0 };
  for (const a of life.ledger.accounts.values()) {
    if (a.kind === "checking" || a.kind === "savings") start.cash += a.balance;
    else if (a.kind === "emergency") start.emergency += a.balance;
    else if (a.kind === "brokerage") start.brokerage += a.balance;
    else start.retirement += a.balance;
  }
  for (const p of life.positions()) start.brokerage += p.value;

  const cols = horizon + 1;
  const worth = new Float64Array(runs * cols);
  const reachMonths: number[] = [];
  let broke = 0;

  for (let i = 0; i < runs; i++) {
    const f = opts.futures[i];
    const watch = new CrashWatch();
    watch.peak = f.stock[opts.month];
    let { cash, emergency, brokerage, retirement } = start;
    let reachedAt = -1;
    let out = false;
    for (let mo = 0; mo <= horizon; mo++) {
      const inDebt = mo < debtMonths;
      const service = inDebt ? minimums + orders.extraMonthly : 0;
      const housing = housingCosts[mo];
      if (mo > 0 && !out) {
        cash += income - rent - housingCosts[mo - 1] - living - service;
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
          let spare = cash - (rent + housing + living + service);
          const topUp = Math.min(Math.max(0, spare), Math.max(0, orders.emergencyMonths * (rent + housing + living + (inDebt ? minimums : 0)) - emergency));
          emergency += topUp;
          cash -= topUp;
          spare -= topUp;
          const deposit = Math.min(Math.max(0, spare), orders.depositMonthly);
          brokerage += deposit;
          cash -= deposit;
        }
        const k = opts.month + mo - 1;
        // Stocks sold in a panic sit in cash, earning nothing, until the rule buys back.
        const held = orders.stockPct * watch.held(orders.crashRule);
        const r = held * (f.stock[k + 1] / f.stock[k] - 1) + (1 - orders.stockPct) * (f.bond[k + 1] / f.bond[k] - 1);
        brokerage *= 1 + r;
        retirement *= 1 + r;
        watch.update(f.stock[k + 1], orders.crashRule);
      }
      const debt = debtAt(mo);
      const view: GoalView = {
        cash,
        emergency,
        brokerage,
        retirement,
        homeValue: home.value,
        debt,
        minimums: inDebt ? minimums : 0,
        monthlyExpenses: rent + housing + living + (inDebt ? minimums : 0),
        monthlyGross: gross,
        homePrice: price,
        relationship: life.relationship,
        grossAnnual: life.grossAnnual,
      };
      worth[i * cols + mo] = netWorthOf(view);
      if (reachedAt < 0 && !out && isMet(goal, view)) reachedAt = mo;
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
    goalTiming,
  };
}
