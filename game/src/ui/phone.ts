// The player's phone: the hub where the game's apps live. It pulls up from the
// bottom-right corner. Stocks lists the HackRice sponsor stocks at today's game
// prices (tap one to open its page), then the market from the FRED snapshot
// (plus live Alpha Vantage quotes when the dev server has a key), and opens the
// Money desk (/debt.html) in a window over the city, sharing the city's player
// and clock through window.larpMoney. Goals opens the fast-forward setup screen
// (ui/skip-setup.ts). Map and Weather show where the player is and the city's
// weather and season. Calendar (ui/calendar.ts) shows the player's days, goes
// back to a past one, skips to the next decision, and sets the clock's speed.
// News and Mail are static placeholder content; no backend yet.

import "./phone.css";
import { CalendarApp } from "./calendar";
import { pixelIcon } from "./pixel-icons";
import type { Clock } from "../engine/clock";
import { MARKET, type SeriesId } from "../data/market";
import type { SceneStatus } from "../engine/scene";
import type { CityDef, StateInfo, WeatherKind } from "../engine/types";
import { latest, type LifeEvent, type PlayerLife } from "../sim/life";
import { INSTRUMENTS } from "../sim/market";
import type { RunRecorder } from "../sim/record";

interface AppDef {
  id: "stocks" | "goals" | "map" | "weather" | "calendar" | "news" | "mail" | "bank";
  name: string;
  icon: string;
  ready: boolean;
}

const APPS: AppDef[] = [
  { id: "stocks", name: "Stocks", icon: pixelIcon("stocks"), ready: true },
  { id: "goals", name: "Goals", icon: pixelIcon("goals"), ready: true },
  { id: "map", name: "Map", icon: pixelIcon("map"), ready: true },
  { id: "weather", name: "Weather", icon: pixelIcon("weather"), ready: true },
  { id: "calendar", name: "Calendar", icon: pixelIcon("calendar"), ready: true },
  { id: "news", name: "News", icon: pixelIcon("news"), ready: true },
  { id: "mail", name: "Mail", icon: pixelIcon("mail"), ready: true },
  { id: "bank", name: "Bank", icon: pixelIcon("bank"), ready: false },
];

const WATCHLIST: { id: SeriesId; ticker: string; name: string }[] = [
  { id: "SP500", ticker: "S&P 500", name: "Standard & Poor's 500" },
  { id: "NASDAQCOM", ticker: "NASDAQ", name: "Nasdaq Composite" },
  { id: "DJIA", ticker: "DOW", name: "Dow Jones Industrial" },
  { id: "DGS10", ticker: "10Y", name: "10-Year Treasury Yield" },
  { id: "MORTGAGE30US", ticker: "30Y MTG", name: "30-Year Fixed Mortgage" },
  { id: "DFF", ticker: "FED", name: "Fed Funds Rate" },
];

interface LiveQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
}

interface WorldSnapshot {
  state: StateInfo;
  city: CityDef;
  status: SceneStatus | null;
}

const WEATHER_NAME: Record<WeatherKind, string> = {
  clear: "Clear skies",
  cloudy: "Cloudy",
  rain: "Rain",
  storm: "Storm",
  snow: "Snow",
  fog: "Fog",
  heat: "Heat wave",
  smoke: "Smoky",
};

const WEATHER_SYMBOL: Record<WeatherKind, string> = {
  clear: "☀",
  cloudy: "☁",
  rain: "☂",
  storm: "ϟ",
  snow: "❄",
  fog: "≋",
  heat: "☀",
  smoke: "≋",
};

const SEASON_NOTE = {
  spring: "New growth and milder days",
  summer: "Long days and warm weather",
  fall: "Cooler air and changing leaves",
  winter: "Short days and colder weather",
} as const;

interface MailMessage {
  id: string;
  from: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  unread: boolean;
}

/** Static placeholder inbox; no backend yet, so this never changes at runtime. */
const MAIL: MailMessage[] = [
  {
    id: "statement",
    from: "First National Bank",
    subject: "Your monthly statement is ready",
    preview: "View your balances, deposits, and any fees from this cycle.",
    body: "Your account statement for this cycle is ready to view. Balances, deposits, withdrawals, and any fees are itemized on the Bank app.",
    date: "Today",
    unread: true,
  },
  {
    id: "payroll",
    from: "Payroll · Acme Corp",
    subject: "Direct deposit confirmed",
    preview: "Your paycheck has been deposited to your checking account.",
    body: "Your paycheck for this pay period has been deposited to your checking account. Check the Bank app for the running total.",
    date: "Today",
    unread: true,
  },
  {
    id: "emergency-fund",
    from: "Larp City",
    subject: "Goal reached: 3-month emergency fund",
    preview: "Nice work — your emergency fund now covers 3 months of expenses.",
    body: "You've built up enough savings to cover 3 months of living expenses. That's a big cushion against a layoff or surprise bill — keep it up.",
    date: "Yesterday",
    unread: true,
  },
  {
    id: "rewards",
    from: "Card Rewards",
    subject: "You earned 2,400 points this cycle",
    preview: "Redeem points for cash back, travel, or statement credit.",
    body: "You earned 2,400 reward points on this cycle's spending. Points can be redeemed for cash back, travel, or a statement credit from the Card Shop.",
    date: "2 days ago",
    unread: false,
  },
  {
    id: "rent",
    from: "Landlord",
    subject: "Rent due in 5 days",
    preview: "Your monthly rent payment is due on the 1st.",
    body: "This is a reminder that rent is due on the 1st of the month. Late payments may include a fee, so plan your standing orders accordingly.",
    date: "3 days ago",
    unread: false,
  },
  {
    id: "tax",
    from: "IRS",
    subject: "Reminder: estimated tax payment due",
    preview: "Quarterly estimated taxes are due soon if you have 1099 income.",
    body: "If you have freelance or investment income this quarter, your estimated tax payment is due soon. Set aside funds so it doesn't hit your emergency fund.",
    date: "1 week ago",
    unread: false,
  },
];

type NewsCategory = "Markets" | "Economy" | "Money" | "Local";

interface NewsArticle {
  id: string;
  category: NewsCategory;
  headline: string;
  dek: string;
  body: string;
  source: string;
  date: string;
}

/** Static placeholder wire; no backend yet, so this never changes at runtime. */
const NEWS: NewsArticle[] = [
  {
    id: "fed-hold",
    category: "Economy",
    headline: "Fed holds rates steady, signals patience on cuts",
    dek: "Policymakers say they want more data before easing further.",
    body: "The Federal Reserve left its benchmark rate unchanged this week, with officials saying they want to see a few more months of data before considering another cut. Mortgage and card rates are likely to hold near current levels in the meantime — check the Stocks app for the latest 30-year fixed and Fed funds readings.",
    source: "Wire Service",
    date: "Today",
  },
  {
    id: "sp-climb",
    category: "Markets",
    headline: "S&P 500 climbs into the afternoon on tech strength",
    dek: "Broad gains led by large-cap tech; small caps lag.",
    body: "Major indexes advanced Thursday afternoon as large-cap tech names led the way. Small-cap stocks lagged behind the broader rally. Check the Stocks app for a live look at the S&P 500, Nasdaq, and Dow.",
    source: "Market Desk",
    date: "Today",
  },
  {
    id: "layoffs",
    category: "Economy",
    headline: "Layoffs tick up across tech and media",
    dek: "Analysts say an emergency fund is the best defense against a surprise job loss.",
    body: "A fresh round of layoffs hit tech and media companies this week, continuing a slow drift upward in job cuts. Financial planners point to the same advice every cycle: a cash cushion of three to six months of expenses makes a layoff a setback instead of a crisis. Your emergency fund balance is one tap away in the Bank app.",
    source: "Wire Service",
    date: "Yesterday",
  },
  {
    id: "efund-explainer",
    category: "Money",
    headline: "How much should you actually keep in an emergency fund?",
    dek: "The old \"three to six months\" rule, explained.",
    body: "The classic rule of thumb is three to six months of essential expenses in cash you can reach without penalty. Renters and dual-income households can often lean toward the shorter end; homeowners, single-income households, or anyone with irregular pay should lean longer. The right number is the one that lets you sleep at night during a rough stretch.",
    source: "Money Desk",
    date: "Yesterday",
  },
  {
    id: "card-rewards",
    category: "Money",
    headline: "Card issuers roll out richer cash-back categories",
    dek: "New quarterly bonus categories are live — worth a look before you spend.",
    body: "Several major card issuers refreshed their rotating bonus categories this quarter, with some offering elevated cash back on groceries and streaming. Compare official card offers any time in the Credit Desk's Card Shop.",
    source: "Money Desk",
    date: "2 days ago",
  },
  {
    id: "housing-costs",
    category: "Local",
    headline: "Housing costs keep climbing across Sun Belt metros",
    dek: "Rent and cost-of-living gaps between states keep widening.",
    body: "Rent growth in fast-growing Sun Belt metros continues to outpace the national average, widening the cost-of-living gap between states. Check the Map app to see how your city's cost of living compares to the rest of the country.",
    source: "Local Desk",
    date: "3 days ago",
  },
  {
    id: "rate-cut-outlook",
    category: "Economy",
    headline: "Economists split on timing of next rate move",
    dek: "Forecasters diverge on whether cuts resume this year.",
    body: "A survey of economists shows a wide range of views on when the Fed will move next, with estimates ranging from later this year to well into next. The uncertainty is a reminder to keep debt strategy flexible rather than betting on a single rate path.",
    source: "Wire Service",
    date: "1 week ago",
  },
];

const NEWS_TAG_CLASS: Record<NewsCategory, string> = {
  Markets: "news-tag-markets",
  Economy: "news-tag-economy",
  Money: "news-tag-money",
  Local: "news-tag-local",
};

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
  /** The earliest day the player can go back to. */
  firstDay?: () => number;
  /** Where the player is and the city's weather, for the Map and Weather apps. */
  getWorld: () => WorldSnapshot;
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
}

export class Phone {
  private readonly el: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly deps: PhoneDeps;
  private live: LiveQuote[] = [];
  /** Game day the Stocks list was drawn for; sponsor prices move with the city clock. */
  private stockDay = Number.NEGATIVE_INFINITY;
  private toastTimer = 0;
  private resumeSpeed = 1;
  /** Decision moments waiting for the desk to show them. */
  private parked: LifeEvent[] = [];
  private readonly showListeners: (() => void)[] = [];
  private readonly rewindListeners: ((day: number) => void)[] = [];
  private readonly calendar: CalendarApp;

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
    };
    (window as unknown as { larpMoney?: MoneyHost }).larpMoney = host;
    this.calendar = new CalendarApp(this.q('[data-view="calendar"]'), {
      clock: deps.clock,
      life: deps.player,
      firstDay: () => deps.firstDay?.() ?? 0,
      rewindTo: (day) => deps.rewindTo?.(day),
      skipTo: (day) => deps.skipTo?.(day),
      onHome: () => this.show("home"),
    });

    this.setOpen(readOpen(), false);
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    this.overlay.addEventListener("click", (ev) => {
      if (ev.target === this.overlay || (ev.target as HTMLElement).closest("[data-close]")) this.closeDesk();
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !this.overlay.hidden) this.closeDesk();
    });

    this.renderStocks();
    this.renderStatus();
    setInterval(() => this.renderStatus(), 1000);
    void this.loadLive();
  }

  private markup(): string {
    const home = WATCHLIST[0];
    const l = latest(home.id);
    const pts = MARKET.series[home.id].points.slice(-60).map((p) => p[1]);
    const up = pts[pts.length - 1] >= pts[0];
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
              <div class="w-top"><span class="w-name">${home.ticker}</span><span class="w-chg ${up ? "up" : "down"}">${l.changePct >= 0 ? "+" : "−"}${Math.abs(l.changePct * 100).toFixed(2)}%</span></div>
              <div class="w-value">${fmtIndex(l.value)}</div>
              ${sparkline(pts, up).replace('width="56" height="22"', 'width="100%" height="34" preserveAspectRatio="none"')}
              <div class="w-foot">Stocks · as of ${new Date(`${MARKET.asOf}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
            </button>
            <div class="app-grid">
              ${APPS.map((a) => {
                const unread = a.id === "mail" ? MAIL.filter((m) => m.unread).length : 0;
                const badge = !a.ready
                  ? `<span class="app-badge">Soon</span>`
                  : a.id === "mail"
                    ? `<span class="app-badge app-badge-unread"${unread > 0 ? "" : " hidden"}>${unread}</span>`
                    : "";
                return `<button class="app${a.ready ? "" : " soon"}" data-app="${a.id}" aria-label="${a.name}${a.ready ? "" : " (coming soon)"}">
                  <span class="app-icon">${a.icon}</span>
                  <span class="app-name">${a.name}</span>
                  ${badge}
                </button>`;
              }).join("")}
            </div>
            <div class="toast" data-toast hidden></div>
          </section>

          <section class="view view-stocks" data-view="stocks" hidden>
            <header class="st-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Stocks</div><div class="st-sub" data-st-sub></div></div>
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

          <section class="view view-weather" data-view="weather" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Weather</div><div class="st-sub" data-weather-place></div></div>
            </header>
            <div class="weather-now">
              <span class="weather-symbol" data-weather-symbol></span>
              <strong data-weather-name></strong>
              <span data-weather-event></span>
            </div>
            <div class="season-card">
              <span class="season-kicker">Current season</span>
              <strong data-season-name></strong>
              <span data-season-note></span>
            </div>
            <div class="weather-date" data-weather-date></div>
          </section>

          <section class="view view-news" data-view="news" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">News</div><div class="st-sub">Markets &amp; money</div></div>
            </header>
            <ul class="news-list" data-news-list></ul>
          </section>

          <section class="view view-news-detail" data-view="news-detail" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-back="news" aria-label="Back to News">‹</button>
              <div><div class="st-title">News</div><div class="st-sub">Article</div></div>
            </header>
            <div class="news-detail" data-news-detail></div>
          </section>

          <section class="view view-mail" data-view="mail" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Mail</div><div class="st-sub" data-mail-sub></div></div>
            </header>
            <ul class="mail-list" data-mail-list></ul>
          </section>

          <section class="view view-mail-detail" data-view="mail-detail" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-back="mail" aria-label="Back to Mail">‹</button>
              <div><div class="st-title">Mail</div><div class="st-sub">Message</div></div>
            </header>
            <div class="mail-detail" data-mail-detail></div>
          </section>

          <section class="view view-calendar" data-view="calendar" hidden></section>

          <button class="home-bar" data-home aria-label="Go home"></button>
        </div>
      </div>
      <button class="phone-toggle-zone" data-toggle aria-label="Put the phone away"></button>`;
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

  private show(view: "home" | AppDef["id"] | "mail-detail" | "news-detail") {
    this.el.querySelectorAll<HTMLElement>("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== view));
    if (view === "calendar") this.calendar.show();
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
    if (btn.dataset.back !== undefined) return this.show(btn.dataset.back as "mail" | "news");
    if (btn.dataset.desk !== undefined) return this.openDesk();
    if (btn.dataset.stock) return this.openDesk(btn.dataset.stock);
    if (btn.dataset.mailOpen !== undefined) return this.openMail(btn.dataset.mailOpen);
    if (btn.dataset.newsOpen !== undefined) return this.openNews(btn.dataset.newsOpen);
    if (btn.dataset.openMap !== undefined) return this.deps.openMap?.();
    const id = btn.dataset.app as AppDef["id"] | undefined;
    if (!id) return;
    const app = APPS.find((a) => a.id === id)!;
    if (!app.ready) return this.toast(`${app.name} is coming soon`);
    if (id === "goals") return this.deps.openFastForward?.();
    if (id === "mail") this.renderMail();
    if (id === "news") this.renderNews();
    this.show(id);
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
    if (decisions.length) this.showDecision(decisions);
  }

  private openNews(id: string) {
    const article = NEWS.find((a) => a.id === id);
    if (!article) return;
    this.q("[data-news-detail]").innerHTML = `
      <div class="news-detail-head">
        <span class="news-tag ${NEWS_TAG_CLASS[article.category]}">${article.category}</span>
        <span class="news-detail-meta">${article.source} · ${article.date}</span>
      </div>
      <div class="news-detail-headline">${article.headline}</div>
      <p class="news-detail-body">${article.body}</p>
    `;
    this.show("news-detail");
  }

  private renderNews() {
    this.q("[data-news-list]").innerHTML = NEWS.map(
      (a) => `<li>
        <button class="news-row" data-news-open="${a.id}">
          <span class="news-tag ${NEWS_TAG_CLASS[a.category]}">${a.category}</span>
          <span class="news-row-headline">${a.headline}</span>
          <span class="news-row-dek">${a.dek}</span>
          <span class="news-row-meta">${a.source} · ${a.date}</span>
        </button>
      </li>`,
    ).join("");
  }

  private openMail(id: string) {
    const msg = MAIL.find((m) => m.id === id);
    if (!msg) return;
    msg.unread = false;
    this.q("[data-mail-detail]").innerHTML = `
      <div class="mail-detail-head">
        <div class="mail-avatar">${msg.from[0]}</div>
        <div class="mail-detail-meta">
          <strong>${msg.from}</strong>
          <span>${msg.date}</span>
        </div>
      </div>
      <div class="mail-detail-subject">${msg.subject}</div>
      <p class="mail-detail-body">${msg.body}</p>
    `;
    this.renderMailBadge();
    this.show("mail-detail");
  }

  private renderMailBadge() {
    const unread = MAIL.filter((m) => m.unread).length;
    const badge = this.el.querySelector<HTMLElement>('[data-app="mail"] .app-badge');
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = String(unread);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  private renderMail() {
    this.q("[data-mail-list]").innerHTML = MAIL.map(
      (m) => `<li>
        <button class="mail-row${m.unread ? " unread" : ""}" data-mail-open="${m.id}">
          <span class="mail-avatar">${m.from[0]}</span>
          <span class="mail-row-body">
            <span class="mail-row-top"><strong>${m.from}</strong><span class="mail-row-date">${m.date}</span></span>
            <span class="mail-row-subject">${m.subject}</span>
            <span class="mail-row-preview">${m.preview}</span>
          </span>
          ${m.unread ? `<span class="mail-dot" aria-hidden="true"></span>` : ""}
        </button>
      </li>`,
    ).join("");
    const unread = MAIL.filter((m) => m.unread).length;
    this.q("[data-mail-sub]").textContent = unread > 0 ? `${unread} unread` : "All caught up";
  }

  /** Opens the Money window, on a stock's page when `stock` is given (the desk reads #stock=ID). */
  private openDesk(stock?: string) {
    const frame = this.overlay.querySelector("iframe")!;
    if (!frame.src) frame.src = `/debt.html${stock ? `#stock=${stock}` : ""}`;
    else if (stock && frame.contentWindow) frame.contentWindow.location.hash = `stock=${stock}`;
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
    const { state, city, status } = this.deps.getWorld();
    const weather = status?.weather ?? "clear";
    const season = status?.season ?? clock.season;
    this.q("[data-map-city]").textContent = `${city.name}, ${state.abbr}`;
    const tier = this.q("[data-map-tier]");
    tier.textContent = state.tier;
    tier.className = `tier ${state.tier.toLowerCase()}`;
    this.q("[data-map-tagline]").textContent = city.tagline;
    this.q("[data-map-state]").textContent = state.name;
    this.q("[data-map-cost]").textContent = `${state.rpp.all.toFixed(1)} · ${state.tier}`;
    this.q("[data-weather-place]").textContent = `${city.name}, ${state.abbr}`;
    this.q("[data-weather-symbol]").textContent = WEATHER_SYMBOL[weather];
    this.q("[data-weather-name]").textContent = WEATHER_NAME[weather];
    this.q("[data-weather-event]").textContent = status?.event ?? "Current conditions";
    this.q("[data-season-name]").textContent = season[0].toUpperCase() + season.slice(1);
    this.q("[data-season-note]").textContent = SEASON_NOTE[season];
    this.q("[data-weather-date]").textContent = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    this.calendar.refresh();
    // Sponsor prices move with the city clock, so redraw once per game day.
    if (clock.day !== this.stockDay) this.renderStocks();
  }

  /** The HackRice sponsors on the city player's market: today's close, the move since the last trading day, and about six weeks of closes. */
  private sponsorRows(): string[] {
    const market = this.deps.player.market;
    const day = this.deps.clock.day;
    const trading = (d: number) => ![0, 6].includes(market.dateOf(d).getDay());
    let today = day;
    while (!trading(today)) today--;
    let prev = today - 1;
    while (!trading(prev)) prev--;
    return INSTRUMENTS.filter((i) => i.sponsor).map((i) => {
      const px = market.price(i.id, today);
      const chg = px / market.price(i.id, prev) - 1;
      const pts = market.series(i.id, day - 42, day).filter((p) => trading(p.day)).map((p) => p.value);
      const tone = Math.abs(chg) < 1e-6 ? "flat" : chg > 0 ? "up" : "down";
      return `<button class="st-row link" data-stock="${i.id}" aria-label="${i.name}: open in Money"><div class="st-name"><b>${i.id}</b><span>${i.name}${i.listed === false ? " · private" : ""}</span></div>${sparkline(pts, pts[pts.length - 1] >= pts[0])}<div class="st-right"><span class="st-px">$${fmtIndex(px)}</span><span class="st-pill ${tone}">${chg >= 0 ? "+" : "−"}${Math.abs(chg * 100).toFixed(2)}%</span></div></button>`;
    });
  }

  private renderStocks() {
    this.stockDay = this.deps.clock.day;
    const item = (row: string) => `<li class="st-item">${row}</li>`;
    const sec = (title: string, note: string) => `<li class="st-sec"><span>${title}</span><span>${note}</span></li>`;
    const live = this.live.map((q) => {
      const up = q.change >= 0;
      return `<div class="st-row"><div class="st-name"><b>${q.symbol}</b><span>Live · Alpha Vantage</span></div><span class="spark-slot"></span><div class="st-right"><span class="st-px">${fmtIndex(q.price)}</span><span class="st-pill ${up ? "up" : "down"}">${up ? "+" : "−"}${Math.abs(q.changePct * 100).toFixed(2)}%</span></div></div>`;
    });
    const fred = WATCHLIST.map((w) => {
      const l = latest(w.id);
      const pct = MARKET.series[w.id].unit === "percent";
      const pts = MARKET.series[w.id].points.slice(-60).map((p) => p[1]);
      const up = l.change >= 0;
      const value = pct ? `${l.value.toFixed(2)}%` : fmtIndex(l.value);
      const chg = pct ? `${up ? "+" : "−"}${Math.abs(l.change * 100).toFixed(0)} bp` : `${up ? "+" : "−"}${Math.abs(l.changePct * 100).toFixed(2)}%`;
      return `<div class="st-row"><div class="st-name"><b>${w.ticker}</b><span>${w.name}</span></div>${sparkline(pts, pts[pts.length - 1] >= pts[0])}<div class="st-right"><span class="st-px">${value}</span><span class="st-pill ${up ? "up" : "down"}">${chg}</span></div></div>`;
    });
    const asOf = new Date(`${MARKET.asOf}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    this.q("[data-st-list]").innerHTML = [
      // "In game" (not "Game prices") so the full title fits on the phone's 192px row.
      sec("HackRice sponsors", "In game"),
      ...this.sponsorRows().map(item),
      sec("Markets", `${this.live.length ? "Live and " : ""}FRED, ${asOf}`),
      ...[...live, ...fred].map(item),
    ].join("");
    this.q("[data-st-sub]").textContent = `Larp City, ${this.deps.clock.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  }

  private async loadLive() {
    try {
      const res = await fetch("/api/market/quotes?symbols=SPY,QQQ,DIA,IWM");
      if (!res.ok) return;
      const j = (await res.json()) as { quotes?: LiveQuote[] };
      this.live = (j.quotes ?? []).filter((q) => Number.isFinite(q.price) && q.price > 0);
      if (this.live.length) this.renderStocks();
    } catch {
      // No dev server proxy or no key: the FRED snapshot is enough.
    }
  }
}
