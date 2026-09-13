# Life Goals & Wellbeing Score — Design Spec

Date: 2026-09-12
Branch: `GameEngine`
Status: Approved design, ready for `writing-plans`.

## Problem

Larp City has two pieces of a goal-and-scoring system today, and they've never been connected. `game/src/sim/skip/goals.ts` already lets a player pick a fast-forward destination (`debt_free`, `emergency_fund`, `net_worth`, `house`) — but every one of them is purely financial. Separately, `research/09-wellbeing-meter.md` is a fully cited, ready-to-build design for a wellbeing meter (nine weighted factors plus decaying event pulses), and the team's own locked-in decision (`meeting-2026-09-11-game-design.md`, "Scoring and win condition") is that **the final score is retirement readiness plus a wellbeing meter that includes marital status and relationships** — but zero code exists for any of it (`grep -rli wellbeing game/src` returns nothing). A player today cannot set a life goal like "get married" or "reach a career level," and there is no score to check progress against, even though both pieces were already designed for exactly this.

The ask: let a player set life goals (marriage, life savings, a career/income status) alongside the existing financial goals, and give them a real, always-checkable score built from research/09's wellbeing meter and retirement readiness — not a new scoring system invented from scratch.

## Decisions locked in during brainstorming (2026-09-12)

- **Goal system shape:** extend the existing fast-forward `Goal` union (`sim/skip/types.ts`/`goals.ts`) rather than build a separate always-on checklist. New goals reuse the setup screen, the price-tag text, and the progress bar every existing goal already has.
- **"Life savings" is not a new goal kind.** It's the existing `net_worth` goal with friendlier setup-screen copy ("Build your life savings" instead of "Reach a net worth") — a player asking for a savings goal and a player asking for a net-worth target want the same math.
- **"Status" means career/income tier**, not a wellbeing-score tier or a lifestyle tier. It reuses `grossAnnual` (already on `PlayerLife`) and lines up with `research/11-jobs-and-salary-progression.md`'s career levels, so it has somewhere to grow into once that system lands.
- **Marriage needs minimal new sim state, not the full life-event engine.** `PlayerLife` has no relationship field at all today, and `research/09`'s own implementation notes and the News Progression Engine spec ([`2026-09-12-news-progression-engine-design.md`](2026-09-12-news-progression-engine-design.md)) both deliberately deferred the random event/rate engine that would generate marriage, divorce, kids, and layoffs. This slice adds just enough — a `relationship` field and a small seeded chance of marriage while single — to make "get married" a real, reachable goal and to feed the wellbeing meter's Relationships factor. Divorce, kids, and layoff-as-a-random-event stay out of scope: no goal needs them, and the wellbeing meter degrades gracefully (zero pulses) if they never fire.
- **The wellbeing meter is implemented exactly as `research/09` designed it**, not simplified or redesigned: the nine factors (Work 20, Cash cushion 18, Debt load 14, Real income 12, Relationships 10, Retirement on track 8, Health coverage 8, Commute 6, Home stability 4), decaying event pulses, and the cushion-softens-bad-news multiplier.
- **Retirement Readiness adopts research/09's placeholder formula as final**: `RR = 50×clamp(retirement savings / 10×salary) + 20×(credit score − 300)/550 + 15×clamp(net worth / 10×salary) + 15×(1 − clamp(debt/salary))`. Every input already exists or is already planned (retirement account balances, `grossAnnual`, `book.profile.score`, net worth, debt).
- **Final score = `0.6 × RR + 0.4 × Wlife`**, exactly the team's locked-in split, where `Wlife = 0.5 × (lifetime average of W) + 0.5 × (W today)` per research/09 §3.4.
- **The score is always live, not a one-time ending.** Larp City has no "game over" screen and no plans for one (confirmed: no `retire`/`endgame`/`final score` code exists anywhere), and this matches the already-answered open question from `research/10` ("the score always reflects the current branch, no penalty for rewinds"). The score is a number the player can check anytime, the same way credit score and net worth already are.
- **Research/09's remaining open questions are resolved with its own recommended defaults**, not re-litigated: single sits at 0.9 (not 1.0); the CFPB national-average comparison ("Americans average 54; you are at 72") is shown next to the meter; the "relationship strain before divorce" mechanic is skipped (divorce isn't modeled this slice); health coverage is a simple flag (`insured = employed`, no marketplace) rather than a purchasable product, since no insurance-shopping system exists; commute is a static default (the researched US-average one-way commute, 23 minutes) rather than derived from home/job map tiles, since no job-location system exists yet — both flagged as approximations to revisit once those systems exist, not silently wrong numbers.

## Architecture

```
PlayerLife (game/src/sim/life/player.ts)
  + relationship: "single" | "partnered"        (new)
  + insured: boolean                             (new, = employed for now)
  + commuteMinutes: number                       (new, static default = 23)
  + reemployedDay: number | null                 (new, for the Work scar)
  + pulses: { p0: number; halfLifeDays: number; startDay: number }[]  (new)
      │
      │ onDay(): seeded annual chance of marriage while single → emits
      │ new LifeEvent { type: "marriage"; day }, sets relationship = "partnered",
      │ pushes a +6/1yr pulse
      ▼
game/src/sim/wellbeing/            (new, mirrors sim/debt/'s shape)
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
- A seeded per-year roll in `onDay` (only while single, only on each birthday-equivalent tick to keep it O(1)/year not O(1)/day): `rngFor("marriage", life-seed, year)`, probability chosen so most players partner up over a multi-decade run (calibrated against Census first-marriage-by-age data, cited in the eventual implementation task) but it's never guaranteed — some players stay single, matching the real distribution and research/09's "single is not a failure state" framing.
- On a hit: emits `{ type: "marriage"; day }`, sets `relationship = "partnered"`, and calls a new `addPulse(+6, 365)` helper that the wellbeing module reads.
- `insured`: derived, `= this.employed` (no separate field needed, but exposed as a getter for readability in `factors.ts`).
- `commuteMinutes`: a constructor option defaulting to `23` (the Stutzer & Frey US average cited in research/09 §2.6); not derived from geography this slice.
- `reemployedDay`: set by the existing `setEmployed(true, day)` when transitioning from unemployed, so the Work factor's re-employment scar (`1 − 0.5×0.5^(years since re-employed)`) has something to read.

### `game/src/sim/wellbeing/`

- `factors.ts` exports one pure function per factor (`work(life)`, `cashCushion(life)`, `debtLoad(life)`, `realIncome(life)`, `relationships(life)`, `retirementOnTrack(life)`, `healthCoverage(life)`, `commute(life)`, `homeStability(life)`), each returning `{ s: number; points: number }` so the UI's factor breakdown (name/weight/value/note) can be built directly from this array — the exact pattern the Credit tab (`debt-demo/main.ts`'s `WEIGHTS`-driven rows) already uses, reused rather than reinvented.
- `pulses.ts`: `decay(pulse, today) = pulse.p0 × 0.5^((today - pulse.startDay) / pulse.halfLifeDays)`, and the cushion-softening multiplier `m = 1.3 − 0.5 × cushionSubScore` applied to negative pulses only.
- `retirement.ts`: `retirementReadiness(life)` implements the adopted placeholder formula verbatim.
- `index.ts`: `wellbeing(life, today)` sums factor points plus decayed pulses, clamped 0-100; `finalScore(life, today)` combines it with `retirementReadiness` per the locked 0.6/0.4 split, tracking `Wlife` via a running average already available from `life.history` (the existing per-day `LifeSnapshot` array) rather than a new accumulator.

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

`GoalView` (already the single source both the daily life and the monthly preview build from) gains two fields: `relationship: "single" | "partnered"` and `grossAnnual: number` — both already computable from `PlayerLife`, no new sim math needed just to expose them.

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

The `marriage` goal's `progress: null` (like `debt_free`'s met case) is deliberate: research/09 already establishes that marriage isn't a "grind toward it" goal the way net worth is, so the setup and preview screens should not imply a savings-style ramp toward it — a Monte Carlo preview over other seeds can still report "in N of 100 futures you were married by year Y" using the same seeded roll, but the UI must not read as "put more money toward marriage."

## UI

- `game/src/ui/skip-setup.ts`: add two entries to the `GOALS` array (💍 "Get married", 📈 "Reach a career level"), a `goal()`/`goalCard()` switch case each (matching the existing four), and one new input (the target annual income, a slider/number field like the existing `amount`/`downPct` inputs) shown only for the `status` goal.
- `game/src/debt-demo/main.ts` (Money desk): a new **Score** tab, added to the `Tab` union and `TABS` list, laid out exactly like the existing Credit tab — a hero number (the final score), then a factor-breakdown list built straight from `wellbeing().factors` (name, weight, value, one-line note per factor, same shape as the Credit tab's `WEIGHTS`-driven rows), plus a line comparing the wellbeing sub-score to the CFPB's cited national average (54).
- The fast-forward "Goal reached!" screen (`skip-setup.ts`, existing) shows the final score alongside its existing summary when the completed goal is `marriage`, `status`, or `net_worth`, using the same `finalScore()` call the Score tab uses — one function, two call sites.

## Efficiency, reputability, and scope guardrails

- **Efficient:** every wellbeing factor is O(1) arithmetic on state `PlayerLife` already tracks or trivially derives; the marriage roll is O(1) per simulated year, not per day, so a 40-year fast-forward isn't slowed by it any more than the existing debt/tax math slows it today.
- **Reputable:** every factor and the RR formula are the exact numbers research/09 cites and derives from published data (CFPB, Fed SHED, Luhmann et al., Fidelity's savings-multiple guideline) — nothing invented for this slice beyond the two new Goal kinds' plumbing.
- **Consistent with the sim's determinism rule:** the marriage roll uses `rngFor`/seeded hashing like every other random element in `sim/` (no `Math.random()`), so ghost runs, ghost wellbeing lines, and ghost scores replay identically, matching `sim/skip/futures.worker.ts`'s existing preview and the twins' "if you had held" comparisons.
- **No new server surface required for this slice:** the final score is computed client-side from `PlayerLife`/`LifeSnapshot` state already recorded through the existing `RunRecorder` → `insertEvents` path; the new `marriage` `LifeEvent` flows through that unchanged pipeline with no new route or table, the same "record now, wire deeper integration later" pattern the Tax Filing spec (above) already used for its own new event kinds.

## Explicitly out of scope for this slice

- Divorce, kids, and layoff as random/generated events — no goal in this slice needs them, and research/09's meter is designed to degrade gracefully (zero pulses, no relationship-strain state) without them.
- The full life-event/rate engine and its fast-forward interrupt integration (`research/10`'s Autopilot / Big-life-moments / Hands-on tiers) — the marriage roll here is a narrow, single-purpose addition, not that engine.
- An insurance-shopping system or a job-location/commute system — Health coverage and Commute use static/derived defaults (an `insured = employed` flag, a fixed 23-minute commute) until those systems exist, flagged in code as approximations, not hidden.
- Player-adjustable wellbeing weights (research/09 §7's "OECD-style slider" stretch idea) and the "city ties" social-support stretch factor.
- Server-side score storage, history, or any leaderboard/comparison across players — the score is computed and shown client-side from the run's own recorded state, same as credit score and net worth are today.
- News Progression Engine integration for the new `marriage` event — that engine ([`2026-09-12-news-progression-engine-design.md`](2026-09-12-news-progression-engine-design.md)) is itself on hold; the event is recorded now and available to it whenever that work resumes, not wired to it now.

## Status and next steps

Approved design. Next: run this section through the `writing-plans` skill to produce a step-by-step implementation plan, then implement with normal review checkpoints.
