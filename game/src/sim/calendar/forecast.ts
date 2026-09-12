// The next decision day: a detached copy of the life runs ahead on the seeded
// market until something pauses the city for a decision (a crash, a payment
// the player can't cover, bankruptcy). The calendar shows only that it's
// coming, never what it is. About 3 ms per simulated year.

import type { PlayerLife } from "../life/player.ts";

/** Three years always reaches the preset AI Bubble Pop. */
export const FORECAST_DAYS = 1100;

export function nextDecisionDay(life: PlayerLife, dateOf: (day: number) => Date, horizon = FORECAST_DAYS): number | null {
  const run = life.detached();
  for (let d = life.today + 1; d <= life.today + horizon; d++) {
    if (run.needsDecision(run.onDay(d, dateOf(d)))) return d;
  }
  return null;
}
