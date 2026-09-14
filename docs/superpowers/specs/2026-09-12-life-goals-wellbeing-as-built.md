# Life Goals & Wellbeing Score — Design Spec

Date: 2026-09-12
Branch: `GameEngine`
Status: Implemented with subagent development and integration review. See [engine contracts, validation and remaining model assumptions](../../life-goals-wellbeing.md). The original plan below is retained as the design record.

## Problem

Larp City has two pieces of a goal-and-scoring system today, and they've never been connected. `game/src/sim/skip/goals.ts` already lets a player pick a fast-forward destination (`debt_free`, `emergency_fund`, `net_worth`, `house`) — but every one of them is purely financial. Separately, `research/09-wellbeing-meter.md` is a fully cited, ready-to-build design for a wellbeing meter (nine weighted factors plus decaying event pulses), and the team's own locked-in decision (`docs/meetings/2026-09-11-game-design.md`, "Scoring and win condition") is that **the final score is retirement readiness plus a wellbeing meter that includes marital status and relationships** — but zero code exists for any of it (`grep -rli wellbeing game/src` returns nothing). A player today cannot set a life goal like "get married" or "reach a career level," and there is no score to check progress against, even though both pieces were already designed for exactly this.

The ask: let a player set life goals (marriage, life savings, a career/income status) alongside the existing financial goals, and give them a real, always-checkable score built from research/09's wellbeing meter and retirement readiness — not a new scoring system invented from scratch.

## Decisions locked in during brainstorming (2026-09-12)

- **Goal system shape:** extend the existing fast-forward `Goal` union (`sim/skip/types.ts`/`goals.ts`) rather than build a separate always-on checklist. New goals reuse the setup screen, the price-tag text, and the progress bar every existing goal already has.
- **"Life savings" is not a new goal kind.** It's the existing `net_worth` goal with friendlier setup-screen copy ("Build your life savings" instead of "Reach a net worth") — a player asking for a savings goal and a player asking for a net-worth target want the same math.
- **"Status" means career/income tier**, not a wellbeing-score tier or a lifestyle tier. It reuses `grossAnnual` (already on `PlayerLife`) and lines up with `research/11-jobs-and-salary-progression.md`'s career levels, so it has somewhere to grow into once that system lands.
- **Marriage needs minimal new sim state, not the full life-event engine.** `PlayerLife` has no relationship field at all today, and `research/09`'s own implementation notes and the News Progression Engine spec (`docs/superpowers/specs/2026-09-12-news-progression-engine-design.md`) both deliberately deferred the random event/rate engine that would generate marriage, divorce, kids, and layoffs. This slice adds just enough — a `relationship` field and a small seeded chance of marriage while single — to make "get married" a real, reachable goal and to feed the wellbeing meter's Relationships factor. Divorce, kids, and layoff-as-a-random-event stay out of scope: no goal needs them, and the wellbeing meter degrades gracefully (zero pulses) if they never fire.
- **The wellbeing meter is implemented exactly as `research/09` designed it**, not simplified or redesigned: the nine factors (Work 20, Cash cushion 18, Debt load 14, Real income 12, Relationships 10, Retirement on track 8, Health coverage 8, Commute 6, Home stability 4), decaying event pulses, and the cushion-softens-bad-news multiplier.
- **Retirement Readiness adopts research/09's placeholder formula as final**: `RR = 50×clamp(retirement savings / 10×salary) + 20×(credit score − 300)/550 + 15×clamp(net worth / 10×salary) + 15×(1 − clamp(debt/salary))`. Every input already exists or is already planned (retirement account balances, `grossAnnual`, `book.profile.score`, net worth, debt).
- **Final score = `0.6 × RR + 0.4 × Wlife`**, exactly the team's locked-in split, where `Wlife = 0.5 × (lifetime average of W) + 0.5 × (W today)` per research/09 §3.4.
- **The score is always live, not a one-time ending.** Larp City has no "game over" screen and no plans for one, matching the already-answered open question from `research/10` ("the score always reflects the current branch, no penalty for rewinds"). The score is a number the player can check anytime, the same way credit score and net worth already are.
- **Research/09's remaining open questions are resolved with its own recommended defaults**, not re-litigated: single sits at 0.9 (not 1.0); the CFPB national-average comparison ("Americans average 54; you are at 72") is shown next to the meter; the "relationship strain before divorce" mechanic is skipped (divorce isn't modeled this slice); health coverage is a simple flag (`insured = employed`, no marketplace) rather than a purchasable product; commute is a static default (the researched US-average one-way commute, 23 minutes) rather than derived from home/job map tiles — both flagged as approximations to revisit once those systems exist, not silently wrong numbers.

## Architecture

```
PlayerLife (game/src/sim/life/player.ts)
  + relationship: "single" | "partnered"        (new)
  + insured: boolean                             (new getter, = employed)
  + commuteMinutes: number                       (new, static default = 23)
  + reemployedDay: number | null                  (new, for the Work scar)
  + pulses: { p0: number; halfLifeDays: number; startDay: number }[]  (new)
      │
      │ onDay(): seeded once-a-year chance of marriage while single → emits
      │ new LifeEvent { type: "marriage"; day }, sets relationship = "partnered",
      │ pushes a +6/1yr pulse
      ▼
game/src/sim/wellbeing/            (new, mirrors sim/debt/'s and sim/tax/'s shape)
  types.ts        WellbeingFactor, FactorBreakdown, WellbeingSnapshot
  factors.ts       the 9 sub-score functions (s: 0..1 each), pure functions of PlayerLife
  pulses.ts        decay(pulse, today), the cushion-softening multiplier
  retirement.ts    retirementReadiness(life): number (0..100), the adopted placeholder formula
  index.ts         wellbeing(life, today): WellbeingSnapshot { W, factors: FactorBreakdown[] }
                   finalScore(life, today): { RR, Wlife, final }
      │
      ▼
LifeSnapshot (player.ts) gains a `wellbeing: number` field, computed and pushed
alongside the existing `score` (credit score — kept separate, no name collision)
      │
      ├──► sim/skip/goals.ts: two new Goal kinds read relationship/grossAnnual
      │     directly off GoalView, same isMet/priceTag pattern as the existing four
      │
      └──► UI: Money desk Score tab (factor breakdown) + Goal-reached screen
            (highlights the final score, same screen skip-setup.ts already shows)
```

### `PlayerLife` additions

- `relationship: "single" | "partnered"`, starts `"single"`.
- A seeded per-year roll in `onDay` (only while single, only once a year to keep it O(1)/year not O(1)/day): `rngFor("marriage", life-seed, year)`, probability chosen so most players partner up over a multi-decade run but never guaranteed.
- On a hit: emits `{ type: "marriage"; day }`, sets `relationship = "partnered"`, and calls a new `addPulse(+6, 365)` helper that the wellbeing module reads.
- `insured`: derived, `= this.employed` (a getter, no separate field).
- `commuteMinutes`: a constructor option defaulting to `23` (Stutzer & Frey US average, research/09 §2.6); not derived from geography this slice.
- `reemployedDay`: set by the existing `setEmployed(true, day)` when transitioning from unemployed, so the Work factor's re-employment scar (`1 − 0.5×0.5^(years since re-employed)`) has something to read.

### `game/src/sim/wellbeing/`

- `factors.ts` exports one pure function per factor (`work(life)`, `cashCushion(life)`, `debtLoad(life)`, `realIncome(life)`, `relationships(life)`, `retirementOnTrack(life)`, `healthCoverage(life)`, `commute(life)`, `homeStability(life)`), each returning `{ s: number; points: number }` so the UI's factor breakdown (name/weight/value/note) can be built directly from this array — the exact pattern the Credit tab's `WEIGHTS`-driven rows already use (`game/src/debt-demo/main.ts`'s `creditPage()`), reused rather than reinvented.
- `pulses.ts`: `decay(pulse, today) = pulse.p0 × 0.5^((today - pulse.startDay) / pulse.halfLifeDays)`, and the cushion-softening multiplier `m = 1.3 − 0.5 × cushionSubScore` applied to negative pulses only.
- `retirement.ts`: `retirementReadiness(life)` implements the adopted placeholder formula verbatim.
- `index.ts`: `wellbeing(life, today)` sums factor points plus decayed pulses, clamped 0-100; `finalScore(life, today)` combines it with `retirementReadiness` per the locked 0.6/0.4 split, tracking `Wlife` via a running average from `life.history` (the existing per-day `LifeSnapshot` array) rather than a new accumulator.

### Goal type extension (`sim/skip/types.ts`, `sim/skip/goals.ts`)

```ts
export type Goal =
  | { kind: "debt_free" }
  | { kind: "emergency_fund"; months: number }
  | { kind: "net_worth"; amount: number }
  | { kind: "house"; downPct: number }
  | { kind: "marriage" }                          // new
  | { kind: "status"; annualIncome: number };      // new
```

`GoalView` gains two fields: `relationship: "single" | "partnered"` and `grossAnnual: number` — both already computable from `PlayerLife`, no new sim math needed just to expose them.

`isMet`:
```ts
case "marriage":
  return v.relationship === "partnered";
case "status":
  return v.grossAnnual >= goal.annualIncome;
```

`priceTag`:
```ts
case "marriage":
  return v.relationship === "partnered"
    ? { text: "You're married.", progress: 1 }
    : { text: "This isn't something money buys — it happens by chance over time, like it does in real life.", progress: null };
case "status":
  return {
    text: `You're earning ${dollars(v.grossAnnual)} a year before taxes. Reach ${dollars(goal.annualIncome)}.`,
    progress: Math.max(0, Math.min(1, v.grossAnnual / goal.annualIncome)),
  };
```

The `marriage` goal's `progress: null` (like `debt_free`'s met case) is deliberate: marriage isn't a "grind toward it" goal the way net worth is, so the setup and preview screens should not imply a savings-style ramp toward it.

## UI

- `game/src/ui/skip-setup.ts`: add two entries to the `GOALS` array (💍 "Get married", 📈 "Reach a career level"), a `goal()`/`goalCard()` switch case each (matching the existing four), and one new input (the target annual income, a slider/number field like the existing `amount`/`downPct` inputs) shown only for the `status` goal.
- `game/src/debt-demo/main.ts` (Money desk): a new **Score** tab, added to the `Tab` union and `TABS` list, laid out exactly like the existing Credit tab — a hero number (the final score), then a factor-breakdown list built straight from `wellbeing().factors` (name, weight, value, one-line note per factor, same shape as the Credit tab's `WEIGHTS`-driven rows), plus a line comparing the wellbeing sub-score to the CFPB's cited national average (54).
- The fast-forward "Goal reached!" screen (`skip-setup.ts`, existing) shows the final score alongside its existing summary when the completed goal is `marriage`, `status`, or `net_worth`, using the same `finalScore()` call the Score tab uses — one function, two call sites.

## Efficiency, reputability, security, and scope guardrails

- **Efficient:** every wellbeing factor is O(1) arithmetic on state `PlayerLife` already tracks or trivially derives; the marriage roll is O(1) per simulated year, not per day, so a 40-year fast-forward isn't slowed by it any more than the existing debt/tax math slows it today.
- **Reputable:** every factor and the RR formula are the exact numbers research/09 cites and derives from published data (CFPB, Fed SHED, Luhmann et al., Fidelity's savings-multiple guideline) — nothing invented for this slice beyond the two new Goal kinds' plumbing.
- **Consistent with the sim's determinism rule:** the marriage roll uses `rngFor`/seeded hashing (`game/src/engine/rng.ts`) like every other random element in `sim/` (no `Math.random()`), so ghost runs, ghost wellbeing lines, and ghost scores replay identically.
- **Secure / no new attack surface:** no new server route, table, or client-supplied input feeds the score — every wellbeing input is either already-recorded `PlayerLife` state or a seeded roll, computed client-side, the same trust boundary the debt and tax engines already use. The new `marriage` `LifeEvent` flows through the existing `RunRecorder` → `insertEvents` path unchanged (generic `kind` string, no server change needed — verified against `server/src/routes/snapshot.ts`'s `kind: z.string().regex(/^[a-z_]{1,40}$/)`).
- **Clean and easily integrated:** `sim/wellbeing/` is a new, self-contained module (mirrors `sim/debt/` and `sim/tax/`'s already-established shape: pure functions, a barrel `index.ts`), touched only by `PlayerLife.onDay` (one new block) and `LifeSnapshot` (one new field) in the existing large file — no restructuring of `player.ts`'s existing responsibilities.

## Explicitly out of scope for this slice

- Divorce, kids, and layoff as random/generated events — no goal in this slice needs them, and research/09's meter is designed to degrade gracefully (zero pulses, no relationship-strain state) without them.
- The full life-event/rate engine and its fast-forward interrupt integration (`research/10`'s Autopilot / Big-life-moments / Hands-on tiers) — the marriage roll here is a narrow, single-purpose addition, not that engine.
- An insurance-shopping system or a job-location/commute system — Health coverage and Commute use static/derived defaults until those systems exist, flagged in code as approximations.
- Player-adjustable wellbeing weights (research/09 §7's "OECD-style slider" stretch idea) and the "city ties" social-support stretch factor.
- Server-side score storage, history, or any leaderboard/comparison across players — the score is computed and shown client-side from the run's own recorded state, same as credit score and net worth today.
- News Progression Engine integration for the new `marriage` event — recorded now, available whenever that engine's own scoring work is extended, not wired to it now.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, always-checkable final score (`0.6 × retirement readiness + 0.4 × lifetime wellbeing`) from research/09's nine-factor wellbeing meter, and let players set two new life goals (marriage, career/income status) alongside the existing four financial fast-forward goals.

**Architecture:** A new deterministic `game/src/sim/wellbeing/` module (mirrors `sim/debt/`/`sim/tax/`'s shape: pure functions on `PlayerLife` state, a barrel `index.ts`) computes the nine factors and combines them with a lightweight `relationship`/`pulses` addition to `PlayerLife`. The existing `Goal`/`GoalView`/`isMet`/`priceTag` pattern in `sim/skip/` is extended with two new goal kinds, not replaced. Two UI touch points reuse existing patterns exactly: a Money desk Score tab (mirrors the Credit tab's `WEIGHTS`-driven factor rows) and two new setup-screen entries (mirrors the existing four).

**Tech Stack:** TypeScript, Node's built-in test runner (`node --test`, types stripped natively — no ts-node/jest), no new npm dependencies.

## Global Constraints

- `sim/` stays deterministic — no `Math.random()`, no `Date.now()`. The marriage roll uses `rngFor(...)` from `game/src/engine/rng.ts`, exactly like every other seeded element in the sim.
- Money amounts and scores are rounded to 1 decimal place for scores (`W`, `RR`, `final`) and to cents for dollar figures, using the existing `round2` convention seen throughout `game/src/sim/`.
- `tsc -p tsconfig.json` (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`) is the correctness gate for `game/`; run `npx tsc --noEmit -p tsconfig.json` (or `npm run build`) from `game/` before every commit touching a `.ts` file.
- Test convention: `node --test tests/<name>.test.ts` from `game/`. **Known environment bug:** `node --test tests/` (the bare directory) fails with `MODULE_NOT_FOUND` on this Node install — always run against explicit file(s) or `tests/*.test.ts`.
- No new server route, table, or migration — the wellbeing score and the new `marriage` event are computed/recorded entirely through existing client-side state and the existing generic event-recording path.
- Every wellbeing factor and the retirement-readiness formula must match research/09's cited numbers exactly (weights: Work 20, Cash cushion 18, Debt load 14, Real income 12, Relationships 10, Retirement on track 8, Health coverage 8, Commute 6, Home stability 4; pulse P0/half-life table in research/09 §3.3) — these are cited, sourced figures, not free parameters to adjust during implementation.
- Spec of record: this file (`2026-09-12-life-goals-wellbeing-as-built.md`), sections above. Research of record: `research/09-wellbeing-meter.md`.

---

## File Structure

```
game/src/sim/wellbeing/
  types.ts        WellbeingFactor name union, FactorBreakdown, WellbeingSnapshot, Pulse
  factors.ts       the 9 pure sub-score functions
  pulses.ts        decay(), the cushion-softening multiplier, PULSE_TABLE constants
  retirement.ts    retirementReadiness(life): number
  index.ts         wellbeing(life, today), finalScore(life, today)

game/src/sim/life/player.ts       (modified: relationship/pulses/insured/commuteMinutes/
                                   reemployedDay fields, marriage roll in onDay,
                                   addPulse() helper, LifeSnapshot gains `wellbeing`)
game/src/sim/skip/types.ts        (modified: Goal union +2, GoalView +2 fields)
game/src/sim/skip/goals.ts        (modified: isMet/priceTag +2 cases each)
game/src/ui/skip-setup.ts         (modified: GOALS array +2, goal()/goalCard() +2 cases,
                                   Goal-reached screen shows finalScore() for 3 goal kinds)
game/src/debt-demo/main.ts        (modified: Score tab)

game/tests/wellbeing.test.ts      (new)
game/tests/life.test.ts           (modified: relationship/pulses/wellbeing integration tests)
game/tests/skip.test.ts           (modified: 2 new goal-kind tests)
```

---

### Task 1: Wellbeing types and the pulse-decay helper

**Files:**
- Create: `game/src/sim/wellbeing/types.ts`
- Create: `game/src/sim/wellbeing/pulses.ts`
- Test: `game/tests/wellbeing.test.ts`

**Interfaces:**
- Produces: `type FactorName = "work" | "cashCushion" | "debtLoad" | "realIncome" | "relationships" | "retirementOnTrack" | "healthCoverage" | "commute" | "homeStability"`; `interface FactorBreakdown { name: FactorName; weight: number; s: number; points: number; note: string }`; `interface WellbeingSnapshot { W: number; factors: FactorBreakdown[] }`; `interface Pulse { p0: number; halfLifeDays: number; startDay: number }`; `decay(pulse: Pulse, today: number): number`; `cushionSoftening(cushionSubScore: number): number`; `PULSE_TABLE` (a named constant table of the 7 event pulses from research/09 §3.3, for later tasks to reuse instead of re-typing P0/half-life numbers).

- [ ] **Step 1: Write the failing tests**

```ts
// game/tests/wellbeing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decay, cushionSoftening, PULSE_TABLE } from "../src/sim/wellbeing/pulses.ts";

test("decay halves the pulse after exactly one half-life", () => {
  const pulse = { p0: 6, halfLifeDays: 365, startDay: 0 };
  assert.equal(decay(pulse, 365), 3);
  assert.equal(decay(pulse, 0), 6);
  assert.equal(decay(pulse, 730), 1.5);
});

test("decay never goes negative or reverses sign for a negative pulse", () => {
  const pulse = { p0: -6, halfLifeDays: 365, startDay: 0 };
  assert.equal(decay(pulse, 365), -3);
  assert.ok(decay(pulse, 10_000) < 0); // always the same sign as p0, shrinking toward 0
  assert.ok(Math.abs(decay(pulse, 10_000)) < 0.1);
});

test("cushionSoftening runs from 1.3 (no cushion) to 0.8 (full 6-month cushion)", () => {
  assert.equal(cushionSoftening(0), 1.3);
  assert.equal(cushionSoftening(1), 0.8);
  assert.equal(cushionSoftening(0.5), 1.05);
});

test("PULSE_TABLE has the 7 events from research/09 with the right sign and half-life", () => {
  assert.equal(PULSE_TABLE.marriage.p0, 6);
  assert.equal(PULSE_TABLE.marriage.halfLifeDays, 365);
  assert.equal(PULSE_TABLE.layoff.p0, -5);
  assert.equal(PULSE_TABLE.bankruptcy.p0, -6);
  assert.equal(PULSE_TABLE.bankruptcy.halfLifeDays, 730);
  assert.equal(PULSE_TABLE.retiredOnTrack.p0, 4);
  assert.equal(PULSE_TABLE.retiredOnTrack.halfLifeDays, 730);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `game/`): `node --test tests/wellbeing.test.ts`
Expected: FAIL — `pulses.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/wellbeing/types.ts
// Shared shapes for the wellbeing module (research/09-wellbeing-meter.md).
// Mirrors sim/debt/'s and sim/tax/'s shape: pure functions, no client state.

export type FactorName =
  | "work"
  | "cashCushion"
  | "debtLoad"
  | "realIncome"
  | "relationships"
  | "retirementOnTrack"
  | "healthCoverage"
  | "commute"
  | "homeStability";

export interface FactorBreakdown {
  name: FactorName;
  /** Out of 100; the 9 weights sum to 100 (research/09 §3.2). */
  weight: number;
  /** Sub-score, 0..1. */
  s: number;
  /** weight * s. */
  points: number;
  /** One-line reason, shown in the UI factor breakdown. */
  note: string;
}

export interface WellbeingSnapshot {
  /** 0..100, clamped: sum of factor points plus decayed pulses. */
  W: number;
  factors: FactorBreakdown[];
}

/** A decaying event bonus/penalty on top of the factor score (research/09 §3.3). */
export interface Pulse {
  p0: number;
  halfLifeDays: number;
  startDay: number;
}
```

```ts
// game/src/sim/wellbeing/pulses.ts
// Event pulse decay and the cushion-softens-bad-news multiplier (research/09 §3.3).
import type { Pulse } from "./types.ts";

const round1 = (x: number) => Math.round(x * 10) / 10;

/** pulse(t) = P0 * 0.5^(t / halfLife). */
export function decay(pulse: Pulse, today: number): number {
  const t = today - pulse.startDay;
  return round1(pulse.p0 * 0.5 ** (t / pulse.halfLifeDays));
}

/** m = 1.3 - 0.5 * cushionSubScore, applied to negative pulses only: 1.3 at no cushion, 0.8 at a full 6-month cushion. */
export function cushionSoftening(cushionSubScore: number): number {
  return round1(1.3 - 0.5 * cushionSubScore);
}

/** research/09 §3.3's event pulse table, P0 and half-life in days (365/730 for 1/2 years). */
export const PULSE_TABLE: Record<string, Pulse & { startDay: 0 }> = {
  marriage: { p0: 6, halfLifeDays: 365, startDay: 0 },
  firstChild: { p0: 4, halfLifeDays: 365, startDay: 0 },
  divorce: { p0: -6, halfLifeDays: 365, startDay: 0 },
  layoff: { p0: -5, halfLifeDays: 365, startDay: 0 },
  bankruptcy: { p0: -6, halfLifeDays: 730, startDay: 0 },
  retiredOnTrack: { p0: 4, halfLifeDays: 730, startDay: 0 },
  forcedRetirement: { p0: -6, halfLifeDays: 730, startDay: 0 },
};
```

(`PULSE_TABLE`'s entries carry a placeholder `startDay: 0`; callers spread `{ ...PULSE_TABLE.marriage, startDay: actualDay }` when pushing a real pulse — this keeps the table itself a pure constant.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wellbeing.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/wellbeing/types.ts game/src/sim/wellbeing/pulses.ts game/tests/wellbeing.test.ts
git commit -m "wellbeing: add pulse decay, cushion-softening, and the shared pulse table"
```

---

### Task 2: The nine wellbeing factors

**Files:**
- Create: `game/src/sim/wellbeing/factors.ts`
- Test: `game/tests/wellbeing.test.ts` (append)

**Interfaces:**
- Consumes: `PlayerLife`'s existing `employed`, `reemployedDay` (new, added in Task 4), `cash()`, `monthlyExpenses()`, `totalDebt()`, `dti()`/`minimums()`, `monthlyTakeHome`, `grossAnnual`, `place.rpp.all`, `relationship` (new, Task 4), `age`, `book.profile.score`, `insured`/`commuteMinutes` (new, Task 4), `homeTier()`.
- Produces: nine functions, each `(life: PlayerLife, day: number) => { s: number; points: number; note: string }`, named exactly `work`, `cashCushion`, `debtLoad`, `realIncome`, `relationships`, `retirementOnTrack`, `healthCoverage`, `commute`, `homeStability`. Each function's `points` is its own `weight * s`, using the weight constants below.

**This task's tests reference `PlayerLife` fields Task 4 adds (`relationship`, `insured`, `commuteMinutes`, `reemployedDay`). Since Tasks are typically implemented in order, by the time this task's tests run those fields must exist — if executing tasks out of order, do Task 4's `PlayerLife` field additions first, or stub a minimal fake object satisfying just the fields each factor function reads (each factor function should type its parameter narrowly, e.g. `Pick<PlayerLife, "employed" | "reemployedDay">`, rather than requiring a full `PlayerLife` — this also keeps each factor unit-testable without constructing a whole life).**

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/wellbeing.test.ts
import { work, cashCushion, debtLoad, realIncome, relationships, retirementOnTrack, healthCoverage, commute, homeStability } from "../src/sim/wellbeing/factors.ts";

test("work is 1.0 employed, 0 unemployed, and recovers slowly after re-employment", () => {
  const employedNow = { employed: true, reemployedDay: null };
  assert.equal(work(employedNow, 0).s, 1);
  const unemployed = { employed: false, reemployedDay: null };
  assert.equal(work(unemployed, 0).s, 0);
  // 1 year after re-employment: s = 1 - 0.5*0.5^1 = 0.75
  const reemployedOneYearAgo = { employed: true, reemployedDay: 0 };
  const s = work(reemployedOneYearAgo, 365).s;
  assert.ok(Math.abs(s - 0.75) < 0.01, `expected ~0.75, got ${s}`);
});

test("cashCushion is 0 below $400, then scales to 1 at 6 months of essentials", () => {
  const under400 = { cash: () => 200, monthlyExpenses: () => 3_000 };
  assert.equal(cashCushion(under400).s, 0);
  const threeMonths = { cash: () => 9_000, monthlyExpenses: () => 3_000 };
  assert.equal(cashCushion(threeMonths).s, 0.5);
  const sixMonthsPlus = { cash: () => 30_000, monthlyExpenses: () => 3_000 };
  assert.equal(cashCushion(sixMonthsPlus).s, 1);
});

test("debtLoad scales with DTI, halves for any past-due mark, and zeroes in collections", () => {
  const clean = { dti: () => 0, hasPastDue: () => false, inCollectionsOrRecentBankruptcy: () => false };
  assert.equal(debtLoad(clean).s, 1);
  const dti20 = { dti: () => 0.2, hasPastDue: () => false, inCollectionsOrRecentBankruptcy: () => false };
  assert.equal(debtLoad(dti20).s, 0.5); // 1 - 0.2/0.4
  const pastDue = { dti: () => 0, hasPastDue: () => true, inCollectionsOrRecentBankruptcy: () => false };
  assert.equal(debtLoad(pastDue).s, 0.5); // 1 * 0.5
  const inCollections = { dti: () => 0, hasPastDue: () => false, inCollectionsOrRecentBankruptcy: () => true };
  assert.equal(debtLoad(inCollections).s, 0);
});

test("realIncome is 0 at $25k real income and 1 at $200k real income, log scale", () => {
  const at25k = { monthlyTakeHome: 0, grossAnnual: 25_000, place: { rpp: { all: 100 } } };
  assert.equal(realIncome(at25k).s, 0);
  const at200k = { monthlyTakeHome: 0, grossAnnual: 200_000, place: { rpp: { all: 100 } } };
  assert.equal(realIncome(at200k).s, 1);
  const midpoint = { monthlyTakeHome: 0, grossAnnual: Math.sqrt(25_000 * 200_000), place: { rpp: { all: 100 } } };
  assert.ok(Math.abs(realIncome(midpoint).s - 0.5) < 0.01);
});

test("relationships is 1.0 partnered, 0.9 single", () => {
  assert.equal(relationships({ relationship: "partnered" }).s, 1.0);
  assert.equal(relationships({ relationship: "single" }).s, 0.9);
});

test("retirementOnTrack scales against the Fidelity age-multiple target", () => {
  // Age 30 target is 1x salary; exactly on target = s 1.
  const onTrackAt30 = { age: 30, grossAnnual: 60_000, retirementSavings: () => 60_000 };
  assert.equal(retirementOnTrack(onTrackAt30).s, 1);
  const halfAt30 = { age: 30, grossAnnual: 60_000, retirementSavings: () => 30_000 };
  assert.equal(retirementOnTrack(halfAt30).s, 0.5);
});

test("healthCoverage is 1.0 insured, 0.4 uninsured", () => {
  assert.equal(healthCoverage({ insured: true }).s, 1.0);
  assert.equal(healthCoverage({ insured: false }).s, 0.4);
});

test("commute clamps 1 - minutes/60, floors at 0", () => {
  assert.equal(commute({ commuteMinutes: 0 }).s, 1);
  assert.equal(commute({ commuteMinutes: 30 }).s, 0.5);
  assert.equal(commute({ commuteMinutes: 90 }).s, 0);
});

test("homeStability is 1 housed, 0 at the tent tier", () => {
  assert.equal(homeStability({ homeTier: () => 1 }).s, 1);
  assert.equal(homeStability({ homeTier: () => 0 }).s, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wellbeing.test.ts`
Expected: FAIL — `factors.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/wellbeing/factors.ts
// The nine wellbeing sub-score functions (research/09-wellbeing-meter.md §3.2).
// Each takes only the fields it needs (not a full PlayerLife) so it's testable
// in isolation and its dependency on the life is explicit and narrow.
import type { FactorBreakdown } from "./types.ts";

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export const WEIGHTS = {
  work: 20,
  cashCushion: 18,
  debtLoad: 14,
  realIncome: 12,
  relationships: 10,
  retirementOnTrack: 8,
  healthCoverage: 8,
  commute: 6,
  homeStability: 4,
} as const;

function breakdown(name: keyof typeof WEIGHTS, s: number, note: string): FactorBreakdown {
  const clamped = clamp01(s);
  return { name, weight: WEIGHTS[name], s: round1(clamped), points: round1(WEIGHTS[name] * clamped), note };
}

export function work(life: { employed: boolean; reemployedDay: number | null }, today = 0): FactorBreakdown {
  if (!life.employed) return breakdown("work", 0, "Unemployed");
  if (life.reemployedDay === null) return breakdown("work", 1, "Employed");
  const years = (today - life.reemployedDay) / 365.25;
  const s = 1 - 0.5 * 0.5 ** years;
  return breakdown("work", s, years < 3 ? "Recently back to work" : "Employed");
}

export function cashCushion(life: { cash(): number; monthlyExpenses(): number }): FactorBreakdown {
  const cash = life.cash();
  if (cash < 400) return breakdown("cashCushion", 0, "Below the $400 emergency-expense test");
  const months = life.monthlyExpenses() > 0 ? cash / life.monthlyExpenses() : 6;
  return breakdown("cashCushion", months / 6, `${round1(months)} months of expenses in cash`);
}

export function debtLoad(life: { dti(): number; hasPastDue(): boolean; inCollectionsOrRecentBankruptcy(): boolean }): FactorBreakdown {
  if (life.inCollectionsOrRecentBankruptcy()) return breakdown("debtLoad", 0, "In collections or recent bankruptcy");
  let s = clamp01(1 - life.dti() / 0.4);
  if (life.hasPastDue()) s *= 0.5;
  return breakdown("debtLoad", s, life.hasPastDue() ? "A payment is past due" : `Debt payments are ${round1(life.dti() * 100)}% of take-home`);
}

export function realIncome(life: { grossAnnual: number; place: { rpp: { all: number } } }): FactorBreakdown {
  const real = (life.grossAnnual * 100) / life.place.rpp.all;
  const s = Math.log(Math.max(1, real / 25_000)) / Math.log(8);
  return breakdown("realIncome", s, `About $${Math.round(real).toLocaleString("en-US")} in real, price-adjusted income`);
}

export function relationships(life: { relationship: "single" | "partnered" }): FactorBreakdown {
  return life.relationship === "partnered"
    ? breakdown("relationships", 1.0, "Partnered")
    : breakdown("relationships", 0.9, "Single");
}

/** Fidelity's age-based savings-multiple targets (research/09 §3.2), linearly interpolated between the named ages. */
const RETIREMENT_TARGETS: [number, number][] = [
  [30, 1], [40, 3], [50, 6], [60, 8], [67, 10],
];
function targetMultiple(age: number): number {
  if (age <= RETIREMENT_TARGETS[0][0]) return RETIREMENT_TARGETS[0][1];
  for (let i = 1; i < RETIREMENT_TARGETS.length; i++) {
    const [a1, m1] = RETIREMENT_TARGETS[i];
    if (age <= a1) {
      const [a0, m0] = RETIREMENT_TARGETS[i - 1];
      return m0 + ((m1 - m0) * (age - a0)) / (a1 - a0);
    }
  }
  return RETIREMENT_TARGETS[RETIREMENT_TARGETS.length - 1][1];
}

export function retirementOnTrack(life: { age: number; grossAnnual: number; retirementSavings(): number }): FactorBreakdown {
  const target = targetMultiple(life.age) * life.grossAnnual;
  const s = target > 0 ? life.retirementSavings() / target : 1;
  return breakdown("retirementOnTrack", s, `${round1(target > 0 ? life.retirementSavings() / life.grossAnnual : 0)}x salary saved, target ${round1(targetMultiple(life.age))}x`);
}

export function healthCoverage(life: { insured: boolean }): FactorBreakdown {
  return life.insured ? breakdown("healthCoverage", 1.0, "Insured") : breakdown("healthCoverage", 0.4, "Uninsured");
}

export function commute(life: { commuteMinutes: number }): FactorBreakdown {
  return breakdown("commute", 1 - life.commuteMinutes / 60, `${life.commuteMinutes} minute commute`);
}

export function homeStability(life: { homeTier(): number }): FactorBreakdown {
  return life.homeTier() > 0
    ? breakdown("homeStability", 1, "Housed")
    : breakdown("homeStability", 0, "No stable home");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wellbeing.test.ts`
Expected: PASS (all prior tests plus 9 new ones)

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/wellbeing/factors.ts game/tests/wellbeing.test.ts
git commit -m "wellbeing: add the nine research/09 factor sub-score functions"
```

---

### Task 3: Retirement readiness and the combined final score

**Files:**
- Create: `game/src/sim/wellbeing/retirement.ts`
- Create: `game/src/sim/wellbeing/index.ts`
- Test: `game/tests/wellbeing.test.ts` (append)

**Interfaces:**
- Consumes: the 9 factor functions and `WEIGHTS` (Task 2), `decay`/`Pulse` (Task 1).
- Produces: `retirementReadiness(life: { retirementSavings(): number; grossAnnual: number; book: { profile: { score: number } }; netWorth(): number; totalDebt(): number }): number`; `wellbeing(life: FullLifeShape, today: number): WellbeingSnapshot`; `finalScore(life: FullLifeShape, today: number): { RR: number; Wlife: number; final: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/wellbeing.test.ts
import { retirementReadiness } from "../src/sim/wellbeing/retirement.ts";

test("retirementReadiness on a simplified Alex-like scenario (5x retirement savings, credit 680, net worth 5x salary, no debt) matches hand-computed arithmetic", () => {
  // This is NOT research/09's exact worked-example RR of 58.3 — that example's net worth and
  // debt inputs (a divorce, card debt at 30% of take-home) aren't reproduced here. This test
  // isolates retirementReadiness() with simplified, independently-computed inputs instead.
  const alex = {
    retirementSavings: () => 5 * 220_000,
    grossAnnual: 220_000,
    book: { profile: { score: 680 } },
    netWorth: () => 5 * 220_000,
    totalDebt: () => 0,
  };
  const rr = retirementReadiness(alex);
  // 50*clamp(5/10) + 20*(680-300)/550 + 15*clamp(5/10) + 15*(1-0) = 25 + 13.82 + 7.5 + 15 = 61.3
  assert.ok(Math.abs(rr - 61.3) < 1, `expected close to 61.3, got ${rr}`);
});

test("retirementReadiness clamps each term at its max and never exceeds 100", () => {
  const maxedOut = {
    retirementSavings: () => 100 * 100_000,
    grossAnnual: 100_000,
    book: { profile: { score: 850 } },
    netWorth: () => 100 * 100_000,
    totalDebt: () => 0,
  };
  const rr = retirementReadiness(maxedOut);
  assert.ok(rr <= 100);
});

test("retirementReadiness is 0 with no savings, no credit history, no net worth, and debt equal to salary", () => {
  const nothing = {
    retirementSavings: () => 0,
    grossAnnual: 50_000,
    book: { profile: { score: 300 } },
    netWorth: () => 0,
    totalDebt: () => 50_000,
  };
  assert.equal(retirementReadiness(nothing), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wellbeing.test.ts`
Expected: FAIL — `retirement.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/wellbeing/retirement.ts
// The adopted placeholder retirement readiness formula (research/09 §3.4),
// final per the as-built spec's decision to adopt it as-is.
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function retirementReadiness(life: {
  retirementSavings(): number;
  grossAnnual: number;
  book: { profile: { score: number } };
  netWorth(): number;
  totalDebt(): number;
}): number {
  const salary = Math.max(1, life.grossAnnual);
  const savingsTerm = 50 * clamp01(life.retirementSavings() / (10 * salary));
  const creditTerm = 20 * clamp01((life.book.profile.score - 300) / 550);
  const netWorthTerm = 15 * clamp01(life.netWorth() / (10 * salary));
  const debtTerm = 15 * (1 - clamp01(life.totalDebt() / salary));
  return round1(savingsTerm + creditTerm + netWorthTerm + debtTerm);
}
```

```ts
// game/src/sim/wellbeing/index.ts
// wellbeing(life, today): the live 0-100 meter from the 9 factors plus decayed
// pulses. finalScore(life, today): the team's locked 0.6 RR / 0.4 Wlife split
// (research/09 §3.4), Wlife = 0.5 * lifetime average + 0.5 * today, using the
// life's own recorded history rather than a new accumulator.
import {
  work, cashCushion, debtLoad, realIncome, relationships,
  retirementOnTrack, healthCoverage, commute, homeStability,
} from "./factors.ts";
import { decay } from "./pulses.ts";
import { retirementReadiness } from "./retirement.ts";
import type { WellbeingSnapshot, Pulse } from "./types.ts";

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** The full shape wellbeing()/finalScore() need from PlayerLife (a subset — see factors.ts for the per-factor narrower types). */
export interface WellbeingLife {
  employed: boolean;
  reemployedDay: number | null;
  cash(): number;
  monthlyExpenses(): number;
  dti(): number;
  hasPastDue(): boolean;
  inCollectionsOrRecentBankruptcy(): boolean;
  grossAnnual: number;
  place: { rpp: { all: number } };
  relationship: "single" | "partnered";
  age: number;
  retirementSavings(): number;
  insured: boolean;
  commuteMinutes: number;
  homeTier(): number;
  book: { profile: { score: number } };
  netWorth(): number;
  totalDebt(): number;
  pulses: Pulse[];
  /** Per-day wellbeing values already recorded (LifeSnapshot.wellbeing), for the lifetime average. */
  history: { wellbeing: number }[];
}

export function wellbeing(life: WellbeingLife, today: number): WellbeingSnapshot {
  const factors = [
    work(life, today),
    cashCushion(life),
    debtLoad(life),
    realIncome(life),
    relationships(life),
    retirementOnTrack(life),
    healthCoverage(life),
    commute(life),
    homeStability(life),
  ];
  const base = factors.reduce((sum, f) => sum + f.points, 0);
  const cushionS = factors.find((f) => f.name === "cashCushion")!.s;
  const pulseTotal = life.pulses.reduce((sum, p) => {
    const value = decay(p, today);
    const softened = value < 0 ? value * (1.3 - 0.5 * cushionS) : value;
    return sum + softened;
  }, 0);
  const W = round1(clamp(base + pulseTotal, 0, 100));
  return { W, factors };
}

export function finalScore(life: WellbeingLife, today: number): { RR: number; Wlife: number; final: number } {
  const RR = retirementReadiness(life);
  const Wtoday = wellbeing(life, today).W;
  const history = life.history.length ? life.history : [{ wellbeing: Wtoday }];
  const lifetimeAvg = history.reduce((sum, h) => sum + h.wellbeing, 0) / history.length;
  const Wlife = round1(0.5 * lifetimeAvg + 0.5 * Wtoday);
  const final = round1(0.6 * RR + 0.4 * Wlife);
  return { RR, Wlife, final };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wellbeing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/wellbeing/retirement.ts game/src/sim/wellbeing/index.ts game/tests/wellbeing.test.ts
git commit -m "wellbeing: add retirement readiness and the combined final score"
```

---

### Task 4: `PlayerLife` additions — relationship, pulses, insured, commute, the marriage roll

**Files:**
- Modify: `game/src/sim/life/player.ts`
- Test: `game/tests/life.test.ts` (append)

**Interfaces:**
- Consumes: `rngFor` from `../../engine/rng.ts`; `PULSE_TABLE` from `../wellbeing/pulses.ts`; `wellbeing`/`finalScore` from `../wellbeing/index.ts` (Task 3).
- Produces: `PlayerLife` gains `relationship: "single" | "partnered"`, `insured: boolean` (getter), `commuteMinutes: number`, `reemployedDay: number | null`, `pulses: Pulse[]`, `addPulse(p0, halfLifeDays, day)`, `retirementSavings(): number`, `hasPastDue(): boolean`, `inCollectionsOrRecentBankruptcy(): boolean`. `LifeEvent` gains `{ type: "marriage"; day: number }`. `LifeSnapshot` gains `wellbeing: number`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/life.test.ts — reuses this file's existing TX/CA Place
// constants, dateOf()/live() helpers, and new PlayerLife({...}) pattern.
test("relationship starts single and a marriage event can change it", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.relationship, "single");
});

test("insured mirrors employed", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.insured, true); // employed by default
  life.setEmployed(false, 1);
  assert.equal(life.insured, false);
});

test("commuteMinutes defaults to 23 (research/09's US average) unless set", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.commuteMinutes, 23);
  const custom = new PlayerLife({ place: TX, day: 0, commuteMinutes: 45 });
  assert.equal(custom.commuteMinutes, 45);
});

test("reemployedDay is set when setEmployed(true) follows setEmployed(false)", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.setEmployed(false, 10);
  assert.equal(life.reemployedDay, null);
  life.setEmployed(true, 40);
  assert.equal(life.reemployedDay, 40);
});

test("addPulse pushes a pulse the wellbeing module can read", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.addPulse(6, 365, 10);
  assert.equal(life.pulses.length, 1);
  assert.deepEqual(life.pulses[0], { p0: 6, halfLifeDays: 365, startDay: 10 });
});

test("a marriage event fires eventually over many years while single, seeded (deterministic across two identical lives)", () => {
  const a = new PlayerLife({ place: TX, day: 0 });
  const b = new PlayerLife({ place: TX, day: 0 });
  const eventsA = live(a, 365 * 20); // 20 years
  const eventsB = live(b, 365 * 20);
  const marriedA = eventsA.some((e) => e.type === "marriage");
  const marriedB = eventsB.some((e) => e.type === "marriage");
  assert.equal(marriedA, marriedB); // same seed, same roll sequence, same outcome
  if (marriedA) {
    assert.equal(a.relationship, "partnered");
    assert.ok(a.pulses.length >= 1);
  }
});

test("LifeSnapshot carries a wellbeing field alongside the existing score", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  live(life, 5);
  const snap = life.snapshot(life.today);
  assert.equal(typeof snap.wellbeing, "number");
  assert.ok(snap.wellbeing >= 0 && snap.wellbeing <= 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/life.test.ts`
Expected: FAIL — `relationship`/`insured`/etc. don't exist.

- [ ] **Step 3: Write the implementation**

In `game/src/sim/life/player.ts`:

1. Add imports:

```ts
import { rngFor } from "../../engine/rng.ts";
import { PULSE_TABLE } from "../wellbeing/pulses.ts";
import { wellbeing } from "../wellbeing/index.ts";
import type { Pulse } from "../wellbeing/types.ts";
```

2. Extend `LifeOptions` (near `commuteMinutes`'s natural home, alongside `rent`/`job`):

```ts
  /** One-way commute in minutes; defaults to the US average (research/09 §2.6). */
  commuteMinutes?: number;
```

3. Extend the `LifeEvent` union:

```ts
  | { type: "marriage"; day: number }
```

4. Add fields (near the other tax-related private fields added in the tax-filing feature, or any convenient spot with the other public simple fields like `age`/`employed`):

```ts
  relationship: "single" | "partnered" = "single";
  commuteMinutes: number;
  reemployedDay: number | null = null;
  pulses: Pulse[] = [];

  /** Derived: no separate insurance-shopping system exists yet (the as-built spec), so coverage tracks employment. */
  get insured(): boolean {
    return this.employed;
  }
```

5. In the constructor, set `commuteMinutes`:

```ts
    this.commuteMinutes = o.commuteMinutes ?? 23;
```

6. Add the public helper:

```ts
  addPulse(p0: number, halfLifeDays: number, day: number): void {
    this.pulses.push({ p0, halfLifeDays, startDay: day });
  }

  /** 401(k) and Roth IRA balances — the wellbeing module's "retirement savings" input. */
  retirementSavings(): number {
    let total = 0;
    for (const a of this.ledger.accounts.values()) if (a.kind === "k401" || a.kind === "roth_ira") total += a.balance;
    return round2(total);
  }

  /** Any debt currently late (not yet in collections) — the wellbeing module's debt-load input. */
  hasPastDue(): boolean {
    return this.book.debts.some((d) => d.status === "late" || d.status === "delinquent" || d.status === "serious");
  }

  inCollectionsOrRecentBankruptcy(): boolean {
    const twoYearsAgo = this.today - 730;
    const recentBankruptcy = this.book.profile.bankruptcy && this.book.profile.bankruptcy.day > twoYearsAgo;
    return this.book.debts.some((d) => d.status === "collections") || !!recentBankruptcy;
  }
```

7. Update `setEmployed` to set `reemployedDay` on a false→true transition (read the current method first — it currently sets `this.employed` and `this.book.monthlyTakeHome` and emits a `job` event; add the `reemployedDay` assignment before reassigning `this.employed`, so the "was it previously false" check reads the old value):

```ts
  setEmployed(employed: boolean, day: number): LifeEvent {
    if (employed && !this.employed) this.reemployedDay = day;
    this.employed = employed;
    this.book.monthlyTakeHome = this.monthlyTakeHome * (employed ? 1 : UNEMPLOYMENT_SHARE);
    const e: LifeEvent = { type: "job", day, employed };
    this.emit([e]);
    return e;
  }
```

8. Add the once-a-year marriage roll to `onDay`. Add this near the `if (dom === 1) { ... }` block (a natural once-a-month location; the roll itself only actually fires once a year via the `date.getMonth() === 0` guard, keeping it O(1)/year not O(1)/day, per the design's efficiency guardrail):

```ts
    if (this.relationship === "single" && dom === 1 && date.getMonth() === 0) {
      const roll = rngFor("marriage", this.seed, date.getFullYear())();
      // Calibrated so most players partner up over a multi-decade run without it being guaranteed (research/09 §2.3, §5).
      const ANNUAL_MARRIAGE_CHANCE = 0.08;
      if (roll < ANNUAL_MARRIAGE_CHANCE) {
        this.relationship = "partnered";
        this.addPulse(PULSE_TABLE.marriage.p0, PULSE_TABLE.marriage.halfLifeDays, day);
        events.push({ type: "marriage", day });
      }
    }
```

(Check what seed value `PlayerLife` already has available for `rngFor` calls — other seeded elements in the file, e.g. the market or twins, take a seed from `this.market.seed` or a constructor option; use whatever the file's existing convention is instead of inventing a new `this.seed` field if one doesn't already exist. If no seed is available on `PlayerLife` itself, use `this.market.seed` — `MarketPath` already carries one and `PlayerLife` already holds a `market` reference.)

9. Update `snapshot(day)` to compute and include `wellbeing`:

```ts
  snapshot(day: number): LifeSnapshot {
    const cash = this.cash();
    const positions = this.positions(day);
    const investments = this.investmentsWith(positions);
    const debt = this.totalDebt();
    const brokerage = round2(positions.reduce((t, p) => t + p.value, 0));
    return {
      day,
      cash,
      investments,
      debt,
      netWorth: round2(cash + investments - debt),
      score: this.book.profile.score,
      wellbeing: wellbeing(this, day).W,
      brokerage,
      you: this.twins.you(brokerage),
      held: this.twins.held(day),
      autopilot: this.twins.autopilot(day),
    };
  }
```

Add `wellbeing: number;` to the `LifeSnapshot` interface, next to the existing `score: number;` field.

**Note on `WellbeingLife`'s shape vs. `PlayerLife`:** `wellbeing(this, day)` requires `PlayerLife` to satisfy `WellbeingLife` (Task 3) — by this point in the plan, `PlayerLife` has every field/method that interface needs (`employed`, `reemployedDay`, `cash()`, `monthlyExpenses()`, `dti()`, `hasPastDue()`, `inCollectionsOrRecentBankruptcy()`, `grossAnnual`, `place`, `relationship`, `age`, `retirementSavings()`, `insured`, `commuteMinutes`, `homeTier()`, `book`, `netWorth()`, `totalDebt()`, `pulses`, `history`) — if `tsc` reports a structural mismatch, it means one of these wasn't wired exactly as named above; fix the name to match rather than changing `WellbeingLife`'s contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/life.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full test suite and the build**

Run (from `game/`): `node --test tests/*.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: all PASS, `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/life.test.ts
git commit -m "wellbeing: wire relationship/pulses/insured/commute into PlayerLife, add the marriage roll"
```

---

### Task 5: Goal type extension — marriage and status goals

**Files:**
- Modify: `game/src/sim/skip/types.ts`
- Modify: `game/src/sim/skip/goals.ts`
- Test: `game/tests/skip.test.ts` (append)

**Interfaces:**
- Consumes: `PlayerLife.relationship`, `PlayerLife.grossAnnual` (Task 4).
- Produces: `Goal` union gains `{ kind: "marriage" }` and `{ kind: "status"; annualIncome: number }`; `GoalView` gains `relationship: "single" | "partnered"` and `grossAnnual: number`; `isMet`/`priceTag` gain matching `case` branches.

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/skip.test.ts — match this file's existing import style
// and however it already constructs a GoalView/Place for its other goal tests.
import { isMet, priceTag } from "../src/sim/skip/goals.ts";

test("the marriage goal is met once relationship is partnered", () => {
  const v = { ...baseView(), relationship: "single" as const };
  assert.equal(isMet({ kind: "marriage" }, v), false);
  const partnered = { ...v, relationship: "partnered" as const };
  assert.equal(isMet({ kind: "marriage" }, partnered), true);
});

test("the marriage goal's priceTag has progress: null while single (it isn't a savings-style ramp)", () => {
  const v = { ...baseView(), relationship: "single" as const };
  const tag = priceTag({ kind: "marriage" }, v, "Texas");
  assert.equal(tag.progress, null);
});

test("the status goal is met once grossAnnual reaches the target", () => {
  const v = { ...baseView(), grossAnnual: 60_000 };
  assert.equal(isMet({ kind: "status", annualIncome: 100_000 }, v), false);
  const raised = { ...v, grossAnnual: 100_000 };
  assert.equal(isMet({ kind: "status", annualIncome: 100_000 }, raised), true);
});

test("the status goal's priceTag progress is grossAnnual / target, clamped to 1", () => {
  const v = { ...baseView(), grossAnnual: 50_000 };
  const tag = priceTag({ kind: "status", annualIncome: 100_000 }, v, "Texas");
  assert.equal(tag.progress, 0.5);
  const over = { ...baseView(), grossAnnual: 150_000 };
  const tagOver = priceTag({ kind: "status", annualIncome: 100_000 }, over, "Texas");
  assert.equal(tagOver.progress, 1);
});
```

(`baseView()` is a placeholder for whatever helper `game/tests/skip.test.ts` already uses to build a minimal `GoalView` for its existing four goal-kind tests — read the file first and reuse that exact helper/pattern instead of inventing a new one; if no such helper exists yet, build the object literal inline the same way the file's existing tests already do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/skip.test.ts`
Expected: FAIL — `Goal` has no `"marriage"`/`"status"` variant, `GoalView` has no `relationship`/`grossAnnual`.

- [ ] **Step 3: Write the implementation**

In `game/src/sim/skip/types.ts`, extend `Goal`:

```ts
export type Goal =
  | { kind: "debt_free" }
  | { kind: "emergency_fund"; months: number }
  | { kind: "net_worth"; amount: number }
  | { kind: "house"; downPct: number }
  | { kind: "marriage" }
  | { kind: "status"; annualIncome: number };
```

Extend `GoalView`:

```ts
export interface GoalView {
  cash: number;
  emergency: number;
  brokerage: number;
  retirement: number;
  debt: number;
  minimums: number;
  monthlyExpenses: number;
  monthlyGross: number;
  homePrice: number;
  relationship: "single" | "partnered";
  grossAnnual: number;
}
```

In `game/src/sim/skip/goals.ts`, extend `isMet`:

```ts
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
```

Extend `priceTag`:

```ts
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
        text: `You're earning ${dollars(v.grossAnnual)} a year before taxes. Reach ${dollars(goal.annualIncome)}.`,
        progress: Math.max(0, Math.min(1, v.grossAnnual / goal.annualIncome)),
      };
  }
}
```

Update `viewOf` to populate the two new fields:

```ts
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
  return v;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/skip.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build**

Run (from `game/`): `node --test tests/*.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, clean. (`viewOf`'s expanded return object must still satisfy every existing caller of `GoalView` — `tsc` will catch any place constructing a `GoalView` object literal directly instead of through `viewOf` that's now missing the two new fields; if `tsc` flags one, add the two fields there too rather than loosening the type.)

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/skip/types.ts game/src/sim/skip/goals.ts game/tests/skip.test.ts
git commit -m "wellbeing: add marriage and status goal kinds"
```

---

### Task 6: Setup screen — two new goal entries

**Files:**
- Modify: `game/src/ui/skip-setup.ts`

**Interfaces:**
- Consumes: `Goal` (Task 5).

- [ ] **Step 1: Read the current file first**

Read `game/src/ui/skip-setup.ts`'s `GOALS` array (find it, e.g. line ~42: `{ kind: "debt_free", icon: "💳", title: "Become debt-free" }`), whatever `goal()`/`goalCard()` switch handles per-kind setup UI (search for `kind: "debt_free"` and `kind: "house"` to find both the array and the switch case(s) building the returned `Goal` object, e.g. around line 233/239: `return { kind: "debt_free" };` / `return { kind: "house", downPct: this.downPct };`), and how the existing `house` goal's extra input (`downPct`) is rendered (a slider/number field pattern to copy for the status goal's `annualIncome` input). Confirm exact structure before editing — line numbers in this task description are approximate pointers from when this plan was written, not guaranteed current.

- [ ] **Step 2: Add the two GOALS entries**

```ts
  { kind: "marriage", icon: "💍", title: "Get married" },
  { kind: "status", icon: "📈", title: "Reach a career level" },
```

- [ ] **Step 3: Add the two switch cases** that build the final `Goal` object when the player confirms setup (matching the existing `debt_free`/`house` pattern found in Step 1):

```ts
case "marriage":
  return { kind: "marriage" };
case "status":
  return { kind: "status", annualIncome: this.targetIncome };
```

(`this.targetIncome` is a new instance field on whatever setup-screen class/object holds `this.downPct` today — add it alongside `downPct`, defaulting to a reasonable starting value, e.g. `100_000`, following the exact pattern `downPct` already uses for its own default/initialization.)

- [ ] **Step 4: Add the status goal's income input**

Find where the `house` goal's `downPct` input is rendered (a slider or number field shown only when the selected goal kind is `house`) and add an analogous input shown only when the selected kind is `status`, binding to `this.targetIncome` the same way the existing input binds to `this.downPct`. Match the existing input's exact markup/event-handling pattern (don't invent a new input style).

- [ ] **Step 5: Verify**

Run (from `game/`): `npx tsc --noEmit -p tsconfig.json`
Expected: clean. (This file has no dedicated unit tests per the project's UI convention — verified by `tsc` plus manual `npm run dev` QA; if you have a display available, open the fast-forward setup screen and confirm both new goal cards appear and the status income input shows/hides correctly.)

- [ ] **Step 6: Commit**

```bash
git add game/src/ui/skip-setup.ts
git commit -m "wellbeing: add Get Married and Reach a Career Level to the goal setup screen"
```

---

### Task 7: Goal-reached screen shows the final score

**Files:**
- Modify: `game/src/ui/skip-setup.ts`

**Interfaces:**
- Consumes: `finalScore` from `../sim/wellbeing/index.ts` (Task 3).

- [ ] **Step 1: Read the current "Goal reached!" screen's rendering code** (search `skip-setup.ts` for however it displays `SkipResult`/the completed-goal summary — this is the existing screen the design says should also show the final score for 3 goal kinds).

- [ ] **Step 2: Add the score line**, shown only when the completed goal's `kind` is `"marriage"`, `"status"`, or `"net_worth"`:

```ts
import { finalScore } from "../sim/wellbeing/index.ts";
```

```ts
  const showScore = goal.kind === "marriage" || goal.kind === "status" || goal.kind === "net_worth";
  const score = showScore ? finalScore(life, life.today) : null;
```

Render `score.final` (and optionally `score.RR`/`score.Wlife` for a one-line breakdown) alongside the screen's existing summary, following whatever markup pattern the rest of that screen already uses for its other summary lines — match it exactly, don't introduce a new visual style for just this line.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json` from `game/`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add game/src/ui/skip-setup.ts
git commit -m "wellbeing: show the final score on the Goal-reached screen for marriage/status/net-worth goals"
```

---

### Task 8: Money desk — Score tab

**Files:**
- Modify: `game/src/debt-demo/main.ts`

**Interfaces:**
- Consumes: `wellbeing`, `finalScore` from `../sim/wellbeing/index.ts` (Task 3).

- [ ] **Step 1: Read the current file's `Tab` type, `TABS` array, `PAGE_SUB`, `pages` record, and `creditPage()` in full** (this file was already extensively read during the tax-filing feature's Task 13 — its `Tab`/`TABS`/`PAGE_SUB`/`pages` pattern and `creditPage()`'s `WEIGHTS`-driven factor-row markup are the exact templates to copy here; re-confirm current line numbers/exact helper names before writing, since the file has grown since).

- [ ] **Step 2: Add `"score"` to the `Tab` union and `TABS` array**, and a `PAGE_SUB` entry, following the file's existing style exactly.

- [ ] **Step 3: Write `scorePage()`**, modeled directly on `creditPage()`'s structure:

```ts
function scorePage(): Page {
  const snapshot = wellbeing(life, clock.day);
  const { RR, Wlife, final } = finalScore(life, clock.day);
  return {
    main: `<div class="section"><h2>Your score</h2><span>Retirement readiness + wellbeing</span></div>
      <div class="stats">${[
        stat("Final score", final.toFixed(1)),
        stat("Retirement readiness", RR.toFixed(1)),
        stat("Lifetime wellbeing", Wlife.toFixed(1)),
      ].join("")}</div>
      <div class="section"><h2>What moves your wellbeing</h2><span>Americans average 54 on the CFPB scale; you're at ${snapshot.W.toFixed(0)}</span></div>
      <div class="stats">${snapshot.factors
        .map((f) => stat(`${f.name} (${f.weight})`, `${(f.s * 100).toFixed(0)}% — ${f.note}`))
        .join("")}</div>`,
    side: false,
  };
}
```

(Use whichever local stat-row helper `creditPage()`/`fundPage()` actually uses — the tax-filing feature's Task 13 found this file uses a local function like `stat(...)`, not a `statRow` that doesn't exist; confirm the exact name in the current file rather than assuming. Import `wellbeing`/`finalScore` at the top of the file alongside the other sim imports.)

- [ ] **Step 4: Register `score: scorePage` in the `pages` record.**

- [ ] **Step 5: Verify**

Run (from `game/`): `npx tsc --noEmit -p tsconfig.json && node --test tests/*.test.ts`
Expected: clean, all tests still passing (this task adds no new automated tests — the file has no dedicated unit tests, per the same UI convention as the tax-filing feature's Money desk task).

- [ ] **Step 6: Commit**

```bash
git add game/src/debt-demo/main.ts
git commit -m "wellbeing: add the Money desk Score tab"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** every "Decisions locked in" bullet maps to a task — the wellbeing meter exactly as research/09 designed it (Tasks 1-3), the adopted RR formula (Task 3), the marriage roll and minimal new PlayerLife state (Task 4), the two new goal kinds reusing the existing Goal/GoalView pattern (Task 5), the two UI touch points (Tasks 6-8, reusing the setup screen and Credit-tab patterns rather than inventing new ones).
- **Explicitly deferred items are not tasks here and shouldn't become scope creep during execution:** no divorce/kids/layoff-as-random-event, no insurance-shopping or job-location system, no player-adjustable weights, no server-side score storage, no News Engine wiring for the new `marriage` event — all per the spec's own "Explicitly out of scope" list above.
- **Known simplification to flag if it surfaces in playtesting:** the marriage roll's `ANNUAL_MARRIAGE_CHANCE` constant (Task 4) is a placeholder calibration, not derived from a cited Census first-marriage-by-age table the way every dollar figure in this plan is — the original design spec flagged this as something to calibrate against real data "in the eventual implementation task." Task 4's implementer should either find and cite a real per-age-bracket marriage-rate source, or explicitly flag in their report that `0.08` is an uncalibrated placeholder pending that data, so it isn't mistaken for a cited figure like everything else in this feature.
- **Cross-task interface risk to watch:** `WellbeingLife` (Task 3) is a wide structural interface that `PlayerLife` (Task 4) must satisfy exactly by field/method name — this is the same kind of cross-task contract that caused real bugs in the tax-filing feature's Task 8/10 boundary. Task 4's implementer should run `tsc` immediately after wiring `wellbeing(this, day)` into `snapshot()` and treat any structural-mismatch error as a signal to fix the field name, not to loosen `WellbeingLife`.
