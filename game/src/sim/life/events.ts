// Random life events (meeting 2026-09-13): car breakdowns, injuries, divorce,
// penny-stock tips, and recession layoffs. Every roll is keyed by (seed, kind,
// day) through engine/rng.ts, the same way the yearly marriage roll is, so a
// run's events replay exactly on resume and rewind, and nothing the player does
// moves another event's day. The rates are gameplay placeholders, halved on
// 2026-09-13 because events came too often (about 13 in a 40-year life, down
// from 26: a pause every three years or so); the money rules below them are real
// (deductibles and coinsurance, a 72-month car loan, community property).
//
// This file is pure: PlayerLife owns the state and applies the consequences.

import { rngFor } from "../../engine/rng.ts";

/** A choice an event leaves the player; the city pauses on it and the Money desk asks it. */
export type ChoiceKind = "prenup" | "car_breakdown" | "injury" | "penny_stock";

/** What each choice can be answered with; the first is the default an unanswered choice takes. */
export const CHOICE_OPTIONS = {
  prenup: ["skip", "sign"],
  car_breakdown: ["repair", "replace"],
  injury: ["payment_plan", "pay_now"],
  penny_stock: ["pass", "buy"],
} as const satisfies Record<ChoiceKind, readonly string[]>;

export type ChoiceOption<K extends ChoiceKind = ChoiceKind> = (typeof CHOICE_OPTIONS)[K][number];

/** A choice waiting for an answer. `amount` is the repair cost, the out-of-pocket bill, or the stake. */
export interface PendingChoice {
  kind: ChoiceKind;
  day: number;
  amount: number;
  /** The penny stock's ticker. */
  ticker?: string;
}

const whole = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** How an answered choice reads in the calendar and the desk's feed. */
export function choiceLabel(kind: ChoiceKind, option: string, amount: number): string {
  switch (kind) {
    case "prenup":
      return option === "sign" ? "Signed a prenup" : "Married without a prenup";
    case "car_breakdown":
      return option === "replace" ? `Bought a new car (${whole(amount)} loan)` : `Repaired the car (${whole(amount)})`;
    case "injury":
      return option === "pay_now" ? `Paid the hospital ${whole(amount)}` : `Put ${whole(amount)} on the hospital's 0% plan`;
    case "penny_stock":
      return option === "buy" ? `Bought ${whole(amount)} of a penny stock` : "Passed on the penny stock tip";
  }
}

/** Days a choice waits before a skip or an idle city answers it with the default. */
export const CHOICE_DAYS = 7;

export const EVENT_RATES = {
  injuryPerYear: 0.05,
  /** Share of injuries that are car crashes, for a player with a car. */
  carCrashShare: 0.4,
  divorcePerYear: 0.015,
  carBreakdownBasePerYear: 0.05,
  /** Each year of the car's age adds this much yearly chance. */
  carBreakdownPerCarYear: 0.03,
  pennyTipPerYear: 0.1,
  /** Monthly chance of a layoff while the economy is in recession. */
  recessionLayoffPerMonth: 0.02,
} as const;

/** A bear market this many calendar days long is a recession. */
export const RECESSION_BEAR_DAYS = 120;

/** A typical bronze-to-silver plan: the deductible, then 20% up to the out-of-pocket maximum. */
export const HEALTH_DEDUCTIBLE = 1_500;
export const HEALTH_COINSURANCE = 0.2;
export const HEALTH_OOP_MAX = 5_000;

/** A crash raises car insurance by a quarter for three years, about what an at-fault claim does. */
export const CRASH_SURCHARGE = 1.25;
export const CRASH_SURCHARGE_DAYS = 3 * 365;

/** A replacement car on the meeting's terms: $500 a month for 6 years. */
export const NEW_CAR = { monthly: 500, months: 72, apr: 0.07 } as const;
/** What the broken car still fetches as a trade-in. */
export const TRADE_IN = 2_500;
/** A penny-stock tip never asks for more than this. */
export const PENNY_MAX_STAKE = 1_000;
export const PENNY_MIN_STAKE = 100;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** What the rolls need to know about the life. */
export interface EventView {
  married: boolean;
  hasCar: boolean;
  carAgeDays: number;
  employed: boolean;
  inRecession: boolean;
}

export type RolledEvent = "car_breakdown" | "injury" | "divorce" | "penny_stock" | "recession_layoff";

/** Daily chance the car breaks down; it climbs as the car ages. */
export function carBreakdownRateFor(carAgeDays: number): number {
  const years = Math.max(0, carAgeDays) / 365;
  return (EVENT_RATES.carBreakdownBasePerYear + EVENT_RATES.carBreakdownPerCarYear * years) / 365;
}

const roll = (seed: number, kind: string, day: number) => rngFor("life-event", kind, seed, day)();
const detail = (seed: number, kind: string, day: number) => rngFor("life-event-detail", kind, seed, day);

/** The events that happen on `day`, each from its own seeded stream. */
export function rollEvents(seed: number, day: number, v: EventView): RolledEvent[] {
  const out: RolledEvent[] = [];
  if (v.hasCar && roll(seed, "car_breakdown", day) < carBreakdownRateFor(v.carAgeDays)) out.push("car_breakdown");
  if (roll(seed, "injury", day) < EVENT_RATES.injuryPerYear / 365) out.push("injury");
  if (v.married && roll(seed, "divorce", day) < EVENT_RATES.divorcePerYear / 365) out.push("divorce");
  if (roll(seed, "penny_stock", day) < EVENT_RATES.pennyTipPerYear / 365) out.push("penny_stock");
  if (v.inRecession && v.employed && roll(seed, "layoff", day) < EVENT_RATES.recessionLayoffPerMonth / 30) out.push("recession_layoff");
  return out;
}

/** The shop's quote: older cars cost more to fix. */
export function repairCost(seed: number, day: number, carAgeDays: number): number {
  const r = detail(seed, "car_breakdown", day)();
  return Math.min(4_500, Math.round(600 + 1_400 * r + 250 * (Math.max(0, carAgeDays) / 365)));
}

export type InjuryCause = "car_crash" | "fall" | "sports";

/** What happened and the hospital's bill before insurance. */
export function injuryBill(seed: number, day: number, hasCar: boolean): { cause: InjuryCause; bill: number } {
  const rng = detail(seed, "injury", day);
  const cause: InjuryCause = hasCar && rng() < EVENT_RATES.carCrashShare ? "car_crash" : rng() < 0.5 ? "fall" : "sports";
  const bill = Math.round(2_000 + 13_000 * rng() ** 2);
  return { cause, bill };
}

/** The player's share of a bill: with insurance the plan's deductible and 20% after it, capped; without, all of it. */
export function outOfPocket(bill: number, insured: boolean, deductible = HEALTH_DEDUCTIBLE): number {
  if (!insured) return round2(bill);
  const afterDeductible = Math.max(0, bill - deductible);
  return round2(Math.min(HEALTH_OOP_MAX, Math.min(bill, deductible) + HEALTH_COINSURANCE * afterDeductible));
}

const TICKERS = ["QBIT", "MOONR", "HYPR", "ZAPP", "FLUX", "GLOW"] as const;

/**
 * How a penny stock tip ends, fixed the day it's offered: most go nearly to
 * zero, some drift back to about even, and one in ten multiplies.
 */
export function pennyStock(seed: number, day: number): { ticker: string; multiple: number; resolveDays: number } {
  const rng = detail(seed, "penny_stock", day);
  const ticker = TICKERS[Math.floor(rng() * TICKERS.length)];
  const r = rng();
  const s = rng();
  const multiple = r < 0.7 ? 0.05 + 0.35 * s : r < 0.9 ? 0.8 + 0.4 * s : 2 + 3 * s;
  return { ticker, multiple: round2(multiple), resolveDays: 45 + Math.floor(rng() * 46) };
}

/** Days until a recession layoff ends with a new job. */
export function rehireDays(seed: number, day: number): number {
  return 90 + Math.floor(detail(seed, "rehire", day)() * 150);
}

/** The loan balance a monthly payment carries over its term. */
export function principalFor(monthly: number, months: number, apr: number): number {
  const r = apr / 12;
  return round2(r === 0 ? monthly * months : (monthly * (1 - (1 + r) ** -months)) / r);
}

/** The monthly payment that clears `balance` over its term. */
export function paymentFor(balance: number, months: number, apr: number): number {
  const r = apr / 12;
  return round2(r === 0 ? balance / months : (balance * r) / (1 - (1 + r) ** -months));
}
