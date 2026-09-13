// The money a future day is scheduled to move, from the same rules PlayerLife
// and the debt engine run: paychecks on the 1st and 15th, rent on the 1st,
// living costs on the 15th, each loan on its due day of the month, and each
// card GRACE_DAYS after its statement closes. Random events stay hidden until
// they happen (the meeting's rule), so this is all a future day shows, apart
// from the next decision day.

import { GRACE_DAYS, isOpen } from "../debt/index.ts";
import type { Debt } from "../debt/types.ts";
import { UNEMPLOYMENT_SHARE, type PlayerLife } from "../life/player.ts";
import { DEBT_CHIP, type Mark } from "./marks.ts";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** What game day `day` (calendar date `date`) is scheduled to move. */
export function scheduleFor(life: PlayerLife, day: number, date: Date): Mark[] {
  const dom = date.getDate();
  const out: Mark[] = [];
  if (dom === 1 || dom === 15) out.push({ tone: "red", chip: "Pay", text: life.employed ? "Paycheck" : "Unemployment check", amount: expectedPay(life) });
  if (dom === 1) {
    if (life.rent > 0) out.push({ tone: "red", chip: "Rent", text: "Rent", amount: -life.rent });
    const bills = life.housingBills();
    if (bills.taxAndInsurance > 0) out.push({ tone: "red", chip: "Tax", text: "Property tax and insurance", amount: -bills.taxAndInsurance });
    if (bills.pmi > 0) out.push({ tone: "red", chip: "PMI", text: "Mortgage insurance (PMI)", amount: -bills.pmi });
  }
  if (dom === 15) out.push({ tone: "red", chip: "Bills", text: "Living costs", amount: -life.living });
  for (const d of life.book.debts) {
    if (!isOpen(d) || !dueOn(d, day, date)) continue;
    if (d.kind !== "credit_card") out.push({ tone: "red", chip: DEBT_CHIP[d.kind], text: `${d.name} payment`, amount: d.scheduledPayment ? -d.scheduledPayment : undefined });
    // The current statement's minimum is known; later statements aren't written yet.
    else if (day === d.statementDueDay && d.minimumDue) out.push({ tone: "red", chip: DEBT_CHIP[d.kind], text: `${d.name} minimum due`, amount: -d.minimumDue });
    else out.push({ tone: "red", chip: DEBT_CHIP[d.kind], text: `${d.name} payment due` });
  }
  return out;
}

/** Whether a debt's payment falls due on this day, as the debt engine decides it. */
function dueOn(d: Debt, day: number, date: Date): boolean {
  if (d.kind !== "credit_card") return date.getDate() === d.dueDayOfMonth;
  if (day === d.statementDueDay) return true;
  if (d.statementDueDay !== undefined && day <= d.statementDueDay) return false;
  // Later statements close on the card's day of the month and fall due GRACE_DAYS after.
  const closed = new Date(date);
  closed.setDate(closed.getDate() - GRACE_DAYS);
  return closed.getDate() === d.dueDayOfMonth;
}

/** The last paycheck's take-home, or half the monthly take-home before the first one lands. */
function expectedPay(life: PlayerLife): number {
  for (let i = life.log.length - 1; i >= 0; i--) {
    const e = life.log[i];
    if (e.type === "paycheck") return e.takeHome;
  }
  return round2((life.monthlyTakeHome / 2) * (life.employed ? 1 : UNEMPLOYMENT_SHARE));
}
