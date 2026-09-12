// The player's phone: the hub where the game's apps live. It pulls up from the
// bottom-right corner. Stocks shows the market from the FRED snapshot (plus
// live Alpha Vantage quotes when the dev server has a key) and opens the Money
// desk (/debt.html) in a window over the city, sharing the city's player and
// clock through window.larpMoney. Goals opens the fast-forward setup screen
// (ui/skip-setup.ts).

import "./phone.css";
import { pixelIcon } from "./pixel-icons";
import type { Clock } from "../engine/clock";
import { MARKET, type SeriesId } from "../data/market";
import type { SceneStatus } from "../engine/scene";
import type { CityDef, StateInfo, WeatherKind } from "../engine/types";
import { latest, type LifeEvent, type PlayerLife } from "../sim/life";
import type { AccountKind } from "../sim/money/types";

interface AppDef {
  id: "stocks" | "goals" | "map" | "weather" | "timeline" | "news" | "mail" | "bank";
  name: string;
  icon: string;
  ready: boolean;
}


const APPS: AppDef[] = [
  { id: "stocks", name: "Stocks", icon: pixelIcon("stocks"), ready: true },
  { id: "goals", name: "Goals", icon: pixelIcon("goals"), ready: true },
  { id: "map", name: "Map", icon: pixelIcon("map"), ready: true },
  { id: "weather", name: "Weather", icon: pixelIcon("weather"), ready: true },
  { id: "timeline", name: "Timeline", icon: pixelIcon("calendar"), ready: true },
  { id: "news", name: "News", icon: pixelIcon("news"), ready: true },
  { id: "mail", name: "Mail", icon: pixelIcon("mail"), ready: true },
  { id: "bank", name: "Bank", icon: pixelIcon("bank"), ready: true },
];

const BANK_ACCOUNT_ORDER: AccountKind[] = ["checking", "savings", "emergency"];

const BANK_ACCOUNT_META: Partial<Record<AccountKind, { initials: string; sub: string; accent: string }>> = {
  checking: { initials: "CHK", sub: "Spending", accent: "#147cc8" },
  savings: { initials: "SAV", sub: "High-yield", accent: "#2f9b52" },
  emergency: { initials: "EF", sub: "Rainy-day fund", accent: "#c8722f" },
};

interface BankActivityRow {
  id: number;
  day: number;
  label: string;
  sub: string;
  amount: number;
}

const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUsdCents = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

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

const SEASON_NOTE = {
  spring: "New growth and milder days",
  summer: "Long days and warm weather",
  fall: "Cooler air and changing leaves",
  winter: "Short days and colder weather",
} as const;

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

function timeLabel(t: number): string {
  const mins = Math.round(t * 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60);
  return `${((h + 11) % 12) + 1}:${String(mins % 60).padStart(2, "0")}`;
}

export interface PhoneDeps {
  clock: Clock;
  player: PlayerLife;
  /** Opens the goal fast-forward setup screen. */
  openFastForward?: () => void;
  openMap?: () => void;
  skip?: (days: number) => void;
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
}

export class Phone {
  private readonly el: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly deps: PhoneDeps;
  private live: LiveQuote[] = [];
  private toastTimer = 0;
  private resumeSpeed = 1;
  private bankActivity: BankActivityRow[] = [];
  private bankActivitySeq = 0;

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
    (window as unknown as { larpMoney?: MoneyHost }).larpMoney = { life: () => this.deps.player, clock: deps.clock };

    this.setOpen(readOpen(), false);
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    this.overlay.addEventListener("click", (ev) => {
      if (ev.target === this.overlay || (ev.target as HTMLElement).closest("[data-close]")) this.closeDesk();
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !this.overlay.hidden) this.closeDesk();
    });

    this.deps.player.onEvents((events) => this.onLifeEvents(events));

    this.renderStocks();
    this.renderStatus();
    setInterval(() => this.renderStatus(), 1000);
    void this.loadLive();
  }

  /** Turns paycheck/bill/interest events into the Bank app's activity feed. No backend: kept in memory for the session. */
  private onLifeEvents(events: LifeEvent[]) {
    let touched = false;
    for (const e of events) {
      if (e.type === "paycheck" && !e.unemployed) {
        this.bankActivity.unshift({ id: ++this.bankActivitySeq, day: e.day, label: "Paycheck deposited", sub: "Checking", amount: e.takeHome });
        touched = true;
      } else if (e.type === "bill") {
        this.bankActivity.unshift({ id: ++this.bankActivitySeq, day: e.day, label: e.name, sub: "Checking", amount: -e.paid });
        touched = true;
      } else if (e.type === "savings_interest" && e.amount > 0) {
        this.bankActivity.unshift({ id: ++this.bankActivitySeq, day: e.day, label: "Interest earned", sub: "Savings", amount: e.amount });
        touched = true;
      }
    }
    if (!touched) return;
    if (this.bankActivity.length > 25) this.bankActivity.length = 25;
    if (this.el.querySelector('[data-view="bank"]')?.hasAttribute("hidden") === false) this.renderBank();
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
              <button class="st-back" data-home aria-label="Back to home"><svg viewBox="0 0 10 16" width="9" height="15"><path d="M8 2L2 8l6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
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

          <section class="view view-timeline" data-view="timeline" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Timeline</div><div class="st-sub">Control city time</div></div>
            </header>
            <div class="timeline-date"><span data-timeline-dow></span><strong data-timeline-date></strong></div>
            <div class="timeline-section">
              <span class="timeline-label">Speed</span>
              <div class="timeline-speeds">
                <button data-tl-speed="0" aria-label="Pause timeline">Ⅱ</button>
                <button data-tl-speed="1">1×</button>
                <button data-tl-speed="2">2×</button>
                <button data-tl-speed="4">4×</button>
              </div>
            </div>
            <div class="timeline-section">
              <span class="timeline-label">Jump ahead</span>
              <button class="timeline-jump" data-tl-skip="7">+1 week</button>
              <button class="timeline-jump" data-tl-skip="30">+1 month</button>
            </div>
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

          <section class="view view-bank" data-view="bank" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Bank</div><div class="st-sub">Checking &amp; savings</div></div>
            </header>
            <div class="bank-total"><span>Total cash</span><strong data-bank-total></strong></div>
            <ul class="bank-accounts" data-bank-accounts></ul>
            <div class="bank-activity-head">Activity</div>
            <ul class="bank-activity" data-bank-activity></ul>
            <button class="st-open" data-desk>Open Money <span aria-hidden="true">↗</span></button>
          </section>

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
    if (btn.dataset.mailOpen !== undefined) return this.openMail(btn.dataset.mailOpen);
    if (btn.dataset.newsOpen !== undefined) return this.openNews(btn.dataset.newsOpen);
    if (btn.dataset.openMap !== undefined) return this.deps.openMap?.();
    if (btn.dataset.tlSpeed !== undefined) {
      this.deps.clock.speed = Number(btn.dataset.tlSpeed);
      this.renderStatus();
      return;
    }
    if (btn.dataset.tlSkip !== undefined) {
      this.deps.skip?.(Number(btn.dataset.tlSkip));
      return;
    }
    const id = btn.dataset.app as AppDef["id"] | undefined;
    if (!id) return;
    const app = APPS.find((a) => a.id === id)!;
    if (!app.ready) return this.toast(`${app.name} is coming soon`);
    if (id === "goals") return this.deps.openFastForward?.();
    if (id === "mail") this.renderMail();
    if (id === "news") this.renderNews();
    if (id === "bank") this.renderBank();
    this.show(id);
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

  private renderBank() {
    const { player } = this.deps;
    this.q("[data-bank-total]").textContent = fmtUsd(player.cash());
    this.q("[data-bank-accounts]").innerHTML = BANK_ACCOUNT_ORDER.map((kind) => {
      const meta = BANK_ACCOUNT_META[kind]!;
      const account = [...player.ledger.accounts.values()].find((a) => a.kind === kind);
      if (!account) return "";
      return `<li class="bank-account-row">
        <span class="bank-avatar" style="background:${meta.accent}">${meta.initials}</span>
        <span class="bank-account-body">
          <span class="bank-account-top"><strong>${account.name}</strong><span class="bank-account-balance">${fmtUsdCents(account.balance)}</span></span>
          <span class="bank-account-sub">${meta.sub} · ${(account.apy * 100).toFixed(2)}% APY</span>
        </span>
      </li>`;
    }).join("");
    const list = this.q("[data-bank-activity]");
    if (!this.bankActivity.length) {
      list.innerHTML = `<li class="bank-activity-empty">No activity yet — check back after your next payday.</li>`;
    } else {
      list.innerHTML = this.bankActivity
        .map((row) => {
          const up = row.amount >= 0;
          return `<li class="bank-activity-row">
            <span class="bank-activity-body"><strong>${row.label}</strong><span>${row.sub}</span></span>
            <span class="bank-activity-amount ${up ? "up" : "down"}">${up ? "+" : "−"}${fmtUsd(Math.abs(row.amount))}</span>
          </li>`;
        })
        .join("");
    }
  }

  private openDesk() {
    const frame = this.overlay.querySelector("iframe")!;
    if (!frame.src) frame.src = "/debt.html";
    this.resumeSpeed = this.deps.clock.speed || this.resumeSpeed;
    this.deps.clock.speed = 0;
    this.overlay.hidden = false;
    this.overlay.querySelector<HTMLButtonElement>("[data-close]")!.focus();
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
    this.q("[data-timeline-dow]").textContent = d.toLocaleDateString("en-US", { weekday: "long" });
    this.q("[data-timeline-date]").textContent = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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
    this.el.querySelectorAll<HTMLButtonElement>("[data-tl-speed]").forEach((button) =>
      button.classList.toggle("on", Number(button.dataset.tlSpeed) === clock.speed),
    );
  }

  private renderStocks() {
    const live = this.live.map((q) => {
      const up = q.change >= 0;
      return `<li class="st-row"><div class="st-name"><b>${q.symbol}</b><span>Live · Alpha Vantage</span></div><span class="spark-slot"></span><div class="st-right"><span class="st-px">${fmtIndex(q.price)}</span><span class="st-pill ${up ? "up" : "down"}">${up ? "+" : "−"}${Math.abs(q.changePct * 100).toFixed(2)}%</span></div></li>`;
    });
    const fred = WATCHLIST.map((w) => {
      const l = latest(w.id);
      const pct = MARKET.series[w.id].unit === "percent";
      const pts = MARKET.series[w.id].points.slice(-60).map((p) => p[1]);
      const up = l.change >= 0;
      const value = pct ? `${l.value.toFixed(2)}%` : fmtIndex(l.value);
      const chg = pct ? `${up ? "+" : "−"}${Math.abs(l.change * 100).toFixed(0)} bp` : `${up ? "+" : "−"}${Math.abs(l.changePct * 100).toFixed(2)}%`;
      return `<li class="st-row"><div class="st-name"><b>${w.ticker}</b><span>${w.name}</span></div>${sparkline(pts, pts[pts.length - 1] >= pts[0])}<div class="st-right"><span class="st-px">${value}</span><span class="st-pill ${up ? "up" : "down"}">${chg}</span></div></li>`;
    });
    this.q("[data-st-list]").innerHTML = [...live, ...fred].join("");
    const asOf = new Date(`${MARKET.asOf}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    this.q("[data-st-sub]").textContent = this.live.length ? `Live quotes and FRED, ${asOf}` : `FRED, ${asOf}`;
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
