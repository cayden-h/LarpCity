// The end-of-run score screen: opened from the Goals app's Retire button once
// retirementReadiness (sim/wellbeing/retirement.ts) reaches its max. Retiring is
// a one-way action (the run is over), so unlike the Money desk this overlay has
// no "resume" path — only a close/dismiss.

import { finalScore, type WellbeingLife } from "../sim/wellbeing/index.ts";
import { retirementReadiness, type RetirementLife } from "../sim/wellbeing/retirement.ts";
import { isMet } from "../sim/skip/goals.ts";
import type { Goal, GoalView } from "../sim/skip/types.ts";

/**
 * `retirementReadiness` is built (research/09 3.4) to top out at exactly 100
 * (its four terms — savings 50, credit 20, net worth 15, debt 15 — each clamp
 * to their share and sum to 100 at best), but the credit term alone needs an
 * exact 850 score to max out, which makes >= 100 practically unreachable in
 * real play. The Retire button instead enables at two independently
 * sufficient conditions: "fully prepared" lowered to 85 (still demanding on
 * every term without requiring a perfect credit score), OR the player's own
 * retirement_age goal (set at intake) being met.
 */
export function retirementReady(life: RetirementLife, goals: Goal[], view: GoalView, age: number): boolean {
  if (retirementReadiness(life) >= 85) return true;
  const retirementGoal = goals.find((g): g is Extract<Goal, { kind: "retirement_age" }> => g.kind === "retirement_age");
  return retirementGoal ? isMet(retirementGoal, view, age) : false;
}

export interface EndgameScore {
  final: number;
  RR: number;
  Wlife: number;
  passed: boolean;
  retiredAge: number;
}

export function buildEndgameScore(life: WellbeingLife, retiredAge: number, today: number): EndgameScore {
  const { final, RR, Wlife } = finalScore(life, today);
  return { final, RR, Wlife, passed: retiredAge < 65, retiredAge };
}

/** Mounts the full-screen end-of-run overlay onto `host` (pass `document.body`). */
export function mountEndgame(host: HTMLElement, deps: { score: EndgameScore; onClose?: () => void }): void {
  const { score, onClose } = deps;
  const overlay = document.createElement("div");
  overlay.className = "endgame-overlay";
  const headline = score.passed
    ? `You retired at ${score.retiredAge}. Nicely done!`
    : `You retired at ${score.retiredAge}, a little late.`;
  overlay.innerHTML = `<div class="endgame-window" role="dialog" aria-modal="true" aria-label="Retirement results">
    <div class="endgame-bar">
      <span class="endgame-title">Retirement</span>
      <button class="endgame-close" data-close aria-label="Close">✕</button>
    </div>
    <div class="endgame-body">
      <h2 class="endgame-headline ${score.passed ? "pass" : "fail"}">${headline}</h2>
      <dl class="endgame-scores">
        <div class="endgame-score-row"><dt>Money readiness</dt><dd>${score.RR}</dd></div>
        <div class="endgame-score-row"><dt>Lifetime happiness</dt><dd>${score.Wlife}</dd></div>
        <div class="endgame-score-row endgame-final"><dt>Final score</dt><dd>${score.final}</dd></div>
      </dl>
      <p class="endgame-review">Your review is open: in the Calendar, tap any past day to go back and try a different choice.</p>
    </div>
  </div>`;
  const close = () => {
    overlay.remove();
    onClose?.();
  };
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay || (ev.target as HTMLElement).closest("[data-close]")) close();
  });
  host.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>("[data-close]")!.focus();
}
