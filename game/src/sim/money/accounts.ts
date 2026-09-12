// Moving money between the player's accounts, and between cards.
//
// Every move is quoted first (fee, penalty, tax, settle day, warnings) so the
// transfer screen can show the cost before the player confirms, then executed
// by the Ledger. Money leaves the source immediately and lands on the settle
// day, so a slow ACH can leave checking short on a due date (a real lesson).
// Sources for every number: research/08-cards-loans-accounts.md, section 4.

import type { Debt, Wallet } from "../debt/types.ts";
import type { Account, AccountKind, Rail, Transfer, TransferQuote } from "./types.ts";

/** Standard ACH takes 1-3 business days; the game uses 2. */
export const ACH_BUSINESS_DAYS = 2;
/** Outgoing domestic wire; real banks charge $15-$50. */
export const WIRE_FEE = 25;
/** Instant transfer (Venmo-style): 1.75%, min $0.25, max $25. */
export const INSTANT_RATE = 0.0175;
export const INSTANT_MIN = 0.25;
export const INSTANT_MAX = 25;
/** Defaults when a card's catalog entry has no fee data: 5% or $10; balance transfers 5% or $5. */
export const CASH_ADVANCE_FEE_PCT = 0.05;
export const CASH_ADVANCE_FEE_MIN = 10;
export const BALANCE_TRANSFER_FEE_PCT = 0.05;
export const BALANCE_TRANSFER_FEE_MIN = 5;
/** Balance transfers take days to weeks to post (UNVERIFIED typical); the game uses 7 calendar days. */
export const BALANCE_TRANSFER_DAYS = 7;
/** Early withdrawal from a 401(k) or Roth earnings before 59 1/2: 10% penalty plus income tax (game flat 22%). */
export const EARLY_WITHDRAWAL_PENALTY = 0.1;
export const WITHDRAWAL_TAX_RATE = 0.22;
export const RETIREMENT_AGE = 59.5;
/** Bankrate's 2025 checking survey average overdraft fee. */
export const OVERDRAFT_FEE = 26.77;
/** Reg D's six-a-month savings limit was deleted in 2020, but many banks still enforce it. */
export const SAVINGS_MONTHLY_WITHDRAWALS = 6;

const round2 = (x: number) => Math.round(x * 100) / 100;
const RETIREMENT: AccountKind[] = ["k401", "roth_ira"];

/** Game day `n` business days after `day`, where `date` is the calendar date of `day`. */
export function addBusinessDays(day: number, date: Date, n: number): number {
  const d = new Date(date);
  let out = day;
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    out++;
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return out;
}

export function railFee(rail: Rail, amount: number): number {
  switch (rail) {
    case "wire":
      return WIRE_FEE;
    case "instant":
      return round2(Math.min(INSTANT_MAX, Math.max(INSTANT_MIN, amount * INSTANT_RATE)));
    default:
      return 0;
  }
}

export interface MoveContext {
  day: number;
  date: Date;
  /** Player age, for retirement withdrawal penalties. */
  age: number;
}

/** Quote a move between two cash or investment accounts. */
export function quoteTransfer(from: Account, to: Account, amount: number, rail: Rail, ctx: MoveContext): TransferQuote {
  const warnings: string[] = [];
  const fail = (error: string): TransferQuote => ({ rail, amount, fee: 0, penalty: 0, tax: 0, received: 0, settlesDay: ctx.day, warnings, ok: false, error });
  if (!(amount > 0)) return fail("Enter an amount above $0.");
  if (from.id === to.id) return fail("Pick two different accounts.");
  if (rail === "cash_advance" || rail === "balance_transfer") return fail("Use cashAdvance or balanceTransfer for card moves.");
  if (RETIREMENT.includes(to.kind) && rail !== "internal") warnings.push("Retirement contributions have yearly limits ($7,500 IRA, $24,500 401(k) in 2026).");

  let fee = railFee(rail, amount);
  if (rail === "instant") warnings.push(`Instant costs $${fee.toFixed(2)}; standard ACH is free and takes ${ACH_BUSINESS_DAYS} business days.`);

  if (from.kind === "savings" && from.excessWithdrawalFee && (from.withdrawalsThisMonth ?? 0) >= SAVINGS_MONTHLY_WITHDRAWALS) {
    fee += from.excessWithdrawalFee;
    warnings.push(`Your bank limits savings to ${SAVINGS_MONTHLY_WITHDRAWALS} withdrawals a month; this one costs $${from.excessWithdrawalFee}.`);
  }

  // Retirement money: taxes and the early-withdrawal penalty come out of what's received.
  let penalty = 0;
  let tax = 0;
  if (RETIREMENT.includes(from.kind) && !RETIREMENT.includes(to.kind)) {
    const early = ctx.age < RETIREMENT_AGE;
    const taxable = from.kind === "roth_ira" ? Math.max(0, amount - (from.rothContributions ?? 0)) : amount;
    if (from.kind === "k401" || early) tax = round2(taxable * WITHDRAWAL_TAX_RATE);
    if (early) penalty = round2(taxable * EARLY_WITHDRAWAL_PENALTY);
    if (penalty > 0) warnings.push(`Withdrawing before 59½ costs a 10% penalty ($${penalty.toFixed(2)}) plus about $${tax.toFixed(2)} of income tax.`);
    if (from.kind === "roth_ira" && taxable < amount) warnings.push("Roth contributions come out tax- and penalty-free; only the earnings are taxed early.");
  }

  if (from.balance < amount + fee) return fail(`${from.name} has $${from.balance.toFixed(2)}; this needs $${(amount + fee).toFixed(2)}.`);

  const settlesDay =
    rail === "ach" ? addBusinessDays(ctx.day, ctx.date, ACH_BUSINESS_DAYS)
    : rail === "same_day_ach" ? addBusinessDays(ctx.day, ctx.date, isBusinessDay(ctx.date) ? 0 : 1)
    : ctx.day; // internal, wire, instant
  return { rail, amount, fee, penalty, tax, received: round2(amount - penalty - tax), settlesDay, warnings, ok: true };
}

const isBusinessDay = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;

/** Cash advance: card fee up front, no grace period, so interest starts today. */
export function quoteCashAdvance(card: Debt, amount: number, feePct = CASH_ADVANCE_FEE_PCT, feeMin = CASH_ADVANCE_FEE_MIN): TransferQuote & { fee: number } {
  const fee = round2(Math.max(feeMin, amount * feePct));
  const available = (card.creditLimit ?? 0) - card.balance - card.accrued;
  const base = { rail: "cash_advance" as Rail, amount, fee, penalty: 0, tax: 0, received: amount, settlesDay: 0 };
  if (!(amount > 0) || amount + fee > available) {
    return { ...base, received: 0, warnings: [], ok: false, error: `Available credit is $${Math.max(0, available).toFixed(2)}.` };
  }
  return {
    ...base,
    warnings: [`A $${fee.toFixed(2)} fee, and interest starts today with no grace period. A $500 emergency fund avoids this.`],
    ok: true,
  };
}

/** Balance transfer between cards: fee added to the new card, which gets its promo APR. */
export function quoteBalanceTransfer(from: Debt, to: Debt, amount: number, feePct = BALANCE_TRANSFER_FEE_PCT, feeMin = BALANCE_TRANSFER_FEE_MIN): TransferQuote {
  const fee = round2(Math.max(feeMin, amount * feePct));
  const available = (to.creditLimit ?? 0) - to.balance - to.accrued;
  const base = { rail: "balance_transfer" as Rail, amount, fee, penalty: 0, tax: 0, received: amount, settlesDay: 0 };
  if (from.id === to.id || from.kind !== "credit_card" || to.kind !== "credit_card") return { ...base, received: 0, warnings: [], ok: false, error: "Balance transfers go from one card to another." };
  if (!(amount > 0) || amount > from.balance + from.accrued + 0.005) return { ...base, received: 0, warnings: [], ok: false, error: `${from.name} only owes $${(from.balance + from.accrued).toFixed(2)}.` };
  if (amount + fee > available) return { ...base, received: 0, warnings: [], ok: false, error: `${to.name} has $${Math.max(0, available).toFixed(2)} of available credit.` };
  const warnings = [`The ${Math.round((fee / amount) * 100)}% fee is $${fee.toFixed(2)}.`];
  if (to.promoUntil !== undefined) warnings.push("Pay it off before the promo ends, or the regular APR applies to what's left.");
  return { ...base, warnings, ok: true };
}

/**
 * The player's cash and investment accounts plus in-flight transfers. Cards
 * and loans stay in the DebtBook; card moves take the Debt directly.
 */
export class Ledger {
  accounts = new Map<string, Account>();
  pending: Transfer[] = [];
  history: Transfer[] = [];
  private seq = 0;

  constructor(accounts: Account[]) {
    for (const a of accounts) this.accounts.set(a.id, a);
  }

  get(id: string): Account {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`No account ${id}`);
    return a;
  }

  quote(fromId: string, toId: string, amount: number, rail: Rail, ctx: MoveContext): TransferQuote {
    return quoteTransfer(this.get(fromId), this.get(toId), amount, rail, ctx);
  }

  /** Debits the source now; the destination is credited on the settle day. */
  transfer(fromId: string, toId: string, amount: number, rail: Rail, ctx: MoveContext): Transfer {
    const from = this.get(fromId);
    const q = quoteTransfer(from, this.get(toId), amount, rail, ctx);
    if (!q.ok) throw new Error(q.error);
    from.balance = round2(from.balance - amount - q.fee);
    if (from.kind === "roth_ira") from.rothContributions = Math.max(0, (from.rothContributions ?? 0) - amount);
    if (from.kind === "savings") from.withdrawalsThisMonth = (from.withdrawalsThisMonth ?? 0) + 1;
    const t: Transfer = { ...q, id: `t${++this.seq}`, from: fromId, to: toId, day: ctx.day, status: "pending" };
    this.pending.push(t);
    this.settle(ctx.day);
    return t;
  }

  /** Lands every transfer due by `day`. Call once per game day. */
  settle(day: number): Transfer[] {
    const due = this.pending.filter((t) => t.settlesDay <= day);
    if (!due.length) return due;
    this.pending = this.pending.filter((t) => t.settlesDay > day);
    for (const t of due) {
      const to = this.get(t.to);
      to.balance = round2(to.balance + t.received);
      if (to.kind === "roth_ira") to.rothContributions = (to.rothContributions ?? 0) + t.received;
      t.status = "settled";
      this.history.push(t);
    }
    return due;
  }

  /** Cash advance from a card into a cash account (instant). */
  cashAdvance(card: Debt, toId: string, amount: number, day: number, feePct?: number, feeMin?: number): Transfer {
    const q = quoteCashAdvance(card, amount, feePct, feeMin);
    if (!q.ok) throw new Error(q.error);
    card.balance = round2(card.balance + amount + q.fee);
    card.inGrace = false; // no grace period on advances
    const to = this.get(toId);
    to.balance = round2(to.balance + amount);
    const t: Transfer = { ...q, settlesDay: day, id: `t${++this.seq}`, from: card.id, to: toId, day, status: "settled" };
    this.history.push(t);
    return t;
  }

  /** Moves a card balance to another card. The old card is paid on the spot; the new one posts the balance plus fee. */
  balanceTransfer(from: Debt, to: Debt, amount: number, day: number, feePct?: number, feeMin?: number): Transfer {
    const q = quoteBalanceTransfer(from, to, amount, feePct, feeMin);
    if (!q.ok) throw new Error(q.error);
    const fromInterest = Math.min(amount, from.accrued);
    from.accrued -= fromInterest;
    from.balance = round2(Math.max(0, from.balance - (amount - fromInterest)));
    to.balance = round2(to.balance + amount + q.fee);
    to.inGrace = false;
    const t: Transfer = { ...q, settlesDay: day + BALANCE_TRANSFER_DAYS, id: `t${++this.seq}`, from: from.id, to: to.id, day, status: "settled" };
    this.history.push(t);
    return t;
  }

  /** Pays monthly interest on every cash account (call on the 1st). */
  payInterest(): number {
    let total = 0;
    for (const a of this.accounts.values()) {
      if (a.kind === "brokerage" || a.kind === "k401" || a.kind === "roth_ira" || a.balance <= 0) continue;
      const i = round2((a.balance * a.apy) / 12);
      a.balance = round2(a.balance + i);
      total += i;
    }
    return total;
  }

  /** Resets the savings withdrawal counters (call on the 1st). */
  newMonth(): void {
    for (const a of this.accounts.values()) if (a.kind === "savings") a.withdrawalsThisMonth = 0;
  }

  /**
   * The debt engine's Wallet over the shortfall waterfall (doc 03): checking,
   * then savings, then the emergency fund. Never the brokerage or retirement.
   */
  wallet(order: string[] = ["checking", "savings", "emergency"]): Wallet {
    const accounts = () => order.map((id) => this.accounts.get(id)).filter((a): a is Account => !!a);
    return {
      available: () => accounts().reduce((s, a) => s + Math.max(0, a.balance), 0),
      withdraw: (amount) => {
        let left = amount;
        for (const a of accounts()) {
          const take = Math.min(left, Math.max(0, a.balance));
          a.balance = round2(a.balance - take);
          left -= take;
          if (left <= 0.005) break;
        }
        return round2(amount - Math.max(0, left));
      },
    };
  }
}
