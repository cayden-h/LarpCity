// The goal fast-forward setup screen (research/10, section 6, hackathon
// version): pick a goal, set the plan (pre-filled with what the player does
// now, with a Recommended preset to compare), watch a live preview across 100
// other possible markets, then fast-forward. City time is paused while it's
// open, and the screen ends on a card with what happened.

import "./skip-setup.css";
import type { Clock } from "../engine/clock";
import { project, type Strategy } from "../sim/debt";
import type { PlayerLife } from "../sim/life";
import { finalScore } from "../sim/wellbeing";
import {
  applyOrders,
  budget,
  buildFuture,
  currentOrders,
  futureMonth,
  isMet,
  missedMatch,
  PREVIEW_RUNS,
  PREVIEW_YEARS,
  previewSeed,
  priceTag,
  recommendedOrders,
  runPreview,
  runSkip,
  viewOf,
  type CrashRule,
  type Future,
  type Goal,
  type Lifestyle,
  type Preview,
  type SkipResult,
  type StandingOrders,
} from "../sim/skip";

type GoalKind = Goal["kind"];
type Preset = "current" | "recommended" | "custom";
type OrderKey = keyof StandingOrders;

const GOALS: { kind: GoalKind; icon: string; title: string }[] = [
  { kind: "emergency_fund", icon: "🛟", title: "Build an emergency fund" },
  { kind: "debt_free", icon: "💳", title: "Become debt-free" },
  { kind: "net_worth", icon: "💰", title: "Build your life savings" },
  { kind: "house", icon: "🏡", title: "Buy a home" },
  { kind: "marriage", icon: "💍", title: "Get married" },
  { kind: "status", icon: "📈", title: "Reach a career level" },
];
const EMERGENCY_MONTHS = [3, 6, 9, 12];
const NET_WORTH = [25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const DOWN = [0.05, 0.1, 0.2];
const TARGET_INCOME = [50_000, 75_000, 100_000, 150_000, 250_000, 500_000];
const LIFESTYLES: [Lifestyle, string][] = [
  ["frugal", "Frugal"],
  ["normal", "Normal"],
  ["comfortable", "Comfy"],
  ["lavish", "Lavish"],
];
const CRASH_RULES: [CrashRule, string][] = [
  ["hold", "Hold"],
  ["sell_half", "Sell half"],
  ["sell_all", "Sell all"],
];
const STRATEGIES: [Strategy, string][] = [
  ["avalanche", "Avalanche"],
  ["snowball", "Snowball"],
  ["minimums", "Minimums only"],
];
/** Sliders that show a percent but store a share. */
const PERCENT_KEYS = new Set<OrderKey>(["k401Pct", "stockPct"]);
/** The preview appears once this many futures exist and refines as the rest arrive. */
const MIN_FUTURES = 20;

function dollars(v: number): string {
  return `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

function compact(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
}

function monthDate(start: Date, m: number): Date {
  return new Date(start.getFullYear(), start.getMonth() + m, 1);
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function duration(days: number): string {
  const months = Math.round(days / 30.44);
  if (months < 1) return days <= 1 ? "1 day" : `${days} days`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y ? `${y} year${y > 1 ? "s" : ""}` : "", m ? `${m} month${m > 1 ? "s" : ""}` : ""].filter(Boolean);
  return parts.join(", ");
}

function monthsText(n: number): string {
  return n === 1 ? "1 month" : `${n} months`;
}

/** A round step that splits `range` into about four gridlines. */
function niceStep(range: number): number {
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const s of [1, 2, 2.5, 5]) if (raw <= s * mag) return s * mag;
  return 10 * mag;
}

export interface FastForwardDeps {
  clock: Clock;
  player: PlayerLife;
  /** The run's seed; the preview derives other seeds from it and never uses it directly. */
  seed: number;
  /** Called after the days have run, so the city can jump the calendar and redraw. */
  onFinished(result: SkipResult): void;
}

export class FastForward {
  private readonly el: HTMLElement;
  private readonly deps: FastForwardDeps;
  private goalKind: GoalKind = "emergency_fund";
  private months = 6;
  private amount = 100_000;
  private downPct = 0.1;
  private targetIncome = 100_000;
  private capAge = 67;
  private orders!: StandingOrders;
  private now!: StandingOrders;
  private recommended!: StandingOrders;
  private preset: Preset = "current";
  /** Set after one tap on Start for a plan that runs short; the next tap starts it. */
  private armed = false;
  private resumeSpeed = 1;
  private timer = 0;
  /** The preview's other possible markets, built once in the background; null until all are ready. */
  private futures: Future[] | null = null;
  /** Futures filled in so far, in order; the first `built` entries are ready. */
  private partial: Future[] = [];
  private built = 0;

  constructor(deps: FastForwardDeps) {
    this.deps = deps;
    this.el = document.createElement("div");
    this.el.className = "ff-overlay";
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.warm();
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    this.el.addEventListener("input", (ev) => this.onInput(ev));
    window.addEventListener("keydown", (ev) => {
      if (this.el.hidden) return;
      if (ev.key === "Escape") return this.close();
      const card = (ev.target as HTMLElement).closest<HTMLElement>("[data-goal]");
      if (card && (ev.key === "Enter" || ev.key === " ") && ev.target === card) {
        ev.preventDefault();
        this.pickGoal(card);
      }
    });
  }

  open(): void {
    if (!this.el.hidden) return;
    const { clock, player } = this.deps;
    this.resumeSpeed = clock.speed || this.resumeSpeed;
    clock.speed = 0;
    this.now = currentOrders(player);
    this.recommended = recommendedOrders(player);
    this.orders = { ...this.now };
    this.preset = "current";
    this.armed = false;
    this.capAge = Math.max(this.capAge, Math.floor(player.age) + 1);
    if (this.goalKind === "debt_free" && player.totalDebt() < 0.5) this.goalKind = "emergency_fund";
    this.el.innerHTML = this.markup();
    this.el.hidden = false;
    this.sync();
    this.renderPreview();
    this.q("[data-close]").focus();
  }

  close(): void {
    this.el.hidden = true;
    clearTimeout(this.timer);
    this.deps.clock.speed = this.resumeSpeed;
  }

  /** Builds the preview's futures in a worker at game start, so the preview is ready when the screen opens. */
  private warm(): void {
    const got: Future[] = new Array(PREVIEW_RUNS);
    this.partial = got;
    const done = () => {
      this.futures = got;
      if (!this.el.hidden) this.renderPreview();
    };
    try {
      const worker = new Worker(new URL("../sim/skip/futures.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (ev: MessageEvent<{ i: number; stock: Float64Array; bond: Float64Array }>) => {
        got[ev.data.i] = { stock: ev.data.stock, bond: ev.data.bond };
        this.built++;
        if (this.built === PREVIEW_RUNS) {
          worker.terminate();
          done();
        } else if (!this.el.hidden && this.built % 10 === 0) this.renderPreview();
      };
      worker.onerror = () => {
        worker.terminate();
        this.warmHere(got, done);
      };
      worker.postMessage({ seed: this.deps.seed, runs: PREVIEW_RUNS, years: PREVIEW_YEARS });
    } catch {
      this.warmHere(got, done);
    }
  }

  /** Fallback without workers: a couple of futures per task on the main thread. */
  private warmHere(got: Future[], done: () => void): void {
    this.built = 0;
    const step = () => {
      for (let n = 0; n < 2 && this.built < PREVIEW_RUNS; n++, this.built++) got[this.built] = buildFuture(previewSeed(this.deps.seed, this.built), PREVIEW_YEARS);
      if (this.built < PREVIEW_RUNS) setTimeout(step, 0);
      else done();
    };
    step();
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  private goal(): Goal {
    switch (this.goalKind) {
      case "debt_free":
        return { kind: "debt_free" };
      case "emergency_fund":
        return { kind: "emergency_fund", months: this.months };
      case "net_worth":
        return { kind: "net_worth", amount: this.amount };
      case "house":
        return { kind: "house", downPct: this.downPct };
      case "marriage":
        return { kind: "marriage" };
      case "status":
        return { kind: "status", annualIncome: this.targetIncome };
    }
  }

  private markup(): string {
    const { player } = this.deps;
    const noDebt = player.totalDebt() < 0.5;
    const depositMax = Math.max(1_000, Math.ceil(player.monthlyTakeHome / 100) * 100);
    return `<div class="ff-window" role="dialog" aria-modal="true" aria-labelledby="ff-title">
      <header class="ff-bar">
        <span class="ff-title" id="ff-title"><span class="ff-dot"></span>Fast-forward to a goal</span>
        <span class="ff-hint">City time is paused</span>
        <button class="ff-close" data-close aria-label="Close">✕</button>
      </header>
      <div class="ff-body" data-body>
        <section class="ff-col">
          <h2 class="ff-h"><span class="ff-step">1</span>Pick a goal</h2>
          <div class="ff-goals" role="radiogroup" aria-label="Goal">${GOALS.map((g) => this.goalCard(g.kind, g.icon, g.title, noDebt)).join("")}</div>
          <div class="ff-tag" data-tag></div>
          <label class="ff-cap">Stop at age <input type="number" data-cap min="${Math.floor(player.age) + 1}" max="90" value="${this.capAge}" /> if it isn't reached</label>
        </section>
        <section class="ff-col">
          <h2 class="ff-h"><span class="ff-step">2</span>Your plan</h2>
          <div class="ff-presets" role="radiogroup" aria-label="Plan">
            <button type="button" role="radio" data-preset="current">What you're doing now</button>
            <button type="button" role="radio" data-preset="recommended">Recommended</button>
          </div>
          ${this.range("depositMonthly", "Invest every month", 0, depositMax, 25)}
          ${this.range("k401Pct", "401(k) contribution", 0, 30, 1)}
          ${this.range("stockPct", "Stocks vs bonds", 0, 100, 5)}
          <div class="ff-row" data-row="debt"${noDebt ? " hidden" : ""}>
            <div class="ff-row-top"><label for="ff-debtStrategy">Debt payoff</label><output data-out="extraMonthly"></output></div>
            <div class="ff-pair">
              <select id="ff-debtStrategy" data-k="debtStrategy">${STRATEGIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
              <input type="range" data-k="extraMonthly" min="0" max="1500" step="25" aria-label="Extra debt payment per month" />
            </div>
            <div class="ff-note" data-hint="debt"></div>
          </div>
          ${this.range("emergencyMonths", "Emergency fund", 0, 12, 0.5)}
          ${this.seg("lifestyle", "Lifestyle", LIFESTYLES)}
          ${this.seg("crashRule", "When the market crashes", CRASH_RULES)}
          <div class="ff-budget" data-budget></div>
        </section>
        <section class="ff-col ff-col-preview">
          <h2 class="ff-h"><span class="ff-step">3</span>What could happen</h2>
          <div class="ff-chart" data-chart></div>
          <ul class="ff-stats" data-stats></ul>
          <button type="button" class="ff-go" data-start>Fast-forward ⏩</button>
          <p class="ff-fine" data-fine></p>
        </section>
      </div>
    </div>`;
  }

  private goalCard(kind: GoalKind, icon: string, title: string, noDebt: boolean): string {
    const option = (value: number, label: string, current: number) => `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
    const param =
      kind === "emergency_fund"
        ? `<select data-gp="months" aria-label="How many months">${EMERGENCY_MONTHS.map((m) => option(m, monthsText(m), this.months)).join("")}</select>`
        : kind === "net_worth"
          ? `<select data-gp="amount" aria-label="Net worth">${NET_WORTH.map((a) => option(a, compact(a), this.amount)).join("")}</select>`
          : kind === "house"
            ? `<select data-gp="downPct" aria-label="Down payment">${DOWN.map((d) => option(d, `${Math.round(d * 100)}% down`, this.downPct)).join("")}</select>`
            : kind === "status"
              ? `<select data-gp="targetIncome" aria-label="Target annual income">${TARGET_INCOME.map((income) => option(income, `${compact(income)}/yr`, this.targetIncome)).join("")}</select>`
            : "";
    const disabled = kind === "debt_free" && noDebt;
    return `<div class="ff-goal" data-goal="${kind}" role="radio" tabindex="0" aria-checked="false"${disabled ? ' aria-disabled="true"' : ""}>
      <span class="ff-goal-icon" aria-hidden="true">${icon}</span>
      <span class="ff-goal-title">${title}</span>
      ${param}${disabled ? `<span class="ff-goal-sub">You have no debt</span>` : ""}
    </div>`;
  }

  private range(key: OrderKey, label: string, min: number, max: number, step: number): string {
    return `<div class="ff-row" data-row="${key}">
      <div class="ff-row-top"><label for="ff-${key}">${label}</label><output data-out="${key}"></output></div>
      <input id="ff-${key}" type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" />
      <div class="ff-note" data-hint="${key}"></div>
    </div>`;
  }

  private seg(key: OrderKey, label: string, options: [string, string][]): string {
    return `<div class="ff-row" data-row="${key}">
      <div class="ff-row-top"><span id="ff-${key}-label">${label}</span></div>
      <div class="ff-seg" role="radiogroup" aria-labelledby="ff-${key}-label">${options.map(([v, l]) => `<button type="button" role="radio" data-k="${key}" data-v="${v}">${l}</button>`).join("")}</div>
      <div class="ff-note" data-hint="${key}"></div>
    </div>`;
  }

  /** Pushes the plan and goal into every control, readout, and hint. */
  private sync(): void {
    const { player, clock } = this.deps;
    const o = this.orders;
    const b = budget(player, o);

    this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[data-k], select[data-k]").forEach((c) => {
      const k = c.dataset.k as OrderKey;
      const v = o[k] as number | string;
      c.value = String(PERCENT_KEYS.has(k) ? Math.round((v as number) * 100) : v);
    });
    this.el.querySelectorAll<HTMLButtonElement>("button[data-v]").forEach((btn) => {
      const on = String(o[btn.dataset.k as OrderKey]) === btn.dataset.v;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-checked", String(on));
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
      const on = btn.dataset.preset === this.preset;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-checked", String(on));
    });
    this.el.querySelectorAll<HTMLElement>("[data-goal]").forEach((card) => {
      const on = card.dataset.goal === this.goalKind;
      card.classList.toggle("on", on);
      card.setAttribute("aria-checked", String(on));
    });

    const planMonth = b.rent + b.housingBills + b.living + b.minimums;
    this.out("depositMonthly", o.depositMonthly > 0 ? `${dollars(o.depositMonthly)}/mo` : "Nothing");
    this.out("k401Pct", `${Math.round(o.k401Pct * 100)}% of pay`);
    this.out("stockPct", `${Math.round(o.stockPct * 100)}% stocks · ${100 - Math.round(o.stockPct * 100)}% bonds`);
    this.out("extraMonthly", o.extraMonthly > 0 ? `+${dollars(o.extraMonthly)}/mo extra` : "No extra");
    this.out("emergencyMonths", o.emergencyMonths > 0 ? `${monthsText(o.emergencyMonths)} · ${dollars(o.emergencyMonths * planMonth)}` : "None");

    const compare = (fmt: (x: StandingOrders) => string) => `Now: ${fmt(this.now)} · Recommended: ${fmt(this.recommended)}`;
    this.hint("depositMonthly", compare((x) => `${dollars(x.depositMonthly)}/mo`));
    const missed = missedMatch(player, o);
    this.hint(
      "k401Pct",
      missed > 0
        ? `<b class="bad">You're leaving ${dollars(missed)} a year of free employer match on the table.</b> Your employer adds 50¢ per dollar up to 6% of pay.`
        : `You get the full employer match: ${dollars(b.match * 12)} a year on top of your own.`,
    );
    this.hint("stockPct", `More stocks grow faster and fall harder. Recommended at your age: ${Math.round(this.recommended.stockPct * 100)}%.`);
    if (player.totalDebt() >= 0.5) {
      const p = project(player.book.debts, o.debtStrategy, o.extraMonthly);
      this.hint(
        "debt",
        p.stuck
          ? `<b class="bad">On this plan the debt never gets paid off.</b>`
          : `Debt-free in ${duration(p.months * 30.44)} (${monthLabel(monthDate(clock.date, p.months))}), paying ${dollars(p.interest)} of interest.`,
      );
    }
    this.hint("emergencyMonths", `Your emergency fund has ${dollars(player.ledger.accounts.get("emergency")?.balance ?? 0)} in it. Recommended: 3 months.`);
    this.hint("lifestyle", `Living costs besides housing: ${dollars(b.living)} a month.`);
    this.hint(
      "crashRule",
      o.crashRule === "hold"
        ? "Stay invested through crashes and ride the recovery."
        : "Sells once the market is down 20% and buys back after it recovers, which locks in the loss and misses the rebound.",
    );

    const short = b.surplus < 0;
    const budgetEl = this.q("[data-budget]");
    budgetEl.className = `ff-budget ${short ? "bad" : "ok"}`;
    const parts: string[] = [];
    if (b.rent > 0) parts.push(`rent ${dollars(b.rent)}`);
    if (b.housingBills > 0) parts.push(`property tax, home insurance + PMI ${dollars(b.housingBills)}`);
    parts.push(`living ${dollars(b.living)}`);
    if (b.minimums + b.extra > 0) parts.push(`${player.home.tenure === "own" ? "debt (including mortgage)" : "debt"} ${dollars(b.minimums + b.extra)}`);
    if (b.k401Cost > 0) parts.push(`401(k) ${dollars(b.k401Cost)}`);
    if (b.deposit > 0) parts.push(`investing ${dollars(b.deposit)}`);
    budgetEl.innerHTML = short
      ? `You'd run <b>${dollars(-b.surplus)}</b> a month short, so the fast-forward would drain your savings.<span>Take-home ${dollars(b.takeHome)} vs ${parts.join(", ")}</span>`
      : `Left over each month: <b>${dollars(b.surplus)}</b><span>Take-home ${dollars(b.takeHome)} after ${parts.join(", ")}</span>`;

    const view = viewOf(player);
    const goal = this.goal();
    const tag = priceTag(goal, view, player.place.name);
    this.q("[data-tag]").innerHTML = `${tag.text}${tag.progress === null ? "" : `<div class="ff-meter" role="progressbar" aria-valuenow="${Math.round(tag.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${(tag.progress * 100).toFixed(1)}%"></i></div>`}`;

    const met = isMet(goal, view);
    const go = this.q<HTMLButtonElement>("[data-start]");
    go.disabled = met;
    go.classList.toggle("warn", this.armed && !met);
    go.textContent = met ? "You're already there 🎉" : this.armed ? "Start anyway ⏩" : "Fast-forward ⏩";
  }

  private out(key: string, text: string): void {
    const el = this.el.querySelector(`[data-out="${key}"]`);
    if (el) el.textContent = text;
  }

  private hint(key: string, html: string): void {
    const el = this.el.querySelector(`[data-hint="${key}"]`);
    if (el) el.innerHTML = html;
  }

  private onClick(ev: MouseEvent): void {
    const t = ev.target as HTMLElement;
    if (t === this.el || t.closest("[data-close]") || t.closest("[data-back]")) return this.close();
    const preset = t.closest<HTMLElement>("[data-preset]");
    if (preset) {
      this.preset = preset.dataset.preset as Preset;
      this.orders = { ...(this.preset === "recommended" ? this.recommended : this.now) };
      return this.changed();
    }
    const segBtn = t.closest<HTMLButtonElement>("button[data-v]");
    if (segBtn) {
      this.set(segBtn.dataset.k as OrderKey, segBtn.dataset.v!);
      return this.changed(true);
    }
    const card = t.closest<HTMLElement>("[data-goal]");
    if (card) return this.pickGoal(card);
    if (t.closest("[data-start]")) this.start();
  }

  private pickGoal(card: HTMLElement): void {
    if (card.getAttribute("aria-disabled") === "true" || card.dataset.goal === this.goalKind) return;
    this.goalKind = card.dataset.goal as GoalKind;
    this.changed();
  }

  private onInput(ev: Event): void {
    const t = ev.target as HTMLInputElement | HTMLSelectElement;
    const gp = t.dataset.gp;
    if (gp === "months") this.months = Number(t.value);
    else if (gp === "amount") this.amount = Number(t.value);
    else if (gp === "downPct") this.downPct = Number(t.value);
    else if (gp === "targetIncome") this.targetIncome = Number(t.value);
    if (gp) {
      const card = t.closest<HTMLElement>("[data-goal]");
      if (card) this.goalKind = card.dataset.goal as GoalKind;
      return this.changed();
    }
    if (t.dataset.cap !== undefined) {
      const age = Math.round(Number(t.value));
      if (Number.isFinite(age) && age > this.deps.player.age && age <= 90) {
        this.capAge = age;
        this.changed();
      }
      return;
    }
    const k = t.dataset.k as OrderKey | undefined;
    if (!k) return;
    this.set(k, t.value);
    this.changed(true);
  }

  private set(k: OrderKey, raw: string): void {
    const o = this.orders;
    switch (k) {
      case "k401Pct":
      case "stockPct":
        o[k] = Number(raw) / 100;
        break;
      case "depositMonthly":
      case "extraMonthly":
      case "emergencyMonths":
        o[k] = Number(raw);
        break;
      case "debtStrategy":
        o.debtStrategy = raw as Strategy;
        break;
      case "lifestyle":
        o.lifestyle = raw as Lifestyle;
        break;
      case "crashRule":
        o.crashRule = raw as CrashRule;
        break;
    }
  }

  private changed(custom = false): void {
    if (custom) this.preset = "custom";
    this.armed = false;
    this.sync();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.renderPreview(), 120);
  }

  private renderPreview(): void {
    const { player, clock } = this.deps;
    // The worker keeps reporting in after a fast-forward has replaced the setup with the result card.
    if (!this.el.querySelector("[data-chart]")) return;
    const futures = this.futures ?? (this.built >= MIN_FUTURES ? this.partial.slice(0, this.built) : null);
    if (!futures) {
      this.q("[data-chart]").innerHTML = `<div class="ff-loading">Simulating ${PREVIEW_RUNS} possible futures… ${this.built} of ${PREVIEW_RUNS}</div>`;
      this.q("[data-stats]").innerHTML = "";
      return;
    }
    const p = runPreview(player, this.orders, this.goal(), { futures, month: futureMonth(player.market.start, clock.date), capAge: this.capAge });
    this.q("[data-chart]").innerHTML = this.chart(p);
    this.q("[data-stats]").innerHTML = this.stats(p);
    this.q("[data-fine]").textContent = this.futures
      ? `The preview plays your plan in ${PREVIEW_RUNS} other possible markets. Your real run keeps its own luck.`
      : `The preview plays your plan in ${futures.length} of ${PREVIEW_RUNS} possible markets so far. Your real run keeps its own luck.`;
  }

  private stats(p: Preview): string {
    const { player, clock } = this.deps;
    const start = clock.date;
    const when = (m: number) => `${monthLabel(monthDate(start, m))} (age ${Math.floor(player.age + m / 12)})`;
    const endAge = Math.floor(player.age + p.months / 12);
    const rows: string[] = [];
    if (p.reachTypical === 0) rows.push(`<li><span class="ff-k">Goal</span><b>Already reached</b></li>`);
    else if (p.goalTiming === "relationship_unsupported")
      rows.push(`<li><span class="ff-k">Goal timing</span><b>Not estimated in this preview</b><small>Relationships can change during the real seeded run; the chart still shows what this money plan could do.</small></li>`);
    else if (p.goalTiming === "income_static")
      rows.push(`<li><span class="ff-k">Goal timing</span><b>Needs a career change or raise</b><small>This preview holds your current annual pay steady, so it cannot estimate when your income will reach the target.</small></li>`);
    else if (p.reached === 0 || p.reachTypical === null)
      rows.push(`<li class="bad"><span class="ff-k">Goal</span><b>Not reached before age ${endAge}</b><small>in any of ${p.runs} futures. Try saving more, or a smaller goal.</small></li>`);
    else
      rows.push(
        `<li><span class="ff-k">Goal reached, typically</span><b>${when(p.reachTypical)}</b><small>Bad luck (1 in 10): ${monthLabel(monthDate(start, p.reachBadLuck ?? p.reachTypical))} · reached in ${p.reached} of ${p.runs} futures</small></li>`,
      );
    const end = p.months;
    rows.push(
      `<li><span class="ff-k">Net worth at ${endAge}</span><b>${compact(p.p50[end])}</b><small>${
        this.isFlat(p) ? "The same in every future, because none of it is invested." : `Bad luck ${compact(p.p10[end])} · good luck ${compact(p.p90[end])}`
      }</small></li>`,
    );
    if (player.totalDebt() >= 0.5)
      rows.push(
        p.debtFreeMonth === null
          ? `<li class="bad"><span class="ff-k">Debt</span><b>Never paid off on this plan</b></li>`
          : `<li><span class="ff-k">Debt-free</span><b>${when(p.debtFreeMonth)}</b></li>`,
      );
    if (p.broke > 0) rows.push(`<li class="bad"><span class="ff-k">Ran out of money</span><b>${p.broke} of ${p.runs} futures</b></li>`);
    return rows.join("");
  }

  private chart(p: Preview): string {
    const start = this.deps.clock.date;
    const W = 460;
    const H = 214;
    const L = 46;
    const R = 10;
    const T = 22;
    const B = 22;
    const n = p.months;
    const goalLine = this.goalKind === "net_worth" ? this.amount : null;
    let hi = Math.max(...p.p90, goalLine ?? 0);
    let lo = Math.min(0, ...p.p10);
    if (hi - lo < 1_000) hi = lo + 1_000;
    const step = niceStep(hi - lo);
    hi = Math.ceil(hi / step) * step;
    // Only a little room below the lowest point; gridlines stay on round numbers from zero.
    if (lo < 0) lo -= (hi - lo) * 0.04;
    const flat = this.isFlat(p);
    const x = (m: number) => L + (m / n) * (W - L - R);
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const every = Math.max(1, Math.ceil(n / 160));
    const idx: number[] = [];
    for (let m = 0; m <= n; m += every) idx.push(m);
    if (idx[idx.length - 1] !== n) idx.push(n);
    const pt = (m: number, v: number) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`;
    const median = idx.map((m, i) => `${i ? "L" : "M"}${pt(m, p.p50[m])}`).join("");
    const band = `${idx.map((m, i) => `${i ? "L" : "M"}${pt(m, p.p90[m])}`).join("")}${[...idx].reverse().map((m) => `L${pt(m, p.p10[m])}`).join("")}Z`;

    const grid: string[] = [];
    for (let i = Math.ceil(lo / step); i * step <= hi + step / 2; i++) {
      const v = i * step;
      grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${i === 0 ? "zero" : "grid"}"/><text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${compact(v)}</text>`);
    }
    const years = n / 12;
    const tickEvery = years > 30 ? 10 : years > 12 ? 5 : years > 5 ? 2 : 1;
    for (let m = (12 - start.getMonth()) % 12; m <= n; m += 12) {
      const year = start.getFullYear() + Math.round((start.getMonth() + m) / 12);
      if (year % tickEvery === 0) grid.push(`<text x="${x(m).toFixed(1)}" y="${H - 6}" text-anchor="middle">${year}</text>`);
    }
    // The preset AI Boom and AI Bubble Pop (the same days in every run), with the pop's fall shaded.
    const { market } = this.deps.player;
    const today = futureMonth(market.start, start);
    const monthOf = (day: number) => futureMonth(market.start, market.dateOf(day)) - today;
    const boom = monthOf(market.presets.boomDay);
    const pop = monthOf(market.presets.popDay);
    const popEnd = monthOf(market.presets.popEndDay);
    const marker = (m: number, label: string, row: number) => {
      if (m < 0 || m > n) return "";
      const mx = x(m).toFixed(1);
      const anchor = m / n > 0.7 ? "end" : "start";
      return `<line x1="${mx}" x2="${mx}" y1="${T - 12 + row * 10}" y2="${H - B}" class="marker"/><text x="${mx}" y="${T - 14 + row * 10}" dx="${anchor === "start" ? 3 : -3}" text-anchor="${anchor}" class="marker-label">${label}</text>`;
    };
    const popZone =
      pop <= n && popEnd >= 0
        ? `<rect x="${x(Math.max(0, pop)).toFixed(1)}" y="${T}" width="${(x(Math.min(n, popEnd)) - x(Math.max(0, pop))).toFixed(1)}" height="${H - T - B}" class="pop-zone"/>`
        : "";
    const markers = marker(boom, "AI Boom", 0) + marker(pop, "AI Bubble Pop", 1);
    const goal =
      goalLine === null
        ? ""
        : `<line x1="${L}" x2="${W - R}" y1="${y(goalLine).toFixed(1)}" y2="${y(goalLine).toFixed(1)}" class="goal"/><text x="${W - R}" y="${(y(goalLine) - 4).toFixed(1)}" text-anchor="end" class="goal-label">Goal ${compact(goalLine)}</text>`;
    const reach = p.reachTypical !== null && p.reachTypical > 0 ? `<circle cx="${x(p.reachTypical).toFixed(1)}" cy="${y(p.p50[p.reachTypical]).toFixed(1)}" r="4.5" class="reach"/>` : "";

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth from now to age ${this.capAge}: the typical path and the range from bad to good luck">
      ${grid.join("")}${popZone}
      ${flat ? "" : `<path d="${band}" class="band"/>`}
      <path d="${median}" class="median"/>
      ${goal}${markers}${reach}
    </svg>
    <div class="ff-legend">${
      flat
        ? `<span><i class="sw median"></i>None of this money is invested, so the market can't grow it (or shrink it)</span>`
        : `<span><i class="sw band"></i>1-in-10 bad luck to 1-in-10 good luck</span><span><i class="sw median"></i>Typical</span>`
    }${reach ? `<span><i class="sw reach"></i>Goal reached</span>` : ""}</div>`;
  }

  /** True when every future lands in the same place: nothing is invested, so luck doesn't matter. */
  private isFlat(p: Preview): boolean {
    let spread = 0;
    for (let m = 0; m <= p.months; m++) spread = Math.max(spread, p.p90[m] - p.p10[m]);
    return spread < Math.max(500, Math.abs(p.p50[p.months]) * 0.01);
  }

  private start(): void {
    const { player, clock } = this.deps;
    if (budget(player, this.orders).surplus < 0 && !this.armed) {
      this.armed = true;
      this.sync();
      return;
    }
    applyOrders(player, this.orders);
    const result = runSkip(player, { goal: this.goal(), fromDay: clock.day, startDate: clock.date, capAge: this.capAge });
    this.deps.onFinished(result);
    // Bankruptcy pauses time (the meeting's rule).
    if (result.stoppedBy === "bankruptcy") this.resumeSpeed = 0;
    this.showResult(result);
  }

  private showResult(r: SkipResult): void {
    const { clock, player } = this.deps;
    const goal = this.goal();
    const dateOf = (day: number) => {
      const d = new Date(clock.start);
      d.setDate(d.getDate() + day);
      return d;
    };
    const when = dateOf(r.toDay).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const age = Math.floor(r.ageAtEnd);
    const head =
      r.stoppedBy === "goal"
        ? { icon: "🎉", title: r.daysRun === 0 ? "You're already there" : "Goal reached!", sub: `${when}, age ${age}.` }
        : r.stoppedBy === "bankruptcy"
          ? { icon: "⚠️", title: "Stopped: bankruptcy", sub: `${when}, age ${age}. Your debts outgrew what you could pay, so the fast-forward stopped here.` }
          : { icon: "⏳", title: `Reached age ${this.capAge} first`, sub: `${when}. The goal wasn't met on this plan.` };
    const facts: [string, string][] = [
      ["Time skipped", duration(r.daysRun)],
      ["Net worth", `${dollars(r.start.netWorth)} → ${dollars(r.end.netWorth)}`],
      ["Lowest point", `${dollars(r.low.netWorth)} in ${monthLabel(dateOf(r.low.day))}`],
      ["Bear markets", r.bearMarkets ? `${r.bearMarkets} (the market's worst fall was ${Math.round(r.worstDrop * 100)}%)` : "None"],
    ];
    const paid = r.counts.paid_off ?? 0;
    if (paid) facts.push(["Debts paid off", String(paid)]);
    if (r.stoppedBy === "goal" && (goal.kind === "marriage" || goal.kind === "status" || goal.kind === "net_worth")) {
      const score = finalScore(player, player.today);
      facts.push(["Final score", `${score.final.toFixed(1)} · retirement ${score.RR.toFixed(1)} · lifetime wellbeing ${score.Wlife.toFixed(1)}`]);
    }
    this.q("[data-body]").innerHTML = `<div class="ff-result ${r.stoppedBy}">
      <div class="ff-result-icon" aria-hidden="true">${head.icon}</div>
      <h2>${head.title}</h2>
      <p>${head.sub}</p>
      <dl class="ff-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      <button type="button" class="ff-go" data-back>Back to the city</button>
    </div>`;
    this.q<HTMLButtonElement>("[data-back]").focus();
  }
}
