// Sammy's setup for a new life (meeting 2026-09-13), after the title screen
// and the save slot picker. The money is never asked: the game generates the
// job, salary, debt, and savings (sim/life/intake.ts's starterFor) and Sammy
// presents them. The player picks a name and avatar, a health plan and a
// starter card, then Sammy walks through the four permanent goals one at a
// time, each with the age to reach it by, and a last look before moving in.
// ?intake=0 skips it (for tests), with the default goals.

import { CAR_LOAN_BALANCE, DEFAULT_INSURANCE_PLAN_ID, INSURANCE_PLANS, type Starter } from "../sim/life/intake";
import { DEFAULT_CAR_INSURANCE_MONTHLY, DEFAULT_CAR_LOAN } from "../sim/life/player";
import type { Goal } from "../sim/skip/types";
import { BEGINNER_CARDS } from "../data/cards-beginner";
import { cardArt } from "../debt-demo/shop.ts";
import { buildGoals } from "./goal-picker";
import { AVATAR_EMOJI } from "./hud";
import { NARRATOR_NAME } from "../narration/lines";
import { Owl, preloadOwl } from "./owl";
import "./intake.css";

/** The owl's standing height on each step. */
const OWL_SIZE = 130;
/** Every new life starts here (meeting 2026-09-13). */
const START_AGE = 22;

export interface SetupOptions {
  /** The starting city's daytime plate, blurred behind the card. */
  backdrop: string;
  /** The generated money life Sammy presents. */
  starter: Starter;
  /** Where the life is, for Sammy's lines ("San Francisco"). */
  placeName: string;
}

export interface SetupResult {
  name: string;
  avatar: "male" | "female";
  insurancePlanId: string;
  selectedCardId: string;
  /** The four permanent goals, one per required kind. */
  goals: Goal[];
}

/** Runs Sammy's setup and resolves with the player's picks. */
export function runSetup(o: SetupOptions): Promise<SetupResult> {
  preloadOwl(["wave", "idle", "think", "cheer", "read", "tip-hat"]);
  return new Promise((resolve) => new Setup(o, resolve));
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type StepId = "who" | "life" | "plan" | "card" | "retire" | "debt" | "house" | "marry" | "review";
const STEPS: readonly StepId[] = ["who", "life", "plan", "card", "retire", "debt", "house", "marry", "review"];
/** What Sammy does as each step opens. */
const ANIM: Record<StepId, "wave" | "idle" | "think" | "cheer" | "read"> = {
  who: "wave",
  life: "read",
  plan: "think",
  card: "idle",
  retire: "think",
  debt: "read",
  house: "idle",
  marry: "cheer",
  review: "cheer",
};

class Setup {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly owl = new Owl(OWL_SIZE);
  private readonly o: SetupOptions;
  private readonly resolve: (r: SetupResult) => void;
  private at = 0;
  private leaving = false;
  private name = "";
  private avatar: "male" | "female" = "male";
  private planId = DEFAULT_INSURANCE_PLAN_ID;
  private cardId = BEGINNER_CARDS[0].slug;
  private retireAge = 65;
  private debtFreeAge = 30;
  private houseAge = 35;
  private downPct = 10;
  private marry = true;
  private marryAge = 30;

  constructor(o: SetupOptions, resolve: (r: SetupResult) => void) {
    this.o = o;
    this.resolve = resolve;
    this.el = document.createElement("div");
    this.el.className = "in-overlay";
    this.el.style.setProperty("--backdrop", `url("${o.backdrop}")`);
    this.el.innerHTML = `
      <section class="in-card" role="dialog" aria-modal="true" aria-labelledby="in-title">
        <h1 class="in-ribbon" id="in-title">Welcome to Larp City!</h1>
        <div class="in-body"></div>
      </section>`;
    this.body = this.el.querySelector<HTMLDivElement>(".in-body")!;
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    this.el.addEventListener("input", (ev) => this.onInput(ev));
    this.el.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this.go(1);
    });
    document.body.appendChild(this.el);
    this.show();
  }

  /** Sammy's line for the current step. */
  private line(step: StepId): string {
    const s = this.o.starter;
    const who = this.name.trim() || "friend";
    switch (step) {
      case "who":
        return `Hello again. I'm ${NARRATOR_NAME}. Before you get the keys: who's moving into Larp City?`;
      case "life":
        return `Here's your life, ${escapeHtml(who)}. You're ${START_AGE}, fresh out of college, working as a ${escapeHtml(s.job.toLowerCase())} in ${this.o.placeName}. Your bank's connected, so I already have the numbers.`;
      case "plan":
        return "First choice: a health plan. A cheap plan costs less each month, but you pay more if you get hurt. You can change it later.";
      case "card":
        return "Next, a starter credit card. Pay it off every month and it builds your credit score from that 600.";
      case "retire":
        return "Now your goals. They're permanent, so choose like a grown-up. First: at what age do you want to retire? Before 65 counts as a win.";
      case "debt":
        return `You owe ${money(s.debt + CAR_LOAN_BALANCE)}, counting the car. By what age do you want to be completely debt-free?`;
      case "house":
        return `A home in ${this.o.placeName} isn't cheap. By what age do you want to own one, and how much will you put down?`;
      case "marry":
        return "Last goal. Do you want to get married? Money can't buy it, but I'll keep track.";
      case "review":
        return "Here's the plan. Look it over, then move in. You can't change these later.";
    }
  }

  private show(): void {
    const step = STEPS[this.at];
    const first = this.at === 0;
    const last = this.at === STEPS.length - 1;
    this.body.innerHTML = `
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead" aria-live="polite">${this.line(step)}</p>
      <form class="in-step" novalidate>
        ${this.fields(step)}
        <div class="in-nav">
          ${first ? "<span></span>" : `<button type="button" class="btn ghost in-big" data-act="back">Back</button>`}
          <span class="in-count">${this.at + 1} / ${STEPS.length}</span>
          <button type="submit" class="btn in-big">${last ? "Move in 🏠" : "Next"}</button>
        </div>
      </form>`;
    this.owl.setSize(OWL_SIZE);
    this.body.querySelector(".in-owl-slot")!.appendChild(this.owl.el);
    void this.owl.play(ANIM[step], { then: "idle" });
    requestAnimationFrame(() => this.body.querySelector<HTMLElement>(step === "who" ? "input[name=name]" : ".in-step [type=submit]")?.focus());
  }

  private fields(step: StepId): string {
    const s = this.o.starter;
    const pick = (on: boolean) => (on ? " sel" : "");
    const pressed = (on: boolean) => `aria-pressed="${on}"`;
    switch (step) {
      case "who":
        return `
          <label class="in-field in-wide">
            <span>Your name</span>
            <span class="in-input"><input name="name" type="text" maxlength="40" autocomplete="given-name" placeholder="You" value="${escapeHtml(this.name)}"></span>
          </label>
          <div class="in-actions in-avatar-picker" role="group" aria-label="Avatar">
            ${(["male", "female"] as const)
              .map(
                (a) => `
              <button type="button" class="btn in-big in-avatar-card${pick(this.avatar === a)}" data-avatar="${a}" ${pressed(this.avatar === a)}>
                <span class="in-avatar-icon" aria-hidden="true">${AVATAR_EMOJI[a]}</span>
                <span>${a === "male" ? "Man" : "Woman"}</span>
              </button>`,
              )
              .join("")}
          </div>`;
      case "life":
        return `
          <dl class="in-facts">
            <dt>Job</dt><dd>${escapeHtml(s.job)}</dd>
            <dt>Salary</dt><dd>${money(s.salary)} a year</dd>
            <dt>Credit card and loan</dt><dd>${money(s.debt)}</dd>
            <dt>Car loan</dt><dd>${money(CAR_LOAN_BALANCE)} (${money(DEFAULT_CAR_LOAN.monthly)}/mo)</dd>
            <dt>Car insurance</dt><dd>${money(DEFAULT_CAR_INSURANCE_MONTHLY)}/mo</dd>
            <dt>Savings</dt><dd>${money(s.savings)}</dd>
            <dt>Credit score</dt><dd>${s.creditScore}</dd>
          </dl>`;
      case "plan":
        return `
          <div class="in-actions in-plan-picker" role="group" aria-label="Health plan">
            ${INSURANCE_PLANS.map(
              (p) => `
              <button type="button" class="btn in-big in-plan-card${pick(p.id === this.planId)}" data-plan="${p.id}" ${pressed(p.id === this.planId)}>
                <span class="in-plan-name">${p.name}</span>
                <span class="in-plan-detail">${money(p.monthlyPremium)}/mo</span>
                <span class="in-plan-detail">${money(p.deductible)} deductible</span>
              </button>`,
            ).join("")}
          </div>`;
      case "card":
        return `
          <div class="in-actions in-card-picker" role="group" aria-label="Starter credit card">
            ${BEGINNER_CARDS.map(
              (c) => `
              <button type="button" class="btn in-big in-card-tile${pick(c.slug === this.cardId)}" data-card="${c.slug}" ${pressed(c.slug === this.cardId)}>
                ${cardArt(c, "tile")}
                <span class="in-card-name">${c.name}</span>
                <ul class="in-card-perks">
                  ${c.perks
                    .slice(0, 2)
                    .map((p) => `<li>${p}</li>`)
                    .join("")}
                </ul>
              </button>`,
            ).join("")}
          </div>`;
      case "retire":
        return this.slider("retireAge", "Retire by age", this.retireAge, 50, 70);
      case "debt":
        return this.slider("debtFreeAge", "Debt-free by age", this.debtFreeAge, START_AGE + 1, 60);
      case "house":
        return `${this.slider("houseAge", "Own a home by age", this.houseAge, 25, 60)}
          ${this.slider("downPct", "Down payment", this.downPct, 5, 30, "%")}
          <p class="in-hint">20% down skips mortgage insurance (PMI).</p>`;
      case "marry":
        return `
          <div class="in-toggle" role="group" aria-label="Get married">
            <button type="button" class="in-toggle-opt${pick(this.marry)}" data-marry="yes" ${pressed(this.marry)}>Yes</button>
            <button type="button" class="in-toggle-opt${pick(!this.marry)}" data-marry="no" ${pressed(!this.marry)}>Not for me</button>
          </div>
          ${this.marry ? this.slider("marryAge", "Married by age", this.marryAge, START_AGE + 1, 60) : ""}`;
      case "review":
        return `
          <dl class="in-facts">
            <dt>Retire</dt><dd>by ${this.retireAge}</dd>
            <dt>Debt-free</dt><dd>by ${this.debtFreeAge}</dd>
            <dt>Own a home</dt><dd>by ${this.houseAge}, ${this.downPct}% down</dd>
            <dt>Marriage</dt><dd>${this.marry ? `by ${this.marryAge}` : "not a priority"}</dd>
          </dl>`;
    }
  }

  /** A labeled range with its value shown large beside it. */
  private slider(name: string, label: string, value: number, min: number, max: number, unit = ""): string {
    return `
      <label class="in-field in-wide in-age">
        <span>${label} <b data-out="${name}">${value}${unit}</b></span>
        <input name="${name}" type="range" min="${min}" max="${max}" step="1" value="${value}">
      </label>`;
  }

  private onInput(ev: Event): void {
    const t = ev.target as HTMLInputElement;
    if (t.name === "name") {
      this.name = t.value;
      return;
    }
    const v = Number(t.value);
    if (t.name === "retireAge") this.retireAge = v;
    else if (t.name === "debtFreeAge") this.debtFreeAge = v;
    else if (t.name === "houseAge") this.houseAge = v;
    else if (t.name === "downPct") this.downPct = v;
    else if (t.name === "marryAge") this.marryAge = v;
    else return;
    const out = this.body.querySelector(`[data-out=${t.name}]`);
    if (out) out.textContent = `${v}${t.name === "downPct" ? "%" : ""}`;
  }

  private onClick(ev: MouseEvent): void {
    if (this.leaving) return;
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("button");
    if (!btn) return;
    const d = btn.dataset;
    if (d.act === "back") return this.go(-1);
    if (d.avatar) this.avatar = d.avatar as "male" | "female";
    else if (d.plan) this.planId = d.plan;
    else if (d.card) this.cardId = d.card;
    else if (d.marry) this.marry = d.marry === "yes";
    else return;
    this.show();
  }

  private go(dir: 1 | -1): void {
    if (this.leaving) return;
    const next = this.at + dir;
    if (next < 0) return;
    if (next >= STEPS.length) return void this.finish();
    this.at = next;
    this.show();
  }

  private async finish(): Promise<void> {
    this.leaving = true;
    this.el.classList.add("in-leaving");
    // A tip of the hat on the way in.
    await this.owl.play("tip-hat", { then: "idle" });
    this.owl.stop();
    this.el.remove();
    this.resolve({
      name: this.name.trim() || "You",
      avatar: this.avatar,
      insurancePlanId: this.planId,
      selectedCardId: this.cardId,
      goals: buildGoals({
        retireAge: this.retireAge,
        debtFreeAge: this.debtFreeAge,
        downPct: this.downPct / 100,
        houseAge: this.houseAge,
        marryAge: this.marry ? this.marryAge : null,
      }),
    });
  }
}
