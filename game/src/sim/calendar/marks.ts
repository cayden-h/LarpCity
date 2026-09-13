// What a day on the phone calendar says: a short chip for the month grid and
// a line (with the amount) for the day's sheet. Red is money moving and things
// that happen to the player (paydays, bills, payments, the market); blue is
// what the player did (a trade, a move, a debt paid off). Noise the player
// didn't choose and wouldn't look for (interest, recurring buys, statements,
// score ticks) is left out.

import type { DebtKind } from "../debt/types.ts";
import { choiceLabel } from "../life/events.ts";
import type { LifeEvent, PlayerLife } from "../life/player.ts";

export type MarkTone = "red" | "blue";

export interface Mark {
  tone: MarkTone;
  /** One short word for the month grid (a cell fits about five letters); the sheet says the rest. */
  chip: string;
  /** The line on the day's sheet. */
  text: string;
  /** Signed dollars: money in is positive, money out negative. */
  amount?: number;
}

/** The chip for a debt's payment day, by kind. */
export const DEBT_CHIP: Record<DebtKind, string> = {
  credit_card: "Card",
  student_federal: "Loan",
  auto: "Car",
  mortgage: "Home",
  personal: "Loan",
  bnpl: "BNPL",
  payday: "Loan",
  medical: "Med",
};

const dollars = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** The chips and lines for one day's events, the player's own choices first. */
export function marksFor(events: readonly LifeEvent[], life: Pick<PlayerLife, "book">): Mark[] {
  const debt = (id: string) => life.book.debts.find((d) => d.id === id);
  const nameOf = (id: string) => debt(id)?.name ?? "a debt";
  const chipOf = (id: string) => {
    const d = debt(id);
    return d ? DEBT_CHIP[d.kind] : "Debt";
  };
  const out: Mark[] = [];
  // Several payments to one debt in a day (the minimum plus the plan's extra) read as one.
  const payments = new Map<string, Mark>();
  const red = (chip: string, text: string, amount?: number) => out.push({ tone: "red", chip, text, amount });
  const blue = (chip: string, text: string, amount?: number) => out.push({ tone: "blue", chip, text, amount });

  for (const e of events) {
    switch (e.type) {
      case "paycheck":
        red("Pay", `${e.unemployed ? "Unemployment check" : "Paycheck"}${e.garnished > 0 ? `, ${dollars(e.garnished)} garnished` : ""}`, e.takeHome);
        break;
      case "bill": {
        const short = e.amount - e.paid > 0.5;
        red(e.name === "Rent" ? "Rent" : "Bills", short ? `${e.name}, short by ${dollars(e.amount - e.paid)}` : e.name, -e.paid);
        break;
      }
      case "payment": {
        const seen = payments.get(e.debtId);
        if (seen) seen.amount = (seen.amount ?? 0) - e.amount;
        else {
          const m: Mark = { tone: "red", chip: chipOf(e.debtId), text: `${nameOf(e.debtId)} payment`, amount: -e.amount };
          payments.set(e.debtId, m);
          out.push(m);
        }
        break;
      }
      case "missed":
        red("Miss", `Missed the ${nameOf(e.debtId)} payment${e.fee > 0 ? ` (${dollars(e.fee)} late fee)` : ""}`, e.fee > 0 ? -e.fee : undefined);
        break;
      case "late_mark":
        red("Late", `${e.severity}-day late mark on ${nameOf(e.debtId)}: score ${e.scoreBefore} to ${e.scoreAfter}`);
        break;
      case "penalty_apr":
        red("APR", `Penalty APR on ${nameOf(e.debtId)}: ${(e.apr * 100).toFixed(1)}%`);
        break;
      case "cannot_cover":
        red("Short", `Couldn't cover the ${nameOf(e.debtId)} payment (${dollars(e.due)} due, ${dollars(e.available)} on hand)`);
        break;
      case "collections":
        red("Owed", `${nameOf(e.debtId)} went to collections`);
        break;
      case "repossessed":
        red("Repo", `${nameOf(e.debtId)}: the car was repossessed`);
        break;
      case "default":
        red("Late", `${nameOf(e.debtId)} went into default`);
        break;
      case "bankruptcy_eligible":
        red("Broke", "Bankruptcy is on the table");
        break;
      case "bear_market":
        red("Crash", `Stocks fell ${Math.round(e.drop * 100)}% from their high`);
        break;
      case "market_recovered":
        red("Rally", "Stocks are back at their high");
        break;
      case "job":
        red("Job", e.employed ? "Back at work" : "Lost your job");
        break;
      case "paid_off":
        blue("Paid", `Paid off ${e.name}`);
        break;
      case "moved":
        blue("Move", `Moved to ${e.to}`);
        break;
      case "trade":
        if (!e.recurring) blue(e.side === "buy" ? "Buy" : "Sell", `${e.side === "buy" ? "Bought" : "Sold"} ${e.id}`, e.side === "buy" ? -e.amount : e.amount);
        break;
      case "marriage":
        blue("Wed", "Got married");
        break;
      case "choice":
        if (!e.auto) blue("Chose", choiceLabel(e.kind, e.option, e.amount));
        break;
      case "car_breakdown":
        red("Car", `Your car broke down: ${dollars(e.repairCost)} to fix`);
        break;
      case "injury":
        red("Hurt", `${e.cause === "car_crash" ? "Car crash" : "Injured"}: ${dollars(e.outOfPocket)} of a ${dollars(e.bill)} bill is yours`);
        break;
      case "divorce":
        red("Split", e.prenup ? "Divorced; the prenup kept your money" : `Divorced without a prenup: lost ${dollars(e.lost)}`);
        break;
      case "penny_stock_tip":
        red("Tip", `A hot tip on ${e.ticker}`);
        break;
      case "penny_stock_result":
        red(e.payout >= e.stake ? "Win" : "Bust", `${e.ticker} paid back ${dollars(e.payout)} of ${dollars(e.stake)}`, e.payout);
        break;
      case "recession":
        red("Slump", "The economy is in a recession");
        break;
      case "recession_over":
        red("Boom", "The recession is over");
        break;
      default:
        break;
    }
  }
  return [...out.filter((m) => m.tone === "blue"), ...out.filter((m) => m.tone === "red")];
}
