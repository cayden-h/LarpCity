// What a real card is worth on the player's spending over one year. Kept free
// of DOM and CSS imports so tests/shop.test.ts can run it under Node.

import type { CuratedCard, EarnCategory, SpendCategory } from "../sim/money/index.ts";

export const SPEND_LABEL: Record<SpendCategory, string> = { groceries: "Groceries", dining: "Dining", gas: "Gas", travel: "Travel", entertainment: "Entertainment", other: "Everything else" };
export const SPEND_ORDER: SpendCategory[] = ["groceries", "dining", "gas", "travel", "entertainment", "other"];

/** Where each issuer-page earn category lands in the player's spending. */
const EARN_TO_SPEND: Partial<Record<EarnCategory, SpendCategory[]>> = {
  dining: ["dining"],
  groceries: ["groceries"],
  gas: ["gas"],
  travel: ["travel"],
  transit: ["travel"],
  streaming: ["entertainment"],
  entertainment: ["entertainment"],
  // Rotating 5% categories vary by quarter; Q3 2026 was gas and live entertainment.
  rotating: ["gas", "entertainment"],
};

export interface CardValue {
  rewards: number;
  bonus: number;
  fee: number;
  interest: number;
  net: number;
  lines: { label: string; spend: number; rate: string; earned: number }[];
}

function rateOf(card: CuratedCard, r: CuratedCard["earn"][number]): number {
  return r.unit === "percent" ? r.rate / 100 : (r.rate * card.centsPerPoint) / 100;
}

const rateLabel = (r: CuratedCard["earn"][number]) => (r.unit === "percent" ? `${r.rate}%` : `${r.rate}x`);

/**
 * One year of rewards on the player's monthly spending: each category earns its
 * best matching rate up to that rate's annual cap and the base rate beyond it.
 * Portal-only travel rates are skipped (they need booking through the issuer).
 */
export function cardValue(card: CuratedCard, monthly: Record<SpendCategory, number>, o: { firstYear: boolean; carry: number; apr: number }): CardValue {
  const base = card.earn.find((e) => e.category === "everything");
  const baseRate = base ? rateOf(card, base) : 0;
  const left = Object.fromEntries(SPEND_ORDER.map((c) => [c, monthly[c] * 12])) as Record<SpendCategory, number>;
  const lines: CardValue["lines"] = [];
  // Highest rates claim spending first.
  const bonusRates = card.earn.filter((e) => e.category !== "everything" && e.category !== "travel_portal").sort((a, b) => rateOf(card, b) - rateOf(card, a));
  for (const r of bonusRates) {
    let cats = EARN_TO_SPEND[r.category] ?? [];
    if (r.category === "top_category") {
      // Citi Custom Cash and BofA Customized Cash: the biggest eligible category.
      const top = (["groceries", "dining", "gas", "travel", "entertainment"] as SpendCategory[]).sort((a, b) => left[b] - left[a])[0];
      cats = [top];
    }
    let cap = r.annualCap ?? Infinity;
    for (const c of cats) {
      const take = Math.min(left[c], cap);
      if (take <= 0) continue;
      lines.push({ label: SPEND_LABEL[c], spend: take, rate: rateLabel(r), earned: take * rateOf(card, r) });
      left[c] -= take;
      cap -= take;
    }
  }
  const rest = SPEND_ORDER.reduce((s, c) => s + left[c], 0);
  if (rest > 0) lines.push({ label: "Everything else", spend: rest, rate: base ? rateLabel(base) : "0%", earned: rest * baseRate });
  const rewards = lines.reduce((s, l) => s + l.earned, 0);
  // Discover's match doubles all first-year cash back; other offers are a fixed value.
  const bonus = !o.firstYear || !card.welcomeOffer ? 0 : card.welcomeOffer.cashbackMatch ? rewards : card.welcomeOffer.valueUsd;
  const fee = o.firstYear && card.firstYearFeeWaived ? 0 : card.annualFee;
  const interest = o.carry * o.apr;
  return { rewards, bonus, fee, interest, net: rewards + bonus - fee - interest, lines };
}
