// The player's phone: the hub where the game's apps live. It pulls up from the
// bottom-right corner. Stocks lists the HackRice sponsor stocks at today's game
// prices (tap one to open its page), then the market from the FRED snapshot
// (plus live Alpha Vantage quotes when the dev server has a key), and opens the
// Money desk (/debt.html) in a window over the city, sharing the city's player
// and clock through window.larpMoney. Goals opens the fast-forward setup screen
// (ui/skip-setup.ts). Map, Weather, and Timeline show where the player is, the
// city's weather and season, and the clock's speed and skip controls.

import "./phone.css";
import { pixelIcon } from "./pixel-icons";
import type { Clock } from "../engine/clock";
import { MARKET, type SeriesId } from "../data/market";
import type { SceneStatus } from "../engine/scene";
import type { CityDef, StateInfo, WeatherKind } from "../engine/types";
import { latest, type LifeEvent, type PlayerLife } from "../sim/life";
import { INSTRUMENTS } from "../sim/market";
import type { RunRecorder } from "../sim/record";

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
  { id: "news", name: "News", icon: pixelIcon("news"), ready: false },
  { id: "mail", name: "Mail", icon: pixelIcon("mail"), ready: false },
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
  /** The city's run recorder, so the desk can ask the coach about the city's run. */
  recorder?: RunRecorder;
  /** Opens the U.S. map (the Map app's button). */
  openMap?: () => void;
  /** Plays a skip of `days` as a time-lapse (the Timeline app's jump buttons). */
  skip?: (days: number) => void;
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
    };
    (window as unknown as { larpMoney?: MoneyHost }).larpMoney = host;

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
              ${APPS.map(
                (a) => `<button class="app${a.ready ? "" : " soon"}" data-app="${a.id}" aria-label="${a.name}${a.ready ? "" : " (coming soon)"}">
                  <span class="app-icon">${a.icon}</span>
                  <span class="app-name">${a.name}</span>
                  ${a.ready ? "" : `<span class="app-badge">Soon</span>`}
                </button>`,
              ).join("")}
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

  private show(view: "home" | AppDef["id"]) {
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
    if (btn.dataset.desk !== undefined) return this.openDesk();
    if (btn.dataset.stock) return this.openDesk(btn.dataset.stock);
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
