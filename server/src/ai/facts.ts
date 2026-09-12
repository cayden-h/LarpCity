// server/src/ai/facts.ts
// The numbers the AI coach and the newspaper may use. They come from the
// run's own data in Tiger Data (daily snapshots and life events), never from
// text the browser sends, and the same facts drive plain-text fallbacks when
// Gemini is busy or down, so feedback and the paper always have something.

import type { EventRow, SnapshotRow } from "../store/runs.js";
import type { Profile } from "../store/saves.js";

/** Calendar date of game day 0 (game/src/engine/clock.ts). */
export const GAME_START_MS = Date.UTC(2026, 8, 11);

export function gameDate(day: number): string {
  return new Date(GAME_START_MS + day * 86_400_000).toISOString().slice(0, 10);
}

/** Who the player is, from their stored profile: the job they gave the owl and their state. Never salary or balances; the snapshots carry the money. */
export interface PlayerFacts {
  job: string | null;
  state: string;
}

export function playerFacts(p: Profile | null): PlayerFacts | undefined {
  return p ? { job: p.job, state: p.state } : undefined;
}

/** The meeting's three feedback moments (2026-09-11): a goal, bankruptcy, and a big portfolio swing; plus the market's recovery after a crash. */
export type Trigger = "goal" | "bankruptcy" | "swing" | "recovery";

export interface FeedbackFacts {
  trigger: Trigger;
  date: string;
  goal?: string;
  netWorth: number;
  cash: number;
  investments: number;
  debt: number;
  /** Change over the 90 days before, when that far back is recorded. */
  netWorthChange90d: number | null;
  investmentsChange90d: number | null;
  /** From the 180 days before. */
  recent: {
    missedPayments: number;
    lateMarks: number;
    cannotCover: number;
    sales: number;
    paidOff: string[];
    bankruptcyReason?: string;
  };
  /** Recovery only: the last crash and how each investing line came through. */
  recovery?: RecoveryFacts;
  /** The player's stored profile, when they have one. */
  player?: PlayerFacts;
}

/** A crash and its recovery, from the run's bear_market, trade, and market_recovered events (game/src/sim/life/player.ts). */
export interface RecoveryFacts {
  /** How far stocks fell from their high, in whole percent. */
  dropPct: number;
  /** Months from the crash to the new high. */
  months: number;
  /** What the player did in between, read from their trades (auto-invest buys don't count). */
  choice: "held" | "sold" | "bought more";
  sold: number;
  bought: number;
  /** The player's investing line, the same buys never sold, and the 90/10 autopilot, at the recovery. */
  you: number;
  held: number;
  autopilot: number;
  /** held minus you: what selling cost (negative when the player came out ahead). */
  costOfSelling: number;
}

export interface Story {
  title: string;
  where: string;
  blurb: string;
  impact: string;
}

export interface Headline {
  date: string;
  kind: string;
  text: string;
}

export interface NewsFacts {
  from: string;
  to: string;
  days: number;
  netWorthStart: number | null;
  netWorthEnd: number | null;
  high: { date: string; netWorth: number } | null;
  low: { date: string; netWorth: number } | null;
  debtStart: number | null;
  debtEnd: number | null;
  /** How many of each notable event (the kinds that make headlines). */
  notableCounts: Record<string, number>;
  /** Routine activity, context only: the paper doesn't write stories about it. */
  routine: { paychecks: number; bills: number; debtPayments: number };
  /** The events worth a story, oldest first (at most 12). */
  headlines: Headline[];
  /** The player's stored profile, when they have one. */
  player?: PlayerFacts;
}

export interface Feedback {
  headline: string;
  tip: string;
  mood: "cheer" | "warn" | "console";
}

/** Facts carry whole dollars, so the model writes "$36,475", never "36475.26". */
const whole = Math.round;
const cash = (s: SnapshotRow) => s.checking + s.savings;
const invested = (s: SnapshotRow) => s.brokerage + s.retirement;
const money = (x: number) => `${x < 0 ? "-" : ""}$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * `snapshots` are the run's daily rows up to `day` (at least the last 90 days);
 * `events` are its events from the 180 days before `day`.
 * `recoveryEvents` are the run's bear_market, market_recovered, and trade events far enough back to
 * include the last crash; they default to `events`.
 */
export function feedbackFacts(
  trigger: Trigger,
  day: number,
  snapshots: SnapshotRow[],
  events: EventRow[],
  goal?: string,
  recoveryEvents: EventRow[] = events,
): FeedbackFacts {
  const sorted = [...snapshots].filter((s) => s.day <= day).sort((a, b) => a.day - b.day);
  const now = sorted[sorted.length - 1];
  if (!now) throw new Error("no snapshot recorded for that day yet");
  const then = sorted.find((s) => s.day >= day - 90);
  const back = then && then.day <= day - 60 ? then : null; // only compare when the window is really there
  const bankruptcy = [...events].reverse().find((e) => e.kind === "bankruptcy_eligible");
  const recovery = trigger === "recovery" ? recoveryFacts(day, recoveryEvents) : null;
  return {
    trigger,
    date: gameDate(day),
    ...(goal ? { goal } : {}),
    netWorth: whole(now.netWorth),
    cash: whole(cash(now)),
    investments: whole(invested(now)),
    debt: whole(now.debt),
    netWorthChange90d: back ? whole(now.netWorth - back.netWorth) : null,
    investmentsChange90d: back ? whole(invested(now) - invested(back)) : null,
    recent: {
      missedPayments: events.filter((e) => e.kind === "missed").length,
      lateMarks: events.filter((e) => e.kind === "late_mark").length,
      cannotCover: events.filter((e) => e.kind === "cannot_cover").length,
      sales: events.filter((e) => e.kind === "trade" && e.payload.side === "sell").length,
      paidOff: events.filter((e) => e.kind === "paid_off").map((e) => str(e.payload.name)).filter(Boolean),
      ...(bankruptcy ? { bankruptcyReason: str(bankruptcy.payload.reason) } : {}),
    },
    ...(recovery ? { recovery } : {}),
  };
}

/** The market recovery recorded on `day` and the bear market before it; null until that day's recovery is stored. */
export function crashAndRecovery(day: number, events: EventRow[]): { bear: EventRow; rec: EventRow } | null {
  const sorted = [...events].sort((a, b) => a.day - b.day);
  const rec = sorted.filter((e) => e.kind === "market_recovered" && e.day === day).at(-1);
  const bear = rec && sorted.filter((e) => e.kind === "bear_market" && e.day <= rec.day).at(-1);
  return rec && bear ? { bear, rec } : null;
}

/** The recovery recorded on `day` and the bear market before it, and how each investing line came through. */
export function recoveryFacts(day: number, events: EventRow[]): RecoveryFacts | null {
  const pair = crashAndRecovery(day, events);
  if (!pair) return null;
  const { bear, rec } = pair;
  const trades = events.filter((e) => e.kind === "trade" && e.day >= bear.day && e.day <= rec.day && e.payload.recurring !== true);
  const total = (side: string) => trades.filter((e) => e.payload.side === side).reduce((s, e) => s + num(e.payload.amount), 0);
  const sold = total("sell");
  const bought = total("buy");
  const p = rec.payload;
  return {
    dropPct: Math.round(num(bear.payload.drop) * 100),
    months: Math.max(0, Math.round((rec.day - bear.day) / 30.44)),
    // A sale bought back before the recovery still reads "sold"; sold and bought carry the dollars for the coach.
    choice: sold > 0 ? "sold" : bought > 0 ? "bought more" : "held",
    sold: whole(sold),
    bought: whole(bought),
    you: whole(num(p.you)),
    held: whole(num(p.held)),
    autopilot: whole(num(p.autopilot)),
    costOfSelling: whole(num(p.held) - num(p.you)),
  };
}

/** A plain-language line for an event worth a story, or null for routine ones (paychecks, bills). */
export function describe(e: EventRow): string | null {
  const p = e.payload;
  switch (e.kind) {
    case "paid_off":
      return `Paid off the ${str(p.name) || "debt"}`;
    case "missed":
      return `Missed a ${money(num(p.due))} payment and paid a ${money(num(p.fee))} late fee`;
    case "late_mark":
      return `A ${num(p.severity)}-day late mark went on the credit report; the score went from ${num(p.scoreBefore)} to ${num(p.scoreAfter)}`;
    case "penalty_apr":
      return `A card switched to a ${(num(p.apr) * 100).toFixed(2)}% penalty APR`;
    case "collections":
      return `A ${money(num(p.balance))} debt went to collections`;
    case "repossessed":
      return `The car was repossessed, with ${money(num(p.deficiency))} still owed`;
    case "default":
      return "The student loans went into default";
    case "bankruptcy_eligible":
      return `Bankruptcy became an option: ${str(p.reason)}`;
    case "moved":
      return `Moved from ${str(p.from)} to ${str(p.to)}, where rent is ${money(num(p.rent))} a month`;
    case "job":
      return p.employed ? "Started a new job" : "Lost their job";
    case "trade":
      return p.side === "sell" ? `Sold ${money(num(p.amount))} of ${str(p.id)}` : null;
    default:
      return null;
  }
}

/** `snapshots` and `events` cover `from` to `to` (inclusive). */
export function newsFacts(from: number, to: number, snapshots: SnapshotRow[], events: EventRow[]): NewsFacts {
  const s = [...snapshots].filter((r) => r.day >= from && r.day <= to).sort((a, b) => a.day - b.day);
  const hi = s.reduce<SnapshotRow | null>((m, r) => (!m || r.netWorth > m.netWorth ? r : m), null);
  const lo = s.reduce<SnapshotRow | null>((m, r) => (!m || r.netWorth < m.netWorth ? r : m), null);
  const notableCounts: Record<string, number> = {};
  const routine = { paychecks: 0, bills: 0, debtPayments: 0 };
  const headlines: Headline[] = [];
  for (const e of events) {
    if (e.day < from || e.day > to) continue;
    if (e.kind === "paycheck") routine.paychecks++;
    else if (e.kind === "bill") routine.bills++;
    else if (e.kind === "payment") routine.debtPayments++;
    const text = describe(e);
    if (!text) continue;
    notableCounts[e.kind] = (notableCounts[e.kind] ?? 0) + 1;
    headlines.push({ date: gameDate(e.day), kind: e.kind, text });
  }
  const first = s[0];
  const last = s[s.length - 1];
  return {
    from: gameDate(from),
    to: gameDate(to),
    days: to - from + 1,
    netWorthStart: first ? whole(first.netWorth) : null,
    netWorthEnd: last ? whole(last.netWorth) : null,
    high: hi ? { date: gameDate(hi.day), netWorth: whole(hi.netWorth) } : null,
    low: lo ? { date: gameDate(lo.day), netWorth: whole(lo.netWorth) } : null,
    debtStart: first ? whole(first.debt) : null,
    debtEnd: last ? whole(last.debt) : null,
    notableCounts,
    routine,
    // Keep the biggest stories when there are many: the rarer kinds first, then the latest.
    headlines: headlines.length > 12 ? pickHeadlines(headlines, notableCounts) : headlines,
  };
}

function pickHeadlines(all: Headline[], counts: Record<string, number>): Headline[] {
  const ranked = [...all].sort((a, b) => counts[a.kind] - counts[b.kind] || (a.date < b.date ? 1 : -1)).slice(0, 12);
  return ranked.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The fallback coach line when Gemini can't answer, from the same facts. */
export function templateFeedback(f: FeedbackFacts): Feedback {
  if (f.trigger === "bankruptcy") {
    const missed = f.recent.missedPayments ? `You missed ${f.recent.missedPayments} payment${f.recent.missedPayments === 1 ? "" : "s"} in the last six months` : "Payments fell behind";
    return {
      headline: "Here's what went wrong",
      tip: `${missed} and owe ${money(f.debt)} against ${money(f.cash)} in cash. Calling a lender for a hardship plan before a payment is 90 days late keeps it out of collections.`,
      mood: "console",
    };
  }
  if (f.trigger === "swing") {
    const change = f.investmentsChange90d ?? 0;
    const base = f.investments - change;
    const pct = base > 0 ? Math.round((Math.abs(change) / base) * 100) : null;
    const moved = `Your investments ${change >= 0 ? "rose" : "fell"} ${pct !== null ? `${pct}%` : money(Math.abs(change))} in three months.`;
    return change >= 0
      ? { headline: "A big run-up", tip: `${moved} A big win is a good time to rebalance, so one holding doesn't decide your future.`, mood: "warn" }
      : { headline: "A rough stretch for the market", tip: `${moved} Selling after a drop locks the loss in; money you won't need for five years has historically had time to recover.`, mood: "console" };
  }
  if (f.trigger === "recovery") {
    const r = f.recovery;
    if (!r) return { headline: "Stocks are back at their high", tip: "Holding through a drop is how investors get the rebound.", mood: "cheer" };
    const took = r.months < 1 ? "less than a month" : `${r.months} month${r.months === 1 ? "" : "s"}`;
    const back = `Stocks fell ${r.dropPct}% and took ${took} to get back to their high.`;
    if (r.choice === "held") return { headline: "You rode it out", tip: `${back} Holding through it got you the whole rebound: ${money(r.you)} now.`, mood: "cheer" };
    if (r.choice === "bought more") return { headline: "Buying the dip paid off", tip: `${back} You added ${money(r.bought)} while stocks were down and have ${money(r.you)} now.`, mood: "cheer" };
    // Sold (including a sale bought back before the recovery: the label follows the first move, the dollars tell the rest).
    if (r.costOfSelling > 1) return { headline: `Selling cost you ${money(r.costOfSelling)}`, tip: `${back} You have ${money(r.you)}; holding would be worth ${money(r.held)}. Money you won't need for years can ride out a drop.`, mood: "console" };
    if (r.costOfSelling < -1) return { headline: `Selling paid off by ${money(-r.costOfSelling)}`, tip: `${back} You beat holding this time, but most people who sell in a crash miss the rebound.`, mood: "warn" };
    return { headline: "You came out even with holding", tip: `${back} Selling and buying back left you about where holding would have: ${money(r.you)}.`, mood: "cheer" };
  }
  return {
    headline: f.goal ? `You reached ${f.goal}` : "Goal reached",
    tip:
      f.debt > 0
        ? `Net worth is ${money(f.netWorth)}. Paying down the ${money(f.debt)} of debt next frees up money for the next goal.`
        : `Net worth is ${money(f.netWorth)} with no debt. Keep the same habits going toward the next goal.`,
    mood: "cheer",
  };
}

/** The fallback newspaper when Gemini can't answer: the net worth story plus the biggest events. */
export function templateNews(f: NewsFacts): Story[] {
  const stories: Story[] = [];
  if (f.netWorthStart !== null && f.netWorthEnd !== null) {
    const change = f.netWorthEnd - f.netWorthStart;
    stories.push({
      title: `Net worth ${change >= 0 ? "up" : "down"} ${money(Math.abs(change))}`,
      where: "Your finances",
      blurb: `From ${f.from} to ${f.to}, net worth went from ${money(f.netWorthStart)} to ${money(f.netWorthEnd)}${f.low ? `, with a low of ${money(f.low.netWorth)} on ${f.low.date}` : ""}.`,
      impact: f.debtEnd !== null && f.debtStart !== null && f.debtEnd < f.debtStart ? `Debt fell by ${money(f.debtStart - f.debtEnd)}.` : "Debt didn't shrink over this stretch.",
    });
  }
  for (const h of [...f.headlines].reverse().slice(0, 3)) {
    stories.push({ title: h.text, where: "Your finances", blurb: `On ${h.date}: ${h.text.charAt(0).toLowerCase()}${h.text.slice(1)}.`, impact: impactOf(h.kind) });
  }
  if (!stories.length) stories.push({ title: "A quiet stretch", where: "Your finances", blurb: `Nothing big happened from ${f.from} to ${f.to}.`, impact: "Quiet months are when saving adds up." });
  return stories;
}

function impactOf(kind: string): string {
  switch (kind) {
    case "paid_off":
      return "That payment is now free for savings or the next debt.";
    case "missed":
    case "late_mark":
      return "Late payments stay on a credit report for seven years and raise the rate on the next loan.";
    case "collections":
    case "repossessed":
    case "default":
      return "This hurts the credit score for years; a hardship plan or payment arrangement is still worth asking for.";
    case "bankruptcy_eligible":
      return "Bankruptcy stops the debt but stays on the credit report for up to ten years.";
    case "moved":
      return "Rent and living costs now follow the new state's prices.";
    case "job":
      return "An emergency fund is what covers the months between paychecks.";
    case "trade":
      return "Selling moves money out of the market; timing it well is harder than it looks.";
    default:
      return "It changes where the money goes next.";
  }
}
