// Credit Desk (/debt.html): a markets-terminal view of the player's money
// life. It runs the same PlayerLife the city scene runs (paychecks, rent for
// the state, the accounts ledger, and the debt engine) on the game's Clock,
// with real rates and index history from the FRED snapshot and optional
// live quotes from Alpha Vantage through the dev server (vite.config.ts).

import "./debt.css";
import { mountShop } from "./shop.ts";
import { Clock } from "../engine/clock.ts";
import { STATES } from "../data/states.ts";
import { MARKET, type SeriesId } from "../data/market.ts";
import { PlayerLife, latest, seriesOn, type LifeEvent } from "../sim/life/index.ts";
import {
  compareStrategies,
  enrollHardship,
  fileBankruptcy,
  isOpen,
  offeredApr,
  owed,
  payNow,
  primeRate,
  scoreBreakdown,
  switchToRap,
  WEIGHTS,
  type Debt,
  type Projection,
  type Strategy,
} from "../sim/debt/index.ts";

type Tone = "up" | "down" | "flat" | "info";
type Tab = "payoff" | "networth" | "sp500" | "rates";
interface FeedItem {
  day: number;
  tag: string;
  text: string;
  tone: Tone;
}
interface Decision {
  title: string;
  body: string;
  options: { label: string; lesson: string; tone?: "good" | "bad"; act: () => void }[];
}
interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  unit: "index" | "percent" | "usd";
}

const HOME = STATES.find((s) => s.abbr === "TX")!;
const MOVES = ["TX", "CA", "NY", "FL", "OH", "WA", "CO"].map((a) => STATES.find((s) => s.abbr === a)!).filter(Boolean);
const LIVE_NAMES: Record<string, string> = { SPY: "SPDR S&P 500 ETF", QQQ: "Invesco QQQ", DIA: "SPDR Dow ETF", IWM: "iShares Russell 2000" };
// The city game's palette; charts draw on white insets.
const STRATEGY_COLOR: Record<Strategy, string> = { minimums: "#8a9bb8", snowball: "#2b66c4", avalanche: "#f2b200" };
const GAME = { green: "#2ecc71", red: "#e8554e", blue: "#2b66c4", yellow: "#f2b200", violet: "#8e5bd6" } as const;
const STRATEGY_NAME: Record<Strategy, string> = { minimums: "Minimums", snowball: "Snowball", avalanche: "Avalanche" };
const KIND_NAME: Record<Debt["kind"], string> = {
  credit_card: "Credit card",
  student_federal: "Federal student",
  auto: "Auto loan",
  personal: "Personal loan",
  mortgage: "Mortgage",
  bnpl: "Buy now, pay later",
  payday: "Payday",
  medical: "Medical",
};

const clock = new Clock();
let rateShock = 0;
let life = makeLife();
let startNetWorth = life.netWorth();
let original = originals();
const feed: FeedItem[] = [];
let decision: Decision | null = null;
let resumeSpeed = 1;
let tab: Tab = "payoff";
let liveQuotes: { quotes: Quote[]; cached: boolean } | null = null;
let liveSpy: [string, number][] | null = null;

function makeLife(): PlayerLife {
  const l = new PlayerLife({ place: HOME, day: clock.day, cashRate: (d) => seriesOn("DFF", d) / 100 + rateShock });
  l.onEvents(onLifeEvents);
  return l;
}

function originals(): Map<string, number> {
  return new Map(life.book.debts.map((d) => [d.id, owed(d)]));
}

// ---- Formatting --------------------------------------------------------------

const num = (n: number, digits = 0) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usd = (n: number, digits = 0) => `${n < 0 ? "−" : ""}$${num(n, digits)}`;
const signedUsd = (n: number, digits = 0) => `${n >= 0 ? "+" : "−"}$${num(n, digits)}`;
const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : a.toFixed(0);
  // "$30.0K" reads as noise on axes and summaries; "$30K" says the same.
  return `${n < 0 ? "−" : ""}$${s.replace(/\.0(?=[KM])/, "")}`;
};
const pct = (f: number, d = 2) => `${(f * 100).toFixed(d)}%`;
const signedPct = (f: number, d = 2) => `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(d)}%`;
const toneOf = (n: number): Tone => (n > 0.0001 ? "up" : n < -0.0001 ? "down" : "flat");
const dateOfDay = (day: number) => {
  const d = new Date(clock.start);
  d.setDate(d.getDate() + day);
  return d;
};
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
const monthsAhead = (m: number) => {
  const d = clock.date;
  d.setMonth(d.getMonth() + Math.round(m));
  return monthYear(d);
};
const isoDate = (iso: string) => new Date(`${iso}T12:00:00`);

// ---- Events ------------------------------------------------------------------

function log(day: number, tag: string, text: string, tone: Tone) {
  feed.unshift({ day, tag, text, tone });
  if (feed.length > 80) feed.length = 80;
}

function onLifeEvents(events: LifeEvent[]) {
  for (const e of events) {
    const d = "debtId" in e ? life.book.debts.find((x) => x.id === e.debtId) : undefined;
    switch (e.type) {
      case "paycheck":
        log(e.day, "PAY", `Paycheck ${signedUsd(e.takeHome)}${e.garnished ? `, ${usd(e.garnished)} garnished` : ""}${e.unemployed ? " (unemployment)" : ""}`, "up");
        break;
      case "bill": {
        const short = e.amount - e.paid;
        log(e.day, "BILL", `${e.name} ${usd(e.amount)}${short > 0.5 ? `, short by ${usd(short)}` : ""}`, short > 0.5 ? "down" : "flat");
        break;
      }
      case "savings_interest":
        log(e.day, "INT", `Savings interest ${signedUsd(e.amount, 2)}`, "up");
        break;
      case "moved":
        log(e.day, "MOVE", `Moved ${e.from} → ${e.to}: rent ${usd(e.rent)} and living costs ${usd(e.living)} a month`, "info");
        break;
      case "job":
        log(e.day, "JOB", e.employed ? "Back at work: full paychecks resume" : "Laid off: unemployment pays about 40% of take-home", e.employed ? "up" : "down");
        break;
      case "missed":
        log(e.day, "LATE", `Missed ${d?.name ?? "a"} payment of ${usd(e.due)}${e.fee ? ` plus a ${usd(e.fee)} fee` : ""}`, "down");
        break;
      case "cannot_cover":
        if (!decision && d) askCannotCover(d, e.due, e.available);
        break;
      case "late_mark":
        log(e.day, "CREDIT", `${d?.name} reported ${e.severity} days late; score ${e.scoreBefore} → ${e.scoreAfter}`, "down");
        break;
      case "penalty_apr":
        log(e.day, "APR", `${d?.name} moved to a ${pct(e.apr)} penalty APR`, "down");
        break;
      case "repossessed":
        log(e.day, "REPO", `Car repossessed; ${usd(e.deficiency)} is still owed`, "down");
        break;
      case "collections":
        log(e.day, "COLL", `${d?.name} charged off and sold to a collector`, "down");
        break;
      case "default":
        log(e.day, "DFLT", `${d?.name} defaulted; 15% of each paycheck will be garnished`, "down");
        break;
      case "paid_off":
        log(e.day, "PAID", `${e.name} paid off; its payment rolls into the next debt`, "up");
        break;
      case "score_change":
        if (Math.abs(e.to - e.from) >= 3) log(e.day, "CREDIT", `Score ${e.from} → ${e.to}`, e.to > e.from ? "up" : "down");
        break;
      case "bankruptcy_eligible":
        if (!decision) askBankruptcy(e.reason);
        break;
      default:
        break;
    }
  }
  scheduleRender();
}

// ---- Decisions ---------------------------------------------------------------

function ctxNow() {
  return { day: clock.day, date: clock.date, env: { cashRateAnnual: seriesOn("DFF", clock.date) / 100 + rateShock }, wallet: life.ledger.wallet() };
}

function openDecision(dec: Decision) {
  decision = dec;
  if (clock.speed > 0) resumeSpeed = clock.speed;
  clock.speed = 0;
}

function closeDecision() {
  decision = null;
  clock.speed = resumeSpeed;
  render();
}

function askCannotCover(d: Debt, due: number, available: number) {
  const options: Decision["options"] = [];
  if (d.kind === "credit_card" || d.kind === "personal" || d.kind === "auto") {
    options.push({
      label: "Call the lender for a hardship plan",
      lesson: "Most lenders lower the APR or skip payments if you call before you are 30 days late.",
      tone: "good",
      act: () => {
        enrollHardship(life.book, d.id, clock.day);
        log(clock.day, "PLAN", `${d.name}: hardship plan at 9% APR for 6 months`, "up");
      },
    });
  }
  if (d.kind === "student_federal" && d.plan !== "rap") {
    options.push({
      label: "Switch to the Repayment Assistance Plan",
      lesson: "Income-driven payments can drop to $10 a month, and the balance still falls.",
      tone: "good",
      act: () => {
        switchToRap(life.book, d.id);
        log(clock.day, "PLAN", `${d.name} moved to RAP at ${usd(life.book.debts.find((x) => x.id === d.id)?.scheduledPayment ?? 0)} a month`, "up");
      },
    });
  }
  options.push({
    label: "Let it slide for now",
    lesson: "At 30 days it is reported and the score drops; at 60 days a card's APR jumps to 29.99%.",
    tone: "bad",
    act: () => log(clock.day, "LATE", `You let the ${d.name} payment slide`, "down"),
  });
  openDecision({
    title: `${d.name}: payment can't be covered`,
    body: `${usd(due)} is due. Checking, savings, and the emergency fund together hold ${usd(available)}.`,
    options,
  });
}

function askBankruptcy(reason: string) {
  openDecision({
    title: "Bankruptcy is now an option",
    body: reason,
    options: [
      {
        label: "File Chapter 7",
        lesson: "Wipes cards and personal loans in about 4 months. Student loans stay. 10 years on the report.",
        act: () => {
          const r = fileBankruptcy(life.book, 7, clock.day);
          log(clock.day, "BK7", `Chapter 7: ${usd(r.discharged)} discharged for ${usd(r.cost)} in fees; kept ${r.kept.join(", ") || "nothing"}`, "down");
        },
      },
      {
        label: "File Chapter 13",
        lesson: "A 5-year plan repays part of it and you keep your car. 7 years on the report.",
        act: () => {
          const r = fileBankruptcy(life.book, 13, clock.day);
          log(clock.day, "BK13", `Chapter 13 plan: ${usd(r.planPayment ?? 0)} a month for 5 years`, "down");
        },
      },
      { label: "Keep paying what I can", lesson: "Nonprofit credit counseling can still set up a debt management plan.", tone: "good", act: () => log(clock.day, "PLAN", "You kept paying what you could", "info") },
    ],
  });
}

// ---- Chart -------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}
interface Line {
  name: string;
  color: string;
  pts: Pt[];
  dash?: boolean;
  area?: boolean;
  width?: number;
}
interface Spec {
  lines: Line[];
  fx: (x: number) => string;
  fy: (y: number) => string;
  zeroBase?: boolean;
  empty?: string;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.01; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

let chartGeom: { X: (x: number) => number; Y: (y: number) => number; xmin: number; xmax: number; W: number; H: number; m: { l: number; r: number; t: number; b: number }; spec: Spec } | null = null;

function drawChart(spec: Spec) {
  const el = q("[data-chart]");
  const tip = q("[data-tip]");
  tip.hidden = true;
  const pts = spec.lines.flatMap((l) => l.pts);
  if (pts.length < 2) {
    el.innerHTML = `<div class="chart-empty">${spec.empty ?? "No data yet."}</div>`;
    chartGeom = null;
    return;
  }
  const W = Math.max(320, el.clientWidth);
  const H = 300;
  const m = { l: 64, r: 18, t: 14, b: 30 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  let ymin = Math.min(...ys);
  let ymax = Math.max(...ys);
  if (spec.zeroBase) ymin = Math.min(0, ymin);
  const pad = (ymax - ymin) * 0.08 || Math.abs(ymax) * 0.05 || 1;
  if (!(spec.zeroBase && ymin === 0)) ymin -= pad;
  ymax += pad;
  const yt = niceTicks(ymin, ymax);
  ymin = Math.min(ymin, yt[0]);
  ymax = Math.max(ymax, yt[yt.length - 1]);
  const X = (x: number) => m.l + ((x - xmin) / (xmax - xmin || 1)) * (W - m.l - m.r);
  const Y = (y: number) => m.t + (1 - (y - ymin) / (ymax - ymin || 1)) * (H - m.t - m.b);
  const grid = yt
    .map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid${Math.abs(v) < 1e-9 ? " zero" : ""}"/><text x="${m.l - 10}" y="${(Y(v) + 4).toFixed(1)}" class="axis" text-anchor="end">${spec.fy(v)}</text>`)
    .join("");
  const xTicks = Array.from({ length: 6 }, (_, i) => xmin + ((xmax - xmin) * i) / 5);
  const xl = xTicks.map((x, i) => `<text x="${X(x).toFixed(1)}" y="${H - 8}" class="axis" text-anchor="${i === 0 ? "start" : i === 5 ? "end" : "middle"}">${spec.fx(x)}</text>`).join("");
  const defs: string[] = [];
  const paths = spec.lines
    .map((l, i) => {
      const d = l.pts.map((p, k) => `${k ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
      let area = "";
      if (l.area) {
        defs.push(`<linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.color}" stop-opacity=".28"/><stop offset="1" stop-color="${l.color}" stop-opacity="0"/></linearGradient>`);
        const base = Y(Math.max(ymin, Math.min(ymax, spec.zeroBase ? 0 : ymin)));
        area = `<path d="${d}L${X(l.pts[l.pts.length - 1].x).toFixed(1)},${base.toFixed(1)}L${X(l.pts[0].x).toFixed(1)},${base.toFixed(1)}Z" fill="url(#g${i})"/>`;
      }
      return `${area}<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 2}" stroke-linejoin="round" stroke-linecap="round"${l.dash ? ' stroke-dasharray="5 5"' : ""}/>`;
    })
    .join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chart">
    <defs>${defs.join("")}</defs>${grid}${paths}${xl}
    <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
    ${spec.lines.map((l, i) => `<circle class="dot" data-dot="${i}" r="4" fill="${l.color}" visibility="hidden"/>`).join("")}
  </svg>`;
  chartGeom = { X, Y, xmin, xmax, W, H, m, spec };
}

function nearest(pts: Pt[], x: number): Pt {
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  return best;
}

function onChartMove(ev: MouseEvent) {
  if (!chartGeom) return;
  const svg = q("[data-chart] svg");
  const tip = q("[data-tip]");
  const r = svg.getBoundingClientRect();
  const { X, Y, xmin, xmax, W, m, spec } = chartGeom;
  const px = ((ev.clientX - r.left) / r.width) * W;
  if (px < m.l || px > W - m.r) return onChartLeave();
  const x = xmin + ((px - m.l) / (W - m.l - m.r)) * (xmax - xmin);
  const anchor = nearest(spec.lines[0].pts, x);
  const cross = svg.querySelector<SVGLineElement>(".cross")!;
  cross.setAttribute("x1", X(anchor.x).toFixed(1));
  cross.setAttribute("x2", X(anchor.x).toFixed(1));
  cross.setAttribute("visibility", "visible");
  const rows = spec.lines.map((l, i) => {
    const p = nearest(l.pts, anchor.x);
    const dot = svg.querySelector<SVGCircleElement>(`[data-dot="${i}"]`)!;
    dot.setAttribute("cx", X(p.x).toFixed(1));
    dot.setAttribute("cy", Y(p.y).toFixed(1));
    dot.setAttribute("visibility", "visible");
    return `<div class="tip-row"><span class="sw" style="background:${l.color}"></span><span>${l.name}</span><b>${spec.fy(p.y)}</b></div>`;
  });
  tip.innerHTML = `<div class="tip-head">${spec.fx(anchor.x)}</div>${rows.join("")}`;
  tip.hidden = false;
  const panel = q(".chart-panel").getBoundingClientRect();
  const left = ev.clientX - panel.left + 16;
  tip.style.left = `${Math.min(left, panel.width - tip.offsetWidth - 12)}px`;
  tip.style.top = `${ev.clientY - panel.top + 12}px`;
}

function onChartLeave() {
  q("[data-tip]").hidden = true;
  const svg = document.querySelector("[data-chart] svg");
  svg?.querySelectorAll(".cross, .dot").forEach((n) => n.setAttribute("visibility", "hidden"));
}

function seriesPts(id: SeriesId, days = 400): Pt[] {
  return MARKET.series[id].points.slice(-days).map(([d, v]) => ({ x: isoDate(d).getTime() / 86_400_000, y: v }));
}

function chartSpec(proj: Record<Strategy, Projection>): Spec {
  const strategy = life.book.strategy;
  if (tab === "payoff") {
    const order: Strategy[] = (["minimums", "snowball", "avalanche"] as Strategy[]).sort((a) => (a === strategy ? 1 : -1));
    return {
      lines: order.map((s) => ({
        name: STRATEGY_NAME[s],
        color: STRATEGY_COLOR[s],
        pts: proj[s].series.map((y, x) => ({ x, y })),
        dash: s === "minimums",
        area: s === strategy,
        width: s === strategy ? 2.5 : 1.5,
      })),
      fx: (x) => monthsAhead(x),
      fy: compact,
      zeroBase: true,
    };
  }
  if (tab === "networth") {
    const h = life.history;
    return {
      lines: [
        { name: "Net worth", color: GAME.green, pts: h.map((s) => ({ x: s.day, y: s.netWorth })), area: true, width: 3 },
        { name: "Debt", color: GAME.red, pts: h.map((s) => ({ x: s.day, y: s.debt })), width: 2 },
        { name: "Cash", color: GAME.blue, pts: h.map((s) => ({ x: s.day, y: s.cash })), width: 2 },
      ],
      fx: (x) => shortDate(dateOfDay(Math.round(x))),
      fy: compact,
      empty: "Press play or skip ahead to build a history.",
    };
  }
  if (tab === "sp500") {
    const src: [string, number][] = liveSpy ?? MARKET.series.SP500.points.slice(-260);
    const pts = src.map(([d, v]) => ({ x: isoDate(d).getTime() / 86_400_000, y: v }));
    const up = pts.length > 1 && pts[pts.length - 1].y >= pts[0].y;
    return {
      lines: [{ name: liveSpy ? "SPY" : "S&P 500", color: up ? GAME.green : GAME.red, pts, area: true, width: 2.5 }],
      fx: (x) => monthYear(new Date(x * 86_400_000)),
      fy: (y) => (liveSpy ? `$${y.toFixed(0)}` : y.toLocaleString("en-US", { maximumFractionDigits: 0 })),
    };
  }
  return {
    lines: [
      { name: "30-yr mortgage", color: GAME.violet, pts: seriesPts("MORTGAGE30US"), width: 2.5 },
      { name: "10-yr Treasury", color: GAME.blue, pts: seriesPts("DGS10"), width: 2.5 },
      { name: "Fed funds", color: GAME.yellow, pts: seriesPts("DFF"), width: 2.5 },
    ],
    fx: (x) => monthYear(new Date(x * 86_400_000)),
    fy: (y) => `${y.toFixed(2)}%`,
  };
}

// ---- Rendering ---------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app")!;
const q = <T extends Element = HTMLElement>(sel: string) => app.querySelector(sel) as unknown as T;

app.innerHTML = `
  <header class="top">
    <div class="brand"><span class="mark">L</span><div><div class="name">Larp City</div><div class="desk">Credit Desk</div></div></div>
    <div class="controls">
      <div class="views" role="group" aria-label="View"><button data-view="desk" class="on">Desk</button><button data-view="shop">Card Shop</button></div>
      <div class="seg" role="group" aria-label="Speed">
        <button data-speed="0" aria-label="Pause">❚❚</button>
        <button data-speed="1">1×</button>
        <button data-speed="2">2×</button>
        <button data-speed="4">4×</button>
      </div>
      <div class="seg" role="group" aria-label="Skip ahead">
        <button data-skip="7">+1W</button>
        <button data-skip="30">+1M</button>
        <button data-skip="365">+1Y</button>
      </div>
    </div>
    <div class="clock"><div class="clock-date" data-date></div><div class="clock-sub" data-sub></div></div>
    <div class="source" data-source></div>
  </header>
  <div class="tape" aria-label="Market tape"><div class="tape-track" data-tape></div></div>
  <main class="grid">
    <section class="kpis" data-kpis></section>

    <section class="panel chart-panel">
      <div class="panel-head">
        <div class="tabs" role="tablist">
          <button data-tab="payoff">Debt payoff</button>
          <button data-tab="networth">Net worth</button>
          <button data-tab="sp500">S&amp;P 500</button>
          <button data-tab="rates">Rates</button>
        </div>
        <div class="legend" data-legend></div>
      </div>
      <div class="chart" data-chart></div>
      <div class="tooltip" data-tip hidden></div>
    </section>

    <section class="panel strategy">
      <div class="panel-head"><h2>Payoff strategy</h2><span class="muted" data-free></span></div>
      <div class="seg wide" role="group" aria-label="Strategy">
        <button data-strategy="minimums">Minimums</button>
        <button data-strategy="snowball">Snowball</button>
        <button data-strategy="avalanche">Avalanche</button>
      </div>
      <label class="slider"><span>Extra each month</span><b data-extra-label></b>
        <input type="range" min="0" max="1500" step="25" data-extra />
      </label>
      <div class="cmp" data-cmp></div>
      <p class="note">Avalanche pays the highest APR first and costs the least. Snowball pays the smallest balance first and wins sooner, which is what keeps most people going.</p>
    </section>

    <section class="panel positions">
      <div class="panel-head"><h2>Liabilities</h2><span class="muted" data-min></span></div>
      <div class="table-wrap"><table data-positions></table></div>
    </section>

    <section class="panel rates">
      <div class="panel-head"><h2>Rates</h2><span class="muted" data-rates-src></span></div>
      <div data-rates></div>
      <button class="btn block" data-act="shock"></button>
    </section>

    <section class="panel credit">
      <div class="panel-head"><h2>Credit report</h2><span class="muted">FICO's five factors</span></div>
      <div data-credit></div>
    </section>

    <section class="panel feed">
      <div class="panel-head"><h2>Activity</h2><span class="muted" data-totals></span></div>
      <ol data-feed></ol>
    </section>

    <section class="panel scenario">
      <div class="panel-head"><h2>Scenarios</h2></div>
      <button class="btn block" data-act="layoff"></button>
      <label class="field"><span>Live in</span><select data-move>${MOVES.map((s) => `<option value="${s.abbr}">${s.name} · ${s.tier}</option>`).join("")}</select></label>
      <button class="btn block ghost" data-act="reset">Reset the run</button>
    </section>
  </main>
  <div class="shop" data-shop hidden></div>
  <footer class="foot" data-foot></footer>
  <div data-modal></div>
`;

// Card Shop (shop.ts): real cards to compare and apply for; approved cards join life.book.
const shop = mountShop({ root: q("[data-shop]"), life: () => life, clock, log, onChange: () => render() });
function setView(view: "desk" | "shop") {
  const inShop = view === "shop";
  q("main.grid").hidden = inShop;
  q("[data-foot]").hidden = inShop;
  q("[data-shop]").hidden = !inShop;
  app.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  if (inShop) shop.render();
  window.scrollTo(0, 0);
  // Always re-render: the chart measures its container, which is 0 px wide while hidden.
  render();
}

let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    render();
  }, 0);
}

function renderTop() {
  q("[data-date]").textContent = clock.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  q("[data-sub]").textContent = `Day ${clock.day} · ${life.place.name} · ${life.employed ? "Employed" : "Unemployed"}`;
  app.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === clock.speed));
}

function renderSource() {
  const live = liveQuotes && liveQuotes.quotes.length;
  q("[data-source]").innerHTML = live
    ? `<span class="live-dot"></span>Live · Alpha Vantage${liveQuotes!.cached ? " (cached)" : ""}`
    : `<span class="snap-dot"></span>FRED snapshot · ${shortDate(isoDate(MARKET.asOf))}`;
  q("[data-foot]").textContent = `Education, not financial advice. Rates and index history: FRED (as of ${shortDate(isoDate(MARKET.asOf))})${live ? "; ETF quotes: Alpha Vantage" : ""}. The simulation runs on Larp City's debt engine.`;
}

function renderTape() {
  const fred: Quote[] = (
    [
      ["SP500", "S&P 500"],
      ["NASDAQCOM", "Nasdaq"],
      ["DJIA", "Dow"],
      ["DFF", "Fed funds"],
      ["DGS10", "10Y UST"],
      ["MORTGAGE30US", "30Y mortgage"],
    ] as [SeriesId, string][]
  ).map(([id, name]) => {
    const l = latest(id);
    return { symbol: id, name, price: l.value, change: l.change, changePct: l.changePct, unit: MARKET.series[id].unit === "percent" ? "percent" : "index" };
  });
  const items = [...(liveQuotes?.quotes ?? []), ...fred]
    .map((t) => {
      const tone = toneOf(t.change);
      const value = t.unit === "percent" ? `${t.price.toFixed(2)}%` : t.unit === "usd" ? `$${t.price.toFixed(2)}` : num(t.price, 2);
      const chg = t.unit === "percent" ? `${t.change >= 0 ? "+" : "−"}${Math.abs(t.change * 100).toFixed(0)} bp` : `${t.change >= 0 ? "+" : "−"}${num(t.change, 2)} (${signedPct(t.changePct)})`;
      return `<span class="tick"><b>${t.name}</b><span class="px">${value}</span><span class="chg ${tone}">${tone === "up" ? "▲" : tone === "down" ? "▼" : "•"} ${chg}</span></span>`;
    })
    .join("");
  q("[data-tape]").innerHTML = `<div class="tape-row">${items}</div><div class="tape-row" aria-hidden="true">${items}</div>`;
}

function renderKpis(proj: Projection) {
  const nw = life.netWorth();
  const delta = nw - startNetWorth;
  const debt = life.totalDebt();
  const score = life.book.profile.score;
  const dti = life.dti();
  const free = debt <= 0.5 ? "Debt-free" : proj.stuck ? "Never" : monthsAhead(proj.months);
  const scorePos = Math.max(0, Math.min(100, ((score - 300) / 550) * 100));
  q("[data-kpis]").innerHTML = `
    <div class="kpi hero"><div class="k-label">Net worth</div><div class="k-value">${usd(nw)}</div><div class="k-sub ${toneOf(delta)}">${signedUsd(delta)} this run</div></div>
    <div class="kpi"><div class="k-label">Cash</div><div class="k-value">${usd(life.cash())}</div><div class="k-sub">Rent ${usd(life.rent)}/mo in ${life.place.abbr}</div></div>
    <div class="kpi"><div class="k-label">Total debt</div><div class="k-value">${usd(debt)}</div><div class="k-sub">${usd(life.minimums())}/mo in minimums</div></div>
    <div class="kpi"><div class="k-label">Credit score</div><div class="k-value">${score}<span class="k-band">${life.scoreBand()}</span></div><div class="score-bar"><span style="left:${scorePos}%"></span></div></div>
    <div class="kpi"><div class="k-label">Debt-free</div><div class="k-value">${free}</div><div class="k-sub">${STRATEGY_NAME[life.book.strategy]}${life.book.strategy === "minimums" ? "" : ` + ${usd(life.book.extraMonthly)}/mo`}</div></div>
    <div class="kpi"><div class="k-label">Debt-to-income</div><div class="k-value ${dti > 0.36 ? "down" : ""}">${pct(dti, 1)}</div><div class="k-sub">${dti > 0.36 ? "Above the 36% lenders like" : "Minimums ÷ take-home"}</div></div>`;
}

function renderChart(proj: Record<Strategy, Projection>) {
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const spec = chartSpec(proj);
  q("[data-legend]").innerHTML = spec.lines
    .map((l) => `<span class="lg"><span class="sw${l.dash ? " dash" : ""}" style="background:${l.color}"></span>${l.name}</span>`)
    .join("");
  drawChart(spec);
}

function renderStrategy(proj: Record<Strategy, Projection>) {
  const s = life.book.strategy;
  app.querySelectorAll<HTMLButtonElement>("[data-strategy]").forEach((b) => b.classList.toggle("on", b.dataset.strategy === s));
  const slider = q<HTMLInputElement>("[data-extra]");
  if (document.activeElement !== slider) slider.value = String(life.book.extraMonthly);
  q("[data-extra-label]").textContent = `${usd(life.book.extraMonthly)}`;
  const p = proj[s];
  q("[data-free]").textContent = life.totalDebt() <= 0.5 ? "Debt-free" : p.stuck ? "Not at this pace" : `Debt-free ${monthsAhead(p.months)}`;
  q("[data-cmp]").innerHTML = (["minimums", "snowball", "avalanche"] as Strategy[])
    .map((k) => {
      const pr = proj[k];
      return `<div class="cmp-row${k === s ? " on" : ""}">
        <span class="sw" style="background:${STRATEGY_COLOR[k]}"></span>
        <span class="cmp-name">${STRATEGY_NAME[k]}</span>
        <span class="cmp-num">${pr.stuck ? "—" : `${(pr.months / 12).toFixed(1)} yr`}</span>
        <span class="cmp-num">${compact(pr.interest)}</span>
        <span class="cmp-num dim">m${pr.payoffs[0]?.month ?? "—"}</span>
      </div>`;
    })
    .join("");
}

function statusChip(d: Debt): string {
  if (d.status === "paid") return `<span class="chip up">Paid off</span>`;
  if (d.status === "discharged") return `<span class="chip flat">Discharged</span>`;
  if (d.status === "collections") return `<span class="chip dark">Collections</span>`;
  if (d.status === "default") return `<span class="chip dark">Default</span>`;
  const late = d.pastDueSince === null ? 0 : clock.day - d.pastDueSince;
  if (late >= 30) return `<span class="chip down">${late}d late</span>`;
  if (late > 0 || d.pastDue > 0) return `<span class="chip warn">${late ? `${late}d late` : "Missed"}</span>`;
  if (d.hardshipAprUntil !== undefined && clock.day < d.hardshipAprUntil) return `<span class="chip info">Hardship</span>`;
  return `<span class="chip up">Current</span>`;
}

function aprNow(d: Debt): number {
  if (d.hardshipAprUntil !== undefined && clock.day < d.hardshipAprUntil) return d.hardshipApr ?? d.aprAnnual;
  if (d.penaltyApr) return Math.max(d.aprAnnual, 0.2999);
  if (d.promoUntil !== undefined && clock.day < d.promoUntil) return d.promoApr ?? d.aprAnnual;
  return d.aprAnnual;
}

function nextDue(d: Debt): string {
  if (!isOpen(d) || d.status === "collections") return "—";
  if (d.kind === "credit_card") return d.statementDueDay !== undefined && d.statementDueDay >= clock.day ? shortDate(dateOfDay(d.statementDueDay)).replace(/, \d{4}$/, "") : "Next cycle";
  const due = clock.date;
  if (due.getDate() > d.dueDayOfMonth) due.setMonth(due.getMonth() + 1);
  due.setDate(d.dueDayOfMonth);
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderPositions() {
  const rows = life.book.debts
    .map((d) => {
      const start = original.get(d.id) ?? owed(d);
      const paid = start > 0 ? Math.max(0, Math.min(1, 1 - owed(d) / start)) : 1;
      const min = d.kind === "credit_card" ? d.minimumDue ?? 0 : d.scheduledPayment ?? 0;
      const util = d.creditLimit ? ` · ${pct(owed(d) / d.creditLimit, 0)} used` : "";
      return `<tr class="${isOpen(d) ? "" : "closed"}">
        <td><div class="pos-name">${d.name}</div><div class="pos-sub">${KIND_NAME[d.kind]}${d.plan === "rap" ? " · RAP" : ""}${util}</div></td>
        <td class="num">${usd(owed(d), 2)}<div class="bar"><span style="width:${(paid * 100).toFixed(1)}%"></span></div></td>
        <td class="num">${pct(aprNow(d))}</td>
        <td class="num">${isOpen(d) ? usd(min, 2) : "—"}</td>
        <td class="num dim">${nextDue(d)}</td>
        <td>${statusChip(d)}</td>
        <td class="act"><button class="btn tiny" data-pay="${d.id}" ${isOpen(d) && d.status !== "collections" && life.cash() >= 100 ? "" : "disabled"}>Pay $100</button></td>
      </tr>`;
    })
    .join("");
  const open = life.book.debts.filter(isOpen);
  const total = open.reduce((s, d) => s + owed(d), 0);
  const weighted = total > 0 ? open.reduce((s, d) => s + owed(d) * aprNow(d), 0) / total : 0;
  const foot = `<tfoot><tr><td><div class="pos-name">Total</div><div class="pos-sub">Balance-weighted APR</div></td><td class="num">${usd(total, 2)}</td><td class="num">${pct(weighted)}</td><td class="num">${usd(life.minimums(), 2)}</td><td class="num dim">${usd(life.book.interestPaid)} interest paid</td><td colspan="2"></td></tr></tfoot>`;
  q("[data-positions]").innerHTML = `<thead><tr><th>Liability</th><th class="num">Balance</th><th class="num">APR</th><th class="num">Min / mo</th><th class="num">Next due</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody>${foot}`;
  q("[data-min]").textContent = `${life.book.debts.filter(isOpen).length} open · ${usd(life.minimums())}/mo`;
}

function renderRates() {
  const cash = seriesOn("DFF", clock.date) / 100 + rateShock;
  const score = life.book.profile.score;
  const card = life.book.debts.find((d) => d.kind === "credit_card" && isOpen(d));
  const rows: [string, string, string][] = [
    ["Fed funds (effective)", pct(cash), rateShock ? "shocked +1.00" : "FRED DFF"],
    ["Prime rate", pct(primeRate(cash)), "Fed funds + 3"],
    ["Your card APR", card ? pct(aprNow(card)) : "—", card ? "resets on the 1st" : ""],
    [`Auto loan at ${score}`, pct(offeredApr("auto", score, cash)), "score-priced"],
    ["30-yr mortgage", pct(seriesOn("MORTGAGE30US", clock.date) / 100 + rateShock), "Freddie Mac"],
    ["10-yr Treasury", pct(seriesOn("DGS10", clock.date) / 100), "FRED DGS10"],
  ];
  q("[data-rates]").innerHTML = rows.map(([k, v, s]) => `<div class="rate"><span class="r-name">${k}</span><span class="r-src">${s}</span><span class="r-val">${v}</span></div>`).join("");
  q("[data-rates-src]").textContent = `as of ${shortDate(isoDate(MARKET.asOf))}`;
  const b = q<HTMLButtonElement>("[data-act='shock']");
  b.textContent = rateShock ? "Undo the rate shock" : "Rate shock: Fed +1.00 point";
  b.classList.toggle("warn", rateShock > 0);
}

function renderCredit() {
  const b = scoreBreakdown(life.book.profile, life.book.debts, clock.day, life.book.profile.historyStartDay);
  const rows: [string, number, number, string][] = [
    ["Payment history", b.payment, WEIGHTS.payment, `${life.book.profile.lateMarks.length} late marks`],
    ["Amounts owed", b.amounts, WEIGHTS.amounts, `${pct(b.utilization, 0)} utilization`],
    ["Length of history", b.length, WEIGHTS.length, "avg account age"],
    ["New credit", b.newCredit, WEIGHTS.newCredit, `${life.book.profile.inquiries.length} inquiries`],
    ["Credit mix", b.mix, WEIGHTS.mix, "revolving + installment"],
  ];
  q("[data-credit]").innerHTML = rows
    .map(
      ([name, v, w, note]) => `<div class="factor"><div class="f-top"><span>${name} <em>${Math.round(w * 100)}%</em></span><span class="f-note">${note}</span></div>
      <div class="f-bar"><span class="${v >= 0.8 ? "up" : v >= 0.5 ? "warn" : "down"}" style="width:${(v * 100).toFixed(0)}%"></span></div></div>`,
    )
    .join("");
}

function renderFeed() {
  q("[data-totals]").textContent = `Interest ${usd(life.book.interestPaid)} · fees ${usd(life.book.feesPaid)}`;
  q("[data-feed]").innerHTML = feed.length
    ? feed
        .slice(0, 40)
        .map((f) => `<li><span class="f-date">${dateOfDay(f.day).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}</span><span class="tag ${f.tone}">${f.tag}</span><span class="f-text">${f.text}</span></li>`)
        .join("")
    : `<li class="empty">Press play or skip ahead. Paychecks land on the 1st and 15th, rent on the 1st.</li>`;
}

function renderScenario() {
  const b = q<HTMLButtonElement>("[data-act='layoff']");
  b.textContent = life.employed ? "Get laid off" : "Find a new job";
  b.classList.toggle("warn", !life.employed);
  const sel = q<HTMLSelectElement>("[data-move]");
  if (document.activeElement !== sel) sel.value = life.place.abbr;
}

function renderModal() {
  q("[data-modal]").innerHTML = decision
    ? `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="dec-title">
        <div class="modal-tag">Time paused</div>
        <h3 id="dec-title">${decision.title}</h3>
        <p>${decision.body}</p>
        <div class="options">${decision.options.map((o, i) => `<button class="opt ${o.tone ?? ""}" data-option="${i}"><span class="opt-label">${o.label}</span><span class="opt-lesson">${o.lesson}</span></button>`).join("")}</div>
      </div></div>`
    : "";
}

function render() {
  const proj = compareStrategies(life.book.debts, life.book.extraMonthly);
  renderTop();
  renderKpis(proj[life.book.strategy]);
  renderChart(proj);
  renderStrategy(proj);
  renderPositions();
  renderRates();
  renderCredit();
  renderFeed();
  renderScenario();
  renderModal();
  shop.refresh();
}

// ---- Input -------------------------------------------------------------------

function skip(days: number) {
  clock.skipping = true;
  for (let i = 0; i < days && !decision; i++) clock.advanceDays(1);
  clock.skipping = false;
  render();
}

app.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("button");
  if (!el) return;
  const { speed, skip: skipDays, tab: nextTab, strategy, pay, act, option } = el.dataset;
  if (option !== undefined && decision) {
    decision.options[Number(option)].act();
    closeDecision();
    return;
  }
  if (decision) return;
  if (el.dataset.view) return setView(el.dataset.view as "desk" | "shop");
  if (speed !== undefined) clock.speed = Number(speed);
  if (skipDays) return skip(Number(skipDays));
  if (nextTab) {
    tab = nextTab as Tab;
    if (tab === "sp500") void loadSpy();
  }
  if (strategy) life.book.strategy = strategy as Strategy;
  if (pay) {
    for (const e of payNow(life.book, pay, 100, ctxNow())) if (e.type === "payment") log(clock.day, "PAY", `Extra ${usd(e.amount)} to ${life.book.debts.find((d) => d.id === pay)?.name}`, "info");
  }
  if (act === "layoff") life.setEmployed(!life.employed, clock.day);
  if (act === "shock") {
    rateShock = rateShock ? 0 : 0.01;
    log(clock.day, "FED", rateShock ? "Rate shock: the Fed raises a full point; variable APRs reset on the 1st" : "Rates back to the FRED path", rateShock ? "down" : "up");
  }
  if (act === "reset") {
    feed.length = 0;
    rateShock = 0;
    life = makeLife();
    startNetWorth = life.netWorth();
    original = originals();
  }
  render();
});

app.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.extra === undefined) return;
  life.book.extraMonthly = Number(el.value);
  render();
});

app.addEventListener("change", (ev) => {
  const el = ev.target as HTMLSelectElement;
  if (el.dataset.move === undefined) return;
  const next = STATES.find((s) => s.abbr === el.value);
  if (next && next.abbr !== life.place.abbr) life.setPlace(next, clock.day);
  render();
});

window.addEventListener("keydown", (ev) => {
  if (ev.code !== "Space" || decision || (ev.target as HTMLElement).closest("input, select, button")) return;
  ev.preventDefault();
  clock.speed = clock.speed ? 0 : resumeSpeed || 1;
  render();
});

const chartEl = q("[data-chart]");
chartEl.addEventListener("mousemove", onChartMove);
chartEl.addEventListener("mouseleave", onChartLeave);
window.addEventListener("resize", () => render());

// ---- Live market data (optional) ----------------------------------------------

async function loadLive() {
  try {
    const res = await fetch("/api/market/quotes?symbols=SPY,QQQ,DIA,IWM");
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { cached: boolean; quotes: { symbol: string; price: number; change: number; changePct: number }[] };
    const quotes = j.quotes.filter((x) => Number.isFinite(x.price) && x.price > 0).map((x) => ({ ...x, name: x.symbol, unit: "usd" as const }));
    liveQuotes = quotes.length ? { quotes, cached: j.cached } : null;
  } catch {
    liveQuotes = null;
  }
  renderTape();
  renderSource();
}

async function loadSpy() {
  if (!liveQuotes || liveSpy) return;
  try {
    const res = await fetch("/api/market/daily?symbol=SPY");
    if (res.ok) {
      const j = (await res.json()) as { points?: [string, number][] };
      if (j.points && j.points.length > 10) liveSpy = j.points;
    }
  } catch {
    // Keep the FRED S&P 500 series.
  }
  if (tab === "sp500") render();
}

// ---- Start -------------------------------------------------------------------

clock.onDay((day) => life.onDay(day, clock.date));
clock.speed = 1;
let last = performance.now();
function frame(now: number) {
  clock.update(Math.min(0.25, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
}
renderTape();
renderSource();
render();
requestAnimationFrame(frame);
void loadLive();
void LIVE_NAMES;
