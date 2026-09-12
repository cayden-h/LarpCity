// Fast-forward to a goal: the same PlayerLife.onDay the city runs every game
// day, run headless until the goal is met, bankruptcy (the meeting's rule), or
// the age cap. The market comes from the seeded path, so the result depends
// only on the seed, the life, and the plan.

import type { LifeSnapshot, PlayerLife } from "../life/player.ts";
import { isMet, viewOf } from "./goals.ts";
import { episodesBetween, monthIndex } from "./market.ts";
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

  if (isMet(o.goal, viewOf(life))) stoppedBy = "goal";
  else {
    while (days < maxDays) {
      days++;
      date.setDate(date.getDate() + 1);
      const events = life.onDay(o.fromDay + days, new Date(date));
      for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
      const snap = life.history[life.history.length - 1];
      if (snap.netWorth < low.netWorth) low = snap;
      if (snap.netWorth > high.netWorth) high = snap;
      if (life.stopsSkip(events)) {
        stoppedBy = "bankruptcy";
        break;
      }
      if (isMet(o.goal, viewOf(life))) {
        stoppedBy = "goal";
        break;
      }
      if (life.age >= o.capAge) break;
    }
  }

  const crashes = life.market ? episodesBetween(life.market, monthIndex(life.market, o.startDate), monthIndex(life.market, date)).map((e) => e.name) : [];
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
    crashes,
    counts,
  };
}
