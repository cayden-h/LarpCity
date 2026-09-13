// The player's phone: the hub where the game's apps live. It pulls up from the
// bottom-right corner. Stocks lists the city's funds and the HackRice sponsor
// stocks at today's game prices (tap one to open its page), the real interest
// rates the game doesn't simulate (labeled as real), and opens the
// Money desk (/debt.html) in a window over the city, sharing the city's player
// and clock through window.larpMoney. Goals opens the Goals app view (each of
// the player's permanent goals with a progress bar); the fast-forward setup
// screen (ui/skip-setup.ts) and Retire are reachable from inside it.
// Map shows where the player is. Calendar (ui/calendar.ts) shows the player's days, goes
// back to a past one, skips to the next decision, sets the clock's speed, and
// (in its year view) starts a new life. Mail, News, and Bank are the life's
// letters, the Larp City Ledger, and the Nessie bank statement (ui/phone-apps.ts).

import "./phone.css";
import { CalendarApp } from "./calendar";
import { BankApp, isBillingMail, mailHtml, NewsApp, type BankStatement, type Story } from "./phone-apps";
import { pixelIcon } from "./pixel-icons";
import type { Clock } from "../engine/clock";
import { apiFetch } from "../net/api";
import { MARKET, type SeriesId } from "../data/market";
import type { SceneStatus } from "../engine/scene";
import type { CityDef, StateInfo } from "../engine/types";
import { latest, type LifeEvent, type PlayerLife } from "../sim/life";
import type { Inbox } from "../sim/mail/inbox";
import { INSTRUMENTS, type Instrument, type InstrumentId } from "../sim/market";
import type { RunRecorder } from "../sim/record";
import type { DeskState } from "../sim/save/types";
import { isMet, priceTag, viewOf } from "../sim/skip/goals";
import type { Goal, GoalView } from "../sim/skip/types";
import { goOnVacation } from "./vacation";
import { buildEndgameScore, mountEndgame, retirementReady } from "./endgame.ts";

interface AppDef {
  id: "stocks" | "goals" | "taxes" | "map" | "calendar" | "news" | "mail" | "bank";
  name: string;
  icon: string;
  ready: boolean;
}

const APPS: AppDef[] = [
  { id: "stocks", name: "Stocks", icon: pixelIcon("stocks"), ready: true },
  { id: "goals", name: "Goals", icon: pixelIcon("goals"), ready: true },
  { id: "taxes", name: "Taxes", icon: pixelIcon("taxes"), ready: true },
  { id: "map", name: "Map", icon: pixelIcon("map"), ready: true },
  { id: "calendar", name: "Calendar", icon: pixelIcon("calendar"), ready: true },
  { id: "news", name: "News", icon: pixelIcon("news"), ready: true },
  { id: "mail", name: "Mail", icon: pixelIcon("mail"), ready: true },
  { id: "bank", name: "Bank", icon: pixelIcon("bank"), ready: true },
];

/** One title per `Goal["kind"]`, shown in the Goals app; the `Record` keeps this exhaustive as new kinds are added. */
const GOAL_TITLES: Record<Goal["kind"], string> = {
  debt_free: "Pay off all debt",
  emergency_fund: "Emergency fund",
  net_worth: "Net worth goal",
  house: "Buy a house",
  marriage: "Get married",
  status: "Income goal",
  retirement_age: "Retire early",
  debt_free_by_age: "Debt-free by a target age",
};

/** Real interest rates the game doesn't simulate: shown from the FRED snapshot and labeled as real. */
const RATES: { id: SeriesId; ticker: string; name: string }[] = [
  { id: "DFF", ticker: "FED", name: "Fed funds rate" },
  { id: "DGS10", ticker: "10Y", name: "10-year Treasury" },
  { id: "MORTGAGE30US", ticker: "30Y MTG", name: "30-year mortgage" },
];

interface WorldSnapshot {
  state: StateInfo;
  city: CityDef;
  status: SceneStatus | null;
}

const OPEN_KEY = "larp.phone.open";

function readOpen(): boolean {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    if (v !== null) return v === "1";
  } catch {
    // Storage can be blocked; fall back to the viewport rule below.
  }
  return window.innerHeight >= 640;
}

function saveOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Not important enough to surface.
  }
}

function sparkline(values: number[], up: boolean): string {
  const w = 56;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * h).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 -1 ${w} ${h + 2}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${up ? "#30d158" : "#ff453a"}" stroke-width="1.6" shape-rendering="crispEdges" stroke-linejoin="miter" stroke-linecap="square"/></svg>`;
}

const fmtIndex = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The status-bar clock: the hour follows the sky's accelerated time of day `t`,
 * but the minutes are the player's real ones, so the clock doesn't spin.
 */
function timeLabel(t: number, now = new Date()): string {
  const h = Math.floor(t * 24) % 24;
  return `${((h + 11) % 12) + 1}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export interface PhoneDeps {
  clock: Clock;
  player: PlayerLife;
  /** Opens the goal fast-forward setup screen. */
  openFastForward?: () => void;
  /** The city's run recorder, so the desk can ask the coach about the city's run. */
  recorder?: RunRecorder;
  /** Opens the U.S. map (the Map app's button). */
  openMap?: () => void;
  /** Plays the days up to `day` as a time-lapse (the Calendar's "Skip to"). */
  skipTo?: (day: number) => void;
  /** Goes back to the morning of a past day (the Calendar's "Go back"). */
  rewindTo?: (day: number) => void;
  /** Whether going back is open (only in the end-of-game review); open when not given. */
  canGoBack?: () => boolean;
  /** Opens the save slot picker (the Calendar year view's "Save slots"). */
  openSlots?: () => void;
  /** The earliest day the player can go back to. */
  firstDay?: () => number;
  /** Where the player is, for the Map app. */
  getWorld: () => WorldSnapshot;
  /** The Money desk changed something the save must keep (a payment, a trade, its feed); quiet only updates the copy. */
  changed: (desk: DeskState, o?: { quiet?: boolean }) => void;
  /** What the Money desk last reported, so it comes back when the desk opens. */
  deskState: () => DeskState | null;
  /** The Mail inbox (sim/mail). */
  mail: Inbox;
  /** A letter was read: the save must keep it read. */
  mailChanged?: () => void;
  /** Erases this life and starts over with the intake; rejects when the server can't be reached. */
  newLife: () => Promise<void>;
  /** The player opened an app with a tour (Sammy's, ui/tour.ts): its first time starts or offers it. */
  onAppOpen?: (id: "stocks" | "taxes") => void;
  /** Plays a tour again (the Stocks header's "?" and the desk's Taxes tab). */
  replayTour?: (id: "stocks" | "taxes") => void;
}

/**
 * What the Money desk (/debt.html, in the iframe) reads from the city through
 * `window.parent.larpMoney`, so it shows the city player's real money and moves
 * the city's clock instead of running a separate life.
 */
export interface MoneyHost {
  life: () => PlayerLife;
  clock: Clock;
  /** Decision events the city parked with `Phone.showDecision`, cleared as they're taken. */
  takeDecisions: () => LifeEvent[];
  /**
   * Hands events back for the next `takeDecisions()`, e.g. when the desk
   * already has a decision open and can't ask a newly arrived one yet. Does
   * not reopen the desk.
   */
  parkDecisions: (events: LifeEvent[]) => void;
  /** Calls `fn` each time the Money window is shown. */
  onShow: (fn: () => void) => void;
  /** The city's run recorder, or null when the city isn't recording. */
  recorder: () => RunRecorder | null;
  /** Calls `fn` with the day the city went back to, after each rewind. */
  onRewind: (fn: (day: number) => void) => void;
  /** The desk calls this after anything the player does, with its feed and statement, so the city saves.
   *  quiet: only keep the city's copy current (a day's paychecks and bills); the city's next save carries it. */
  changed: (desk: DeskState, o?: { quiet?: boolean }) => void;
  /** The desk's feed and statement from the save, to restore on load. */
  deskState: () => DeskState | null;
  /** The desk's "Start over": closes the desk and opens the Calendar's year view with "Start a new life" armed. */
  newLife: () => void;
  /** Replays one of Sammy's tours (the Taxes tab's "?"). */
  tour: (id: "stocks" | "taxes") => void;
  /** Calls `fn` when a tour opens or closes (the desk turns its speed buttons off meanwhile). */
  onTour: (fn: () => void) => void;
}

export class Phone {
  private readonly el: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly deps: PhoneDeps;
  /** Game day the Stocks list was drawn for; sponsor prices move with the city clock. */
  private stockDay = Number.NEGATIVE_INFINITY;
  private toastTimer = 0;
  private resumeSpeed = 1;
  /** Decision moments waiting for the desk to show them. */
  private parked: LifeEvent[] = [];
  private readonly showListeners: (() => void)[] = [];
  private readonly rewindListeners: ((day: number) => void)[] = [];
  private readonly tourListeners: (() => void)[] = [];
  private readonly calendar: CalendarApp;
  /** The letter shown open in Mail. */
  private openMail: string | null = null;
  private readonly news: NewsApp;
  private readonly bank: BankApp;
  /** The view show() last drew, so rewound() knows whether News or Bank is on screen. */
  private currentView: "home" | AppDef["id"] = "home";

  constructor(deps: PhoneDeps) {
    this.deps = deps;
    this.el = document.createElement("div");
    this.el.className = "phone";
    this.el.innerHTML = this.markup();
    document.body.appendChild(this.el);

    this.overlay = document.createElement("div");
    this.overlay.className = "desk-overlay";
    this.overlay.hidden = true;
    this.overlay.innerHTML = `<div class="desk-window" role="dialog" aria-modal="true" aria-label="Money">
      <div class="desk-bar"><span class="desk-title"><span class="desk-dot"></span>Money</span><span class="desk-hint">Your city life's money. City time is paused until you press play.</span><button class="desk-close" data-close aria-label="Close">✕</button></div>
      <iframe title="Money" loading="lazy"></iframe>
    </div>`;
    document.body.appendChild(this.overlay);
    const host: MoneyHost = {
      life: () => this.deps.player,
      clock: deps.clock,
      takeDecisions: () => this.parked.splice(0),
      parkDecisions: (events) => this.parked.push(...events),
      onShow: (fn) => this.showListeners.push(fn),
      recorder: () => this.deps.recorder ?? null,
      onRewind: (fn) => this.rewindListeners.push(fn),
      changed: (desk, o) => this.deps.changed(desk, o),
      deskState: () => this.deps.deskState(),
      newLife: () => {
        this.closeDesk();
        this.setOpen(true);
        this.show("calendar");
        this.calendar.armNewLife();
      },
      tour: (id) => this.deps.replayTour?.(id),
      onTour: (fn) => this.tourListeners.push(fn),
    };
    (window as unknown as { larpMoney?: MoneyHost }).larpMoney = host;
    this.calendar = new CalendarApp(this.q('[data-view="calendar"]'), {
      clock: deps.clock,
      life: deps.player,
      firstDay: () => deps.firstDay?.() ?? 0,
      rewindTo: (day) => deps.rewindTo?.(day),
      canGoBack: () => deps.canGoBack?.() ?? true,
      openSlots: deps.openSlots,
      skipTo: (day) => deps.skipTo?.(day),
      onHome: () => this.show("home"),
      newLife: () => deps.newLife(),
    });
    this.news = new NewsApp({
      target: this.q("[data-news]"),
      day: () => deps.clock.day,
      date: () => deps.clock.date,
      recorder: deps.recorder,
      fetchNews: (body) => apiFetch<{ stories: Story[] }>("/news", { method: "POST", body: JSON.stringify(body) }),
    });
    this.bank = new BankApp({ target: this.q("[data-bank]"), fetchStatement: () => apiFetch<BankStatement>("/bank/player") });

    this.setOpen(readOpen(), false);
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    this.overlay.addEventListener("click", (ev) => {
      if (ev.target === this.overlay || (ev.target as HTMLElement).closest("[data-close]")) this.closeDesk();
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !this.overlay.hidden) this.closeDesk();
    });

    this.renderStocks();
    this.renderMail();
    this.renderStatus();
    setInterval(() => this.renderStatus(), 1000);
  }

  private markup(): string {
    return `
      <div class="phone-body">
        <div class="phone-screen">
          <div class="island"></div>
          <div class="status">
            <span class="status-time" data-time>9:41</span>
            <span class="status-icons" aria-hidden="true">
              <svg viewBox="0 0 18 12" width="17" height="11"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>
              <svg viewBox="0 0 26 12" width="24" height="11"><rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="16" height="8" rx="1.8" fill="currentColor"/><rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" opacity=".45"/></svg>
            </span>
          </div>

          <section class="view view-home" data-view="home">
            <div class="home-clock"><div class="hc-day" data-dow></div><div class="hc-date" data-date></div></div>
            <button class="widget" data-app="stocks" aria-label="Open Stocks">
              <div class="w-top"><span class="w-name">LTM</span><span class="w-chg" data-w-chg></span></div>
              <div class="w-value" data-w-value></div>
              <div data-w-spark style="display: contents"></div>
              <div class="w-foot">Larp Total Market · in game</div>
            </button>
            <div class="app-grid" data-app-grid>
              ${this.renderApps()}
            </div>
            <div class="toast" data-toast hidden></div>
          </section>

          <section class="view view-stocks" data-view="stocks" hidden>
            <header class="st-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Stocks</div><div class="st-sub" data-st-sub></div></div>
              <button class="st-tour" data-tour-replay="stocks" aria-label="Replay Sammy's stocks tour">?</button>
            </header>
            <ul class="st-list" data-st-list></ul>
            <button class="st-open" data-desk>Open Money <span aria-hidden="true">↗</span></button>
          </section>

          <section class="view view-map-app" data-view="map" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Map</div><div class="st-sub">Your place in the country</div></div>
            </header>
            <div class="map-place-card">
              ${pixelIcon("pin", "map-place-pin")}
              <div class="map-place-copy">
                <div class="map-place-title"><strong data-map-city></strong><span class="tier" data-map-tier></span></div>
                <p data-map-tagline></p>
              </div>
            </div>
            <div class="map-place-facts">
              <span>State</span><strong data-map-state></strong>
              <span>Cost of living</span><strong data-map-cost></strong>
            </div>
            <button class="map-open-button" data-open-map>${pixelIcon("map")} Open U.S. map</button>
          </section>

          <section class="view view-calendar" data-view="calendar" hidden></section>

          <section class="view view-app view-mail" data-view="mail" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Mail</div><div class="st-sub">Letters about your money</div></div>
            </header>
            <ul class="app-scroll mail-list" data-mail-list></ul>
          </section>

          <section class="view view-app view-goals" data-view="goals" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Goals</div><div class="st-sub">Set once, for the whole run</div></div>
            </header>
            <ul class="app-scroll goals-list" data-goals-list></ul>
            <button class="goals-ff-open" data-open-ff>Fast-forward to a goal <span aria-hidden="true">↗</span></button>
            <button class="goals-vacation-open" data-vacation>Go on vacation <span aria-hidden="true">✈️</span></button>
            <button class="goals-retire-open" data-retire disabled>Retire <span aria-hidden="true">🏖️</span></button>
          </section>

          <section class="view view-app view-news" data-view="news" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">The Ledger</div><div class="st-sub">Larp City's newspaper</div></div>
            </header>
            <div class="app-scroll news-body" data-news></div>
          </section>

          <section class="view view-app view-bank" data-view="bank" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Bank</div><div class="st-sub">Capital One Nessie statement</div></div>
            </header>
            <div class="app-scroll bank-body" data-bank></div>
          </section>

          <button class="home-bar" data-home aria-label="Go home"></button>
        </div>
      </div>
      <button class="phone-toggle-zone" data-toggle aria-label="Put the phone away"></button>`;
  }

  /** The home screen's app grid, redrawn from `markup()` and again from `renderStatus()` so the Taxes badge tracks `pendingTaxReturn()` live. */
  private renderApps(): string {
    return APPS.map(
      (a) => `<button class="app${a.ready ? "" : " soon"}" data-app="${a.id}" aria-label="${a.name}${a.ready ? "" : " (coming soon)"}">
        <span class="app-icon">${a.icon}</span>
        <span class="app-name">${a.name}</span>
        ${a.ready ? `<span class="app-badge count" data-badge="${a.id}" hidden></span>` : `<span class="app-badge">Soon</span>`}
        ${a.id === "taxes" && this.deps.player.pendingTaxReturn() ? `<span class="app-badge app-badge-alert">File</span>` : ""}
      </button>`,
    ).join("");
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  private setOpen(open: boolean, remember = true) {
    this.el.classList.toggle("open", open);
    this.el.classList.toggle("closed", !open);
    this.q<HTMLButtonElement>("[data-toggle]").ariaLabel = open ? "Put the phone away" : "Show phone";
    if (remember) saveOpen(open);
  }

  private show(view: "home" | AppDef["id"]) {
    this.currentView = view;
    this.el.querySelectorAll<HTMLElement>("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== view));
    if (view === "calendar") this.calendar.show();
    else this.calendar.hide();
    // An answer still on its way to an app the player left isn't drawn into it.
    if (view !== "news") this.news.leave();
    if (view !== "bank") this.bank.leave();
  }

  private toast(text: string) {
    const t = this.q("[data-toast]");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), 1800);
  }

  private onClick(ev: MouseEvent) {
    if (this.el.classList.contains("closed")) {
      this.setOpen(true);
      return;
    }
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("button");
    if (!btn) return;
    if (btn.dataset.toggle !== undefined) return this.setOpen(!this.el.classList.contains("open"));
    if (btn.dataset.home !== undefined) return this.show("home");
    if (btn.dataset.desk !== undefined) return this.openDesk();
    if (btn.dataset.stock) return this.openDesk(btn.dataset.stock);
    if (btn.dataset.tourReplay) return this.deps.replayTour?.(btn.dataset.tourReplay as "stocks");
    if (btn.dataset.openMap !== undefined) return this.deps.openMap?.();
    if (btn.dataset.mailId) return this.toggleMail(btn.dataset.mailId);
    if (btn.dataset.newsRetry !== undefined) return void this.news.load();
    if (btn.dataset.openFf !== undefined) return this.deps.openFastForward?.();
    if (btn.dataset.vacation !== undefined) {
      if (!goOnVacation(this.deps.player, this.deps.clock.day)) this.toast("Already relaxed. Take another vacation later.");
      return;
    }
    if (btn.dataset.retire !== undefined) return this.onRetire();
    const id = btn.dataset.app as AppDef["id"] | undefined;
    if (!id) return;
    const app = APPS.find((a) => a.id === id)!;
    if (!app.ready) return this.toast(`${app.name} is coming soon`);
    if (id === "taxes") {
      this.openDesk(undefined, "taxes");
      return this.deps.onAppOpen?.("taxes");
    }
    this.show(id);
    if (id === "stocks") this.deps.onAppOpen?.("stocks");
    if (id === "mail") this.renderMail();
    if (id === "news") void this.news.load();
    if (id === "bank") void this.bank.load();
    if (id === "goals") this.renderGoals();
  }

  /** The Goals app: the 4 permanent goals set once at intake, each with a progress bar. */
  private renderGoals(): void {
    const life = this.deps.player;
    const view = viewOf(life);
    const list = this.q("[data-goals-list]");
    list.innerHTML = life.goals.length
      ? life.goals.map((g) => this.goalItem(g, view)).join("")
      : `<li class="app-empty">No goals set yet.</li>`;
    // Retirement readiness changes over the run, so re-check on every open rather than once.
    this.q<HTMLButtonElement>("[data-retire]").disabled = !retirementReady(life, life.goals, view, life.age);
  }

  /** Retiring is a one-way action: pause the clock (like the Money desk) and show the final score. */
  private onRetire(): void {
    this.resumeSpeed = this.deps.clock.speed || this.resumeSpeed;
    this.deps.clock.speed = 0;
    const score = buildEndgameScore(this.deps.player, Math.floor(this.deps.player.age), this.deps.player.today);
    mountEndgame(document.body, { score });
  }

  private goalItem(goal: Goal, view: GoalView): string {
    const life = this.deps.player;
    const tag = priceTag(goal, view, life.place.name, life.age);
    const title = GOAL_TITLES[goal.kind];
    const met = isMet(goal, view, life.age);
    return `<li class="goals-item${met ? " met" : ""}">
      <div class="goals-item-title">${title}${met ? " ✓" : ""}</div>
      <div class="goals-item-text">${tag.text}</div>
      ${tag.progress === null ? "" : `<div class="ff-meter" role="progressbar" aria-valuenow="${Math.round(tag.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${(tag.progress * 100).toFixed(1)}%"></i></div>`}
    </li>`;
  }

  /**
   * A decision moment in the city (a crash, a payment the player can't cover,
   * bankruptcy): parks the events for the desk and opens it, which pauses the
   * clock. The desk takes them when it's shown, or when it first loads.
   */
  showDecision(events: LifeEvent[]) {
    this.parked.push(...events);
    this.openDesk();
    // A decision moment keeps the city paused until the player presses play.
    this.resumeSpeed = 0;
  }

  /**
   * The city went back to the morning of `day`: decisions parked on the path
   * it left are dropped, the desk trims what it showed, the calendar moves to
   * that day, and a decision that day had opens again.
   */
  rewound(day: number, decisions: LifeEvent[]) {
    this.parked = [];
    for (const fn of this.rewindListeners) fn(day);
    this.calendar.rewound(day);
    // The inbox already dropped the letters after `day` (main.ts); the Ledger's days changed too,
    // and the bank statement is being posted again from here.
    this.news.rewound();
    this.bank.leave();
    // A News or Bank view left on screen through the rewind is showing stale, or still-loading, content: reload it.
    if (this.currentView === "news") void this.news.load();
    if (this.currentView === "bank") void this.bank.load();
    this.renderMail();
    if (decisions.length) this.showDecision(decisions);
  }

  // ---- For Sammy's tours (ui/tour.ts) ----

  /** Pulls the phone up on an app (or the home screen). */
  openApp(view: "home" | AppDef["id"]): void {
    this.setOpen(true, false);
    this.show(view);
  }

  /** Opens the Money window on a tab or a stock's page. */
  openMoney(o: { tab?: string; stock?: string }): void {
    this.openDesk(o.stock, o.tab);
  }

  closeMoney(): void {
    if (!this.overlay.hidden) this.closeDesk();
  }

  deskFrame(): HTMLIFrameElement {
    return this.overlay.querySelector("iframe")!;
  }

  /** The Money desk's document while the window is open and loaded (same origin), or null. */
  deskDocument(): Document | null {
    if (this.overlay.hidden) return null;
    try {
      return this.deskFrame().contentDocument;
    } catch {
      return null;
    }
  }

  /** A tour opened or closed: the calendar and the desk redraw their speed buttons. */
  tourChanged(active: boolean): void {
    void active;
    this.calendar.refresh();
    for (const fn of this.tourListeners) fn();
  }

  private dateOf(day: number): Date {
    const d = new Date(this.deps.clock.start);
    d.setDate(d.getDate() + day);
    return d;
  }

  /** Opens a letter (marking it read) or closes the open one. */
  private toggleMail(id: string) {
    this.openMail = this.openMail === id ? null : id;
    const unread = this.deps.mail.items.some((m) => m.id === id && !m.read);
    this.deps.mail.markRead(id);
    if (unread) this.deps.mailChanged?.();
    this.renderMail();
  }

  /** Redraws the inbox and the unread badge; main.ts calls it when new mail arrives. */
  renderMail() {
    const { mail } = this.deps;
    if (this.openMail && !mail.items.some((m) => m.id === this.openMail)) this.openMail = null;
    const billing = mail.items.filter(isBillingMail);
    const list = this.q("[data-mail-list]");
    const scroll = list.scrollTop;
    list.innerHTML = mailHtml(billing, this.openMail, (d) => this.dateOf(d));
    list.scrollTop = scroll;
    const badge = this.q("[data-badge=mail]");
    // Counts only the billing mail actually shown, so the badge and the visible list agree.
    const n = billing.filter((m) => !m.read).length;
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = n === 0;
    this.q("[data-app=mail]").ariaLabel = n ? `Mail, ${n} unread` : "Mail";
  }

  /** Opens the Money window, on a stock's page when `stock` is given (#stock=ID) or a specific tab when `tab` is given (#tab=ID). */
  private openDesk(stock?: string, tab?: string) {
    const frame = this.overlay.querySelector("iframe")!;
    const hash = stock ? `#stock=${stock}` : tab ? `#tab=${tab}` : "";
    // Until the desk has loaded, its window is the frame's first blank page: setting the hash there
    // would replace the load of /debt.html with about:blank, so start the load over with the hash instead.
    const loaded = (() => {
      try {
        return frame.contentWindow?.location.pathname.endsWith("/debt.html") ?? false;
      } catch {
        return false;
      }
    })();
    if (!frame.src || (!loaded && hash)) frame.src = `/debt.html${hash}`;
    else if (hash && loaded) frame.contentWindow!.location.hash = hash.slice(1);
    this.resumeSpeed = this.deps.clock.speed || this.resumeSpeed;
    this.deps.clock.speed = 0;
    this.overlay.hidden = false;
    this.overlay.querySelector<HTMLButtonElement>("[data-close]")!.focus();
    for (const fn of this.showListeners) fn();
  }

  private closeDesk() {
    this.overlay.hidden = true;
    this.deps.clock.speed = this.resumeSpeed;
  }

  private renderStatus() {
    const { clock } = this.deps;
    this.q("[data-time]").textContent = timeLabel(clock.timeOfDay);
    const d = clock.date;
    this.q("[data-dow]").textContent = d.toLocaleDateString("en-US", { weekday: "long" });
    this.q("[data-date]").textContent = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    const { state, city } = this.deps.getWorld();
    this.q("[data-map-city]").textContent = `${city.name}, ${state.abbr}`;
    const tier = this.q("[data-map-tier]");
    tier.textContent = state.tier;
    tier.className = `tier ${state.tier.toLowerCase()}`;
    this.q("[data-map-tagline]").textContent = city.tagline;
    this.q("[data-map-state]").textContent = state.name;
    this.q("[data-map-cost]").textContent = `${state.rpp.all.toFixed(1)} · ${state.tier}`;
    this.calendar.refresh();
    // Sponsor prices move with the city clock, so redraw once per game day.
    if (clock.day !== this.stockDay) this.renderStocks();
    // The Taxes badge tracks pendingTaxReturn(), which can flip as the city plays.
    this.q("[data-app-grid]").innerHTML = this.renderApps();
  }

  /** An instrument on the city player's market: today's close, the move since the last trading day, and about six weeks of closes. */
  private quote(id: InstrumentId): { px: number; chg: number; pts: number[]; tone: "up" | "down" | "flat" } {
    const market = this.deps.player.market;
    const day = this.deps.clock.day;
    const trading = (d: number) => ![0, 6].includes(market.dateOf(d).getDay());
    let today = day;
    while (!trading(today)) today--;
    let prev = today - 1;
    while (!trading(prev)) prev--;
    const px = market.price(id, today);
    const chg = px / market.price(id, prev) - 1;
    const pts = market.series(id, day - 42, day).filter((p) => trading(p.day)).map((p) => p.value);
    return { px, chg, pts, tone: Math.abs(chg) < 1e-6 ? "flat" : chg > 0 ? "up" : "down" };
  }

  private instrumentRows(list: readonly Instrument[]): string[] {
    return list.map((i) => {
      const { px, chg, pts, tone } = this.quote(i.id);
      return `<button class="st-row link" data-stock="${i.id}" aria-label="${i.name}: open in Money"><div class="st-name"><b>${i.id}</b><span>${i.name}${i.listed === false ? " · private" : ""}</span></div>${sparkline(pts, pts[pts.length - 1] >= pts[0])}<div class="st-right"><span class="st-px">$${fmtIndex(px)}</span><span class="st-pill ${tone}">${chg >= 0 ? "+" : "−"}${Math.abs(chg * 100).toFixed(2)}%</span></div></button>`;
    });
  }

  private renderStocks() {
    this.stockDay = this.deps.clock.day;
    // data-tour groups each section with its rows, so Sammy's tour spotlights them as one.
    const item = (row: string, tour: string) => `<li class="st-item" data-tour="${tour}">${row}</li>`;
    const sec = (title: string, note: string, tour: string) => `<li class="st-sec" data-tour="${tour}"><span>${title}</span><span>${note}</span></li>`;
    const rates = RATES.map((r) => {
      const l = latest(r.id);
      const pts = MARKET.series[r.id].points.slice(-60).map((p) => p[1]);
      const up = l.change >= 0;
      return `<div class="st-row"><div class="st-name"><b>${r.ticker}</b><span>${r.name}</span></div>${sparkline(pts, pts[pts.length - 1] >= pts[0])}<div class="st-right"><span class="st-px">${l.value.toFixed(2)}%</span><span class="st-pill ${up ? "up" : "down"}">${up ? "+" : "−"}${Math.abs(l.change * 100).toFixed(0)} bp</span></div></div>`;
    });
    const asOf = new Date(`${MARKET.asOf}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    this.q("[data-st-list]").innerHTML = [
      sec("Funds and stocks", "In game", "st-market"),
      ...this.instrumentRows(INSTRUMENTS.filter((i) => !i.sponsor)).map((r) => item(r, "st-market")),
      // "In game" (not "Game prices") so the full title fits on the phone's 192px row.
      sec("HackRice sponsors", "In game", "st-sponsors"),
      ...this.instrumentRows(INSTRUMENTS.filter((i) => i.sponsor)).map((r) => item(r, "st-sponsors")),
      sec("Real rates", `FRED, ${asOf}`, "st-rates"),
      ...rates.map((r) => item(r, "st-rates")),
    ].join("");
    this.q("[data-st-sub]").textContent = `Larp City, ${this.deps.clock.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

    const ltm = this.quote("LTM");
    const chg = this.q("[data-w-chg]");
    chg.textContent = `${ltm.chg >= 0 ? "+" : "−"}${Math.abs(ltm.chg * 100).toFixed(2)}%`;
    chg.className = `w-chg ${ltm.chg >= 0 ? "up" : "down"}`;
    this.q("[data-w-value]").textContent = `$${fmtIndex(ltm.px)}`;
    this.q("[data-w-spark]").innerHTML = sparkline(ltm.pts, ltm.pts[ltm.pts.length - 1] >= ltm.pts[0]).replace(
      'width="56" height="22"',
      'width="100%" height="34" preserveAspectRatio="none"',
    );
  }
}
