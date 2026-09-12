# Home Choice Implementation Plan (Milestone 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player picks their home. Each of the six tiers is a real place on its own lot with a real cost (rent, or a mortgage the lender has to approve), homes they don't live in stand in the city with "For sale" and "For rent" signs, and eviction, foreclosure, or bankruptcy still force the tent.

**Architecture:** `sim/life/homes.ts` holds the tier table and the pure home math; `PlayerLife` gains a `home` state (tier, tenure, rent, price, mortgage) with `quoteHome` and `chooseHome`, bills tax and insurance for owners, counts home equity in net worth, and moves the player to the tent on eviction, foreclosure, or bankruptcy. In the engine, `home-lots.ts` (pure) finds one lot per tier (or takes a city's hand-placed lots), and `hero.ts` becomes `HomeLots`, which draws every tier's model with its sign and marks the current one. A `HomePicker` window replaces the HUD's +/- buttons.

**Tech Stack:** TypeScript, PixiJS v8, Node's test runner, Blender and the pixel pass (for the yard signs), Express server tests (`server/`, tsx).

**Spec:** `docs/superpowers/specs/2026-09-12-blender-houses-design.md` (Milestone 2).

**Depends on:** Milestone 1 (`2026-09-12-houses.md`): the `common/home` sprite set, `findHome`, `facingOf`, `inCore`, and `CityDef.core`. Task 12 also depends on the roads effort (branch `roads-traffic`) being merged into `main`.

**Where to work:** the worktree `../larp-houses` on branch `blender-houses`. Paths are relative to it.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `game/src/sim/life/homes.ts` | Create | Tier table, rent and price per tier, owner costs, sale proceeds, the mortgage roll |
| `game/src/sim/life/player.ts` | Modify | Home state, bills, net worth, `quoteHome`, `chooseHome`, forced moves, `setPlace` |
| `game/src/sim/life/index.ts` | Modify | Export `homes.ts` |
| `game/tests/homes.test.ts` | Create | Home math and home-life tests |
| `game/tests/life.test.ts` | Modify | Drop the net-worth tier test |
| `server/src/ai/facts.ts`, `server/src/ai/facts.test.ts` | Modify | Describe `home` events |
| `game/src/engine/types.ts` | Modify | `CityDef.homes` |
| `game/src/engine/world.ts` | Modify | Shift hand-placed home lots into the world |
| `game/src/engine/home-lots.ts` | Create | Pure: one lot per tier |
| `game/tests/home-lots.test.ts` | Create | Six lots for every city |
| `game/art/make_ads.py`, `game/art/lib/homes.py`, `game/art/catalog.py` | Modify | Yard sign art and sprites |
| `game/src/engine/sprite-pick.ts` | Modify | `findHomeSign` |
| `game/src/engine/hero.ts` | Rewrite | `HomeLots`: every tier's lot, signs, ring and pin |
| `game/src/engine/scene.ts` | Modify | Place home lots, draw `HomeLots`, click a home |
| `game/src/ui/home-picker.ts`, `game/src/ui/home-picker.css` | Create | The picker window |
| `game/src/ui/hud.ts`, `game/src/style.css` | Modify | The home card opens the picker |
| `game/src/main.ts` | Modify | Wiring |
| `game/src/cities/san-francisco.ts` | Modify (Task 12) | SF's hand-placed lots |

---

### Task 1: The tier table and home math (TDD)

**Files:**
- Create: `game/src/sim/life/homes.ts`
- Modify: `game/src/sim/life/index.ts`
- Test: `game/tests/homes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `game/tests/homes.test.ts`:

```ts
// Home tiers: prices, the home math, and PlayerLife's moves. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { homePrice } from "../src/sim/skip/goals.ts";
import { ownerCosts, saleProceeds, tierPrice, tierRent, TIERS, US_MEDIAN_RENT, type Place } from "../src/sim/life/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };

test("the studio rents at 0.6x the state's median rent", () => {
  assert.equal(tierRent(CA, US_MEDIAN_RENT, 1), Math.round(((US_MEDIAN_RENT * 154.346) / 100) * 0.6));
});

test("house prices climb with the tier and scale with the state", () => {
  assert.equal(tierPrice(TX, 2), Math.round((homePrice(TX) * 0.7) / 1_000) * 1_000);
  for (let t = 3; t <= 5; t++) assert.ok(tierPrice(CA, t) > tierPrice(CA, t - 1));
  assert.ok(tierPrice(CA, 2) > tierPrice(TX, 2));
  assert.deepEqual(TIERS.map((t) => t.tenure), ["forced", "rent", "buy", "buy", "buy", "buy"]);
});

test("owner costs are tax and insurance, plus PMI under 20% down", () => {
  assert.equal(ownerCosts(500_000, 0.2), 625);
  assert.equal(ownerCosts(500_000, 0.1), 812.5);
});

test("selling pays the 6% selling costs and the mortgage", () => {
  assert.equal(saleProceeds(400_000, 300_000), 76_000);
  assert.equal(saleProceeds(400_000, 390_000), -14_000);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd game && node --test tests/homes.test.ts`
Expected: FAIL, `tierRent` and the others are not exported.

- [ ] **Step 3: Write `homes.ts`**

Create `game/src/sim/life/homes.ts`:

```ts
// The player's home: six tiers, each a real place with a real cost
// (docs/superpowers/specs/2026-09-12-blender-houses-design.md, Milestone 2).
// The studio is rented; the houses are bought with a mortgage the lender has
// to approve; the tent only comes after an eviction, a foreclosure, or bankruptcy.

import { hashKeys } from "../../engine/rng.ts";
import { homePrice, PMI_RATE, TAX_AND_INSURANCE } from "../skip/goals.ts";
import type { Place } from "./player.ts";

export const HOME_TIERS = ["Tent (bankrupt)", "Studio apartment", "Small house", "Townhouse", "Large house", "Retirement villa"] as const;

export type Tenure = "forced" | "rent" | "buy";

export interface TierSpec {
  tier: number;
  tenure: Tenure;
  /** Rent: a multiple of the state's median rent. Buy: a multiple of the state's typical home price. */
  share: number;
  /** Where the tier stands, for cities without their own lot names. */
  where: string;
}

/** The multipliers are the spec's table; tune them here. */
export const TIERS: readonly TierSpec[] = [
  { tier: 0, tenure: "forced", share: 0, where: "the edge of a park" },
  { tier: 1, tenure: "rent", share: 0.6, where: "a walk-up near downtown" },
  { tier: 2, tenure: "buy", share: 0.7, where: "the outer neighborhoods" },
  { tier: 3, tenure: "buy", share: 1.3, where: "an old row-house street" },
  { tier: 4, tenure: "buy", share: 1.8, where: "the suburbs" },
  { tier: 5, tenure: "buy", share: 4, where: "the coast" },
];

/** Agent commission and fees when a home sells. */
export const SELLING_COST = 0.06;
export const DOWN_PAYMENTS = [0.035, 0.1, 0.2] as const;
export const DEFAULT_DOWN = 0.2;
export const MORTGAGE_MONTHS = 360;
/** Rent bills paid short this many months running: eviction. */
export const EVICTION_MONTHS = 2;
/** A mortgage this many days past due: foreclosure (most lenders start at 120). */
export const FORECLOSURE_DAYS = 120;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** A rented tier's monthly rent in a state (medianRent is the national median, US_MEDIAN_RENT). */
export function tierRent(place: Place, medianRent: number, tier: number): number {
  return Math.round(((medianRent * place.rpp.housing) / 100) * TIERS[tier].share);
}

/** A bought tier's price in a state. */
export function tierPrice(place: Place, tier: number): number {
  return Math.round((homePrice(place) * TIERS[tier].share) / 1_000) * 1_000;
}

/** Property tax and insurance, plus PMI when the down payment is under 20%, per month. */
export function ownerCosts(price: number, downPct: number): number {
  const loan = price * (1 - downPct);
  return round2((price * TAX_AND_INSURANCE) / 12 + (downPct < 0.2 ? (loan * PMI_RATE) / 12 : 0));
}

/** What selling brings after selling costs and paying off what is owed (negative: the seller brings cash). */
export function saleProceeds(price: number, owed: number): number {
  return round2(price * (1 - SELLING_COST) - owed);
}

/** The lender's dice for a mortgage application: seeded by the day and tier, so a run replays exactly. */
export function homeRoll(day: number, tier: number): number {
  return hashKeys("home-mortgage", day, tier) / 4294967296;
}
```

Append to `game/src/sim/life/index.ts`:

```ts
export * from "./homes.ts";
```

- [ ] **Step 4: Run to see them pass**

Run: `cd game && node --test tests/homes.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/homes.ts game/src/sim/life/index.ts game/tests/homes.test.ts
git commit -m "Sim: home tiers with rent, prices, owner costs, and sale proceeds"
```

---

### Task 2: `PlayerLife` keeps a home (TDD)

**Files:**
- Modify: `game/src/sim/life/player.ts`
- Modify: `game/tests/life.test.ts:73-78`
- Test: `game/tests/homes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `game/tests/homes.test.ts` (add `PlayerLife` to the index import):

```ts
test("a new player rents the studio at the rent they stated; a rent above the median starts in the townhouse", () => {
  const median = Math.round((US_MEDIAN_RENT * 88.6) / 100);
  const plain = new PlayerLife({ place: TX, day: 0 });
  assert.equal(plain.homeTier(), 1);
  assert.equal(plain.rent, median);
  const high = new PlayerLife({ place: TX, day: 0, rent: median + 900 });
  assert.equal(high.homeTier(), 3);
  assert.equal(high.home.tenure, "rent");
  assert.equal(high.rent, median + 900);
});

test("net worth no longer moves the home by itself", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.ledger.get("savings").balance = 2_000_000;
  assert.equal(life.homeTier(), 1);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd game && node --test tests/homes.test.ts`
Expected: FAIL (`life.home` is undefined; the rich player's tier is 5).

- [ ] **Step 3: Add the home state**

In `game/src/sim/life/player.ts`:

1. Import from the new module:

```ts
import { EVICTION_MONTHS, FORECLOSURE_DAYS, HOME_TIERS, ownerCosts } from "./homes.ts";
```

2. Delete `HOME_TIER_NET_WORTH` and its comment (lines 161-162).

3. Add, next to the other exported interfaces:

```ts
/** Where the player lives and on what terms. */
export interface Home {
  tier: number;
  tenure: "none" | "rent" | "own";
  /** Renters: the monthly rent and the housing price parity it was set at (it rescales after a move). */
  rent: { amount: number; housing: number } | null;
  /** Owners: the purchase price, which is also the home's value (held flat). */
  price: number;
  downPct: number;
  mortgageId: string | null;
}
```

4. Replace the `rentAnchor` field and its comment with:

```ts
  /** The player's home; starts as a rental at the stated rent. */
  home: Home;
  /** Rent bills paid short in a row (eviction at EVICTION_MONTHS). */
  private shortRent = 0;
```

5. In the constructor, replace the `this.rentAnchor = ...` line with:

```ts
    // The stated rent (or the state's median) is where the player starts; above the median, that's a townhouse.
    const median = Math.round((US_MEDIAN_RENT * o.place.rpp.housing) / 100);
    const stated = o.rent ?? median;
    this.home = { tier: stated > median ? 3 : 1, tenure: "rent", rent: { amount: stated, housing: o.place.rpp.housing }, price: 0, downPct: 0, mortgageId: null };
```

6. Replace the `rent` getter with:

```ts
  /** Monthly rent: the home's rent rescaled to the current state's housing costs; 0 for owners and the tent. */
  get rent(): number {
    const r = this.home.rent;
    return this.home.tenure === "rent" && r ? Math.round((r.amount * this.place.rpp.housing) / r.housing) : 0;
  }

  /** Owners: property tax and insurance, plus PMI under 20% down, per month. */
  get housingCosts(): number {
    return this.home.tenure === "own" ? ownerCosts(this.home.price, this.home.downPct) : 0;
  }

  /** The owned home's value (its price; no appreciation model), or 0. */
  homeValue(): number {
    return this.home.tenure === "own" ? this.home.price : 0;
  }
```

7. `netWorth()` becomes `return round2(this.cash() + this.investments() + this.homeValue() - this.totalDebt());`, and in `snapshot()` the net worth line becomes `netWorth: round2(cash + investments + this.homeValue() - debt),`.

8. `monthlyExpenses()` becomes `return round2(this.rent + this.housingCosts + this.living + this.minimums());`.

9. Replace `homeTier()` and its comment with:

```ts
  /** The home tier the player lives in (engine/hero.ts draws it). */
  homeTier(): number {
    return this.home.tier;
  }
```

10. In `onDay`, replace the two bill lines (`const bill = ...` and `if (bill) ...`) with:

```ts
    // Housing on the 1st and living costs on the 15th come before debt payments.
    const bills = dom === 1 ? this.housingBills() : dom === 15 ? [{ name: "Living costs", amount: this.living }] : [];
    for (const b of bills) {
      const paid = wallet.withdraw(b.amount, b.name);
      events.push({ type: "bill", day, name: b.name, amount: b.amount, paid });
      if (b.name === "Rent") this.shortRent = paid < b.amount - 0.005 ? this.shortRent + 1 : 0;
    }
```

and add the helper:

```ts
  private housingBills(): { name: string; amount: number }[] {
    if (this.home.tenure === "rent" && this.rent > 0) return [{ name: "Rent", amount: this.rent }];
    if (this.home.tenure === "own") return [{ name: "Property tax and insurance", amount: this.housingCosts }];
    return [];
  }
```

`EVICTION_MONTHS`, `FORECLOSURE_DAYS`, and `HOME_TIERS` are used in Tasks 3-4; if `tsc` flags them as unused now, import them in those tasks instead.

- [ ] **Step 4: Replace the old tier test**

In `game/tests/life.test.ts`, delete the test "home tier follows net worth" (lines 73-78); the new tests cover the replacement rule.

- [ ] **Step 5: Run the tests**

Run: `cd game && node --test tests/homes.test.ts tests/life.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: pass. If other code read `HOME_TIER_NET_WORTH` or `rentAnchor`, `tsc` names it; switch it to `home`.

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/homes.test.ts game/tests/life.test.ts
git commit -m "Sim: the player keeps a home; owners pay tax and insurance; equity counts in net worth"
```

---

### Task 3: Quote and choose a home (TDD)

**Files:**
- Modify: `game/src/sim/life/player.ts`
- Test: `game/tests/homes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `game/tests/homes.test.ts`, and extend the imports:

```ts
import { defaultAccounts } from "../src/sim/life/index.ts";
import { lifeFromIntake } from "../src/sim/life/intake.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { MOVING_COST } from "../src/sim/skip/goals.ts";

const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const at = (day: number, downPct?: number) => ({ day, date: dateOf(day), downPct });
const live = (life: PlayerLife, days: number, from = 0) => {
  const all = [];
  for (let day = from + 1; day <= from + days; day++) all.push(...life.onDay(day, dateOf(day)));
  return all;
};
const person = (place: Place, salary: number, savings: number, debt = 0) =>
  lifeFromIntake({ job: "engineer", salary, rent: 1_500, debt, savings }, { place, day: 0, market: new MarketPath() });
/** Buys a tier, trying on successive days: the lender's roll is seeded by the day. */
const buy = (life: PlayerLife, tier: number, from = 0) => {
  for (let day = from; day < from + 20; day++) {
    const r = life.chooseHome(tier, at(day));
    if (r.ok) return r;
  }
  throw new Error(`never approved for tier ${tier}: ${life.quoteHome(tier, at(from)).reasons.join(" ")}`);
};

test("the tent can't be chosen, and nor can the home you live in", () => {
  const life = person(TX, 90_000, 50_000);
  assert.match(life.quoteHome(0, at(0)).reasons.join(" "), /tent/);
  assert.match(life.quoteHome(1, at(0)).reasons.join(" "), /already live here/);
  assert.equal(life.chooseHome(0, at(0)).ok, false);
});

test("renting a new tier costs the move and sets the new rent", () => {
  const life = new PlayerLife({ place: CA, day: 0, rent: 6_000 }); // starts in the townhouse
  const cash = life.cash();
  const r = life.chooseHome(1, at(0));
  assert.ok(r.ok);
  assert.equal(life.homeTier(), 1);
  assert.equal(life.rent, tierRent(CA, US_MEDIAN_RENT, 1));
  assert.equal(Math.round(cash - life.cash()), MOVING_COST);
});

test("buying opens a mortgage, stops rent, and bills tax and insurance", () => {
  const life = person(TX, 150_000, 400_000);
  const before = life.netWorth();
  const q = life.quoteHome(2, at(0));
  assert.ok(q.ok, q.reasons.join(" "));
  const r = buy(life, 2);
  assert.equal(r.event.type, "home");
  assert.equal(life.home.tenure, "own");
  assert.equal(life.home.price, tierPrice(TX, 2));
  const m = life.book.debts.find((d) => d.id === life.home.mortgageId)!;
  assert.equal(m.kind, "mortgage");
  assert.equal(Math.round(m.balance), Math.round(tierPrice(TX, 2) * 0.8));
  assert.equal(life.rent, 0);
  // The down payment turns cash into equity; closing and moving are the only loss.
  assert.ok(Math.abs(life.netWorth() - (before - q.closing - (q.cashNeeded - q.down - q.closing))) < 2);
  const bills = live(life, 40, 20).filter((e) => e.type === "bill").map((e) => (e.type === "bill" ? e.name : ""));
  assert.ok(bills.includes("Property tax and insurance"));
  assert.ok(!bills.includes("Rent"));
});

test("without the cash, a house is refused with the numbers", () => {
  const q = person(TX, 150_000, 1_000).quoteHome(3, at(0));
  assert.equal(q.ok, false);
  assert.match(q.reasons[0], /You need \$[\d,]+ in cash/);
});

test("a payment over the lender's debt-to-income limit is refused", () => {
  const q = person(TX, 30_000, 5_000_000).quoteHome(5, at(0));
  assert.equal(q.ok, false);
  assert.match(q.reasons.join(" "), /debt-to-income/);
});

test("moving up sells the old home and pays off its mortgage", () => {
  const life = person(CA, 300_000, 2_000_000);
  buy(life, 2);
  const first = life.home.mortgageId;
  const r = buy(life, 4, 30);
  assert.equal(life.homeTier(), 4);
  assert.equal(life.book.debts.find((d) => d.id === first)!.status, "paid");
  assert.equal(life.book.debts.filter((d) => d.kind === "mortgage" && d.status !== "paid").length, 1);
  assert.ok(r.event.type === "home" && (r.event.sold ?? 0) > 0);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd game && node --test tests/homes.test.ts`
Expected: FAIL, `quoteHome` is not a function.

- [ ] **Step 3: Implement**

In `game/src/sim/life/player.ts`:

1. Imports:

```ts
import { isOpen, owed, type Debt } from "../debt/index.ts";   // add to the existing debt import instead if it already names these
import { applyForLoan, openLoan, recordApplication } from "../money/applications.ts";
import type { ApplicationRecord, ApplicationResult } from "../money/types.ts";
import { houseMath, MOVING_COST, viewOf } from "../skip/goals.ts";
import { DEFAULT_DOWN, homeRoll, MORTGAGE_MONTHS, saleProceeds, tierPrice, tierRent, TIERS, type Tenure } from "./homes.ts";
```

(`goals.ts` imports only types from `player.ts`, so this adds no runtime import cycle.)

2. Add the `home` life event to the `LifeEvent` union:

```ts
  | {
      type: "home";
      day: number;
      from: number;
      to: number;
      name: string;
      tenure: "none" | "rent" | "own";
      reason: "chose" | "moved" | "eviction" | "foreclosure" | "bankruptcy";
      price?: number;
      rent?: number;
      down?: number;
      /** Net from selling the previous home (negative: the player paid to sell). */
      sold?: number;
    }
```

3. Add the quote type next to `Home`:

```ts
/** What moving to a home tier takes right now. */
export interface HomeQuote {
  tier: number;
  tenure: Tenure;
  /** Rent, or principal, interest, tax, insurance, and PMI, per month. */
  monthly: number;
  price: number;
  down: number;
  closing: number;
  cashNeeded: number;
  /** Checking and savings (the emergency fund stays), plus what selling the current home would bring. */
  available: number;
  loan: number;
  /** Mortgage pre-qualification odds; null when renting. */
  odds: number | null;
  /** Why the move is not possible; empty when it is. */
  reasons: string[];
  ok: boolean;
}

export type HomeResult = { ok: true; event: Extract<LifeEvent, { type: "home" }> } | { ok: false; reasons: string[] };

const dollars = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
```

4. Add a field for the application history (if `PlayerLife` already keeps one, use it instead):

```ts
  /** Credit applications, for hard inquiries and rate shopping (money/applications.ts). */
  readonly applications: ApplicationRecord[] = [];
```

5. Add the methods:

```ts
  /** What moving to a tier would take, without doing it. */
  quoteHome(tier: number, o: { day: number; date: Date; downPct?: number }): HomeQuote {
    const spec = TIERS[tier];
    const reasons: string[] = [];
    const m = this.mortgage();
    const sale = this.home.tenure === "own" ? saleProceeds(this.home.price, m ? owed(m) : 0) : 0;
    const available = round2(this.ledger.get("checking").balance + this.ledger.get("savings").balance + sale);
    if (tier === this.home.tier) reasons.push("You already live here.");
    if (spec.tenure === "forced") reasons.push("Nobody chooses the tent: it comes after an eviction, a foreclosure, or bankruptcy.");
    if (spec.tenure !== "buy") {
      if (available < MOVING_COST) reasons.push(`Moving costs about ${dollars(MOVING_COST)}; you have ${dollars(available)}.`);
      const monthly = spec.tenure === "rent" ? tierRent(this.place, US_MEDIAN_RENT, tier) : 0;
      return { tier, tenure: spec.tenure, monthly, price: 0, down: 0, closing: 0, cashNeeded: MOVING_COST, available, loan: 0, odds: null, reasons, ok: !reasons.length };
    }
    const downPct = o.downPct ?? DEFAULT_DOWN;
    const h = houseMath({ ...viewOf(this), homePrice: tierPrice(this.place, tier) }, downPct);
    const loan = round2(h.price - h.down);
    if (available < h.cashNeeded)
      reasons.push(`You need ${dollars(h.cashNeeded)} in cash (${dollars(h.down)} down, ${dollars(h.closing)} closing, ${dollars(h.moving)} moving); you have ${dollars(available)}${sale > 0 ? `, counting ${dollars(sale)} from selling your home` : ""}.`);
    const r = this.mortgageApplication(loan, o);
    if (r.decision !== "approved") reasons.push(...r.reasons);
    return { tier, tenure: "buy", monthly: round2(h.payment), price: h.price, down: h.down, closing: h.closing, cashNeeded: h.cashNeeded, available, loan, odds: r.odds ?? null, reasons, ok: !reasons.length };
  }

  /** Moves to a tier: rents it, or applies for a mortgage and buys it (selling the current home first). */
  chooseHome(tier: number, o: { day: number; date: Date; downPct?: number }): HomeResult {
    const q = this.quoteHome(tier, o);
    if (!q.ok) return { ok: false, reasons: q.reasons };
    let approved: ApplicationResult | null = null;
    if (q.tenure === "buy") {
      const r = this.mortgageApplication(q.loan, o, homeRoll(o.day, tier));
      recordApplication(this.book, this.applications, r, o.day, {});
      if (r.decision !== "approved")
        return { ok: false, reasons: [`The lender turned the application down this time (about ${Math.round((q.odds ?? 0) * 100)}% of applicants like you are approved).`, ...r.reasons] };
      approved = r;
    }
    const from = this.home.tier;
    const sold = this.home.tenure === "own" ? this.sellHome() : undefined;
    this.ledger.wallet(["checking", "savings"]).withdraw(q.cashNeeded, approved ? "Down payment, closing, and moving" : "Moving");
    if (approved) {
      const { debt } = openLoan(this.book, approved, o.day, "Mortgage");
      this.home = { tier, tenure: "own", rent: null, price: q.price, downPct: o.downPct ?? DEFAULT_DOWN, mortgageId: debt.id };
    } else {
      this.home = { tier, tenure: "rent", rent: { amount: q.monthly, housing: this.place.rpp.housing }, price: 0, downPct: 0, mortgageId: null };
    }
    this.shortRent = 0;
    const event: Extract<LifeEvent, { type: "home" }> = {
      type: "home", day: o.day, from, to: tier, name: HOME_TIERS[tier], tenure: this.home.tenure, reason: "chose",
      price: approved ? q.price : undefined, rent: approved ? undefined : this.rent, down: approved ? q.down : undefined, sold,
    };
    this.record(o.day);
    this.emit([event]);
    return { ok: true, event };
  }

  /** The open mortgage on the current home, if any. */
  private mortgage(): Debt | undefined {
    return this.home.mortgageId ? this.book.debts.find((d) => d.id === this.home.mortgageId && isOpen(d)) : undefined;
  }

  /** A mortgage application; with no roll, a pre-qualification that records nothing. */
  private mortgageApplication(loan: number, o: { day: number; date: Date }, roll?: number): ApplicationResult {
    const current = this.mortgage();
    return applyForLoan({
      kind: "mortgage",
      amount: loan,
      termMonths: MORTGAGE_MONTHS,
      // The new payment replaces rent and any current mortgage, so neither counts against it.
      applicant: { age: this.age, annualIncome: this.grossAnnual, monthlyDebtPayments: round2(this.minimums() - (current?.scheduledPayment ?? 0)), monthlyHousing: 0 },
      book: this.book,
      day: o.day,
      cashRateAnnual: this.cashRate(o.date),
      roll,
    });
  }

  /** Sells the owned home at its value minus selling costs and pays off its mortgage; returns the net. */
  private sellHome(): number {
    const m = this.mortgage();
    const net = saleProceeds(this.home.price, m ? owed(m) : 0);
    if (m) {
      m.balance = 0;
      m.accrued = 0;
      m.status = "paid";
    }
    if (net >= 0) {
      const checking = this.ledger.get("checking");
      checking.balance = round2(checking.balance + net);
    } else this.ledger.wallet().withdraw(-net, "Home sale shortfall");
    return net;
  }
```

- [ ] **Step 4: Run the tests**

Run: `cd game && node --test tests/homes.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: pass. If "buying opens a mortgage" never gets approved, print `life.book.profile.score` and the quote's odds: the intake's credit profile may start below the mortgage floor; then raise `salary` or pick `CA`'s tier 2 with more savings in the test, not the lender math.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/homes.test.ts
git commit -m "Sim: quote and choose a home; buying runs a real mortgage application"
```

---

### Task 4: Eviction, foreclosure, and bankruptcy force the tent (TDD)

**Files:**
- Modify: `game/src/sim/life/player.ts`
- Test: `game/tests/homes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `game/tests/homes.test.ts`:

```ts
test("rent paid short two months running means eviction to the tent", () => {
  const broke = defaultAccounts(0).map((a) => ({ ...a, balance: 0 }));
  const life = new PlayerLife({ place: CA, day: 0, monthlyTakeHome: 400, rent: 3_000, accounts: broke });
  const events = live(life, 70);
  const moved = events.find((e) => e.type === "home");
  assert.ok(moved && moved.type === "home" && moved.reason === "eviction");
  assert.equal(life.homeTier(), 0);
  assert.equal(life.rent, 0);
});

test("a mortgage 120 days behind means foreclosure", () => {
  const life = person(TX, 150_000, 400_000);
  buy(life, 2);
  for (const id of ["checking", "savings", "emergency"]) life.ledger.get(id).balance = 0;
  life.setEmployed(false, 0);
  life.monthlyTakeHome = 0;
  life.book.monthlyTakeHome = 0;
  const events = live(life, 220, 20);
  const moved = events.find((e) => e.type === "home");
  assert.ok(moved && moved.type === "home" && moved.reason === "foreclosure", JSON.stringify(moved));
  assert.equal(life.homeTier(), 0);
  assert.equal(life.home.tenure, "none");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd game && node --test tests/homes.test.ts`
Expected: FAIL, no `home` event.

- [ ] **Step 3: Implement**

In `onDay`, right after `events.push(...tickDay(...));`, add:

```ts
    events.push(...this.forcedMove(day));
```

and add the method:

```ts
  /** Bankruptcy, a mortgage FORECLOSURE_DAYS behind, or rent paid short EVICTION_MONTHS running: the tent. */
  private forcedMove(day: number): LifeEvent[] {
    if (this.home.tier === 0) return [];
    const m = this.mortgage();
    const reason =
      this.book.profile.bankruptcy !== undefined ? "bankruptcy"
      : m && m.pastDueSince !== null && day - m.pastDueSince >= FORECLOSURE_DAYS ? "foreclosure"
      : this.shortRent >= EVICTION_MONTHS ? "eviction"
      : null;
    if (!reason) return [];
    const from = this.home.tier;
    const sold = this.home.tenure === "own" ? this.sellHome() : undefined;
    this.home = { tier: 0, tenure: "none", rent: null, price: 0, downPct: 0, mortgageId: null };
    this.shortRent = 0;
    return [{ type: "home", day, from, to: 0, name: HOME_TIERS[0], tenure: "none", reason, sold }];
  }
```

- [ ] **Step 4: Run the tests**

Run: `cd game && node --test tests/homes.test.ts tests/life.test.ts`
Expected: pass. The layoff test in `life.test.ts` still expects `homeTier() <= 1`; with the new rules it is 1 (studio) or 0 (evicted), both fine.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/homes.test.ts
git commit -m "Sim: eviction, foreclosure, and bankruptcy move the player to the tent"
```

---

### Task 5: Moving states sells an owned home (TDD)

**Files:**
- Modify: `game/src/sim/life/player.ts` (`setPlace`)
- Test: `game/tests/homes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("moving states sells an owned home and rents the studio in the new state", () => {
  const life = person(TX, 150_000, 400_000);
  buy(life, 2);
  const seen: string[] = [];
  life.onEvents((events) => seen.push(...events.map((e) => (e.type === "home" ? `home:${e.reason}` : e.type))));
  life.setPlace(CA, 30);
  assert.equal(life.homeTier(), 1);
  assert.equal(life.home.tenure, "rent");
  assert.equal(life.rent, tierRent(CA, US_MEDIAN_RENT, 1));
  assert.ok(life.book.debts.filter((d) => d.kind === "mortgage").every((d) => d.status === "paid"));
  assert.deepEqual(seen, ["moved", "home:moved"]);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd game && node --test tests/homes.test.ts`
Expected: FAIL (still tier 2).

- [ ] **Step 3: Implement**

Replace `setPlace` with:

```ts
  setPlace(place: Place, day: number): LifeEvent {
    const from = this.place.abbr;
    const extra: LifeEvent[] = [];
    if (this.home.tenure === "own") {
      // A move sells the house; the player starts over renting the studio in the new state.
      const tier = this.home.tier;
      const sold = this.sellHome();
      this.home = { tier: 1, tenure: "rent", rent: { amount: tierRent(place, US_MEDIAN_RENT, 1), housing: place.rpp.housing }, price: 0, downPct: 0, mortgageId: null };
      extra.push({ type: "home", day, from: tier, to: 1, name: HOME_TIERS[1], tenure: "rent", reason: "moved", sold, rent: tierRent(place, US_MEDIAN_RENT, 1) });
    }
    this.place = place;
    const e: LifeEvent = { type: "moved", day, from, to: place.abbr, rent: this.rent, living: this.living };
    this.emit([e, ...extra]);
    return e;
  }
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd game && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/homes.test.ts
git commit -m "Sim: moving states sells an owned home"
```

---

### Task 6: The coach reads home events

**Files:**
- Modify: `server/src/ai/facts.ts:201`, `server/src/ai/facts.ts:327`
- Modify: `server/src/ai/facts.test.ts:37`

- [ ] **Step 1: Write the failing assertions**

In `server/src/ai/facts.test.ts`, right after the `moved` assertion on line 37, add:

```ts
  assert.equal(describe(ev(1, "home", { reason: "chose", tenure: "own", name: "Small house", price: 540000 })), "Bought the Small house for $540,000");
  assert.equal(describe(ev(1, "home", { reason: "chose", tenure: "rent", name: "Studio apartment", rent: 1650 })), "Moved into the Studio apartment for $1,650 a month");
  assert.equal(describe(ev(1, "home", { reason: "eviction", name: "Tent (bankrupt)" })), "Was evicted after two months of short rent");
```

- [ ] **Step 2: Run to see it fail**

Run: `cd server && npm test`
Expected: FAIL on the new assertions (null).

- [ ] **Step 3: Implement**

In `describe`'s switch in `server/src/ai/facts.ts`, after the `moved` case, add:

```ts
    case "home":
      switch (p.reason) {
        case "chose":
          return p.tenure === "own" ? `Bought the ${str(p.name)} for ${money(num(p.price))}` : `Moved into the ${str(p.name)} for ${money(num(p.rent))} a month`;
        case "moved":
          return `Sold the house before moving, clearing ${money(num(p.sold))}`;
        case "eviction":
          return "Was evicted after two months of short rent";
        case "foreclosure":
          return "Lost the house to foreclosure";
        default:
          return "Lost their home in bankruptcy";
      }
```

and in the lesson switch, after `moved`:

```ts
    case "home":
      return "Housing is the biggest monthly bill; keeping it under 28% of gross pay leaves room to save.";
```

- [ ] **Step 4: Run the tests**

Run: `cd server && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/facts.ts server/src/ai/facts.test.ts
git commit -m "Server: the coach and newspaper describe home moves"
```

---

### Task 7: One lot per tier (TDD)

**Files:**
- Modify: `game/src/engine/types.ts`, `game/src/engine/world.ts`
- Create: `game/src/engine/home-lots.ts`
- Test: `game/tests/home-lots.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `game/tests/home-lots.test.ts`:

```ts
// Every city has six home lots, one per tier, each beside a road. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { austin } from "../src/cities/austin.ts";
import { dallas } from "../src/cities/dallas.ts";
import { houston } from "../src/cities/houston.ts";
import { miami } from "../src/cities/miami.ts";
import { newYork } from "../src/cities/new-york.ts";
import { sanFrancisco } from "../src/cities/san-francisco.ts";
import { templateCity } from "../src/cities/templates.ts";
import { STATES } from "../src/data/states.ts";
import { CityGrid } from "../src/engine/grid.ts";
import { placeHomes } from "../src/engine/home-lots.ts";
import { inCore } from "../src/engine/lots.ts";
import { expandWorld } from "../src/engine/world.ts";

const cities = [sanFrancisco, houston, dallas, austin, miami, newYork, ...STATES.filter((_, i) => i % 12 === 0).map(templateCity)];

for (const source of cities)
  test(`${source.id}: six home lots, one per tier, each beside a road`, () => {
    const { city } = expandWorld(source, 7);
    const grid = new CityGrid(city.layout);
    const lots = placeHomes(grid, city);
    assert.deepEqual(lots.map((l) => l.tier).sort(), [0, 1, 2, 3, 4, 5]);
    assert.equal(new Set(lots.map((l) => `${l.x},${l.y}`)).size, 6);
    for (const l of lots) {
      assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid.isRoad(l.x + dx, l.y + dy)), `tier ${l.tier} at ${l.x},${l.y} is off the road`);
      assert.ok(!city.landmarks.some((m) => l.x >= m.x && l.x < m.x + m.w && l.y >= m.y && l.y < m.y + m.d), `tier ${l.tier} on a landmark`);
      if (l.tier >= 1 && l.tier <= 3) assert.ok(inCore(city, l.x, l.y), `tier ${l.tier} outside the core`);
    }
    const large = lots.find((l) => l.tier === 4)!;
    assert.ok(!inCore(city, large.x, large.y), "the large house is not in the suburb ring");
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `cd game && node --test tests/home-lots.test.ts`
Expected: FAIL, cannot find `home-lots.ts`. (If a city module fails to import because it pulls in Pixi, drop it from the list and note it in the commit message.)

- [ ] **Step 3: Add `CityDef.homes` and shift it into the world**

In `game/src/engine/types.ts`, in `CityDef` after `core?`, add:

```ts
  /** Hand-placed lots for the player's home tiers, in core coordinates; tiers left out are found by rule (home-lots.ts). */
  homes?: { tier: number; x: number; y: number; where?: string }[];
```

In `game/src/engine/world.ts`, add `homes` to the returned city (next to `core`):

```ts
    homes: source.homes?.map((h) => ({ ...h, x: h.x + Mx, y: h.y + My })),
```

- [ ] **Step 4: Write `home-lots.ts`**

Create `game/src/engine/home-lots.ts`:

```ts
// Where the player's six homes stand: the city's hand-placed lots, or lots
// found by rule. Studio: near midtown. Small house: the city's home tile.
// Townhouse: the inner residential zone. Large house: just inside the suburb
// ring. Villa: by the water, else far out. Tent: a park edge. Every home lot is
// beside a road and clear of landmarks. Pure, so it runs under Node's tests.

import type { CityGrid } from "./grid";
import { inCore } from "./lots";
import type { CityDef, TileChar } from "./types";

export interface HomeLot {
  tier: number;
  x: number;
  y: number;
  /** A name for the place ("the Sunset"); the tier's generic one when missing. */
  where?: string;
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

interface Cell {
  x: number;
  y: number;
  c: TileChar;
}

export function placeHomes(grid: CityGrid, city: CityDef): HomeLot[] {
  const core = city.core ?? { x: 0, y: 0, w: grid.w, h: grid.h };
  const center = { x: core.x + core.w / 2, y: core.y + core.h / 2 };
  const ring = (p: Cell) => Math.max(core.x - p.x, p.x - (core.x + core.w - 1), core.y - p.y, p.y - (core.y + core.h - 1), 0);
  const nearLandmark = (x: number, y: number) => city.landmarks.some((l) => x >= l.x - 1 && x <= l.x + l.w && y >= l.y - 1 && y <= l.y + l.d);
  const byRoad = (x: number, y: number) => N4.some(([dx, dy]) => grid.isRoad(x + dx, y + dy));
  const touches = (x: number, y: number, cs: string) => N4.some(([dx, dy]) => cs.includes(grid.at(x + dx, y + dy)));
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

  const cells: Cell[] = [];
  for (const { x, y, c } of grid.cells()) if (byRoad(x, y) && !nearLandmark(x, y)) cells.push({ x, y, c });
  const lots = cells.filter((p) => p.c === "b" || p.c === "h");
  const taken = new Set<string>();
  const best = (pool: Cell[], score: (p: Cell) => number): Cell | null => {
    let top: Cell | null = null;
    let low = Infinity;
    for (const p of pool) {
      if (taken.has(`${p.x},${p.y}`)) continue;
      const s = score(p);
      if (s < low) {
        low = s;
        top = p;
      }
    }
    return top;
  };
  const zoneCenter = (...kinds: string[]) => {
    for (const k of kinds) {
      const z = city.zones.find((z) => z.kind === k && inCore(city, z.x, z.y));
      if (z) return z;
    }
    return center;
  };
  const coreLots = lots.filter((p) => inCore(city, p.x, p.y));
  // Hand-placed lots come first; the rules fill in only the tiers a city leaves out.
  const out: HomeLot[] = [...(city.homes ?? [])];
  for (const h of out) taken.add(`${h.x},${h.y}`);
  const add = (tier: number, find: () => Cell | null | undefined) => {
    if (out.some((h) => h.tier === tier)) return;
    const p = find();
    if (!p) throw new Error(`no lot for home tier ${tier} in ${city.id}`);
    taken.add(`${p.x},${p.y}`);
    out.push({ tier, x: p.x, y: p.y });
  };

  add(2, () => coreLots.find((p) => p.c === "h" && !taken.has(`${p.x},${p.y}`)) ?? best(coreLots, (p) => -dist(p, center)));
  const midtown = zoneCenter("midtown", "downtown");
  add(1, () => best(coreLots, (p) => dist(p, midtown)));
  const inner = city.zones.filter((z) => z.kind === "residential" && inCore(city, z.x, z.y)).sort((a, b) => dist(a, center) - dist(b, center))[0] ?? center;
  add(3, () => best(coreLots, (p) => dist(p, inner)));
  add(4, () => best(lots.filter((p) => !inCore(city, p.x, p.y)), (p) => Math.abs(ring(p) - 3) * 100 + dist(p, center)));
  const shore = cells.filter((p) => "b.h".includes(p.c) && touches(p.x, p.y, "ws") && ring(p) <= 8);
  add(5, () => best(shore.length ? shore : lots.filter((p) => ring(p) <= 8), (p) => -dist(p, center)));
  const parkEdge = cells.filter((p) => ".p".includes(p.c) && inCore(city, p.x, p.y) && (p.c === "p" || touches(p.x, p.y, "p")));
  add(0, () => best(parkEdge.length ? parkEdge : cells.filter((p) => p.c === "." && inCore(city, p.x, p.y)), (p) => dist(p, center)));
  return out.sort((a, b) => a.tier - b.tier);
}
```

- [ ] **Step 5: Run the tests**

Run: `cd game && node --test tests/home-lots.test.ts`
Expected: pass for every city. When a city throws "no lot for home tier N", look at its layout around the rule's target and widen that rule's pool (for example the tent's fallback), not the test.

- [ ] **Step 6: Commit**

```bash
git add game/src/engine/types.ts game/src/engine/world.ts game/src/engine/home-lots.ts game/tests/home-lots.test.ts
git commit -m "Engine: six home lots per city, one per tier"
```

---

### Task 8: Yard signs

**Files:**
- Modify: `game/art/make_ads.py` (`main`)
- Modify: `game/art/lib/homes.py`, `game/art/catalog.py`

- [ ] **Step 1: Draw the sign art**

In `main()` of `game/art/make_ads.py`, before `contact_sheet()`, add:

```python
    # yard signs on the player's homes (art/lib/homes.py)
    centered("sg-for-sale", 600, 360, "white",
             lambda s, b: s.text("FOR\nSALE", HELV_BOLD, inner(b, 0.1, 0.1), "#C8452F", align="center"))
    centered("sg-for-rent", 600, 360, "white",
             lambda s, b: s.text("FOR\nRENT", HELV_BOLD, inner(b, 0.1, 0.1), "#1F4E9C", align="center"))
```

Run: `cd game && python3 art/make_ads.py` and read `art/ads/_contact.png`: both signs legible.

- [ ] **Step 2: Model the sign**

Append to `game/art/lib/homes.py` (and add `from pathlib import Path` and `from .geo import quad` to its imports):

```python
ADS = Path(__file__).resolve().parent.parent / "ads"


def yard_sign(w, d, floors, seed, image="sg-for-sale.png"):
    """A yard sign at the lot's front-left corner, facing the street (front on -Y): a white post and arm
    with a hanging board the same aspect as its art (600 x 360)."""
    post = M.flat("post", (0.95, 0.94, 0.9, 1), rough=0.7)
    box("post", 0.1, -0.93, 0, 0.12, -0.91, px(15), post)
    box("arm", 0.1, -0.93, px(14), 0.34, -0.91, px(15), post)
    z0, z1 = px(7.5), px(7.5) + 0.2 * 360 / 600
    quad("board", [(0.13, -0.936, z0), (0.33, -0.936, z0), (0.33, -0.936, z1), (0.13, -0.936, z1)],
         M.image("sign-board", ADS / image, strength=0.0, glow=False))
    box("board-back", 0.13, -0.93, z0, 0.33, -0.926, z1, post)
    return px(15)
```

Add `"yard_sign": yard_sign,` to `HOME_BUILDERS`.

- [ ] **Step 3: Add them to the shared set**

At the end of `game/art/catalog.py`:

```python
CATALOG["common/home"] += [
    _e("yard_sign", 1, 1, 1, 300, ["home"], sid=f"sign-{k}-{f}", entry_kind="prop", prop=f"{k}-sign", facing=f,
       fill=False, unique=False, opts={"image": f"sg-for-{k}.png"})
    for k in ("sale", "rent") for f in FACINGS
]
```

- [ ] **Step 4: Render, pixelize, check**

```bash
cd game && blender -b -P art/build.py -- --city common/home --missing
python3 art/pixelize.py common/home && python3 art/check_register.py common/home && python3 art/contact.py common/home sign
```

Read the sheet: "FOR SALE" and "FOR RENT" readable at 4x, the board facing the street in each facing. (The home palette may not hold the rent sign's blue; if it quantizes badly, rerun `pixelize.py common/home --new-palette` and re-check the homes sheet.)

- [ ] **Step 5: Commit**

```bash
git add game/art/make_ads.py game/art/ads game/art/lib/homes.py game/art/catalog.py game/public/sprites/common game/art/palettes game/art/_contact-common-home*.png
git commit -m "Art: For sale and For rent yard signs for the home lots"
```

---

### Task 9: `HomeLots` draws every tier's lot (TDD for the sign lookup)

**Files:**
- Modify: `game/src/engine/sprite-pick.ts`, `game/tests/sprites.test.ts`
- Rewrite: `game/src/engine/hero.ts`
- Modify: `game/src/engine/scene.ts`

- [ ] **Step 1: Test and add `findHomeSign`**

Append to `game/tests/sprites.test.ts` (add `findHomeSign` to the import):

```ts
test("a home lot's yard sign is found by kind and facing", () => {
  const sign = (k: "sale" | "rent", facing: "s" | "e"): SpriteEntry => ({ ...entry(`sign-${k}-${facing}`, 1, 1, 1, ["home"]), kind: "prop", prop: `${k}-sign`, facing });
  const m: SpriteManifest = { scale: 1, sprites: [sign("sale", "s"), sign("rent", "e")] };
  assert.equal(findHomeSign(m, "sale", "s")?.id, "sign-sale-s");
  assert.equal(findHomeSign(m, "rent", "s"), null);
});
```

In `game/src/engine/sprite-pick.ts`, change `prop?: "shelter";` to `prop?: "shelter" | "sale-sign" | "rent-sign";` and append:

```ts
/** The "For sale" or "For rent" sign for a home lot facing `facing`. */
export function findHomeSign(m: SpriteManifest, kind: "sale" | "rent", facing: Facing): SpriteEntry | null {
  return m.sprites.find((s) => s.kind === "prop" && s.prop === `${kind}-sign` && s.facing === facing) ?? null;
}
```

Run: `cd game && node --test tests/sprites.test.ts` (pass).

- [ ] **Step 2: Rewrite `hero.ts`**

Replace `game/src/engine/hero.ts` with the version below. The brick models are the previous file's `switch (tier)` cases, unchanged, moved into `brickHome`:

```ts
// The player's homes. Every home tier has its own lot (home-lots.ts) and shows
// its model there: a hero sprite from the shared home set, or a brick model
// when the set is missing. Homes the player doesn't live in carry a "For sale"
// or "For rent" sign; the current one has the pulsing ring and the floating
// pin, and bounces when the player moves in.

import { Container, Graphics } from "pixi.js";
import { HOME_TIERS, TIERS } from "../sim/life/homes";
import { buildBrick, type Built } from "./bricks";
import { shade } from "./color";
import type { HomeLot } from "./home-lots";
import { depthOf, iso } from "./iso";
import { box } from "./shapes";
import { findHome, findHomeSign, type Facing } from "./sprite-pick";
import { buildSprite, type SpriteSet } from "./sprites";

export { HOME_TIERS };

class Home {
  readonly view = new Container();
  readonly lot: HomeLot;
  readonly body: Container[] = [];
  private readonly lights: Container[] = [];
  private readonly model = new Container();
  private readonly ring = new Graphics();
  private readonly pin = new Graphics();
  private readonly sign: Container | null = null;
  private anim = 1;
  private time = 0;
  private current = false;

  constructor(lot: HomeLot, seed: number, set: SpriteSet | null, facing: Facing) {
    this.lot = lot;
    const { x, y, tier } = lot;
    this.view.zIndex = depthOf(x, y, 70);
    const p = iso(x + 0.5, y + 0.5, 0);
    this.ring.ellipse(0, 0, 30, 15).stroke({ width: 3, color: 0x2ecc71 });
    this.ring.position.set(p.x, p.y);
    this.pin.poly([0, 0, -11, -17, 11, -17]).fill(0x27ae60);
    this.pin.circle(0, -25, 14).fill(0x2ecc71).stroke({ width: 3, color: 0xffffff });
    this.pin.circle(0, -25, 5.5).fill(0xffffff);
    this.pin.position.set(p.x, p.y - 70);
    const add = (b: Built) => {
      this.model.addChild(b.view);
      this.body.push(b.view.children[0] as Container);
      this.lights.push(b.lights);
    };
    const art = set ? findHome(set.manifest, tier, facing) : null;
    if (art && set) add(buildSprite(set, art, x, y));
    else brickHome(tier, x, y, seed, add, this.model, this.body);
    this.view.addChild(this.ring, this.model);
    const tenure = TIERS[tier].tenure;
    const signArt = set && tenure !== "forced" ? findHomeSign(set.manifest, tenure === "rent" ? "rent" : "sale", facing) : null;
    if (signArt && set) {
      const s = buildSprite(set, signArt, x, y);
      this.sign = s.view;
      this.body.push(s.view.children[0] as Container);
      this.view.addChild(s.view);
    }
    this.view.addChild(this.pin);
    this.setCurrent(false, false);
  }

  setCurrent(on: boolean, animate: boolean): void {
    if (on && !this.current && animate) this.anim = 0;
    this.current = on;
    this.ring.visible = this.pin.visible = on;
    if (this.sign) this.sign.visible = !on;
  }

  update(dt: number, night: number): void {
    this.time += dt;
    for (const l of this.lights) l.alpha = night;
    if (this.current) {
      const pulse = (Math.sin(this.time * 2.4) + 1) / 2;
      this.pin.y = iso(this.lot.x + 0.5, this.lot.y + 0.5, 0).y - 78 + Math.sin(this.time * 2.4) * 4;
      this.ring.scale.set(0.9 + pulse * 0.25);
      this.ring.alpha = 0.45 + pulse * 0.45;
    }
    if (this.anim < 1) {
      this.anim = Math.min(1, this.anim + dt * 1.6);
      const k = this.anim;
      this.model.y = k < 0.7 ? -60 * (1 - k / 0.7) ** 2 : Math.sin(((k - 0.7) / 0.3) * Math.PI) * -6;
      this.model.alpha = Math.min(1, k * 2);
    }
  }
}

/** All six home lots; one of them is where the player lives. */
export class HomeLots {
  private readonly homes: Home[];
  private currentTier = -1;

  constructor(lots: HomeLot[], seed: number, set: SpriteSet | null, facingAt: (x: number, y: number) => Facing, tier: number) {
    this.homes = lots.map((l) => new Home(l, seed, set, facingAt(l.x, l.y)));
    this.setTier(tier, false);
  }

  get views(): Container[] {
    return this.homes.map((h) => h.view);
  }

  get tier(): number {
    return this.currentTier;
  }

  /** The lot the player lives on. */
  get current(): HomeLot {
    return (this.homes.find((h) => h.lot.tier === this.currentTier) ?? this.homes[0]).lot;
  }

  lot(tier: number): HomeLot | undefined {
    return this.homes.find((h) => h.lot.tier === tier)?.lot;
  }

  setTier(tier: number, animate = true): void {
    const t = Math.max(0, Math.min(HOME_TIERS.length - 1, tier));
    if (t === this.currentTier) return;
    for (const h of this.homes) h.setCurrent(h.lot.tier === t, animate);
    this.currentTier = t;
  }

  /** The tier whose lot is at a tile, or null. */
  tierAt(x: number, y: number): number | null {
    return this.homes.find((h) => h.lot.x === x && h.lot.y === y)?.lot.tier ?? null;
  }

  get tintables(): Container[] {
    return this.homes.flatMap((h) => h.body);
  }

  update(dt: number, night: number): void {
    for (const h of this.homes) h.update(dt, night);
  }
}

/** The procedural models, used when the shared home set is missing. */
function brickHome(tier: number, x: number, y: number, seed: number, add: (b: Built) => void, c: Container, body: Container[]): void {
  switch (tier) {
    // Paste the previous hero.ts build() switch cases here unchanged, replacing `c.addChild(g); this.body.push(g);`
    // with `c.addChild(g); body.push(g);` in the tent (case 0) and villa (default) cases.
  }
}
```

Paste the old cases into `brickHome` exactly as described in the comment, then delete the comment. The old cases are: case 0 (tent drawn with `box` and `Graphics`, using `shade`), cases 1-4 (`add(buildBrick({...}))`), and default (the pool `Graphics` plus `add(buildBrick({...}))`).

- [ ] **Step 3: Use `HomeLots` in the scene**

In `game/src/engine/scene.ts`:

1. Imports: replace `import { HeroHome } from "./hero";` with `import { HomeLots } from "./hero";` and add `import { placeHomes, type HomeLot } from "./home-lots";`; add `facingOf` to the `./sprite-pick` import.
2. Fields: replace `readonly hero: HeroHome | null = null;` with:

```ts
  /** The player's six home lots; null only if a city has no room for them. */
  readonly homes: HomeLots | null = null;
  /** Called when the player clicks one of the home lots. */
  onHomePick: ((tier: number) => void) | null = null;
  private readonly homeLots: HomeLot[];
```

3. Constructor signature: add `homeSprites: SpriteSet | null = null, homeTier = 1` after `seed = 7`.
4. Replace the yard-clearing loop (`// Keep a yard in front of the player's home...` through its three lines) with:

```ts
    // The player's home lots, one per tier, become home tiles with a clear yard in front.
    this.homeLots = placeHomes(this.grid, this.city);
    for (const { x, y } of this.homeLots) {
      this.grid.set(x, y, "h");
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) if (this.grid.at(x + dx, y + dy) === "b") this.grid.set(x + dx, y + dy, ".");
    }
```

5. Replace the loop that creates `HeroHome` (`for (const { x, y, c } of this.grid.cells()) if (c === "h") { ... }`) with:

```ts
    this.homes = new HomeLots(this.homeLots, seed, homeSprites, (x, y) => facingOf((i, j) => this.grid.isRoad(i, j), x, y), homeTier);
    for (const v of this.homes.views) this.objects.addChild(v);
```

6. `focusHome`:

```ts
  focusHome(zoom = 2): void {
    const h = this.homes?.current;
    if (!h) return;
    this.zoom = zoom;
    this.cam.x = h.x + 0.5;
    this.cam.y = h.y + 0.5;
    this.applyCamera();
  }
```

7. Tint loop: `if (this.homes) for (const t of this.homes.tintables) t.tint = tint;`; update: `this.homes?.update(dt, night);`.
8. Clicks: in `bindInput`'s `up`, before `this.onPick?.(...)`, add:

```ts
      const tier = this.homeAt(wx, wy);
      if (tier !== null && this.onHomePick) return this.onHomePick(tier);
```

and add the method:

```ts
  /** The home tier drawn under a world point: its lot tile, or a tile in front of the point where the house stands tall. */
  private homeAt(wx: number, wy: number): number | null {
    const tx = Math.floor((wx / HALF_W + wy / HALF_H) / 2);
    const ty = Math.floor((wy / HALF_H - wx / HALF_W) / 2);
    for (let k = 0; k < 4; k++) {
      const t = this.homes?.tierAt(tx + k, ty + k) ?? null;
      if (t !== null) return t;
    }
    return null;
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd game && npx tsc --noEmit -p tsconfig.json`
Expected: errors only in `main.ts` and `hud.ts` (they still use `scene.hero`); Task 10 fixes those.

- [ ] **Step 5: Commit**

```bash
git add game/src/engine/sprite-pick.ts game/tests/sprites.test.ts game/src/engine/hero.ts game/src/engine/scene.ts
git commit -m "Engine: every home tier stands on its own lot with a yard sign"
```

---

### Task 10: The home picker

**Files:**
- Create: `game/src/ui/home-picker.ts`, `game/src/ui/home-picker.css`
- Modify: `game/src/ui/hud.ts`, `game/src/style.css`, `game/src/main.ts`

- [ ] **Step 1: Write the picker**

Create `game/src/ui/home-picker.ts`:

```ts
// The home picker: every home tier with its price, what moving there takes,
// and why a tier is locked. Choosing one runs the real move in PlayerLife
// (rent, or a mortgage application). Time is paused while it's open. It uses
// the fast-forward window's frame (skip-setup.css) in Eric's pixel theme.

import type { Clock } from "../engine/clock";
import { DOWN_PAYMENTS, HOME_TIERS, TIERS } from "../sim/life/homes";
import type { PlayerLife } from "../sim/life/player";
import "./home-picker.css";

export interface HomePickerDeps {
  clock: Clock;
  player: PlayerLife;
  /** The city's name and the place each tier stands in it. */
  city: () => string;
  whereOf: (tier: number) => string;
  /** After a move: redraw the home and pan to it. */
  onMoved: () => void;
}

const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const pct = (p: number) => `${+(p * 100).toFixed(1)}%`;

export class HomePicker {
  private readonly el: HTMLElement;
  private readonly deps: HomePickerDeps;
  private down: number = DOWN_PAYMENTS[DOWN_PAYMENTS.length - 1];
  private focus: number | null = null;
  private message = "";
  private resumeSpeed = 1;

  constructor(deps: HomePickerDeps) {
    this.deps = deps;
    this.el = document.createElement("div");
    this.el.className = "ff-overlay home-picker";
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    window.addEventListener("keydown", (ev) => {
      if (!this.el.hidden && ev.key === "Escape") this.close();
    });
  }

  /** Opens the picker, optionally highlighting one tier (a clicked home lot). */
  open(focus: number | null = null): void {
    const { clock } = this.deps;
    if (this.el.hidden) {
      this.resumeSpeed = clock.speed || this.resumeSpeed;
      clock.speed = 0;
    }
    this.focus = focus;
    this.message = "";
    this.el.hidden = false;
    this.render();
  }

  close(): void {
    this.el.hidden = true;
    this.deps.clock.speed = this.resumeSpeed;
  }

  private render(): void {
    const { player, clock } = this.deps;
    const now = player.homeTier();
    const rows = TIERS.filter((t) => t.tenure !== "forced")
      .map((t) => {
        const q = player.quoteHome(t.tier, { day: clock.day, date: clock.date, downPct: this.down });
        const here = t.tier === now;
        const cost = t.tenure === "rent" ? `${money(q.monthly)} a month` : `${money(q.price)} · about ${money(q.monthly)} a month`;
        const odds = q.odds === null ? "" : ` · ${Math.round(q.odds * 100)}% mortgage odds`;
        const why = !here && q.reasons.length ? `<ul class="hp-why">${q.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>` : "";
        const action = here
          ? `<span class="hp-here">You live here</span>`
          : `<button class="btn" data-tier="${t.tier}" ${q.ok ? "" : "disabled"}>${t.tenure === "rent" ? "Rent" : "Buy"}</button>`;
        return `<li class="hp-row${here ? " here" : ""}${this.focus === t.tier ? " focus" : ""}">
          <div class="hp-name">${HOME_TIERS[t.tier]}</div>
          <div class="hp-where">${this.deps.whereOf(t.tier)}</div>
          <div class="hp-cost">${cost}</div>
          <div class="hp-need">${money(q.cashNeeded)} cash to move${odds}</div>
          ${action}${why}
        </li>`;
      })
      .join("");
    const downs = DOWN_PAYMENTS.map((p) => `<button class="btn small${p === this.down ? " on" : ""}" data-down="${p}">${pct(p)}</button>`).join("");
    this.el.innerHTML = `
      <div class="ff-window hp-window" role="dialog" aria-label="Your home">
        <div class="ff-bar">
          <div class="ff-title"><span class="ff-dot"></span>Your home in ${this.deps.city()}</div>
          <button class="round" data-close title="Close">×</button>
        </div>
        ${this.message ? `<p class="hp-message">${this.message}</p>` : ""}
        <div class="hp-down">Down payment ${downs}</div>
        <ul class="hp-list">${rows}</ul>
      </div>`;
  }

  private onClick(ev: MouseEvent): void {
    const t = ev.target as HTMLElement;
    if (t === this.el || t.closest("[data-close]")) return this.close();
    const d = t.closest<HTMLElement>("[data-down]");
    if (d) {
      this.down = Number(d.dataset.down);
      return this.render();
    }
    const b = t.closest<HTMLButtonElement>("[data-tier]");
    if (!b || b.disabled) return;
    const { player, clock } = this.deps;
    const r = player.chooseHome(Number(b.dataset.tier), { day: clock.day, date: clock.date, downPct: this.down });
    if (!r.ok) {
      this.message = r.reasons.join(" ");
      return this.render();
    }
    this.close();
    this.deps.onMoved();
  }
}
```

If `skip-setup.css` is loaded by an `import` in `skip-setup.ts`, the `import "./home-picker.css"` above matches it; if it is linked from `index.html` instead, remove the import and add a matching `<link>` for `home-picker.css` there.

- [ ] **Step 2: Style it**

Create `game/src/ui/home-picker.css`:

```css
/* The home picker: the fast-forward window's frame (.ff-overlay, .ff-window, .ff-bar
   in skip-setup.css) holding a list of home tiers. */

.hp-window {
  width: min(720px, 100%);
  height: auto;
  max-height: min(760px, 100%);
}
.hp-message {
  margin: 12px 16px 0;
  padding: 8px 12px;
  border: 3px solid var(--edge, #101a23);
  background: #ffe3e0;
}
.hp-down {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 16px 0;
  font-weight: 700;
}
.hp-down .btn.on {
  background: var(--yellow, #ffcf33);
}
.hp-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 12px 16px 16px;
  overflow-y: auto;
  list-style: none;
}
.hp-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 12px;
  padding: 10px 12px;
  border: 3px solid var(--edge, #101a23);
  background: #fff;
}
.hp-row.here {
  background: #e3f6e6;
}
.hp-row.focus {
  outline: 3px solid var(--yellow, #ffcf33);
}
.hp-name {
  font-size: 16px;
  font-weight: 700;
}
.hp-where,
.hp-need {
  color: #4a5870;
  font-size: 13px;
}
.hp-row > .btn,
.hp-here {
  grid-column: 2;
  grid-row: 1 / span 4;
  align-self: center;
}
.hp-here {
  font-weight: 700;
  color: #1e7a3a;
}
.hp-why {
  grid-column: 1 / -1;
  margin: 4px 0 0;
  padding-left: 18px;
  color: #9c2a1c;
  font-size: 13px;
}
```

- [ ] **Step 3: The HUD card opens it**

In `game/src/ui/hud.ts`: change the import to `import { HOME_TIERS } from "../sim/life/homes";`, change `HudActions` to `{ openHomes(): void; focusHome(): void; }`, and replace the markup's `home-row` and the listeners with:

```ts
        <div class="home-row">
          <button class="home-name" data-home data-home-open title="Change home"></button>
          <button class="round find" data-home-focus title="Find my home">${pixelIcon("pin")}</button>
        </div>
```

```ts
    this.q<HTMLButtonElement>("[data-home-open]").addEventListener("click", () => actions.openHomes());
    this.q<HTMLButtonElement>("[data-home-focus]").addEventListener("click", () => actions.focusHome());
```

In `game/src/style.css`, after the `.home-name` rule, add:

```css
button.home-name {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
button.home-name:hover {
  text-decoration: underline;
}
```

- [ ] **Step 4: Wire it in `main.ts`**

1. In `syncHomeTier`, change `scene?.hero?.setTier(tier);` to `scene?.homes?.setTier(tier);`.
2. In `open()`, delete `const tier = scene?.hero?.tier;` and `if (tier !== undefined) scene.hero?.setTier(tier);`, change the scene line to `scene = new CityScene(app, city, clock, LANDMARKS, sprites, undefined, homeSprites, player.homeTier());`, and after `scene.onPick = ...` add `scene.onHomePick = (tier) => homePicker.open(tier);`.
3. Add, before the `Hud` is created:

```ts
// The player's home: the picker moves them (rent or buy), then the city shows the new home.
const homePicker = new HomePicker({
  clock,
  player,
  city: () => state.city,
  whereOf: (tier) => scene?.homes?.lot(tier)?.where ?? TIERS[tier].where,
  onMoved: () => {
    syncHomeTier();
    scene?.focusHome(1.6);
  },
});
```

with imports `import { HomePicker } from "./ui/home-picker";` and `import { TIERS } from "./sim/life/homes";`.
4. The `Hud` actions become `{ openHomes: () => homePicker.open(), focusHome: () => scene?.focusHome() }`.
5. The HUD interval becomes `setInterval(() => hud.render(scene?.homes ? player.homeTier() : null), 200);`.

- [ ] **Step 5: Typecheck and test**

Run: `cd game && npm run build && npm test`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add game/src/ui/home-picker.ts game/src/ui/home-picker.css game/src/ui/hud.ts game/src/style.css game/src/main.ts
git commit -m "UI: the home picker replaces the HUD's tier buttons"
```

---

### Task 11: See it in the game

- [ ] **Step 1: Run and open SF**

Run in the background: `cd game && npm run dev -- --port 5199 --strictPort`. Open `http://localhost:5199/#san-francisco` and skip onboarding (the sample household rents the studio).

- [ ] **Step 2: Walk through the moves**

- The six home lots are visible around the city; the studio has the ring and pin; the others have "For sale" signs (the studio's sign reads "For rent" when you move out).
- Click the "Your home" card: the picker opens, time pauses, the studio row says "You live here", houses show prices, cash needed, odds, and red reasons.
- In the console, give the player money: `larp` exposes the scene; if the player is not reachable, temporarily set savings with the Money desk's dev tools or restart with `?seed=` and the typed intake (salary 250000, savings 900000).
- Buy the small house: the camera pans to the Sunset lot, the house bounces, the ring and pin move, the studio's lot shows "For rent", the narrator says `home_up`, and the Money desk (phone, Stocks) lists a Mortgage and the "Property tax and insurance" bill.
- Change the down payment to 3.5%: monthly cost rises (PMI).
- Click a home lot in the city: the picker opens on that tier.
- Try a tier you can't afford: the button is disabled and the reasons explain why.
- Screenshot each step at default zoom, day and night. Check the picker against the pixel theme (square corners, dark edges, Pixelify Sans) and fix anything off.

- [ ] **Step 3: Close the tab and stop the dev server.**

---

### Task 12: San Francisco's hand-placed home lots (after the roads merge)

This task waits until branch `roads-traffic` is merged into `main` (it widens SF streets, which changes which lots exist).

- [ ] **Step 1: Rebase onto main**

```bash
git fetch origin && git rebase origin/main
```

Resolve conflicts in `game/src/engine/world.ts` (keep the roads rewrite and re-add `core` and `homes` to the returned city) and `game/src/cities/san-francisco.ts` (keep the roads layout and the house styles on the zones). Run `cd game && npm test`.

- [ ] **Step 2: Find candidate lots near each place**

Run from `game/`:

```bash
node --input-type=module -e '
import { sanFrancisco } from "./src/cities/san-francisco.ts";
import { CityGrid } from "./src/engine/grid.ts";
const g = new CityGrid(sanFrancisco.layout);
const places = { tent: [16, 20], studio: [28, 20], small: [11, 25], townhouse: [26, 27], large: [5, 30], villa: [2, 10] };
for (const [name, [px, py]] of Object.entries(places)) {
  const near = [];
  for (const { x, y, c } of g.cells())
    if ((c === "b" || c === "." || c === "h") && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => g.isRoad(x + dx, y + dy)))
      near.push([Math.hypot(x - px, y - py), x, y, c]);
  near.sort((a, b) => a[0] - b[0]);
  console.log(name, near.slice(0, 5).map(([, x, y, c]) => `${x},${y}${c}`).join("  "));
}'
```

(`sanFrancisco.layout` is core coordinates, which is what `homes` uses. If the roads change made `layout()` return `{ layout, roads }`, read `.layout` accordingly.) The large house is not placed by hand: it belongs in the generated suburb ring, outside SF's hand-made core, so the rule in `home-lots.ts` finds it.
From each list pick the first lot that is a real fit for the place (the tent on the park's edge, the villa on the Marin side of the Golden Gate, the townhouse among the Alamo Square Victorians), not just the nearest.

- [ ] **Step 3: Set them in `san-francisco.ts`**

Add to the `sanFrancisco` definition, with the coordinates picked in Step 2. The example below shows the shape; the numbers other than the existing Sunset home (11, 25) come from Step 2's output:

```ts
  // The player's homes (docs/superpowers/specs/2026-09-12-blender-houses-design.md, Milestone 2).
  // The large house is left to the rule in home-lots.ts: it stands in the generated suburb ring.
  homes: [
    { tier: 0, x: 16, y: 22, where: "the edge of Golden Gate Park" },
    { tier: 1, x: 27, y: 19, where: "a walk-up in SoMa" },
    { tier: 2, x: 11, y: 25, where: "the Sunset, near Ocean Beach" },
    { tier: 3, x: 27, y: 27, where: "a Victorian by Alamo Square" },
    { tier: 5, x: 2, y: 10, where: "the Marin headlands, above the water" },
  ],
```

Check each coordinate against Step 2 before committing: every one must be in that step's candidate lists.

- [ ] **Step 4: Test and look**

Run: `cd game && node --test tests/home-lots.test.ts` (the SF case now checks the hand lots) and repeat Task 11's walk-through for SF, checking each home reads as its place (the villa above the water, the townhouse among Victorians).

- [ ] **Step 5: Commit**

```bash
git add game/src/cities/san-francisco.ts
git commit -m "San Francisco: hand-placed home lots on the new street layout"
```

---

### Task 13: Docs

**Files:**
- Modify: `game/README.md`, `README.md` (only where they describe home tiers)

- [ ] **Step 1: Find the old rule**

Run: `grep -rn "net worth" README.md game/README.md | grep -i "home\|tier"`
Every hit that says the home follows net worth is now wrong.

- [ ] **Step 2: Rewrite those lines**

Replace them with this description (one sentence per line):

```markdown
The player chooses their home from the "Your home" card or by clicking a home lot: a rented studio, or a small house, townhouse, large house, or villa bought with a mortgage the lender has to approve (`src/sim/life/homes.ts`, `PlayerLife.chooseHome`).
Each tier stands on its own lot in the city (`src/engine/home-lots.ts`; San Francisco places them by hand), and homes the player doesn't live in carry a "For sale" or "For rent" sign.
Eviction (rent paid short two months running), foreclosure (a mortgage 120 days behind), or bankruptcy moves the player to the tent.
```

- [ ] **Step 3: Commit**

```bash
git add README.md game/README.md
git commit -m "Docs: choosing a home"
```

---

## Self-review notes

- Spec coverage: tier table and multipliers (Task 1), rent and buy with `houseMath` and `applyForLoan` (Task 3), selling costs (Task 3), down payment options (Tasks 1, 10), equity in net worth (Task 2), tier no longer from net worth (Task 2), forced tent (Task 4), onboarding start (Task 2), moving states (Task 5), recorder and coach (Task 6; `RunRecorder` records every life event already), `CityDef.homes` and automatic placement (Task 7), signs (Task 8), current home ring and pin, bounce, clicks (Task 9), picker with reasons and paused time (Task 10), Money desk (Task 11 check), SF hand lots after the roads merge (Task 12).
- Foreclosure is "120 days past due" because the debt engine never sends a secured mortgage to collections; the spec says so.
- Task 12's example coordinates must be checked against Step 2's output, because they depend on the roads layout, which does not exist yet.
