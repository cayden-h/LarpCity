// Card Shop tests: the curated real-card data and the year-one value math.
// Run with `npm test`. shop.ts imports CSS, so the value function is tested
// through a copy-free path: the math lives in cardValue, which has no DOM use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CURATED } from "../src/data/cards-curated.ts";
import { BLS_MONTHLY_SPEND, type SpendCategory } from "../src/sim/money/index.ts";

// shop.ts pulls in shop.css, which Node can't import; load cardValue without it.
const { cardValue } = await import("../src/debt-demo/shop-value.ts");

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));
const spend = (o: Partial<Record<SpendCategory, number>> = {}) => ({ groceries: 0, dining: 0, gas: 0, travel: 0, entertainment: 0, other: 0, ...o });
const card = (slug: string) => CURATED.find((c) => c.slug === slug)!;

test("every curated card is complete and its art exists", () => {
  assert.equal(CURATED.length, 23);
  for (const c of CURATED) {
    assert.ok(c.earn.some((e) => e.category === "everything"), `${c.slug} base rate`);
    assert.ok(c.terms.id && c.tccpId === c.terms.id, `${c.slug} CFPB plan`);
    assert.ok(c.terms.aprMin != null && c.terms.aprMin > 0.1 && c.terms.aprMax! < 0.4, `${c.slug} APR range`);
    assert.ok(c.art, `${c.slug} art`);
    assert.ok(existsSync(`${PUBLIC}${c.art!.src}`), `${c.slug} art file`);
    assert.ok(c.sourceUrl.startsWith("https://"), `${c.slug} source`);
  }
});

test("a flat 2% card earns 2% of everything", () => {
  const v = cardValue(card("citi-double-cash"), spend({ other: 1_000 }), { firstYear: false, carry: 0, apr: 0.2 });
  assert.equal(Math.round(v.rewards), 240);
  assert.equal(v.fee, 0);
});

test("capped categories fall back to the base rate", () => {
  // Blue Cash Preferred: 6% on groceries up to $6,000 a year, then 1%.
  const v = cardValue(card("amex-blue-cash-preferred"), spend({ groceries: 1_000 }), { firstYear: false, carry: 0, apr: 0.2 });
  assert.equal(Math.round(v.rewards), 6_000 * 0.06 + 6_000 * 0.01);
  assert.equal(v.fee, 95);
});

test("Discover's match doubles first-year cash back", () => {
  const c = card("discover-it-cash-back");
  const y1 = cardValue(c, BLS_MONTHLY_SPEND, { firstYear: true, carry: 0, apr: 0.2 });
  assert.ok(y1.bonus > 0);
  assert.equal(y1.bonus, y1.rewards);
});

test("points convert at the card's cash-out value, and carried balances cost interest", () => {
  const c = card("amex-gold"); // 4x dining at 0.6 cents = 2.4%
  const v = cardValue(c, spend({ dining: 100 }), { firstYear: false, carry: 3_000, apr: 0.25 });
  assert.equal(Math.round(v.rewards * 100) / 100, 1_200 * 4 * 0.006);
  assert.equal(v.interest, 750);
  assert.ok(v.net < 0);
});

test("premium cards lose money for light spenders in year two", () => {
  const v = cardValue(card("amex-platinum"), spend({ groceries: 300, dining: 100 }), { firstYear: false, carry: 0, apr: 0.2 });
  assert.ok(v.net < -800);
});
