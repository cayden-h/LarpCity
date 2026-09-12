// The crash rule (research/10, "When the market crashes"). A plan that says
// "sell" sells half or all of its stocks the month the total market first
// closes 20% below its peak (the usual bear-market line), then buys back three
// months after the market is back at that peak, which is how panic selling
// locks in the loss and misses the rebound. The daily life and the monthly
// preview both check it on the 1st of each month through this one class, so
// they agree.

import type { CrashRule } from "./types.ts";

export const PANIC_DRAWDOWN = 0.2;
export const REENTRY_MONTHS = 3;

/** The crash rule's memory as plain JSON, for the saved game (sim/save). */
export interface CrashSave {
  peak: number;
  crashPeak: number | null;
  recoveredFor: number;
}

export class CrashWatch {
  /** Highest monthly stock price seen while invested. */
  peak = 0;
  /** While the plan is out of the market: the old peak it's waiting to see again. */
  crashPeak: number | null = null;
  /** Months since the price got back to `crashPeak`; -1 until it does. */
  private recoveredFor = -1;

  toSave(): CrashSave {
    return { peak: this.peak, crashPeak: this.crashPeak, recoveredFor: this.recoveredFor };
  }

  static fromSave(s: CrashSave): CrashWatch {
    const c = new CrashWatch();
    c.peak = s.peak;
    c.crashPeak = s.crashPeak;
    c.recoveredFor = s.recoveredFor;
    return c;
  }

  /** Share of the plan's stocks still held: 1, or 0.5 or 0 after a panic sale. */
  held(rule: CrashRule): number {
    if (this.crashPeak === null || rule === "hold") return 1;
    return rule === "sell_half" ? 0.5 : 0;
  }

  /** Looks at this month's stock price; says "sell" the month the rule sells and "buy" the month it buys back. */
  update(price: number, rule: CrashRule): "sell" | "buy" | null {
    if (this.crashPeak === null) {
      this.peak = Math.max(this.peak, price);
      if (rule !== "hold" && price <= this.peak * (1 - PANIC_DRAWDOWN)) {
        this.crashPeak = this.peak;
        this.recoveredFor = -1;
        return "sell";
      }
      return null;
    }
    if (this.recoveredFor >= 0) this.recoveredFor++;
    else if (price >= this.crashPeak) this.recoveredFor = 0;
    if (rule === "hold" || this.recoveredFor >= REENTRY_MONTHS) {
      this.crashPeak = null;
      this.peak = price;
      return "buy";
    }
    return null;
  }
}
