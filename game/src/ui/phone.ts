// The player's phone: the hub where the game's "apps" live (Stocks and Goals
// now; News, Mail, and Bank next). It docks on the left edge of the city and
// can be tucked away. Stocks shows the market from the FRED snapshot (plus
// live Alpha Vantage quotes when the dev server has a key) and opens the Money
// desk (/debt.html) in a window over the city, sharing the city's player and
// clock through window.larpMoney. Goals opens the fast-forward setup screen
// (ui/skip-setup.ts).

import "./phone.css";
import type { Clock } from "../engine/clock";
import { MARKET, type SeriesId } from "../data/market";
import { latest, type PlayerLife } from "../sim/life";

interface AppDef {
  id: "stocks" | "goals" | "news" | "mail" | "bank";
  name: string;
  icon: string;
  ready: boolean;
}

const ICONS = {
  stocks: `<svg viewBox="0 0 60 60" aria-hidden="true"><defs><linearGradient id="ph-st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c2e"/><stop offset="1" stop-color="#050505"/></linearGradient></defs><rect width="60" height="60" rx="14" fill="url(#ph-st)"/><path d="M10 40h40M10 30h40M10 20h40" stroke="#3a3a3c" stroke-width="1"/><polyline points="10,42 19,36 26,39 34,26 41,30 50,17" fill="none" stroke="#30d158" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  news: `<svg viewBox="0 0 60 60" aria-hidden="true"><rect width="60" height="60" rx="14" fill="#fff"/><rect x="13" y="14" width="34" height="32" rx="4" fill="#ff375f"/><rect x="17" y="18" width="12" height="10" rx="1.5" fill="#fff"/><path d="M32 19h11M32 24h11M17 32h26M17 37h26M17 42h18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  mail: `<svg viewBox="0 0 60 60" aria-hidden="true"><defs><linearGradient id="ph-ml" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#0a64d8"/></linearGradient></defs><rect width="60" height="60" rx="14" fill="url(#ph-ml)"/><rect x="11" y="18" width="38" height="25" rx="4" fill="#fff"/><path d="M12 20l18 13 18-13" fill="none" stroke="#1c7ce0" stroke-width="2.6" stroke-linejoin="round"/></svg>`,
  goals: `<svg viewBox="0 0 60 60" aria-hidden="true"><defs><linearGradient id="ph-gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd84d"/><stop offset="1" stop-color="#f29a00"/></linearGradient></defs><rect width="60" height="60" rx="14" fill="url(#ph-gl)"/><path d="M19 12v36" stroke="#16233b" stroke-width="3.4" stroke-linecap="round"/><path d="M20.5 14h22l-5.5 7.5 5.5 7.5h-22z" fill="#fff"/><path d="M26 40l6 4-6 4zM34 40l6 4-6 4z" fill="#16233b"/></svg>`,
  bank: `<svg viewBox="0 0 60 60" aria-hidden="true"><defs><linearGradient id="ph-bk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4cd964"/><stop offset="1" stop-color="#1e8e3e"/></linearGradient></defs><rect width="60" height="60" rx="14" fill="url(#ph-bk)"/><path d="M30 11l19 10H11z" fill="#fff"/><path d="M15 25v14M23 25v14M37 25v14M45 25v14" stroke="#fff" stroke-width="4" stroke-linecap="round"/><rect x="11" y="42" width="38" height="5" rx="2" fill="#fff"/></svg>`,
} as const;

const APPS: AppDef[] = [
  { id: "stocks", name: "Stocks", icon: ICONS.stocks, ready: true },
  { id: "goals", name: "Goals", icon: ICONS.goals, ready: true },
  { id: "news", name: "News", icon: ICONS.news, ready: false },
  { id: "mail", name: "Mail", icon: ICONS.mail, ready: false },
  { id: "bank", name: "Bank", icon: ICONS.bank, ready: false },
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
  return `<svg class="spark" viewBox="0 -1 ${w} ${h + 2}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${up ? "#30d158" : "#ff453a"}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
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
      <button class="phone-tab" data-toggle aria-label="Show phone"><span class="phone-tab-icon"></span></button>
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

          <button class="home-bar" data-home aria-label="Go home"></button>
        </div>
        <button class="phone-hide" data-toggle aria-label="Put the phone away">
          <svg viewBox="0 0 12 12" width="10" height="10"><path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`;
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  private setOpen(open: boolean, remember = true) {
    this.el.classList.toggle("open", open);
    this.el.classList.toggle("closed", !open);
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
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("button");
    if (!btn) return;
    if (btn.dataset.toggle !== undefined) return this.setOpen(!this.el.classList.contains("open"));
    if (btn.dataset.home !== undefined) return this.show("home");
    if (btn.dataset.desk !== undefined) return this.openDesk();
    const id = btn.dataset.app as AppDef["id"] | undefined;
    if (!id) return;
    const app = APPS.find((a) => a.id === id)!;
    if (!app.ready) return this.toast(`${app.name} is coming soon`);
    if (id === "goals") return this.deps.openFastForward?.();
    this.show(id);
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
