// Payoff strategies and monthly projections. Projections power the payment
// slider ("debt-free in March 2029"), the age teleport's debt input, and the
// ghost lines that compare minimums, snowball, and avalanche.

import { cardMinimum } from "./math.ts";
import type { Debt, Strategy } from "./types.ts";

/** Avalanche: highest APR first. Snowball: smallest balance first. */
export function orderByStrategy(debts: Debt[], strategy: Strategy): Debt[] {
  const list = [...debts];
  if (strategy === "avalanche") list.sort((a, b) => b.aprAnnual - a.aprAnnual || a.balance - b.balance);
  else if (strategy === "snowball") list.sort((a, b) => a.balance + a.accrued - (b.balance + b.accrued) || b.aprAnnual - a.aprAnnual);
  return list;
}

export interface Projection {
  strategy: Strategy;
  months: number;
  interest: number;
  /** Month each debt reached $0 (1 = the first month). */
  payoffs: { id: string; name: string; month: number }[];
  /** Total balance at the end of each month, starting with month 0. */
  series: number[];
  /** Optional per-debt balances on the same monthly projection, for housing LTV. */
  debtSeries?: Record<string, number[]>;
  /** True if the balance never reaches 0 within the horizon. */
  stuck: boolean;
}

interface Row {
  id: string;
  name: string;
  kind: Debt["kind"];
  balance: number;
  apr: number;
  payment: number;
}

/**
 * Month-by-month projection. Cards pay the real minimum (greater of $25 or
 * 1% plus interest); installment loans pay their fixed payment. Under
 * snowball or avalanche, `extra` plus every freed-up payment goes to the
 * target debt.
 */
export function project(debts: Debt[], strategy: Strategy, extra: number, maxMonths = 720, includeDebtSeries = false): Projection {
  const rows: Row[] = debts
    .filter((d) => d.status !== "paid" && d.status !== "discharged" && d.balance + d.accrued > 0)
    .map((d) => ({ id: d.id, name: d.name, kind: d.kind, balance: d.balance + d.accrued, apr: d.aprAnnual, payment: d.scheduledPayment ?? 0 }));
  const payoffs: Projection["payoffs"] = [];
  const series = [rows.reduce((s, r) => s + r.balance, 0)];
  const debtSeries = includeDebtSeries ? Object.fromEntries(rows.map(r => [r.id, [r.balance]])) : undefined;
  let interest = 0;
  let freed = 0;
  let month = 0;

  while (rows.some((r) => r.balance > 0.005) && month < maxMonths) {
    month++;
    // Interest and required payments.
    for (const r of rows) {
      if (r.balance <= 0.005) continue;
      const i = (r.balance * r.apr) / 12;
      interest += i;
      r.balance += i;
      const due = r.kind === "credit_card" ? cardMinimum(r.balance - i, i) : Math.min(r.payment, r.balance);
      r.balance -= Math.min(due, r.balance);
    }
    // Strategy money.
    if (strategy !== "minimums") {
      let pool = extra + freed;
      const open = rows.filter((r) => r.balance > 0.005);
      const ordered =
        strategy === "avalanche"
          ? open.sort((a, b) => b.apr - a.apr || a.balance - b.balance)
          : open.sort((a, b) => a.balance - b.balance || b.apr - a.apr);
      for (const r of ordered) {
        if (pool <= 0) break;
        const take = Math.min(pool, r.balance);
        r.balance -= take;
        pool -= take;
      }
    }
    for (const r of rows) {
      if (r.balance <= 0.005 && !payoffs.some((p) => p.id === r.id)) {
        r.balance = 0;
        payoffs.push({ id: r.id, name: r.name, month });
        // A paid card frees its last minimum; a paid loan frees its payment.
        freed += r.kind === "credit_card" ? 25 : r.payment;
      }
    }
    series.push(rows.reduce((s, r) => s + r.balance, 0));
    if (debtSeries) for (const r of rows) debtSeries[r.id].push(r.balance);
  }
  const stuck = rows.some((r) => r.balance > 0.005);
  return { strategy, months: month, interest, payoffs, series, stuck, ...(debtSeries ? { debtSeries } : {}) };
}

/** All three strategies on the same debts, for the ghost lines and the recap. */
export function compareStrategies(debts: Debt[], extra: number): Record<Strategy, Projection> {
  return {
    minimums: project(debts, "minimums", extra),
    snowball: project(debts, "snowball", extra),
    avalanche: project(debts, "avalanche", extra),
  };
}

/** Months to pay off a single card with a fixed payment (the slider on one card). */
export function cardPayoff(balance: number, aprAnnual: number, payment: number | "minimum", maxMonths = 720): { months: number; interest: number; stuck: boolean } {
  let b = balance;
  let interest = 0;
  let m = 0;
  while (b > 0.005 && m < maxMonths) {
    m++;
    const i = (b * aprAnnual) / 12;
    interest += i;
    const pay = payment === "minimum" ? cardMinimum(b, i) : payment;
    b = b + i - Math.min(pay, b + i);
  }
  return { months: m, interest, stuck: b > 0.005 };
}
