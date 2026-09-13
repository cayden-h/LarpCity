// The onboarding interview. Sammy the owl, Larp City's narrator (an ElevenLabs
// voice agent), asks for the player's job, salary, rent, debt, and savings
// before the city opens, and the answers become the player's starting money
// life (sim/life/intake.ts). The agent hands the answers over with its
// submit_finances client tool; if a call ends without it, the server's
// post-call webhook has the same fields, fetched by conversation id. The
// player can also type the numbers, or skip to the sample household.
// The answers become the player's server profile (main.ts), so the interview
// runs once per player; ?intake=1 forces it again and ?intake=0 skips it (for tests).

import type { VoiceConversation } from "@elevenlabs/client";
import { apiFetch } from "../net/api";
import { coerceAnswers, completeAnswers, DEFAULT_INSURANCE_PLAN_ID, INSURANCE_PLANS, takeHomeFor, type IntakeAnswers } from "../sim/life/intake";
import {
  DEFAULT_CAR_INSURANCE_MONTHLY,
  DEFAULT_CAR_LOAN,
  DEFAULT_EXPENSE_TIERS,
  MATCH_UP_TO,
  ROTH_LIMIT,
  type ExpenseCategory,
  type ExpenseTierLevel,
} from "../sim/life/player";
import { BEGINNER_CARDS } from "../data/cards-beginner";
import { cardArt } from "../debt-demo/shop.ts";
import type { ProfileSource } from "../sim/save/client";
import { buildGoals } from "./goal-picker";
import { NARRATOR_NAME } from "../narration/lines";
import { Owl, preloadOwl } from "./owl";
import "./intake.css";

/** How long to wait for the post-call webhook's notes after a call ends without the tool. */
const NOTES_WAIT_MS = 20_000;
const NOTES_POLL_MS = 2_000;
/** Hang up this long after the answers arrive, in case Sammy keeps talking. */
const WRAP_UP_MS = 12_000;
/** The owl's standing height on the welcome and call screens, and above the form. */
const OWL_BIG = 150;
const OWL_SMALL = 96;

type Role = "agent" | "user";

export interface IntakeOptions {
  /** The starting city's daytime plate, blurred behind the card. */
  backdrop: string;
  /** The player's starting state abbreviation, for the live take-home preview. */
  state: string;
}

export interface IntakeResult {
  /** The player's answers, or null to start with the sample household. */
  answers: IntakeAnswers | null;
  source: ProfileSource;
}

/** Runs the interview (or the typed form) and resolves with what the player gave. */
export function runIntake(o: IntakeOptions): Promise<IntakeResult> {
  if (new URLSearchParams(location.search).get("intake") === "0") return Promise.resolve({ answers: null, source: "skipped" });
  preloadOwl(["wave", "idle", "talk", "think", "cheer", "type", "read", "tip-hat"]);
  return new Promise((resolve) => new Intake(o, resolve).welcome());
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NUMBER_FIELDS = ["salary", "rent", "debt", "savings"] as const;
/** True once the five money answers (job stays optional) are all present. Goals are a separate, later step. */
const moneyComplete = (p: Partial<IntakeAnswers>): boolean => NUMBER_FIELDS.every((k) => p[k] !== undefined);
/** Onboarding goal-screen slider defaults. */
const GOAL_DEFAULTS = { retireAge: 65, debtFreeAge: 45, downPct: 10 };

class Intake {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly resolve: (r: IntakeResult) => void;
  private readonly state: string;
  private readonly owl = new Owl(OWL_BIG);
  private conversation: VoiceConversation | null = null;
  private conversationId: string | null = null;
  /** Answers from the submit_finances tool during the current call (money fields only; goals are their own screen). */
  private answers: Partial<IntakeAnswers> | null = null;
  /** The five money answers, held while the goal screen (name/goals) is showing. */
  private moneyAnswers: Partial<IntakeAnswers> = {};
  /** "voice" once Sammy's call handed over answers; the form alone is "typed". */
  private source: "voice" | "typed" = "typed";
  /** Avatar preset chosen on the avatar screen; no further customization. */
  private avatar: "male" | "female" = "male";
  /** Which screen the avatar screen leads to once a preset is picked. */
  private nextAfterAvatar: "talk" | "type" = "talk";
  /** Insurance tier chosen on the insurance screen; defaults to the middle tier if the player never lands on it. */
  private insurancePlanId: string = DEFAULT_INSURANCE_PLAN_ID;
  /** Beginner card chosen on the card screen; defaults to the first beginner card if the player never lands on it. */
  private selectedCardId: string = BEGINNER_CARDS[0].slug;
  /** Emergency fund target chosen on the sliders screen, in months of expenses; defaults to 6. */
  private emergencyMonths = 6;
  /** 401(k) contribution chosen on the sliders screen, as a share of gross pay; defaults to the full employer match. */
  private k401Pct = MATCH_UP_TO;
  /** Roth IRA contribution chosen on the sliders screen, in dollars a year (0-ROTH_LIMIT); defaults to 0. */
  private rothDollars = 0;
  /** The money answers, held while the sliders and expenses screens run between them and the goal screen. */
  private pendingAnswers: Partial<IntakeAnswers> | null = null;
  /** Low/medium/high pick for each expense category, from the expenses screen; defaults to all-medium. */
  private expenseTiers: Record<ExpenseCategory, ExpenseTierLevel> = { ...DEFAULT_EXPENSE_TIERS };
  private lines: { role: Role; text: string }[] = [];
  /** Set once Sammy starts the goodbye after the answers arrive. */
  private goodbye = false;
  private leaving = false;
  private frame = 0;
  private wrapTimer = 0;
  /** Bumped for every call and screen change, so an old call's callbacks can't touch a newer screen. */
  private callSeq = 0;
  private endedSeq = -1;

  constructor(o: IntakeOptions, resolve: (r: IntakeResult) => void) {
    this.resolve = resolve;
    this.state = o.state;
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
    this.el.addEventListener("input", () => {
      this.onInput();
      this.onSlidersInput();
    });
    this.el.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if ((ev.target as HTMLElement).matches(".in-goals-form")) this.onSubmitGoals();
      else this.onSubmit();
    });
    document.body.appendChild(this.el);
  }

  welcome(): void {
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead">This is the story of a new arrival in Larp City. Before they get the keys, ${NARRATOR_NAME} needs a few details:
        job, salary, rent, debt, and savings. Real numbers or a made-up life both work.</p>
      <div class="in-actions">
        <button type="button" class="btn in-big" data-act="talk">🎙️ Talk to ${NARRATOR_NAME}</button>
        <button type="button" class="btn ghost in-big" data-act="type">Type it instead</button>
      </div>
      <button type="button" class="in-link" data-act="skip">Skip and use a sample life</button>
      <p class="in-fine">The interview uses your microphone. Voice by ElevenLabs.</p>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("wave", { then: "idle" });
    this.focus("[data-act=talk]");
  }

  /** Two avatar presets, no further customization. `next` is which screen to show once one is picked. */
  private avatarScreen(next: "talk" | "type"): void {
    this.nextAfterAvatar = next;
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead">One more thing before we start: who's moving into Larp City?</p>
      <div class="in-actions in-avatar-picker">
        <button type="button" class="btn in-big in-avatar-card" data-act="avatar-male">
          <span class="in-avatar-icon" aria-hidden="true">🧑</span>
          <span>Male</span>
        </button>
        <button type="button" class="btn in-big in-avatar-card" data-act="avatar-female">
          <span class="in-avatar-icon" aria-hidden="true">👩</span>
          <span>Female</span>
        </button>
      </div>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("idle");
    this.focus("[data-act=avatar-male]");
  }

  private chooseAvatar(avatar: "male" | "female"): void {
    this.avatar = avatar;
    this.plaidScreen();
  }

  /** Fake Plaid connection screen: static UI showing a connected account. */
  private plaidScreen(): void {
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead">All connected. Nice and secure.</p>
      <div class="in-plaid-card">
        <div class="in-plaid-status">
          <span class="in-plaid-icon" aria-hidden="true">⏳</span>
        </div>
        <div class="in-plaid-account">Sunrise Bank •••• 4821</div>
      </div>
      <div class="in-actions">
        <button type="button" class="btn in-big" data-act="plaid-continue">Continue</button>
      </div>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("idle");
    this.focus("[data-act=plaid-continue]");

    // After 1 second, animate the spinner to a checkmark (CSS only, no network call).
    window.setTimeout(() => {
      const icon = this.body.querySelector<HTMLElement>(".in-plaid-icon");
      if (icon) {
        icon.classList.add("in-plaid-done");
        icon.textContent = "✓";
      }
    }, 1000);
  }

  /** Health-insurance tier picker; frontend-only, stored inert on the answers until P3 wires injury/hospital events to it. */
  private insuranceScreen(): void {
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead">One more thing while you're settling in: pick a health plan.</p>
      <div class="in-actions in-plan-picker">
        ${INSURANCE_PLANS.map(
          (p) => `
          <button type="button" class="btn in-big in-plan-card ${p.id === this.insurancePlanId ? "sel" : ""}" data-act="insurance-${p.id}">
            <span class="in-plan-name">${p.name}</span>
            <span class="in-plan-detail">${money(p.monthlyPremium)}/mo</span>
            <span class="in-plan-detail">${money(p.deductible)} deductible</span>
          </button>`,
        ).join("")}
      </div>
      <button type="button" class="in-link" data-act="insurance-continue">Continue</button>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("idle");
    this.focus(`[data-act=insurance-${this.insurancePlanId}]`);
  }

  private chooseInsurance(id: string): void {
    this.insurancePlanId = id;
    this.insuranceScreen();
  }

  /** Beginner credit-card picker; frontend-only, stored inert on the answers until a later milestone wires up applications. */
  private cardScreen(): void {
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead">And pick a starter credit card, to build your credit history.</p>
      <div class="in-actions in-card-picker">
        ${BEGINNER_CARDS.map(
          (c) => `
          <button type="button" class="btn in-big in-card-tile ${c.slug === this.selectedCardId ? "sel" : ""}" data-act="card-${c.slug}">
            ${cardArt(c, "tile")}
            <span class="in-card-name">${c.name}</span>
          </button>`,
        ).join("")}
      </div>
      <button type="button" class="in-link" data-act="card-continue">Continue</button>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("idle");
    this.focus(`[data-act=card-${this.selectedCardId}]`);
  }

  private chooseCard(slug: string): void {
    this.selectedCardId = slug;
    this.cardScreen();
  }

  /**
   * Emergency fund, 401(k), and Roth IRA sliders, shown once the player's
   * amounts are in hand. The Roth slider is a flat $0-$7,500/year (the IRS
   * limit); `applyOrders` (via `lifeFromIntake`, sim/life/intake.ts) converts
   * it to a share of gross pay and clamps it again against the player's own
   * salary, so a low earner's rothPct can't imply more than the limit.
   */
  private slidersScreen(answers: Partial<IntakeAnswers>): void {
    this.pendingAnswers = answers;
    const rothCap = ROTH_LIMIT;
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead">A few standing orders before you move in. You can always change these later.</p>
      <div class="in-sliders">
        <label class="in-slider-row">
          <span class="in-slider-label">Emergency fund target</span>
          <input type="range" name="emergencyMonths" min="0" max="12" step="1" value="${this.emergencyMonths}">
          <span class="in-slider-value" data-out="emergencyMonths">${this.emergencyMonths} months</span>
        </label>
        <label class="in-slider-row">
          <span class="in-slider-label">401(k) contribution</span>
          <input type="range" name="k401Pct" min="0" max="75" step="1" value="${Math.round(this.k401Pct * 100)}">
          <span class="in-slider-value" data-out="k401Pct">${Math.round(this.k401Pct * 100)}% of pay</span>
        </label>
        <label class="in-slider-row">
          <span class="in-slider-label">Roth IRA contribution</span>
          <input type="range" name="rothDollars" min="0" max="${rothCap}" step="100" value="${this.rothDollars}">
          <span class="in-slider-value" data-out="rothDollars">${money(this.rothDollars)}/year</span>
        </label>
      </div>
      <div class="in-actions">
        <button type="button" class="btn in-big" data-act="sliders-continue">Move in 🏠</button>
      </div>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("idle");
    this.focus("input[name=emergencyMonths]");
  }

  /** Reads the sliders screen's three inputs into the instance fields and refreshes their labels. */
  private onSlidersInput(): void {
    const sliders = this.body.querySelector(".in-sliders");
    if (!sliders) return;
    const emergency = sliders.querySelector<HTMLInputElement>("[name=emergencyMonths]");
    const k401 = sliders.querySelector<HTMLInputElement>("[name=k401Pct]");
    const roth = sliders.querySelector<HTMLInputElement>("[name=rothDollars]");
    if (emergency) {
      this.emergencyMonths = Number(emergency.value);
      sliders.querySelector("[data-out=emergencyMonths]")!.textContent = `${this.emergencyMonths} months`;
    }
    if (k401) {
      this.k401Pct = Number(k401.value) / 100;
      sliders.querySelector("[data-out=k401Pct]")!.textContent = `${Number(k401.value)}% of pay`;
    }
    if (roth) {
      this.rothDollars = Number(roth.value);
      sliders.querySelector("[data-out=rothDollars]")!.textContent = `${money(this.rothDollars)}/year`;
    }
  }

  /** Category labels for the expenses screen, in display order. */
  private static readonly EXPENSE_LABELS: [ExpenseCategory, string][] = [
    ["food", "Groceries and eating out"],
    ["houseBills", "Utilities, phone, internet"],
    ["fitness", "Gym and fitness"],
    ["gas", "Gas"],
    ["carMaintenance", "Car maintenance"],
  ];

  /**
   * Low/medium/high presets for the 5 expense categories the intake asks
   * about, plus a read-only summary of the fixed car loan and insurance
   * (not editable here; see sim/life/player.ts's DEFAULT_CAR_LOAN and
   * DEFAULT_CAR_INSURANCE_MONTHLY).
   */
  private expensesScreen(): void {
    const level = (l: ExpenseTierLevel) => l[0].toUpperCase() + l.slice(1);
    this.show(`
      <div class="in-owl-slot"></div>
      <div class="in-name">${NARRATOR_NAME}</div>
      <p class="in-lead">Last thing: how do you spend, day to day?</p>
      <div class="in-expenses">
        ${Intake.EXPENSE_LABELS.map(
          ([cat, label]) => `
          <div class="in-expense-row">
            <span class="in-expense-label">${label}</span>
            <div class="in-expense-toggle" role="group" aria-label="${label}">
              ${(["low", "medium", "high"] as ExpenseTierLevel[])
                .map(
                  (l) => `
                <button type="button" class="btn in-expense-btn ${this.expenseTiers[cat] === l ? "sel" : ""}" data-act="tier-${cat}-${l}">${level(l)}</button>`,
                )
                .join("")}
            </div>
          </div>`,
        ).join("")}
      </div>
      <p class="in-expense-summary">
        Car loan: ${money(DEFAULT_CAR_LOAN.monthly)}/mo for ${DEFAULT_CAR_LOAN.months} months &middot;
        Car insurance: ${money(DEFAULT_CAR_INSURANCE_MONTHLY)}/mo
      </p>
      <div class="in-actions">
        <button type="button" class="btn in-big" data-act="expenses-continue">Move in 🏠</button>
      </div>`);
    this.mountOwl(OWL_BIG);
    void this.owl.play("idle");
    this.focus("[data-act=expenses-continue]");
  }

  private chooseExpenseTier(cat: ExpenseCategory, level: ExpenseTierLevel): void {
    this.expenseTiers = { ...this.expenseTiers, [cat]: level };
    this.expensesScreen();
  }

  private show(html: string): void {
    this.body.innerHTML = html;
  }

  /** Puts the owl into the current screen's slot, at `size`. */
  private mountOwl(size: number): void {
    this.owl.setSize(size);
    this.body.querySelector(".in-owl-slot")?.appendChild(this.owl.el);
  }

  private focus(selector: string): void {
    requestAnimationFrame(() => this.body.querySelector<HTMLElement>(selector)?.focus());
  }

  private onClick(ev: MouseEvent): void {
    if (this.leaving) return;
    const target = ev.target as HTMLElement;
    const marriageBtn = target.closest<HTMLElement>("[data-marriage]");
    if (marriageBtn) return this.pickMarriage(marriageBtn);
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "talk") this.avatarScreen("talk");
    else if (act === "type") this.avatarScreen("type");
    else if (act === "avatar-male") this.chooseAvatar("male");
    else if (act === "avatar-female") this.chooseAvatar("female");
    else if (act === "plaid-continue") this.insuranceScreen();
    else if (act === "insurance-continue") this.cardScreen();
    else if (act === "card-continue") {
      if (this.nextAfterAvatar === "talk") void this.talk();
      else this.typeInstead();
    } else if (act?.startsWith("insurance-")) this.chooseInsurance(act.slice("insurance-".length));
    else if (act?.startsWith("card-")) this.chooseCard(act.slice("card-".length));
    else if (act === "sliders-continue") this.expensesScreen();
    else if (act === "expenses-continue") this.showGoals(this.pendingAnswers ?? {});
    else if (act?.startsWith("tier-")) {
      const rest = act.slice("tier-".length);
      const sep = rest.lastIndexOf("-");
      this.chooseExpenseTier(rest.slice(0, sep) as ExpenseCategory, rest.slice(sep + 1) as ExpenseTierLevel);
    } else if (act === "hangup") void this.hangUp(this.callSeq);
    else if (act === "skip") void this.finish(null);
  }

  /** Flavor only: the marriage goal is always one of the four, whichever button is picked. */
  private pickMarriage(btn: HTMLElement): void {
    this.body.querySelectorAll<HTMLElement>("[data-marriage]").forEach((b) => {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    });
  }

  // ---- The call ----

  private async talk(): Promise<void> {
    const seq = ++this.callSeq;
    this.answers = null;
    this.conversationId = null;
    this.lines = [];
    this.goodbye = false;
    this.show(`
      <div class="in-owl-slot"></div>
      <p class="in-status" aria-live="polite">Calling ${NARRATOR_NAME}…</p>
      <ol class="in-transcript" aria-label="Conversation"></ol>
      <div class="in-actions">
        <button type="button" class="btn ghost in-big" data-act="hangup">Hang up</button>
      </div>
      <button type="button" class="in-link" data-act="type">Type it instead</button>`);
    this.mountOwl(OWL_BIG);
    this.owl.rest();

    let signedUrl: string;
    try {
      ({ signedUrl } = await apiFetch<{ signedUrl: string }>("/voice/signed-url"));
    } catch {
      if (seq === this.callSeq) this.confirm({}, `${NARRATOR_NAME} can't take calls right now. Fill in your numbers by hand.`);
      return;
    }
    if (seq !== this.callSeq) return;

    try {
      // The SDK loads only when a call starts, so a returning player never downloads it.
      const { VoiceConversation: Voice } = await import("@elevenlabs/client");
      const conversation = await Voice.startSession({
        signedUrl,
        clientTools: { submit_finances: (params: unknown) => this.onSubmitFinances(seq, params) },
        onConnect: ({ conversationId }) => {
          if (seq === this.callSeq) this.conversationId = conversationId;
        },
        onModeChange: ({ mode }) => this.onMode(seq, mode),
        onMessage: ({ message, role }) => this.onLine(seq, role, message),
        onDisconnect: () => void this.onCallEnded(seq),
        onError: (message) => console.warn("[intake] voice error:", message),
      });
      if (seq !== this.callSeq) {
        void conversation.endSession();
        return;
      }
      this.conversation = conversation;
      this.status(`${NARRATOR_NAME} is picking up…`);
      this.meter(conversation);
    } catch (err) {
      if (seq !== this.callSeq) return;
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      this.confirm(
        {},
        denied
          ? "No microphone? No problem. Fill in your numbers by hand."
          : `The call couldn't connect. Fill in your numbers by hand, or try ${NARRATOR_NAME} again.`,
      );
    }
  }

  private onSubmitFinances(seq: number, params: unknown): string {
    if (seq !== this.callSeq) return "The player already moved on; say goodbye.";
    const answers = coerceAnswers(params);
    if (!moneyComplete(answers)) return "Some of the five answers were missing or unclear. Ask for the missing ones, then call submit_finances again.";
    this.answers = answers;
    this.source = "voice";
    this.status(`Got it! ${NARRATOR_NAME} is writing it all down…`);
    void this.owl.play("cheer", { then: "idle" });
    this.wrapTimer = window.setTimeout(() => void this.hangUp(seq), WRAP_UP_MS);
    return "Saved. Tell the player their city is ready in one short sentence, then stop.";
  }

  private onMode(seq: number, mode: "speaking" | "listening"): void {
    if (seq !== this.callSeq) return;
    if (this.answers) {
      // Hang up once Sammy has said goodbye (a speaking turn that ends).
      if (mode === "speaking") {
        this.goodbye = true;
        this.owl.talk("warm");
      } else if (this.goodbye) {
        this.owl.rest();
        window.setTimeout(() => void this.hangUp(seq), 400);
      }
      return;
    }
    // Listening rests on the same sheet as talking, so the owl's vest doesn't change between turns.
    if (mode === "speaking") this.owl.talk("plain");
    else this.owl.rest();
    this.status(mode === "speaking" ? `${NARRATOR_NAME} is talking…` : `Your turn. ${NARRATOR_NAME} is listening.`);
  }

  private onLine(seq: number, role: Role, text: string): void {
    if (seq !== this.callSeq || !text.trim()) return;
    this.lines.push({ role, text: text.trim() });
    const list = this.body.querySelector<HTMLOListElement>(".in-transcript");
    if (!list) return;
    list.innerHTML = this.lines
      .slice(-8)
      .map((l) => `<li class="${l.role}"><b>${l.role === "agent" ? NARRATOR_NAME : "You"}</b>${escapeHtml(l.text)}</li>`)
      .join("");
    list.scrollTop = list.scrollHeight;
  }

  private status(text: string): void {
    const el = this.body.querySelector(".in-status");
    if (el) el.textContent = text;
  }

  /** Bobs Sammy with his voice, and gives it a beat to change pose on as each syllable starts. */
  private meter(conversation: VoiceConversation): void {
    let last = 0;
    const tick = () => {
      if (this.conversation !== conversation) return;
      const level = Math.min(1, conversation.getOutputVolume() * 1.6);
      this.owl.setLevel(level);
      if (level > 0.22 && last < 0.12) this.owl.beat();
      last = level;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private async endCall(): Promise<void> {
    clearTimeout(this.wrapTimer);
    cancelAnimationFrame(this.frame);
    this.owl.setLevel(0);
    const conversation = this.conversation;
    this.conversation = null;
    if (conversation) await conversation.endSession().catch(() => undefined);
  }

  private async hangUp(seq: number): Promise<void> {
    if (seq !== this.callSeq) return;
    await this.endCall();
    await this.onCallEnded(seq);
  }

  private async onCallEnded(seq: number): Promise<void> {
    if (seq !== this.callSeq || this.endedSeq === seq) return;
    this.endedSeq = seq;
    await this.endCall();
    if (this.answers) return this.confirm(this.answers, `Here's what ${NARRATOR_NAME} wrote down. Fix anything that's off, then move in.`);

    const id = this.conversationId;
    if (!id) return this.confirm({}, `The call ended before it started. Fill in your numbers by hand, or try ${NARRATOR_NAME} again.`);
    this.status(`Checking ${NARRATOR_NAME}'s notes…`);
    void this.owl.play("type");
    this.body.querySelector("[data-act=hangup]")?.remove();
    const notes = await this.fetchNotes(seq, id);
    if (seq !== this.callSeq) return;
    const complete = moneyComplete(notes);
    this.confirm(
      notes,
      complete
        ? `The call ended early, but ${NARRATOR_NAME}'s notes came through. Check them over.`
        : Object.keys(notes).length
          ? `${NARRATOR_NAME} caught some of it. Fill in the rest.`
          : `The call ended before ${NARRATOR_NAME} wrote anything down. Fill in your numbers by hand, or talk again.`,
    );
  }

  /** The post-call webhook's answers for this call, polled until they land or we give up. */
  private async fetchNotes(seq: number, conversationId: string): Promise<Partial<IntakeAnswers>> {
    const deadline = Date.now() + NOTES_WAIT_MS;
    while (Date.now() < deadline && seq === this.callSeq) {
      try {
        const r = await apiFetch<{ ready: boolean; answers?: unknown }>("/voice/interview/claim", {
          method: "POST",
          body: JSON.stringify({ conversationId }),
        });
        if (r.ready) {
          const notes = coerceAnswers(r.answers);
          if (Object.keys(notes).length) this.source = "voice";
          return notes;
        }
      } catch {
        return {};
      }
      await new Promise((done) => setTimeout(done, NOTES_POLL_MS));
    }
    return {};
  }

  private typeInstead(): void {
    const answers = this.answers;
    this.callSeq++;
    void this.endCall();
    this.confirm(
      answers ?? {},
      answers ? `Here's what ${NARRATOR_NAME} wrote down. Fix anything that's off, then move in.` : "Fill in your numbers. Use 0 for none.",
    );
  }

  // ---- Confirm and finish ----

  private confirm(prefill: Partial<IntakeAnswers>, note: string): void {
    this.callSeq++;
    const value = (k: keyof IntakeAnswers) => (prefill[k] === undefined ? "" : escapeHtml(String(prefill[k])));
    const field = (key: (typeof NUMBER_FIELDS)[number], label: string, unit: string) => `
      <label class="in-field">
        <span>${label}</span>
        <span class="in-input"><i>$</i><input name="${key}" type="number" inputmode="numeric" min="0" step="1" value="${value(key)}">${unit ? `<em>${unit}</em>` : ""}</span>
      </label>`;
    this.show(`
      <div class="in-owl-slot in-owl-small"></div>
      <p class="in-note">${escapeHtml(note)}</p>
      <form class="in-form" novalidate>
        <label class="in-field in-wide">
          <span>Job</span>
          <span class="in-input"><input name="job" type="text" maxlength="60" autocomplete="organization-title" placeholder="Nurse, barista, astronaut…" value="${value("job")}"></span>
        </label>
        ${field("salary", "Salary before tax", "a year")}
        ${field("rent", "Rent or housing", "a month")}
        ${field("debt", "Total debt", "")}
        ${field("savings", "Savings", "")}
        <p class="in-derived in-wide" aria-live="polite"></p>
        <p class="in-error in-wide" role="alert"></p>
        <div class="in-actions in-wide">
          <button type="submit" class="btn in-big">Move in 🏠</button>
          <button type="button" class="btn ghost in-big" data-act="talk">🎙️ Talk to ${NARRATOR_NAME}</button>
        </div>
      </form>
      <button type="button" class="in-link" data-act="skip">Skip and use a sample life</button>`);
    this.mountOwl(OWL_SMALL);
    void this.owl.play("read");
    this.onInput();
    const missing = NUMBER_FIELDS.find((k) => prefill[k] === undefined);
    this.focus(missing ? `input[name=${missing}]` : ".in-form [type=submit]");
  }

  private readForm(): Partial<IntakeAnswers> {
    const form = this.body.querySelector<HTMLFormElement>(".in-form");
    if (!form) return {};
    const data = new FormData(form);
    return coerceAnswers(Object.fromEntries([...data.entries()].map(([k, v]) => [k, String(v)])));
  }

  private onInput(): void {
    if (this.body.querySelector(".in-goals-form")) return this.updateGoalLabels();
    const derived = this.body.querySelector(".in-derived");
    if (!derived) return;
    const a = this.readForm();
    this.body.querySelector(".in-error")!.textContent = "";
    if (a.salary === undefined) {
      derived.textContent = "";
      return;
    }
    const takeHome = takeHomeFor(a.salary, this.state);
    derived.textContent =
      a.rent === undefined
        ? `That's about ${money(takeHome)} a month after taxes.`
        : `That's about ${money(takeHome)} a month after taxes, and ${money(takeHome - a.rent)} after rent.`;
  }

  private onSubmit(): void {
    if (this.leaving) return;
    const partial = this.readForm();
    if (!moneyComplete(partial)) {
      this.body.querySelector(".in-error")!.textContent = "Fill in salary, rent, debt, and savings. Use 0 for none.";
      return;
    }
    this.slidersScreen(partial);
  }

  // ---- Goals (name and the 4 permanent goals; avatar was already chosen on its own screen) ----

  /** The one-time, permanent goal screen: shown once the money, sliders, and expenses screens are done, right before finish(). */
  private showGoals(money: Partial<IntakeAnswers>): void {
    this.moneyAnswers = money;
    this.show(`
      <div class="in-owl-slot in-owl-small"></div>
      <p class="in-note">Last thing — set your four life goals. This is permanent: there's no changing them later.</p>
      <form class="in-form in-goals-form" novalidate>
        <label class="in-field in-wide">
          <span>Name</span>
          <span class="in-input"><input name="name" type="text" maxlength="40" autocomplete="given-name" placeholder="You"></span>
        </label>
        <label class="in-field in-wide">
          <span>Retire by age <b id="goal-retire-val">${GOAL_DEFAULTS.retireAge}</b></span>
          <input name="retireAge" type="range" min="50" max="70" step="1" value="${GOAL_DEFAULTS.retireAge}">
        </label>
        <div class="in-field in-wide">
          <span>Marriage is one of your four goals — money doesn't buy it, but the Goals app will track it. Do you want to get married?</span>
          <div class="in-toggle" role="radiogroup" aria-label="Marriage">
            <button type="button" class="in-toggle-opt active" data-marriage="yes" role="radio" aria-checked="true">Yes</button>
            <button type="button" class="in-toggle-opt" data-marriage="no" role="radio" aria-checked="false">No</button>
          </div>
        </div>
        <label class="in-field in-wide">
          <span>Debt-free by age <b id="goal-debt-val">${GOAL_DEFAULTS.debtFreeAge}</b></span>
          <input name="debtFreeAge" type="range" min="25" max="70" step="1" value="${GOAL_DEFAULTS.debtFreeAge}">
        </label>
        <label class="in-field in-wide">
          <span>Buy a house with <b id="goal-house-val">${GOAL_DEFAULTS.downPct}</b>% down</span>
          <input name="downPct" type="range" min="5" max="30" step="1" value="${GOAL_DEFAULTS.downPct}">
        </label>
        <div class="in-actions in-wide">
          <button type="submit" class="btn in-big">Continue</button>
        </div>
      </form>`);
    this.mountOwl(OWL_SMALL);
    void this.owl.play("read");
    this.focus(".in-goals-form input[name=name]");
  }

  /** Keeps the three slider readouts in sync as they move. */
  private updateGoalLabels(): void {
    const form = this.body.querySelector<HTMLFormElement>(".in-goals-form");
    if (!form) return;
    const value = (name: string) => form.querySelector<HTMLInputElement>(`[name=${name}]`)?.value ?? "";
    const set = (id: string, text: string) => {
      const el = this.body.querySelector(`#${id}`);
      if (el) el.textContent = text;
    };
    set("goal-retire-val", value("retireAge"));
    set("goal-debt-val", value("debtFreeAge"));
    set("goal-house-val", value("downPct"));
  }

  private onSubmitGoals(): void {
    if (this.leaving) return;
    const form = this.body.querySelector<HTMLFormElement>(".in-goals-form");
    if (!form) return;
    const data = new FormData(form);
    const goals = buildGoals({
      retireAge: Number(data.get("retireAge")),
      debtFreeAge: Number(data.get("debtFreeAge")),
      downPct: Number(data.get("downPct")) / 100,
    });
    const answers = completeAnswers({ ...this.moneyAnswers, name: String(data.get("name") ?? ""), avatar: this.avatar, goals });
    // The money fields were already validated before this screen showed, and goals are always
    // complete here (buildGoals always covers the 4 required kinds), so this should never be null.
    if (!answers) {
      console.warn("intake: completeAnswers returned null after the goal screen; this should be unreachable");
      return;
    }
    void this.finish(answers);
  }

  private async finish(answers: IntakeAnswers | null): Promise<void> {
    this.leaving = true;
    this.callSeq++;
    void this.endCall();
    if (answers) {
      // A tip of the hat on the way in.
      this.el.classList.add("in-leaving");
      await this.owl.play("tip-hat", { then: "idle" });
    }
    this.owl.stop();
    this.el.remove();
    const rothPct = answers && answers.salary > 0 ? this.rothDollars / answers.salary : 0;
    this.resolve(
      answers
        ? {
            answers: {
              ...answers,
              avatar: this.avatar,
              insurancePlanId: this.insurancePlanId,
              selectedCardId: this.selectedCardId,
              emergencyMonths: this.emergencyMonths,
              k401Pct: this.k401Pct,
              rothPct,
              expenseTiers: this.expenseTiers,
            },
            source: this.source,
          }
        : { answers: null, source: "skipped" },
    );
  }
}
