// Sammy's two tours (narration/tour.ts has the machinery): stocks, the first
// time the player opens the Stocks app, and taxes, the first time a return is
// ready, plus a short taxes refresher for a player who missed the bottom line
// last year. Every figure comes from the player's own life or the engine's
// tables (INSTRUMENTS, the federal brackets, the IRS penalty rates); nothing
// here is invented. Fixed lines are pre-voiced; lines with the player's numbers
// are voiced on the fly.
//
// Targets are `data-tour` attributes on the phone (ui/phone.ts) and the Money
// desk (debt-demo/main.ts), so a redesign keeps the tour pointing at the right thing.

import { STATES } from "../data/states.ts";
import { effectiveApr, isOpen } from "../sim/debt/index.ts";
import type { PlayerLife } from "../sim/life/player.ts";
import { instrument, type InstrumentId } from "../sim/market/index.ts";
import { bracketSlices, EIC_INCOME_LIMIT_CHILDLESS } from "../sim/tax/federal.ts";
import { PENALTY_RATES } from "../sim/tax/penalties.ts";
import { STATE_TAX } from "../data/state-tax.ts";
import { answerKind, bottomLine } from "../sim/tax/tutorial.ts";
import type { TaxReturn } from "../sim/tax/types.ts";
import type { TourDef, TourTarget } from "./tour.ts";

/** Long-run stock market return, as the desk's "Pay debt or invest?" card uses (research/03). */
const MARKET_RETURN = 0.1;
/** Months an unpaid tax balance waits before it becomes an IRS debt (PlayerLife.tickTaxPenalty). */
const IRS_DEBT_MONTHS = 6;

const dollars = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const cents = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (f: number, d = 0) => `${(f * 100).toFixed(d)}%`;
/** A name mid-sentence: "Car loan" reads "car loan", but "IRS balance" keeps its capitals (as welcomeBackLine does). */
const midSentence = (name: string) => (name.length > 1 && name[1] === name[1].toLowerCase() && name[1] !== name[1].toUpperCase() ? name[0].toLowerCase() + name.slice(1) : name);
const desk = (sel: string): TourTarget => ({ doc: "desk", sel });
const city = (sel: string): TourTarget => ({ doc: "city", sel });

// ---- Stocks --------------------------------------------------------------------------------

export interface StocksCtx {
  buyingPower: number;
  holdings: { id: InstrumentId; value: number; gain: number }[];
  fund: { id: InstrumentId; expenseRatio: number };
  stock: { id: InstrumentId; name: string; beta: number };
  concentration: { name: string; share: number } | null;
  topDebt: { name: string; apr: number } | null;
  /** The shares the player bought on the hands-on step. */
  bought: { units: number; amount: number } | null;
}

export function stocksContext(life: PlayerLife, day: number): StocksCtx {
  const aprNow = (d: Parameters<typeof effectiveApr>[0]) => effectiveApr(d, day);
  const fund = instrument("LTM");
  const stock = instrument("NNST");
  const conc = life.concentration();
  const top = life.book.debts.filter(isOpen).sort((a, b) => aprNow(b) - aprNow(a))[0];
  return {
    buyingPower: life.buyingPower(),
    holdings: life
      .positions()
      .sort((a, b) => b.value - a.value)
      .map((p) => ({ id: p.id, value: p.value, gain: p.gain })),
    fund: { id: fund.id, expenseRatio: fund.expenseRatio },
    stock: { id: stock.id, name: stock.name, beta: stock.beta },
    concentration: conc ? { name: instrument(conc.id).name, share: conc.share } : null,
    topDebt: top ? { name: midSentence(top.name), apr: aprNow(top) } : null,
    bought: null,
  };
}

export const STOCKS_TOUR: TourDef<StocksCtx> = {
  id: "stocks",
  offer: "This is where your investments live. Want the two-minute tour? [whispers] It's mostly me pointing at things.",
  steps: [
    {
      id: "list",
      setup: { kind: "phone", app: "stocks" },
      target: city("[data-tour=st-market]"),
      anim: "wave",
      mood: "plain",
      line: "Your phone's Stocks app. A fund owns hundreds of companies at once. A single stock is just one company, so it swings much harder.",
    },
    {
      id: "sponsors",
      target: city("[data-tour=st-sponsors]"),
      anim: "tip-hat",
      mood: "sly",
      line: "These are the HackRice sponsors. Real companies, but in here their prices are simulated. [whispers] So, no hot tips. Sorry.",
    },
    {
      id: "rates",
      target: city("[data-tour=st-rates]"),
      anim: "read",
      mood: "plain",
      line: "And these interest rates are real, from the Federal Reserve's own data. The game doesn't make these up.",
    },
    {
      id: "twins",
      setup: { kind: "desk", tab: "investing" },
      target: desk("[data-tour=hero]"),
      anim: "fly",
      mood: "plain",
      line: "This chart has three lines. You. What you'd have if you had just held. And autopilot, a 90/10 mix that never sells, never panics.",
    },
    {
      id: "buying-power",
      target: desk("[data-tour=buying-power]"),
      anim: "think",
      mood: "plain",
      line: (c) =>
        `Buying power: ${cents(c.buyingPower)}. That's what's in checking, so it's what you could invest. [slow] Leave enough for this month's bills first.`,
    },
    {
      id: "holdings",
      when: (c) => c.holdings.length > 0,
      target: desk("[data-tour=holdings]"),
      anim: "proud",
      mood: "warm",
      line: (c) => {
        const h = c.holdings[0];
        return `You already own things, starting with the portfolio you arrived with. Your ${h.id} is worth ${dollars(h.value)}, ${h.gain >= 0 ? "up" : "down"} ${dollars(h.gain)} since you bought it.`;
      },
    },
    {
      id: "fund",
      setup: { kind: "fund", id: "LTM" },
      target: desk("[data-tour=hero]"),
      anim: "step",
      mood: "plain",
      line: "This is a fund's page. The buttons under the chart change the range: a week, a month, a year, or all of it. [slow] Zoom out. It's calmer out there.",
    },
    {
      id: "fee",
      target: desk("[data-tour=fee]"),
      anim: "think",
      mood: "dry",
      line: (c) =>
        `The fee on ${c.fund.id} is ${pct(c.fund.expenseRatio, 2)} a year, about ${cents(c.fund.expenseRatio * 1000)} for every $1,000 you hold. Fees come out every year, so small ones matter.`,
    },
    {
      id: "beta",
      setup: { kind: "fund", id: "NNST" },
      target: desk("[data-tour=beta]"),
      anim: "proud",
      mood: "dry",
      line: (c) =>
        `Now a single stock. ${c.stock.name} swings ${c.stock.beta.toFixed(1)} times as much as the market. When stocks drop 10%, expect this to drop about ${Math.round(c.stock.beta * 10)}%.`,
    },
    {
      id: "buy",
      when: (c) => c.buyingPower >= 1,
      setup: { kind: "fund", id: "LTM" },
      target: desk("[data-tour=buy]"),
      advance: { kind: "action", on: { kind: "event", event: "trade" }, timeoutMs: 45_000 },
      capture: (c, got) => {
        const e = got.kind === "event" ? (got.event as { side?: string; units?: number; amount?: number }) : null;
        if (e?.side === "buy" && e.units !== undefined && e.amount !== undefined) c.bought = { units: e.units, amount: e.amount };
      },
      anim: "wave",
      mood: "warm",
      line: "Your turn. Pick an amount and press Buy. Even $25 works. I'll wait. [whispers] Owls are very patient.",
    },
    {
      id: "buy-none",
      when: (c) => c.buyingPower < 1,
      setup: { kind: "fund", id: "LTM" },
      target: desk("[data-tour=buy]"),
      anim: "think",
      mood: "plain",
      line: "This is where you'd buy, any amount from $1. Your checking is empty right now, so we'll skip the shopping. Payday fixes that.",
    },
    {
      id: "fraction",
      when: (c) => c.bought !== null,
      target: desk("[data-tour=position]"),
      anim: "cheer",
      mood: "warm",
      line: (c) =>
        `Bought! ${cents(c.bought!.amount)} got you ${c.bought!.units.toFixed(4)} shares. You don't need a whole share. You own a slice, and it grows just like the whole thing.`,
    },
    {
      id: "auto-invest",
      target: desk("[data-tour=recur]"),
      advance: { kind: "next", interactive: true },
      anim: "magic",
      mood: "plain",
      line: "This box buys the same amount every payday, on its own. That's dollar cost averaging: more shares when prices are low, fewer when they're high.",
    },
    {
      id: "concentration",
      when: (c) => c.concentration !== null,
      setup: { kind: "desk", tab: "investing" },
      target: desk("[data-tour=concentration]"),
      anim: "think",
      mood: "dry",
      line: (c) =>
        `${c.concentration!.name} is ${pct(c.concentration!.share)} of your investments. [slow] That's a lot of eggs in one basket. A fund spreads them across hundreds.`,
    },
    {
      id: "diversify",
      when: (c) => c.concentration === null,
      setup: { kind: "desk", tab: "investing" },
      target: desk("[data-tour=holdings]"),
      anim: "think",
      mood: "plain",
      line: "Your money is spread out, which is good. One company can fall 80%. A fund that owns hundreds of them almost never does.",
    },
    {
      id: "debt-or-invest",
      when: (c) => c.topDebt !== null,
      target: desk("[data-tour=debt-invest]"),
      anim: "proud",
      mood: "dry",
      line: (c) => {
        const d = c.topDebt!;
        return d.apr > MARKET_RETURN
          ? `Your ${d.name} charges ${pct(d.apr, 1)}. Stocks average about 10%, with big swings. Paying it off is a sure ${pct(d.apr, 1)}. So, the debt first. Except: always take a 401(k) match.`
          : `Your ${d.name} charges ${pct(d.apr, 1)}, under the market's long-run 10%. So investing while you pay it on schedule is fine. And always take a 401(k) match.`;
      },
    },
    {
      id: "no-debt",
      when: (c) => c.topDebt === null,
      anim: "cheer",
      mood: "warm",
      line: "No debt to weigh against investing. Lovely. One rule still stands: if your job matches your 401(k), always take the match. It's free money.",
    },
    {
      id: "crash",
      target: desk("[data-tour=hero]"),
      anim: "think",
      mood: "dry",
      line: "Someday the market will crash. Time stops, and I'll ask what you want to do. Selling in a panic locks in the loss. Holders usually get the rebound.",
    },
    {
      id: "wrap",
      anim: "cheer",
      mood: "warm",
      line: "That's the tour. [laughs] You now know more than most people with a brokerage app. The question mark in Stocks plays it again.",
    },
  ],
};

// ---- Taxes ---------------------------------------------------------------------------------

export interface TaxesCtx {
  /** The return waiting to be filed, or null (a replay between tax seasons). */
  ret: TaxReturn | null;
  stateName: string;
  noIncomeTax: boolean;
  /** Whether the Cash tab's statement has a paycheck to point at. */
  paycheck: boolean;
  /** The bottom line the player picked on the quiz. */
  answer: number | null;
}

export function taxesContext(life: PlayerLife, o: { paycheck: boolean }): TaxesCtx {
  const ret = life.pendingTaxReturn();
  const abbr = ret?.state ?? life.place.abbr;
  return {
    ret,
    stateName: STATES.find((s) => s.abbr === abbr)?.name ?? abbr,
    noIncomeTax: STATE_TAX[abbr]?.type === "none",
    paycheck: o.paycheck,
    answer: null,
  };
}

const hasReturn = (c: TaxesCtx) => c.ret !== null;
const answered = (c: TaxesCtx) => c.ret !== null && c.answer !== null;

/** The return's bottom line in words: "a $412 refund" or "$95 owed". */
const bottomWords = (n: number) => (n >= 0 ? `a ${dollars(n)} refund` : `${dollars(n)} owed`);

/** Sammy's reaction to the quiz answer: a cheer, or the exact mistake with the right math from the player's own return. */
export function answerLine(ret: TaxReturn, answer: number): string {
  const paid = ret.federalWithheld + ret.stateWithheld;
  const tax = ret.federalTax + ret.stateTax;
  const line = bottomLine(ret);
  const math = `${dollars(paid)} paid${ret.eic > 0 ? `, plus a ${dollars(ret.eic)} credit,` : ""} minus ${dollars(tax)} of tax is ${bottomWords(line)}.`;
  switch (answerKind(ret, answer)) {
    case "right":
      return `Correct! It's ${bottomWords(line)}. [laughs] From now on, your return files itself every tax day.`;
    case "forgot-withholding":
      return `Close, but that's the tax itself. Your paychecks already paid ${paid >= tax ? "all of it, and then some" : "most of it"}. ${math} We'll try again next year.`;
    case "forgot-tax":
      return `That counts what you paid, but forgets the tax. ${math} We'll try again next year.`;
    default:
      return `Not quite. ${math} We'll try again next year.`;
  }
}

const BRACKETS_STEP: TourDef<TaxesCtx>["steps"][number] = {
  id: "brackets",
  when: hasReturn,
  target: desk("[data-tour=tax-brackets]"),
  anim: "think",
  mood: "plain",
  line: (c) => {
    const r = c.ret!;
    if (r.federalTaxableIncome <= 0) return "Your income is under the standard deduction, so there's no federal income tax at all. The bracket bar stays empty. Nice.";
    const b = bracketSlices(r.federalTaxableIncome);
    if (b.slices.length === 1)
      return `Federal tax: ${dollars(r.federalTax)}. Tax comes in brackets, and all of yours fits in the first one, taxed at ${pct(b.marginal)}. Earn more, and only the extra pays more.`;
    return `Federal tax: ${dollars(r.federalTax)}. Brackets tax each slice at its own rate, so only your top slice pays ${pct(b.marginal)}. Overall that's ${pct(b.effective, 1)}.`;
  },
};

const WITHHELD_STEP: TourDef<TaxesCtx>["steps"][number] = {
  id: "withheld",
  when: hasReturn,
  setup: { kind: "desk", tab: "taxes" },
  target: desk("[data-tour=tax-withheld]"),
  anim: "read",
  mood: "plain",
  line: (c) => `Every paycheck already sent the IRS some of your pay. That's withholding: ${dollars(c.ret!.federalWithheld)} last year. Think of it as a down payment on your tax.`,
};

const QUIZ_STEPS: TourDef<TaxesCtx>["steps"] = [
  {
    id: "quiz",
    when: hasReturn,
    setup: { kind: "desk", tab: "taxes" },
    target: desk("[data-tour=tax-quiz]"),
    advance: { kind: "action", on: { kind: "click", sel: "[data-act=tax-answer]" }, timeoutMs: 90_000 },
    capture: (c, got) => {
      const n = got.kind === "click" ? Number(got.data.amount) : NaN;
      if (Number.isFinite(n)) c.answer = n;
    },
    anim: "think",
    mood: "plain",
    line: "Now the big question. Your bottom line is what you already paid, plus credits, minus the tax. Pick the one you think is right.",
  },
  {
    id: "reaction",
    when: answered,
    anim: "proud",
    mood: "warm",
    line: (c) => answerLine(c.ret!, c.answer!),
  },
];

const PENALTY_STEPS: TourDef<TaxesCtx>["steps"] = [
  {
    id: "late",
    anim: "proud",
    mood: "dry",
    line: `One last thing. File late and the IRS adds ${pct(PENALTY_RATES.fileMonthly)} of what you owe each month, up to ${pct(PENALTY_RATES.fileCap)}. Pay late, and it's another ${pct(PENALTY_RATES.payMonthly, 1)} a month, plus interest.`,
  },
  {
    id: "debt",
    anim: "think",
    mood: "plain",
    line: `Leave it unpaid for ${IRS_DEBT_MONTHS} months and it turns into an IRS debt, and missed payments on that hurt your credit score. [slow] So, file by April 15.`,
  },
];

export const TAXES_TOUR: TourDef<TaxesCtx> = {
  id: "taxes",
  steps: [
    {
      id: "intro",
      when: hasReturn,
      setup: { kind: "desk", tab: "taxes" },
      target: desk("[data-tour=tax-return]"),
      anim: "read",
      mood: "plain",
      line: "Tax season. Your return for last year is ready, so let's walk through it together. [slow] It's less scary than it sounds.",
    },
    {
      id: "nothing",
      when: (c) => c.ret === null,
      setup: { kind: "desk", tab: "taxes" },
      target: desk("[data-tour=tax-none]"),
      anim: "read",
      mood: "plain",
      line: "Nothing to file right now. Your return shows up around April 15, and I'll walk you through it then. Here's the gist meanwhile.",
    },
    {
      id: "wages",
      when: hasReturn,
      target: desk("[data-tour=tax-wages]"),
      anim: "think",
      mood: "plain",
      line: (c) => `First, wages. You earned ${dollars(c.ret!.wages)} from your paychecks last year. In real life, that's the number on your W-2 form.`,
    },
    {
      id: "taxable",
      when: hasReturn,
      target: desk("[data-tour=tax-taxable]"),
      anim: "magic",
      mood: "plain",
      line: (c) => `The standard deduction means your first ${dollars(c.ret!.federalStandardDeduction)} isn't taxed at all. So only ${dollars(c.ret!.federalTaxableIncome)} counts as taxable income.`,
    },
    BRACKETS_STEP,
    {
      id: "eic",
      when: hasReturn,
      target: desk("[data-tour=tax-eic]"),
      anim: "think",
      mood: "plain",
      line: (c) =>
        c.ret!.eic > 0
          ? `You also got the Earned Income Tax Credit: ${dollars(c.ret!.eic)}. It's for workers earning under ${dollars(EIC_INCOME_LIMIT_CHILDLESS)} a year, and it cuts your tax directly.`
          : `No Earned Income Tax Credit this time. Without kids, it's for workers earning under ${dollars(EIC_INCOME_LIMIT_CHILDLESS)} a year, and you earned more. [whispers] The good problem.`,
    },
    WITHHELD_STEP,
    {
      id: "paycheck",
      when: (c) => hasReturn(c) && c.paycheck,
      setup: { kind: "desk", tab: "cash" },
      target: desk("[data-tour=paycheck]"),
      anim: "step",
      mood: "plain",
      line: "Here's one of those paychecks on your statement. What lands in checking is after withholding. The rest already went to taxes.",
    },
    {
      id: "state",
      when: hasReturn,
      setup: { kind: "desk", tab: "taxes" },
      target: desk("[data-tour=tax-state]"),
      anim: "tip-hat",
      mood: "sly",
      line: (c) =>
        c.noIncomeTax
          ? `You live in ${c.stateName}, one of 9 states with no income tax on wages. [slow] That's a real reason people move there.`
          : `${c.stateName} taxes income too: ${dollars(c.ret!.stateTax)}, and your paychecks withheld ${dollars(c.ret!.stateWithheld)} for it. 9 states have no income tax at all.`,
    },
    ...QUIZ_STEPS,
    ...PENALTY_STEPS,
    {
      id: "wrap",
      anim: "cheer",
      mood: "warm",
      line: "And that's taxes. [laughs] You survived. The question mark on the Taxes tab plays this again.",
    },
  ],
};

/** Next year's short version, for a player whose answer missed: the brackets, withholding, and the question again. */
export const TAXES_REFRESHER: TourDef<TaxesCtx> = {
  id: "taxes-refresher",
  steps: [
    {
      id: "intro",
      when: hasReturn,
      setup: { kind: "desk", tab: "taxes" },
      target: desk("[data-tour=tax-return]"),
      anim: "wave",
      mood: "plain",
      line: "Tax season again. Last year's bottom line tripped you up, so here's the short version.",
    },
    BRACKETS_STEP,
    WITHHELD_STEP,
    ...QUIZ_STEPS,
    {
      id: "wrap",
      anim: "cheer",
      mood: "warm",
      line: "That's the refresher. [laughs] Much quicker the second time.",
    },
  ],
};

export const TOURS = [STOCKS_TOUR, TAXES_TOUR, TAXES_REFRESHER] as const;
