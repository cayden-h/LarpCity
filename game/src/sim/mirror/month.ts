// Turns a life's money into a monthly bank statement for Nessie. Nessie only
// logs transactions and keeps whole dollars (it truncates cents and never
// applies a transaction to an account's balance), so the sim stays the source
// of truth: each game month becomes a few category entries from the life's
// events (paychecks, rent, card payments, investing, interest), plus one
// "Transfers and other" entry per account that makes the balance Nessie
// implies (opening + deposits - withdrawals) equal the sim's to the dollar.
// That last entry also covers what events don't say, like which account the
// shortfall waterfall drew a bill from, or card interest.
//
// Months that pile up unposted (a goal fast-forward, or the server being
// down) collapse into one summary batch, the SETUP.md rule for skips.

import { isOpen, owed } from "../debt/index.ts";
import type { LifeEvent, PlayerLife } from "../life/player.ts";
import type { MirrorAccount, MirrorBalances, MirrorEntry } from "./types.ts";

export const MIRROR_ACCOUNTS: readonly MirrorAccount[] = ["checking", "savings", "credit"];
export const OTHER_MEMO = "Transfers and other";

export interface MirrorBatch {
  /** Months covered, oldest first ("2026-10"). */
  months: string[];
  entries: MirrorEntry[];
  /** The balances these entries reach; the next batch starts from them. */
  closing: MirrorBalances;
}

interface Month {
  /** Signed dollars by `${account}|${memo}`. */
  flows: Map<string, number>;
  /** Balances at the end of the last day seen in this month. */
  closing: MirrorBalances;
}

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function isoDate(d: Date): string {
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The last calendar day of a month key, as YYYY-MM-DD. */
export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return isoDate(new Date(y, m, 0));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class MonthMirror {
  readonly life: PlayerLife;
  private readonly start: Date;
  private readonly months = new Map<string, Month>();
  /** What the posted entries add up to; null until the account is opened. */
  private posted: MirrorBalances | null = null;
  /** Rewinds so far; entries after one are keyed apart, since Nessie skips a key it already holds. */
  private branch = 0;

  constructor(life: PlayerLife, start: Date) {
    this.life = life;
    this.start = start;
    life.onEvents((events) => this.record(events));
  }

  /** Whole-dollar balances right now. */
  balances(): MirrorBalances {
    const accounts = this.life.ledger.accounts;
    const bal = (id: string) => accounts.get(id)?.balance ?? 0;
    const credit = this.life.book.debts.filter((d) => d.kind === "credit_card" && isOpen(d)).reduce((s, d) => s + owed(d), 0);
    return { checking: Math.round(bal("checking")), savings: Math.round(bal("savings") + bal("emergency")), credit: Math.round(credit) };
  }

  /** Starts a fresh statement from today's balances; returns the opening balances (never below zero, Nessie's rule). */
  open(): MirrorBalances {
    const b = this.balances();
    const opening = { checking: Math.max(0, b.checking), savings: Math.max(0, b.savings), credit: Math.max(0, b.credit) };
    this.months.clear();
    this.posted = { ...opening };
    return opening;
  }

  /** Continue from what the server says the posted entries add up to (a reopened run). */
  rebase(balances: MirrorBalances): void {
    this.posted = { ...balances };
  }

  get opened(): boolean {
    return this.posted !== null;
  }

  /** Forget the posted baseline (the server lost the run) but keep the recorded months; open again next. */
  close(): void {
    this.posted = null;
  }

  /** The batch for every finished month before the month of `today`, or null when there is nothing to post. */
  prepare(today: number): MirrorBatch | null {
    if (!this.posted) return null;
    const current = monthKey(this.dateOf(today));
    const done = [...this.months.keys()].filter((k) => k < current).sort();
    if (!done.length) return null;

    const last = done[done.length - 1];
    const span = done.length === 1 ? last : `${done[0]}..${last}`;
    const date = lastDayOf(last);
    const closing = this.months.get(last)!.closing;
    const sums = new Map<string, number>();
    for (const k of done) for (const [flow, v] of this.months.get(k)!.flows) sums.set(flow, (sums.get(flow) ?? 0) + v);

    const entries: MirrorEntry[] = [];
    const reached = { ...this.posted };
    const push = (account: MirrorAccount, memo: string, signed: number) => {
      const amount = Math.round(Math.abs(signed));
      if (!amount) return;
      const kind = signed > 0 ? "deposit" : "withdrawal";
      entries.push({ key: `${this.branch ? `r${this.branch}:` : ""}${span}:${account}:${slug(memo)}`, account, kind, amount, date, memo: done.length > 1 ? `${memo} (${done.length} months)` : memo });
      reached[account] += kind === "deposit" ? amount : -amount;
    };
    for (const [flow, v] of sums) {
      const [account, memo] = flow.split("|") as [MirrorAccount, string];
      push(account, memo, v);
    }
    for (const a of MIRROR_ACCOUNTS) push(a, OTHER_MEMO, closing[a] - reached[a]);
    return { months: done, entries, closing };
  }

  /**
   * The life went back to `day`: forget the unposted months from that day's
   * month on (the next batch's "Transfers and other" entries bring Nessie back
   * to the sim's balances), and key what comes next as a new branch, since
   * Nessie already holds the relived months' old keys.
   */
  rewind(day: number): void {
    const from = monthKey(this.dateOf(day));
    for (const k of [...this.months.keys()]) if (k >= from) this.months.delete(k);
    this.branch++;
  }

  /** The server has the batch: drop its months and continue from its closing balances. */
  commit(batch: MirrorBatch): void {
    for (const k of batch.months) this.months.delete(k);
    this.posted = { ...batch.closing };
  }

  private dateOf(day: number): Date {
    const d = new Date(this.start);
    d.setDate(d.getDate() + day);
    return d;
  }

  private record(events: LifeEvent[]): void {
    // One emit is one day (a game day, or a trade made today).
    const day = events.length ? events[events.length - 1].day : this.life.today;
    const key = monthKey(this.dateOf(day));
    let m = this.months.get(key);
    if (!m) this.months.set(key, (m = { flows: new Map(), closing: this.balances() }));
    for (const e of events) this.flow(m, e);
    m.closing = this.balances();
  }

  private flow(m: Month, e: LifeEvent): void {
    const add = (account: MirrorAccount, memo: string, signed: number) => {
      const k = `${account}|${memo}`;
      m.flows.set(k, (m.flows.get(k) ?? 0) + signed);
    };
    switch (e.type) {
      case "paycheck":
        add("checking", "Paycheck", e.takeHome);
        break;
      case "bill":
        add("checking", e.name, -e.paid);
        break;
      case "payment": {
        const debt = this.life.book.debts.find((d) => d.id === e.debtId);
        if (debt?.kind === "credit_card") {
          add("checking", "Card payment", -e.amount);
          add("credit", "Payment", -e.amount);
        } else add("checking", `${debt?.name ?? "Loan"} payment`, -e.amount);
        break;
      }
      case "trade":
        add("checking", "Investing", e.side === "buy" ? -e.amount : e.amount);
        break;
      case "savings_interest":
        add("savings", "Interest", e.amount);
        break;
    }
  }
}
