// Card perks: rewards by spending category, sign-up bonuses, annual fees, and
// the net value of a card once interest is counted.
//
// The public datasets have fees and a flat earn rate, but no per-category
// multipliers, so earn profiles are game archetypes built from real 2026 cards
// (research/08-cards-loans-accounts.md, section 2).

import type { CardOffer, CardProduct } from "./types.ts";

export type SpendCategory = "groceries" | "dining" | "gas" | "travel" | "entertainment" | "other";

/**
 * Average monthly card-payable spending per household, from the BLS Consumer
 * Expenditure Survey 2024 (released Dec 2025): food at home $6,224, food away
 * $3,945, gasoline $2,411, entertainment $3,609, apparel $2,001 a year.
 */
export const BLS_MONTHLY_SPEND: Record<SpendCategory, number> = {
  groceries: 6_224 / 12,
  dining: 3_945 / 12,
  gas: 2_411 / 12,
  travel: 0,
  entertainment: 3_609 / 12,
  other: 2_001 / 12,
};

export interface EarnProfile {
  id: string;
  label: string;
  /** Cash-equivalent earn rate per category, as a fraction; `base` covers the rest. */
  rates: Partial<Record<SpendCategory, number>>;
  base: number;
  /** Rotating 5% category with a quarterly cap on the bonus spend. */
  rotating?: { rate: number; quarterlyCap: number; categories: SpendCategory[] };
}

export const EARN_PROFILES: Record<string, EarnProfile> = {
  none: { id: "none", label: "No rewards", rates: {}, base: 0 },
  flat_1_5: { id: "flat_1_5", label: "1.5% on everything", rates: {}, base: 0.015 },
  flat_2: { id: "flat_2", label: "2% on everything", rates: {}, base: 0.02 },
  tiered: { id: "tiered", label: "3% dining and groceries, 2% gas, 1% everything else", rates: { dining: 0.03, groceries: 0.03, gas: 0.02 }, base: 0.01 },
  // Chase Freedom Flex shape: 5% on up to $1,500 a quarter in rotating categories, 3% dining, 1% else.
  // Q3 2026's categories were gas and EV charging, transit, and live entertainment.
  rotating: { id: "rotating", label: "5% rotating categories (up to $1,500 a quarter), 3% dining", rates: { dining: 0.03 }, base: 0.01, rotating: { rate: 0.05, quarterlyCap: 1_500, categories: ["gas", "entertainment"] } },
  // Mid-tier travel card valued at 1 cent per point.
  travel: { id: "travel", label: "3x travel and dining, 1x everything else", rates: { travel: 0.03, dining: 0.03 }, base: 0.01 },
};

/** Picks an earn profile for a catalog card. Offers carry a flat rate; survey plans only a rewards type. */
export function profileFor(card: CardProduct | CardOffer): EarnProfile {
  if ("baseEarnPct" in card) {
    if (card.baseEarnPct >= 2) return EARN_PROFILES.flat_2;
    if (card.currency !== "USD") return EARN_PROFILES.travel;
    if (card.baseEarnPct >= 1.5) return EARN_PROFILES.flat_1_5;
    return EARN_PROFILES.tiered;
  }
  if (card.rewards.includes("Travel-related rewards")) return EARN_PROFILES.travel;
  if (card.rewards.includes("Cashback rewards")) return EARN_PROFILES.flat_1_5;
  return card.rewards.length ? EARN_PROFILES.tiered : EARN_PROFILES.none;
}

export interface MonthEarn {
  earned: number;
  byCategory: Record<SpendCategory, number>;
  /** Rotating-category spend used this quarter after the month. */
  rotatingUsed: number;
}

/** Rewards for one month of spending. `rotatingUsed` is what the quarter's 5% cap already used. */
export function earnForMonth(p: EarnProfile, spend: Partial<Record<SpendCategory, number>>, rotatingUsed = 0): MonthEarn {
  const byCategory = { groceries: 0, dining: 0, gas: 0, travel: 0, entertainment: 0, other: 0 } as Record<SpendCategory, number>;
  let used = rotatingUsed;
  for (const [cat, amt] of Object.entries(spend) as [SpendCategory, number][]) {
    if (!amt) continue;
    let rest = amt;
    if (p.rotating?.categories.includes(cat)) {
      const room = Math.max(0, p.rotating.quarterlyCap - used);
      const bonusPart = Math.min(rest, room);
      byCategory[cat] += bonusPart * p.rotating.rate;
      used += bonusPart;
      rest -= bonusPart;
    }
    byCategory[cat] += rest * (p.rates[cat] ?? p.base);
  }
  const earned = Object.values(byCategory).reduce((s, x) => s + x, 0);
  return { earned: Math.round(earned * 100) / 100, byCategory, rotatingUsed: used };
}

/** Sign-up bonus status: earned once the spend requirement is met inside the window. */
export function bonusStatus(offer: CardOffer, spentSinceOpen: number, daysSinceOpen: number): { earned: boolean; expired: boolean; remainingSpend: number; daysLeft: number } {
  const need = offer.bonusSpend ?? 0;
  const window = offer.bonusDays ?? 90;
  const earned = offer.bonusValueUsd != null && spentSinceOpen >= need && daysSinceOpen <= window;
  return { earned, expired: !earned && daysSinceOpen > window, remainingSpend: Math.max(0, need - spentSinceOpen), daysLeft: Math.max(0, window - daysSinceOpen) };
}

export interface CardYearValue {
  rewards: number;
  bonus: number;
  fee: number;
  interest: number;
  net: number;
}

/**
 * What a card is worth over a year: rewards plus any bonus, minus the annual fee
 * and the interest on a balance carried at `apr`. The lesson: at about 23% APR,
 * carrying $3,000 costs more than a 2% card earns on average spending.
 */
export function cardYearValue(o: { profile: EarnProfile; monthlySpend?: Partial<Record<SpendCategory, number>>; annualFee: number; firstYearFeeWaived?: boolean; year?: number; carriedBalance?: number; apr?: number; bonusUsd?: number }): CardYearValue {
  const spend = o.monthlySpend ?? BLS_MONTHLY_SPEND;
  let rewards = 0;
  let used = 0;
  for (let m = 0; m < 12; m++) {
    if (m % 3 === 0) used = 0;
    const e = earnForMonth(o.profile, spend, used);
    rewards += e.earned;
    used = e.rotatingUsed;
  }
  const fee = o.firstYearFeeWaived && (o.year ?? 1) === 1 ? 0 : o.annualFee;
  const interest = (o.carriedBalance ?? 0) * (o.apr ?? 0);
  const bonus = o.bonusUsd ?? 0;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { rewards: r2(rewards), bonus: r2(bonus), fee: r2(fee), interest: r2(interest), net: r2(rewards + bonus - fee - interest) };
}
