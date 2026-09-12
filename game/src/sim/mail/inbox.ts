// The phone's Mail app: letters from the bank, the landlord, the credit
// bureau, and the market, built from the life's events. Routine days
// (a bill paid in full, a normal card payment) send nothing, so the inbox
// reads like the moments that matter. Decision mail (a payment the player
// can't cover, bankruptcy, a crash) opens the Money desk on that decision.
// The inbox is part of the saved game.

import type { LifeEvent } from "../life/player.ts";

export type MailTone = "good" | "bad" | "info";

export interface MailItem {
  id: string;
  day: number;
  from: string;
  subject: string;
  body: string;
  tone: MailTone;
  /** Opening it opens the Money desk. */
  decision: boolean;
  read: boolean;
}

export interface InboxSave {
  items: MailItem[];
  seq: number;
}

/** The inbox keeps this many letters, newest first. */
export const MAX_MAIL = 200;
/** A score move smaller than this isn't worth a letter. */
const SCORE_MAIL_STEP = 10;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type Letter = Omit<MailItem, "id" | "read" | "day" | "decision"> & { decision?: boolean };

/** The letter an event sends, or null for a routine one. `debtName` names a debt by id. */
export function mailFor(e: LifeEvent, debtName: (id: string) => string): (Letter & { decision: boolean }) | null {
  const l = letter(e, debtName);
  return l ? { ...l, decision: l.decision ?? false } : null;
}

function letter(e: LifeEvent, debtName: (id: string) => string): Letter | null {
  switch (e.type) {
    case "paycheck":
      return { from: "Payroll", subject: e.unemployed ? "Unemployment benefits paid" : "Your pay stub", body: `${usd(e.takeHome)} landed in checking${e.garnished ? `, after ${usd(e.garnished)} was garnished` : ""}${e.retirement ? `. ${usd(e.retirement)} went to your 401(k)` : ""}.`, tone: "info" };
    case "bill":
      if (e.amount - e.paid < 0.5) return null;
      return { from: e.name === "Rent" ? "Your landlord" : "Utilities", subject: `${e.name} came up short`, body: `${e.name} was ${usd(e.amount)} and only ${usd(e.paid)} could be paid. Short by ${usd(e.amount - e.paid)}.`, tone: "bad" };
    case "missed":
      return { from: debtName(e.debtId), subject: "Payment missed", body: `The ${usd(e.due)} payment on your ${debtName(e.debtId)} was missed${e.fee ? `, with a ${usd(e.fee)} late fee` : ""}.`, tone: "bad" };
    case "late_mark":
      return { from: "Credit bureau", subject: `Reported ${e.severity} days late`, body: `Your ${debtName(e.debtId)} was reported ${e.severity} days late. Your score went from ${e.scoreBefore} to ${e.scoreAfter}.`, tone: "bad" };
    case "penalty_apr":
      return { from: debtName(e.debtId), subject: "Penalty rate applied", body: `Your ${debtName(e.debtId)} now charges ${(e.apr * 100).toFixed(2)}% after late payments.`, tone: "bad" };
    case "collections":
      return { from: "Collections agency", subject: "Your account was sold", body: `Your ${debtName(e.debtId)} (${usd(e.balance)}) was sold to a debt collector.`, tone: "bad" };
    case "repossessed":
      return { from: debtName(e.debtId), subject: "Vehicle repossessed", body: `Your car was repossessed. ${usd(e.deficiency)} is still owed after the sale.`, tone: "bad" };
    case "default":
      return { from: debtName(e.debtId), subject: "Loan in default", body: `Your ${debtName(e.debtId)} defaulted. 15% of each paycheck will be garnished.`, tone: "bad" };
    case "paid_off":
      return { from: e.name, subject: "Paid in full!", body: `${e.name} is paid off. Its payment now goes to your next debt.`, tone: "good" };
    case "score_change":
      if (Math.abs(e.to - e.from) < SCORE_MAIL_STEP) return null;
      return { from: "Credit bureau", subject: `Score ${e.to > e.from ? "up" : "down"} to ${e.to}`, body: `Your credit score moved from ${e.from} to ${e.to}.`, tone: e.to > e.from ? "good" : "bad" };
    case "cannot_cover":
      return { from: debtName(e.debtId), subject: "You can't cover this payment", body: `${usd(e.due)} is due and only ${usd(e.available)} is available. Open Money to decide what to do.`, tone: "bad", decision: true };
    case "bankruptcy_eligible":
      return { from: "Bankruptcy court", subject: "You may qualify for bankruptcy", body: `${e.reason} Open Money to decide.`, tone: "bad", decision: true };
    case "bear_market":
      return { from: "Larp Markets", subject: `Stocks are down ${Math.round(e.drop * 100)}%`, body: `Your ${usd(e.stocks)} in stocks is in a bear market. Open Money to decide whether to hold.`, tone: "bad", decision: true };
    case "market_recovered":
      return { from: "Larp Markets", subject: "Stocks are back at their high", body: `Your investing line is at ${usd(e.you)}; holding would be ${usd(e.held)}, autopilot ${usd(e.autopilot)}.`, tone: "good" };
    case "moved":
      return { from: "Your new landlord", subject: `Welcome to ${e.to}`, body: `Rent here is ${usd(e.rent)} a month and living costs are ${usd(e.living)}.`, tone: "info" };
    case "job":
      return e.employed
        ? { from: "HR", subject: "Welcome back", body: "Full paychecks resume on the next payday.", tone: "good" }
        : { from: "HR", subject: "You've been laid off", body: "Unemployment pays about 40% of your take-home until you're back at work.", tone: "bad" };
    default:
      return null;
  }
}

export class Inbox {
  items: MailItem[];
  private seq: number;

  constructor(saved?: InboxSave) {
    this.items = saved ? structuredClone(saved.items) : [];
    this.seq = saved?.seq ?? 0;
  }

  /** Files a letter for every event that sends one; returns the new letters. */
  add(events: LifeEvent[], debtName: (id: string) => string): MailItem[] {
    const added: MailItem[] = [];
    for (const e of events) {
      const l = mailFor(e, debtName);
      if (l) added.push({ ...l, id: `m${++this.seq}`, day: e.day, read: false });
    }
    if (!added.length) return added;
    this.items.unshift(...added.reverse());
    if (this.items.length > MAX_MAIL) this.items.length = MAX_MAIL;
    return added;
  }

  unread(): number {
    return this.items.reduce((n, m) => n + (m.read ? 0 : 1), 0);
  }

  markRead(id: string): void {
    const m = this.items.find((x) => x.id === id);
    if (m) m.read = true;
  }

  toSave(): InboxSave {
    return structuredClone({ items: this.items, seq: this.seq });
  }
}
