// Money desk (/debt.html): the player's money in Robinhood's shape. Home shows
// net worth as one big number over one scrubbable chart, then rows that open
// Cash, Investing, Debt, Credit, and Cards. Each tab repeats the pattern: a big
// number, one chart, one suggested move, then rows. It runs the same
// PlayerLife the city scene runs (paychecks, rent for the state, the accounts
// ledger, the debt engine, and brokerage holdings on the seeded market path)
// on the game's Clock. Research: research/12-credit-desk-ui.md.

import "./desk.css";
import { mountBigChart, spark, thin, type ChartPt, type ChartLine } from "./chart.ts";
import { mountShop } from "./shop.ts";
import type { MoneyHost } from "../ui/phone.ts";
import { Clock } from "../engine/clock.ts";
import { MARKET } from "../data/market.ts";
import { STATES } from "../data/states.ts";
import { PlayerLife, STARTER_PORTFOLIO, seriesOn, type LifeEvent, type LifeSnapshot } from "../sim/life/index.ts";
import { INSTRUMENTS, MarketPath, instrument, type InstrumentId } from "../sim/market/index.ts";
import { fetchRecoveryLesson } from "../net/recap.ts";
import { RunRecorder } from "../sim/record/index.ts";
import {
  compareStrategies,
  enrollHardship,
  fileBankruptcy,
  isOpen,
  owed,
  payNow,
  scoreBreakdown,
  switchToRap,
  WEIGHTS,
  type Debt,
  type Strategy,
} from "../sim/debt/index.ts";

type Tab = "home" | "cash" | "investing" | "debt" | "credit" | "cards";
type Range = "1W" | "1M" | "3M" | "1Y" | "ALL";
type Tone = "up" | "down" | "flat";
interface FeedItem {
  day: number;
  text: string;
  amount?: number;
  tone: Tone;
}
/** One line on the Cash tab's bank statement: money into or out of cash, or a move between cash accounts. */
interface BankTxn {
  day: number;
  name: string;
  category: string;
  icon: string;
  amount: number;
  kind: "in" | "out" | "move";
}
interface Decision {
  title: string;
  body: string;
  options: { label: string; lesson: string; good?: boolean; act: () => void }[];
}
interface ChartSpec {
  pts: ChartPt[];
  lines?: ChartLine[];
  zero?: boolean;
  baseline?: boolean;
  minSpan?: number;
  tone: Tone;
  rest: ChartPt;
  fmt: (y: number) => string;
  change: (p: ChartPt, scrubbing: boolean) => string;
  label: (p: ChartPt) => string;
  mainLabel?: string;
}
interface Page {
  main: string;
  side: boolean;
  chart?: ChartSpec;
  tone?: Tone;
}

const HOME = STATES.find((s) => s.abbr === "TX")!;
const MOVES = ["TX", "CA", "NY", "FL", "OH", "WA", "CO"].map((a) => STATES.find((s) => s.abbr === a)!).filter(Boolean);
const TABS: [Tab, string][] = [
  ["home", "Home"],
  ["cash", "Cash"],
  ["investing", "Investing"],
  ["debt", "Debt"],
  ["credit", "Credit"],
  ["cards", "Cards"],
];
const RANGE_DAYS: Record<Range, number> = { "1W": 7, "1M": 30, "3M": 91, "1Y": 365, ALL: Infinity };
const RANGE_LABEL: Record<Range, string> = { "1W": "Past week", "1M": "Past month", "3M": "Past 3 months", "1Y": "Past year", ALL: "All time" };
const STRATEGY_NAME: Record<Strategy, string> = { minimums: "Minimums only", snowball: "Snowball", avalanche: "Avalanche" };
const KIND_NAME: Record<Debt["kind"], string> = {
  credit_card: "Credit card",
  student_federal: "Federal student loan",
  auto: "Auto loan",
  personal: "Personal loan",
  mortgage: "Mortgage",
  bnpl: "Buy now, pay later",
  payday: "Payday loan",
  medical: "Medical bill",
};
/** Long-run stock market return, for the "pay debt or invest?" comparison (research/03). */
const MARKET_RETURN = 0.1;

// Inside the city (the phone's Money window) the desk shows the city player's life on the
// city's clock; opened on its own (/debt.html) it runs a standalone life.
const host: MoneyHost | undefined = (() => {
  try {
    return window.parent !== window ? (window.parent as unknown as { larpMoney?: MoneyHost }).larpMoney : undefined;
  } catch {
    return undefined;
  }
})();
const clock = host?.clock ?? new Clock();
const market = host?.life().market ?? new MarketPath();
let rateShock = 0;
let life = host ? host.life() : makeLife();
if (host) life.onEvents(onLifeEvents);
// Standalone, the desk records its own run in Tiger Data; inside the city, the city's recorder already records this life.
const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
let recorder = host ? null : startRecorder();

function startRecorder(): RunRecorder {
  const r = new RunRecorder({ life, seed: market.seed, base: API_BASE });
  void r.begin();
  return r;
}
const feed: FeedItem[] = [];
let decision: Decision | null = null;
let resumeSpeed = 1;
let tab: Tab = "home";
let range: Range = "1M";
let fund: InstrumentId | null = null;
let cardId: string | null = null;
let amount = 100;
let tradeMsg: { text: string; bad: boolean } | null = null;
let menuOpen = false;
let shopShown = false;
/** The last bear market and what the player chose, for the recovery card and the recap. */
let crash: { day: number; drop: number; choice: string } | null = null;
/** The last recovery: how the three lines came through. */
let recovery: { day: number; you: number; held: number; autopilot: number } | null = null;
/** Gemini's lesson for the last recovery, when the server has one. */
let recap: { headline: string; lesson: string } | null = null;
const bank: BankTxn[] = [];
let xferOpen = false;
const xfer = { from: "checking", to: "savings", amount: 100 };
let xferMsg: { text: string; bad: boolean } | null = null;

function makeLife(): PlayerLife {
  const l = new PlayerLife({ place: HOME, day: clock.day, market, cashRate: (d) => seriesOn("DFF", d) / 100 + rateShock, holdings: STARTER_PORTFOLIO });
  l.onEvents(onLifeEvents);
  return l;
}

// ---- Formatting ----------------------------------------------------------------

const num = (n: number, d = 0) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number, d = 0) => `${n < 0 ? "−" : ""}$${num(n, d)}`;
const signedUsd = (n: number, d = 2) => `${n >= 0 ? "+" : "−"}$${num(n, d)}`;
const pctOf = (f: number, d = 2) => `${(f * 100).toFixed(d)}%`;
const signedPct = (f: number, d = 2) => `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(d)}%`;
/** "24%" or "6.9%": enough precision to tell rates apart without APR noise. */
const rate = (f: number) => `${(f * 100).toFixed(f >= 0.1 ? 0 : 1).replace(/\.0$/, "")}%`;
const dateOf = (day: number) => {
  const d = new Date(clock.start);
  d.setDate(d.getDate() + day);
  return d;
};
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const monthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
// Balances are rounded to cents and changes are often fractions (0.0024 = 0.24%), so only
// a true zero reads as flat.
const dirTone = (delta: number, goodWhenUp = true): Tone => (Math.abs(delta) < 1e-6 ? "flat" : delta > 0 === goodWhenUp ? "up" : "down");

// ---- Events --------------------------------------------------------------------

function log(day: number, text: string, tone: Tone, amt?: number) {
  feed.unshift({ day, text, tone, amount: amt });
  if (feed.length > 120) feed.length = 120;
}

function bankLog(t: BankTxn) {
  if (Math.abs(t.amount) < 0.005) return;
  bank.unshift(t);
  if (bank.length > 300) bank.length = 300;
}

const debtIcon = (d?: Debt) => (d?.kind === "credit_card" ? "💳" : d?.kind === "student_federal" ? "🎓" : d?.kind === "auto" ? "🚗" : "🧾");

function onLifeEvents(events: LifeEvent[]) {
  for (const e of events) {
    const d = "debtId" in e ? life.book.debts.find((x) => x.id === e.debtId) : undefined;
    switch (e.type) {
      case "paycheck":
        log(e.day, `Paycheck${e.unemployed ? " (unemployment)" : ""}${e.garnished ? `, ${usd(e.garnished)} garnished` : ""}`, "up", e.takeHome);
        bankLog({ day: e.day, name: e.unemployed ? "Unemployment benefits" : "Payroll direct deposit", category: "Income", icon: "💼", amount: e.takeHome, kind: "in" });
        break;
      case "bill": {
        const short = e.amount - e.paid;
        log(e.day, `${e.name}${short > 0.5 ? `, short by ${usd(short)}` : ""}`, short > 0.5 ? "down" : "flat", -e.paid);
        const rent = e.name === "Rent";
        bankLog({ day: e.day, name: rent ? "Rent" : "Groceries, gas, and bills", category: rent ? "Housing" : "Living costs", icon: rent ? "🏠" : "🛒", amount: -e.paid, kind: "out" });
        break;
      }
      case "savings_interest":
        log(e.day, "Savings interest", "up", e.amount);
        bankLog({ day: e.day, name: "Interest paid", category: "Savings interest", icon: "💰", amount: e.amount, kind: "in" });
        break;
      case "payment":
        bankLog({ day: e.day, name: d?.name ?? "Loan payment", category: d?.kind === "credit_card" ? "Card payment" : "Loan payment", icon: debtIcon(d), amount: -e.amount, kind: "out" });
        break;
      case "moved":
        log(e.day, `Moved to ${e.to}: rent is now ${usd(e.rent)} a month`, "flat");
        break;
      case "job":
        log(e.day, e.employed ? "Back at work: full paychecks resume" : "Laid off: unemployment pays about 40% of take-home", e.employed ? "up" : "down");
        break;
      case "trade":
        log(e.day, `${e.side === "buy" ? "Bought" : "Sold"} ${e.id}${e.recurring ? " (auto-invest)" : ""}`, e.side === "buy" ? "flat" : "up", e.side === "buy" ? -e.amount : e.amount);
        bankLog({ day: e.day, name: `${e.side === "buy" ? "Bought" : "Sold"} ${e.id}`, category: e.recurring ? "Auto-invest" : "Investing", icon: "📈", amount: e.side === "buy" ? -e.amount : e.amount, kind: e.side === "buy" ? "out" : "in" });
        break;
      case "trade_skipped":
        log(e.day, `Auto-invest skipped: ${e.reason.toLowerCase()}`, "down");
        break;
      case "missed":
        log(e.day, `Missed the ${d?.name ?? ""} payment${e.fee ? ` and paid a ${usd(e.fee)} late fee` : ""}`, "down", e.fee ? -e.fee : undefined);
        break;
      case "cannot_cover":
        if (!decision && d) askCannotCover(d, e.due, e.available);
        break;
      case "late_mark":
        log(e.day, `${d?.name} reported ${e.severity} days late; score ${e.scoreBefore} → ${e.scoreAfter}`, "down");
        break;
      case "penalty_apr":
        log(e.day, `${d?.name} now charges a ${rate(e.apr)} penalty rate`, "down");
        break;
      case "repossessed":
        log(e.day, `Car repossessed; ${usd(e.deficiency)} is still owed`, "down");
        break;
      case "collections":
        log(e.day, `${d?.name} was sold to a debt collector`, "down");
        break;
      case "default":
        log(e.day, `${d?.name} defaulted; 15% of each paycheck will be garnished`, "down");
        break;
      case "paid_off":
        log(e.day, `${e.name} paid off! Its payment now goes to the next debt`, "up");
        break;
      case "score_change":
        if (Math.abs(e.to - e.from) >= 3) log(e.day, `Credit score ${e.from} → ${e.to}`, e.to > e.from ? "up" : "down");
        break;
      case "bankruptcy_eligible":
        if (!decision) askBankruptcy(e.reason);
        break;
      case "bear_market":
        log(e.day, `Stocks are down ${pctOf(e.drop, 0)} from their high`, "down");
        if (!decision) askBearMarket(e.day, e.drop, e.stocks);
        break;
      case "market_recovered":
        log(e.day, "Stocks are back at their high", "up");
        recovery = { day: e.day, you: e.you, held: e.held, autopilot: e.autopilot };
        recap = null;
        void askRecap(e.day);
        break;
      default:
        break;
    }
  }
  scheduleRender();
}

// ---- Actions -------------------------------------------------------------------

function ctxNow() {
  return { day: clock.day, date: clock.date, env: { cashRateAnnual: seriesOn("DFF", clock.date) / 100 + rateShock }, wallet: life.ledger.wallet() };
}

function pay(debtId: string, amt: number) {
  const debt = life.book.debts.find((d) => d.id === debtId);
  const name = debt?.name ?? "debt";
  let paid = 0;
  for (const e of payNow(life.book, debtId, amt, ctxNow())) if (e.type === "payment") paid += e.amount;
  if (paid > 0) {
    log(clock.day, `Extra payment to ${name}`, "flat", -paid);
    bankLog({ day: clock.day, name, category: "Extra payment", icon: debtIcon(debt), amount: -paid, kind: "out" });
  }
}

function fundEmergency(amt: number) {
  const ctx = { day: clock.day, date: clock.date, age: life.age };
  const from = life.ledger.get("savings").balance >= amt ? "savings" : "checking";
  try {
    life.ledger.transfer(from, "emergency", amt, "internal", ctx);
    log(clock.day, `Moved ${usd(amt)} to the emergency fund`, "flat");
    bankLog({ day: clock.day, name: "Transfer to Emergency fund", category: `From ${life.ledger.get(from).name}`, icon: "↔", amount: amt, kind: "move" });
  } catch {
    // The quote failed (not enough money); the card stays as it was.
  }
}

// ---- Decisions -----------------------------------------------------------------

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
      lesson: "Most lenders lower the rate or skip a payment if you call before you're 30 days late.",
      good: true,
      act: () => {
        enrollHardship(life.book, d.id, clock.day);
        log(clock.day, `${d.name}: hardship plan at 9% for 6 months`, "up");
      },
    });
  }
  if (d.kind === "student_federal" && d.plan !== "rap") {
    options.push({
      label: "Switch to the Repayment Assistance Plan",
      lesson: "Income-driven payments can drop to $10 a month, and the balance still falls.",
      good: true,
      act: () => {
        switchToRap(life.book, d.id);
        log(clock.day, `${d.name} moved to an income-driven plan`, "up");
      },
    });
  }
  options.push({
    label: "Let it slide for now",
    lesson: "At 30 days it's reported and your score drops; at 60 days a card's rate jumps to 30%.",
    act: () => log(clock.day, `You let the ${d.name} payment slide`, "down"),
  });
  openDecision({ title: `You can't cover the ${d.name} payment`, body: `${usd(due)} is due, and all your cash together is ${usd(available)}.`, options });
}

function askBankruptcy(reason: string) {
  openDecision({
    title: "Bankruptcy is now an option",
    body: reason,
    options: [
      {
        label: "File Chapter 7",
        lesson: "Wipes cards and personal loans in about 4 months. Student loans stay. It's on your report for 10 years.",
        act: () => {
          const r = fileBankruptcy(life.book, 7, clock.day);
          log(clock.day, `Chapter 7: ${usd(r.discharged)} wiped out`, "down", -r.cost);
        },
      },
      {
        label: "File Chapter 13",
        lesson: "A 5-year plan repays part of it and you keep your car. It's on your report for 7 years.",
        act: () => {
          const r = fileBankruptcy(life.book, 13, clock.day);
          log(clock.day, `Chapter 13 plan: ${usd(r.planPayment ?? 0)} a month for 5 years`, "down");
        },
      },
      { label: "Keep paying what I can", lesson: "Nonprofit credit counseling can still set up a debt management plan.", good: true, act: () => log(clock.day, "You kept paying what you could", "flat") },
    ],
  });
}

function askBearMarket(day: number, drop: number, stocks: number) {
  const spare = Math.floor(Math.max(0, life.ledger.get("checking").balance - life.monthlyExpenses()));
  const more = Math.min(500, spare);
  const choose = (choice: string) => {
    crash = { day, drop, choice };
    log(clock.day, `In the crash, you ${choice}`, "flat");
  };
  /** Sells all or half of each stock holding; returns the dollars actually sold (tiny legs under the $1 minimum are skipped). */
  const sellStocks = (share: 1 | 0.5): number => {
    let sold = 0;
    for (const id of ["LTM", "NNST"] as InstrumentId[]) {
      const pos = life.position(id);
      if (!pos) continue;
      const r = life.sell(id, share === 1 ? "all" : pos.value * share);
      if (r.ok && r.event.type === "trade") sold += r.event.amount;
    }
    return sold;
  };
  const options: Decision["options"] = [
    {
      label: "Sell everything",
      lesson: "Locks in the loss. The best days usually come right after the worst.",
      act: () => {
        const sold = sellStocks(1);
        choose(sold > 0 ? `sold everything (${usd(sold)})` : "held");
      },
    },
    {
      label: "Sell half",
      lesson: "Halves the pain and halves the rebound.",
      act: () => {
        const sold = sellStocks(0.5);
        choose(sold > 0 ? `sold half (${usd(sold)})` : "held");
      },
    },
    { label: "Hold", lesson: "So far, every US bear market has recovered, and holders got the whole rebound.", good: true, act: () => choose("held") },
  ];
  if (more >= 1)
    options.push({
      label: `Buy ${usd(more)} more`,
      lesson: "Stocks are on sale. It works if you won't need this money for years.",
      act: () => {
        const r = life.buy("LTM", more);
        choose(r.ok ? `bought ${usd(more)} more` : "held");
      },
    });
  openDecision({ title: `Stocks are down ${pctOf(drop, 0)} from their high`, body: `Your stocks are worth ${usd(stocks)} now. This is a bear market. What do you do?`, options });
}

/**
 * Asks the coach for the recovery lesson. The server reads the run from Tiger Data, so the day's
 * events have to be there first: this desk hears market_recovered before the run recorder does
 * (both listen to the same life), so wait a tick, then send everything, then ask.
 * Inside the city, the city's recorder owns the run, so only the standalone desk asks.
 */
async function askRecap(day: number) {
  const r = recorder;
  if (!r?.runId) return;
  await Promise.resolve();
  await r.idle();
  await r.tick(true);
  const got = await fetchRecoveryLesson(r.runId, day);
  // A newer recovery (or a reset) may have replaced this one while the request was out.
  if (got && recovery?.day === day && recorder === r) {
    recap = { headline: got.headline, lesson: got.tip };
    scheduleRender();
  }
}

// ---- Debt helpers ------------------------------------------------------------------

function aprNow(d: Debt): number {
  if (d.hardshipAprUntil !== undefined && clock.day < d.hardshipAprUntil) return d.hardshipApr ?? d.aprAnnual;
  if (d.penaltyApr) return Math.max(d.aprAnnual, 0.2999);
  if (d.promoUntil !== undefined && clock.day < d.promoUntil) return d.promoApr ?? d.aprAnnual;
  return d.aprAnnual;
}

/** The next date a payment is due, or null for closed debts and collections. */
function nextDue(d: Debt): Date | null {
  if (!isOpen(d) || d.status === "collections") return null;
  if (d.kind === "credit_card") return d.statementDueDay !== undefined && d.statementDueDay >= clock.day ? dateOf(d.statementDueDay) : null;
  const due = clock.date;
  if (due.getDate() > d.dueDayOfMonth) due.setMonth(due.getMonth() + 1);
  due.setDate(d.dueDayOfMonth);
  return due;
}

const minPayment = (d: Debt) => (d.kind === "credit_card" ? d.minimumDue ?? 0 : d.scheduledPayment ?? 0);

function statusChip(d: Debt): string {
  if (d.status === "paid") return `<span class="chip good">Paid off</span>`;
  if (d.status === "discharged") return `<span class="chip">Discharged</span>`;
  if (d.status === "collections") return `<span class="chip warn">Collections</span>`;
  if (d.status === "default") return `<span class="chip warn">Default</span>`;
  const late = d.pastDueSince === null ? 0 : clock.day - d.pastDueSince;
  if (late > 0 || d.pastDue > 0) return `<span class="chip warn">${late ? `${late} days late` : "Missed"}</span>`;
  if (d.hardshipAprUntil !== undefined && clock.day < d.hardshipAprUntil) return `<span class="chip">Hardship plan</span>`;
  return "";
}

function freeDate(): string {
  if (life.totalDebt() <= 0.5) return "now";
  const p = life.projection();
  if (p.stuck) return "never at this pace";
  const d = clock.date;
  d.setMonth(d.getMonth() + p.months);
  return monthYear(d);
}

// ---- Series --------------------------------------------------------------------

function hist(key: keyof Omit<LifeSnapshot, "day">): ChartPt[] {
  const from = clock.day - RANGE_DAYS[range];
  // Before the run began, the starting balances ride the real market on trading days, like the market chart.
  const past = life.pastSnapshots(from).filter((h) => !weekend(h.day));
  return thin([...past, ...life.history.filter((h) => h.day >= from)].map((h) => ({ x: h.day, y: h[key] })));
}

const weekend = (day: number) => [0, 6].includes(dateOf(day).getDay());

function priceSeries(id: InstrumentId | "SP500"): ChartPt[] {
  const days = RANGE_DAYS[range];
  const from = Number.isFinite(days) ? clock.day - days : market.firstDay;
  return thin(market.series(id, from, clock.day).filter((p) => !weekend(p.day)).map((p) => ({ x: p.day, y: p.value })));
}

/** Change from the last trading day's close before today's. */
function dayChange(id: InstrumentId | "SP500"): number {
  const at = (d: number) => (id === "SP500" ? market.level(d) : market.price(id, d));
  let d = clock.day;
  while (weekend(d)) d--;
  let prev = d - 1;
  while (weekend(prev)) prev--;
  return at(d) / at(prev) - 1;
}

function histChart(pts: ChartPt[], fmt: (y: number) => string, o: { goodWhenUp?: boolean; unit?: "usd" | "points"; minSpan?: number } = {}): ChartSpec {
  const base = pts[0];
  const last = pts[pts.length - 1];
  const tone = dirTone(last.y - base.y, o.goodWhenUp ?? true);
  return {
    pts,
    minSpan: o.minSpan,
    tone: tone === "flat" ? "up" : tone,
    rest: last,
    fmt,
    label: (p) => shortDate(dateOf(p.x)),
    change: (p, scrubbing) => {
      if (pts.length < 2) return `<span class="when">Today</span>`;
      const d = p.y - base.y;
      const main = o.unit === "points" ? `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d))} pts` : `${signedUsd(d)}${base.y ? ` (${signedPct(d / Math.abs(base.y))})` : ""}`;
      return `${main} <span class="when">${scrubbing ? `since ${shortDate(dateOf(base.x))}` : RANGE_LABEL[range]}</span>`;
    },
  };
}

// ---- Shared markup -------------------------------------------------------------------

const heroHtml = (eyebrow: string) => `<div class="eyebrow">${eyebrow}</div><div class="hero" data-hero></div><div class="change" data-change></div><div class="bc" data-chart></div>`;
const rangesHtml = (keys: Range[] = ["1W", "1M", "3M", "1Y", "ALL"]) =>
  `<div class="ranges" role="group" aria-label="Time range">${keys.map((k) => `<button data-range="${k}" class="${k === range ? "on" : ""}">${k}</button>`).join("")}</div>`;

function row(o: { title: string; sub: string; spark?: string; pill: string; tone: Tone; go?: string; attrs?: string }): string {
  const tag = o.go || o.attrs ? "button" : "div";
  return `<${tag} class="row${o.go || o.attrs ? " link" : ""}" ${o.go ? `data-go="${o.go}"` : ""} ${o.attrs ?? ""}><div><b>${o.title}</b><small>${o.sub}</small></div>${o.spark ?? "<span></span>"}<span class="pill ${o.tone}">${o.pill}</span></${tag}>`;
}

function nextCard(title: string, body: string, cta?: { label: string; act: string; disabled?: boolean; soft?: boolean }): string {
  return `<div class="card next"><div><b>${title}</b><p>${body}</p></div>${cta ? `<button class="cta${cta.soft ? " soft" : ""}" data-act="${cta.act}" ${cta.disabled ? "disabled" : ""}>${cta.label}</button>` : ""}</div>`;
}

function feedHtml(n: number): string {
  if (!feed.length) return `<ul class="feed"><li class="empty">Press play or skip ahead. Paychecks land on the 1st and 15th, rent on the 1st.</li></ul>`;
  return `<ul class="feed">${feed
    .slice(0, n)
    .map((f) => `<li><span class="f-date">${monthDay(dateOf(f.day))}</span><span>${esc(f.text)}</span><span class="f-amt ${f.amount === undefined ? "" : f.amount >= 0 ? "up" : "down"}">${f.amount === undefined ? "" : signedUsd(f.amount)}</span></li>`)
    .join("")}</ul>`;
}

const footHtml = () =>
  `<p class="foot">Education, not financial advice. Rates and market history before ${shortDate(new Date(`${MARKET.asOf}T12:00:00`))}: FRED. After that, prices follow Larp City's simulated market.</p>`;

// ---- Home ----------------------------------------------------------------------

/** One suggested move, the Tally pattern: tell the player what to do instead of showing a table. */
let moveAct: (() => void) | null = null;
function nextMove(): string {
  moveAct = null;
  const open = life.book.debts.filter(isOpen);
  const spare = Math.max(0, Math.floor(life.cash() - life.rent));
  const late = open.find((d) => d.pastDue > 0 && d.status !== "collections");
  if (late) {
    const amt = Math.floor(Math.min(late.pastDue, life.cash()));
    moveAct = () => pay(late.id, amt);
    return nextCard(`Catch up on the ${late.name}`, `${usd(late.pastDue)} is past due. Paying before it's 30 days late keeps it off your credit report.`, { label: `Pay ${usd(amt)}`, act: "move", disabled: amt < 1 });
  }
  const card = open.filter((d) => d.kind === "credit_card" && d.creditLimit).sort((a, b) => aprNow(b) - aprNow(a))[0];
  const util = card ? owed(card) / (card.creditLimit ?? 1) : 0;
  if (card && util > 0.3 && spare >= 50) {
    const amt = Math.floor(Math.min(300, spare, owed(card)));
    moveAct = () => pay(card.id, amt);
    return nextCard(
      `Pay down the ${card.name}`,
      `It costs ${rate(aprNow(card))} a year and it's ${pctOf(util, 0)} maxed, which drags your score down. You can put ${usd(amt)} toward it and still keep a month of rent.`,
      { label: `Pay ${usd(amt)}`, act: "move" },
    );
  }
  const month = life.rent + life.living;
  const ef = life.ledger.get("emergency").balance;
  if (ef < month && spare >= 100) {
    const amt = Math.floor(Math.min(500, spare, month - ef));
    moveAct = () => fundEmergency(amt);
    return nextCard("Start an emergency fund", `One month of rent and bills is ${usd(month)}. Money set aside keeps a surprise bill off your credit card.`, { label: `Move ${usd(amt)}`, act: "move" });
  }
  if (!life.recurring.length) {
    moveAct = () => {
      life.recurring = [{ id: "LTM", amount: 100 }];
      log(clock.day, "Started auto-investing $100 every payday", "flat");
    };
    return nextCard("Invest $100 every payday", "Small automatic buys of a total-market fund are how most people build wealth. You can stop anytime.", { label: "Start", act: "move" });
  }
  const each = life.recurring.reduce((s, r) => s + r.amount, 0);
  return nextCard("You're on track", `Debt-free ${freeDate()} and investing ${usd(each)} every payday.`);
}

function homePage(): Page {
  const nw = hist("netWorth");
  const cash = hist("cash");
  const inv = hist("investments");
  const debt = hist("debt");
  const score = hist("score");
  const t = (pts: ChartPt[], good = true) => dirTone(pts[pts.length - 1].y - pts[0].y, good);
  const sparkOf = (pts: ChartPt[], good = true) => spark(pts.map((p) => p.y), t(pts, good));
  const invested = life.investments();
  return {
    side: true,
    chart: histChart(nw, (y) => usd(y, 2)),
    main: `${heroHtml("Net worth")}${rangesHtml()}
      ${nextMove()}
      <div class="section"><h2>Your money</h2><span>Tap a row for details</span></div>
      ${row({ title: "Cash", sub: `Checking, savings, and emergency fund · rent ${usd(life.rent)}/mo`, spark: sparkOf(cash), pill: usd(life.cash()), tone: t(cash), go: "cash" })}
      ${row({ title: "Investing", sub: invested > 0 ? `${life.positions().length} holding${life.positions().length === 1 ? "" : "s"}${life.recurring.length ? " · auto-invest on" : ""}` : "Nothing invested yet", spark: sparkOf(inv), pill: usd(invested), tone: invested > 0 ? t(inv) : "flat", go: "investing" })}
      ${row({ title: "Debt", sub: life.totalDebt() > 0.5 ? `Debt-free ${freeDate()}` : "You're debt-free", spark: sparkOf(debt, false), pill: usd(life.totalDebt()), tone: t(debt, false), go: "debt" })}
      ${row({ title: "Credit score", sub: `${life.scoreBand()}`, spark: sparkOf(score), pill: String(life.book.profile.score), tone: t(score), go: "credit" })}
      <div class="section"><h2>Recent activity</h2><span>Interest paid ${usd(life.book.interestPaid)} · fees ${usd(life.book.feesPaid)}</span></div>
      ${feedHtml(8)}
      ${footHtml()}`,
  };
}

// ---- Cash ---------------------------------------------------------------------------

const CASH_ACCOUNTS = ["checking", "savings", "emergency"] as const;
/** Months of rent, bills, and minimums the emergency fund aims for without a plan. */
const EMERGENCY_MONTHS = 3;

/** The Cash tab, laid out like a bank app: balance, quick actions, accounts, then the statement. */
function cashPage(): Page {
  const acct = (id: string) => life.ledger.get(id);
  const apy = (id: string) => `${(acct(id).apy * 100).toFixed(2)}% APY`;
  const months = life.orders?.emergencyMonths ?? EMERGENCY_MONTHS;
  const goal = Math.round(months * life.monthlyExpenses());
  const ef = acct("emergency").balance;
  const now = clock.date;
  const earned = (wholeYear: boolean) =>
    bank
      .filter((t) => t.category === "Savings interest")
      .filter((t) => {
        const d = dateOf(t.day);
        return d.getFullYear() === now.getFullYear() && (wholeYear || d.getMonth() === now.getMonth());
      })
      .reduce((s, t) => s + t.amount, 0);
  let next = clock.day + 1;
  while (![1, 15].includes(dateOf(next).getDate())) next++;
  const payAmt = (life.monthlyTakeHome / 2) * (life.employed ? 1 : 0.4);
  const accountRow = (id: string, title: string, sub: string, extra = "") =>
    `<div class="row r2 acct"><div><b>${title} <span class="chip">${apy(id)}</span></b><small>${sub}</small>${extra}</div><span class="amt">${usd(acct(id).balance, 2)}</span></div>`;
  return {
    side: true,
    chart: histChart(hist("cash"), (y) => usd(y, 2)),
    main: `${heroHtml("Cash · checking, savings, and emergency fund")}${rangesHtml()}
      <div class="quick">
        <button class="cta${xferOpen ? " plain" : ""}" data-act="xfer">${xferOpen ? "Close transfer" : "Transfer"}</button>
        <button class="cta plain" data-go="debt">Pay a card or loan</button>
      </div>
      ${xferOpen ? transferHtml() : ""}
      ${nextCard(`Direct deposit of about ${usd(payAmt)} on ${monthDay(dateOf(next))}`, `${life.employed ? "Your paycheck lands" : "Unemployment benefits land"} in checking. Rent of ${usd(life.rent)} comes out on the 1st and living costs of ${usd(life.living)} on the 15th.`)}
      <div class="section"><h2>Accounts</h2><span>Interest earned ${usd(earned(false), 2)} this month · ${usd(earned(true), 2)} this year</span></div>
      ${accountRow("checking", "Checking", "Available to spend · paychecks land here")}
      ${accountRow("savings", "High-yield savings", "Interest is paid on the 1st of each month")}
      ${accountRow(
        "emergency",
        "Emergency fund",
        `${usd(ef)} of ${usd(goal)}, ${months} months of rent, bills, and minimums`,
        `<div class="meter"><span class="good" style="width:${(goal > 0 ? Math.min(100, (ef / goal) * 100) : 100).toFixed(1)}%"></span></div>`,
      )}
      <div class="section"><h2>Transactions</h2><span>Newest first</span></div>
      ${txnsHtml()}
      ${footHtml()}`,
  };
}

function transferHtml(): string {
  const opts = (sel: string) =>
    CASH_ACCOUNTS.map((id) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(life.ledger.get(id).name)} · ${usd(life.ledger.get(id).balance)}</option>`).join("");
  return `<div class="card">
      <b>Move money</b>
      <p>Between your own accounts, instantly and free.</p>
      <div class="xfer-row">
        <label>From <select data-xfer-from aria-label="From account">${opts(xfer.from)}</select></label>
        <label>To <select data-xfer-to aria-label="To account">${opts(xfer.to)}</select></label>
        <label class="amt-in">$<input type="number" min="1" step="1" value="${xfer.amount}" data-xfer-amt data-focus="xfer-amt" aria-label="Amount to move"></label>
        <button class="cta" data-act="xfer-go">Move ${usd(xfer.amount)}</button>
      </div>
      ${xferMsg ? `<div class="msg${xferMsg.bad ? " bad" : ""}">${esc(xferMsg.text)}</div>` : ""}
    </div>`;
}

function moveMoney() {
  if (xfer.from === xfer.to) {
    xferMsg = { text: "Pick two different accounts.", bad: true };
    return;
  }
  const ctx = { day: clock.day, date: clock.date, age: life.age };
  const q = life.ledger.quote(xfer.from, xfer.to, xfer.amount, "internal", ctx);
  if (!q.ok) {
    xferMsg = { text: q.error ?? "That move didn't go through.", bad: true };
    return;
  }
  life.ledger.transfer(xfer.from, xfer.to, xfer.amount, "internal", ctx);
  const name = (id: string) => life.ledger.get(id).name;
  bankLog({ day: clock.day, name: `Transfer to ${name(xfer.to)}`, category: `From ${name(xfer.from)}`, icon: "↔", amount: xfer.amount, kind: "move" });
  log(clock.day, `Moved ${usd(xfer.amount)} from ${name(xfer.from)} to ${name(xfer.to)}`, "flat");
  xferMsg = { text: [`Moved ${usd(xfer.amount, 2)} to ${name(xfer.to)}.`, ...q.warnings].join(" "), bad: false };
}

/** The statement: pending moves first, then days newest first, like a bank app. */
function txnsHtml(): string {
  const pending = life.ledger.pending;
  if (!bank.length && !pending.length) return `<ul class="feed"><li class="empty">No transactions yet. Press play: paychecks land on the 1st and 15th.</li></ul>`;
  const amt = (t: Pick<BankTxn, "amount" | "kind">) =>
    `<span class="t-amt ${t.kind}">${t.kind === "in" ? "+" : t.kind === "out" ? "−" : ""}$${num(t.amount, 2)}</span>`;
  const line = (t: BankTxn) => `<div class="txn"><span class="av" aria-hidden="true">${t.icon}</span><div><b>${esc(t.name)}</b><small>${esc(t.category)}</small></div>${amt(t)}</div>`;
  const dayLabel = (day: number) => (day === clock.day ? "Today" : day === clock.day - 1 ? "Yesterday" : monthDay(dateOf(day)));
  let html = pending.length
    ? `<div class="t-day">Pending</div>${pending.map((p) => line({ day: p.day, name: `Transfer to ${life.ledger.get(p.to).name}`, category: `Arrives ${monthDay(dateOf(p.settlesDay))}`, icon: "↔", amount: p.received, kind: "move" })).join("")}`
    : "";
  let last: number | null = null;
  for (const t of bank.slice(0, 40)) {
    if (t.day !== last) html += `<div class="t-day">${dayLabel(t.day)}</div>`;
    last = t.day;
    html += line(t);
  }
  return `<div class="txns">${html}</div>`;
}

// ---- Investing ----------------------------------------------------------------------

function investingPage(): Page {
  if (fund) return fundPage(fund);
  const positions = life.positions();
  const invested = life.history.some((h) => h.investments > 0) || positions.length > 0;
  const bp = life.buyingPower();
  const top = open0();
  const each = life.recurring.reduce((s, r) => s + r.amount, 0);
  const chart = invested ? twinsChart() : histChart(priceSeries("SP500"), (y) => num(y, 2), {});
  if (!invested) chart.change = (p, scrubbing) => marketChange(chart.pts, p, scrubbing);
  return {
    side: true,
    chart,
    main: `${heroHtml(invested ? "Investing · you vs if you had held" : "Stock market · S&amp;P 500")}${rangesHtml()}
      ${recoveryCard()}${concentrationCard()}
      ${nextCard(
        `Buying power ${usd(bp, 2)}`,
        life.recurring.length ? `Auto-invest is on: ${life.recurring.map((r) => `${usd(r.amount)} of ${r.id}`).join(" and ")} every payday (${usd(each)} total).` : "Money in checking you can invest. Auto-invest buys a fund for you every payday, after bills.",
        { label: life.recurring.length ? "Stop auto-invest" : "Auto-invest $100", act: "recurring", soft: true },
      )}
      ${positions.length ? `<div class="section"><h2>Your holdings</h2><span>Value · gain since you bought</span></div>${positions
        .map((p) => row({ title: `${p.id} · ${instrument(p.id).name}`, sub: `${num(p.units, 4)} shares · paid ${usd(p.cost, 2)} · ${signedUsd(p.gain)}`, spark: spark(priceSeries(p.id).slice(-30).map((q) => q.y), dirTone(p.gain)), pill: usd(p.value, 2), tone: dirTone(p.gain), attrs: `data-fund="${p.id}"` }))
        .join("")}` : ""}
      <div class="section"><h2>Funds and stocks</h2><span>Today's move</span></div>
      ${INSTRUMENTS.map((i) => {
        const ch = dayChange(i.id);
        const pts = priceSeries(i.id).slice(-30);
        // Like the watch list, the line and the pill share today's color.
        return row({ title: i.name, sub: `${i.id} · ${i.kind === "fund" ? `fund, ${pctOf(i.expenseRatio)} yearly fee` : "single stock"}`, spark: spark(pts.map((q) => q.y), dirTone(ch)), pill: signedPct(ch), tone: dirTone(ch), attrs: `data-fund="${i.id}"` });
      }).join("")}
      ${top ? nextCard("Pay debt or invest?", aprNow(top) > MARKET_RETURN ? `Your ${top.name} costs ${rate(aprNow(top))} a year. Stocks have averaged about 10%, with big swings. Paying the card is a guaranteed ${rate(aprNow(top))} return, so pay it first. The exception: always take a 401(k) match.` : `Your most expensive debt, the ${top.name}, costs ${rate(aprNow(top))}. That's below the market's long-run ~10%, so investing while you pay it on schedule is reasonable.`) : ""}
      ${footHtml()}`,
  };
}

/** Highest-rate open debt. */
function open0(): Debt | undefined {
  return life.book.debts.filter(isOpen).sort((a, b) => aprNow(b) - aprNow(a))[0];
}

/** You, if you had held, and autopilot on one zero-based chart (research/03, three-line chart). */
function twinsChart(): ChartSpec {
  const you = hist("you");
  const held = hist("held");
  const auto = hist("autopilot");
  const spec = histChart(you, (y) => usd(y, 2));
  spec.lines = [
    { pts: held, cls: "bc-held", label: "If you had held" },
    { pts: auto, cls: "bc-auto", label: "Autopilot" },
  ];
  spec.zero = true;
  spec.mainLabel = "You";
  const at = (pts: ChartPt[], x: number) => (pts.find((q) => q.x === x) ?? pts[pts.length - 1]).y;
  spec.change = (p, scrubbing) => {
    const gap = p.y - at(held, p.x);
    const main = Math.abs(gap) < 0.5 ? "Even with if you had held" : `${signedUsd(gap, 0)} vs if you had held`;
    return `${main} <span class="when">· autopilot ${usd(at(auto, p.x))}${scrubbing ? ` · ${shortDate(dateOf(p.x))}` : ""}</span>`;
  };
  const lastYou = you[you.length - 1].y;
  const lastHeld = at(held, you[you.length - 1].x);
  spec.tone = dirTone(lastYou - lastHeld) === "down" ? "down" : "up";
  return spec;
}

function recoveryCard(): string {
  if (!recovery || clock.day - recovery.day > 365) return "";
  const gap = recovery.held - recovery.you;
  const body =
    gap > 1
      ? `Selling cost you ${usd(gap)}. Holding would be worth ${usd(recovery.held)}; you have ${usd(recovery.you)}.`
      : gap < -1
        ? `You came out ${usd(-gap)} ahead of holding. Most sellers don't: the rebound often comes fast.`
        : crash?.choice === "held"
          ? "You held, so you got the whole rebound."
          : "You came out about where holding would have left you.";
  // The decision pauses time until answered, and a new bear market can't start before this one
  // recovers, so crash.day should already equal this recovery's crash - this guard only protects
  // against a crash left over from an earlier run of the page (for example after reset).
  const choice = crash && crash.day <= recovery.day ? ` In the crash, you ${esc(crash.choice)}.` : "";
  return nextCard(recap ? esc(recap.headline) : "Stocks are back at their high", recap ? esc(recap.lesson) : `${body}${choice}`);
}

function concentrationCard(): string {
  const positions = life.positions();
  const total = positions.reduce((s, p) => s + p.value, 0);
  const nnst = life.position("NNST")?.value ?? 0;
  if (total <= 0 || nnst / total <= 0.2) return "";
  return nextCard(`NeuralNest is ${pctOf(nnst / total, 0)} of your investments`, "One company can fall 80%. A fund spreads the risk across hundreds.");
}

function marketChange(pts: ChartPt[], p: ChartPt, scrubbing: boolean): string {
  const base = pts[0].y;
  return `${p.y - base >= 0 ? "+" : "−"}${num(p.y - base, 2)} (${signedPct((p.y - base) / base)}) <span class="when">${scrubbing ? `since ${shortDate(dateOf(pts[0].x))}` : RANGE_LABEL[range]}</span>`;
}

function fundPage(id: InstrumentId): Page {
  const inst = instrument(id);
  const pts = priceSeries(id);
  const chart = histChart(pts, (y) => usd(y, 2));
  chart.change = (p, scrubbing) => marketChange(pts, p, scrubbing).replace(/^([+−])/, "$1$");
  const pos = life.position(id);
  const recurring = life.recurring.find((r) => r.id === id);
  const bp = life.buyingPower();
  const feeLine = inst.kind === "fund" ? `Its fee is ${pctOf(inst.expenseRatio)} a year, about ${usd(inst.expenseRatio * 1000, 2)} for every $1,000 you hold.` : "It's one company, so it can swing far more than a fund.";
  return {
    side: true,
    chart,
    main: `<button class="back" data-fund-back>← Investing</button>
      ${heroHtml(`${inst.name} · ${id}`)}${rangesHtml()}
      ${nextCard(
        pos ? `You own ${usd(pos.value, 2)}` : "You don't own any yet",
        pos ? `${num(pos.units, 4)} shares, paid ${usd(pos.cost, 2)}. ${pos.gain >= 0 ? "Up" : "Down"} ${usd(Math.abs(pos.gain), 2)} (${signedPct(pos.gain / pos.cost)}) since you bought.` : "Buy any dollar amount from $1; you get a fraction of a share.",
      )}
      <div class="card">
        <b>Buy or sell</b>
        <p>Buying power ${usd(bp, 2)}. Orders fill at today's closing price, in fractions of a share.</p>
        <div class="amounts">${[25, 100, 500, 1000].map((a) => `<button data-amt="${a}" class="${a === amount ? "on" : ""}">${usd(a)}</button>`).join("")}
          <label class="amt-in">$<input type="number" min="1" step="1" value="${amount}" data-amount data-focus="amount" aria-label="Amount in dollars"></label>
        </div>
        <div class="trade">
          <button class="cta" data-trade="buy">Buy ${usd(amount)}</button>
          <button class="cta plain" data-trade="sell" ${pos ? "" : "disabled"}>Sell ${usd(amount)}</button>
          ${pos ? `<button class="cta plain" data-trade="sell-all">Sell all</button>` : ""}
        </div>
        <label class="toggle"><input type="checkbox" data-recur ${recurring ? "checked" : ""}> ${recurring ? `Auto-invest ${usd(recurring.amount)} of ${id} every payday` : `Also buy ${usd(amount)} of ${id} every payday`}</label>
        ${tradeMsg ? `<div class="msg${tradeMsg.bad ? " bad" : ""}">${esc(tradeMsg.text)}</div>` : ""}
      </div>
      ${nextCard("About", `${esc(inst.blurb)} ${feeLine}`)}
      ${footHtml()}`,
  };
}

function trade(kind: "buy" | "sell" | "sell-all") {
  if (!fund) return;
  const r = kind === "buy" ? life.buy(fund, amount) : life.sell(fund, kind === "sell-all" ? "all" : amount);
  tradeMsg = r.ok
    ? { text: r.event.type === "trade" ? `${r.event.side === "buy" ? "Bought" : "Sold"} ${num(r.event.units, 4)} shares of ${fund} for ${usd(r.event.amount, 2)}.` : "Done.", bad: false }
    : { text: r.error, bad: true };
}

// ---- Debt ---------------------------------------------------------------------------

function debtPage(): Page {
  const total = life.totalDebt();
  const proj = compareStrategies(life.book.debts, life.book.extraMonthly);
  const s = life.book.strategy;
  const p = proj[s];
  const at = (m: number) => clock.day + Math.round(m * 30.44);
  const plan = p.series.map((y, m) => ({ x: at(m), y }));
  const mins = proj.minimums.series.slice(0, Math.max(24, Math.round(plan.length * 1.6))).map((y, m) => ({ x: at(m), y }));
  const saved = proj.minimums.interest - p.interest;
  const order = new Map(p.payoffs.map((x, i) => [x.id, i]));
  const debts = [...life.book.debts].sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const firstTarget = debts.find((d) => isOpen(d));
  const minsAt = (x: number) => mins.reduce((best, q) => (Math.abs(q.x - x) < Math.abs(best.x - x) ? q : best), mins[0]).y;
  const chart: ChartSpec | undefined =
    total > 0.5 && plan.length > 1
      ? {
          pts: plan,
          lines: s === "minimums" ? undefined : [{ pts: mins, cls: "bc-ghost", label: "Minimums only" }],
          baseline: false,
          tone: p.stuck ? "down" : "up",
          rest: plan[0],
          fmt: (y) => usd(y),
          label: (q) => monthYear(dateOf(q.x)),
          change: (q, scrubbing) =>
            scrubbing
              ? `${q.y <= 0.5 ? "Debt-free" : `${usd(q.y)} left`} in ${monthYear(dateOf(q.x))}${s === "minimums" ? "" : ` <span class="when">· minimums only: ${usd(minsAt(q.x))}</span>`}`
              : p.stuck
                ? `Not paid off at this pace <span class="when">· add a little extra each month</span>`
                : `Debt-free ${freeDate()} <span class="when">· hover to see the path; dashed is minimums only</span>`,
        }
      : undefined;
  const strategies: [Strategy, string][] = [
    ["avalanche", `${usd(proj.avalanche.interest)} interest · highest rate first`],
    ["snowball", `First debt gone in ${proj.snowball.payoffs[0]?.month ?? "—"} months`],
    ["minimums", proj.minimums.stuck ? "Never paid off" : `${(proj.minimums.months / 12).toFixed(0)} years · ${usd(proj.minimums.interest)} interest`],
  ];
  return {
    side: true,
    chart,
    tone: "up",
    main: `${heroHtml("Total debt")}
      <div class="seg" role="group" aria-label="Payoff strategy">${strategies.map(([k, sub]) => `<button data-strategy="${k}" class="${k === s ? "on" : ""}">${STRATEGY_NAME[k]}<small>${sub}</small></button>`).join("")}</div>
      <div class="card">
        <div class="slider"><b>Extra each month</b><b>${usd(life.book.extraMonthly)}</b>
          <input type="range" min="0" max="1500" step="25" value="${life.book.extraMonthly}" data-extra data-focus="extra" aria-label="Extra payment each month"></div>
        <p>${s === "minimums" ? "Minimums only: the extra isn't used. Pick Avalanche or Snowball to put it to work." : saved > 1 ? `Debt-free ${freeDate()}, and ${usd(saved)} less interest than paying only the minimums.` : `Debt-free ${freeDate()}.`}</p>
      </div>
      <div class="section"><h2>What you owe</h2><span>In the order your plan pays them off</span></div>
      ${debts
        .map((d) => {
          const due = nextDue(d);
          const util = d.creditLimit ? ` · ${pctOf(owed(d) / d.creditLimit, 0)} of limit used` : "";
          const chip = statusChip(d) || (d === firstTarget && s !== "minimums" ? `<span class="chip good">Paying first</span>` : "");
          return `<div class="row r2${isOpen(d) ? "" : " closed"}">
            <div><b>${esc(d.name)} ${chip}</b><small>${KIND_NAME[d.kind]} · ${rate(aprNow(d))} a year${util}${isOpen(d) ? (minPayment(d) > 0 ? ` · ${usd(minPayment(d))}/mo${due ? ` · due ${monthDay(due)}` : ""}` : " · nothing due until the next statement") : ""}</small></div>
            <div class="end"><span class="pill ${aprNow(d) >= 0.15 && isOpen(d) ? "down" : "flat"}">${usd(owed(d))}</span>
            <button class="mini" data-pay="${d.id}" ${isOpen(d) && d.status !== "collections" && life.cash() >= 100 ? "" : "disabled"}>Pay $100</button></div>
          </div>`;
        })
        .join("")}
      <p class="foot">Avalanche pays the highest rate first and costs the least. Snowball pays the smallest balance first, so you get a win sooner, which keeps most people going.</p>`,
  };
}

// ---- Credit ------------------------------------------------------------------------

function creditPage(): Page {
  const prof = life.book.profile;
  const b = scoreBreakdown(prof, life.book.debts, clock.day, prof.historyStartDay);
  const card = life.book.debts.filter((d) => isOpen(d) && d.kind === "credit_card" && d.creditLimit).sort((x, y) => owed(y) / (y.creditLimit ?? 1) - owed(x) / (x.creditLimit ?? 1))[0];
  const factors = [
    { name: "On-time payments", w: WEIGHTS.payment, v: b.payment, impact: "High impact", note: prof.lateMarks.length ? `${prof.lateMarks.length} late payment${prof.lateMarks.length === 1 ? "" : "s"} on your report` : "No late payments", fix: "Pay every bill on time. A late payment stays on your report for 7 years, fading as it ages." },
    { name: "Card use", w: WEIGHTS.amounts, v: b.amounts, impact: "High impact", note: `${pctOf(b.utilization, 0)} of your limits, aim under 30%`, fix: card ? `Your cards are ${pctOf(b.utilization, 0)} used. Get the ${card.name} under ${usd((card.creditLimit ?? 0) * 0.3)} (30% of its limit) and your score should jump.` : "Keep card balances under 30% of their limits." },
    { name: "Account age", w: WEIGHTS.length, v: b.length, impact: "Medium impact", note: "How long your accounts have been open", fix: "This one only improves with time. Keep your oldest accounts open, even if you rarely use them." },
    { name: "New applications", w: WEIGHTS.newCredit, v: b.newCredit, impact: "Low impact", note: `${prof.inquiries.length} hard pull${prof.inquiries.length === 1 ? "" : "s"} recently`, fix: "Hold off on new applications for a while. Each hard pull costs a few points for about a year." },
    { name: "Mix of accounts", w: WEIGHTS.mix, v: b.mix, impact: "Low impact", note: "Cards plus loans", fix: "Having both cards and loans helps a little. It's never worth borrowing just for this." },
  ];
  const worst = [...factors].sort((x, y) => y.w * (1 - y.v) - x.w * (1 - x.v))[0];
  const clean = worst.v >= 0.95;
  return {
    side: true,
    chart: histChart(hist("score"), (y) => String(Math.round(y)), { unit: "points", minSpan: 60 }),
    main: `${heroHtml(`Credit score · ${life.scoreBand()}`)}${rangesHtml()}
      ${clean ? nextCard("Nothing to fix", "Keep paying on time; your score climbs as your accounts age.") : nextCard(`Biggest fix: ${worst.name.toLowerCase()}`, worst.fix, worst.name === "Card use" ? { label: "See payoff plan", act: "go-debt" } : undefined)}
      <div class="section"><h2>What moves your score</h2><span>Most important first</span></div>
      ${factors
        .map(
          (f) => `<div class="row r2"><div><b>${f.name}</b><small>${f.note}</small><div class="meter"><span class="${f.v >= 0.8 ? "good" : "bad"}" style="width:${Math.max(4, f.v * 100).toFixed(0)}%"></span></div></div><span class="chip">${f.impact}</span></div>`,
        )
        .join("")}
      <p class="foot">Scores run from 300 to 850. Lenders see 670 and up as good; each band gets you a lower rate on loans and cards.</p>`,
  };
}

// ---- Cards ---------------------------------------------------------------------------

function cardsPage(): Page {
  const cards = life.book.debts.filter((d) => d.kind === "credit_card" && isOpen(d));
  const card = cards.find((c) => c.id === cardId) ?? cards[0];
  if (!card) {
    return { side: false, tone: "up", main: `<div class="eyebrow">Credit cards</div><div class="hero">No cards</div><div class="change neutral">Browse real cards below. Check your odds with a soft pull first.</div>` };
  }
  const bal = owed(card);
  const limit = card.creditLimit ?? 0;
  const util = limit ? bal / limit : 0;
  const stmt = card.statementBalance ?? 0;
  const due = nextDue(card);
  const payAmt = Math.floor(Math.min(stmt, life.cash()) * 100) / 100;
  return {
    side: false,
    tone: util > 0.3 ? "down" : "up",
    main: `${cards.length > 1 ? `<div class="seg" style="margin:0 0 18px">${cards.map((c) => `<button data-card="${c.id}" class="${c.id === card.id ? "on" : ""}">${esc(c.name)}</button>`).join("")}</div>` : ""}
      <div class="eyebrow">${esc(card.name)} · balance</div>
      <div class="hero">${usd(bal, 2)}</div>
      <div class="change neutral">${usd(Math.max(0, limit - bal))} available of ${usd(limit)} · ${rate(aprNow(card))} a year</div>
      <div class="meter" style="height:10px;margin-top:22px"><span class="${util > 0.3 ? "bad" : "good"}" style="width:${Math.min(100, util * 100).toFixed(1)}%"></span></div>
      <div class="change neutral" style="font-size:13px;margin-top:8px">${pctOf(util, 0)} used · lenders like under 30%</div>
      ${stmt > 0.5
        ? (() => {
            moveAct = () => pay(card.id, payAmt);
            return nextCard(`Statement ${usd(stmt, 2)}${due ? ` due ${monthDay(due)}` : ""}`, `Pay it in full and you owe no interest. Paying only the ${usd(card.minimumDue ?? 0, 2)} minimum costs about ${usd((stmt * aprNow(card)) / 12, 2)} in interest next month.`, { label: `Pay ${usd(payAmt, 2)}`, act: "move", disabled: payAmt < 1 });
          })()
        : nextCard("Nothing due yet", "Your next statement closes at the end of the cycle. Pay it in full to skip interest.")}`,
  };
}

// ---- Side panel ------------------------------------------------------------------------

function sideHtml(): string {
  const watch = (["SP500", ...INSTRUMENTS.map((i) => i.id)] as (InstrumentId | "SP500")[])
    .map((id) => {
      const pts = priceSeries(id).slice(-30).map((p) => p.y);
      const ch = dayChange(id);
      const value = id === "SP500" ? num(market.level(clock.day), 2) : usd(market.price(id, clock.day), 2);
      // Like Robinhood's watchlist, the line and the pill share today's color.
      return row({ title: id === "SP500" ? "S&amp;P 500" : id, sub: value, spark: spark(pts, dirTone(ch)), pill: signedPct(ch), tone: dirTone(ch), attrs: id === "SP500" ? "" : `data-fund="${id}"` });
    })
    .join("");
  const rates = ([["DFF", "Fed funds"], ["MORTGAGE30US", "30-yr mortgage"]] as const)
    .map(([id, name]) => {
      const now = seriesOn(id, clock.date) + (id === "DFF" || id === "MORTGAGE30US" ? rateShock * 100 : 0);
      const pts = Array.from({ length: 30 }, (_, i) => seriesOn(id, dateOf(clock.day - 29 + i)));
      const ch = now - pts[0];
      return row({ title: name, sub: `${now.toFixed(2)}%`, spark: spark(pts, Math.abs(ch) < 0.005 ? "flat" : ch < 0 ? "up" : "down"), pill: `${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}`, tone: Math.abs(ch) < 0.005 ? "flat" : ch < 0 ? "up" : "down" });
    })
    .join("");
  return `<h3>Watch list <span>Today</span></h3>${watch}${rates}<h3 class="h3-gap">Upcoming <span>Next 30 days</span></h3>${upcoming()}`;
}

function upcoming(): string {
  const items: { day: number; title: string; amt: number; tone: Tone }[] = [];
  const payAmt = (life.monthlyTakeHome / 2) * (life.employed ? 1 : 0.4);
  for (let d = clock.day + 1; d <= clock.day + 30; d++) {
    const dom = dateOf(d).getDate();
    if (dom === 1 || dom === 15) items.push({ day: d, title: "Paycheck", amt: payAmt, tone: "up" });
    if (dom === 1) items.push({ day: d, title: "Rent", amt: life.rent, tone: "flat" });
    if (dom === 15) items.push({ day: d, title: "Living costs", amt: life.living, tone: "flat" });
  }
  for (const d of life.book.debts) {
    const due = nextDue(d);
    if (!due) continue;
    const day = Math.round((due.getTime() - clock.start.getTime()) / 86_400_000);
    if (day > clock.day && day <= clock.day + 30 && minPayment(d) > 0) items.push({ day, title: d.name, amt: minPayment(d), tone: "flat" });
  }
  items.sort((a, b) => a.day - b.day);
  if (!items.length) return `<div class="row"><div><small>Nothing due in the next 30 days.</small></div></div>`;
  return items
    .slice(0, 6)
    .map((i) => row({ title: esc(i.title), sub: monthDay(dateOf(i.day)), pill: `${i.tone === "up" ? "+" : ""}${usd(i.amt)}`, tone: i.tone }))
    .join("");
}

// ---- Rendering -------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app")!;
const q = <T extends Element = HTMLElement>(sel: string) => app.querySelector(sel) as unknown as T;

app.innerHTML = `
  <header class="top"><div class="top-in">
    <div class="logo"><i>L</i>Larp City</div>
    <nav class="tabs" aria-label="Sections">${TABS.map(([id, name]) => `<button data-tab="${id}">${name}</button>`).join("")}</nav>
    <div class="time">
      <span class="time-date" data-date></span>
      <button data-speed="0" aria-label="Pause">❚❚</button><button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button>
      <button data-skip="7" title="Skip a week">+1W</button><button data-skip="30" title="Skip a month">+1M</button><button data-skip="365" title="Skip a year">+1Y</button>
      <div class="menu-wrap"><button data-menu aria-label="Scenarios" aria-expanded="false">⋯</button><div class="menu" data-menu-panel hidden></div></div>
    </div>
  </div></header>
  <main class="page" data-page></main>
  <div class="shop shop-panel" data-shop hidden></div>
  <div data-sheet></div>`;

const shopEl = q("[data-shop]");
const shop = mountShop({ root: shopEl, life: () => life, clock, log: (day, _tag, text, tone) => log(day, text, tone === "info" ? "flat" : tone), onChange: () => render() });

function setTone(t: Tone) {
  document.documentElement.dataset.tone = t === "down" ? "down" : "up";
}

// Renders wait while the pointer is down (slider drags, clicks) or scrubbing a chart, so time
// passing never yanks the page out from under the player.
let pointerDown = false;
let scrubbing = false;
let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    render();
  }, 0);
}
let deferred = false;
function flush() {
  if (deferred && !pointerDown && !scrubbing) {
    deferred = false;
    render();
  }
}

function wireChart(c: ChartSpec) {
  setTone(c.tone);
  const heroEl = q("[data-hero]");
  const chg = q("[data-change]");
  const show = (p: ChartPt, scrub: boolean) => {
    heroEl.textContent = c.fmt(p.y);
    chg.innerHTML = c.change(p, scrub);
  };
  show(c.rest, false);
  mountBigChart(q("[data-chart]"), {
    pts: c.pts,
    lines: c.lines,
    zero: c.zero,
    baseline: c.baseline,
    minSpan: c.minSpan,
    label: c.label,
    mainLabel: c.mainLabel,
    onScrub: (p) => {
      scrubbing = p !== null;
      show(p ?? c.rest, p !== null);
      if (!p) flush();
    },
  });
}

function renderTop() {
  q("[data-date]").textContent = clock.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  app.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === clock.speed));
  const panel = q("[data-menu-panel]");
  q("[data-menu]").setAttribute("aria-expanded", String(menuOpen));
  panel.hidden = !menuOpen;
  // In the city, moving, the rate shock, and resetting would split the desk from the city, so
  // only the standalone desk offers them.
  if (menuOpen)
    panel.innerHTML = `<button data-act="layoff">${life.employed ? "Get laid off" : "Find a new job"}<span>${life.employed ? "Employed" : "Unemployed"}</span></button>
      ${host ? "" : `<label>Live in <select data-move data-focus="move">${MOVES.map((s) => `<option value="${s.abbr}" ${s.abbr === life.place.abbr ? "selected" : ""}>${s.name}</option>`).join("")}</select></label>
      <button data-act="shock">${rateShock ? "Undo the rate shock" : "Rate shock: Fed +1 point"}</button>
      <hr><button data-act="reset">Reset the run</button>`}`;
}

function renderSheet() {
  q("[data-sheet]").innerHTML = decision
    ? `<div class="sheet-back"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dec-title">
        <div class="tag">Time is paused</div><h3 id="dec-title">${esc(decision.title)}</h3><p>${esc(decision.body)}</p>
        ${decision.options.map((o, i) => `<button class="opt${o.good ? " good" : ""}" data-option="${i}"><b>${esc(o.label)}</b><span>${esc(o.lesson)}</span></button>`).join("")}
      </div></div>`
    : "";
}

function render() {
  if (pointerDown || scrubbing) {
    deferred = true;
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.dataset.focus;
  const sel = active instanceof HTMLInputElement && active.type === "number" ? null : null;
  void sel;
  renderTop();
  const pages: Record<Tab, () => Page> = { home: homePage, cash: cashPage, investing: investingPage, debt: debtPage, credit: creditPage, cards: cardsPage };
  const page = pages[tab]();
  const el = q("[data-page]");
  el.className = `page${page.side ? "" : " wide"}`;
  el.innerHTML = `<section>${page.main}</section>${page.side ? `<aside class="side">${sideHtml()}</aside>` : ""}`;
  if (page.chart) wireChart(page.chart);
  else {
    setTone(page.tone ?? "up");
    const hero = q("[data-hero]");
    if (hero) {
      // Debt-free: the hero still shows today's value without a chart.
      hero.textContent = usd(life.totalDebt());
      q("[data-change]").innerHTML = `<span class="when">You're debt-free</span>`;
      q("[data-chart]")?.remove();
    }
  }
  const showShop = tab === "cards";
  shopEl.hidden = !showShop;
  if (showShop && !shopShown) shop.render();
  else if (showShop) shop.refresh();
  shopShown = showShop;
  renderSheet();
  if (focusKey) {
    const next = app.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`);
    next?.focus();
  }
}

// ---- Input -----------------------------------------------------------------------------

function skip(days: number) {
  clock.skipping = true;
  for (let i = 0; i < days && !decision; i++) clock.advanceDays(1);
  clock.skipping = false;
  void recorder?.tick(true);
  render();
}

function go(next: Tab) {
  tab = next;
  fund = null;
  tradeMsg = null;
  window.scrollTo(0, 0);
}

app.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("button, [data-fund]");
  if (!el) {
    if (menuOpen && !(ev.target as HTMLElement).closest(".menu-wrap")) {
      menuOpen = false;
      render();
    }
    return;
  }
  const ds = el.dataset;
  if (ds.option !== undefined && decision) {
    decision.options[Number(ds.option)].act();
    closeDecision();
    return;
  }
  if (decision) return;
  if (ds.menu !== undefined) menuOpen = !menuOpen;
  else if (!el.closest(".menu")) menuOpen = false;
  if (ds.tab) go(ds.tab as Tab);
  if (ds.go) go(ds.go as Tab);
  if (ds.speed !== undefined) clock.speed = Number(ds.speed);
  if (ds.skip) return skip(Number(ds.skip));
  if (ds.range) range = ds.range as Range;
  if (ds.fund) {
    tab = "investing";
    fund = ds.fund as InstrumentId;
    tradeMsg = null;
    window.scrollTo(0, 0);
  }
  if (ds.fundBack !== undefined) {
    fund = null;
    tradeMsg = null;
  }
  if (ds.amt) {
    amount = Number(ds.amt);
    tradeMsg = null;
  }
  if (ds.trade) trade(ds.trade as "buy" | "sell" | "sell-all");
  if (ds.strategy) life.book.strategy = ds.strategy as Strategy;
  if (ds.card) cardId = ds.card;
  if (ds.pay) pay(ds.pay, 100);
  switch (ds.act) {
    case "move":
      moveAct?.();
      break;
    case "xfer":
      xferOpen = !xferOpen;
      xferMsg = null;
      break;
    case "xfer-go":
      moveMoney();
      break;
    case "go-debt":
      go("debt");
      break;
    case "recurring":
      if (life.recurring.length) {
        life.recurring = [];
        log(clock.day, "Stopped auto-investing", "flat");
      } else {
        life.recurring = [{ id: "LTM", amount: 100 }];
        log(clock.day, "Started auto-investing $100 of LTM every payday", "flat");
      }
      break;
    case "layoff":
      life.setEmployed(!life.employed, clock.day);
      break;
    case "shock":
      rateShock = rateShock ? 0 : 0.01;
      log(clock.day, rateShock ? "Rate shock: the Fed raises rates a full point" : "Rates are back on the FRED path", rateShock ? "down" : "up");
      break;
    case "reset":
      feed.length = 0;
      bank.length = 0;
      xferMsg = null;
      rateShock = 0;
      life = makeLife();
      recorder = startRecorder();
      crash = recovery = recap = null;
      menuOpen = false;
      shopShown = false;
      break;
  }
  render();
});

app.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.extra !== undefined) {
    life.book.extraMonthly = Number(el.value);
    // Update the label live without a render so the drag keeps its pointer capture.
    const label = el.parentElement?.querySelectorAll("b")[1];
    if (label) label.textContent = usd(life.book.extraMonthly);
    deferred = true;
  }
  if (el.dataset.xferAmt !== undefined) {
    xfer.amount = Math.max(0, Math.round(Number(el.value) || 0));
    xferMsg = null;
    const go = app.querySelector<HTMLButtonElement>('[data-act="xfer-go"]');
    if (go) go.textContent = `Move ${usd(xfer.amount)}`;
  }
  if (el.dataset.amount !== undefined) {
    amount = Math.max(0, Math.round(Number(el.value) || 0));
    app.querySelectorAll<HTMLButtonElement>("[data-amt]").forEach((b) => b.classList.toggle("on", Number(b.dataset.amt) === amount));
    const buy = app.querySelector<HTMLButtonElement>('[data-trade="buy"]');
    const sell = app.querySelector<HTMLButtonElement>('[data-trade="sell"]');
    if (buy) buy.textContent = `Buy ${usd(amount)}`;
    if (sell) sell.textContent = `Sell ${usd(amount)}`;
  }
});

app.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el.dataset.extra !== undefined) {
    deferred = false;
    render();
  }
  if (el.dataset.xferFrom !== undefined || el.dataset.xferTo !== undefined) {
    if (el.dataset.xferFrom !== undefined) xfer.from = el.value;
    else xfer.to = el.value;
    xferMsg = null;
    render();
  }
  if (el.dataset.move !== undefined) {
    const next = STATES.find((s) => s.abbr === el.value);
    if (next && next.abbr !== life.place.abbr) life.setPlace(next, clock.day);
    render();
  }
  if (el instanceof HTMLInputElement && el.dataset.recur !== undefined && fund) {
    const id = fund;
    life.recurring = life.recurring.filter((r) => r.id !== id);
    if (el.checked && amount >= 1) life.recurring.push({ id, amount });
    log(clock.day, el.checked ? `Auto-investing ${usd(amount)} of ${id} every payday` : `Stopped auto-investing in ${id}`, "flat");
    render();
  }
});

document.addEventListener("pointerdown", () => {
  pointerDown = true;
});
document.addEventListener("pointerup", () => {
  pointerDown = false;
  flush();
});
document.addEventListener("pointercancel", () => {
  pointerDown = false;
  flush();
});

window.addEventListener("keydown", (ev) => {
  if (ev.code === "Escape" && menuOpen) {
    menuOpen = false;
    render();
    return;
  }
  if (ev.code !== "Space" || decision || (ev.target as HTMLElement).closest("input, select, button, textarea")) return;
  ev.preventDefault();
  clock.speed = clock.speed ? 0 : resumeSpeed || 1;
  render();
});
window.addEventListener("resize", () => render());

// ---- Start -----------------------------------------------------------------------------

if (host) {
  // The city's ticker drives the clock and the city calls life.onDay; every day's events
  // reach onLifeEvents, which re-renders.
  render();
} else {
  clock.onDay((day) => {
    life.onDay(day, clock.date);
    void recorder?.tick();
  });
  clock.speed = 1;
  let last = performance.now();
  const frame = (now: number) => {
    clock.update(Math.min(0.25, (now - last) / 1000));
    last = now;
    requestAnimationFrame(frame);
  };
  render();
  requestAnimationFrame(frame);
}
