// Goals a fast-forward can run to (research/10, "The goal math"). Each goal
// is a predicate on a GoalView plus a price tag, so the preview, the stop
// condition, and the setup screen's text all use the same numbers.

import type { Place, PlayerLife } from "../life/player.ts";
import type { Goal, GoalView } from "./types.ts";

/** ACS 2024 national median home value (B25077, research/data/states-sample.json). */
export const US_MEDIAN_HOME_VALUE = 360_600;
/** 30-year fixed mortgage rate (research/06). */
export const MORTGAGE_RATE = 0.0676;
/** Closing costs run 2-5% of the loan; research/10 uses 3%. */
export const CLOSING_COST_SHARE = 0.03;
/** An in-city move (research/02's AMSA figure). */
export const MOVING_COST = 2_300;
/** Property tax (about 1% nationally, research/02) plus homeowners insurance, per year. */
export const TAX_AND_INSURANCE = 0.015;
/** Mortgage insurance under 20% down, per year of the loan (about $125 a month on $300k). */
export const PMI_RATE = 0.005;
/** The 28/36 rule: housing under 28% of gross pay, all debt payments under 36%. */
export const HOUSING_SHARE = 0.28;
export const DEBT_SHARE = 0.36;

/** A typical home in the state, scaled from the national median by the state's housing price parity. */
export function homePrice(place: Place): number {
  return Math.round((US_MEDIAN_HOME_VALUE * place.rpp.housing) / 100 / 1_000) * 1_000;
}

export function mortgagePayment(loan: number, rate = MORTGAGE_RATE, years = 30): number {
  const r = rate / 12;
  const n = years * 12;
  return (loan * r) / (1 - (1 + r) ** -n);
}

export interface HouseMath {
  price: number;
  down: number;
  closing: number;
  moving: number;
  cashNeeded: number;
  /** Cash and brokerage; the emergency fund has to stay full after closing. */
  available: number;
  /** Principal, interest, tax, insurance, and PMI. */
  payment: number;
  /** Gross yearly pay that keeps the payment at 28%. */
  incomeNeeded: number;
  affordable: boolean;
}

export function houseMath(v: GoalView, downPct: number): HouseMath {
  const price = v.homePrice;
  const down = price * downPct;
  const loan = price - down;
  const closing = loan * CLOSING_COST_SHARE;
  const payment = mortgagePayment(loan) + (price * TAX_AND_INSURANCE) / 12 + (downPct < 0.2 ? (loan * PMI_RATE) / 12 : 0);
  const affordable = payment <= HOUSING_SHARE * v.monthlyGross && payment + v.minimums <= DEBT_SHARE * v.monthlyGross;
  return {
    price,
    down,
    closing,
    moving: MOVING_COST,
    cashNeeded: down + closing + MOVING_COST,
    available: v.cash + v.brokerage,
    payment,
    incomeNeeded: (payment / HOUSING_SHARE) * 12,
    affordable,
  };
}

export function netWorthOf(v: GoalView): number {
  return v.cash + v.emergency + v.brokerage + v.retirement - v.debt;
}

/** The emergency fund plus cash beyond this month's bills: what could carry the player through a lost paycheck. */
export function liquidSavings(v: GoalView): number {
  return v.emergency + Math.max(0, v.cash - v.monthlyExpenses);
}

export function isMet(goal: Goal, v: GoalView): boolean {
  switch (goal.kind) {
    case "debt_free":
      return v.debt < 0.5;
    case "emergency_fund":
      return liquidSavings(v) >= goal.months * v.monthlyExpenses;
    case "net_worth":
      return netWorthOf(v) >= goal.amount;
    case "house": {
      const h = houseMath(v, goal.downPct);
      return h.affordable && h.available >= h.cashNeeded;
    }
    case "marriage":
      return v.relationship === "partnered";
    case "status":
      return v.grossAnnual >= goal.annualIncome;
  }
}

export function viewOf(life: PlayerLife): GoalView {
  const v: GoalView = {
    cash: 0,
    emergency: 0,
    brokerage: 0,
    retirement: 0,
    debt: life.totalDebt(),
    minimums: life.minimums(),
    monthlyExpenses: life.monthlyExpenses(),
    monthlyGross: life.grossAnnual / 12,
    homePrice: homePrice(life.place),
    relationship: life.relationship,
    grossAnnual: life.grossAnnual,
  };
  for (const a of life.ledger.accounts.values()) {
    if (a.kind === "checking" || a.kind === "savings") v.cash += a.balance;
    else if (a.kind === "emergency") v.emergency += a.balance;
    else if (a.kind === "brokerage") v.brokerage += a.balance;
    else v.retirement += a.balance;
  }
  // Brokerage account cash and invested positions are separate in PlayerLife.
  for (const position of life.positions()) v.brokerage += position.value;
  return v;
}

const dollars = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

export interface PriceTag {
  /** One or two sentences for the setup screen. */
  text: string;
  /** How far along the player is today, 0..1, when that's meaningful. */
  progress: number | null;
}

export function priceTag(goal: Goal, v: GoalView, placeName: string): PriceTag {
  switch (goal.kind) {
    case "debt_free":
      return v.debt < 0.5
        ? { text: "You have no debt.", progress: 1 }
        : { text: `Pay off ${dollars(v.debt)} of debt. Minimum payments are ${dollars(v.minimums)} a month.`, progress: null };
    case "emergency_fund": {
      const need = goal.months * v.monthlyExpenses;
      const have = liquidSavings(v);
      return {
        text: `${goal.months} months of rent, living costs, and minimum payments is ${dollars(need)}. Beyond this month's bills, you have ${dollars(have)} saved.`,
        progress: need > 0 ? Math.min(1, have / need) : 1,
      };
    }
    case "net_worth": {
      const nw = netWorthOf(v);
      return { text: `Your net worth today is ${dollars(nw)}.`, progress: Math.max(0, Math.min(1, nw / goal.amount)) };
    }
    case "house": {
      const h = houseMath(v, goal.downPct);
      const pay = h.affordable
        ? `Your pay covers the ${dollars(h.payment)} monthly payment.`
        : `The ${dollars(h.payment)} monthly payment needs about ${dollars(h.incomeNeeded)} a year of pay to stay under 28%.`;
      return {
        text: `A typical ${placeName} home is about ${dollars(h.price)}. You need ${dollars(h.cashNeeded)} in cash (${Math.round(goal.downPct * 100)}% down ${dollars(h.down)}, closing ${dollars(h.closing)}, moving ${dollars(h.moving)}) and your emergency fund kept full. ${pay}`,
        progress: Math.min(1, h.available / h.cashNeeded),
      };
    }
    case "marriage":
      return v.relationship === "partnered"
        ? { text: "You're married.", progress: 1 }
        : { text: "This isn't something money buys — it happens by chance over time, like it does in real life.", progress: null };
    case "status":
      return {
        text: `You're earning ${dollars(v.grossAnnual)} a year before taxes. Reach ${dollars(goal.annualIncome)}. This plan assumes your current pay; a career change or raise is needed to increase it.`,
        progress: goal.annualIncome > 0 ? Math.max(0, Math.min(1, v.grossAnnual / goal.annualIncome)) : 1,
      };
  }
}
