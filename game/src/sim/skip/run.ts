// Fast-forward to a goal: the same PlayerLife.onDay the city runs every game
// day, run headless until the goal is met, bankruptcy (the meeting's rule), or
// the age cap. The market comes from the life's seeded MarketPath, so the
// result depends only on the seed, the life, and the plan.

import type { LifeSnapshot, PlayerLife } from "../life/player.ts";
import { isMet, viewOf } from "./goals.ts";
import type { Goal, SkipResult, StopReason } from "./types.ts";

export interface SkipOptions {
  goal: Goal;
  /** Game day the fast-forward starts from (today). */
  fromDay: number;
  /** Calendar date of `fromDay`. */
  startDate: Date;
  /** Stop at this age if the goal isn't reached. */
  capAge: number;
  /** Hard limit so a goal that can never be met still ends. */
  maxYears?: number;
}

export function runSkip(life: PlayerLife, o: SkipOptions): SkipResult {
  const start = life.snapshot(o.fromDay);
  let low: LifeSnapshot = start;
  let high: LifeSnapshot = start;
  const counts: Record<string, number> = {};
  const date = new Date(o.startDate);
  const maxDays = Math.round((o.maxYears ?? 60) * 365.25);
  let stoppedBy: StopReason = "cap";
  let days = 0;

  if (isMet(o.goal, viewOf(life), life.age)) stoppedBy = "goal";
  else {
    while (days < maxDays) {
      days++;
      date.setDate(date.getDate() + 1);
      const events = life.onDay(o.fromDay + days, new Date(date));
      for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
      // A multi-year skip must never silently blow past a filing deadline
      // (see PlayerLife.autoFilePending): auto-file with the standard
      // deduction so penalties never accrue unseen by the player.
      const filed = life.autoFilePending(o.fromDay + days);
      if (filed) counts[filed.type] = (counts[filed.type] ?? 0) + 1;
      const snap = life.history[life.history.length - 1];
      if (snap.netWorth < low.netWorth) low = snap;
      if (snap.netWorth > high.netWorth) high = snap;
      if (life.stopsSkip(events)) {
        stoppedBy = "bankruptcy";
        break;
      }
      if (isMet(o.goal, viewOf(life), life.age)) {
        stoppedBy = "goal";
        break;
      }
      if (life.age >= o.capAge) break;
    }
  }

  // For the result card: bear markets the fast-forward lived through, and the total market's worst fall.
  let bearMarkets = 0;
  let worstDrop = 0;
  let prev = life.market.regime(o.fromDay);
  let peak = life.market.price("LTM", o.fromDay);
  for (let d = o.fromDay + 1; d <= o.fromDay + days; d++) {
    const regime = life.market.regime(d);
    if (regime === "bear" && prev !== "bear") bearMarkets++;
    prev = regime;
    const p = life.market.price("LTM", d);
    if (p > peak) peak = p;
    else worstDrop = Math.max(worstDrop, 1 - p / peak);
  }

  return {
    fromDay: o.fromDay,
    toDay: o.fromDay + days,
    daysRun: days,
    stoppedBy,
    start,
    end: life.snapshot(o.fromDay + days),
    low,
    high,
    ageAtEnd: life.age,
    bearMarkets,
    worstDrop,
    counts,
  };
}
