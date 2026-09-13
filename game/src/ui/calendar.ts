// The phone's Calendar app: Google Calendar's month view in the pixel theme.
// Past days are light and tappable, today is the blue square, and future days
// are grayed out. Red chips are money days and things that happen to the
// player; blue chips are what they chose. A future day shows only scheduled
// money, plus a yellow "?" on the next decision day, which never says what the
// decision is. Tapping a day opens a small sheet: a past day can be gone back
// to (a real rewind, sim/rewind), and the decision day can be skipped to. The
// back arrow zooms out to the year; tapping a year there switches years.
// Design: docs/superpowers/specs/2026-09-12-phone-calendar-design.md.

import "./calendar.css";
import type { Clock } from "../engine/clock";
import { marksFor, nextDecisionDay, scheduleFor, type Mark } from "../sim/calendar";
import type { LifeEvent, PlayerLife } from "../sim/life";

export interface CalendarDeps {
  clock: Clock;
  life: PlayerLife;
  /** The earliest day the player can go back to. */
  firstDay: () => number;
  /** Goes back to the morning of a past day. */
  rewindTo: (day: number) => void;
  /** Plays the days up to a future day as a time-lapse. */
  skipTo: (day: number) => void;
  /** The year view's back arrow: the phone's home screen. */
  onHome: () => void;
  /** Erases this life and starts over with the intake (the year view's "Start a new life"); rejects when the server can't be reached. */
  newLife?: () => Promise<void>;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_MS = 86_400_000;
/** How long "Start a new life" stays armed for the second tap. */
const NEW_LIFE_ARM_MS = 4000;
/** Chips a month cell has room for; more collapse into "+n". */
const MAX_CHIPS = 2;
const SPEEDS: { speed: number; label: string; name: string }[] = [
  { speed: 0, label: "Ⅱ", name: "Pause" },
  { speed: 1, label: "1×", name: "Normal speed" },
  { speed: 2, label: "2×", name: "Double speed" },
];

type Kind = "pre" | "past" | "today" | "future";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number, signed = true) =>
  `${n < 0 ? "−" : signed && n > 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long" });
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
/** "in 9 days", "in 5 months", "in 2 years": exact up close, rounder farther out. */
const howFar = (days: number) =>
  `in ${days <= 60 ? plural(days, "day") : days <= 540 ? plural(Math.round(days / 30.44), "month") : plural(Math.round(days / 365.25), "year")}`;

export class CalendarApp {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly liveEl: HTMLElement;
  private readonly deps: CalendarDeps;
  private mode: "month" | "year" = "month";
  private year: number;
  private month: number;
  /** The day whose sheet is open. */
  private selected: number | null = null;
  private drawn = "";
  /** The log's events by day, built as the log grows; a rewind that cuts the log starts it over. */
  private readonly byDay = new Map<number, LifeEvent[]>();
  private indexed = 0;
  private lastIndexed: LifeEvent | undefined;
  private forecast = { key: "", day: null as number | null };
  private toastTimer = 0;
  /** "Start a new life" asks twice: the first tap arms it, the second erases. */
  private erase: "idle" | "armed" | "erasing" = "idle";
  private eraseTimer = 0;

  constructor(root: HTMLElement, deps: CalendarDeps) {
    this.root = root;
    this.deps = deps;
    const d = deps.clock.date;
    this.year = d.getFullYear();
    this.month = d.getMonth();
    // The live region stays put across redraws (a new one isn't announced), so screen readers hear "Start a new life" arm.
    root.innerHTML = `<div class="cal-body" data-cal-body></div><div class="cal-toast" data-cal-toast role="status" hidden></div><span class="cal-live" data-cal-live aria-live="polite"></span>`;
    this.body = root.querySelector("[data-cal-body]")!;
    this.toastEl = root.querySelector("[data-cal-toast]")!;
    this.liveEl = root.querySelector("[data-cal-live]")!;
    root.addEventListener("click", (ev) => this.onClick(ev));
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.selected !== null) {
        ev.stopPropagation();
        this.select(null);
      }
    });
  }

  /** Opens on the current month. */
  show(): void {
    this.disarm();
    this.goToMonthOf(this.deps.clock.day);
    this.mode = "month";
    this.selected = null;
    this.render();
  }

  /** Redraws when anything it shows changed (the day, the log, the speed). Cheap enough to call every second. */
  refresh(): void {
    if (this.root.hidden) return;
    if (this.stateKey() !== this.drawn) this.render();
  }

  /** After a rewind: the month of the day the player went back to, with a note that time is paused. */
  rewound(day: number): void {
    this.disarm();
    this.goToMonthOf(day);
    this.mode = "month";
    this.selected = null;
    this.render();
    const d = this.dateOf(day);
    this.toast(`Back to ${weekday(d)}, ${short(d)}. Press play when you're ready.`);
  }

  /** The phone showed another app: an armed "Start a new life" doesn't wait for the player to come back. */
  hide(): void {
    this.disarm();
  }

  /** The Money desk's "Start over": the year view with "Start a new life" already armed, so one more tap erases. */
  armNewLife(): void {
    this.mode = "year";
    this.year = this.deps.clock.date.getFullYear();
    this.selected = null;
    this.arm();
  }

  // ---- Data ------------------------------------------------------------------

  private dateOf(day: number): Date {
    const d = new Date(this.deps.clock.start);
    d.setDate(d.getDate() + day);
    return d;
  }

  /** The game day of a calendar date (rounded, so daylight saving's hour doesn't matter). */
  private dayOf(date: Date): number {
    return Math.round((date.getTime() - this.deps.clock.start.getTime()) / DAY_MS);
  }

  private goToMonthOf(day: number): void {
    const d = this.dateOf(day);
    this.year = d.getFullYear();
    this.month = d.getMonth();
  }

  private kind(day: number): Kind {
    const today = this.deps.clock.day;
    if (day < Math.max(0, this.deps.firstDay())) return "pre";
    return day < today ? "past" : day === today ? "today" : "future";
  }

  private eventsOn(day: number): LifeEvent[] {
    const log = this.deps.life.log;
    if (this.indexed > log.length || (this.indexed > 0 && log[this.indexed - 1] !== this.lastIndexed)) {
      this.byDay.clear();
      this.indexed = 0;
    }
    for (; this.indexed < log.length; this.indexed++) {
      const e = log[this.indexed];
      const list = this.byDay.get(e.day);
      if (list) list.push(e);
      else this.byDay.set(e.day, [e]);
    }
    this.lastIndexed = log[log.length - 1];
    return this.byDay.get(day) ?? [];
  }

  private marksOn(day: number, kind: Kind): Mark[] {
    if (kind === "pre") return [];
    if (kind === "future") return scheduleFor(this.deps.life, day, this.dateOf(day));
    return marksFor(this.eventsOn(day), this.deps.life);
  }

  /** The next decision day, recomputed only when the life moved or the player acted. */
  private decisionDay(): number | null {
    const { life } = this.deps;
    const key = `${life.today}:${life.log.length}`;
    if (this.forecast.key !== key) this.forecast = { key, day: nextDecisionDay(life, (d) => this.dateOf(d)) };
    return this.forecast.day;
  }

  private netWorthOn(day: number): number | null {
    const { life } = this.deps;
    if (day === this.deps.clock.day) return life.netWorth();
    const h = life.history;
    let lo = 0;
    let hi = h.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (h[mid].day === day) return h[mid].netWorth;
      if (h[mid].day < day) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** Months the player can page between, as year * 12 + month: from the start to next December, or the decision day's month if later. */
  private bounds(): { min: number; max: number } {
    const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
    const decision = this.decisionDay();
    const reach = decision === null ? 0 : monthIndex(this.dateOf(decision));
    return { min: monthIndex(this.deps.clock.start), max: Math.max((this.deps.clock.date.getFullYear() + 1) * 12 + 11, reach) };
  }

  private stateKey(): string {
    const { clock, life } = this.deps;
    return `${clock.day}:${life.log.length}:${clock.speed}:${this.mode}:${this.year}:${this.month}:${this.selected}:${this.erase}`;
  }

  // ---- Drawing ---------------------------------------------------------------

  private render(): void {
    this.drawn = this.stateKey();
    this.body.innerHTML = this.mode === "month" ? this.monthHtml() : this.yearHtml();
    // Keep the chosen year in view in the sideways year row.
    const years = this.body.querySelector<HTMLElement>(".cal-years");
    const on = years?.querySelector<HTMLElement>(".on");
    if (years && on) years.scrollLeft = on.offsetLeft - (years.clientWidth - on.offsetWidth) / 2;
    this.body.querySelector<HTMLElement>(".cal-sheet .cal-action, .cal-sheet")?.focus({ preventScroll: true });
  }

  private monthHtml(): string {
    const { min, max } = this.bounds();
    const at = this.year * 12 + this.month;
    const first = new Date(this.year, this.month, 1);
    const lead = first.getDay();
    const days = new Date(this.year, this.month + 1, 0).getDate();
    const cells = Math.ceil((lead + days) / 7) * 7;
    const decision = this.decisionDay();
    let grid = "";
    for (let i = 0; i < cells; i++) {
      const date = new Date(this.year, this.month, 1 - lead + i);
      if (date.getMonth() !== this.month) {
        grid += `<div class="cal-d out" aria-hidden="true"><span class="cal-n">${date.getDate()}</span></div>`;
        continue;
      }
      const day = this.dayOf(date);
      const kind = this.kind(day);
      if (kind === "pre") {
        grid += `<div class="cal-d pre"><span class="cal-n">${date.getDate()}</span></div>`;
        continue;
      }
      const marks = this.marksOn(day, kind);
      let chips: string;
      if (day === decision) chips = `<span class="cal-chip dec">?</span>`;
      else {
        const shown = marks.length > MAX_CHIPS ? [...marks.slice(0, MAX_CHIPS - 1)] : marks;
        chips = shown.map((m) => `<span class="cal-chip ${m.tone}">${esc(m.chip)}</span>`).join("");
        if (marks.length > MAX_CHIPS) chips += `<span class="cal-chip more">+${marks.length - shown.length}</span>`;
      }
      const label = [date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), kind === "today" ? "today" : "", day === decision ? "a decision is coming" : "", ...marks.map((m) => m.chip)]
        .filter(Boolean)
        .join(", ");
      grid += `<button class="cal-d ${kind}${day === this.selected ? " sel" : ""}" data-day="${day}" aria-label="${esc(label)}"><span class="cal-n">${date.getDate()}</span>${chips}</button>`;
    }
    const speed = this.deps.clock.speed;
    return `
      <header class="phone-app-head cal-head">
        <button class="st-back" data-cal-zoom aria-label="Year view">‹</button>
        <div><div class="st-title">${MONTHS[this.month]}</div><div class="st-sub">${this.year}</div></div>
        <div class="cal-nav">
          <button data-cal-step="-1" aria-label="Previous month" ${at <= min ? "disabled" : ""}>‹</button>
          <button data-cal-step="1" aria-label="Next month" ${at >= max ? "disabled" : ""}>›</button>
        </div>
      </header>
      <div class="cal-dow" aria-hidden="true">${["S", "M", "T", "W", "T", "F", "S"].map((c) => `<span>${c}</span>`).join("")}</div>
      <div class="cal-grid">${grid}</div>
      <div class="cal-speeds">${SPEEDS.map((s) => `<button data-cal-speed="${s.speed}" class="${s.speed === speed ? "on" : ""}" aria-label="${s.name}" aria-pressed="${s.speed === speed}">${s.label}</button>`).join("")}</div>
      ${this.selected !== null ? this.sheetHtml(this.selected, decision) : ""}`;
  }

  private sheetHtml(day: number, decision: number | null): string {
    const kind = this.kind(day);
    const date = this.dateOf(day);
    const title = date.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(date.getFullYear() !== this.deps.clock.date.getFullYear() ? { year: "numeric" } : {}) });
    const row = (tone: string, text: string, amount?: number, signed = true) =>
      `<div class="cal-row"><span class="cal-dot ${tone}"></span><span class="cal-text">${esc(text)}</span>${amount === undefined ? "" : `<span class="cal-amt ${signed ? (amount > 0 ? "pos" : amount < 0 ? "neg" : "") : ""}">${money(amount, signed)}</span>`}</div>`;
    let kicker: string;
    let content: string;
    let action = "";
    if (kind === "future" && day === decision) {
      kicker = `${weekday(date)} · ${howFar(day - this.deps.clock.day)}`;
      content = `<div class="cal-mystery"><span class="cal-q">?</span><span>Something will need your call this day. You'll find out what when you get there.</span></div>`;
      action = `<button class="cal-action" data-cal-skip="${day}">Skip to ${short(date)}</button>`;
    } else if (kind === "future") {
      kicker = `${weekday(date)} · coming up`;
      const marks = this.marksOn(day, kind);
      const checking = this.deps.life.ledger.accounts.get("checking")?.balance ?? 0;
      content = `<div class="cal-rows">${marks.length ? marks.map((m) => row(m.tone, m.text, m.amount)).join("") : row("", "Nothing scheduled")}${row("", "Checking now", checking, false)}</div>`;
    } else {
      kicker = kind === "today" ? "Today" : weekday(date);
      const marks = this.marksOn(day, kind);
      const worth = this.netWorthOn(day);
      content = `<div class="cal-rows">${marks.length ? marks.map((m) => row(m.tone, m.text, m.amount)).join("") : row("", "A quiet day")}${worth === null ? "" : row("", kind === "today" ? "Net worth now" : "Net worth that night", worth, false)}</div>`;
      if (kind === "past") action = `<button class="cal-action" data-cal-go="${day}">Go back to ${short(date)}</button>`;
    }
    return `
      <button class="cal-dim" data-cal-close aria-label="Close"></button>
      <div class="cal-sheet" role="dialog" aria-label="${esc(title)}" tabindex="-1">
        <button class="cal-grab" data-cal-close aria-label="Close"></button>
        <div class="cal-kicker">${esc(kicker)}</div>
        <h3>${esc(title)}</h3>
        ${content}
        ${action}
      </div>`;
  }

  private yearHtml(): string {
    const { min, max } = this.bounds();
    const firstYear = Math.floor(min / 12);
    const lastYear = Math.floor(max / 12);
    const thisYear = this.deps.clock.date.getFullYear();
    const today = this.deps.clock.day;
    const decision = this.decisionDay();
    let years = "";
    for (let y = firstYear; y <= lastYear; y++) {
      years += `<button class="${y === this.year ? "on" : ""}${y > thisYear ? " fut" : ""}" data-cal-pick="${y}" aria-pressed="${y === this.year}">${y}</button>`;
    }
    let minis = "";
    for (let m = 0; m < 12; m++) {
      const lead = new Date(this.year, m, 1).getDay();
      const days = new Date(this.year, m + 1, 0).getDate();
      let g = "<i class=\"e\"></i>".repeat(lead);
      for (let d = 1; d <= days; d++) {
        const day = this.dayOf(new Date(this.year, m, d));
        const kind = this.kind(day);
        let c = "";
        if (kind === "today") c = "t";
        else if (day === decision) c = "y";
        else if (kind !== "pre") {
          const marks = this.marksOn(day, kind);
          if (marks.some((x) => x.tone === "blue")) c = "b";
          else if (marks.length) c = "r";
          else if (kind === "past") c = "p";
        }
        g += `<i class="${c}"></i>`;
      }
      const monthStart = this.dayOf(new Date(this.year, m, 1));
      const monthIndex = this.year * 12 + m;
      const current = this.year === thisYear && m === this.deps.clock.date.getMonth();
      const usable = monthIndex >= min && monthIndex <= max;
      minis += `<button class="cal-mini${monthStart > today ? " fut" : ""}${current ? " cur" : ""}" data-cal-month="${m}" aria-label="${MONTHS[m]} ${this.year}" ${usable ? "" : "disabled"}><h4>${MONTHS[m].slice(0, 3)}</h4><div class="g">${g}</div></button>`;
    }
    return `
      <header class="phone-app-head cal-head">
        <button class="st-back" data-cal-home aria-label="Back to home">‹</button>
        <div><div class="st-title">Calendar</div><div class="st-sub">Tap a month</div></div>
      </header>
      <div class="cal-years">${years}</div>
      <div class="cal-year">${minis}</div>
      ${this.deps.newLife ? this.newLifeHtml() : ""}`;
  }

  private newLifeHtml(): string {
    const label = { idle: "Start a new life", armed: "Tap again to erase this life", erasing: "Erasing…" }[this.erase];
    return `<button class="cal-new-life${this.erase === "idle" ? "" : " armed"}" data-cal-new-life ${this.erase === "erasing" ? "disabled" : ""}>${label}</button>`;
  }

  // ---- Input -----------------------------------------------------------------

  private select(day: number | null): void {
    this.selected = day;
    this.render();
  }

  private onClick(ev: MouseEvent): void {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("button");
    if (!btn || !this.root.contains(btn)) return;
    const data = btn.dataset;
    if (data.day !== undefined) {
      const day = Number(data.day);
      return this.select(this.selected === day ? null : day);
    }
    if (data.calClose !== undefined) return this.select(null);
    if (data.calGo !== undefined) {
      this.deps.rewindTo(Number(data.calGo));
      return;
    }
    if (data.calSkip !== undefined) {
      this.selected = null;
      this.deps.skipTo(Number(data.calSkip));
      this.render();
      return;
    }
    if (data.calStep !== undefined) {
      const { min, max } = this.bounds();
      const at = Math.min(max, Math.max(min, this.year * 12 + this.month + Number(data.calStep)));
      this.year = Math.floor(at / 12);
      this.month = at % 12;
      this.selected = null;
      return this.render();
    }
    if (data.calZoom !== undefined) {
      this.mode = "year";
      this.selected = null;
      return this.render();
    }
    if (data.calHome !== undefined) return this.deps.onHome();
    if (data.calPick !== undefined) {
      this.year = Number(data.calPick);
      return this.render();
    }
    if (data.calMonth !== undefined) {
      this.disarm();
      this.month = Number(data.calMonth);
      this.mode = "month";
      return this.render();
    }
    if (data.calNewLife !== undefined) return this.onNewLife();
    if (data.calSpeed !== undefined) {
      this.deps.clock.speed = Number(data.calSpeed);
      return this.render();
    }
  }

  private arm(): void {
    this.erase = "armed";
    clearTimeout(this.eraseTimer);
    this.eraseTimer = window.setTimeout(() => {
      this.erase = "idle";
      this.liveEl.textContent = "";
      this.render();
    }, NEW_LIFE_ARM_MS);
    this.liveEl.textContent = "Tap Start a new life again to erase this life.";
    this.render();
  }

  /** Leaving the year view drops an armed "Start a new life" (an erase in progress carries on). */
  private disarm(): void {
    if (this.erase !== "armed") return;
    clearTimeout(this.eraseTimer);
    this.erase = "idle";
    this.liveEl.textContent = "";
  }

  private onNewLife(): void {
    if (this.erase === "erasing" || !this.deps.newLife) return;
    if (this.erase === "idle") return this.arm();
    clearTimeout(this.eraseTimer);
    this.erase = "erasing";
    this.liveEl.textContent = "Erasing this life…";
    this.render();
    this.deps.newLife().catch(() => {
      this.erase = "idle";
      this.liveEl.textContent = "";
      this.render();
      this.toast("Can't reach the server. This life is still here.");
    });
  }

  private toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), 3200);
  }
}
