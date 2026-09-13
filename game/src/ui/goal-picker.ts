// Pure helper for the onboarding goal-selection screen (ui/intake.ts): turns
// the screen's slider values into the 4 permanent goals, one per required
// category (sim/skip/types.ts's Goal union). No DOM here, so this is testable
// without a browser; intake.ts owns the markup and the events.

import type { Goal } from "../sim/skip/types.ts";

export interface GoalPicks {
  /** "Retire by age" slider, 50-70. */
  retireAge: number;
  /** "Debt-free by age" slider, 25-70. */
  debtFreeAge: number;
  /** "House down payment" slider, as a fraction (0.05-0.30), not a percent. */
  downPct: number;
}

/**
 * The 4 required goals from the screen's picks. Marriage has no configurable
 * target (the Goal union's `marriage` kind takes none) and is always included:
 * the yes/no toggle next to it is flavor copy, not a real choice.
 */
export function buildGoals(picks: GoalPicks): Goal[] {
  return [
    { kind: "retirement_age", targetAge: picks.retireAge },
    { kind: "marriage" },
    { kind: "debt_free_by_age", targetAge: picks.debtFreeAge },
    { kind: "house", downPct: picks.downPct },
  ];
}
