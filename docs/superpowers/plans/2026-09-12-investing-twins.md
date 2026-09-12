# Investing Twins and the Crash Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Held and Autopilot shadow portfolios next to the player's brokerage, a bear-market decision in the Money desk, a three-line Investing chart, and persistence plus a Gemini crash recap on Tri's server.

**Architecture:** A `Twins` class inside `PlayerLife` copies every buy (never a sell) onto the same seeded prices, so the gap between lines is only the player's choices.
`PlayerLife` also watches LTM's peak and emits `bear_market` / `market_recovered` events, which the desk turns into a paused decision and a result card.
The desk syncs daily rows to `/api/snapshot` through a fire-and-forget client and asks `/api/recap` (Gemini) for the recovery lesson.

**Tech Stack:** TypeScript on Node's built-in type stripping (`erasableSyntaxOnly`: no parameter properties or enums), `node:test`, Vite desk page, Express + Zod + pg server.

Spec: `docs/superpowers/specs/2026-09-12-investing-twins-design.md`.
All paths are relative to the worktree root `.worktrees/investing-twins/`.
Baseline: `game/` 83 tests pass and `tsc` is clean; `server/` 25 tests pass and `tsc` is clean.

## File map

| File | Change |
| --- | --- |
| `game/src/sim/life/twins.ts` | New. Held and Autopilot units, cash out, values. |
| `game/src/sim/life/player.ts` | Owns `Twins`; feeds buys and sells; snapshot fields; bear watch and events. |
| `game/src/sim/life/index.ts` | Re-export `Twins`, `AUTOPILOT_MIX`. |
| `game/tests/twins.test.ts` | New. Twins and bear-event tests. |
| `game/src/debt-demo/chart.ts` | `lines` (labeled extra lines) replaces `ghost`; `zero` option. |
| `game/src/debt-demo/desk.css` | `.bc-held`, `.bc-auto`, `.bc-tag`. |
| `game/src/debt-demo/main.ts` | Twins chart, crash popup, recovery and concentration cards, sync. |
| `game/src/net/runs.ts` | New. `RunSync`: lazy run, queued rows, flush, recap. |
| `game/tests/runs.test.ts` | New. `RunSync` with a fake api. |
| `server/src/migrations.sql` | `you`, `held`, `autopilot` columns. |
| `server/src/routes/snapshot.ts` | Schema, upsert, history columns. |
| `server/src/routes/snapshot.test.ts` | Schema tests. |
| `server/src/adapters/gemini.ts` | `generateCrashRecap`. |
| `server/src/adapters/gemini.test.ts` | Recap parse test. |
| `server/src/routes/ai.ts` | `POST /recap` with a cache. |

---

### Task 1: Twins

**Files:**
- Create: `game/src/sim/life/twins.ts`
- Create: `game/tests/twins.test.ts`
- Modify: `game/src/sim/life/index.ts`

- [ ] **Step 1: Write the failing test**

Create `game/tests/twins.test.ts`:

```ts
// Twins tests: the "if you had held" and "autopilot" shadow portfolios, and the bear-market events.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Twins } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";

const START = new Date(2026, 8, 11);
// An early AI arc so a test reaches the pop and the recovery in a few simulated years.
const earlyMarket = () => new MarketPath(5, START, { boom: new Date(2026, 9, 1), pop: new Date(2027, 0, 4) });

test("twins copy buys at the same price and ignore sells", () => {
  const m = earlyMarket();
  const t = new Twins(m);
  t.buy("NNST", 1_000, 0);
  t.sell(400);
  assert.equal(t.invested, 1_000);
  assert.equal(t.cashOut, 400);
  // Held owns exactly what $1,000 of NNST bought on day 0.
  assert.ok(Math.abs(t.held(50) - (1_000 / m.price("NNST", 0)) * m.price("NNST", 50)) < 0.01);
  // Autopilot put the same $1,000 in 90% LTM and 10% BOND.
  const auto = (900 / m.price("LTM", 0)) * m.price("LTM", 50) + (100 / m.price("BOND", 0)) * m.price("BOND", 50);
  assert.ok(Math.abs(t.autopilot(50) - auto) < 0.01);
  // You is the brokerage value plus the cash sells took out.
  assert.equal(t.you(250), 650);
});

test("an empty twin is worth nothing", () => {
  const t = new Twins(earlyMarket());
  assert.equal(t.held(10), 0);
  assert.equal(t.autopilot(10), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/twins.test.ts`
Expected: FAIL, `Twins` is not exported from `../src/sim/life/index.ts`.

- [ ] **Step 3: Write the implementation**

Create `game/src/sim/life/twins.ts`:

```ts
// Shadow portfolios for honest comparisons (research/03, "Showing counterfactuals").
// Every buy the player makes is copied, same day and same price, into two twins:
// Held buys the same instrument, and Autopilot splits the dollars 90/10 between
// the total market fund and the bond fund. Neither twin ever sells. The market
// path never depends on the player, so the gap between the player and a twin
// comes only from the player's choices.

import type { InstrumentId, MarketPath } from "../market/index.ts";

/** Autopilot's fixed mix, close to a target-date fund decades from retirement. */
export const AUTOPILOT_MIX: readonly (readonly [InstrumentId, number])[] = [
  ["LTM", 0.9],
  ["BOND", 0.1],
];

type Units = Partial<Record<InstrumentId, number>>;

const round2 = (x: number) => Math.round(x * 100) / 100;

export class Twins {
  /** Dollars the player has put into the brokerage. */
  invested = 0;
  /** Dollars the player's sells took out of the brokerage. */
  cashOut = 0;
  private readonly market: MarketPath;
  private readonly heldUnits: Units = {};
  private readonly autoUnits: Units = {};

  constructor(market: MarketPath) {
    this.market = market;
  }

  buy(id: InstrumentId, dollars: number, day: number): void {
    this.invested = round2(this.invested + dollars);
    this.add(this.heldUnits, id, dollars, day);
    for (const [i, w] of AUTOPILOT_MIX) this.add(this.autoUnits, i, dollars * w, day);
  }

  sell(proceeds: number): void {
    this.cashOut = round2(this.cashOut + proceeds);
  }

  /** The player's line: what the brokerage holds now plus what sells took out. */
  you(brokerageValue: number): number {
    return round2(brokerageValue + this.cashOut);
  }

  held(day: number): number {
    return this.value(this.heldUnits, day);
  }

  autopilot(day: number): number {
    return this.value(this.autoUnits, day);
  }

  private add(units: Units, id: InstrumentId, dollars: number, day: number): void {
    units[id] = (units[id] ?? 0) + dollars / this.market.price(id, day);
  }

  private value(units: Units, day: number): number {
    let s = 0;
    for (const [id, n] of Object.entries(units) as [InstrumentId, number][]) s += n * this.market.price(id, day);
    return round2(s);
  }
}
```

Replace `game/src/sim/life/index.ts` so it also exports the twins (keep its existing exports; read the file first and append this line):

```ts
export { AUTOPILOT_MIX, Twins } from "./twins.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd game && node --test tests/twins.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/twins.ts game/src/sim/life/index.ts game/tests/twins.test.ts
git commit -m "Twins: held and autopilot shadow portfolios"
```

---

### Task 2: PlayerLife owns the twins and snapshots the lines

**Files:**
- Modify: `game/src/sim/life/player.ts` (imports, `LifeSnapshot`, class fields, constructor, `fill`, `snapshot`)
- Test: `game/tests/twins.test.ts`

- [ ] **Step 1: Write the failing test**

In `game/tests/twins.test.ts`, change the first import to `import { PlayerLife, Twins, type Place } from "../src/sim/life/index.ts";`, then append:

```ts
const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const live = (life: PlayerLife, from: number, to: number) => {
  const all = [];
  for (let day = from + 1; day <= to; day++) all.push(...life.onDay(day, dateOf(day)));
  return all;
};

test("buying and holding keeps you equal to held", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: earlyMarket() });
  life.buy("LTM", 500);
  live(life, 0, 60);
  const s = life.history.at(-1)!;
  assert.equal(s.you, s.held);
  assert.equal(s.brokerage, s.you);
  assert.ok(s.autopilot > 0 && s.autopilot !== s.held);
});

test("selling at the pop's bottom leaves you below held after the recovery", () => {
  const m = earlyMarket();
  const life = new PlayerLife({ place: TX, day: 0, market: m });
  life.buy("LTM", 1_000);
  const bottom = m.presets.popEndDay - 1;
  const end = m.presets.popEndDay + 400;
  assert.ok(m.price("LTM", end) > m.price("LTM", bottom), "seed 5 recovers from the bottom by the end");
  live(life, 0, bottom);
  assert.ok(life.sell("LTM", "all").ok);
  live(life, bottom, end);
  const s = life.history.at(-1)!;
  assert.equal(s.brokerage, 0);
  assert.ok(s.you > 0, "the sale's cash still counts on your line");
  assert.ok(s.held > s.you, `held ${s.held} vs you ${s.you}`);
});

test("two trades on one day keep one snapshot with both buys", () => {
  const life = new PlayerLife({ place: TX, day: 0, market: earlyMarket() });
  life.buy("LTM", 100);
  life.buy("BOND", 100);
  assert.equal(life.history.length, 1);
  assert.ok(Math.abs(life.history[0].held - 200) < 0.01);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/twins.test.ts`
Expected: FAIL, `s.you` is `undefined` (and trades don't re-record).

- [ ] **Step 3: Write the implementation**

In `game/src/sim/life/player.ts`:

Add the import after the `CrashWatch` import:

```ts
import { Twins } from "./twins.ts";
```

Replace the `LifeSnapshot` interface:

```ts
export interface LifeSnapshot {
  day: number;
  cash: number;
  investments: number;
  debt: number;
  netWorth: number;
  score: number;
  /** Brokerage holdings at the day's prices. */
  brokerage: number;
  /** The player's investing line: brokerage plus the cash sells took out (sim/life/twins.ts). */
  you: number;
  /** The same buys, never sold. */
  held: number;
  /** The same dollars at 90/10 LTM/BOND, never sold. */
  autopilot: number;
}
```

Add a field after `readonly history: LifeSnapshot[] = [];`:

```ts
  /** Shadow portfolios of the player's buys, for "if you had held" and "autopilot". */
  readonly twins: Twins;
```

In the constructor, before `this.record(o.day);`:

```ts
    this.twins = new Twins(this.market);
```

In `buy`, after `if (result.ok) this.emit([result.event]);`, add `this.record(day);` so a trade updates today's history row. In `sell`, do the same (`if (result.ok) { this.record(day); this.emit([result.event]); }` for both; record before emit so listeners see the new row):

```ts
  buy(id: InstrumentId, amount: number, day = this.today, recurring = false): TradeResult {
    const result = this.fill(id, "buy", amount, day, recurring);
    if (result.ok) {
      this.record(day);
      this.emit([result.event]);
    }
    return result;
  }

  sell(id: InstrumentId, amount: number | "all", day = this.today): TradeResult {
    const pos = this.position(id);
    if (!pos) return { ok: false, error: "You don't own any." };
    const result = this.fill(id, "sell", amount === "all" ? pos.value : amount, day, false, amount === "all");
    if (result.ok) {
      this.record(day);
      this.emit([result.event]);
    }
    return result;
  }
```

In `fill`, feed the twins. In the buy branch, after `h.cost = round2(h.cost + dollars);`:

```ts
      this.twins.buy(id, dollars, day);
```

In the sell branch, after `checking.balance = round2(checking.balance + proceeds);`:

```ts
      this.twins.sell(proceeds);
```

Replace `snapshot`:

```ts
  /** Balances right now, as a history row. */
  snapshot(day: number): LifeSnapshot {
    const cash = this.cash();
    const investments = this.investments();
    const debt = this.totalDebt();
    const brokerage = round2(this.positions(day).reduce((t, p) => t + p.value, 0));
    return {
      day,
      cash,
      investments,
      debt,
      netWorth: round2(cash + investments - debt),
      score: this.book.profile.score,
      brokerage,
      you: this.twins.you(brokerage),
      held: this.twins.held(day),
      autopilot: this.twins.autopilot(day),
    };
  }
```

- [ ] **Step 4: Run the tests**

Run: `cd game && npm test`
Expected: PASS, 88 tests (83 before plus 5). `tests/life.test.ts` "a replayed run is identical" still passes because twins are deterministic.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/twins.test.ts
git commit -m "PlayerLife: twins follow every buy; snapshots carry you, held, and autopilot"
```

---

### Task 3: Bear-market and recovery events

**Files:**
- Modify: `game/src/sim/life/player.ts` (imports, `LifeEvent`, fields, constructor, `onDay`, `needsDecision`)
- Test: `game/tests/twins.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `game/tests/twins.test.ts`:

```ts
test("a bear market fires once per drawdown and re-arms after a new high", () => {
  const m = earlyMarket();
  const life = new PlayerLife({ place: TX, day: 0, market: m });
  life.buy("LTM", 1_000);
  const events = live(life, 0, m.presets.popEndDay + 800).filter((e) => e.type === "bear_market" || e.type === "market_recovered");
  assert.ok(events.some((e) => e.type === "bear_market" && e.day >= m.presets.popDay && e.day < m.presets.popEndDay), "the AI pop is a bear market");
  // They alternate: bear, recovered, bear, recovered...
  events.forEach((e, i) => assert.equal(e.type, i % 2 ? "market_recovered" : "bear_market"));
  for (const e of events) if (e.type === "bear_market") assert.ok(e.drop >= 0.2 && e.stocks > 0);
});

test("no stocks, no bear-market decision", () => {
  const m = earlyMarket();
  const life = new PlayerLife({ place: TX, day: 0, market: m });
  life.buy("BOND", 500);
  const events = live(life, 0, m.presets.popEndDay);
  assert.equal(events.filter((e) => e.type === "bear_market").length, 0);
  assert.equal(life.needsDecision([{ type: "bear_market", day: 1, drop: 0.2, stocks: 1 }]), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/twins.test.ts`
Expected: FAIL, no `bear_market` events (and a type error in `needsDecision`'s argument, reported at runtime as a false return).

- [ ] **Step 3: Write the implementation**

In `game/src/sim/life/player.ts`, change the crash import to also bring the drawdown line:

```ts
import { CrashWatch, PANIC_DRAWDOWN } from "../skip/crash.ts";
```

Add two members to the `LifeEvent` union:

```ts
  | { type: "bear_market"; day: number; drop: number; stocks: number }
  | { type: "market_recovered"; day: number; you: number; held: number; autopilot: number }
```

Add fields after `private k401Ytd = 0;`:

```ts
  /** Highest LTM close seen, for the bear-market line. */
  private ltmPeak: number;
  /** A bear_market event fired and the market hasn't set a new high since. */
  private inBear = false;
```

In the constructor, after `this.market = ...`:

```ts
    this.ltmPeak = this.market.price("LTM", o.day);
```

In `onDay`, right before `this.record(day);`:

```ts
    events.push(...this.watchMarket(day));
```

Add the method after `onFirstOfMonth`:

```ts
  /**
   * The desk's crash moment (research/03, event 1): the first close 20% below
   * LTM's high while the player owns stocks. It fires once, then re-arms when
   * LTM sets a new high, which also reports how each line came through.
   */
  private watchMarket(day: number): LifeEvent[] {
    const price = this.market.price("LTM", day);
    if (price >= this.ltmPeak) {
      this.ltmPeak = price;
      if (!this.inBear) return [];
      this.inBear = false;
      const snap = this.snapshot(day);
      return [{ type: "market_recovered", day, you: snap.you, held: snap.held, autopilot: snap.autopilot }];
    }
    const drop = 1 - price / this.ltmPeak;
    if (this.inBear || drop < PANIC_DRAWDOWN) return [];
    const stocks = round2(this.positions(day).filter((p) => p.id !== "BOND").reduce((t, p) => t + p.value, 0));
    if (stocks <= 0) return [];
    this.inBear = true;
    return [{ type: "bear_market", day, drop, stocks }];
  }
```

Replace `needsDecision`:

```ts
  /** Events that pause time for a decision in the desk. */
  needsDecision(events: LifeEvent[]): boolean {
    return events.some((e) => e.type === "cannot_cover" || e.type === "bankruptcy_eligible" || e.type === "bear_market");
  }
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd game && npm test && npx tsc --noEmit`
Expected: PASS, 90 tests; `tsc` prints nothing. If `tsc` flags `onLifeEvents`'s switch in `debt-demo/main.ts`, it is only the `default` branch and needs no change until Task 5.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/twins.test.ts
git commit -m "PlayerLife: bear-market and recovery events on LTM's 20% line"
```

---

### Task 4: Chart lines with labels

**Files:**
- Modify: `game/src/debt-demo/chart.ts:12-82`
- Modify: `game/src/debt-demo/desk.css` (after `.bc-ghost`)
- Modify: `game/src/debt-demo/main.ts` (`ChartSpec`, `wireChart`, `debtPage`)

- [ ] **Step 1: Replace `ghost` with `lines` and add `zero` in `chart.ts`**

In `BigChartOpts`, replace the `ghost` field:

```ts
  /** Extra comparison lines, drawn under the main line and labeled at their right end. */
  lines?: { pts: ChartPt[]; cls: string; label?: string }[];
  /** Include $0 in the range (money charts start at zero, research/12). */
  zero?: boolean;
```

In `mountBigChart`, replace everything from `const all = ...` through the `el.innerHTML = ...` assignment with:

```ts
  const extra = (o.lines ?? []).filter((l) => l.pts.length > 1);
  const all = o.pts.concat(...extra.map((l) => l.pts));
  if (o.pts.length < 2) {
    // A day-0 run has one snapshot; show a flat line instead of an empty box.
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="bc-line" vector-effect="non-scaling-stroke"/></svg><div class="bc-empty">Press play or skip ahead to build your history</div>`;
    el.onpointermove = el.onpointerleave = null;
    return;
  }
  const ys = all.map((p) => p.y);
  const lo = o.zero ? Math.min(0, ...ys) : Math.min(...ys);
  const hi = o.zero ? Math.max(0, ...ys) : Math.max(...ys);
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, (o.minSpan ?? 0) / 2, Math.abs(mid) * 1e-4, 1e-6);
  const x0 = Math.min(...all.map((p) => p.x));
  const x1 = Math.max(...all.map((p) => p.x));
  const X = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const Y = (y: number) => PAD + (1 - (y - (mid - half)) / (half * 2)) * (H - PAD * 2);
  const path = (arr: ChartPt[]) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const base = o.baseline === false ? "" : `<line x1="0" x2="${W}" y1="${Y(o.pts[0].y).toFixed(1)}" y2="${Y(o.pts[0].y).toFixed(1)}" class="bc-base" vector-effect="non-scaling-stroke"/>`;
  const extraPaths = extra.map((l) => `<path d="${path(l.pts)}" class="${l.cls}" vector-effect="non-scaling-stroke"/>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chart">
      ${base}${extraPaths}<path d="${path(o.pts)}" class="bc-line" vector-effect="non-scaling-stroke"/>
      <line class="bc-cursor" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke" visibility="hidden"/>
    </svg>${tagsHtml(extra, Y)}<div class="bc-when" hidden></div><span class="bc-dot" hidden></span>`;
```

Add below `mountBigChart`:

```ts
/** Direct labels at each extra line's right end, nudged apart so they never overlap. */
function tagsHtml(lines: { pts: ChartPt[]; label?: string }[], Y: (y: number) => number): string {
  const MIN_GAP = 16;
  const tags = lines
    .filter((l) => l.label)
    .map((l) => ({ label: l.label!, y: Y(l.pts[l.pts.length - 1].y) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < tags.length; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + MIN_GAP);
  return tags.map((t) => `<span class="bc-tag" style="top:${((t.y / H) * 100).toFixed(2)}%">${t.label}</span>`).join("");
}
```

- [ ] **Step 2: Add the line and tag styles to `desk.css`**

Directly after the `.bc-ghost { ... }` block:

```css
.bc-held {
  fill: none;
  stroke: #8a8f98;
  stroke-width: 2;
  stroke-dasharray: 7 5;
}
.bc-auto {
  fill: none;
  stroke: #8a8f98;
  stroke-width: 2.5;
  stroke-dasharray: 0.5 6;
  stroke-linecap: round;
}
.bc-tag {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  padding: 0 6px;
  font-size: 12px;
  color: var(--sub);
  background: var(--bg);
  border-radius: 999px;
  pointer-events: none;
  white-space: nowrap;
}
```

- [ ] **Step 3: Move the desk onto `lines`**

In `game/src/debt-demo/main.ts`, in `interface ChartSpec`, replace `ghost?: ChartPt[];` with:

```ts
  lines?: { pts: ChartPt[]; cls: string; label?: string }[];
  zero?: boolean;
```

In `wireChart`, replace `ghost: c.ghost,` with:

```ts
    lines: c.lines,
    zero: c.zero,
```

In `debtPage`, replace `ghost: s === "minimums" ? undefined : mins,` with:

```ts
          lines: s === "minimums" ? undefined : [{ pts: mins, cls: "bc-ghost", label: "Minimums only" }],
```

- [ ] **Step 4: Typecheck and test**

Run: `cd game && npx tsc --noEmit && npm test`
Expected: `tsc` prints nothing; 90 tests pass.

- [ ] **Step 5: Commit**

```bash
git add game/src/debt-demo/chart.ts game/src/debt-demo/desk.css game/src/debt-demo/main.ts
git commit -m "Chart: labeled comparison lines and a zero-based range"
```

---

### Task 5: Investing page, crash popup, recovery and concentration cards

**Files:**
- Modify: `game/src/debt-demo/main.ts`

- [ ] **Step 1: Add state next to the other `let` declarations (after `let shopShown = false;`)**

```ts
/** The last bear market and what the player chose, for the recovery card and the recap. */
let crash: { day: number; drop: number; choice: string } | null = null;
/** The last recovery: how the three lines came through. */
let recovery: { day: number; you: number; held: number; autopilot: number } | null = null;
/** Gemini's lesson for the last recovery, when the server has one. */
let recap: { headline: string; lesson: string } | null = null;
```

- [ ] **Step 2: Handle the new events in `onLifeEvents`, before `default:`**

```ts
      case "bear_market":
        log(e.day, `Stocks are down ${pctOf(e.drop, 0)} from their high`, "down");
        if (!decision) askBearMarket(e.day, e.drop, e.stocks);
        break;
      case "market_recovered":
        log(e.day, "Stocks are back at their high", "up");
        recovery = { day: e.day, you: e.you, held: e.held, autopilot: e.autopilot };
        recap = null;
        break;
```

- [ ] **Step 3: Add the decision after `askBankruptcy`**

```ts
function askBearMarket(day: number, drop: number, stocks: number) {
  const spare = Math.floor(Math.max(0, life.ledger.get("checking").balance - life.monthlyExpenses()));
  const more = Math.min(500, spare);
  const choose = (choice: string) => {
    crash = { day, drop, choice };
    log(clock.day, `In the crash, you ${choice}`, "flat");
  };
  const sellStocks = (share: 1 | 0.5) => {
    for (const id of ["LTM", "NNST"] as InstrumentId[]) {
      const pos = life.position(id);
      if (pos) life.sell(id, share === 1 ? "all" : pos.value * share);
    }
  };
  const options: Decision["options"] = [
    { label: "Sell everything", lesson: "Locks in the loss. The best days usually come right after the worst.", act: () => (sellStocks(1), choose("sold everything")) },
    { label: "Sell half", lesson: "Halves the pain and halves the rebound.", act: () => (sellStocks(0.5), choose("sold half")) },
    { label: "Hold", lesson: "Every US bear market has recovered, and holders get the whole rebound.", good: true, act: () => choose("held") },
  ];
  if (more >= 1)
    options.push({
      label: `Buy ${usd(more)} more`,
      lesson: "Stocks are on sale. It works if you won't need this money for years.",
      act: () => {
        life.buy("LTM", more);
        choose(`bought ${usd(more)} more`);
      },
    });
  openDecision({ title: `Stocks are down ${pctOf(drop, 0)} from their high`, body: `Your stocks are worth ${usd(stocks)} now. This is a bear market. What do you do?`, options });
}
```

- [ ] **Step 4: Add the twins chart and cards after `open0`**

```ts
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
  const at = (pts: ChartPt[], x: number) => (pts.find((q) => q.x === x) ?? pts[pts.length - 1]).y;
  const base = spec.change;
  spec.change = (p, scrub) => `${base(p, scrub)} <span class="when">· held ${usd(at(held, p.x))} · autopilot ${usd(at(auto, p.x))}</span>`;
  return spec;
}

function recoveryCard(): string {
  if (!recovery || clock.day - recovery.day > 365) return "";
  const gap = recovery.held - recovery.you;
  const body =
    gap > 1
      ? `Selling cost you ${usd(gap)}. Holding would be worth ${usd(recovery.held)}; you have ${usd(recovery.you)}.`
      : gap < -1
        ? `You came out ${usd(-gap)} ahead of holding. Most sellers don't: the rebound usually comes fast.`
        : "You held, so you got the whole rebound.";
  return nextCard(recap ? esc(recap.headline) : "Stocks are back at their high", `${body}${recap ? ` ${esc(recap.lesson)}` : ""}`);
}

function concentrationCard(): string {
  const positions = life.positions();
  const total = positions.reduce((s, p) => s + p.value, 0);
  const nnst = life.position("NNST")?.value ?? 0;
  if (total <= 0 || nnst / total <= 0.2) return "";
  return nextCard(`NeuralNest is ${pctOf(nnst / total, 0)} of your investments`, "One company can fall 80%. A fund spreads the risk across hundreds.");
}
```

- [ ] **Step 5: Use them in `investingPage`**

Replace:

```ts
  const chart = invested
    ? histChart(hist("investments"), (y) => usd(y, 2))
    : histChart(priceSeries("SP500"), (y) => num(y, 2), {});
```

with:

```ts
  const chart = invested ? twinsChart() : histChart(priceSeries("SP500"), (y) => num(y, 2), {});
```

In the template, change the eyebrow to `heroHtml(invested ? "Investing · you vs if you had held" : "Stock market · S&amp;P 500")` and insert `${recoveryCard()}${concentrationCard()}` directly after `${rangesHtml()}`.

- [ ] **Step 6: Typecheck and test**

Run: `cd game && npx tsc --noEmit && npm test`
Expected: `tsc` prints nothing; 90 tests pass.

- [ ] **Step 7: Commit**

```bash
git add game/src/debt-demo/main.ts
git commit -m "Money desk: three-line investing chart, crash decision, recovery and concentration cards"
```

---

### Task 6: Server columns, schema, and upsert

**Files:**
- Modify: `server/src/migrations.sql`
- Modify: `server/src/routes/snapshot.ts`
- Test: `server/src/routes/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

In `server/src/routes/snapshot.test.ts`, change the import to `import { dayToTimestamp, snapshotEntry } from "./snapshot.js";`, then append:

```ts
const row = { day: 3, netWorth: 1, checking: 1, savings: 1, brokerage: 1, retirement: 0, debt: 0 };

test("snapshot rows may carry you, held, and autopilot", () => {
  assert.equal(snapshotEntry.safeParse(row).success, true);
  assert.equal(snapshotEntry.safeParse({ ...row, you: 5, held: 6, autopilot: 7 }).success, true);
});

test("snapshot rows reject non-finite line values", () => {
  assert.equal(snapshotEntry.safeParse({ ...row, held: Infinity }).success, false);
  assert.equal(snapshotEntry.safeParse({ ...row, you: "5" }).success, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL, `snapshotEntry` is not exported.

- [ ] **Step 3: Implement**

Append to `server/src/migrations.sql`:

```sql
-- Investing twins (docs/superpowers/specs/2026-09-12-investing-twins-design.md).
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS you double precision;
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS held double precision;
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS autopilot double precision;
```

In `server/src/routes/snapshot.ts`, export the entry schema and add the fields:

```ts
export const snapshotEntry = z.object({
  day: z.number().int().min(0).max(100_000),
  netWorth: z.number().finite(),
  checking: z.number().finite(),
  savings: z.number().finite(),
  brokerage: z.number().finite(),
  retirement: z.number().finite(),
  debt: z.number().finite(),
  you: z.number().finite().optional(),
  held: z.number().finite().optional(),
  autopilot: z.number().finite().optional(),
});
```

Replace the insert query and its parameters in `POST /snapshot`:

```ts
    await pool.query(
      `INSERT INTO player_snapshots (ts, run_id, day, net_worth, checking, savings, brokerage, retirement, debt, you, held, autopilot)
       SELECT '2000-01-01'::timestamptz + d * interval '1 day', $1, d, nw, ch, sv, br, rt, dt, yo, hd, ap
       FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[],
                   $9::float8[], $10::float8[], $11::float8[])
         AS t(d, nw, ch, sv, br, rt, dt, yo, hd, ap)
       ON CONFLICT (run_id, ts) DO UPDATE SET
         net_worth = EXCLUDED.net_worth, checking = EXCLUDED.checking, savings = EXCLUDED.savings,
         brokerage = EXCLUDED.brokerage, retirement = EXCLUDED.retirement, debt = EXCLUDED.debt,
         you = EXCLUDED.you, held = EXCLUDED.held, autopilot = EXCLUDED.autopilot`,
      [
        runId,
        entries.map((e) => e.day),
        entries.map((e) => e.netWorth),
        entries.map((e) => e.checking),
        entries.map((e) => e.savings),
        entries.map((e) => e.brokerage),
        entries.map((e) => e.retirement),
        entries.map((e) => e.debt),
        entries.map((e) => e.you ?? null),
        entries.map((e) => e.held ?? null),
        entries.map((e) => e.autopilot ?? null),
      ],
    );
```

In `GET /history/:runId`, select the new columns:

```ts
    `SELECT day, net_worth, checking, savings, brokerage, retirement, debt, you, held, autopilot
     FROM player_snapshots WHERE run_id = $1 ORDER BY day ASC`,
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd server && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: 27 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/src/migrations.sql server/src/routes/snapshot.ts server/src/routes/snapshot.test.ts
git commit -m "Server: you, held, and autopilot snapshot columns; resent days overwrite"
```

---

### Task 7: Gemini crash recap

**Files:**
- Modify: `server/src/adapters/gemini.ts`
- Modify: `server/src/routes/ai.ts`
- Test: `server/src/adapters/gemini.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/src/adapters/gemini.test.ts` (and add `generateCrashRecap, recapPrompt` to its import):

```ts
const facts = { drop: 0.27, choice: "sold everything", you: 800, held: 1400, autopilot: 1300, months: 20 };

test("generateCrashRecap asks for a schema'd JSON reply and parses it", async () => {
  let body: any;
  // Parameters are typed by mock.method from fetch's own signature.
  mock.method(globalThis, "fetch", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    const reply = { headline: "Selling cost you $600", lesson: "Holding through the drop got the rebound.", mood: "console" };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 });
  });
  const recap = await generateCrashRecap(facts);
  assert.equal(recap.mood, "console");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema.required, ["headline", "lesson", "mood"]);
});

test("generateCrashRecap rejects a reply outside the schema", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"headline":"x"}' }] } }] }), { status: 200 }));
  await assert.rejects(() => generateCrashRecap(facts));
});

test("the recap prompt carries the facts in plain dollars", () => {
  const p = recapPrompt(facts);
  assert.match(p, /27%/);
  assert.match(p, /sold everything/);
  assert.match(p, /\$1,400/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL, `generateCrashRecap` is not exported.

- [ ] **Step 3: Implement the adapter**

Append to `server/src/adapters/gemini.ts` (add `import { z } from "zod";` at the top):

```ts
export interface CrashFacts {
  /** How far stocks fell from their high (0.27 = 27%). */
  drop: number;
  /** What the player did, in words ("sold everything", "held"). */
  choice: string;
  /** The player's investing line, if they had held, and autopilot, at the recovery. */
  you: number;
  held: number;
  autopilot: number;
  /** Months from the crash to the recovery. */
  months: number;
}

const recapSchema = z.object({
  headline: z.string().min(1).max(120),
  lesson: z.string().min(1).max(400),
  mood: z.enum(["cheer", "warn", "console"]),
});
export type Recap = z.infer<typeof recapSchema>;

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function recapPrompt(f: CrashFacts): string {
  return (
    `You coach players of Larp City, a personal-finance game. Stocks fell ${Math.round(f.drop * 100)}% ` +
    `and took ${f.months} months to get back to their high. In the crash the player ${f.choice}. ` +
    `Their investments are now worth ${dollars(f.you)}; if they had held they'd have ${dollars(f.held)}, ` +
    `and a 90/10 index-fund autopilot would have ${dollars(f.autopilot)}. ` +
    `Reply as JSON: a headline under 60 characters naming what their choice cost or earned in dollars, ` +
    `a two-sentence lesson in plain words for a beginner (no jargon, kind, never shaming), and a mood.`
  );
}

export async function generateCrashRecap(f: CrashFacts): Promise<Recap> {
  const result = await callGemini(env.GEMINI_TEXT_MODEL, {
    contents: [{ parts: [{ text: recapPrompt(f) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          headline: { type: "STRING" },
          lesson: { type: "STRING" },
          mood: { type: "STRING", enum: ["cheer", "warn", "console"] },
        },
        required: ["headline", "lesson", "mood"],
      },
    },
  });
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no recap text");
  return recapSchema.parse(JSON.parse(text));
}
```

- [ ] **Step 4: Add the route**

In `server/src/routes/ai.ts`, add `generateCrashRecap, type Recap` to the adapter import, then append:

```ts
const recapBody = z.object({
  drop: z.number().min(0).max(1),
  choice: z.string().min(1).max(80),
  you: z.number().finite(),
  held: z.number().finite(),
  autopilot: z.number().finite(),
  months: z.number().int().min(0).max(600),
});

// Same facts, same recap: keeps the demo inside the free tier when a crash is replayed.
const recapCache = new Map<string, Recap>();

aiRouter.post("/recap", async (req, res) => {
  const parsed = recapBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const f = parsed.data;
  const key = [Math.round(f.drop * 100), f.choice, Math.round(f.you), Math.round(f.held), Math.round(f.autopilot), f.months].join("|");
  try {
    let recap = recapCache.get(key);
    if (!recap) {
      recap = await generateCrashRecap(f);
      recapCache.set(key, recap);
    }
    res.json(recap);
  } catch (err) {
    logger.error({ err }, "gemini recap failed");
    res.status(502).json({ error: "recap_unavailable" });
  }
});
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd server && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: 30 tests pass; `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add server/src/adapters/gemini.ts server/src/adapters/gemini.test.ts server/src/routes/ai.ts
git commit -m "Server: Gemini crash recap at POST /api/recap"
```

---

### Task 8: Game-side sync and recap client

**Files:**
- Create: `game/src/net/runs.ts`
- Create: `game/tests/runs.test.ts`
- Modify: `game/src/debt-demo/main.ts`

- [ ] **Step 1: Write the failing test**

Create `game/tests/runs.test.ts`:

```ts
// RunSync tests with a fake api: lazy run creation, batching, and silent failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RunSync, type Api, type RunRow } from "../src/net/runs.ts";

const row = (day: number): RunRow => ({ day, netWorth: 1, checking: 1, savings: 0, brokerage: 0, retirement: 0, debt: 0, you: 0, held: 0, autopilot: 0 });

function fakeApi(fail = false) {
  const calls: { path: string; body: any }[] = [];
  const api: Api = async <T,>(path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (fail) throw new Error("offline");
    return (path === "/runs" ? { runId: "r1" } : path === "/recap" ? { headline: "h", lesson: "l", mood: "cheer" } : undefined) as T;
  };
  return { api, calls };
}

test("the first flush starts a run, then posts the queued rows", async () => {
  const { api, calls } = fakeApi();
  const sync = new RunSync(42, api);
  sync.queue(row(1));
  sync.queue(row(2));
  await sync.flush();
  await sync.flush();
  assert.deepEqual(calls.map((c) => c.path), ["/runs", "/snapshot"]);
  assert.deepEqual(calls[0].body, { seed: 42 });
  assert.equal(calls[1].body.runId, "r1");
  assert.deepEqual(calls[1].body.entries.map((e: RunRow) => e.day), [1, 2]);
});

test("the same day queued twice sends its latest row once", async () => {
  const { api, calls } = fakeApi();
  const sync = new RunSync(1, api);
  sync.queue(row(5));
  sync.queue({ ...row(5), you: 9 });
  await sync.flush();
  assert.deepEqual(calls[1].body.entries, [{ ...row(5), you: 9 }]);
});

test("an offline server drops the batch and never throws", async () => {
  const { api } = fakeApi(true);
  const sync = new RunSync(1, api);
  sync.queue(row(1));
  await sync.flush();
  assert.equal(await sync.recap({ drop: 0.2, choice: "held", you: 1, held: 1, autopilot: 1, months: 3 }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/runs.test.ts`
Expected: FAIL, cannot find `../src/net/runs.ts`.

- [ ] **Step 3: Implement `game/src/net/runs.ts`**

```ts
// Sends the run's daily rows to the server (Tiger Data via /api/snapshot) and
// asks it for the Gemini crash recap. The sim in the browser is the source of
// truth, so every call here is fire-and-forget: an offline or failing server
// drops the batch and the game carries on.

import { apiFetch } from "./api.ts";

export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

/** One day of the run, in the server's /api/snapshot entry shape. */
export interface RunRow {
  day: number;
  netWorth: number;
  checking: number;
  savings: number;
  brokerage: number;
  retirement: number;
  debt: number;
  you: number;
  held: number;
  autopilot: number;
}

export interface RecapFacts {
  drop: number;
  choice: string;
  you: number;
  held: number;
  autopilot: number;
  months: number;
}

export interface Recap {
  headline: string;
  lesson: string;
  mood: "cheer" | "warn" | "console";
}

/** The server's limit on one /api/snapshot request. */
const MAX_BATCH = 5_000;

export class RunSync {
  private readonly seed: number;
  private readonly api: Api;
  private readonly rows = new Map<number, RunRow>();
  private runId: Promise<string | null> | null = null;
  private busy: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(seed: number, api: Api = apiFetch) {
    this.seed = seed;
    this.api = api;
  }

  /** Queues a day's row; a later row for the same day replaces it. */
  queue(row: RunRow): void {
    this.rows.set(row.day, row);
  }

  /** Posts what's queued. Flushes run one at a time, so rows keep their order. */
  flush(): Promise<void> {
    this.busy = this.busy.then(() => this.send());
    return this.busy;
  }

  /** Gemini's lesson for a recovery, or null when the server can't give one. */
  async recap(facts: RecapFacts): Promise<Recap | null> {
    try {
      return await this.api<Recap>("/recap", { method: "POST", body: JSON.stringify(facts) });
    } catch (e) {
      this.warn(e);
      return null;
    }
  }

  private async send(): Promise<void> {
    if (!this.rows.size) return;
    const entries = [...this.rows.values()].sort((a, b) => a.day - b.day).slice(-MAX_BATCH);
    this.rows.clear();
    const runId = await this.run();
    if (!runId) return;
    try {
      await this.api("/snapshot", { method: "POST", body: JSON.stringify({ runId, entries }) });
    } catch (e) {
      this.warn(e);
    }
  }

  private run(): Promise<string | null> {
    this.runId ??= this.api<{ runId: string }>("/runs", { method: "POST", body: JSON.stringify({ seed: this.seed }) })
      .then((r) => r.runId)
      .catch((e) => {
        this.warn(e);
        // Try again on a later flush; the server may just be starting.
        this.runId = null;
        return null;
      });
    return this.runId;
  }

  private warn(e: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn("Larp City server unavailable; the run is not being saved.", e);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `cd game && node --test tests/runs.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into the desk**

In `game/src/debt-demo/main.ts`, add the import:

```ts
import { RunSync, type RunRow } from "../net/runs.ts";
```

After `let life = host ? host.life() : makeLife();`:

```ts
let sync = new RunSync(market.seed);
```

Add after `ctxNow`:

```ts
function rowNow(): RunRow {
  const s = life.history[life.history.length - 1];
  const bal = (id: string) => life.ledger.accounts.get(id)?.balance ?? 0;
  return {
    day: s.day,
    netWorth: s.netWorth,
    checking: bal("checking"),
    savings: bal("savings") + bal("emergency"),
    brokerage: s.brokerage,
    retirement: bal("k401") + bal("roth_ira"),
    debt: s.debt,
    you: s.you,
    held: s.held,
    autopilot: s.autopilot,
  };
}

function askRecap(r: { day: number; you: number; held: number; autopilot: number }) {
  if (!crash) return;
  const facts = { drop: crash.drop, choice: crash.choice, you: r.you, held: r.held, autopilot: r.autopilot, months: Math.max(0, Math.round((r.day - crash.day) / 30.44)) };
  void sync.recap(facts).then((got) => {
    // A newer recovery may have replaced this one while the request was out.
    if (got && recovery?.day === r.day) {
      recap = { headline: got.headline, lesson: got.lesson };
      scheduleRender();
    }
  });
}
```

In `onLifeEvents`, before the `for` loop:

```ts
  if (life.today >= 0) sync.queue(rowNow());
  if (life.today >= 0 && dateOf(life.today).getDate() === 1) void sync.flush();
```

In the `market_recovered` case from Task 5, after `recap = null;`:

```ts
        askRecap(recovery);
```

In `skip`, after `clock.skipping = false;`:

```ts
  void sync.flush();
```

In the `reset` case, after `life = makeLife();`:

```ts
      sync = new RunSync(market.seed);
      crash = recovery = recap = null;
```

- [ ] **Step 6: Typecheck and test**

Run: `cd game && npx tsc --noEmit && npm test`
Expected: `tsc` prints nothing; 93 tests pass.

- [ ] **Step 7: Commit**

```bash
git add game/src/net/runs.ts game/tests/runs.test.ts game/src/debt-demo/main.ts
git commit -m "Money desk: save the run's rows and ask for the crash recap"
```

---

### Task 9: End-to-end verification in the browser

**Files:** none unless a bug turns up (fix it with a failing test first).

- [ ] **Step 1: Give the worktree the keys without copying them**

```bash
ln -s "../../.env" .env
printf 'VITE_API_BASE_URL=http://localhost:3000\n' > game/.env.local
```

`.env` and `.env.local` are gitignored; confirm with `git status --short` showing neither.

- [ ] **Step 2: Start both servers in the background**

```bash
cd server && npm run dev    # background; expect "larp-city server listening" and "server migrations applied"
cd game && npx vite --port 5173 --strictPort    # background
```

If 3000 or 5173 is taken by the other terminal's servers, stop and ask before killing anything; use `PORT=3001` and matching `CORS_ORIGIN`/`VITE_API_BASE_URL` instead.

- [ ] **Step 3: Drive the desk**

Open `http://localhost:5173/debt.html` with Claude in Chrome.
Buy $1,000 of LTM on the Investing tab (after a +1M skip so checking has cash).
Skip ahead with +1Y until the AI Bubble Pop (Sep 2028): the "Stocks are down N%" sheet must pause time.
Choose "Sell everything"; confirm the chart shows three labeled lines, You flat and Held below it.
Skip until the recovery card appears; confirm it reads "Selling cost you $X" and, if Gemini answers, the headline and lesson replace the fallback title.
Buy NNST until it's over 20% of the portfolio and confirm the concentration card.
Screenshot each state and check the layout: labels not overlapping, nothing clipped, both themes readable.

- [ ] **Step 4: Confirm rows reached Tiger Data**

```bash
psql "$(grep ^DATABASE_URL= ../../.env | cut -d= -f2-)" -c "select run_id, count(*), max(day), max(held) from player_snapshots where held is not null group by run_id order by 2 desc limit 3;"
```

Expected: one run with a row per simulated day and non-null `held`.

- [ ] **Step 5: Final checks and commit any fixes**

Run: `cd game && npm test && npx tsc --noEmit && cd ../server && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: all green.
Stop both background servers and close the browser tab.
