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
import { CURATED } from "../data/cards-curated.ts";
import { MARKET } from "../data/market.ts";
import { STATES } from "../data/states.ts";
import { PlayerLife, STARTER_PORTFOLIO, seriesOn, type LifeEvent, type LifeSnapshot } from "../sim/life/index.ts";
import type { HomeEvent } from "../sim/life/homes.ts";
import { INSTRUMENTS, MarketPath, instrument, type InstrumentId } from "../sim/market/index.ts";
import { fetchRecoveryLesson } from "../net/recap.ts";
import { RunRecorder } from "../sim/record/index.ts";
import { bootPath, fetchMe, resumePlace } from "../sim/save/boot.ts";
import { saveApi } from "../sim/save/client.ts";
import { activeSlot } from "../sim/save/slot.ts";
import { encodeGame, parseSave, restoreGame, SaveFormatError, type RestoredGame } from "../sim/save/codec.ts";
import { SaveManager } from "../sim/save/manager.ts";
import type { DeskBankTxn, DeskFeedItem, DeskState, DeskTone, GameSave } from "../sim/save/types.ts";
import { showNotice } from "../ui/notice.ts";
import { finalScore, wellbeing } from "../sim/wellbeing/index.ts";
import { NEW_CAR, TRADE_IN, choiceLabel } from "../sim/life/events.ts";
import { bottomLine, isCorrect, tutorialOptions } from "../sim/tax/tutorial.ts";
import { bracketSlices } from "../sim/tax/federal.ts";
import { NARRATOR_NAME } from "../narration/lines.ts";
import type { TaxReturn } from "../sim/tax/types.ts";
import {
  compareStrategies,
  effectiveApr,
  enrollHardship,
  isOpen,
  owed,
  payNow,
  scoreBreakdown,
  switchToRap,
  WEIGHTS,
  type Debt,
  type Strategy,
} from "../sim/debt/index.ts";

type Tab = "home" | "cash" | "investing" | "debt" | "credit" | "score" | "cards" | "taxes";
type Range = "1W" | "1M" | "3M" | "1Y" | "ALL";
// The feed and statement ride in the saved game, so their shapes live in sim/save/types.ts.
type Tone = DeskTone;
type FeedItem = DeskFeedItem;
/** One line on the Cash tab's bank statement: money into or out of cash, or a move between cash accounts. */
type BankTxn = DeskBankTxn;
interface Decision {
  title: string;
  body: string;
  /** Housing recovery never resumes time as a side effect of choosing an option. */
  keepPaused?: boolean;
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
  ["score", "Score"],
  ["cards", "Cards"],
  ["taxes", "Taxes"],
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
let rateShock = 0;
const cashRate = (d: Date) => seriesOn("DFF", d) / 100 + rateShock;

// Standalone, the desk opens the player's saved city life, decided the way the city boots
// (sim/save/boot.ts). With the server down it runs the sample household as an unsaved demo; with
// the server up and no life to open, it sends the player to the city, where lives begin.
// The same slot the city plays (sim/save/slot.ts): the URL's, or the one this browser remembers.
const saves = saveApi(undefined, activeSlot(new URLSearchParams(location.search)));
const booted = host ? null : await fetchMe(() => saves.me(), { tries: 3, delayMs: 800 });
const me = booted?.ok ? booted.me : null;
let saved: GameSave | null = null;
let restored: RestoredGame | null = null;
/** Why there's nothing to open: no life yet, or a save this version can't read (the city deals with it). */
let noLife: "none" | "unreadable" | null = null;
if (booted && bootPath(booted, { intake: false }) === "resume" && me?.save) {
  try {
    saved = parseSave(me.save.state);
    const place = resumePlace(saved.life.place?.abbr, "", STATES, () => undefined);
    if (!place) throw new SaveFormatError(`the saved state ${saved.life.place?.abbr} doesn't exist`);
    restored = restoreGame(saved, { market: new MarketPath(saved.seed, clock.start), place: place.home, start: clock.start, cashRate });
    restored.life.place = place.home;
    clock.jumpTo(saved.day);
  } catch (err) {
    // A save this version can't read sends the player to the city to sort it out; any other
    // failure (a network hiccup, a bug) must not blank the page either, so it lands on the same
    // fallback instead of bubbling out of this top-level await.
    if (err instanceof SaveFormatError) console.warn("[save] can't open the saved game here:", err.message);
    else console.error("[save] failed to restore the saved game:", err);
    saved = restored = null;
    noLife = "unreadable";
  }
} else if (booted?.ok) {
  noLife = "none";
}
const market = host?.life().market ?? restored?.life.market ?? new MarketPath();
let life = host ? host.life() : (restored?.life ?? makeLife());
if (host || restored) life.onEvents(onLifeEvents);
// Standalone, the desk records into the saved run (or, as the demo, its own); inside the city, the city's recorder already records this life.
const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
let recorder = host || noLife ? null : startRecorder(restored ? me?.save?.runId : undefined);

function startRecorder(runId?: string): RunRecorder {
  const r = new RunRecorder({ life, seed: market.seed, base: API_BASE, runId });
  void r.begin();
  return r;
}

// Standalone with a saved life, the desk saves it too: the life, the day, and the desk's memory.
// The NPCs and mail ride along as they were loaded (the city catches the NPCs up on its next load).
// Inside the city, the city saves.
const standaloneSaver = saved && restored && me?.save ? makeSaver(saved, restored, me.save.rev) : null;

function makeSaver(g: GameSave, r: RestoredGame, baseRev: number): SaveManager {
  return new SaveManager({
    api: saves,
    build: () => encodeGame({ seed: g.seed, day: clock.day, hash: g.hash, bankRun: g.bankRun, life, town: r.town, mail: r.mail, desk: deskState(), tours: g.tours }),
    runId: () => recorder?.runId ?? null,
    baseRev,
    onStatus: (s) => {
      if (s !== "conflict") return;
      clock.speed = 0;
      void showNotice({
        title: "Playing somewhere else",
        body: "This life is open in another tab, so this one stopped saving. Reload to carry on from there.",
        actions: ["Reload"],
      }).then(() => location.reload());
    },
  });
}

/** The recorder that owns this life's run: the desk's own, or the city's inside the city. */
const runRecorder = () => (host ? host.recorder() : recorder);
const feed: FeedItem[] = [];
let decision: Decision | null = null;
const pendingHomeLosses: HomeEvent[] = [];
const handledHomeLosses = new Set<string>();
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
// What the desk remembered last time: from the city (inside it) or the save (standalone). Copied,
// so the desk never edits the city's saved copy in place.
const remembered = host ? host.deskState() : (saved?.desk ?? null);
if (remembered) {
  feed.push(...remembered.feed.map((f) => ({ ...f })));
  bank.push(...remembered.bank.map((t) => ({ ...t })));
  crash = remembered.crash && { ...remembered.crash };
  recovery = remembered.recovery && { ...remembered.recovery };
  recap = remembered.recap && { ...remembered.recap };
}
let xferOpen = false;
const xfer = { from: "checking", to: "savings", amount: 100 };
let xferMsg: { text: string; bad: boolean } | null = null;
const search = { q: "", sel: 0, open: false };
const PAGE_SUB: Record<Tab, string> = {
  home: "Net worth",
  cash: "Checking, savings, and transfers",
  investing: "Stocks and funds",
  debt: "Your payoff plan",
  credit: "Your score and what moves it",
  score: "Retirement readiness and wellbeing",
  cards: "Your card and the Card Shop",
  taxes: "Your federal and state return",
};
/** Preset extra payments, Monzo-style; the amount next to them takes anything else. */
const EXTRA_PRESETS = [0, 100, 300, 500, 1_000];

function makeLife(): PlayerLife {
  const l = new PlayerLife({ place: HOME, day: clock.day, market, cashRate, holdings: STARTER_PORTFOLIO });
  l.onEvents(onLifeEvents);
  return l;
}

// ---- Formatting ----------------------------------------------------------------

const num = (n: number, d = 0) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
/** Money always shows cents, like a bank; pass 0 only for round amounts the player picks ("Pay $100"). */
const usd = (n: number, d = 2) => `${n < 0 ? "−" : ""}$${num(n, d)}`;
const signedUsd = (n: number, d = 2) => `${n >= 0 ? "+" : "−"}$${num(n, d)}`;
const pctOf = (f: number, d = 2) => `${(f * 100).toFixed(d)}%`;
const signedPct = (f: number, d = 2) => `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(d)}%`;
/** APRs to two decimals, the way issuers and the Card Shop print them (23.96%). */
const rate = (f: number) => `${(f * 100).toFixed(2)}%`;
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
/** A typed dollar amount: digits only, whole dollars, never negative. */
const typedDollars = (s: string, max = 100_000) => Math.max(0, Math.min(max, Math.round(Number(s.replace(/[^0-9.]/g, "")) || 0)));

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

function deskState(): DeskState {
  return { feed: feed.slice(), bank: bank.slice(), crash, recovery, recap };
}

/** After anything the player does: the city (or the standalone saver) saves the life and this desk's memory. */
function saveDesk() {
  if (host) host.changed(deskState());
  else standaloneSaver?.request();
}

const debtIcon = (d?: Debt) => (d?.kind === "credit_card" ? "💳" : d?.kind === "student_federal" ? "🎓" : d?.kind === "auto" ? "🚗" : "🧾");

/** Set while a rewind replays a day's events through onLifeEvents, so its own quiet report is
 *  skipped and the rewind's explicit report (which fires even with no events that day) is the only one. */
let reportingRewind = false;

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
        const housing = e.name === "Rent" || e.name === "Property tax and insurance" || e.name === "Mortgage insurance (PMI)";
        bankLog({ day: e.day, name: e.name, category: housing ? "Housing" : "Living costs", icon: housing ? "🏠" : "🛒", amount: -e.paid, kind: "out" });
        break;
      }
      case "home":
        if (isHousingLoss(e)) {
          if (reportingRewind) log(e.day, homeLossDescription(e), "down");
          else queueHomeLoss(e);
        }
        break;
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
      // Inside the city, the city hands decision moments to the phone, which opens this window on them (showParkedDecisions).
      case "cannot_cover":
        if (!host && !decision && d) askCannotCover(d, e.due, e.available);
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
        if (!host && !decision) askBankruptcy(e.reason);
        break;
      case "bear_market":
        log(e.day, `Stocks are down ${pctOf(e.drop, 0)} from their high`, "down");
        if (!host && !decision) askBearMarket(e.day, e.drop, e.stocks);
        break;
      case "market_recovered":
        log(e.day, "Stocks are back at their high", "up");
        recovery = { day: e.day, you: e.you, held: e.held, autopilot: e.autopilot };
        recap = null;
        void askRecap(e.day);
        break;
      // Life events (sim/life/events.ts). Inside the city, the city opens this window on their choices.
      case "marriage":
        log(e.day, "Got married", "up");
        if (!host && !decision) askNextChoice();
        break;
      case "car_breakdown":
        log(e.day, `Your car broke down: the shop quotes ${usd(e.repairCost, 0)}`, "down");
        if (!host && !decision) askNextChoice();
        break;
      case "injury":
        log(e.day, `${e.cause === "car_crash" ? "Car crash" : "Injured"}: ${usd(e.outOfPocket, 0)} of a ${usd(e.bill, 0)} hospital bill is yours`, "down");
        if (!host && !decision) askNextChoice();
        break;
      case "penny_stock_tip":
        log(e.day, `A hot tip on ${e.ticker}, a penny stock`, "flat");
        if (!host && !decision) askNextChoice();
        break;
      case "penny_stock_result":
        log(e.day, `${e.ticker} paid back ${usd(e.payout)} of your ${usd(e.stake, 0)}`, e.payout >= e.stake ? "up" : "down", e.payout);
        bankLog({ day: e.day, name: `Sold ${e.ticker}`, category: "Investing", icon: "🎲", amount: e.payout, kind: "in" });
        break;
      case "divorce":
        log(e.day, e.prenup ? "Divorced; the prenup kept your money yours" : `Divorced without a prenup: your ex took ${usd(e.lost, 0)}`, "down", e.prenup ? undefined : -e.lost);
        break;
      case "recession":
        log(e.day, "The economy is in a recession: layoffs are more likely", "down");
        break;
      case "recession_over":
        log(e.day, "The recession is over", "up");
        break;
      case "choice":
        log(e.day, `${choiceLabel(e.kind, e.option, e.amount)}${e.auto ? " (no answer in a week, so the default)" : ""}`, "flat");
        break;
      case "tax_filed":
        log(e.day, `Filed your ${e.year} taxes${e.auto ? " automatically" : ""}: ${e.refundOrOwed >= 0 ? `${usd(e.refundOrOwed)} refund` : `${usd(-e.refundOrOwed)} owed`}`, e.refundOrOwed >= 0 ? "up" : "down", e.refundOrOwed);
        break;
      default:
        break;
    }
  }
  if (!reportingRewind) showNextHomeLoss();
  // Inside the city, keep its copy of the feed current; the city's next save (each game month) carries it.
  if (host && events.length && !reportingRewind) host.changed(deskState(), { quiet: true });
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
    log(clock.day, `Moved ${usd(amt, 0)} to the emergency fund`, "flat");
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
  const keepPaused = decision?.keepPaused;
  decision = null;
  showNextHomeLoss();
  // Another choice a life event left waiting asks right away, once nothing else is open.
  if (!decision) askNextChoice();
  // Inside the city, time stays paused until the player presses play, as the Money window says.
  if (!host && !keepPaused && !decision) clock.speed = resumeSpeed;
  render();
}

function isHousingLoss(event: LifeEvent): event is HomeEvent {
  return event.type === "home" && event.to === 0
    && (event.reason === "eviction" || event.reason === "foreclosure" || event.reason === "bankruptcy");
}

function homeLossDescription(event: HomeEvent): string {
  if (event.reason === "eviction") return "Eviction after two consecutive short rent payments moved you to the tent.";
  if (event.reason === "foreclosure") return "Foreclosure after 120 days of missed mortgage payments moved you to the tent.";
  return "Bankruptcy moved you to the tent.";
}

/** Live events and the phone's parked queue can deliver the same loss. Record and present it once. */
function queueHomeLoss(event: HomeEvent) {
  const key = `${event.day}:${event.reason}`;
  if (handledHomeLosses.has(key)) return;
  handledHomeLosses.add(key);
  pendingHomeLosses.push(event);
  log(event.day, homeLossDescription(event), "down");
}

function showNextHomeLoss() {
  if (decision || !pendingHomeLosses.length) return;
  askHomeLoss(pendingHomeLosses.shift()!);
}

function askHomeLoss(event: HomeEvent | null, notice = "") {
  const quote = life.quoteHome(1, clock.day);
  const needsHome = life.home.tenure === "none";
  const options: Decision["options"] = [];
  if (needsHome && quote.ok) options.push({
    label: `Rent the studio for ${usd(quote.monthlyPayment)}/month`,
    lesson: `Confirm ${usd(quote.cashNeeded)} upfront and ${usd(quote.rent)} monthly rent. Time will stay paused.`,
    good: true,
    act: () => {
      // The quote may change while another desk action is completing. Show new terms before charging anything.
      const fresh = life.quoteHome(1, clock.day);
      if (!fresh.ok || JSON.stringify(fresh) !== JSON.stringify(quote)) {
        askHomeLoss(event, "Your rental quote changed. Review the current terms before confirming.");
        return;
      }
      const result = life.chooseHome(1, clock.day);
      if (!result.ok) { askHomeLoss(event, result.error); return; }
      log(clock.day, `Rented the studio for ${usd(result.quote.rent)} a month`, "flat");
    },
  });
  options.push({ label: "Review my cash", lesson: "Check your budget before choosing a home. Time will stay paused.", good: true, act: () => go("cash") });
  openDecision({
    title: "Housing loss: plan your recovery",
    body: `${event ? homeLossDescription(event) : "You are currently living in the tent."} ${notice} ${needsHome
      ? `The tent has no rent. A studio costs ${usd(quote.rent)} a month and ${usd(quote.cashNeeded)} upfront.${quote.ok ? "" : ` ${quote.reasons.join(" ")}`}`
      : "You have already found another home."} You can review your cash before deciding.`,
    keepPaused: true,
    options,
  });
}

/** Most important first: bankruptcy, then a payment the player can't cover, then a crash. */
const DECISION_RANK: Partial<Record<LifeEvent["type"], number>> = { bankruptcy_eligible: 0, cannot_cover: 1, bear_market: 2 };

/**
 * Inside the city: opens the most important decision the city parked with the phone, and logs the
 * rest. Runs each time the Money window is shown, and once when the desk first loads, since the
 * window may open (and park the events) before this page has loaded.
 */
function showParkedDecisions() {
  if (!host) return;
  const parked = host.takeDecisions().sort((a, b) => (DECISION_RANK[a.type] ?? 9) - (DECISION_RANK[b.type] ?? 9));
  for (const event of parked) if (isHousingLoss(event)) queueHomeLoss(event);
  showNextHomeLoss();
  const deferred: LifeEvent[] = [];
  for (const e of parked) {
    if (isHousingLoss(e)) continue;
    if (decision) {
      // A decision is already open; wait for the desk's next show instead of losing this one.
      deferred.push(e);
      continue;
    }
    const d = "debtId" in e ? life.book.debts.find((x) => x.id === e.debtId) : undefined;
    if (e.type === "bankruptcy_eligible") askBankruptcy(e.reason);
    else if (e.type === "cannot_cover" && d) askCannotCover(d, e.due, e.available);
    else if (e.type === "bear_market") askBearMarket(e.day, e.drop, e.stocks);
    if (decision) continue;
    // The listener already logged the crash itself.
    if (e.type === "bankruptcy_eligible") log(e.day, "Bankruptcy became an option", "down");
    else if (e.type === "cannot_cover") log(e.day, `You couldn't cover the ${d?.name ?? ""} payment`, "down");
  }
  // A life event's choice (a breakdown, an injury, a tip, a prenup) lives on the life itself, so a
  // reload or a demo slot still asks it; its parked event only opened this window.
  if (!decision) askNextChoice();
  if (deferred.length) host.parkDecisions(deferred);
  render();
}

/** Asks the oldest choice a life event left waiting (sim/life/events.ts), if there is one. */
function askNextChoice() {
  const c = life.pendingChoices()[0];
  if (!c) return;
  const answer = (option: string) => () => void life.choose(c.kind, option, clock.day);
  switch (c.kind) {
    case "prenup":
      openDecision({
        title: "You're getting married",
        body: "Do you sign a prenup? It decides who keeps what if the marriage ever ends.",
        options: [
          { label: "Sign a prenup", lesson: "What you built stays yours if it ends. It costs a lawyer and an awkward talk, not the marriage.", good: true, act: answer("sign") },
          { label: "Skip it", lesson: "Without one, a divorce splits everything you both saved down the middle.", act: answer("skip") },
        ],
      });
      break;
    case "car_breakdown":
      openDecision({
        title: "Your car broke down",
        body: `The shop quotes ${usd(c.amount, 0)} to fix it. A new car is ${usd(NEW_CAR.monthly, 0)} a month for ${NEW_CAR.months / 12} years, and the old one trades in for ${usd(TRADE_IN, 0)}.`,
        options: [
          { label: `Repair it for ${usd(c.amount, 0)}`, lesson: "Fixing is almost always cheaper than a new payment, until repairs cost more than the car is worth.", good: true, act: answer("repair") },
          { label: `Buy a new car at ${usd(NEW_CAR.monthly, 0)} a month`, lesson: `${NEW_CAR.months} payments add up to ${usd(NEW_CAR.monthly * NEW_CAR.months, 0)}, and a new car loses value the day you drive it home.`, act: answer("replace") },
        ],
      });
      break;
    case "injury": {
      const hurt = life.log.find((e): e is Extract<LifeEvent, { type: "injury" }> => e.type === "injury" && e.day === c.day);
      const crash = hurt?.cause === "car_crash";
      const share = hurt && !hurt.insured
        ? `With no health insurance, all ${usd(c.amount, 0)} of it is yours.`
        : `Insurance pays after your deductible; your share is ${usd(c.amount, 0)}.`;
      openDecision({
        title: crash ? "You were in a car crash" : "You got hurt",
        body: `The hospital bill is ${usd(hurt?.bill ?? c.amount, 0)}. ${share}${crash ? " Your car insurance goes up for 3 years." : ""}`,
        options: [
          { label: "Ask for a payment plan", lesson: "Most hospitals offer 0% plans. Never put a hospital bill on a credit card.", good: true, act: answer("payment_plan") },
          { label: `Pay ${usd(c.amount, 0)} now`, lesson: "Cash costs no interest, but keep at least a month of expenses in the bank.", act: answer("pay_now") },
        ],
      });
      break;
    }
    case "penny_stock":
      openDecision({
        title: `A friend swears ${c.ticker ?? "this stock"} will 10x`,
        body: `It's a penny stock that trades for cents a share. Put ${usd(c.amount, 0)} in?`,
        options: [
          { label: "Pass", lesson: "Most penny stocks lose most of their value. Hot tips are how pump-and-dumps find buyers.", good: true, act: answer("pass") },
          { label: `Buy ${usd(c.amount, 0)}`, lesson: "A few do multiply. The odds are far worse than the story you're told.", act: answer("buy") },
        ],
      });
      break;
  }
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
          const r = life.fileBankruptcy(7, clock.day);
          log(clock.day, `Chapter 7: ${usd(r.discharged)} wiped out`, "down", -r.cost);
        },
      },
      {
        label: "File Chapter 13",
        lesson: "A 5-year plan repays part of it and you keep your car. It's on your report for 7 years.",
        act: () => {
          const r = life.fileBankruptcy(13, clock.day);
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
  /** Sells all or half of every stock holding (bond funds stay); returns the dollars actually sold (tiny legs under the $1 minimum are skipped). */
  const sellStocks = (share: 1 | 0.5): number => {
    let sold = 0;
    for (const pos of life.stockPositions()) {
      const r = life.sell(pos.id, share === 1 ? "all" : pos.value * share);
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
      label: `Buy ${usd(more, 0)} more`,
      lesson: "Stocks are on sale. It works if you won't need this money for years.",
      act: () => {
        const r = life.buy("LTM", more);
        choose(r.ok ? `bought ${usd(more, 0)} more` : "held");
      },
    });
  openDecision({ title: `Stocks are down ${pctOf(drop, 0)} from their high`, body: `Your stocks are worth ${usd(stocks, 0)} now. This is a bear market. What do you do?`, options });
}

/**
 * Asks the coach for the recovery lesson. The server reads the run from Tiger Data, so the day's
 * events have to be there first: this desk can hear market_recovered before the run recorder does
 * (both listen to the same life), so wait a tick, then send everything, then ask.
 * Standalone, the desk's own recorder owns the run; inside the city, the city's recorder does.
 */
async function askRecap(day: number) {
  const r = runRecorder();
  if (!r?.runId) return;
  await Promise.resolve();
  await r.idle();
  await r.tick(true);
  const got = await fetchRecoveryLesson(r.runId, day);
  // A newer recovery (or a reset) may have replaced this one while the request was out.
  if (got && recovery?.day === day && runRecorder() === r) {
    recap = { headline: got.headline, lesson: got.tip };
    saveDesk();
    scheduleRender();
  }
}

// ---- Debt helpers ------------------------------------------------------------------

/** Today's APR (hardship, penalty, or promo rate when one applies), from the engine so every screen agrees. */
const aprNow = (d: Debt): number => effectiveApr(d, clock.day);

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

// data-tour marks what Sammy's tours point at (narration/tours.ts); every match is spotlit as one box.
const heroHtml = (eyebrow: string) => `<div class="eyebrow" data-tour="hero">${eyebrow}</div><div class="hero" data-hero data-tour="hero"></div><div class="change" data-change data-tour="hero"></div><div class="bc" data-chart data-tour="hero"></div>`;
const rangesHtml = (keys: Range[] = ["1W", "1M", "3M", "1Y", "ALL"]) =>
  `<div class="ranges" role="group" aria-label="Time range" data-tour="hero">${keys.map((k) => `<button data-range="${k}" class="${k === range ? "on" : ""}">${k}</button>`).join("")}</div>`;

/** A Robinhood stock row: ticker over a subtitle, today's sparkline, then price over today's move in the same color. */
function stockRow(id: InstrumentId | "SP500", sub: string): string {
  const pts = priceSeries(id).slice(-30).map((p) => p.y);
  const ch = dayChange(id);
  const index = id === "SP500";
  const price = index ? num(market.level(clock.day), 2) : usd(market.price(id, clock.day));
  const tag = index ? "div" : "button";
  return `<${tag} class="row stock${index ? "" : " link"}" ${index ? "" : `data-fund="${id}"`}><div><b>${index ? "S&amp;P 500" : id}</b><small>${sub}</small></div>${spark(pts, dirTone(ch))}<div class="px"><b>${price}</b><small class="txt-${dirTone(ch)}">${signedPct(ch)}</small></div></${tag}>`;
}

function row(o: { title: string; sub: string; spark?: string; pill: string; tone: Tone; go?: string; attrs?: string }): string {
  const tag = o.go || o.attrs ? "button" : "div";
  return `<${tag} class="row${o.go || o.attrs ? " link" : ""}" ${o.go ? `data-go="${o.go}"` : ""} ${o.attrs ?? ""}><div><b>${o.title}</b><small>${o.sub}</small></div>${o.spark ?? "<span></span>"}<span class="pill ${o.tone}">${o.pill}</span></${tag}>`;
}

function nextCard(title: string, body: string, cta?: { label: string; act: string; disabled?: boolean; soft?: boolean }, tour?: string): string {
  return `<div class="card next"${tour ? ` data-tour="${tour}"` : ""}><div><b>${title}</b><p>${body}</p></div>${cta ? `<button class="cta${cta.soft ? " soft" : ""}" data-act="${cta.act}" ${cta.disabled ? "disabled" : ""}>${cta.label}</button>` : ""}</div>`;
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

/** The same ownership bills as the daily simulation; the mortgage has its own due date. */
function monthlyHousingBills(): { name: string; amount: number }[] {
  const bills = life.housingBills();
  return [
    { name: "Rent", amount: life.rent },
    { name: "Property tax and insurance", amount: bills.taxAndInsurance },
    { name: "Mortgage insurance (PMI)", amount: bills.pmi },
  ].filter(bill => bill.amount > 0);
}

function housingReserve(): number {
  const mortgage = life.book.debts.find(d => d.id === life.home.mortgageId && isOpen(d));
  const payment = mortgage ? Math.min(mortgage.scheduledPayment ?? 0, owed(mortgage)) : 0;
  const total = monthlyHousingBills().reduce((sum, bill) => sum + bill.amount, payment);
  // Reserve the full payment even when amortization carries a fraction of a cent.
  return Math.max(0, Math.ceil(total * 100 - 1e-6) / 100);
}

function cashAfterHousing(): number {
  return Math.max(0, Math.floor((life.cash() - housingReserve()) * 100 + 1e-6) / 100);
}

function nextMove(): string {
  moveAct = null;
  if (life.home.tenure === "none") {
    const loss = [...life.log].reverse().find(isHousingLoss) ?? null;
    moveAct = () => askHomeLoss(loss);
    return nextCard("Find a home", "Review the studio's rent and your cash before leaving the tent.", { label: "Review studio rental", act: "move" });
  }
  const open = life.book.debts.filter(isOpen);
  const spare = Math.floor(cashAfterHousing());
  const late = open.find((d) => d.pastDue > 0 && d.status !== "collections");
  if (late) {
    const amt = Math.floor(Math.min(late.pastDue, late.id === life.home.mortgageId ? life.cash() : spare));
    moveAct = () => pay(late.id, amt);
    return nextCard(`Catch up on the ${late.name}`, `${usd(late.pastDue)} is past due. Paying before it's 30 days late keeps it off your credit report.`, { label: `Pay ${usd(amt, 0)}`, act: "move", disabled: amt < 1 });
  }
  const card = open.filter((d) => d.kind === "credit_card" && d.creditLimit).sort((a, b) => aprNow(b) - aprNow(a))[0];
  const util = card ? owed(card) / (card.creditLimit ?? 1) : 0;
  if (card && util > 0.3 && spare >= 50) {
    const amt = Math.floor(Math.min(300, spare, owed(card)));
    moveAct = () => pay(card.id, amt);
    return nextCard(
      `Pay down the ${card.name}`,
      `It costs ${rate(aprNow(card))} a year and it's ${pctOf(util, 0)} maxed, which drags your score down. You can put ${usd(amt, 0)} toward it and still keep a month of housing costs.`,
      { label: `Pay ${usd(amt, 0)}`, act: "move" },
    );
  }
  const month = housingReserve() + life.living;
  const ef = life.ledger.get("emergency").balance;
  if (ef < month && spare >= 100) {
    const amt = Math.floor(Math.min(500, spare, month - ef));
    moveAct = () => fundEmergency(amt);
    return nextCard("Start an emergency fund", `One month of housing and living costs is ${usd(month)}. Money set aside keeps a surprise bill off your credit card.`, { label: `Move ${usd(amt, 0)}`, act: "move" });
  }
  if (!life.recurring.length) {
    moveAct = () => {
      life.recurring = [{ id: "LTM", amount: 100 }];
      log(clock.day, "Started auto-investing $100 every payday", "flat");
    };
    return nextCard("Invest $100 every payday", "Small automatic buys of a total-market fund are how most people build wealth. You can stop anytime.", { label: "Start", act: "move" });
  }
  const each = life.recurring.reduce((s, r) => s + r.amount, 0);
  return nextCard("You're on track", `Debt-free ${freeDate()} and investing ${usd(each, 0)} every payday.`);
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
      ${row({ title: "Cash", sub: `Checking, savings, and emergency fund · housing ${usd(housingReserve())}/mo`, spark: sparkOf(cash), pill: usd(life.cash()), tone: t(cash), go: "cash" })}
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
      ${nextCard(`Direct deposit of about ${usd(payAmt, 0)} on ${monthDay(dateOf(next))}`, `${life.employed ? "Your paycheck lands" : "Unemployment benefits land"} in checking. Monthly housing costs are ${usd(housingReserve())}; housing bills come out on the 1st and any mortgage on its due date. Living costs of ${usd(life.living)} come out on the 15th.`)}
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
        <button class="cta" data-act="xfer-go">Move ${usd(xfer.amount, 0)}</button>
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
  log(clock.day, `Moved ${usd(xfer.amount, 0)} from ${name(xfer.from)} to ${name(xfer.to)}`, "flat");
  xferMsg = { text: [`Moved ${usd(xfer.amount, 2)} to ${name(xfer.to)}.`, ...q.warnings].join(" "), bad: false };
}

/** The statement: pending moves first, then days newest first, like a bank app. */
function txnsHtml(): string {
  const pending = life.ledger.pending;
  if (!bank.length && !pending.length) return `<ul class="feed"><li class="empty">No transactions yet. Press play: paychecks land on the 1st and 15th.</li></ul>`;
  const amt = (t: Pick<BankTxn, "amount" | "kind">) =>
    `<span class="t-amt ${t.kind}">${t.kind === "in" ? "+" : t.kind === "out" ? "−" : ""}$${num(t.amount, 2)}</span>`;
  // The newest paycheck is what Sammy's taxes tour points at (withholding comes out before it lands).
  const paycheck = bank.slice(0, 40).find((t) => t.name === "Payroll direct deposit");
  const line = (t: BankTxn) => `<div class="txn"${t === paycheck ? ` data-tour="paycheck"` : ""}><span class="av" aria-hidden="true">${t.icon}</span><div><b>${esc(t.name)}</b><small>${esc(t.category)}</small></div>${amt(t)}</div>`;
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
  const bp = life.buyingPower();
  const top = open0();
  const each = life.recurring.reduce((s, r) => s + r.amount, 0);
  // Every life starts with the starter portfolio, so there is always a you line to compare.
  return {
    side: true,
    chart: twinsChart(),
    main: `${heroHtml("Investing · you vs if you had held")}${rangesHtml()}
      ${recoveryCard()}${concentrationCard()}
      ${nextCard(
        `Buying power ${usd(bp, 2)}`,
        life.recurring.length ? `Auto-invest is on: ${life.recurring.map((r) => `${usd(r.amount, 0)} of ${r.id}`).join(" and ")} every payday (${usd(each, 0)} total).` : "Money in checking you can invest. Auto-invest buys a fund for you every payday, after bills.",
        { label: life.recurring.length ? "Stop auto-invest" : "Auto-invest $100", act: "recurring", soft: true },
        "buying-power",
      )}
      ${positions.length ? `<div class="section" data-tour="holdings"><h2>Your holdings</h2><span>Value · gain since you bought</span></div>${positions
        .map((p) => row({ title: `${p.id} · ${instrument(p.id).name}`, sub: `${num(p.units, 4)} shares · paid ${usd(p.cost, 2)} · ${signedUsd(p.gain)}`, spark: spark(priceSeries(p.id).slice(-30).map((q) => q.y), dirTone(p.gain)), pill: usd(p.value, 2), tone: dirTone(p.gain), attrs: `data-fund="${p.id}" data-tour="holdings"` }))
        .join("")}` : ""}
      ${group("Funds", "Today's move", INSTRUMENTS.filter((i) => i.kind === "fund"))}
      ${group("Stocks", "Today's move", INSTRUMENTS.filter((i) => i.kind === "stock" && !i.sponsor))}
      ${group("HackRice sponsors", "Prices are simulated", INSTRUMENTS.filter((i) => i.sponsor))}
      ${top ? nextCard("Pay debt or invest?", aprNow(top) > MARKET_RETURN ? `Your ${top.name} costs ${rate(aprNow(top))} a year. Stocks have averaged about 10%, with big swings. Paying the card is a guaranteed ${rate(aprNow(top))} return, so pay it first. The exception: always take a 401(k) match.` : `Your most expensive debt, the ${top.name}, costs ${rate(aprNow(top))}. That's below the market's long-run ~10%, so investing while you pay it on schedule is reasonable.`, undefined, "debt-invest") : ""}
      ${footHtml()}`,
  };
}

function group(title: string, note: string, list: readonly (typeof INSTRUMENTS)[number][]): string {
  if (!list.length) return "";
  const sub = (i: (typeof INSTRUMENTS)[number]) => (i.kind === "fund" ? `${i.name} · ${pctOf(i.expenseRatio)} yearly fee` : `${i.name}${i.listed === false ? " · private company" : ""}`);
  return `<div class="section"><h2>${title}</h2><span>${note}</span></div>${list.map((i) => stockRow(i.id, sub(i))).join("")}`;
}

function openFund(id: InstrumentId) {
  tab = "investing";
  fund = id;
  tradeMsg = null;
  window.scrollTo(0, 0);
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
  const top = life.concentration();
  if (!top) return "";
  return nextCard(`${esc(instrument(top.id).name)} is ${pctOf(top.share, 0)} of your investments`, "One company can fall 80%. A fund spreads the risk across hundreds.", undefined, "concentration");
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
  const privateLine = inst.listed === false ? ` ${esc(inst.name)} is private in real life, so its Larp City ticker and price are made up.` : "";
  // Robinhood's detail page: your position, then key statistics from the past year of closes.
  const year = market.series(id, clock.day - 365, clock.day).filter((p) => !weekend(p.day)).map((p) => p.value);
  const yearReturn = year.length > 1 ? year[year.length - 1] / year[0] - 1 : 0;
  const ch = dayChange(id);
  const colored = (f: number) => `<span class="txt-${dirTone(f)}">${signedPct(f)}</span>`;
  const stat = (k: string, v: string, tour?: string) => `<div${tour ? ` data-tour="${tour}"` : ""}><span>${k}</span><b>${v}</b></div>`;
  const position = pos
    ? `<div class="section" data-tour="position"><h2>Your position</h2><span>${num(pos.units, 4)} shares</span></div><div class="stats" data-tour="position">${[
        stat("Market value", usd(pos.value)),
        stat("Average cost", `${usd(pos.cost / pos.units)} a share`),
        stat("Portfolio share", pctOf(pos.value / Math.max(1, life.investments()), 1)),
        stat("Today's return", `<span class="txt-${dirTone(ch)}">${signedUsd(pos.units * pos.price * (1 - 1 / (1 + ch)))}</span>`),
        stat("Total return", `<span class="txt-${dirTone(pos.gain)}">${signedUsd(pos.gain)} (${signedPct(pos.gain / pos.cost)})</span>`),
        stat("Paid", usd(pos.cost)),
      ].join("")}</div>`
    : nextCard("You don't own any yet", "Buy any dollar amount from $1; you get a fraction of a share.", undefined, "position");
  const stats = `<div class="section"><h2>Key statistics</h2><span>Past year of closes</span></div><div class="stats">${[
    stat("Today", colored(ch)),
    stat("1-year return", colored(yearReturn)),
    stat("Type", inst.kind === "fund" ? "Index fund" : inst.listed === false ? "Private company" : "Single stock"),
    stat("52-week high", usd(Math.max(...year))),
    stat("52-week low", usd(Math.min(...year))),
    inst.kind === "fund" ? stat("Yearly fee", pctOf(inst.expenseRatio), "fee") : stat("Swings vs. market", `${inst.beta.toFixed(1)}×`, "beta"),
  ].join("")}</div>`;
  return {
    side: true,
    chart,
    main: `<button class="back" data-fund-back>← Investing</button>
      ${heroHtml(`${inst.name} · ${id}`)}${rangesHtml()}
      ${position}
      <div class="card" data-tour="buy">
        <b>Buy or sell</b>
        <p>Buying power ${usd(bp, 2)}. Orders fill at today's closing price, in fractions of a share.</p>
        <div class="amounts">${[25, 100, 500, 1000].map((a) => `<button data-amt="${a}" class="${a === amount ? "on" : ""}">${usd(a, 0)}</button>`).join("")}
          <label class="amt-in">$<input type="number" min="1" step="1" value="${amount}" data-amount data-focus="amount" aria-label="Amount in dollars"></label>
        </div>
        <div class="trade">
          <button class="cta" data-trade="buy">Buy ${usd(amount, 0)}</button>
          <button class="cta plain" data-trade="sell" ${pos ? "" : "disabled"}>Sell ${usd(amount, 0)}</button>
          ${pos ? `<button class="cta plain" data-trade="sell-all">Sell all</button>` : ""}
        </div>
        <label class="toggle" data-tour="recur"><input type="checkbox" data-recur ${recurring ? "checked" : ""}> ${recurring ? `Auto-invest ${usd(recurring.amount, 0)} of ${id} every payday` : `Also buy ${usd(amount, 0)} of ${id} every payday`}</label>
        ${tradeMsg ? `<div class="msg${tradeMsg.bad ? " bad" : ""}">${esc(tradeMsg.text)}</div>` : ""}
      </div>
      ${stats}
      <div class="section"><h2>About</h2><span></span></div>
      <p class="about">${esc(inst.blurb)} ${feeLine}${privateLine}</p>
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
    ["avalanche", `${usd(proj.avalanche.interest, 0)} interest · highest rate first`],
    ["snowball", `First debt gone in ${proj.snowball.payoffs[0]?.month ?? "—"} months`],
    ["minimums", proj.minimums.stuck ? "Never paid off" : `${(proj.minimums.months / 12).toFixed(0)} years · ${usd(proj.minimums.interest, 0)} interest`],
  ];
  return {
    side: true,
    chart,
    tone: "up",
    main: `${heroHtml("Total debt")}
      <div class="seg" role="group" aria-label="Payoff strategy">${strategies.map(([k, sub]) => `<button data-strategy="${k}" class="${k === s ? "on" : ""}">${STRATEGY_NAME[k]}<small>${sub}</small></button>`).join("")}</div>
      <div class="card">
        <div class="field-head"><b>Extra each month</b><label class="amt-edit"><input inputmode="numeric" value="${usd(life.book.extraMonthly, 0)}" data-extra-in data-focus="extra" aria-label="Extra payment each month"></label></div>
        <div class="chips" role="group" aria-label="Extra payment presets">${EXTRA_PRESETS.map((v) => `<button data-extra-set="${v}" class="${life.book.extraMonthly === v ? "on" : ""}">${v ? usd(v, 0) : "None"}</button>`).join("")}</div>
        <p>${s === "minimums" ? "Minimums only: the extra isn't used. Pick Avalanche or Snowball to put it to work." : saved > 1 ? `Debt-free ${freeDate()}, and ${usd(saved, 0)} less interest than paying only the minimums.` : `Debt-free ${freeDate()}.`}</p>
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

// ---- Life score --------------------------------------------------------------------

const FACTOR_LABELS = {
  work: "Work",
  cashCushion: "Cash cushion",
  debtLoad: "Debt load",
  realIncome: "Real income",
  relationships: "Relationships",
  retirementOnTrack: "Retirement on track",
  healthCoverage: "Health coverage",
  commute: "Commute",
  homeStability: "Home stability",
} as const;

function scorePage(): Page {
  const snapshot = wellbeing(life, clock.day);
  const score = finalScore(life, clock.day);
  return {
    side: false,
    tone: score.final >= 50 ? "up" : "down",
    main: `<div class="eyebrow">Your Larp City life score</div>
      <div class="hero">${score.final.toFixed(1)}</div>
      <div class="change neutral">60% retirement readiness · 40% lifetime wellbeing</div>
      <div class="stats">${[
        ["Retirement readiness", score.RR],
        ["Lifetime wellbeing", score.Wlife],
        ["Wellbeing today", snapshot.W],
      ]
        .map(([label, value]) => `<div class="stat"><span>${label}</span><b>${(value as number).toFixed(1)}</b></div>`)
        .join("")}</div>
      <div class="section"><h2>What moves wellbeing</h2><span>Your game meter is ${snapshot.W.toFixed(0)}. CFPB 2017 report reference: 54.</span></div>
      ${snapshot.factors
        .map(
          (factor) => `<div class="row r2"><div><b>${FACTOR_LABELS[factor.name]}</b><small>${factor.note}</small><div class="meter"><span class="${factor.s >= 0.8 ? "good" : "bad"}" style="width:${Math.max(4, factor.s * 100).toFixed(0)}%"></span></div></div><span class="chip">${factor.points.toFixed(1)} / ${factor.weight}</span></div>`,
        )
        .join("")}
      <p class="foot">This is Larp City's custom life score. The CFPB reference is a financial well-being survey benchmark, not the instrument used to calculate this game score.</p>`,
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
  const paidSoFar = Math.min(stmt, card.statementPaid ?? 0);
  const left = Math.max(0, stmt - paidSoFar);
  const due = nextDue(card);
  // Home and Cards preserve the same month of rent or ownership costs.
  const spare = cashAfterHousing();
  const payAmt = Math.min(left, spare, bal);
  return {
    side: false,
    tone: util > 0.3 ? "down" : "up",
    main: `${cards.length > 1 ? `<div class="seg" style="margin:0 0 18px">${cards.map((c) => `<button data-card="${c.id}" class="${c.id === card.id ? "on" : ""}">${esc(c.name)}</button>`).join("")}</div>` : ""}
      <div class="eyebrow">${esc(card.name)} · balance</div>
      <div class="hero">${usd(bal, 2)}</div>
      <div class="change neutral">${usd(Math.max(0, limit - bal))} available of ${usd(limit)} · ${rate(aprNow(card))} a year</div>
      <div class="meter" style="height:10px;margin-top:22px"><span class="${util > 0.3 ? "bad" : "good"}" style="width:${Math.min(100, util * 100).toFixed(1)}%"></span></div>
      <div class="change neutral" style="font-size:13px;margin-top:8px">${pctOf(util, 0)} used · lenders like under 30%</div>
      ${stmt > 0.5 && left > 0.5
        ? (() => {
            moveAct = () => pay(card.id, payAmt);
            const partly = paidSoFar > 0.5 ? `${usd(paidSoFar)} paid so far, ${usd(left)} left. ` : "";
            const short = payAmt + 0.005 < left ? ` You can put ${usd(payAmt)} toward it now and still keep a month of housing costs.` : "";
            return nextCard(
              `Statement ${usd(stmt)}${due ? ` due ${monthDay(due)}` : ""}`,
              `${partly}Pay it in full by the due date and you owe no interest. Paying only the ${usd(card.minimumDue ?? 0)} minimum costs about ${usd((left * aprNow(card)) / 12)} in interest next month.${short}`,
              { label: `Pay ${usd(payAmt)}`, act: "move", disabled: payAmt < 1 },
            );
          })()
        : stmt > 0.5
          ? nextCard("Statement paid in full", `You paid the ${usd(stmt)} statement, so this cycle's purchases don't cost interest.`)
          : nextCard("Nothing due yet", "Your next statement closes at the end of the cycle. Pay it in full to skip interest.")}`,
  };
}

// ---- Taxes ----------------------------------------------------------------------------

function taxesPage(): Page {
  const stat = (k: string, v: string, tour?: string) => `<div${tour ? ` data-tour="${tour}"` : ""}><span>${k}</span><b>${v}</b></div>`;
  // Sammy's taxes tour, again (inside the city, where Sammy is).
  const replay = host ? `<button class="tour-q" data-tour-replay aria-label="Replay Sammy's taxes tour">?</button>` : "";
  const ret = life.pendingTaxReturn();
  if (!ret) {
    return {
      side: false,
      main: `${nextCard(
        "Nothing due yet",
        `Your return for the year becomes ready to file around April 15 of the following year.${life.taxTutorial.passed ? " You passed the tax tutorial, so it files itself on tax day." : ""}`,
        undefined,
        "tax-none",
      )}
        <div class="section"><h2>This year so far</h2><span>Not filed yet ${replay}</span></div>
        <div class="stats">${stat("Wages this year", usd(life.wagesYtd()))}</div>`,
    };
  }
  const totalOwed = ret.federalRefundOrOwed + ret.stateRefundOrOwed;
  // Until the player passes the tutorial, the bottom line is the question, so the page doesn't give it away.
  const tutorial = !life.taxTutorial.passed;
  return {
    side: false,
    tone: tutorial ? "flat" : totalOwed >= 0 ? "up" : "down",
    main: `<div class="section" data-tour="tax-return"><h2>Your ${ret.year} tax return</h2><span>Single filer · ${esc(ret.state)} ${replay}</span></div>
      <div class="stats" data-tour="tax-return">${[
        stat("Wages", usd(ret.wages), "tax-wages"),
        stat("Standard deduction", `−${usd(ret.federalStandardDeduction)}`, "tax-taxable"),
        stat("Federal taxable income", usd(ret.federalTaxableIncome), "tax-taxable"),
        stat("Federal tax", usd(ret.federalTax)),
        stat("Earned Income Tax Credit", ret.eic > 0 ? `−${usd(ret.eic)}` : usd(0), "tax-eic"),
        stat("Federal withheld", usd(ret.federalWithheld), "tax-withheld"),
        ...(tutorial ? [] : [stat("Federal refund/owed", usd(ret.federalRefundOrOwed))]),
        stat("State tax", usd(ret.stateTax), "tax-state"),
        stat("State withheld", usd(ret.stateWithheld), "tax-state"),
        ...(tutorial ? [] : [stat("State refund/owed", usd(ret.stateRefundOrOwed))]),
      ].join("")}</div>
      ${bracketBarHtml(ret.federalTaxableIncome)}
      ${
        tutorial
          ? taxTutorialHtml(ret)
          : nextCard(
              totalOwed >= 0 ? `Refund: ${usd(totalOwed)}` : `You owe ${usd(-totalOwed)}`,
              totalOwed >= 0 ? "File to get your refund deposited to checking." : "File to pay what you owe from checking, or leave a balance if it can't cover it.",
              { label: "File now", act: "file-taxes" },
            )
      }`,
  };
}

/** Taxable income cut into its federal brackets: each slice's width is its dollars, so only the top slice pays the top rate. */
function bracketBarHtml(taxable: number): string {
  const { slices, marginal, effective } = bracketSlices(taxable);
  if (!slices.length) return "";
  const segs = slices
    .map((s, i) => `<span class="bb-seg b${i}" style="flex-grow:${Math.max(s.amount, taxable * 0.06).toFixed(0)}" title="${usd(s.amount, 0)} taxed at ${pctOf(s.rate, 0)}">${pctOf(s.rate, 0)}</span>`)
    .join("");
  return `<div class="brackets" data-tour="tax-brackets">
      <div class="bb-bar" role="img" aria-label="Federal brackets: ${slices.map((s) => `${usd(s.amount, 0)} at ${pctOf(s.rate, 0)}`).join(", ")}">${segs}</div>
      <p>${slices.length > 1 ? `Only the top slice pays ${pctOf(marginal, 0)}. Your federal tax is ${pctOf(effective, 1)} of taxable income overall.` : `All of it falls in the first bracket, taxed at ${pctOf(marginal, 0)}.`}</p>
    </div>`;
}

/** The year-1 tax tutorial (sim/tax/tutorial.ts): four steps, then the bottom line as a question. */
function taxTutorialHtml(ret: TaxReturn): string {
  const steps = [
    `<b>What you earned.</b> Your W-2 says ${usd(ret.wages)} in wages.`,
    `<b>The standard deduction.</b> The first ${usd(ret.federalStandardDeduction)} isn't taxed, so ${usd(ret.federalTaxableIncome)} is taxable.`,
    `<b>The tax.</b> The brackets make that ${usd(ret.federalTax)} of federal tax${ret.stateTax > 0 ? ` and ${usd(ret.stateTax)} for ${esc(ret.state)}` : ""}${ret.eic > 0 ? `, less a ${usd(ret.eic)} Earned Income Tax Credit` : ""}.`,
    `<b>What you already paid.</b> Every paycheck withheld some: ${usd(ret.federalWithheld + ret.stateWithheld)} this year.`,
  ];
  return `<div class="card tutorial" data-tour="tax-quiz">
      <div class="tag">Tax tutorial · your first return</div>
      <ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      <p><b>Your bottom line is what you already paid, plus credits, minus the tax.</b> Which is it?</p>
      <div class="tutorial-opts">${tutorialOptions(ret)
        .map((o) => `<button class="opt" data-act="tax-answer" data-amount="${o.amount}"><b>${esc(o.label)}</b></button>`)
        .join("")}</div>
      <p class="hint">${life.taxTutorial.done ? "Last year's answer missed, so this return walks through it again. " : ""}Get it right and every return after this one files itself on tax day.</p>
    </div>`;
}

// ---- Side panel ------------------------------------------------------------------------

function sideHtml(): string {
  // Robinhood's side list: what you own with its share count, then everything else you can buy.
  const owned = life.positions();
  const ownedIds = new Set<string>(owned.map((p) => p.id));
  const mine = owned.map((p) => stockRow(p.id, `${num(p.units, 4)} shares`)).join("");
  const watch = ["SP500" as const, ...INSTRUMENTS.filter((i) => !ownedIds.has(i.id)).map((i) => i.id)].map((id) => stockRow(id, id === "SP500" ? "Index" : instrument(id).name)).join("");
  const rates = ([["DFF", "Fed funds"], ["MORTGAGE30US", "30-yr mortgage"]] as const)
    .map(([id, name]) => {
      const now = seriesOn(id, clock.date) + (id === "DFF" || id === "MORTGAGE30US" ? rateShock * 100 : 0);
      const pts = Array.from({ length: 30 }, (_, i) => seriesOn(id, dateOf(clock.day - 29 + i)));
      const ch = now - pts[0];
      return row({ title: name, sub: `${now.toFixed(2)}%`, spark: spark(pts, Math.abs(ch) < 0.005 ? "flat" : ch < 0 ? "up" : "down"), pill: `${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}`, tone: Math.abs(ch) < 0.005 ? "flat" : ch < 0 ? "up" : "down" });
    })
    .join("");
  const head = owned.length ? `<h3>Stocks <span>Today</span></h3>${mine}<h3 class="h3-gap">Watch list</h3>` : `<h3>Watch list <span>Today</span></h3>`;
  return `${head}${watch}${rates}<h3 class="h3-gap">Upcoming <span>Next 30 days</span></h3>${upcoming()}`;
}

function upcoming(): string {
  const items: { day: number; title: string; amt: number; tone: Tone }[] = [];
  const payAmt = (life.monthlyTakeHome / 2) * (life.employed ? 1 : 0.4);
  for (let d = clock.day + 1; d <= clock.day + 30; d++) {
    const dom = dateOf(d).getDate();
    if (dom === 1 || dom === 15) items.push({ day: d, title: "Paycheck", amt: payAmt, tone: "up" });
    if (dom === 1) for (const bill of monthlyHousingBills()) items.push({ day: d, title: bill.name, amt: bill.amount, tone: "flat" });
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

// Robinhood's top bar: the logo, a search field, and the sections. The game's time controls
// float in a dock at the bottom so the bar stays clean.
app.innerHTML = `
  <header class="top"><div class="top-in">
    <button class="logo" data-tab="home" aria-label="Larp City, home"><i>L</i></button>
    <div class="search" data-search>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input type="search" placeholder="Search stocks, cards, and pages" data-search-q aria-label="Search" autocomplete="off" spellcheck="false">
      <kbd aria-hidden="true">/</kbd>
      <div class="search-pop" data-search-pop role="listbox" hidden></div>
    </div>
    <nav class="tabs" aria-label="Sections">${TABS.map(([id, name]) => `<button data-tab="${id}">${name}</button>`).join("")}</nav>
  </div></header>
  <main class="page" data-page></main>
  <div class="shop shop-panel" data-shop hidden></div>
  <div class="dock time" role="toolbar" aria-label="Game time">
    <span class="time-date" data-date></span>
    <span class="dock-sep" aria-hidden="true"></span>
    <button data-speed="0" aria-label="Pause">❚❚</button><button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button>
    <span class="dock-sep" aria-hidden="true"></span>
    <button data-skip="7" title="Skip a week">+1W</button><button data-skip="30" title="Skip a month">+1M</button><button data-skip="365" title="Skip a year">+1Y</button>
    <div class="menu-wrap"><button data-menu aria-label="Scenarios" aria-expanded="false">⋯</button><div class="menu" data-menu-panel hidden></div></div>
  </div>
  <div data-sheet></div>`;

// ---- Search ----------------------------------------------------------------------------

interface SearchHit {
  section: string;
  title: string;
  sub: string;
  right?: string;
  run: () => void;
}

/** Stripe-style grouped results: stocks, Card Shop cards, your debts, then pages. */
function searchHits(query: string): SearchHit[] {
  const s = query.trim().toLowerCase();
  const has = (...xs: string[]) => !s || xs.some((x) => x.toLowerCase().includes(s));
  const hits: SearchHit[] = [];
  // With nothing typed, suggest the sponsors and the total-market fund.
  const stocks = INSTRUMENTS.filter((i) => has(i.id, i.name) && (s || i.sponsor || i.id === "LTM"));
  for (const i of stocks.slice(0, 6)) {
    const ch = dayChange(i.id);
    hits.push({ section: s ? "Stocks and funds" : "Suggested", title: i.id, sub: i.name, right: `${usd(market.price(i.id, clock.day))} <span class="txt-${dirTone(ch)}">${signedPct(ch)}</span>`, run: () => openFund(i.id) });
  }
  if (s) {
    for (const c of CURATED.filter((c) => has(c.name, c.issuer)).slice(0, 4))
      hits.push({ section: "Cards", title: c.name, sub: c.issuer, run: () => {
        go("cards");
        shop.select(c.slug);
      } });
    for (const d of life.book.debts.filter((d) => isOpen(d) && has(d.name, KIND_NAME[d.kind])).slice(0, 3))
      hits.push({ section: "Your debts", title: d.name, sub: `${KIND_NAME[d.kind]} · ${usd(owed(d))}`, run: () => go("debt") });
  }
  for (const [id, name] of TABS.filter(([id, name]) => has(name, PAGE_SUB[id]))) hits.push({ section: "Pages", title: name, sub: PAGE_SUB[id], run: () => go(id) });
  return hits;
}

function renderSearch() {
  const pop = q("[data-search-pop]");
  pop.hidden = !search.open;
  if (!search.open) return;
  const hits = searchHits(search.q);
  search.sel = Math.max(0, Math.min(search.sel, hits.length - 1));
  if (!hits.length) {
    pop.innerHTML = `<div class="sr-empty">Nothing matches “${esc(search.q)}”</div>`;
    return;
  }
  let html = "";
  let section = "";
  hits.forEach((h, i) => {
    if (h.section !== section) html += `<div class="sr-h">${h.section}</div>`;
    section = h.section;
    html += `<button class="sr${i === search.sel ? " on" : ""}" data-sr="${i}" role="option" aria-selected="${i === search.sel}"><b>${esc(h.title)}</b><small>${esc(h.sub)}</small>${h.right ? `<span class="sr-r">${h.right}</span>` : ""}</button>`;
  });
  pop.innerHTML = html;
  pop.querySelector(".sr.on")?.scrollIntoView({ block: "nearest" });
}

function closeSearch() {
  search.open = false;
  search.q = "";
  search.sel = 0;
  const input = q<HTMLInputElement>("[data-search-q]");
  input.value = "";
  input.blur();
  renderSearch();
}

function runHit(hit: SearchHit | undefined) {
  if (!hit) return;
  closeSearch();
  hit.run();
  render();
}

// Clicking a result must not blur the field first, or the list would close under the pointer.
q("[data-search-pop]").addEventListener("pointerdown", (ev) => ev.preventDefault());
app.addEventListener("focusin", (ev) => {
  if ((ev.target as HTMLElement).matches("[data-search-q]")) {
    search.open = true;
    renderSearch();
  }
});
app.addEventListener("focusout", (ev) => {
  if ((ev.target as HTMLElement).matches("[data-search-q]")) {
    search.open = false;
    renderSearch();
  }
});

const shopEl = q("[data-shop]");
const shop = mountShop({
  root: shopEl,
  life: () => life,
  clock,
  log: (day, _tag, text, tone) => log(day, text, tone === "info" ? "flat" : tone),
  onChange: () => {
    render();
    saveDesk();
  },
});

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
  app.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.speed) === clock.speed);
    // Sammy's tour holds the city's clock; the speed and skips wait for it.
    b.disabled = clock.held;
  });
  app.querySelectorAll<HTMLButtonElement>("[data-skip]").forEach((b) => (b.disabled = clock.held));
  const panel = q("[data-menu-panel]");
  q("[data-menu]").setAttribute("aria-expanded", String(menuOpen));
  panel.hidden = !menuOpen;
  // Moving and the rate shock would split the desk from the city's world (its map, its rates), so
  // only the standalone offline demo offers them - not inside the city, and not standalone with a
  // real saved life (that life is the city's too, once it's synced back). Start over is everywhere:
  // in the city it goes through the Calendar's "Start a new life", standalone it asks first.
  if (menuOpen)
    panel.innerHTML = `<button data-act="layoff">${life.employed ? "Get laid off" : "Find a new job"}<span>${life.employed ? "Employed" : "Unemployed"}</span></button>
      ${host || standaloneSaver ? "" : `<label>Live in <select data-move data-focus="move">${MOVES.map((s) => `<option value="${s.abbr}" ${s.abbr === life.place.abbr ? "selected" : ""}>${s.name}</option>`).join("")}</select></label>
      <button data-act="shock">${rateShock ? "Undo the rate shock" : "Rate shock: Fed +1 point"}</button>`}
      <hr><button data-act="reset">Start over</button>`;
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
  // The noLife page ("No life here yet" / "This life opens in the city") replaced #app with its
  // own static markup and never wires up a desk to show; a resize or a stray keypress must not
  // come back through here and hit the null elements it left behind.
  if (noLife) return;
  if (pointerDown || scrubbing) {
    deferred = true;
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.dataset.focus;
  const sel = active instanceof HTMLInputElement && active.type === "number" ? null : null;
  void sel;
  renderTop();
  const pages: Record<Tab, () => Page> = { home: homePage, cash: cashPage, investing: investingPage, debt: debtPage, credit: creditPage, score: scorePage, cards: cardsPage, taxes: taxesPage };
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
  if (ds.sr !== undefined) return runHit(searchHits(search.q)[Number(ds.sr)]);
  if (ds.option !== undefined && decision) {
    const current = decision;
    current.options[Number(ds.option)].act();
    // A changed recovery quote replaces this decision and needs a fresh confirmation.
    if (decision === current) closeDecision();
    saveDesk();
    return;
  }
  if (decision) return;
  if (ds.tourReplay !== undefined) return host?.tour("taxes");
  if (clock.held && (ds.speed !== undefined || ds.skip)) return;
  if (ds.menu !== undefined) menuOpen = !menuOpen;
  else if (!el.closest(".menu")) menuOpen = false;
  if (ds.tab) go(ds.tab as Tab);
  if (ds.go) go(ds.go as Tab);
  if (ds.speed !== undefined) clock.speed = Number(ds.speed);
  if (ds.skip) {
    skip(Number(ds.skip));
    saveDesk();
    return;
  }
  if (ds.range) range = ds.range as Range;
  if (ds.fund) openFund(ds.fund as InstrumentId);
  // Whether this click changes the life or the desk's remembered state, worth a (non-quiet) save;
  // a tab switch, chart range, or menu toggle isn't.
  let changed = false;
  if (ds.extraSet !== undefined) {
    life.book.extraMonthly = Number(ds.extraSet);
    changed = true;
  }
  if (ds.fundBack !== undefined) {
    fund = null;
    tradeMsg = null;
  }
  if (ds.amt) {
    amount = Number(ds.amt);
    tradeMsg = null;
  }
  if (ds.trade) {
    trade(ds.trade as "buy" | "sell" | "sell-all");
    changed = true;
  }
  if (ds.strategy) {
    life.book.strategy = ds.strategy as Strategy;
    changed = true;
  }
  if (ds.card) cardId = ds.card;
  if (ds.pay) {
    pay(ds.pay, 100);
    changed = true;
  }
  switch (ds.act) {
    case "move":
      moveAct?.();
      changed = true;
      break;
    case "xfer":
      xferOpen = !xferOpen;
      xferMsg = null;
      break;
    case "xfer-go":
      moveMoney();
      changed = true;
      break;
    case "go-debt":
      go("debt");
      break;
    case "file-taxes":
      if (life.pendingTaxReturn()) life.fileTaxes(clock.day);
      break;
    case "tax-answer": {
      const ret = life.pendingTaxReturn();
      if (!ret) break;
      const answer = Number(el.dataset.amount);
      const line = bottomLine(ret);
      const right = isCorrect(ret, answer);
      life.fileTaxes(clock.day, false, answer);
      log(
        clock.day,
        right
          ? "Tax tutorial passed: from now on, your return files itself on tax day"
          : `Tax tutorial: the bottom line was ${line >= 0 ? `a ${usd(line)} refund` : `${usd(-line)} owed`}. Next year's return walks through it again`,
        right ? "up" : "flat",
      );
      changed = true;
      break;
    }
    case "recurring":
      if (life.recurring.length) {
        life.recurring = [];
        log(clock.day, "Stopped auto-investing", "flat");
      } else {
        life.recurring = [{ id: "LTM", amount: 100 }];
        log(clock.day, "Started auto-investing $100 of LTM every payday", "flat");
      }
      changed = true;
      break;
    case "layoff":
      life.setEmployed(!life.employed, clock.day);
      changed = true;
      break;
    case "shock":
      rateShock = rateShock ? 0 : 0.01;
      log(clock.day, rateShock ? "Rate shock: the Fed raises rates a full point" : "Rates are back on the FRED path", rateShock ? "down" : "up");
      changed = true;
      break;
    case "reset":
      menuOpen = false;
      if (host) {
        // Inside the city, the Calendar asks for confirmation, then erases the life.
        host.newLife();
        return;
      }
      if (standaloneSaver) {
        void startOver(standaloneSaver);
        break;
      }
      // The offline demo: a fresh sample household.
      feed.length = 0;
      bank.length = 0;
      xferMsg = null;
      rateShock = 0;
      life = makeLife();
      recorder = startRecorder();
      crash = recovery = recap = null;
      shopShown = false;
      changed = true;
      break;
  }
  render();
  if (changed) saveDesk();
});

/** Standalone with a saved life: asks, then erases it and sends the player to the city for a new one. */
async function startOver(saver: SaveManager) {
  const speed = clock.speed;
  clock.speed = 0;
  render();
  const choice = await showNotice({
    title: "Start a new life?",
    body: `This erases your saved life for good: your money, your city, and your calendar. Larp City then starts you over with ${NARRATOR_NAME}.`,
    actions: ["Keep this life", "Erase and start over"],
  });
  if (choice === 0) {
    clock.speed = speed;
    render();
    return;
  }
  // The erased life must not be saved again while the erase is in flight.
  await saver.stop();
  try {
    await saves.deleteSave();
  } catch {
    // The erase didn't happen: keep playing this life rather than sending the player back to a
    // city that still has it.
    saver.resume();
    await showNotice({
      title: "Couldn't erase your life",
      body: "Check your connection and try again.",
      actions: ["OK"],
    });
    clock.speed = speed;
    render();
    return;
  }
  location.href = import.meta.env.BASE_URL;
}

app.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.searchQ !== undefined) {
    search.q = el.value;
    search.sel = 0;
    search.open = true;
    renderSearch();
    return;
  }
  if (el.dataset.xferAmt !== undefined) {
    xfer.amount = Math.max(0, Math.round(Number(el.value) || 0));
    xferMsg = null;
    const go = app.querySelector<HTMLButtonElement>('[data-act="xfer-go"]');
    if (go) go.textContent = `Move ${usd(xfer.amount, 0)}`;
  }
  if (el.dataset.amount !== undefined) {
    amount = Math.max(0, Math.round(Number(el.value) || 0));
    app.querySelectorAll<HTMLButtonElement>("[data-amt]").forEach((b) => b.classList.toggle("on", Number(b.dataset.amt) === amount));
    const buy = app.querySelector<HTMLButtonElement>('[data-trade="buy"]');
    const sell = app.querySelector<HTMLButtonElement>('[data-trade="sell"]');
    if (buy) buy.textContent = `Buy ${usd(amount, 0)}`;
    if (sell) sell.textContent = `Sell ${usd(amount, 0)}`;
  }
});

app.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  // Typed amounts commit on Enter or leaving the field, so a render never interrupts typing.
  if (el.dataset.extraIn !== undefined) {
    life.book.extraMonthly = typedDollars(el.value, 20_000);
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
    log(clock.day, el.checked ? `Auto-investing ${usd(amount, 0)} of ${id} every payday` : `Stopped auto-investing in ${id}`, "flat");
    render();
  }
  if (el.dataset.extraIn !== undefined || el.dataset.move !== undefined || el.dataset.recur !== undefined) saveDesk();
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
  // No desk is showing on the noLife page: none of its shortcuts (search, space to pause) apply,
  // and the elements they'd reach for (like the search field) don't exist there.
  if (noLife) return;
  const target = ev.target as HTMLElement;
  if (target.matches?.("[data-search-q]")) {
    const hits = searchHits(search.q);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      search.sel = (search.sel + (ev.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      renderSearch();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      runHit(hits[search.sel]);
    } else if (ev.key === "Escape") {
      closeSearch();
    }
    return;
  }
  // "/" (Robinhood) or ⌘K / Ctrl+K (Stripe) jumps to search from anywhere but a text field.
  const typing = target.closest?.("input, select, textarea");
  if ((ev.key === "/" && !typing) || ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k")) {
    ev.preventDefault();
    q<HTMLInputElement>("[data-search-q]").focus();
    return;
  }
  if (ev.code === "Enter" && target.matches?.("[data-extra-in]")) (target as HTMLInputElement).blur();
  if (ev.code === "Escape" && menuOpen) {
    menuOpen = false;
    render();
    return;
  }
  if (ev.code !== "Space" || decision || clock.held || (ev.target as HTMLElement).closest("input, select, button, textarea")) return;
  ev.preventDefault();
  clock.speed = clock.speed ? 0 : resumeSpeed || 1;
  render();
});
window.addEventListener("resize", () => render());

// ---- Start -----------------------------------------------------------------------------

/** The phone's Stocks app links straight to a stock page as /debt.html#stock=COF, and any
 * tab as /debt.html#tab=taxes. */
function openFromHash(): boolean {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get("stock");
  if (id && INSTRUMENTS.some((i) => i.id === id)) {
    openFund(id as InstrumentId);
    // Clear it, so tapping the same stock again still fires hashchange.
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  const tabId = params.get("tab");
  if (tabId && TABS.some(([t]) => t === tabId)) {
    go(tabId as Tab);
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  return false;
}
window.addEventListener("hashchange", () => {
  if (!noLife && openFromHash()) render();
});

if (noLife) {
  // Nothing to open here: lives start (and unreadable saves get sorted out) in the city.
  const [title, body] =
    noLife === "none"
      ? ["No life here yet", `Your money lives in Larp City. Move in with ${NARRATOR_NAME} first, then come back to see it here.`]
      : ["This life opens in the city", "Your saved life was made by a different version of Larp City. Open the city to sort it out."];
  document.documentElement.dataset.tone = "up";
  app.innerHTML = `<main class="d-nolife">
      <span class="logo" aria-hidden="true"><i>L</i></span>
      <h1>${title}</h1>
      <p>${body}</p>
      <a class="cta" href="${esc(import.meta.env.BASE_URL)}">Go to Larp City</a>
    </main>`;
} else if (host) {
  openFromHash();
  // The city's ticker drives the clock and the city calls life.onDay; every day's events
  // reach onLifeEvents, which re-renders. Decision moments come through the phone.
  host.onShow(showParkedDecisions);
  // A tour opening or closing turns the speed buttons off or back on.
  host.onTour(() => render());
  host.onRewind((day) => {
    // The city went back to the morning of `day`: drop what the desk showed from then on and show that morning again.
    const trim = <T extends { day: number }>(list: T[]) => {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].day >= day) list.splice(i, 1);
    };
    trim(feed);
    trim(bank);
    if (crash && crash.day >= day) crash = null;
    if (recovery && recovery.day >= day) recovery = recap = null;
    decision = null;
    pendingHomeLosses.length = 0;
    handledHomeLosses.clear();
    reportingRewind = true;
    onLifeEvents(life.log.filter((e) => e.day === day));
    reportingRewind = false;
    // The city trims its own copy the same way and saves once the rewound run is ready. This is the
    // one report for the rewind, whether or not that day itself had events.
    host.changed(deskState(), { quiet: true });
  });
  showParkedDecisions();
} else {
  openFromHash();
  // Standalone there is no Calendar, so no rewind: the desk only moves forward.
  clock.onDay((day) => {
    life.onDay(day, clock.date);
    void recorder?.tick();
    // Save each new game month, so long idle play is kept too.
    if (clock.date.getDate() === 1) standaloneSaver?.request();
  });
  if (standaloneSaver) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void standaloneSaver.flush();
    });
    window.addEventListener("pagehide", () => standaloneSaver.flushOnUnload());
  }
  // A restored save opens paused, so playing /debt.html next to a running city doesn't advance
  // the same real life twice; the offline demo still autoplays.
  clock.speed = restored ? 0 : 1;
  let last = performance.now();
  const frame = (now: number) => {
    clock.update(Math.min(0.25, (now - last) / 1000));
    last = now;
    requestAnimationFrame(frame);
  };
  render();
  requestAnimationFrame(frame);
}
