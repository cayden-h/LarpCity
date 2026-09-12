// The money a future day is scheduled to move, from the same rules PlayerLife
// runs: paychecks on the 1st and 15th, rent on the 1st, living costs on the
// 15th, and each open debt on its due day of the month. Random events stay
// hidden until they happen (the meeting's rule), so this is all a future day
// shows, apart from the next decision day.

import { isOpen } from "../debt/index.ts";
import type { Debt } from "../debt/types.ts";
import { UNEMPLOYMENT_SHARE, type PlayerLife } from "../life/player.ts";
import { DEBT_CHIP, type Mark } from "./marks.ts";

const round2 = (x: number) => Math.round(x * 100) / 100;

export function scheduleFor(life: PlayerLife, date: Date): Mark[] {
  const dom = date.getDate();
  const out: Mark[] = [];
  if (dom === 1 || dom === 15) out.push({ tone: "red", chip: "Payday", text: life.employed ? "Paycheck" : "Unemployment check", amount: expectedPay(life) });
  if (dom === 1) out.push({ tone: "red", chip: "Rent", text: "Rent", amount: -life.rent });
  if (dom === 15) out.push({ tone: "red", chip: "Living", text: "Living costs", amount: -life.living });
  for (const d of life.book.debts) {
    if (isOpen(d) && d.dueDayOfMonth === dom) out.push({ tone: "red", chip: DEBT_CHIP[d.kind], text: `${d.name} payment`, amount: payment(d) });
  }
  return out;
}

/** The last paycheck's take-home, or half the monthly take-home before the first one lands. */
function expectedPay(life: PlayerLife): number {
  for (let i = life.log.length - 1; i >= 0; i--) {
    const e = life.log[i];
    if (e.type === "paycheck") return e.takeHome;
  }
  return round2((life.monthlyTakeHome / 2) * (life.employed ? 1 : UNEMPLOYMENT_SHARE));
}

/** What the debt asks for: the card's current minimum, or the loan's scheduled payment. */
function payment(d: Debt): number | undefined {
  const due = d.kind === "credit_card" ? d.minimumDue : d.scheduledPayment;
  return due ? -due : undefined;
}
