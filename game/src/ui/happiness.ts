// Bottom-left, always-visible happiness meter: a small pixel-art face whose
// expression reflects the player's live wellbeing score, refreshed once per
// game day from `clock.onDay` (see main.ts).

import { pixelIcon } from "./pixel-icons.ts";
import type { PlayerLife } from "../sim/life/index.ts";
import { wellbeing } from "../sim/wellbeing/index.ts";

export type HappinessExpression = "happy" | "neutral" | "sad";

/** `wellbeing()`'s `W` is a continuous 0-100 score (never 0-1); these bands pick one of 3 faces. */
export function expressionFor(score: number): HappinessExpression {
  if (score >= 66) return "happy";
  if (score >= 33) return "neutral";
  return "sad";
}

const ICON_FOR: Record<HappinessExpression, string> = {
  happy: "face-happy",
  neutral: "face-neutral",
  sad: "face-sad",
};

export interface HappinessMeter {
  update(today: number): void;
  destroy(): void;
}

export function mountHappinessMeter(host: HTMLElement, deps: { life: PlayerLife }): HappinessMeter {
  host.innerHTML = `
    <section class="card happiness">
      <div class="happiness-face" data-face></div>
    </section>`;
  const face = host.querySelector<HTMLElement>("[data-face]")!;

  function update(today: number): void {
    const snapshot = wellbeing(deps.life, today);
    const expression = expressionFor(snapshot.W);
    face.innerHTML = pixelIcon(ICON_FOR[expression]);
    face.setAttribute("data-expression", expression);
    host.querySelector(".happiness")?.setAttribute("title", `Wellbeing: ${snapshot.W.toFixed(1)}`);
  }

  update(deps.life.today);

  return {
    update,
    destroy() {
      host.innerHTML = "";
    },
  };
}
