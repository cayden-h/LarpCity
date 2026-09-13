// The end-of-run screen: opened from the Goals app's Retire button once the
// player is ready (retirementReady below). Retiring before 65 passes: "You
// passed! You don't have to larp anymore." The screen shows the final score,
// the life's numbers and goals, and what comes next: looking back through the
// life (the end-of-game review, sim/rewind/gate.ts), playing the same demo life
// again for the next judge, or starting a new life. Styles are in endgame.css,
// imported by the phone so this module stays loadable in node tests.

import { finalScore, type WellbeingLife } from "../sim/wellbeing/index.ts";
import { retirementReadiness, type RetirementLife } from "../sim/wellbeing/retirement.ts";
import { isMet } from "../sim/skip/goals.ts";
import type { Goal, GoalView } from "../sim/skip/types.ts";

/** Retiring before this age passes (README, "Retirement is the end goal"). */
export const PASS_AGE = 65;

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
  netWorth: number;
  retirementSavings: number;
  creditScore: number;
  debt: number;
}

export function buildEndgameScore(life: WellbeingLife & RetirementLife, retiredAge: number, today: number): EndgameScore {
  const { final, RR, Wlife } = finalScore(life, today);
  return {
    final,
    RR,
    Wlife,
    passed: retiredAge < PASS_AGE,
    retiredAge,
    netWorth: Math.round(life.netWorth()),
    retirementSavings: Math.round(life.retirementSavings()),
    creditScore: Math.round(life.book.profile.score),
    debt: Math.round(life.totalDebt()),
  };
}

export interface EndgameDeps {
  score: EndgameScore;
  /** The life's goals, each with whether it was met, in the Goals app's words. */
  goals?: { title: string; met: boolean }[];
  /** Opens the review: the Calendar, now able to go back to any day. */
  onLookBack: () => void;
  /** Loads this slot's demo life again from the start, for the next judge; only for a demo life. */
  replay?: { title: string; play: () => void } | null;
  /** Erases this life and starts over; rejects when the server can't be reached. */
  onNewLife: () => Promise<void>;
  onClose?: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

const CONFETTI = ["#ffdb39", "#26a857", "#158ced", "#ff6b4a", "#b06bff", "#fff7dd"];

/** Square pixel flakes with seeded-looking but fixed positions, so every judge sees the same fall. */
function confetti(): string {
  let html = "";
  for (let i = 0; i < 36; i++) {
    const left = (i * 37) % 100;
    const delay = ((i * 53) % 40) / 10;
    const duration = 3.2 + ((i * 29) % 25) / 10;
    const drift = ((i * 17) % 60) - 30;
    const spin = i % 2 ? 360 : -360;
    html += `<i style="left:${left}%;background:${CONFETTI[i % CONFETTI.length]};animation-delay:${delay}s;animation-duration:${duration}s;--drift:${drift}px;--spin:${spin}deg"></i>`;
  }
  return html;
}

/** Mounts the full-screen end-of-run overlay onto `host` (pass `document.body`); a second call while one is up does nothing. */
export function mountEndgame(host: HTMLElement, deps: EndgameDeps): void {
  if (host.querySelector(".endgame-overlay")) return;
  const { score, goals = [], replay } = deps;
  const overlay = document.createElement("div");
  overlay.className = "endgame-overlay";
  const headline = score.passed ? "You passed!" : "You made it to retirement";
  const sub = score.passed
    ? "You don't have to larp anymore."
    : `Retiring at ${PASS_AGE} or later doesn't pass. Retire younger next time.`;
  const stat = (label: string, value: string) => `<div class="endgame-stat"><dt>${label}</dt><dd>${value}</dd></div>`;
  overlay.innerHTML = `${score.passed ? `<div class="endgame-confetti" aria-hidden="true">${confetti()}</div>` : ""}
  <div class="endgame-window" role="dialog" aria-modal="true" aria-labelledby="endgame-headline">
    <div class="endgame-bar">
      <span class="endgame-title">Retirement</span>
      <button class="endgame-close" data-close aria-label="Close">✕</button>
    </div>
    <div class="endgame-body">
      <p class="endgame-kicker">Retired at ${score.retiredAge}</p>
      <h2 class="endgame-headline ${score.passed ? "pass" : "fail"}" id="endgame-headline">${headline}</h2>
      <p class="endgame-sub">${sub}</p>
      <div class="endgame-final"><span>Final score</span><b>${score.final}</b><small>/ 100</small></div>
      <dl class="endgame-scores">
        ${stat("Money readiness", `${score.RR}`)}
        ${stat("Lifetime happiness", `${score.Wlife}`)}
        ${stat("Net worth", money(score.netWorth))}
        ${stat("Retirement savings", money(score.retirementSavings))}
        ${stat("Credit score", `${score.creditScore}`)}
        ${stat("Debt", money(score.debt))}
      </dl>
      ${goals.length ? `<ul class="endgame-goals" aria-label="Goals">${goals.map((g) => `<li class="${g.met ? "met" : ""}">${esc(g.title)}${g.met ? "" : " (not reached)"}</li>`).join("")}</ul>` : ""}
      <p class="endgame-review">Your review is open: in the Calendar, tap any past day to go back and try a different choice.</p>
      <div class="endgame-actions">
        <button class="endgame-btn primary" data-look-back>Look back at your life</button>
        ${replay ? `<button class="endgame-btn" data-replay>Play "${esc(replay.title)}" again</button>` : ""}
        <button class="endgame-btn" data-new-life>Start a new life</button>
      </div>
      <p class="endgame-note" data-note hidden></p>
    </div>
  </div>`;
  const note = overlay.querySelector<HTMLElement>("[data-note]")!;
  const newLife = overlay.querySelector<HTMLButtonElement>("[data-new-life]")!;
  /** Erasing the life asks twice, like the Calendar's "Start a new life". */
  let armed = false;

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    deps.onClose?.();
  };
  overlay.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    if (target === overlay || target.closest("[data-close]")) return close();
    if (target.closest("[data-look-back]")) {
      close();
      return deps.onLookBack();
    }
    if (target.closest("[data-replay]")) return replay?.play();
    if (target.closest("[data-new-life]")) {
      if (!armed) {
        armed = true;
        newLife.classList.add("armed");
        newLife.textContent = "Tap again to erase this life";
        return;
      }
      newLife.disabled = true;
      deps.onNewLife().catch(() => {
        newLife.disabled = false;
        note.hidden = false;
        note.textContent = "Can't reach the server, so this life can't be erased right now.";
      });
    }
  });
  document.addEventListener("keydown", onKey);
  host.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>("[data-look-back]")!.focus();
}
