// Bottom-left, always-visible happiness meter: a pixel heart that fills to the player's live
// wellbeing score, refreshed once per game day from `clock.onDay` (see main.ts). Clicking it
// opens a breakdown of what is behind the score: the parts of life costing points, the ones
// going well, and the recent life events still moving it.

import type { PlayerLife } from "../sim/life/index.ts";
import { wellbeing, type FactorBreakdown, type FactorName, type PulseBreakdown, type WellbeingSnapshot } from "../sim/wellbeing/index.ts";
import { pixelArt } from "./pixel-art.ts";

export type HappinessExpression = "happy" | "neutral" | "sad";

/** `wellbeing()`'s `W` is a continuous 0-100 score (never 0-1); these bands pick the heart's look and the headline. */
export function expressionFor(score: number): HappinessExpression {
  if (score >= 66) return "happy";
  if (score >= 33) return "neutral";
  return "sad";
}

const HEADLINE: Record<HappinessExpression, string> = { happy: "Doing well", neutral: "Getting by", sad: "Struggling" };

const FACTOR_LABEL: Record<FactorName, string> = {
  work: "Work",
  cashCushion: "Cash cushion",
  debtLoad: "Debt",
  realIncome: "Income",
  relationships: "Relationships",
  retirementOnTrack: "Retirement savings",
  healthCoverage: "Health coverage",
  commute: "Commute",
  homeStability: "Home",
};

const PULSE_LABEL: Record<string, string> = {
  marriage: "Got married",
  firstChild: "First child",
  divorce: "Divorce",
  layoff: "Laid off",
  bankruptcy: "Filed for bankruptcy",
  retiredOnTrack: "Retired on track",
  forcedRetirement: "Forced to retire",
  vacation: "Vacation",
  familyTime: "Family time",
  injury: "Injury",
  carBreakdown: "Car broke down",
  recession: "Recession",
};

/** A factor within half a point of its full weight counts as going well. */
const SMALL = 0.5;

export interface HappinessExplanation {
  /** Factors costing points, the costliest first. */
  drags: FactorBreakdown[];
  /** Factors at (or within half a point of) their full weight, the heaviest first. */
  good: FactorBreakdown[];
  /** Life events still moving the score by a visible amount, the biggest first. */
  events: PulseBreakdown[];
}

export function explain(snapshot: WellbeingSnapshot): HappinessExplanation {
  const lost = (factor: FactorBreakdown) => factor.weight - factor.points;
  return {
    drags: snapshot.factors.filter((factor) => lost(factor) >= SMALL).sort((a, b) => lost(b) - lost(a)),
    good: snapshot.factors.filter((factor) => lost(factor) < SMALL).sort((a, b) => b.weight - a.weight),
    events: snapshot.pulses.filter((pulse) => Math.abs(pulse.points) >= 0.05).sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
  };
}

// 15 × 13. R is the fill, D its shade, W its shine; `heart` swaps them for the empty colors above the fill line.
const HEART = [
  "..kkk.....kkk..",
  ".kRRRk...kRRRk.",
  "kRWWRRk.kRRRRRk",
  "kRWRRRRkRRRRRRk",
  "kRRRRRRRRRRRRDk",
  "kRRRRRRRRRRRRDk",
  ".kRRRRRRRRRRDk.",
  "..kRRRRRRRRDk..",
  "...kRRRRRRDk...",
  "....kRRRRDk....",
  ".....kRRDk.....",
  "......kDk......",
  ".......k.......",
];
/** Cells of the crack drawn over a sad heart. */
const CRACK: readonly (readonly [number, number])[] = [[7, 3], [7, 4], [6, 5], [7, 6], [8, 7], [7, 8], [6, 9], [7, 10]];

const HEART_PALETTE: Record<HappinessExpression, Record<string, string>> = {
  happy: { R: "#f04b50", D: "#b3283a", W: "#ffc2bc" },
  neutral: { R: "#f07a4b", D: "#b64c2c", W: "#ffd0b3" },
  sad: { R: "#8d7cc9", D: "#5e4f96", W: "#cdc3f0" },
};

/** The heart filled from the bottom to `score` percent of its inside, in the band's colors. */
export function heart(score: number, className = ""): string {
  const expression = expressionFor(score);
  const inside = HEART.length - 2; // rows 1-11 hold fill
  const filledRows = Math.round((Math.max(0, Math.min(100, score)) / 100) * inside);
  const rows = HEART.map((row, y) => {
    const empty = y >= 1 && y <= inside && y <= inside - filledRows;
    return empty ? row.replace(/[RDW]/g, (c) => (c === "D" ? "d" : "e")) : row;
  });
  if (expression === "sad") {
    for (const [x, y] of CRACK) rows[y] = rows[y].slice(0, x) + "k" + rows[y].slice(x + 1);
  }
  return pixelArt(rows, { k: "#101a23", e: "#2b3d52", d: "#1d2b3b", ...HEART_PALETTE[expression] }, className);
}

export interface HappinessMeter {
  update(today: number): void;
  destroy(): void;
}

export function mountHappinessMeter(host: HTMLElement, deps: { life: PlayerLife }): HappinessMeter {
  host.innerHTML = `
    <button type="button" class="card happiness" data-toggle aria-expanded="false" aria-controls="happiness-panel">
      <span class="happiness-heart" data-heart></span>
      <span class="happiness-score" data-score></span>
    </button>
    <section class="happiness-panel" id="happiness-panel" role="dialog" aria-labelledby="happiness-panel-title" hidden>
      <header class="hpn-head">
        <span class="hpn-heart" data-panel-heart></span>
        <div class="hpn-heading">
          <div class="hpn-eyebrow">Happiness</div>
          <h2 class="hpn-title" id="happiness-panel-title" data-title></h2>
        </div>
        <button type="button" class="hpn-close" data-close aria-label="Close">&times;</button>
      </header>
      <div class="hpn-body" data-body></div>
    </section>`;
  const toggle = host.querySelector<HTMLButtonElement>("[data-toggle]")!;
  const panel = host.querySelector<HTMLElement>(".happiness-panel")!;
  let snapshot = wellbeing(deps.life, deps.life.today);
  let today = deps.life.today;

  function renderMeter(): void {
    const score = Math.round(snapshot.W);
    host.querySelector("[data-heart]")!.innerHTML = heart(snapshot.W);
    host.querySelector("[data-score]")!.textContent = String(score);
    toggle.dataset.expression = expressionFor(snapshot.W);
    toggle.setAttribute("aria-label", `Happiness ${score} out of 100. Show what's behind it.`);
  }

  function renderPanel(): void {
    const { drags, good, events } = explain(snapshot);
    host.querySelector("[data-panel-heart]")!.innerHTML = heart(snapshot.W);
    host.querySelector("[data-title]")!.innerHTML = `<b>${Math.round(snapshot.W)}</b><span>/100</span> ${HEADLINE[expressionFor(snapshot.W)]}`;
    const sections = [
      drags.length ? section("Costing you points", `<ul class="hpn-list">${drags.map(factorRow).join("")}</ul>`) : "",
      events.length ? section("Recent events", `<ul class="hpn-list">${events.map((e) => eventRow(e, today)).join("")}</ul>`) : "",
      good.length ? section("Going well", `<ul class="hpn-good">${good.map((f) => `<li title="${escape(f.note)}">${FACTOR_LABEL[f.name]}</li>`).join("")}</ul>`) : "",
    ];
    host.querySelector("[data-body]")!.innerHTML = sections.join("");
  }

  function setOpen(open: boolean): void {
    if (open) renderPanel();
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  host.querySelector("[data-close]")!.addEventListener("click", () => {
    setOpen(false);
    toggle.focus();
  });
  const onPointerDown = (ev: PointerEvent) => {
    if (!panel.hidden && !host.contains(ev.target as Node)) setOpen(false);
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || panel.hidden) return;
    setOpen(false);
    toggle.focus();
  };
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);

  function update(day: number): void {
    today = day;
    snapshot = wellbeing(deps.life, day);
    renderMeter();
    if (!panel.hidden) renderPanel();
  }

  renderMeter();

  return {
    update,
    destroy() {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      host.innerHTML = "";
    },
  };
}

function section(title: string, body: string): string {
  return `<section class="hpn-section"><h3>${title}</h3>${body}</section>`;
}

/** Ten pixel blocks, lit for the share of the factor's full weight the player has. */
function blocks(share: number): string {
  const lit = Math.round(Math.max(0, Math.min(1, share)) * 10);
  return `<span class="hpn-blocks" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i${i < lit ? ' class="on"' : ""}></i>`).join("")}</span>`;
}

function factorRow(factor: FactorBreakdown): string {
  return `
    <li class="hpn-row">
      <div class="hpn-row-top"><span class="hpn-name">${FACTOR_LABEL[factor.name]}</span><span class="hpn-pts down">-${points(factor.weight - factor.points)}</span></div>
      ${blocks(factor.s)}
      <div class="hpn-note">${escape(factor.note)}</div>
    </li>`;
}

function eventRow(event: PulseBreakdown, today: number): string {
  const label = (event.name && PULSE_LABEL[event.name]) || "Life event";
  const days = today - event.startDay;
  const when = days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 60 ? `${days} days ago` : days < 730 ? `${Math.round(days / 30.4)} months ago` : `${Math.round(days / 365.25)} years ago`;
  const up = event.points > 0;
  return `
    <li class="hpn-row">
      <div class="hpn-row-top"><span class="hpn-name">${label}</span><span class="hpn-pts ${up ? "up" : "down"}">${up ? "+" : "-"}${points(Math.abs(event.points))}</span></div>
      <div class="hpn-note">${when}, fading</div>
    </li>`;
}

const points = (value: number) => value.toFixed(1);

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
