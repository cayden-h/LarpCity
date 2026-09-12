// The named NPCs' money lives (option B): each roster entry in data/npcs.ts
// becomes a PlayerLife with its own paycheck, accounts, and debts, living in
// the player's city on the same seeded market. The town ticks them with the
// city clock and catches them up after a goal fast-forward, which runs only
// the player (a decade takes a few milliseconds per life).

import { BACKGROUND_NPCS } from "../../data/background-npcs.ts";
import { NPCS, type NpcProfile } from "../../data/npcs.ts";
import { creditCard, installment, newBook, studentLoan } from "../debt/factory.ts";
import type { Debt } from "../debt/types.ts";
import { defaultAccounts, PlayerLife, TAKE_HOME_SHARE, type Place } from "../life/player.ts";
import type { MarketPath } from "../market/index.ts";
import { applyDailyHabit } from "./habits.ts";

export function npcLife(p: NpcProfile, o: { place: Place; day: number; market: MarketPath }): PlayerLife {
  const agi = Math.round((p.monthlyTakeHome * 12) / TAKE_HOME_SHARE);
  const opened = o.day - 365 * 3;
  const debts: Debt[] = p.debts.map((d, i) => {
    const id = `${d.kind}-${i}`;
    switch (d.kind) {
      case "card":
        return creditCard({ id, name: d.name, balance: d.balance, limit: d.limit ?? d.balance * 2, apr: d.apr ?? 0.2396, day: o.day, openedDay: opened });
      case "student":
        return studentLoan({ id, name: d.name, balance: d.balance, apr: d.apr, plan: "standard", agi, payment: d.payment, day: o.day, openedDay: opened });
      default:
        return installment({ id, kind: d.kind, name: d.name, balance: d.balance, apr: d.apr ?? 0.08, months: d.months ?? 60, payment: d.payment, day: o.day, openedDay: opened });
    }
  });
  const book = newBook({ debts, agi, monthlyTakeHome: p.monthlyTakeHome, strategy: p.strategy, extraMonthly: p.extraMonthly, day: o.day, historyYears: Math.max(1, p.age - 19) });
  const cash = p.accounts as Record<string, number>;
  const accounts = defaultAccounts(o.day).map((a) => ({ ...a, balance: cash[a.id] ?? 0 }));
  return new PlayerLife({ place: o.place, day: o.day, age: p.age, monthlyTakeHome: p.monthlyTakeHome, grossAnnual: agi, book, accounts, market: o.market });
}

export class NpcTown {
  /** Lives by roster id, in roster order. */
  readonly lives = new Map<string, PlayerLife>();
  readonly profiles = new Map<string, NpcProfile>();
  private readonly start: Date;

  constructor(o: { place: Place; day: number; market: MarketPath; start: Date; roster?: NpcProfile[] }) {
    this.start = o.start;
    for (const p of o.roster ?? [...NPCS, ...BACKGROUND_NPCS]) {
      this.profiles.set(p.id, p);
      this.lives.set(p.id, npcLife(p, o));
    }
  }

  /** One live game day for every NPC (catching up first if a fast-forward left them behind). */
  onDay(day: number): void {
    for (const [id, life] of this.lives) {
      this.catchUpLife(id, life, day - 1);
      life.onDay(day, this.dateOf(day));
      applyDailyHabit(life, id, day, this.dateOf(day));
    }
  }

  /** Runs every NPC headless up to `toDay`, after a goal fast-forward jumped the calendar. */
  catchUp(toDay: number): void {
    for (const [id, life] of this.lives) this.catchUpLife(id, life, toDay);
  }

  dateOf(day: number): Date {
    const d = new Date(this.start);
    d.setDate(d.getDate() + day);
    return d;
  }

  private catchUpLife(id: string, life: PlayerLife, toDay: number): void {
    // runHeadless stops early at a bankruptcy notice; keep going, the NPC's story continues.
    while (life.today < toDay) {
      const from = life.today;
      const r = life.runHeadless(from, toDay - from, this.dateOf(from));
      if (r.daysRun === 0) break;
      for (let d = from + 1; d <= from + r.daysRun; d++) applyDailyHabit(life, id, d, this.dateOf(d));
    }
  }
}
