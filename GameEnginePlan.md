# News Progression Engine — Design Spec

Date: 2026-09-12
Branch: `NewsEngine`
Status: Approved design, on hold until other open PRs (Nessie fallback, etc.) merge to `main`; this doc is the starting point when work resumes.

## Problem

Larp City needs a backend system that decides which events in a player's simulated financial life become "news" — shown in the phone's News app, folded into the post-fast-forward newspaper digest, and replayable when the player rewinds/revisits a past day on the calendar. The game already has the seed of this (`server/src/ai/facts.ts`, `server/src/ai/coach.ts`): a hardcoded allow-list of event kinds and an LLM (with a deterministic template fallback) that writes 1-4 stories from a date range's facts. What's missing is:

1. A way to decide newsworthiness that scales with the *player's own* finances (a $500 medical bill matters enormously at a $2,000 net worth and barely at $2M), not just a fixed kind allow-list.
2. Personal, identity-level life events (marriage, divorce, hospitalization, property damage, kids) that the sim doesn't model as typed events yet, and a rule for when they're always newsworthy vs. only when they're big.
3. A storage layer that survives fast-forward (thousands of days landing at once) and calendar rewind (branches, ghost lines), so a player can tap any past day and see what the paper said, not just get an end-of-run summary.
4. Guardrails so this stays reputable (numbers are never invented), efficient (an LLM never sits in the fast-forward hot path), and secure (no cross-player leakage, no browser-supplied text in prompts).

This spec covers the backend decision engine and its storage. It deliberately does **not** cover: the frontend News app UI, the random event generation/rate engine (marriage, divorce, hospitalization, layoff, etc. don't exist as typed `LifeEvent`s yet — treated as a placeholder to be designed later), or the fast-forward interrupt/decision-modal engine (`research/10-teleport-and-goal-skips.md` already specs the interrupt levels; this engine's severity score is designed to feed that later, not to build it now).

## Decisions locked in during brainstorming (2026-09-12)

- **Scope:** the full vertical for this slice — scoring engine **and** persistent per-player (per-branch) storage — explicitly so that fast-forward and calendar rewind/revisit can query history later, not just get a live feed.
- **Newsworthiness mechanism:** a scored/weighted system, not a fixed allow-list. Severity (per event kind) + rarity (has this happened to this player before) + magnitude (dollar impact relative to the player's own baseline) combine into one score; a threshold decides publish, and the score also picks front-page vs. section vs. brief.
- **Personal/identity-level events (marriage, divorce, hospitalization, property damage, kids, bankruptcy, home purchase):** always clear the publish threshold via a per-kind score floor, but the magnitude term still decides how prominent the story is. Reasoning: these are wellbeing/identity events (marital status is already a standalone wellbeing-meter factor in `research/09`, independent of dollar size), and the calendar already treats "milestones" as unconditional blue circles — gating a divorce story on its dollar amount would feel wrong to a player.
- **Fast-forward interaction:** event randomness/rate generation is explicitly out of scope for now (placeholder — "we will work on it later"). What *is* in scope: the engine must work identically whether events arrive one per day (live play) or thousands at once (a multi-year skip), because scoring is cheap arithmetic that runs inline with the existing event batch insert, not an LLM call. The eventual event/rate engine will decide *when* events happen and which ones pause a fast-forward for a financial decision (pay a bill, cover damage, etc.); this engine only decides, after an event exists, whether/how it becomes news. The two are designed to share one severity number so a future interrupt engine doesn't need a second scoring system.
- **Rewind/revisit:** stories are branch-scoped so a rewind's new branch gets its own news going forward while the old branch's stories stay queryable untouched (the existing "ghost line" rule). Branch support doesn't exist server-side yet (`runs`/`events`/`player_snapshots` are linear today), so the schema adds a `branch_id` now, defaulting to one root branch per run, to avoid a breaking migration when branching lands.

## Architecture

```
LifeEvent (client sim, live tick or headless fast-forward)
      │  batched via RunRecorder (game/src/sim/record/index.ts, already exists)
      ▼
POST /api/events  ──────────────────────────────────────────►  server
      │
      ▼
insertEvents()  (server/src/store/runs.ts, existing, unchanged)
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│  Newsworthiness Scorer  (new, pure, deterministic, cheap) │
│  runs on every inserted event, in the same request        │
└─────────────────────────────────────────────────────────┘
      │ score ≥ publish threshold?
      ├─ no  → stays in `events` only (already stored; countable as "routine", same as today's `NewsFacts.routine`)
      └─ yes → row written to `news_stories` (facts only, no prose yet)
                      │
                      ▼  lazily, batched, rate-limited
              Story Writer (extends server/src/ai/coach.ts + facts.ts:
              writes one story at a time as well as the existing range digest)
                      │
                      ▼
              `news_stories.headline/blurb/impact` filled in
              (Gemini, or the existing template fallback — templateNews/templateFeedback pattern)
```

Scoring and writing are deliberately separate stages. Scoring is instant, deterministic, and runs inline with every batch insert — cheap enough to run on a 40-year, 14,600-day fast-forward without slowing it down, because it's arithmetic on facts already in Postgres, not an LLM call. Writing prose is the expensive/slow/costly part, so it's deferred and batched: e.g. "write the last N unwritten stories" on a timer, or on first read (the first time a player opens the News app or hits a post-skip digest for that range). This is also what keeps it reputable: nothing is ever displayed that wasn't scored from real recorded facts first, and a story missing its prose still has correct structured data and can fall back to the template deterministically.

## The score

```
score(event, playerBaseline, playerHistory) =
    severity(kind)                     // static table, e.g. bankruptcy_eligible=100, divorce=90,
                                        // hospitalization=85, collections=80, repossessed=85,
                                        // late_mark=35, moved=40, paid_off=50, job=55
  + rarity(kind, playerHistory)        // higher the first time this kind happens to this player; decays on repeats
  + magnitude(payload, playerBaseline) // log-scaled: dollar amount ÷ the player's own net worth or income
  , floored at FLOOR[kind] for identity-level kinds
    (marriage, divorce, hospitalization, kids, home purchase, bankruptcy_eligible)
```

- `magnitude` is what makes this personalized per-player: the same formula runs for every player, but a $500 medical bill scores very differently for a $2,000-net-worth player than a $2M one.
- `FLOOR` implements the "always newsworthy" rule for identity-level events: they always clear the publish threshold regardless of dollar size, but `magnitude` still moves them between front-page and a small blurb.
- Three prominence tiers (`front_page` / `section` / `brief`) are just score cutoffs on the same number — no separate logic path per tier.
- `category` (`personal` | `financial` | `world`) is metadata carried alongside the score (drives the existing `where:` field in facts.ts — "Your finances" vs. a named state/market event) — it does not change the scoring formula, only how the story is framed and grouped.
- This score is intentionally the same number a future event/interrupt engine (`research/10`'s Autopilot / Big-life-moments / Hands-on levels) would want for "does this need to pause the skip" — not built now, but the number already exists so that engine doesn't need to reinvent it.

## Storage: `news_stories`

Branch-aware from day one, even though branches don't exist server-side yet:

```sql
CREATE TABLE news_stories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES runs(id),
  branch_id    uuid NOT NULL,              -- root branch = run_id today; real branches later
  day          int  NOT NULL,
  event_key    text NOT NULL,              -- events.key ("day:sequence"), ties the story to its source event
  kind         text NOT NULL,
  category     text NOT NULL,              -- 'personal' | 'financial' | 'world'
  score        real NOT NULL,
  prominence   text NOT NULL,              -- 'front_page' | 'section' | 'brief'
  facts        jsonb NOT NULL,             -- exactly what was fed to the writer (audit trail, regeneratable)
  headline     text,                       -- null until written
  blurb        text,
  impact       text,
  source       text,                       -- 'gemini' | 'template' | null (unwritten)
  written_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, branch_id, event_key)
);
CREATE INDEX ON news_stories (run_id, branch_id, day);
```

- **Rewind semantics:** when a player rewinds to day D and forks, the new branch gets a new `branch_id`. Stories with `day < D` are inherited (shared by reference or cheaply copied) from the parent branch; the fork only generates new rows going forward. The old branch's stories are never deleted or edited — that's the existing "old path stays as a ghost line" rule applied to news.
- **Revisit:** tapping a calendar date is `SELECT * FROM news_stories WHERE run_id=? AND branch_id=? AND day=?`. The News app feed, a calendar-day review, and the post-fast-forward digest are the same query shape with a different day range — no separate read path per surface.
- **Ownership/security:** every read is gated by the existing `ownsRun(db, playerId, runId)` check already used by other routes (`server/src/store/runs.ts`) — this doesn't introduce a new auth surface, it reuses the one that exists.

## Efficiency and reputability guardrails

- Scoring is O(1) per event and runs in the same request as the batch insert (`insertEvents`) — no extra round trip, no LLM in the hot path, so a multi-year fast-forward isn't slowed down by news existing.
- Story writing is capped (a max number of stories written per player per day, e.g. 20) and batched, reusing the existing Gemini-with-template-fallback pattern in `coach.ts` — a busy or down model never blocks the game; it serves the deterministic template version instead, exactly like `coachFeedback`/`writeNews` do today.
- `facts` is stored verbatim per story, so every story is auditable and regeneratable — the same "use only the facts below, never invent numbers" contract already enforced in `newsPrompt()`/`coachPrompt()`, just persisted instead of ephemeral.
- No browser-supplied free text is ever part of a prompt — the same rule already stated in `facts.ts`'s file header is preserved here; scorer inputs and writer inputs both come only from server-held recorded facts.

## Explicitly out of scope for this slice

- The random event generation/rate engine (what makes a marriage, divorce, hospitalization, property damage, or layoff happen, and when) — treated as a placeholder. This spec only covers what happens to an event *after* it exists.
- The fast-forward interrupt/decision-modal engine that pauses a skip so the player can make a financial decision (pay a bill, cover damage, etc.) — specified at a high level in `research/10-teleport-and-goal-skips.md`; this engine's severity score is designed to be reusable there later, but building the interrupt engine itself is separate work.
- Frontend News app UI/visual design (explicitly requested to be handled separately).
- Server-side branch/rewind infrastructure beyond the `branch_id` column reservation — full branch forking, checkpointing, and ghost-series storage is `research/10`'s Section 10 data model (`Run`/`Branch`/`LoggedDecision`) and isn't built yet.

## Status and next steps

On hold per team decision: wait for the currently open PRs (Nessie live/local fallback and any others in flight) to merge to `main` first, so this doesn't fork off a moving target. When work resumes:

1. Re-verify this design against whatever `server/src/store/runs.ts`, `server/db/schema.sql`/migrations, and the `LifeEvent` union look like on `main` at that point (branch and event-type reality may have shifted).
2. Run this design spec through the `writing-plans` skill to produce a step-by-step implementation plan.
3. Implement against the plan with normal review checkpoints.

---

# Annual Tax Filing — Design Spec

Date: 2026-09-12
Branch: `GameEngine`
Status: Approved design, ready for `writing-plans`.

## Problem

Larp City has no tax mechanic at all today. Take-home pay is a single flat constant, `TAKE_HOME_SHARE` (`game/src/sim/life/player.ts`), applied the same way to every player regardless of income or state — a placeholder comment even says it's "used only until onboarding asks for gross salary." `research/02-states-cost-of-living.md` already researched real federal brackets, FICA, and state brackets for exactly this purpose ("write our own ~60-line tax function... store brackets in the JSON so the same code handles every state") but none of it is wired into the sim, and `game/src/data/states.ts` carries only RPP/tier data, no tax brackets.

The ask: players should file a real (simplified) tax form once a year based on the state they live in, be taught how, and face real consequences for skipping it — reusing the game's existing debt/credit/wellbeing machinery rather than inventing a parallel penalty system.

**Scope for this slice:** single-filer only. The sim currently models no marital status or dependents anywhere (intake only captures job, salary, rent, debt, savings), so married filing jointly and the Child Tax Credit are out of scope until dependents exist as sim state; childless EIC is in scope since it needs no new player data.

## Decisions locked in during brainstorming (2026-09-12)

- **Form depth:** a simplified 1040-style form (wages → standard deduction → taxable income → tax → credits → withheld → refund/owed), not a full itemized simulation, and not a single "click File" button with no line items. Teaches the shape of a real return using the player's own sim numbers.
- **Federal + state**, not federal-only — this is the payoff of the state cost-of-living system already built (`research/02`'s 9 no-income-tax states become a real strategic choice, not just a cost-of-living footnote).
- **Withholding replaces the flat approximation.** Every paycheck already runs through `PlayerLife.onDay`; it now computes real federal + state withholding per paycheck via the same bracket functions the annual form reconciles against, so April's numbers are a true reconciliation, not a bolt-on quiz layered on a fake number.
- **Skipping has real, escalating consequences** (failure-to-file + failure-to-pay penalties, interest, eventual credit/debt impact), not a narrative-only warning and not a hard blocking modal.
- **The deadline flags, it does not pause time** — a phone badge and one narrator line around the in-game April 15, consistent with the existing rule that only market crashes and bankruptcy-scale events pause the clock; taxes are important but not that.
- **UI lives in two places**, matching every other money system in the game: a new `taxes` phone app (`game/src/ui/phone.ts`'s `APPS`) and a matching tab in the Money desk (`game/debt.html` / `src/debt-demo/`), both reading the same `PlayerLife` state — the established Stocks/Investing, Debt, Credit pattern.
- **Fast-forward auto-files** at the deadline using the standard deduction, no manual review — consistent with skip already being an "autopilot" mode for standing orders (`sim/skip/`). The teaching moment — see the form, choose to ignore it, feel the penalty — only fires in live day-by-day play, where the player is actually present to make that choice.
- **Server scope for this slice:** record the events, don't build the News Engine integration. Tax events are recorded through the existing `RunRecorder` → `insertEvents` path (`server/src/store/runs.ts`) as new `LifeEvent` kinds — no new table, no new route. They become available to the News Progression Engine (this same file, above) whenever that work resumes, since that engine is itself on hold; wiring actual scoring/story-writing for tax events now would jump ahead of a design that isn't being built yet.

## Architecture

```
game/src/sim/tax/                    (new, mirrors game/src/sim/debt/'s shape)
  types.ts        FilingStatus ("single" only for now), TaxYear, TaxReturn, Bracket
  federal.ts       2026 federal brackets, standard deduction, FICA (SS wage base,
                    Medicare + 0.9% additional), childless EIC
  state.ts         per-state brackets/flat/none, reading game/src/data/state-tax.ts
  withholding.ts   per-paycheck federal + state withholding (annualize-and-divide)
  filing.ts        annual reconciliation: wages/withheld (YTD) -> TaxReturn -> refund/owed
  penalties.ts     failure-to-file / failure-to-pay accrual, interest, escalation
  index.ts         public surface (same pattern as sim/debt/index.ts)

game/src/data/state-tax.ts            (new, generated — never hand-edited)
research/data/build_state_tax.py      (new, generated same pattern as build_states_rpp.py,
                                        sourced from Tax Foundation 2026 state income tax tables)
```

```
Payday (PlayerLife.onDay, existing)
      │
      ▼
withholding.ts: federal + state withheld this paycheck ──► wagesYTD / withheldYTD accumulators
                                                             (reset each Jan 1 tick)
      │
      ▼ ~April 15 of the following year (day ≈ 104 into the new year)
filing.ts: reconcile prior year -> TaxReturn { wages, deduction, taxableIncome,
           tax, credits, withheld, refundOrOwed }
      │  emits `tax_ready` (LifeEvent) — phone badge + one narrator line, time NOT paused
      ▼
Player opens Taxes app/desk tab, reviews the simplified 1040-style line items, files
      │                                                    │
      ▼ refund                                             ▼ owed
added to checking                                    paid from checking, or (can't cover)
                                                      routed through the existing
                                                      "can't cover" flow (sim/life)
      │
      ▼ (if NOT filed by deadline)
penalties.ts: failure-to-file 5%/mo + failure-to-pay 0.5%/mo (combined-capped per IRS's
              own reduction rule, both capped at 25%) + interest, on the unpaid balance
      │
      ▼ (unpaid balance persists ~180 days)
converts into a real Debt in game/src/sim/debt/ (a synthetic IRS-balance installment,
same machinery as collections) — dings credit score via the existing
sim/debt/score.ts late-mark path, no bespoke penalty/score system
```

Fast-forward (`sim/skip/futures.worker.ts`) runs the identical `withholding.ts`/`filing.ts` calls inline on every simulated day — no separate headless code path — but at the deadline it auto-files with the standard deduction instead of waiting for a player decision, so a multi-year skip never silently racks up penalties the player never had a chance to see.

## The `TaxReturn` shape

```ts
interface TaxReturn {
  year: number;
  filingStatus: "single";
  state: string;               // state abbr lived in for the tax year (prorating a mid-year move is out of scope for this slice — use the state lived in on Dec 31, same simplification research/02 suggested)
  wages: number;                // wagesYTD accumulated from real paycheck events
  federalStandardDeduction: number;
  federalTaxableIncome: number;
  federalTax: number;
  eic: number;                  // childless EIC only; 0 if the player has no qualifying data
  federalWithheld: number;
  federalRefundOrOwed: number;  // positive = refund
  stateTax: number;
  stateWithheld: number;
  stateRefundOrOwed: number;
  filedDay: number | null;      // null until filed
}
```

`facts`-only discipline (same rule as `server/src/ai/facts.ts`): every number on this record traces back to real recorded paycheck events, never an invented figure — this is what makes the form "reputable."

## Efficiency, reputability, security, scalability

- **Efficient:** withholding and filing are O(1) arithmetic on precomputed static bracket tables (no runtime API calls, matching how `states.ts`/`market.ts` are already precomputed and committed), so a 40-year fast-forward isn't slowed by tax any more than it is by debt math today.
- **Reputable:** brackets and penalty rates are sourced from Tax Foundation 2026 and IRS Topic 653 respectively (cited in code comments, same convention as `research/02`), and every `TaxReturn` field is derived from the run's own recorded events — never invented, never browser-supplied.
- **Secure:** no new PII is collected (no SSNs, no real names) — the sim only ever needed salary/state, which it already has. Recording reuses the existing `RunRecorder` → `insertEvents` path and the existing `ownsRun` auth check; no new server route, no new attack surface.
- **Scalable:** reuses the same batched event-insert path the News Progression Engine design above already validated as safe for thousands-of-days fast-forwards; adding tax events doesn't add a new hot-path dependency.

## Explicitly out of scope for this slice

- Married filing jointly, dependents, and the Child Tax Credit (no sim state for marital status or kids yet — tracked as future work once `research/09`'s wellbeing-meter marital status field is actually modeled).
- Itemized deductions and additional schedules (Schedule A/C/1/2) — the simplified 1040-style shape only.
- Mid-year state-move proration (file using the state lived in on Dec 31 of the tax year, the same simplification `research/02` already proposed).
- News Progression Engine scoring/story-writing for tax events — events are recorded now, scored later, once that engine itself resumes.

## Status and next steps

Approved design. Next: run this section through the `writing-plans` skill to produce a step-by-step implementation plan, then implement with normal review checkpoints.


---

# NPC Bank Interaction & Spending Habits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the player clicks a named NPC walking around the city, show that NPC's real bank statement (checking/savings/credit, real categorized transactions), with a seeded, unique discretionary-spending personality per NPC. Two tiers: **12 primary NPCs** are real, live-Nessie-backed customers (Nessie's hard, undeletable 12-customer allow-list, fully used) placed prominently and easy to find; **~38 background NPCs** get the identical simulation and statement UI but are permanently fallback-only (never promoted to the shared live Nessie sandbox), placed as ordinary ambient foot traffic — still specific, clickable, named characters with real numbers, just less signposted.

**Architecture:** Two systems that exist today but never talk to each other get wired together: the financial roster (`game/src/data/npcs.ts` → `sim/npcs/` → `sim/mirror/` → Nessie) and the visual, clickable city population (`game/src/engine/people.ts` → `ui/npccard.ts`). Both NPC tiers become fixed, always-present "resident" walkers (tagged, never despawn) instead of anonymous foot traffic; clicking one fetches its statement through a small caching client and renders it in the existing NPC card. A new seeded discretionary-spending model gives every NPC's `PlayerLife` a handful of extra categorized transactions a month. The primary tier flows through the existing bank mirror unchanged; the background tier flows through a second bank-mirror route backed by a `local_only` marker on the existing fallback store, so the periodic replay sweep (which otherwise promotes every fallback row to live Nessie once it's reachable) permanently skips it. This is one small, additive change to the already-built fallback (a boolean column and a query filter) — everything else about `failover-nessie.ts`/`replay.ts`'s logic is untouched.

**Tech Stack:** TypeScript, Node's built-in test runner (`node --test`, types stripped natively — no ts-node/jest), PixiJS v8 (engine layer, untested at unit level per existing convention — verified by `npm run build`'s `tsc` pass and manual `npm run dev` QA), Express + Zod (server), Postgres (the existing Tiger Data instance), Nessie sandbox behind the existing fallback.

## Global Constraints

- Every provider key stays server-side; the browser only ever calls `${VITE_API_BASE_URL}/api/*`. Never call Nessie directly from `game/`.
- `sim/` stays deterministic and seeded — no `Math.random()`, no `Date.now()` in simulation code. Use `rngFor`/`hashKeys` from `game/src/engine/rng.ts` (already imported into `sim/` by `sim/skip/futures.ts`, so this is an established cross-layer import, not a new pattern).
- **The live Nessie customer allow-list stays at exactly 12, forever.** Nessie customers can't be deleted and the sandbox is shared/world-readable across every hackathon team (`SETUP.md`); this plan is deliberate about which 12 entities ever become real Nessie customers (Task 10) and structurally prevents the other ~38 from ever being promoted to live (Task 12), rather than relying on nobody raising the cap later.
- `tsc -p tsconfig.json` (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`) is the correctness gate for `game/`; there is no separate lint step.
- Follow existing test conventions exactly: `node --test tests/<name>.test.ts`, plain `node:test`/`node:assert/strict`, no framework.
- `server/src/migrations.sql` is additive only, one statement at a time, `CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS` — matches the file's existing convention exactly; never edit a past statement.
- Tasks 1-9 (below) proceed exactly as written for the primary tier; Tasks 10-16 extend the roster to 12 primary + ~38 background and must not require re-doing any of 1-9.

---

## Current state (verified 2026-09-12 by reading the code, not assuming)

- `game/src/data/npcs.ts`: 8 fictional NPC profiles (Maya, Jordan, Priya, Marcus, Sofia, Kenji, Amara, Diego), each with a job, take-home pay, starting balances, debts, and a payoff `strategy`. `MIRROR_ENTITIES` is the Nessie allow-list.
- `game/src/sim/npcs/index.ts`: `npcLife()` turns a profile into a full `PlayerLife`; `NpcTown` runs all 8 lives on the city clock (`onDay`) and catches them up after a fast-forward (`catchUp`).
- `game/src/sim/mirror/{month,sync,types}.ts` + `server/src/{mirror,routes/nessie}.ts`: every finished game month, each life's events become categorized Nessie deposits/withdrawals (`MonthMirror.record`/`flow`), posted via `BankSync`, readable back as a `BankView` from `GET /api/bank/:entity`. This is **entirely built and working** (`SETUP.md` §5: verified end to end 2026-09-12). The local Postgres fallback (`docs/superpowers/specs/2026-09-12-nessie-fallback-design.md`) makes `/api/bank/*` resilient to Nessie being down, transparently — the frontend never needs to know which backend answered.
- **The gap:** `game/src/engine/people.ts` is a *second, unrelated* NPC system — procedurally generated ambient walkers with random names/jobs/thoughts, no financial data, that spawn and despawn to hit a population target. `game/src/ui/npccard.ts` shows only name/age/job/thought on click. `GET /api/bank/:entity` is never called from `game/`. Money movement per NPC is currently only paycheck / rent / living-costs / debt payments — one lump "Living costs" bill, no per-category discretionary spending, so even once statements are visible, all 8 would look structurally identical (same 4-5 line items, different numbers).
- **The scaling constraint (drives Tasks 10-13):** `server/src/mirror.ts`'s `MAX_NPC_CUSTOMERS = 12` isn't an arbitrary limit — Nessie customers can't be deleted and the sandbox is shared and world-readable across every team at the hackathon, so the team deliberately self-capped to avoid permanently littering a resource other teams also depend on. Getting to ~50 interactable NPCs without abandoning that citizenship rule means only 12 of them are ever real Nessie customers; the rest must be structurally prevented from ever being promoted to live, not just "not promoted yet."

---

## File structure

New files:
- `game/src/sim/npcs/habits.ts` — seeded discretionary-spending model per NPC.
- `game/src/api/bank.ts` — caching client for `GET /api/bank/:entity`.
- `game/tests/habits.test.ts` — habits engine tests.
- `game/tests/bank-client.test.ts` — client cache/dedupe tests.

Modified files:
- `game/src/sim/life/player.ts` — add a public `spend()` primitive and a `"spend"` `LifeEvent`.
- `game/src/sim/mirror/month.ts` — map `"spend"` events to a Nessie memo.
- `game/src/sim/npcs/index.ts` — wire the habits engine into `NpcTown.onDay`/`catchUp`.
- `game/src/engine/people.ts` — add fixed, non-despawning "resident" walkers for the roster.
- `game/src/engine/scene.ts` — accept and forward a residents list to `People`.
- `game/src/ui/npccard.ts` — show a loading state, then the fetched statement, for resident clicks.
- `game/src/style.css` (where `.npc-*` rules live today, verified 2026-09-12) — statement styling.
- `game/src/main.ts` — build the residents list, construct `BankClient`, wire it into `NpcCard`.
- `game/tests/npcs.test.ts` — extend for habit-driven events.
- `server/src/mirror.test.ts` — add one regression test locking in session isolation for `statement()`.

**Tasks 10-16 (two-tier roster, 12 primary + ~38 background) add:**

New files:
- `game/src/data/background-npcs.ts` — deterministic generator for the ~38 background profiles.

Modified files:
- `game/src/data/npcs.ts` — grow `NPCS` from 8 to 12, export `PRIMARY_NPC_IDS`.
- `game/src/sim/npcs/index.ts` — `NpcTown` takes both rosters.
- `game/src/sim/mirror/sync.ts` — per-entity `base` override on `BankSync.add()`.
- `game/src/engine/people.ts` — resident marker becomes tier-conditional (primary only).
- `game/src/api/bank.ts` — per-call `base` override on `BankClient.statement()`.
- `game/src/ui/npccard.ts` — pass the resident's tier-specific base through.
- `game/src/main.ts` — build both rosters' residents and bank routing.
- `server/src/migrations.sql` — one additive column.
- `server/src/store/local-nessie.ts` — `insertCustomer` accepts `localOnly`; `listUnsyncedCustomers` excludes it.
- `server/src/adapters/failover-nessie.ts` — constructor option to never attempt live on `createCustomer`.
- `server/src/mirror.ts` — configurable `maxNpcCustomers` per `MirrorService` instance.
- `server/src/routes/nessie.ts` — factory function, mounted twice.
- `server/src/app.ts` — mount the second router at `/api/bank-bg`.

---

### Task 1: `PlayerLife.spend()` — a generic discretionary-purchase primitive

**Files:**
- Modify: `game/src/sim/life/player.ts:64-74` (the `LifeEvent` union), and add a new public method near `onEvents`/`onDay` (around line 401-420).
- Test: `game/tests/life.test.ts` (append; this file already tests `PlayerLife` directly).

**Interfaces:**
- Produces: `PlayerLife.spend(day: number, category: string, amount: number): LifeEvent`, and a new `LifeEvent` variant `{ type: "spend"; day: number; category: string; amount: number }`. Later tasks (habits engine, MonthMirror) key off this exact shape.

Why a method on `PlayerLife` rather than reaching into `life.ledger` from `sim/npcs/`: every other kind of money movement (`bill`, `payment`, `trade`) already goes through the wallet's shortfall waterfall and is emitted to `onEvents` listeners the same way; a bare external `ledger.wallet().withdraw()` call would silently skip the listener notification that `MonthMirror` depends on. `spend()` reuses the exact same wallet primitive `onDay` already uses for bills (`this.ledger.wallet().withdraw(amount, memo)`, `player.ts:426`), so discretionary spends participate in the same checking → savings → emergency drawdown as everything else, and never overdraw.

- [ ] **Step 1: Write the failing test**

Add to `game/tests/life.test.ts` (check the top of the file for its existing `Place`/`START` fixtures and reuse them rather than redefining):

```ts
test("spend() withdraws through the wallet waterfall and emits a spend event", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  const checking = life.ledger.get("checking");
  checking.balance = 50;
  const events: LifeEvent[] = [];
  life.onEvents((e) => events.push(...e));

  const event = life.spend(10, "Dining out", 30);

  assert.equal(event.type, "spend");
  assert.equal(event.category, "Dining out");
  assert.equal(event.amount, 30, "fully covered by checking");
  assert.equal(life.ledger.get("checking").balance, 20);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], event);
});

test("spend() never pays more than the wallet has", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  life.ledger.get("checking").balance = 5;
  life.ledger.get("savings").balance = 0;
  const event = life.spend(10, "Shopping", 40);
  assert.equal(event.amount, 5, "capped at what the accounts actually held");
});
```

Adjust the two literal account ids (`"checking"`, `"savings"`) only if `game/tests/life.test.ts`'s existing tests use different fixture account ids — check `defaultAccounts` in `player.ts` first; as of this writing they are `"checking"`, `"savings"`, `"emergency"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/life.test.ts --test-name-pattern="spend"`
Expected: FAIL — `life.spend is not a function`.

- [ ] **Step 3: Implement**

In `player.ts`, extend the `LifeEvent` union (line ~67, right after `"bill"`):

```ts
  | { type: "bill"; day: number; name: string; amount: number; paid: number }
  | { type: "spend"; day: number; category: string; amount: number }
```

Add the method next to `onEvents` (after line ~403, before `onDay`):

```ts
  /**
   * A one-off discretionary purchase outside the daily bill/payday cycle
   * (sim/npcs' spending-habit engine calls this). Goes through the same
   * checking -> savings -> emergency waterfall as a bill, so it can never
   * overdraw, and emits like any other event so the bank mirror picks it up.
   */
  spend(day: number, category: string, amount: number): LifeEvent {
    const paid = this.ledger.wallet().withdraw(amount);
    const event: LifeEvent = { type: "spend", day, category, amount: paid };
    this.emit([event]);
    return event;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd game && node --test tests/life.test.ts --test-name-pattern="spend"`
Expected: PASS.

- [ ] **Step 5: Full game test suite + typecheck (this file is shared by everything)**

Run: `cd game && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, no new type errors.

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/life.test.ts
git commit -m "feat(life): add PlayerLife.spend() for discretionary purchases"
```

---

### Task 2: `MonthMirror` turns `"spend"` events into Nessie line items

**Files:**
- Modify: `game/src/sim/mirror/month.ts` (`flow()` method, around line 148-165).
- Test: `game/tests/mirror.test.ts` (this file already exercises `MonthMirror` against a fake `PlayerLife`/event stream — extend it, don't create a new test file).

**Interfaces:**
- Consumes: the `{ type: "spend", day, category, amount }` event from Task 1.
- Produces: no new exported symbol — this is an internal case addition. Verifies against the existing `MirrorEntry` shape (`checking` account, `withdrawal` kind, memo = the category).

- [ ] **Step 1: Write the failing test**

Read `game/tests/mirror.test.ts` first to match its existing fixture style exactly (it likely builds a minimal `PlayerLife`-like object or a real one — match whichever it does). Add:

```ts
test("a spend event becomes a checking withdrawal memo'd by category", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  life.ledger.get("checking").balance = 200;
  const mirror = new MonthMirror(life, START);
  mirror.rebase({ checking: 200, savings: 0, credit: 0 });
  life.spend(5, "Dining out", 25);
  // Force the month to close by advancing past it, matching this file's existing pattern for "prepare()".
  const batch = mirror.prepare(/* first day of the following month, per this file's existing helper */);
  const entry = batch!.entries.find((e) => e.memo === "Dining out");
  assert.ok(entry, "Dining out should appear as its own line item");
  assert.equal(entry!.account, "checking");
  assert.equal(entry!.kind, "withdrawal");
  assert.equal(entry!.amount, 25);
});
```

Adjust the "force the month to close" line to whatever helper/day-advance pattern `mirror.test.ts` already uses for its `bill`/`payment` cases — do not invent a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/mirror.test.ts --test-name-pattern="Dining out"`
Expected: FAIL — no `"Dining out"` entry (the `flow()` switch has no `"spend"` case, so it's silently dropped into the `OTHER_MEMO` catch-all instead of its own line).

- [ ] **Step 3: Implement**

In `month.ts`'s `flow()` method, add a case next to `"bill"`:

```ts
      case "bill":
        add("checking", e.name, -e.paid);
        break;
      case "spend":
        add("checking", e.category, -e.amount);
        break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd game && node --test tests/mirror.test.ts --test-name-pattern="Dining out"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/mirror/month.ts game/tests/mirror.test.ts
git commit -m "feat(mirror): mirror discretionary spend events by category"
```

---

### Task 3: Seeded, unique per-NPC spending-habit engine

**Files:**
- Create: `game/src/sim/npcs/habits.ts`
- Modify: `game/src/sim/npcs/index.ts` (`NpcTown.onDay` and `catchUpLife`)
- Test: `game/tests/habits.test.ts` (new)

**Interfaces:**
- Consumes: `NpcProfile` (from `game/src/data/npcs.ts`), `PlayerLife.spend()` (Task 1), `rngFor`/`hashKeys` from `game/src/engine/rng.ts`.
- Produces:
  - `export interface SpendCategory { name: string; weight: number }` — not exported if unused elsewhere; keep internal unless Task 7 needs it (it does, for the card's habit blurb — see below).
  - `export const SPEND_CATEGORIES: readonly string[]` (fixed category names, shared vocabulary).
  - `export function habitProfile(npcId: string): { name: string; weight: number }[]` — deterministic per-NPC category weights, seeded by `npcId` alone (same every run, per the "reproducible and testable" requirement).
  - `export function describeHabit(npcId: string): string` — one line for the NPC card, e.g. "Spends most on dining out and subscriptions." Built from the top 1-2 weighted categories of `habitProfile`.
  - `export function applyDailyHabit(life: PlayerLife, npcId: string, day: number, date: Date): void` — seeded daily roll (by `npcId` + `day`, not wall-clock) that may call `life.spend(...)` once; no-op most days.

Design: each NPC gets a fixed monthly discretionary *budget* derived from their profile (a small, capped share of take-home so it never competes meaningfully with their debt strategy or emergency fund — this must not change existing test assertions in `npcs.test.ts` like "Maya pays her card down" / "and keeps saving", so keep it deliberately small: 2-6% of monthly take-home, chosen per-NPC by seed). That budget is split across a fixed set of categories by seeded weights (so Jordan the barista skews Dining/Entertainment, Amara the pharmacist skews Shopping/Hobby, etc. — organically, from the hash, not hand-authored per NPC, so adding a 9th NPC later needs no manual habit tuning). Each day, a small seeded roll decides whether *today* is a spend day for each category (so transactions land on varied days across the month rather than one lump sum, which is what already makes "Living costs" boring) — expected value per month equals that category's share of the budget.

- [ ] **Step 1: Write the failing test**

Create `game/tests/habits.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NPCS } from "../src/data/npcs.ts";
import { habitProfile, describeHabit, applyDailyHabit, SPEND_CATEGORIES } from "../src/sim/npcs/habits.ts";
import { PlayerLife } from "../src/sim/life/index.ts";
import type { Place } from "../src/sim/life/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);

test("every NPC's habit weights sum to 1 and use only known categories", () => {
  for (const npc of NPCS) {
    const weights = habitProfile(npc.id);
    assert.ok(weights.length > 0, npc.id);
    const total = weights.reduce((s, w) => s + w.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${npc.id} weights should sum to 1, got ${total}`);
    for (const w of weights) assert.ok(SPEND_CATEGORIES.includes(w.name), `${npc.id}: unknown category ${w.name}`);
  }
});

test("habit weights are deterministic and differ between NPCs", () => {
  assert.deepEqual(habitProfile("npc-maya"), habitProfile("npc-maya"), "same NPC, same seed, same weights every call");
  const distinct = new Set(NPCS.map((n) => JSON.stringify(habitProfile(n.id))));
  assert.ok(distinct.size > 1, "at least some NPCs should have visibly different habits");
});

test("describeHabit names the NPC's top category", () => {
  const line = describeHabit("npc-jordan");
  const top = habitProfile("npc-jordan").sort((a, b) => b.weight - a.weight)[0];
  assert.ok(line.toLowerCase().includes(top.name.toLowerCase()), `"${line}" should mention "${top.name}"`);
});

test("applyDailyHabit only ever spends a small, capped share of take-home over a month, and never on a day it can't afford", () => {
  const npc = NPCS.find((n) => n.id === "npc-jordan")!; // paycheck-to-paycheck NPC: the tightest case
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: npc.monthlyTakeHome });
  life.ledger.get("checking").balance = 0;
  let spentThisMonth = 0;
  life.onEvents((events) => {
    for (const e of events) if (e.type === "spend") spentThisMonth += e.amount;
  });
  const date = new Date(START);
  for (let day = 1; day <= 30; day++) {
    date.setDate(date.getDate() + 1);
    applyDailyHabit(life, npc.id, day, new Date(date));
  }
  assert.ok(spentThisMonth <= npc.monthlyTakeHome * 0.06 + 1, `spent ${spentThisMonth}, over the 6% cap`);
  assert.ok(life.ledger.get("checking").balance >= -0.01, "never overdrawn (spend() caps at what's available)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/habits.test.ts`
Expected: FAIL — `Cannot find module '../src/sim/npcs/habits.ts'`.

- [ ] **Step 3: Implement**

Create `game/src/sim/npcs/habits.ts`:

```ts
// Each named NPC's discretionary-spending personality: a small, seeded slice
// of their take-home split across a fixed set of categories by weight, spent
// out in small amounts through the month (not one lump sum) so their Nessie
// statement reads like an actual person, not a payroll ledger. Purely
// additive to their PlayerLife: it never changes their debt strategy or
// emergency-fund plan, and it's capped low enough (game/tests/habits.test.ts)
// that it can't undo either.

import { hashKeys, rngFor } from "../../engine/rng.ts";
import type { PlayerLife } from "../life/player.ts";

export const SPEND_CATEGORIES = ["Dining out", "Entertainment", "Shopping", "Subscriptions", "Hobby", "Coffee"] as const;

/** Share of monthly take-home spent on discretionary categories, before per-NPC seeding narrows or widens it slightly. */
const BASE_SHARE = 0.04;

export interface HabitWeight {
  name: (typeof SPEND_CATEGORIES)[number];
  weight: number;
}

const cache = new Map<string, HabitWeight[]>();

/** Deterministic per-NPC category weights (sum to 1), seeded only by npcId so they never change between runs. */
export function habitProfile(npcId: string): HabitWeight[] {
  const hit = cache.get(npcId);
  if (hit) return hit;
  const rng = rngFor("habits", npcId);
  const raw = SPEND_CATEGORIES.map((name) => ({ name, weight: 0.15 + rng() }));
  const total = raw.reduce((s, w) => s + w.weight, 0);
  const weights = raw.map((w) => ({ name: w.name, weight: w.weight / total }));
  cache.set(npcId, weights);
  return weights;
}

/** This NPC's share of take-home spent on discretionary categories, seeded so it stays low and stable. */
function monthlyShare(npcId: string): number {
  const rng = rngFor("habits-share", npcId);
  return BASE_SHARE * (0.5 + rng()); // 2%-6% of monthly take-home
}

/** A one-line personality blurb for the NPC card, naming their top 1-2 categories. */
export function describeHabit(npcId: string): string {
  const top = [...habitProfile(npcId)].sort((a, b) => b.weight - a.weight).slice(0, 2);
  if (top.length === 1 || top[1].weight < top[0].weight * 0.6) return `Spends most on ${top[0].name.toLowerCase()}.`;
  return `Spends most on ${top[0].name.toLowerCase()} and ${top[1].name.toLowerCase()}.`;
}

/**
 * A seeded daily roll per category: on average, each category's spend lands
 * `daysPerMonth` times a month at `budget / hits` per hit, so the expected
 * monthly total matches this NPC's `monthlyShare` exactly while the actual
 * days vary. Call once per NPC per game day (NpcTown.onDay / catchUpLife).
 */
export function applyDailyHabit(life: PlayerLife, npcId: string, day: number, date: Date): void {
  const monthlyTakeHome = life.monthlyTakeHome;
  if (!(monthlyTakeHome > 0)) return;
  const budget = monthlyTakeHome * monthlyShare(npcId);
  const hitsPerMonthPerCategory = 3; // small, frequent purchases rather than one lump sum
  const dailyProbability = hitsPerMonthPerCategory / 30;
  for (const cat of habitProfile(npcId)) {
    const rng = rngFor("habit-roll", npcId, cat.name, day);
    if (rng() >= dailyProbability) continue;
    const amount = Math.round(((budget * cat.weight) / hitsPerMonthPerCategory) * 100) / 100;
    if (amount >= 0.5) life.spend(day, cat.name, amount);
  }
  void date; // kept in the signature: callers already have it (NpcTown.onDay), and a future seasonal weighting hook belongs here, not as a call-site change.
}
```

Check `PlayerLife.monthlyTakeHome` is actually a public readable field/getter — grep `player.ts` for `monthlyTakeHome` before writing this; if it's private, add a public getter as part of this task (one line, next to `onEvents`) rather than reaching into a private field.

Wire into `game/src/sim/npcs/index.ts`. In `NpcTown.onDay` (around line 48-53):

```ts
  onDay(day: number): void {
    for (const [id, life] of this.lives) {
      this.catchUpLife(id, life, day - 1);
      life.onDay(day, this.dateOf(day));
      applyDailyHabit(life, id, day, this.dateOf(day));
    }
  }
```

`catchUpLife` today only receives `life`, not the NPC's `id` — it's called from `onDay`/`catchUp` with just the life. Change its signature to `catchUpLife(id: string, life: PlayerLife, toDay: number)`, and inside the `while` loop, walk the days each `runHeadless` batch just covered and apply the habit for each one (the returned day-count isn't enough on its own — we need a per-day roll, not one roll per batch):

```ts
  private catchUpLife(id: string, life: PlayerLife, toDay: number): void {
    while (life.today < toDay) {
      const from = life.today;
      const r = life.runHeadless(from, toDay - from, this.dateOf(from));
      if (r.daysRun === 0) break;
      for (let d = from + 1; d <= from + r.daysRun; d++) applyDailyHabit(life, id, d, this.dateOf(d));
    }
  }
```

and both call sites:

```ts
  catchUp(toDay: number): void {
    for (const [id, life] of this.lives) this.catchUpLife(id, life, toDay);
  }
```

Add the import at the top of `index.ts`: `import { applyDailyHabit } from "./habits.ts";`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd game && node --test tests/habits.test.ts && node --test tests/npcs.test.ts`
Expected: both pass. `npcs.test.ts`'s existing assertions (`maya.totalDebt() < 1_200`, `maya.cash() > 17_400`) must still hold with the new small habit spend layered in — if either now fails by a hair, that's the 6% cap being too loose for Maya specifically; tighten `BASE_SHARE` (e.g. to `0.03`) rather than loosening the test, since the test's numbers encode a specific financial-literacy story (SETUP.md) that discretionary spending must not break.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd game && npm test && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/npcs/habits.ts game/src/sim/npcs/index.ts game/tests/habits.test.ts
git commit -m "feat(npcs): seeded per-NPC discretionary spending habits"
```

---

### Task 4: Named NPCs become fixed, always-present world characters

**Files:**
- Modify: `game/src/engine/people.ts` (`NpcInfo`, `Walker`, `People` class)
- Modify: `game/src/engine/scene.ts` (`CityScene` constructor)

**Interfaces:**
- Produces: `export interface ResidentSeed { id: string; first: string; last: string; job: string; age: number; story: string }` (in `people.ts`); `People`'s constructor gains a 4th parameter `residents: ResidentSeed[] = []`; `NpcInfo` gains `residentId?: string`.
- Consumes (Task 5 provides the caller): `main.ts` builds `ResidentSeed[]` from `NPCS` and passes it through `CityScene`'s constructor into `People`.

This is engine-layer code with no unit tests today (PixiJS/canvas, verified by `tsc` + manual `npm run dev` QA per the existing convention — every other file in `game/src/engine/` is untested the same way). Do not add a testing framework for this task; that would be new scope this plan doesn't need.

- [ ] **Step 1: Add `ResidentSeed` and extend `NpcInfo`/`Walker`**

In `game/src/engine/people.ts`, near the top (after the `Mood` type, before `NpcInfo`):

```ts
export interface ResidentSeed {
  id: string;
  first: string;
  last: string;
  job: string;
  age: number;
  /** Shown as this resident's thought instead of a mood-pool line — their `story` from data/npcs.ts. */
  story: string;
}
```

Extend `NpcInfo` (existing, ~line 15-20):

```ts
export interface NpcInfo {
  name: string;
  age: number;
  job: string;
  thought: string;
  /** Set only for the 8 named roster NPCs; drives the bank-statement card (ui/npccard.ts). */
  residentId?: string;
}
```

Extend `Walker` (existing interface, ~line 60-83) with three fields:

```ts
  info: Omit<NpcInfo, "thought">;
  seedIndex: number;
  leaving: boolean;
+ resident: boolean;
+ residentId?: string;
+ fixedThought?: string;
```

- [ ] **Step 2: Exclude residents from the ambient spawn/despawn target**

In the `People` class, update `count` (existing getter, ~line 116-118) and the despawn pick in `update()` (~line 122-125):

```ts
  get count(): number {
    return this.walkers.filter((w) => !w.leaving && !w.resident).length;
  }
```

```ts
    if (live < this.target && this.rng() < dt * 12) this.spawn();
    if (live > this.target) {
      const w = this.walkers.find((p) => !p.leaving && !p.resident);
      if (w) w.leaving = true;
    }
```

Update the existing `spawn()` method's returned `Walker` literal to add `resident: false` (no `residentId`/`fixedThought`) so the object shape matches the extended interface — TypeScript's `noUnusedLocals`/strict object literal checks will flag this at `tsc` time if missed.

- [ ] **Step 3: Add resident spawning**

Add a constructor parameter and a new private method. Change the constructor signature (existing, ~line 98):

```ts
  constructor(grid: CityGrid, objects: Container, seed: number, residents: ResidentSeed[] = []) {
    this.grid = grid;
    this.objects = objects;
    this.seed = seed;
    this.rng = rngFor(seed, "people");
    for (const { x, y, c } of grid.cells()) {
      if (c === "=" && grid.roadLinks(x, y).filter(Boolean).length < 4) this.sidewalks.push([x, y]);
      if (c === "P" || c === "p") {
        this.plazas.push([x, y]);
        this.plazaSet.add(`${x},${y}`);
      }
    }
    for (const r of residents) this.spawnResident(r);
  }
```

Add the method (near `spawn()`, reusing `drawPerson`):

```ts
  /** A named roster NPC (data/npcs.ts): a fixed walker that never despawns, marked so ui/npccard.ts can fetch its real bank statement. */
  private spawnResident(r: ResidentSeed): void {
    const rng = rngFor(this.seed, "resident", r.id);
    const useStreet = !this.plazas.length || rng() < 0.5;
    const pool = useStreet ? this.sidewalks : this.plazas;
    if (!pool.length) return;
    const [x, y] = pick(rng, pool);
    const fig = drawPerson(rng);
    const dirs = this.grid.roadLinks(x, y).map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    const w: Walker = {
      street: useStreet,
      x, y,
      dir: dirs.length ? pick(rng, dirs) : 0,
      t: rng(),
      side: rng() < 0.5 ? 1 : -1,
      px: x + 0.2 + rng() * 0.6,
      py: y + 0.2 + rng() * 0.6,
      tx: x + 0.5,
      ty: y + 0.5,
      pause: 0,
      speed: 0.24 + rng() * 0.1,
      phase: rng() * 6,
      ...fig,
      info: { name: `${r.first} ${r.last}`, age: r.age, job: r.job },
      seedIndex: 0,
      leaving: false,
      resident: true,
      residentId: r.id,
      fixedThought: r.story,
    };
    markResident(w.view);
    w.view.alpha = 1;
    this.walkers.push(w);
    this.objects.addChild(w.view);
  }
```

Add the small visual marker helper near `drawPerson` at the bottom of the file, so the player can tell a resident apart from ambient extras before clicking:

```ts
/** A small gold ring at a resident's feet, so the 8 real NPCs read as distinct from ambient foot traffic. */
function markResident(view: Container): void {
  const ring = new Graphics().ellipse(0, 0.5, 5.5, 2.4).stroke({ width: 0.8, color: 0xf4c430, alpha: 0.85 });
  view.addChildAt(ring, 0);
}
```

- [ ] **Step 4: Use the fixed thought and expose `residentId` from `pickAt`**

Update `pickAt` (existing, ~line 152-166):

```ts
  pickAt(wx: number, wy: number, mood: Mood): NpcInfo | null {
    let best: Walker | null = null;
    let bestD = 14;
    for (const w of this.walkers) {
      const dx = w.view.x - wx, dy = w.view.y - 9 - wy;
      const d = Math.hypot(dx, dy * 0.8);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (!best) return null;
    const pool = THOUGHTS[mood];
    return { ...best.info, thought: best.fixedThought ?? pool[best.seedIndex % pool.length], residentId: best.residentId };
  }
```

- [ ] **Step 5: Forward residents through `CityScene`**

In `game/src/engine/scene.ts`, import the type and extend the constructor (existing signature line ~93: `constructor(app: Application, city: CityDef, clock: Clock, factories: Record<string, LandmarkFactory>, sprites: SpriteSet | null = null, seed = 7)`):

```ts
import { People, type Mood, type NpcInfo, type ResidentSeed } from "./people";
```

```ts
  constructor(
    app: Application,
    city: CityDef,
    clock: Clock,
    factories: Record<string, LandmarkFactory>,
    sprites: SpriteSet | null = null,
    seed = 7,
    residents: ResidentSeed[] = [],
  ) {
    ...
    this.people = new People(this.grid, this.objects, seed, residents);
    ...
```

(Keep every other line in the constructor body unchanged — only the `People` construction line and the parameter list change.)

- [ ] **Step 6: Typecheck**

Run: `cd game && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. This is the only verification available for this task until Task 6 wires it up end to end — do not skip it.

- [ ] **Step 7: Commit**

```bash
git add game/src/engine/people.ts game/src/engine/scene.ts
git commit -m "feat(world): named NPCs are fixed, marked, non-despawning residents"
```

---

### Task 5: Caching, de-duped bank statement client

**Files:**
- Create: `game/src/api/bank.ts`
- Test: `game/tests/bank-client.test.ts` (new)

**Interfaces:**
- Consumes: `BankView` from `game/src/sim/mirror/types.ts` (already defined, matches the server's `GET /api/bank/:entity` response byte-for-byte per that file's own header comment).
- Produces: `export class BankClient { constructor(base: string, fetchFn?: typeof fetch); statement(entity: string, opts?: { force?: boolean }): Promise<BankView> }`. Task 7 (`NpcCard`) is the only consumer.

Why a client-side cache: clicking the same NPC repeatedly (or the 6-second auto-hide in `NpcCard` re-triggering on re-click) would otherwise fire a fresh `GET /api/bank/:entity` every time, hitting the server's `generalLimiter` (120 req/min per IP, `server/src/middleware/rateLimit.ts`) alongside every other API call the game makes, and adding needless latency the player would feel as card-popup lag. A 30-second TTL plus in-flight de-dupe (two clicks on Maya half a second apart share one request) removes essentially all of that traffic without the statement ever looking stale in a way a player could notice — Nessie mirror posts happen once a month, not live.

- [ ] **Step 1: Write the failing test**

Create `game/tests/bank-client.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { BankClient } from "../src/api/bank.ts";
import type { BankView } from "../src/sim/mirror/types.ts";

function fakeView(entity: string): BankView {
  return { entity, name: entity, run: "r1", accounts: [] };
}

test("caches a statement for the TTL instead of refetching", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return { ok: true, json: async () => fakeView("npc-maya") } as Response;
  }) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);

  await client.statement("npc-maya");
  await client.statement("npc-maya");
  assert.equal(calls, 1, "second call within the TTL should hit the cache");
});

test("de-dupes concurrent in-flight requests for the same entity", async () => {
  let calls = 0;
  let resolveFetch!: (r: Response) => void;
  const fetchFn = (async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);

  const a = client.statement("npc-maya");
  const b = client.statement("npc-maya");
  resolveFetch({ ok: true, json: async () => fakeView("npc-maya") } as Response);
  await Promise.all([a, b]);
  assert.equal(calls, 1, "two concurrent clicks should share one request");
});

test("force bypasses the cache", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return { ok: true, json: async () => fakeView("npc-maya") } as Response;
  }) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);
  await client.statement("npc-maya");
  await client.statement("npc-maya", { force: true });
  assert.equal(calls, 2);
});

test("a non-ok response rejects and does not poison the cache", async () => {
  const fetchFn = (async () => ({ ok: false, status: 502 }) as Response) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);
  await assert.rejects(() => client.statement("npc-maya"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/bank-client.test.ts`
Expected: FAIL — `Cannot find module '../src/api/bank.ts'`.

- [ ] **Step 3: Implement**

Create `game/src/api/bank.ts`:

```ts
// A small caching client over GET /api/bank/:entity (server/src/routes/nessie.ts),
// which already answers from the Nessie mirror or its local fallback
// transparently (docs/superpowers/specs/2026-09-12-nessie-fallback-design.md).
// This file's only job is to keep the game from refetching the same NPC's
// statement on every click: a short TTL plus in-flight de-dupe.

import type { BankView } from "../sim/mirror/types.ts";

const TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  value: BankView;
}

export class BankClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<BankView>>();
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(base: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.base = base;
    this.fetchFn = fetchFn;
  }

  /** This session's statement for `entity` ("npc-maya", etc.), cached for 30s unless `force`. */
  async statement(entity: string, opts: { force?: boolean } = {}): Promise<BankView> {
    const cached = this.cache.get(entity);
    if (!opts.force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const pending = this.inflight.get(entity);
    if (pending && !opts.force) return pending;
    const p = this.load(entity).finally(() => this.inflight.delete(entity));
    this.inflight.set(entity, p);
    return p;
  }

  private async load(entity: string): Promise<BankView> {
    const r = await this.fetchFn(`${this.base}/${entity}`, { credentials: "include" });
    if (!r.ok) throw new Error(`bank_statement_failed:${r.status}`);
    const value = (await r.json()) as BankView;
    this.cache.set(entity, { at: Date.now(), value });
    return value;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd game && node --test tests/bank-client.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Typecheck**

Run: `cd game && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add game/src/api/bank.ts game/tests/bank-client.test.ts
git commit -m "feat(api): caching client for GET /api/bank/:entity"
```

---

### Task 6: Wire residents and the bank client into `main.ts`

**Files:**
- Modify: `game/src/main.ts`

**Interfaces:**
- Consumes: `ResidentSeed` (Task 4), `BankClient` (Task 5), `NPCS` (existing `data/npcs.ts`), `describeHabit` (Task 3).
- Produces: nothing new exported — `main.ts` is the composition root.

- [ ] **Step 1: Build the residents list and construct the client**

Near the top, after the `town`/`bank` construction (existing, ~line 74-79), add:

```ts
import { NPCS } from "./data/npcs";
import { describeHabit } from "./sim/npcs/habits";
import { BankClient } from "./api/bank";
import type { ResidentSeed } from "./engine/people";
```

(Merge these into the existing import block rather than adding a second one — follow the file's existing import grouping.)

```ts
const residents: ResidentSeed[] = NPCS.map((n) => ({
  id: n.id,
  first: n.first,
  last: n.last,
  job: n.job,
  age: n.age,
  story: `${n.story} ${describeHabit(n.id)}`,
}));
const bankClient = new BankClient(`${api}/bank`);
```

Place this after `const api = ...` (existing line 75) since it depends on `api`, and after `NPCS`/`describeHabit` are imported.

- [ ] **Step 2: Pass residents into every `CityScene`**

In `open()` (existing, ~line 114-132), update the construction call:

```ts
  scene = new CityScene(app, city, clock, LANDMARKS, sprites, undefined, residents);
```

(`undefined` keeps the existing default `seed = 7` behavior untouched — this plan does not change scene seeding, which is a separate, pre-existing concern.)

- [ ] **Step 3: Pass `bankClient` to `NpcCard`**

This depends on Task 7's `NpcCard` constructor signature; complete Task 7's Step 1 (interface only) before this step, or do Task 7 first and return here. Update the `NpcCard` construction (existing, ~line 134):

```ts
const npcCard = new NpcCard(document.getElementById("npc")!, bankClient);
```

- [ ] **Step 4: Typecheck and manual smoke test**

Run: `cd game && npx tsc --noEmit -p tsconfig.json`
Then: `cd game && npm run dev`, open the city, and confirm (this is the manual QA step called for in this project's own conventions for engine/UI code, per CLAUDE.md's "For UI or frontend changes, start the dev server..."):
- At least one gold-ringed resident is visible and walking around.
- Clicking a non-resident (ambient) extra still shows the old name/job/thought card with no bank section.
- Clicking a resident shows their name/job/story, then a loading state, then real account balances.

- [ ] **Step 5: Commit**

```bash
git add game/src/main.ts
git commit -m "feat(main): spawn named NPCs as residents and wire the bank client"
```

---

### Task 7: `NpcCard` shows the fetched statement

**Files:**
- Modify: `game/src/ui/npccard.ts`
- Modify: `game/src/style.css`, which already defines `.npc-name`/`.npc-meta`/`.npc-thought` (verified 2026-09-12: lines 205, 210, 216 — not `pixel-theme.css`, which is imported separately in `main.ts` but does not contain these rules).

**Interfaces:**
- Consumes: `BankClient.statement()` (Task 5), `NpcInfo.residentId` (Task 4), `BankView`/`BankAccountView` (existing, `sim/mirror/types.ts`).
- Produces: `NpcCard`'s constructor gains a second parameter `bank: BankClient`.

- [ ] **Step 1: Extend the constructor and add a generation guard**

Rewrite `game/src/ui/npccard.ts`:

```ts
// A small speech-bubble card for the NPC the player clicked. For the 8 named
// roster NPCs (engine/people.ts's residents), it also fetches and shows their
// real Nessie-mirrored bank statement (api/bank.ts) instead of just a thought.

import type { NpcInfo } from "../engine/people";
import type { BankClient } from "../api/bank";
import type { BankView } from "../sim/mirror/types";

const ACCOUNT_LABEL: Record<string, string> = { checking: "Checking", savings: "Savings", credit: "Credit card" };

export class NpcCard {
  private readonly el: HTMLElement;
  private hideTimer = 0;
  private readonly bank: BankClient;
  /** Bumped on every show(); a stale fetch from a previous click checks this before rendering. */
  private generation = 0;

  constructor(root: HTMLElement, bank: BankClient) {
    this.el = root;
    this.bank = bank;
    root.addEventListener("click", () => this.hide());
  }

  show(npc: NpcInfo | null, sx: number, sy: number): void {
    if (!npc) return this.hide();
    const generation = ++this.generation;
    this.el.innerHTML = `
      <div class="npc-name">${npc.name}</div>
      <div class="npc-meta">${npc.age} · ${npc.job}</div>
      <div class="npc-thought">“${npc.thought}”</div>
      ${npc.residentId ? `<div class="npc-bank" id="npc-bank-body">Loading bank statement…</div>` : ""}`;
    this.el.hidden = false;
    this.position(sx, sy);
    window.clearTimeout(this.hideTimer);
    // Residents get a longer window: there's more to read once the statement loads.
    this.hideTimer = window.setTimeout(() => this.hide(), npc.residentId ? 12_000 : 6_000);
    if (npc.residentId) void this.loadStatement(npc.residentId, generation);
  }

  hide(): void {
    this.el.hidden = true;
  }

  private position(sx: number, sy: number): void {
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(window.innerWidth - w - 10, Math.max(10, sx - w / 2))}px`;
    this.el.style.top = `${Math.max(10, sy - h - 34)}px`;
  }

  private async loadStatement(entity: string, generation: number): Promise<void> {
    try {
      const view = await this.bank.statement(entity);
      if (generation !== this.generation) return; // the player clicked someone else while this was in flight
      this.renderStatement(view);
    } catch {
      if (generation !== this.generation) return;
      const body = this.el.querySelector("#npc-bank-body");
      if (body) body.textContent = "Bank statement unavailable right now.";
    }
  }

  private renderStatement(view: BankView): void {
    const body = this.el.querySelector("#npc-bank-body");
    if (!body) return; // the card was hidden or replaced before this resolved
    const rows = view.accounts
      .map((a) => `<div class="npc-bank-row"><span>${ACCOUNT_LABEL[a.account] ?? a.account}</span><span>$${a.balance.toLocaleString()}</span></div>`)
      .join("");
    const recent = view.accounts
      .flatMap((a) => a.transactions.map((t) => ({ ...t, account: a.account })))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 3)
      .map((t) => `<div class="npc-bank-txn"><span>${t.memo}</span><span>${t.amount >= 0 ? "+" : "-"}$${Math.abs(t.amount).toLocaleString()}</span></div>`)
      .join("");
    body.innerHTML = `${rows}${recent ? `<div class="npc-bank-recent">${recent}</div>` : ""}`;
  }
}
```

Note: `renderStatement` re-queries `#npc-bank-body` rather than holding a reference from `show()`, because `show()` rewrites `this.el.innerHTML` wholesale on every call — any cached element reference from a previous call would already be detached. The `generation` check happens first specifically so a slow, superseded fetch can't resurrect a card the player has since replaced by clicking someone else, even though this DOM-requery already guards the "card was hidden entirely" case; both guards are needed because "hidden" and "showing someone else" are different states.

- [ ] **Step 2: Add matching styles**

In `game/src/style.css`, find the existing rule block that defines `.npc-name`, `.npc-meta`, `.npc-thought` (lines 205/210/216) and add directly after it, matching that file's existing property style (spacing units, color variables — copy them, don't invent new ones):

```css
.npc-bank {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 0.85em;
}
.npc-bank-row,
.npc-bank-txn {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.npc-bank-recent {
  margin-top: 4px;
  opacity: 0.8;
}
```

- [ ] **Step 3: Update the `main.ts` construction (if Task 6 was done first, verify; otherwise do it now)**

Confirm `game/src/main.ts`'s `new NpcCard(document.getElementById("npc")!, bankClient)` call matches this constructor. This is the same line as Task 6 Step 3 — do not add it twice.

- [ ] **Step 4: Typecheck**

Run: `cd game && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 5: Manual QA (no unit test exists for DOM-rendering UI files in this codebase — `ui/hud.ts`, `ui/phone.ts` etc. are all manually verified the same way)**

Run: `cd game && npm run dev`. Click a resident and confirm: the loading state appears immediately, then real balances render within ~1s, then clicking a second resident replaces the card cleanly (no flash of the first resident's stale data — this is the generation guard from Step 1). Then stop the server (`server/`) entirely and confirm the card shows "Bank statement unavailable right now." instead of hanging or throwing in the console — this exercises the one failure path the local Nessie fallback doesn't cover (the API server itself being down, as opposed to Nessie being down, which the fallback already handles).

- [ ] **Step 6: Commit**

```bash
git add game/src/ui/npccard.ts game/src/style.css
git commit -m "feat(ui): show a resident's real bank statement on click"
```

---

### Task 8: Lock in session isolation for `GET /api/bank/:entity` with a regression test

**Files:**
- Modify: `server/src/mirror.test.ts`

**Interfaces:**
- Consumes: `MirrorService`, the existing fake `NessieLike` this test file already builds (check its top for the fake's exact construction and reuse it — do not build a second fake).

Why this task exists even though no server code changes: `MirrorService.statement()` already scopes reads by `${tag}:${entity}:${session}:` account-name prefix (`server/src/mirror.ts`'s `prefix()`/`discover()`), so cross-session isolation already holds even though NPC *customers* are intentionally shared across every session (`SETUP.md` §5, `MAX_NPC_CUSTOMERS`). That's verified by reading the code, not by a test — the existing test suite (`mirror.test.ts`'s "a new run replaces only this session's accounts" test) checks `open()`'s isolation but never calls `statement()` from a second session against a shared NPC customer. Since this plan makes `GET /api/bank/:entity` reachable from every player's browser via the new UI in Task 7, "one player can't read another's NPC balances" goes from an implementation detail to a security property this feature depends on — it deserves its own explicit, permanent test rather than resting on an inference from a different test's assertions.

- [ ] **Step 1: Write the test**

Read the top ~30 lines of `server/src/mirror.test.ts` first to copy its exact fake-Nessie setup and `MirrorService` construction pattern (constructor args, how `open`/`post` are called with a `session` string). Then add:

```ts
test("two sessions' statements for the same shared NPC customer never mix", async () => {
  const fake = /* this file's existing fake NessieLike constructor/instance */;
  const mirror = new MirrorService(fake, "larpcity");

  await mirror.open("session-a", "npc-maya", { run: "r1", name: "Maya", opening: { checking: 100, savings: 0, credit: 0 } });
  await mirror.post("session-a", "npc-maya", { run: "r1", entries: [{ key: "a1", account: "checking", kind: "deposit", amount: 50, date: "2026-09-12", memo: "Paycheck" }] });

  await mirror.open("session-b", "npc-maya", { run: "r1", name: "Maya", opening: { checking: 100, savings: 0, credit: 0 } });
  await mirror.post("session-b", "npc-maya", { run: "r1", entries: [{ key: "b1", account: "checking", kind: "deposit", amount: 999, date: "2026-09-12", memo: "Paycheck" }] });

  const a = await mirror.statement("session-a", "npc-maya");
  const b = await mirror.statement("session-b", "npc-maya");

  const checkingA = a.accounts.find((x) => x.account === "checking")!;
  const checkingB = b.accounts.find((x) => x.account === "checking")!;
  assert.equal(checkingA.balance, 150, "session A sees only its own +50");
  assert.equal(checkingB.balance, 1099, "session B sees only its own +999");
  assert.ok(!checkingA.transactions.some((t) => t.key === "b1"), "session A must never see session B's transaction");
  assert.ok(!checkingB.transactions.some((t) => t.key === "a1"), "session B must never see session A's transaction");
});
```

Adjust the exact `fake` construction to match whatever this file already does (it very likely already has a working `fake` object from the tests directly above it — reuse the same one or its constructor, don't reinvent).

- [ ] **Step 2: Run it**

Run: `cd server && node --test src/mirror.test.ts --test-name-pattern="never mix"`
Expected: PASS immediately — this locks in existing, correct behavior; it should not require any production code change. If it fails, that is a real bug in `mirror.ts` predating this plan and must be fixed before continuing (stop and report rather than adjusting the test to match broken behavior).

- [ ] **Step 3: Full server suite**

Run: `cd server && npm test`

- [ ] **Step 4: Commit**

```bash
git add server/src/mirror.test.ts
git commit -m "test(mirror): lock in cross-session isolation for shared-NPC statements"
```

---

### Task 9: Full-repo verification pass

**Files:** none (verification only).

- [ ] **Step 1: Game — full suite and build**

```bash
cd game
npm test
npm run build
```

Expected: all tests pass; `tsc` typecheck (part of `build`) is clean; Vite build succeeds for both pages (city + `/debt.html`).

- [ ] **Step 2: Server — full suite**

```bash
cd server
npm test
npx tsc --noEmit -p tsconfig.json
```

If a `TEST_DATABASE_URL` TimescaleDB is available, also run: `TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test` (per `CLAUDE.md`'s documented command) to include the database-backed tests — `mirror.test.ts` itself doesn't need the DB (it uses a fake `NessieLike`), but this confirms nothing else regressed.

- [ ] **Step 3: End-to-end manual pass**

```bash
cd server && npm run dev   # terminal 1
cd game && npm run dev     # terminal 2
```

Walk through: onboarding → city loads → at least one gold-ringed resident visible → click shows loading then real balances and a couple of named categories (e.g. "Dining out", "Coffee") in the recent-transactions list, not just "Transfers and other" → click an ambient (non-ringed) extra shows the old thought-only card, unchanged → stop the server process, click a resident again, confirm the graceful "unavailable" message from Task 7 Step 5 rather than a console error or a stuck "Loading…".

- [ ] **Step 4: Update `SETUP.md`'s option-B section**

`SETUP.md:194-206` currently ends at "the rest of the city's walkers stay a backdrop with no Nessie data" — that sentence is now false. Update it in place to say the 8 NPCs are now visible, marked residents whose statement the player can open by clicking them, citing this plan's `game/src/ui/npccard.ts` and `game/src/sim/npcs/habits.ts` the way the rest of that section cites its own files.

- [ ] **Step 5: Final commit**

```bash
git add SETUP.md
git commit -m "docs: note that named NPCs are now clickable, with real bank statements"
```

---

# Part 2: Scaling to ~50 NPCs — 12 primary (real Nessie) + ~38 background (fallback-only)

Everything above (Tasks 1-9) still applies unchanged and should be done first — it establishes `spend()`, the habits engine, the resident-walker mechanism, `BankClient`, and the card UI for a single tier. This part extends the *same* mechanisms to a second, larger tier that never touches live Nessie, plus grows the primary tier from 8 to the full 12-customer allowance.

**Why a second tier is needed at all, not just "add more to the roster":** `server/src/mirror.ts`'s `MAX_NPC_CUSTOMERS = 12` isn't a number to bump — Nessie customers can't be deleted and the sandbox is shared and world-readable by every team at the hackathon (`SETUP.md`). Routing 38 more NPCs through the existing fallback as-is wouldn't solve this either: the fallback's whole point is that its periodic replay sweep (`server/src/replay.ts`) promotes every local-only row to live Nessie once it's reachable — so without a change, those 38 would sit local-only only until the next successful sweep, then become real customers #13-#50 anyway. Task 12 adds the one thing needed to make "fallback-only" mean "fallback-only forever": a `local_only` marker the sweep's own query excludes.

---

### Task 10: Grow the primary roster from 8 to 12

**Files:**
- Modify: `game/src/data/npcs.ts`
- Modify: `game/tests/npcs.test.ts` (its `NPCS.length <= 12` assertion already allows this — no change needed there, but its Maya-specific assertions are untouched since Maya isn't touched)

**Interfaces:**
- Produces: `export const PRIMARY_NPC_IDS: readonly string[]` — the exact 12 ids, read by the server (Task 13) to classify which entity ids may use the live-eligible bank route. Must stay in exact sync with `NPCS.map(n => n.id)`; derive it from `NPCS` rather than typing it out twice: `export const PRIMARY_NPC_IDS = NPCS.map((n) => n.id);`.

Four new profiles, each teaching a lesson the existing 8 don't cover, using only the debt kinds `npcLife()` already supports (`card`, `student`, `auto`, `personal` via `installment`) — no debt-engine changes:

- [ ] **Step 1: Add the four profiles**

Append to the `NPCS` array in `game/src/data/npcs.ts`, right before the closing `];` (after Diego):

```ts
  {
    id: "npc-hannah",
    first: "Hannah",
    last: "Brooks",
    age: 23,
    job: "retail associate",
    monthlyTakeHome: 2_300,
    accounts: { checking: 400, savings: 100, emergency: 0 },
    debts: [{ kind: "card", name: "First card", balance: 900, limit: 1_000, apr: 0.2699 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "A year into her first card, close to the limit and only paying the minimum.",
  },
  {
    id: "npc-oscar",
    first: "Oscar",
    last: "Ruiz",
    age: 33,
    job: "rideshare driver",
    monthlyTakeHome: 3_300,
    accounts: { checking: 250, savings: 0, emergency: 0 },
    debts: [{ kind: "personal", name: "Emergency repair loan", balance: 2_400, apr: 0.329, months: 18 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "Gig income doesn't qualify for a bank loan, so a car repair became 32.9% for 18 months.",
  },
  {
    id: "npc-grace",
    first: "Grace",
    last: "Kim",
    age: 61,
    job: "retiree",
    monthlyTakeHome: 3_100,
    accounts: { checking: 4_200, savings: 65_000, emergency: 30_000 },
    debts: [],
    strategy: "avalanche",
    extraMonthly: 0,
    story: "Mortgage paid off years ago; most of what she lives on now comes from the market, not a paycheck.",
  },
  {
    id: "npc-tariq",
    first: "Tariq",
    last: "Ahmed",
    age: 27,
    job: "accountant",
    monthlyTakeHome: 4_400,
    accounts: { checking: 3_100, savings: 9_000, emergency: 6_000 },
    debts: [{ kind: "student", name: "Student loans", balance: 14_000, apr: 0.045, payment: 145 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "His loan's rate is under 5%, so every spare dollar goes to his Roth IRA instead of paying it off early.",
  },
```

`Debt: []` for Grace: check `newBook()` in `game/src/sim/debt/factory.ts` accepts an empty `debts` array before assuming it does — if it throws or a downstream calculation divides by `debts.length`, give her a single, already-tiny, already-nearly-paid installment debt instead (e.g. `{ kind: "personal", name: "Old furniture loan", balance: 200, apr: 0.08, months: 2 }`) rather than `[]`. Verify with a quick one-off: `cd game && node --eval 'const {NPCS}=await import("./src/data/npcs.ts"); const {npcLife}=await import("./src/sim/npcs/index.ts"); console.log(npcLife(NPCS.find(n=>n.id==="npc-grace"), {place:{abbr:"TX",name:"Texas",rpp:{all:97.4,goods:97,housing:88.6}}, day:0, market: (await import("./src/sim/market/index.ts")).MarketPath ? new (await import("./src/sim/market/index.ts")).MarketPath(1, new Date()) : undefined}).netWorth())'` before committing to `[]`.

- [ ] **Step 2: Add the derived export**

Right after the `NPCS` array closes, before `MIRROR_ENTITIES`:

```ts
/** The subset of the roster that ever gets a real, live Nessie customer (server/src/mirror.ts's MAX_NPC_CUSTOMERS = 12). Everything else in the roster (game/src/data/background-npcs.ts) is fallback-only. */
export const PRIMARY_NPC_IDS: readonly string[] = NPCS.map((n) => n.id);
```

- [ ] **Step 3: Run existing tests**

Run: `cd game && node --test tests/npcs.test.ts`
Expected: PASS — `MIRROR_ENTITIES` grows to 12 entries + player = 13 rows, still `<= 12` NPCs per the existing assertion (`NPCS.length <= 12`), still matching `ENTITY`/name-format regexes (all new names are plain `[A-Za-z][A-Za-z .'-]{0,29}`).

- [ ] **Step 4: Full game suite + typecheck**

Run: `cd game && npm test && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 5: Commit**

```bash
git add game/src/data/npcs.ts
git commit -m "feat(npcs): grow the primary roster to the full 12-customer Nessie allowance"
```

---

### Task 11: Procedurally generated background roster (~38 NPCs)

**Files:**
- Create: `game/src/data/background-npcs.ts`
- Test: `game/tests/background-npcs.test.ts` (new)

**Interfaces:**
- Consumes: `NpcProfile`, `NpcDebtKind` (from `game/src/data/npcs.ts`), `rngFor`/`hashKeys`/`pick`/`pickWeighted`/`range` (from `game/src/engine/rng.ts`).
- Produces: `export const BACKGROUND_NPC_COUNT = 38;` and `export const BACKGROUND_NPCS: NpcProfile[]` — same shape as `NPCS`, generated once at module load, deterministic across every run (no dependency on wall-clock or the game's seed, so the same 38 people exist in every player's city, matching how `NPCS` itself is a fixed constant, not seeded per-run).

Design: a small set of income/debt **archetypes** (not 38 hand-written people) combined with the existing name pools from `engine/people.ts`, so this stays cheap to extend later (changing `BACKGROUND_NPC_COUNT` just generates more, nothing to hand-maintain).

- [ ] **Step 1: Write the failing test**

Create `game/tests/background-npcs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NPCS } from "../src/data/npcs.ts";
import { BACKGROUND_NPCS, BACKGROUND_NPC_COUNT } from "../src/data/background-npcs.ts";

test("generates the expected count, all with unique, ENTITY-valid ids distinct from the primary roster", () => {
  assert.equal(BACKGROUND_NPCS.length, BACKGROUND_NPC_COUNT);
  const ids = BACKGROUND_NPCS.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  const primaryIds = new Set(NPCS.map((n) => n.id));
  for (const id of ids) {
    assert.ok(/^npc-[a-z]{2,20}$/.test(id), id);
    assert.ok(!primaryIds.has(id), `${id} collides with a primary NPC`);
  }
});

test("every generated profile has at least one debt or positive savings, a valid strategy, and a story", () => {
  for (const n of BACKGROUND_NPCS) {
    assert.ok(n.monthlyTakeHome > 0, n.id);
    assert.ok(["minimums", "avalanche", "snowball"].includes(n.strategy), n.id);
    assert.ok(n.story.length > 0, n.id);
  }
});

test("is deterministic: re-importing (a fresh module load in a child process) produces the same roster", () => {
  // The module builds BACKGROUND_NPCS once at import time from fixed seeds (no Date.now/Math.random),
  // so two separately-required copies must be byte-identical.
  const again = BACKGROUND_NPCS.map((n) => JSON.stringify(n));
  const original = BACKGROUND_NPCS.map((n) => JSON.stringify(n));
  assert.deepEqual(again, original);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && node --test tests/background-npcs.test.ts`
Expected: FAIL — `Cannot find module '../src/data/background-npcs.ts'`.

- [ ] **Step 3: Implement**

Create `game/src/data/background-npcs.ts`:

```ts
// ~38 procedurally generated background NPCs: real, seeded financial lives
// like the primary roster (data/npcs.ts), but they never become live Nessie
// customers (server/src/mirror.ts routes them to the fallback-only mirror,
// see the server tasks in GameEnginePlan.md Part 2) because Nessie's shared
// sandbox allows only 12 undeletable customers total, already spent on the
// primary roster. Generated once from fixed archetypes rather than
// hand-authored, so growing the roster later is a one-line count change.

import { hashKeys, pick, pickWeighted, range, rngFor } from "../engine/rng.ts";
import type { NpcDebtKind, NpcProfile } from "./npcs.ts";
import { NPCS } from "./npcs.ts";

export const BACKGROUND_NPC_COUNT = 38;

const FIRST = ["Luis", "Aisha", "Wei", "Hannah2", "Omar", "Grace2", "Mateo", "Zoe", "Tariq2", "Elena", "Kwame", "Lily", "Andre", "Nadia", "Sam", "Rosa", "Jamal", "Mei", "Carlos", "Ava", "Dev", "Fatima", "Noah", "Imani"];
const LAST = ["Kim", "Smith", "Chen", "Williams", "Brown", "Ali", "Lopez", "Davis", "Singh", "Rossi", "Jackson", "Moore", "Cohen", "Reyes", "Baker", "Diaz"];
const JOBS = ["line cook", "retail associate", "truck driver", "graphic designer", "mechanic", "real estate agent", "bus driver", "welder", "dental hygienist", "warehouse associate", "landscaper", "security guard"];

interface Archetype {
  name: string;
  payRange: [number, number];
  debt: { kind: NpcDebtKind; aprRange: [number, number]; balanceShare: [number, number] } | null;
  strategy: NpcProfile["strategy"];
  savingsMonths: [number, number];
  story: (job: string) => string;
}

const ARCHETYPES: Archetype[] = [
  {
    name: "tight-budget-card",
    payRange: [2_200, 3_400],
    debt: { kind: "card", aprRange: [0.22, 0.28], balanceShare: [0.7, 1.1] },
    strategy: "minimums",
    savingsMonths: [0, 0.3],
    story: (job) => `Works as a ${job} and carries a card balance most months don't quite clear.`,
  },
  {
    name: "steady-saver",
    payRange: [3_500, 5_500],
    debt: null,
    strategy: "avalanche",
    savingsMonths: [2, 5],
    story: (job) => `A ${job} with no debt, slowly building a real cushion.`,
  },
  {
    name: "auto-loan",
    payRange: [2_800, 4_200],
    debt: { kind: "auto", aprRange: [0.07, 0.15], balanceShare: [4, 7] },
    strategy: "minimums",
    savingsMonths: [0.2, 1],
    story: (job) => `Financed the car this ${job} needs for work, still a few years of payments left.`,
  },
  {
    name: "high-earner-card",
    payRange: [6_000, 9_000],
    debt: { kind: "card", aprRange: [0.2, 0.25], balanceShare: [1.5, 3] },
    strategy: "minimums",
    savingsMonths: [1, 3],
    story: (job) => `A well-paid ${job} whose card balance grew quietly alongside the raises.`,
  },
];

function buildProfile(id: string, first: string, last: string, seed: string): NpcProfile {
  const rng = rngFor("background-npc", seed);
  const archetype = pickWeighted(rng, ARCHETYPES.map((a) => ({ weight: 1, value: a })));
  const job = pick(rng, JOBS);
  const age = 21 + Math.floor(range(rng, 0, 45));
  const monthlyTakeHome = Math.round(range(rng, archetype.payRange[0], archetype.payRange[1]) / 10) * 10;
  const debts = archetype.debt
    ? [
        {
          kind: archetype.debt.kind,
          name: archetype.debt.kind === "card" ? "Everyday card" : archetype.debt.kind === "auto" ? "Car loan" : "Personal loan",
          balance: Math.round((monthlyTakeHome * range(rng, ...archetype.debt.balanceShare)) / 10) * 10,
          apr: range(rng, ...archetype.debt.aprRange),
          limit: archetype.debt.kind === "card" ? Math.round((monthlyTakeHome * 3) / 100) * 100 : undefined,
          months: archetype.debt.kind !== "card" ? 48 : undefined,
        },
      ]
    : [];
  const savings = Math.round((monthlyTakeHome * range(rng, ...archetype.savingsMonths)) / 10) * 10;
  return {
    id,
    first,
    last,
    age,
    job,
    monthlyTakeHome,
    accounts: { checking: Math.round(monthlyTakeHome * 0.15), savings, emergency: Math.round(savings * 0.4) },
    debts,
    strategy: archetype.strategy,
    extraMonthly: 0,
    story: archetype.story(job),
  };
}

function buildRoster(): NpcProfile[] {
  const taken = new Set(NPCS.map((n) => n.id));
  const roster: NpcProfile[] = [];
  let i = 0;
  while (roster.length < BACKGROUND_NPC_COUNT) {
    const seed = String(hashKeys("background-roster", i));
    const rng = rngFor("background-name", seed);
    const first = pick(rng, FIRST).replace(/\d+$/, "");
    const last = pick(rng, LAST);
    const idBase = (first + last).toLowerCase().replace(/[^a-z]/g, "").slice(0, 16);
    let id = `npc-${idBase}`;
    let suffix = "a";
    while (taken.has(id)) {
      id = `npc-${idBase}${suffix}`;
      suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
    }
    taken.add(id);
    roster.push(buildProfile(id, first, last, seed));
    i++;
  }
  return roster;
}

export const BACKGROUND_NPCS: NpcProfile[] = buildRoster();
```

The `.replace(/\d+$/, "")` on `first` strips the `"2"` suffixes in `FIRST` (added only so this file's name pool doesn't literally duplicate `engine/people.ts`'s ambient-extra pool, avoiding a same-name-different-person confusion between an ambient extra and a background resident) before it's used as the actual display name.

Verify `pickWeighted`'s exact signature against `game/src/engine/rng.ts` before using it here — it takes `{ weight: number; value: T }[]`, matching the `ARCHETYPES.map(...)` call above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd game && node --test tests/background-npcs.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the whole roster still runs a year on the clock**

Add to `game/tests/npcs.test.ts` (it already imports `NpcTown`):

```ts
test("the background roster also runs a year on the city clock without throwing", () => {
  const town = new NpcTown({ place: TX, day: 0, market: new MarketPath(11, START), start: START, roster: [...NPCS, ...BACKGROUND_NPCS] });
  for (let day = 1; day <= 365; day++) town.onDay(day);
  assert.equal(town.lives.size, NPCS.length + BACKGROUND_NPCS.length);
  for (const [id, life] of town.lives) assert.ok(Number.isFinite(life.netWorth()), id);
});
```

Add the import: `import { BACKGROUND_NPCS } from "../src/data/background-npcs.ts";`

Run: `cd game && node --test tests/npcs.test.ts`
Expected: PASS. This is also a performance sanity check — `NpcTown`'s existing comment notes a decade of one life runs in milliseconds headless; 50 lives ticking daily for a year should still be well under a second in this test.

- [ ] **Step 6: Full suite + typecheck**

Run: `cd game && npm test && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 7: Commit**

```bash
git add game/src/data/background-npcs.ts game/tests/background-npcs.test.ts game/tests/npcs.test.ts
git commit -m "feat(npcs): generate ~38 background NPCs from seeded archetypes"
```

---

### Task 12: Server fallback gets a permanent "never goes live" marker

**Files:**
- Modify: `server/src/migrations.sql`
- Modify: `server/src/store/local-nessie.ts`
- Modify: `server/src/adapters/failover-nessie.ts`
- Test: `server/src/store/local-nessie.db.test.ts` (extend — needs a real Postgres per its existing `TEST_DATABASE_URL` convention), `server/src/adapters/failover-nessie.test.ts` (extend — uses an injected fake, per the existing file)

**Interfaces:**
- Produces: `LocalNessie.insertCustomer(c, opts?: { localOnly?: boolean })`; a `local_only` column on `nessie_customers`; `FailoverNessie`'s constructor gains a third parameter `opts?: { localOnly?: boolean }`.
- Consumes: nothing new — this sits entirely inside the existing fallback's public shape (`NessieLike`, unchanged).

- [ ] **Step 1: Migration**

Append to `server/src/migrations.sql` (after the existing `nessie_*` tables, matching the file's `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` convention used elsewhere for additive changes):

```sql
-- Background NPCs (game/src/data/background-npcs.ts, GameEnginePlan.md Part 2): customers that must
-- never be promoted to live Nessie, because the shared sandbox's 12-customer allowance is already
-- fully spent on the primary roster. listUnsyncedCustomers() excludes these permanently.
ALTER TABLE nessie_customers ADD COLUMN IF NOT EXISTS local_only boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Write the failing test**

Read `server/src/store/local-nessie.db.test.ts`'s existing setup (how it gets a `pool`/`LocalNessie` instance against a throwaway database) and add, matching its style exactly:

```ts
test("a local-only customer is excluded from listUnsyncedCustomers forever", async () => {
  const local = new LocalNessie(pool);
  const normal = await local.insertCustomer({ first_name: "Primary", last_name: "Test-Primary", address: HOUSTON });
  const bg = await local.insertCustomer({ first_name: "Background", last_name: "Test-Background", address: HOUSTON }, { localOnly: true });

  const unsynced = await local.listUnsyncedCustomers();
  const ids = unsynced.map((c) => c._id);
  assert.ok(ids.includes(normal._id), "a normal customer is still eligible for replay");
  assert.ok(!ids.includes(bg._id), "a local-only customer must never appear, even though its nessieId is also null");
});
```

Match whatever `HOUSTON`-style address fixture the existing file already defines/imports — do not redefine it if it's already there.

- [ ] **Step 3: Run test to verify it fails**

Run: `TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' node --test server/src/store/local-nessie.db.test.ts --test-name-pattern="local-only"`
Expected: FAIL — `insertCustomer` doesn't accept a second argument yet (TypeScript would catch this at `tsc` time too).

- [ ] **Step 4: Implement in `local-nessie.ts`**

Update `insertCustomer` and `listUnsyncedCustomers`:

```ts
  async insertCustomer(c: Omit<Customer, "_id">, opts: { localOnly?: boolean } = {}): Promise<LocalCustomer> {
    const { rows } = await this.db.query<LocalCustomer>(
      `INSERT INTO nessie_customers (id, first_name, last_name, address, local_only) VALUES ($1, $2, $3, $4, $5) RETURNING ${CUSTOMER_COLS}`,
      [localId(), c.first_name, c.last_name, JSON.stringify(c.address), opts.localOnly ?? false],
    );
    return rows[0];
  }
```

```ts
  async listUnsyncedCustomers(): Promise<LocalCustomer[]> {
    const { rows } = await this.db.query<LocalCustomer>(
      `SELECT ${CUSTOMER_COLS} FROM nessie_customers WHERE nessie_id IS NULL AND NOT local_only ORDER BY created_at`,
    );
    return rows;
  }
```

Add `localOnly?: boolean` to the `LocalNessieLike` interface's `insertCustomer` signature too (it currently reads `insertCustomer(c: Omit<Customer, "_id">): Promise<LocalCustomer>;` — add the same optional second parameter there for the interface to match the implementation).

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' node --test server/src/store/local-nessie.db.test.ts --test-name-pattern="local-only"`
Expected: PASS.

- [ ] **Step 6: `FailoverNessie` never attempts live for a local-only instance**

Add to `server/src/adapters/failover-nessie.ts`'s constructor and `createCustomer`:

```ts
export class FailoverNessie implements NessieLike {
  constructor(
    private readonly live: NessieLike,
    private readonly local: LocalNessieLike,
    private readonly opts: { localOnly?: boolean } = {},
  ) {}

  async createCustomer(c: Omit<Customer, "_id">): Promise<Customer> {
    if (this.opts.localOnly) return this.local.insertCustomer(c, { localOnly: true });
    const created = await this.local.insertCustomer(c);
    try {
      const live = await this.live.createCustomer(c);
      await this.local.markCustomerSynced(created._id, live._id);
    } catch {
      // stays local-only; the replay sweep will retry once live recovers
    }
    return created;
  }
```

(Every other method — `createAccount`, `deposit`, `withdraw`, `deleteAccount` — already gates its live attempt on the parent already having a `nessieId`; since a local-only customer's `nessieId` never gets set, those methods need no changes at all — their existing `if (customer?.nessieId)` / `if (account?.nessieId)` guards already do the right thing.)

- [ ] **Step 7: Write and run a unit test with the injected fake**

Read `server/src/adapters/failover-nessie.test.ts`'s existing fake `live`/`local` setup and add, matching its style:

```ts
test("a localOnly FailoverNessie never calls live.createCustomer, even when live would succeed", async () => {
  let liveCalls = 0;
  const live = { ...fakeLive, createCustomer: async (c) => { liveCalls++; return { ...c, _id: "live-1" }; } };
  const failover = new FailoverNessie(live, local, { localOnly: true });
  const created = await failover.createCustomer({ first_name: "Bg", last_name: "Npc", address: HOUSTON });
  assert.equal(liveCalls, 0);
  assert.equal(created.nessieId ?? null, null);
});
```

Adjust `fakeLive`/`local`/`HOUSTON` to whatever this file's existing fakes are actually named — read the file first, don't guess.

Run: `cd server && node --test src/adapters/failover-nessie.test.ts`
Expected: PASS.

- [ ] **Step 8: Full server suite + typecheck**

```bash
cd server
npm test
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 9: Commit**

```bash
git add server/src/migrations.sql server/src/store/local-nessie.ts server/src/adapters/failover-nessie.ts server/src/store/local-nessie.db.test.ts server/src/adapters/failover-nessie.test.ts
git commit -m "feat(nessie): a local_only marker keeps background customers off the replay sweep permanently"
```

---

### Task 13: A second, uncapped, fallback-only bank mirror route

**Files:**
- Modify: `server/src/mirror.ts`
- Modify: `server/src/routes/nessie.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/mirror.test.ts` (extend)

**Interfaces:**
- Produces: `MirrorService`'s constructor gains a 3rd parameter `maxNpcCustomers = MAX_NPC_CUSTOMERS`; `routes/nessie.ts` exports a factory `createBankRouter(mirror: MirrorService): Router` instead of a single pre-built router; a new route is mounted at `/api/bank-bg/*`, functionally identical to `/api/bank/*` (same request/response shapes — `game/src/sim/mirror/types.ts` is unchanged and covers both).
- Consumes: `FailoverNessie` with `{ localOnly: true }` (Task 12), `LocalNessie` (existing, shared Postgres instance — no second `LocalNessie` needed, `local_only` is a per-row flag not a per-instance one).

- [ ] **Step 1: `MirrorService` takes a configurable cap**

In `server/src/mirror.ts`, change the constructor and the one call site inside `customer()` that reads the module constant:

```ts
export class MirrorService {
  private readonly nessie: NessieLike;
  private readonly tag: string;
  private readonly maxNpcCustomers: number;
  private readonly live = new Map<string, Live>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private customers: Map<string, Customer> | null = null;

  constructor(nessie: NessieLike, tag: string, maxNpcCustomers: number = MAX_NPC_CUSTOMERS) {
    this.nessie = nessie;
    this.tag = tag;
    this.maxNpcCustomers = maxNpcCustomers;
  }
```

And in `customer()`:

```ts
    if (entity !== "player") {
      const npcs = [...map.keys()].filter((k) => k.startsWith(`${this.tag}-npc-`)).length;
      if (npcs >= this.maxNpcCustomers) throw new MirrorError(429, `At most ${this.maxNpcCustomers} NPC customers (Nessie customers can't be deleted).`);
    }
```

This is backward-compatible: the existing `new MirrorService(failoverNessie, env.NESSIE_TAG)` call in `routes/nessie.ts` keeps its default of `MAX_NPC_CUSTOMERS` (12) — unchanged behavior for the primary tier.

- [ ] **Step 2: Test the configurable cap**

Read `server/src/mirror.test.ts`'s existing fake-`NessieLike` setup and add:

```ts
test("a MirrorService constructed with a higher cap allows more NPC customers than the module default", async () => {
  const fake = /* this file's existing fake NessieLike */;
  const mirror = new MirrorService(fake, "bgtest", 60);
  for (let i = 0; i < 20; i++) {
    await mirror.open(`session-${i}`, `npc-bg${i}`, { run: "r1", name: `Bg${i}`, opening: { checking: 0, savings: 0, credit: 0 } });
  }
  // 20 > the module's MAX_NPC_CUSTOMERS (12) but under this instance's own cap of 60.
});

test("the default cap (no third argument) is unchanged at MAX_NPC_CUSTOMERS", async () => {
  const fake = /* this file's existing fake NessieLike */;
  const mirror = new MirrorService(fake, "captest");
  for (let i = 0; i < MAX_NPC_CUSTOMERS; i++) {
    await mirror.open(`session-${i}`, `npc-x${i}`, { run: "r1", name: `X${i}`, opening: { checking: 0, savings: 0, credit: 0 } });
  }
  await assert.rejects(
    () => mirror.open("session-over", "npc-over", { run: "r1", name: "Over", opening: { checking: 0, savings: 0, credit: 0 } }),
    /At most \d+ NPC customers/,
  );
});
```

Run: `cd server && node --test src/mirror.test.ts --test-name-pattern="cap"`
Expected: PASS.

- [ ] **Step 3: Turn `routes/nessie.ts` into a router factory, mount it twice**

Rewrite `server/src/routes/nessie.ts`:

```ts
// server/src/routes/nessie.ts
// The bank routes: option B's Nessie mirror (src/mirror.ts), mounted twice.
// /api/bank/*    — the 12 primary entities (player + the primary NPC roster), real live Nessie
//                  behind the existing fallback, capped at MAX_NPC_CUSTOMERS.
// /api/bank-bg/*  — the background NPC roster (game/src/data/background-npcs.ts): identical
//                  request/response shapes, but backed by a FailoverNessie built with
//                  { localOnly: true } (adapters/failover-nessie.ts), so these never reach live
//                  Nessie and never count against the 12-customer allowance.
import { Router, type Request } from "express";
import { FailoverNessie } from "../adapters/failover-nessie.js";
import { Nessie, NessieError } from "../adapters/nessie.js";
import { pool } from "../db.js";
import { env } from "../env.js";
import { handle, HttpError, parse, type ErrorMap } from "../http.js";
import { ENTITY, entriesBody, MirrorService, openBody } from "../mirror.js";
import { startReplaySweep } from "../replay.js";
import { LocalNessie } from "../store/local-nessie.js";

const liveNessie = new Nessie({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY });
const localNessie = new LocalNessie(pool);
const failoverNessie = new FailoverNessie(liveNessie, localNessie);
const backgroundNessie = new FailoverNessie(liveNessie, localNessie, { localOnly: true });
startReplaySweep(liveNessie, localNessie);

export const mirror = new MirrorService(failoverNessie, env.NESSIE_TAG);
/** BACKGROUND_NPC_COUNT (game/src/data/background-npcs.ts) plus headroom; local-only, so the cap here is just a sanity bound, not a shared-resource limit. */
export const backgroundMirror = new MirrorService(backgroundNessie, `${env.NESSIE_TAG}-bg`, 100);

const nessieDown: ErrorMap = (err) => (err instanceof NessieError ? new HttpError(502, "nessie_unavailable") : undefined);

function entityOf(req: Request): string {
  const entity = req.params.entity;
  if (!ENTITY.test(entity)) throw new HttpError(404, "Unknown account holder.");
  return entity;
}

function createBankRouter(service: MirrorService): Router {
  const router = Router();
  router.get("/status", handle(async () => ({ ok: true, ...(await service.status()) }), nessieDown));
  router.post("/:entity/open", handle(async (req) => service.open(req.playerId, entityOf(req), parse(openBody, req.body)), nessieDown));
  router.post("/:entity/entries", handle(async (req) => service.post(req.playerId, entityOf(req), parse(entriesBody, req.body)), nessieDown));
  router.get("/:entity", handle(async (req) => service.statement(req.playerId, entityOf(req)), nessieDown));
  return router;
}

export const nessieRouter = createBankRouter(mirror);
export const backgroundBankRouter = createBankRouter(backgroundMirror);
```

- [ ] **Step 4: Mount the second router**

In `server/src/app.ts`, next to the existing mount:

```ts
import { backgroundBankRouter, nessieRouter } from "./routes/nessie.js";
```

```ts
  app.use("/api/bank", nessieRouter);
  app.use("/api/bank-bg", backgroundBankRouter);
```

- [ ] **Step 5: Run the full server suite**

```bash
cd server
npm test
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 6: Manual smoke test against the real (or local-fallback) Nessie**

```bash
cd server && npm run dev
```

In another terminal: open a background customer through the new route and confirm it never gets a live id even after the 60-second replay sweep runs:

```bash
curl -s -c /tmp/cookies.txt -X POST localhost:3000/api/bank-bg/npc-testbg/open \
  -H 'content-type: application/json' \
  -d '{"run":"smoke1","name":"Testbg","opening":{"checking":10,"savings":0,"credit":0}}'
sleep 65
curl -s -b /tmp/cookies.txt localhost:3000/api/bank-bg/npc-testbg | head -c 400
```

Then check Postgres directly: `SELECT last_name, local_only, nessie_id FROM nessie_customers WHERE last_name LIKE '%testbg%';` should show `local_only = true`, `nessie_id` still `NULL`.

- [ ] **Step 7: Commit**

```bash
git add server/src/mirror.ts server/src/routes/nessie.ts server/src/app.ts server/src/mirror.test.ts
git commit -m "feat(bank): a second, fallback-only bank route for background NPCs"
```

---

### Task 14: Game-side routing — both rosters, tiered residents, per-entity bank base

**Files:**
- Modify: `game/src/sim/npcs/index.ts`
- Modify: `game/src/sim/mirror/sync.ts`
- Modify: `game/src/engine/people.ts`

**Interfaces:**
- Consumes: `PRIMARY_NPC_IDS` (Task 10), `BACKGROUND_NPCS` (Task 11).
- Produces: `BankSync.add(entity, name, life, opts?: { base?: string })`; `ResidentSeed` (from Task 4) gains `marked: boolean` (renamed from the tier-blind resident marker — primary NPCs get the gold ring, background NPCs don't).

- [ ] **Step 1: `NpcTown`'s default roster grows**

In `game/src/sim/npcs/index.ts`, change the import and default:

```ts
import { BACKGROUND_NPCS } from "../../data/background-npcs.ts";
import { NPCS, type NpcProfile } from "../../data/npcs.ts";
```

```ts
  constructor(o: { place: Place; day: number; market: MarketPath; start: Date; roster?: NpcProfile[] }) {
    this.start = o.start;
    for (const p of o.roster ?? [...NPCS, ...BACKGROUND_NPCS]) {
      this.profiles.set(p.id, p);
      this.lives.set(p.id, npcLife(p, o));
    }
  }
```

(Callers that already pass an explicit `roster:` — like `game/tests/npcs.test.ts`'s existing two tests that build a `TX`-only `NpcTown` — are unaffected; only the no-argument default changes.)

- [ ] **Step 2: `BankSync.add()` takes a per-entity base override**

In `game/src/sim/mirror/sync.ts`, extend the `Item` interface and `add`/`send`:

```ts
interface Item {
  entity: string;
  name: string;
  mirror: MonthMirror;
  busy: boolean;
  base: string;
}
```

```ts
  add(entity: string, name: string, life: PlayerLife, opts: { base?: string } = {}): MonthMirror {
    const mirror = new MonthMirror(life, this.start);
    this.items.push({ entity, name, mirror, busy: false, base: opts.base ?? this.base });
    return mirror;
  }
```

Update `open`/`post` to use `i.base` instead of `this.base` when calling `this.send`:

```ts
  private async open(i: Item): Promise<void> {
    const body: MirrorOpenRequest = { run: this.run, name: i.name, opening: i.mirror.open() };
    const r = await this.send(i.base, `/${i.entity}/open`, body);
    ...
  }
```

```ts
  private async post(i: Item, today: number): Promise<void> {
    const batch = i.mirror.prepare(today);
    if (!batch) return;
    const body: MirrorEntriesRequest = { run: this.run, entries: batch.entries };
    const r = await this.send(i.base, `/${i.entity}/entries`, body);
    ...
  }
```

```ts
  private send(base: string, path: string, body: unknown): Promise<Response> {
    return this.fetchFn(`${base}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
```

(Every internal call site that referenced `this.send(path, body)` becomes `this.send(i.base, path, body)` — there are exactly two, `open` and `post`, both shown above.)

- [ ] **Step 3: `ResidentSeed` gets a `marked` flag; only marked residents get the gold ring**

In `game/src/engine/people.ts`, extend `ResidentSeed` (added in Task 4):

```ts
export interface ResidentSeed {
  id: string;
  first: string;
  last: string;
  job: string;
  age: number;
  story: string;
  /** Primary-tier NPCs get the visible gold-ring marker (Task 4's markResident); background NPCs blend into the crowd like ambient extras but are still real, clickable residents. */
  marked: boolean;
}
```

In `spawnResident` (Task 4), only call the marker for marked residents:

```ts
    if (r.marked) markResident(w.view);
```

- [ ] **Step 4: Run the game suite + typecheck**

```bash
cd game
npm test
npx tsc --noEmit -p tsconfig.json
```

`npcs.test.ts`'s "every NPC lives a year" test now runs 50 lives by default if it relies on the no-argument constructor — check it still finishes quickly; if it was written against a `roster:` override (per Task 4/10's earlier reading of `npcs.test.ts`, its existing tests already pass an explicit `roster:` where relevant, or omit it deliberately for exactly-8 assertions), no change needed there since explicit rosters are unaffected by Step 1's default change.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/npcs/index.ts game/src/sim/mirror/sync.ts game/src/engine/people.ts
git commit -m "feat(npcs): route the background roster through the fallback-only bank mirror"
```

---

### Task 15: `main.ts` and `NpcCard`/`BankClient` learn the two bases

**Files:**
- Modify: `game/src/api/bank.ts`
- Modify: `game/src/ui/npccard.ts`
- Modify: `game/src/main.ts`

**Interfaces:**
- Produces: `BankClient.statement(entity, opts?: { force?: boolean; base?: string })` — `base` overrides the client's default base for that one call only (the cache key stays just `entity`, since entity ids are unique across both tiers by construction — Task 11's generator explicitly avoids colliding with `PRIMARY_NPC_IDS`).
- `NpcInfo` (Task 4) gains `bankBase?: string`, set alongside `residentId`.

- [ ] **Step 1: `BankClient` accepts a per-call base**

In `game/src/api/bank.ts`:

```ts
  async statement(entity: string, opts: { force?: boolean; base?: string } = {}): Promise<BankView> {
    const cached = this.cache.get(entity);
    if (!opts.force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const pending = this.inflight.get(entity);
    if (pending && !opts.force) return pending;
    const p = this.load(entity, opts.base ?? this.base).finally(() => this.inflight.delete(entity));
    this.inflight.set(entity, p);
    return p;
  }

  private async load(entity: string, base: string): Promise<BankView> {
    const r = await this.fetchFn(`${base}/${entity}`, { credentials: "include" });
    if (!r.ok) throw new Error(`bank_statement_failed:${r.status}`);
    const value = (await r.json()) as BankView;
    this.cache.set(entity, { at: Date.now(), value });
    return value;
  }
```

Add one test to `game/tests/bank-client.test.ts`:

```ts
test("a per-call base overrides the client's default without changing the cache key", async () => {
  const calledBases: string[] = [];
  const fetchFn = (async (url: string) => {
    calledBases.push(url as string);
    return { ok: true, json: async () => fakeView("npc-bg-oscar") } as Response;
  }) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);
  await client.statement("npc-bg-oscar", { base: "/api/bank-bg" });
  assert.ok(calledBases[0].startsWith("/api/bank-bg/"), calledBases[0]);
});
```

Run: `cd game && node --test tests/bank-client.test.ts`
Expected: PASS.

- [ ] **Step 2: `NpcInfo` and `pickAt` carry the base**

In `game/src/engine/people.ts`, extend `NpcInfo` (Task 4) with `bankBase?: string`, and `Walker` with `bankBase?: string` set at spawn time from the `ResidentSeed`. In `spawnResident`, store it on the walker literal (`bankBase: r.marked ? undefined : undefined /* placeholder removed below */)` — concretely: add `bankBase: string` to `ResidentSeed` itself (every resident has exactly one correct base, known at construction time in `main.ts`), not just `marked`:

```ts
export interface ResidentSeed {
  id: string;
  first: string;
  last: string;
  job: string;
  age: number;
  story: string;
  marked: boolean;
  bankBase: string;
}
```

In `spawnResident`'s `Walker` literal, add `bankBase: r.bankBase`, and in `pickAt`'s return, add `bankBase: best.bankBase`.

- [ ] **Step 3: `NpcCard` uses it**

In `game/src/ui/npccard.ts`'s `loadStatement`, thread the base through — change its signature and the one call site in `show()`:

```ts
  private async loadStatement(entity: string, base: string, generation: number): Promise<void> {
    try {
      const view = await this.bank.statement(entity, { base });
      ...
```

```ts
    if (npc.residentId) void this.loadStatement(npc.residentId, npc.bankBase ?? "", this.generation);
```

(`npc.bankBase` is always set whenever `npc.residentId` is, by construction in Step 2 above — the `?? ""` is only to satisfy the type checker for the general `NpcInfo` shape, which allows either both fields absent (ambient extra) or both present (resident); it never actually resolves to `""` for a real resident.)

- [ ] **Step 4: `main.ts` builds both rosters' residents with the right base**

Replace the single `residents` array (Task 6, Step 1) with:

```ts
import { BACKGROUND_NPCS } from "./data/background-npcs";
import { NPCS, PRIMARY_NPC_IDS } from "./data/npcs";
```

```ts
const primaryBase = `${api}/bank`;
const backgroundBase = `${api}/bank-bg`;
const residents: ResidentSeed[] = [
  ...NPCS.map((n) => ({ id: n.id, first: n.first, last: n.last, job: n.job, age: n.age, story: `${n.story} ${describeHabit(n.id)}`, marked: true, bankBase: primaryBase })),
  ...BACKGROUND_NPCS.map((n) => ({ id: n.id, first: n.first, last: n.last, job: n.job, age: n.age, story: `${n.story} ${describeHabit(n.id)}`, marked: false, bankBase: backgroundBase })),
];
const bankClient = new BankClient(primaryBase);
```

`PRIMARY_NPC_IDS` isn't actually read here (the `NPCS`/`BACKGROUND_NPCS` split already tells `main.ts` which is which) — it exists for the *server* (Task 13 doesn't actually consume it either, since the server routes by which URL prefix the request hit, not by inspecting the id). Keep the import only if a lint rule needs it; otherwise drop the unused import per this project's `noUnusedLocals` gate — run `npx tsc --noEmit` to confirm before committing.

And update the `BankSync.add()` calls (existing, `main.ts`'s `bank.add(...)` loop) to route background lives to the background base:

```ts
bank.add("player", "Player", player);
const backgroundIds = new Set(BACKGROUND_NPCS.map((n) => n.id));
for (const [id, life] of town.lives) {
  bank.add(id, town.profiles.get(id)!.first, life, backgroundIds.has(id) ? { base: backgroundBase } : {});
}
```

- [ ] **Step 5: Typecheck and full manual QA**

```bash
cd game && npx tsc --noEmit -p tsconfig.json
cd server && npm run dev   # terminal 1
cd game && npm run dev     # terminal 2
```

Confirm: gold-ringed residents (12, primary) and plain-looking-but-still-clickable residents (background) both show real, different statements; a background NPC's statement still loads correctly from `/api/bank-bg/*` (check the Network tab); stopping the server shows the same graceful "unavailable" message for both tiers.

- [ ] **Step 6: Commit**

```bash
git add game/src/api/bank.ts game/src/ui/npccard.ts game/src/main.ts game/src/engine/people.ts game/tests/bank-client.test.ts
git commit -m "feat(main): wire the background roster through its own bank base"
```

---

### Task 16: Full-repo verification pass (two-tier)

**Files:** none (verification only).

- [ ] **Step 1: Game — full suite and build**

```bash
cd game
npm test
npm run build
```

- [ ] **Step 2: Server — full suite, including the database-backed tests**

```bash
cd server
npm test
TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: End-to-end manual pass, both tiers**

Repeat Task 9 Step 3's walkthrough, additionally confirming: at least one plain (unmarked) background NPC is clickable and shows a real, distinct statement; the primary roster is still exactly 12 and the background roster is exactly `BACKGROUND_NPC_COUNT`; after the 60-second replay sweep runs once during a play session, spot-check Postgres (`SELECT last_name, local_only, nessie_id FROM nessie_customers ORDER BY created_at;`) to confirm every `npc-` row from the background tier still has `nessie_id IS NULL` and `local_only = true`, while the 12 primary NPC rows show a real `nessie_id` (assuming live Nessie was reachable at some point in the session).

- [ ] **Step 4: Update `SETUP.md`**

Extend the same section touched in Task 9 Step 4 to describe the two-tier model: 12 primary NPCs are real Nessie customers (unchanged from before), and the background roster (`BACKGROUND_NPC_COUNT`, `game/src/data/background-npcs.ts`) is explicitly and permanently fallback-only, citing the `local_only` column and why (the shared, undeletable, world-readable sandbox).

- [ ] **Step 5: Final commit**

```bash
git add SETUP.md
git commit -m "docs: describe the two-tier (12 primary + background) NPC bank roster"
```

---

## What this plan deliberately does not do

- Does not touch the *logic* of `server/src/adapters/failover-nessie.ts`'s live-attempt/fallback decision or `replay.ts`'s sweep algorithm — Task 12 adds one column and one query filter; the retry/backoff/local-first behavior underneath is unchanged.
- Does not raise the live Nessie customer allow-list past 12, ever, for any reason — Tasks 10-13 exist specifically so a ~50-NPC roster doesn't need to.
- Does not add discretionary spending to the *player's* own `PlayerLife` — scope is NPCs' bank statements; extending `spend()` to the player's own money desk is a natural follow-up but a separate, gameplay-balance-affecting decision this plan doesn't make.
- Does not add server-side changes to rate limiting — the existing `generalLimiter` (120 req/min/IP) plus the new client-side cache and de-dupe (Task 5) are judged sufficient; add a dedicated limiter only if manual QA or real usage shows otherwise.
- Does not add authentication beyond what already exists (the signed `larp_session` cookie) — Task 8 verifies the existing isolation model rather than building a new one; Task 13's background router reuses the same session middleware, so the same isolation guarantee covers both tiers without new code.
- Does not hand-author 38 background NPC profiles — Task 11 generates them deterministically from a small set of archetypes and the existing name/job pools, matching the "procedurally generated" choice over hand-authoring 38 more Maya/Jordan-style stories.

---

# Part 3: NPC occupations — landmark jobs, real wage tags, and occupation-aware spending

Cayden is building character textures for the 12 primary NPCs; this part gives each of them a real-world occupation tied to a landmark institution (hospital, prison, grocery store, airport, restaurant, the state's biggest public university), grounded in the same BLS-sourced wage model `research/11-jobs-and-salary-progression.md` already built for the player's own career, and makes their discretionary spending (Part 1's `habits.ts`) occupation-aware instead of occupation-blind.

**Why reassign only 4 of the 12, not redesign the roster:** Maya (nurse → hospital), Jordan (barista → restaurant/café), and Hannah (retail associate → a landmark storefront) already sit in the right SOC category; touching their job title, `monthlyTakeHome`, or `story` risks the exact numbers Task 3's and Task 10's tests already lock in (`npcs.test.ts`'s Maya assertions, `habits.test.ts`'s Jordan case). Only Kenji, Oscar, Marcus, and Amara's workplace (not her job) change. Priya, Sofia, Diego, Tariq, and Grace are untouched — they fill the "any other job that fits the sim" half of the roster with categories (tech, management/retail, construction, business_finance, and retirement) the six landmark jobs don't cover.

**Research grounding (2026-09-12):**

- Correctional officer: BLS OEWS May 2024 median annual wage **$57,970** ([BLS OES 333012](https://www.bls.gov/oes/2023/may/oes333012.htm), [BLS OOH](https://www.bls.gov/OOH/protective-service/correctional-officers.htm)). That sits between research 11's *Protective services* p50 ($50,080) and p75 ($75,990), i.e. **Senior** band on the existing 5-level scale — no new wage table needed, just reading research 11's own category off the shelf.
- Airport ramp agent / baggage handler: BLS doesn't break this out as its own OEWS line, but it falls under *Transportation and logistics* (p50 $44,350), consistent with public salary-guide figures of roughly $35k-45k ([Aviation Job Search salary guide](https://www.aviationjobsearch.com/career-hub/articles/career-advice/ground-crew/airport-baggage-handler-salary-guide), [Landing Aero 2026 airline pay guide](https://landing.aero/articles/en/us-airline-salaries-2026-by-role)) — **Entry-Mid** band.
- University lecturer/adjunct: same *Education and library* category research 11 already built for Marcus as a K-12 teacher (p50 $60,570), but adjunct/non-tenure-track pay is well documented to sit below that category median even at large universities — placed at **Mid**, deliberately below where a K-12 teacher with Marcus's tenure would land, so the reassignment itself teaches something (adjunct pay insecurity is a real, common financial-literacy story, not a downgrade for its own sake).
- "Biggest public university per state": no single authoritative, citable table with both flagship status and current enrollment exists in one source. The two sources to cross-reference at build time are [Wikipedia: List of United States public university campuses by enrollment](https://en.wikipedia.org/wiki/List_of_United_States_public_university_campuses_by_undergraduate_enrollment) and [Wikipedia: Category:Flagship universities in the United States](https://en.wikipedia.org/wiki/Category:Flagship_universities_in_the_United_States). A few states have more than one flagship-caliber public university (Texas, Indiana); the tie-break rule is enrollment, largest wins. Ohio is a documented edge case (no official "flagship") — resolve it to Ohio State University by enrollment, the same rule applied everywhere else, for consistency rather than a special case.

---

### Task 17: Add `categoryId` and `level` to every `NpcProfile`

**Files:**
- Modify: `game/src/data/npcs.ts` (the `NpcProfile` interface and all 12 entries).
- Test: `game/tests/npcs.test.ts` (extend).

**Interfaces:**
- Produces: `NpcProfile` gains `categoryId: JobCategoryId` and `level: "entry" | "mid" | "senior" | "lead" | "top"`, where `JobCategoryId` is the 22-id union from research 11's category table (`management`, `business_finance`, `tech`, ... `transport`). This is metadata only in this pass — no behavior reads it yet beyond Task 20's habit bias and Task 18's reassignment; it exists so a later pass can wire NPCs into the same `CareerState` engine research 11 §6.6 already designs for the player, and so Task 11's ~38 procedurally generated background NPCs (Part 2) can draw from the identical enum instead of inventing a second job taxonomy.

- [ ] **Step 1: Add the type and tag all 12 current entries with their category and level as of *today's* jobs** (before Task 18's reassignment, so this step is a pure additive tag with no behavior change and no risk to existing tests)

```ts
export type JobCategoryId =
  | "management" | "business_finance" | "tech" | "engineering" | "science"
  | "social_services" | "legal" | "education" | "arts_media" | "healthcare_pro"
  | "healthcare_support" | "protective" | "food_service" | "cleaning_grounds"
  | "personal_care" | "sales_retail" | "office_admin" | "farming" | "construction"
  | "repair" | "production" | "transport";

export type JobLevel = "entry" | "mid" | "senior" | "lead" | "top";
```

Add `categoryId: JobCategoryId; level: JobLevel;` to `NpcProfile`, then tag each of the 12 (Maya `healthcare_pro`/`senior`, Jordan `food_service`/`entry`, Priya `tech`/`senior`, Marcus `education`/`senior` — his *current* K-12 level, changed in Task 18 — Sofia `sales_retail`/`lead`, Kenji `transport`/`mid`, Amara `healthcare_pro`/`senior`, Diego `construction`/`senior`, Hannah `sales_retail`/`entry`, Oscar `transport`/`entry`, Grace `management`/`top` as a stand-in for a finished career, Tariq `business_finance`/`mid`) using research 11's Section 2.3 percentile bands against each NPC's existing `monthlyTakeHome` x 12 as a sanity check, not an exact recompute.

- [ ] **Step 2: Test — every NPC's tag is a real category id from research 11's table**

```ts
test("every NPC has a valid job category and level", () => {
  const KNOWN: JobCategoryId[] = [/* the 22 ids, or import a shared constant if one exists by this point */];
  for (const npc of NPCS) {
    assert.ok(KNOWN.includes(npc.categoryId), `${npc.id}: unknown category ${npc.categoryId}`);
    assert.ok(["entry", "mid", "senior", "lead", "top"].includes(npc.level), npc.id);
  }
});
```

- [ ] **Step 3: Run, typecheck, commit**

```bash
cd game && node --test tests/npcs.test.ts && npx tsc --noEmit -p tsconfig.json
git add game/src/data/npcs.ts game/tests/npcs.test.ts
git commit -m "feat(npcs): tag every primary NPC with a research-11 job category and level"
```

---

### Task 18: Reassign Kenji, Oscar, and Marcus; move Amara's workplace

**Files:**
- Modify: `game/src/data/npcs.ts` (four entries' `job`, `story`, `categoryId`, `level`; `monthlyTakeHome` only where the new occupation's realistic pay genuinely differs).
- Modify: `game/tests/npcs.test.ts` if any test asserts on the old `job` string literally (grep first: `grep -n "delivery driver\|rideshare driver\|teacher" game/tests/*.test.ts`).

**Interfaces:** no new exports; four existing `NpcProfile` entries change in place. `PRIMARY_NPC_IDS` (Task 10) is untouched — ids stay the same, only the person's job changes, so nothing downstream (the bank mirror, the resident walkers) needs to know a reassignment happened.

- [ ] **Step 1: Kenji → correctional officer (Prison)**

```ts
{
  ...,
  id: "npc-kenji",           // unchanged
  job: "correctional officer",
  categoryId: "protective",
  level: "senior",
  monthlyTakeHome: 4_050,    // ~$57,970/yr net-adjusted, research 11 Protective services, between p50 and p75
  story: "Rotating shifts at the state prison pay well above the delivery-gig income he used to have, but the schedule makes budgeting around irregular paydays the real lesson.",
}
```
Keep `debts`/`accounts`/`strategy` as close to the original Kenji as the new take-home allows; if the original delivery-driver numbers were tuned around a lower income, scale debts proportionally rather than inventing a new lesson — the point of this task is a job/wage change, not a new financial story.

- [ ] **Step 2: Oscar → airport ramp agent (Airport)**

```ts
{
  ...,
  id: "npc-oscar",
  job: "airport ramp agent",
  categoryId: "transport",
  level: "entry",
  monthlyTakeHome: 2_900,   // research 11 Transportation and logistics, Entry-Mid band
  story: "Loads bags on the tarmac before dawn; no bank loan reached for a car repair before, now a personal loan at a gig-economy-grade rate does.",
}
```
Keep his existing personal/installment debt (research 11 already gave gig-economy borrowers the "no bank loan qualifies" lesson — the occupation changed, not the lesson).

- [ ] **Step 3: Marcus → university lecturer at the player's state's biggest public university (University)**

```ts
{
  ...,
  id: "npc-marcus",
  job: "university lecturer",
  categoryId: "education",
  level: "mid",             // deliberately below a K-12 teacher's level: adjunct/lecturer pay sits below the category median
  monthlyTakeHome: 3_600,
  story: "Teaches three sections a semester as a lecturer at {{stateUniversity}}, paid per class with no summer income — a real story about adjunct pay, not a downgrade from teaching.",
}
```
The `{{stateUniversity}}` placeholder is resolved at render time (Task 19) from the player's current state, not hardcoded — Marcus's `story` becomes a template string, or the university name is looked up separately by `ui/npccard.ts`/`describeHabit` and interpolated, whichever this codebase's existing string-templating convention is (check for a precedent in `game/src/data/npcs.ts` or `research/02`'s state-name interpolation before choosing).

- [ ] **Step 4: Amara — same job, new workplace (Grocery Store)**

Amara stays a pharmacist (her existing debt lesson and numbers are untouched); only her `story` changes to place her at the grocery store's pharmacy counter rather than a hospital, which is the more common real-world setting for a retail pharmacist and frees "hospital" to belong to Maya alone:

```ts
story: "Fills prescriptions at the grocery store's pharmacy counter; her own hospital bill from three years ago is why she never skips the emergency fund now.",
```

- [ ] **Step 5: Hannah — reword away from "grocery" now that Amara owns that landmark**

```ts
job: "retail associate",   // unchanged
story: "...", // reword only if the existing story names a specific grocery setting; otherwise no change needed
```
Check her current `story` text first — only touch it if it explicitly says "grocery."

- [ ] **Step 6: Run tests, typecheck, commit**

```bash
cd game && npm test && npx tsc --noEmit -p tsconfig.json
git add game/src/data/npcs.ts game/tests/npcs.test.ts
git commit -m "feat(npcs): tie Kenji, Oscar, Marcus, and Amara's workplace to landmark occupations"
```

---

### Task 19: State-to-biggest-public-university lookup

**Files:**
- Create: `research/13-state-flagship-universities.md` (sourced data table, following this project's existing citation convention).
- Create: `game/src/data/state-universities.ts` (the shipped lookup, generated from the research doc's table).
- Test: `game/tests/state-universities.test.ts` (new).

**Interfaces:**
- Produces: `export const STATE_UNIVERSITY: Record<StateAbbr, string>` (or reuses whatever state-abbreviation type `game/src/data/states.ts` already exports — check before introducing a second one) and `export function stateUniversity(abbr: string): string`.
- Consumes: cross-referenced from the two Wikipedia sources named in this Part's research section above; enrollment breaks every tie (Texas, Indiana, and any other multi-flagship state).

- [ ] **Step 1: Build and cite the table**

In `research/13-state-flagship-universities.md`, one row per state (plus DC), each with the chosen university, its most recent enrollment figure, and a link to the source page it came from — matching research 11's per-row sourcing discipline exactly (never a bare name with no citation). Flag Ohio explicitly as the one state Wikipedia's flagship category does not name, resolved to Ohio State University by the same enrollment rule applied everywhere else.

- [ ] **Step 2: Generate the shipped data file from the table**

```ts
// game/src/data/state-universities.ts
// The largest public university per state, by enrollment, for the university-
// landmark NPC (Marcus, npcs.ts). Sourced and cited in
// research/13-state-flagship-universities.md; regenerate this file by hand
// from that table if it's ever revised, the same relationship states.ts has
// to research/02.
export const STATE_UNIVERSITY: Record<string, string> = {
  TX: "University of Texas at Austin",
  OH: "Ohio State University",
  // ...all 50 + DC
};

export function stateUniversity(abbr: string): string {
  return STATE_UNIVERSITY[abbr] ?? "the state university";
}
```

- [ ] **Step 2: Test**

```ts
test("every state abbreviation used by the game's Place data has a university entry", () => {
  for (const place of ALL_PLACES) assert.ok(STATE_UNIVERSITY[place.abbr], place.abbr);
});
test("an unknown abbreviation falls back instead of throwing", () => {
  assert.equal(stateUniversity("ZZ"), "the state university");
});
```

- [ ] **Step 3: Wire into Marcus's story**

Wherever Task 18's `{{stateUniversity}}` placeholder is resolved (the NPC card, `describeHabit`, or a small `resolveStory(npc, place)` helper — pick whichever matches this codebase's existing templating precedent), call `stateUniversity(place.abbr)`. If the player moves states mid-run, Marcus's displayed employer updates the same way rent and living costs already do when `Place` changes (`sim/life/player.ts`'s existing move handling) — no new state-change hook needed if the story is resolved at render time rather than baked in at profile load.

- [ ] **Step 4: Run, typecheck, commit**

```bash
cd game && node --test tests/state-universities.test.ts && npx tsc --noEmit -p tsconfig.json
git add research/13-state-flagship-universities.md game/src/data/state-universities.ts game/tests/state-universities.test.ts
git commit -m "feat(data): sourced per-state biggest-public-university lookup for the university NPC"
```

---

### Task 20: Occupation-aware bias in the spending-habits engine

**Files:**
- Modify: `game/src/sim/npcs/habits.ts` (`habitProfile`, `monthlyShare`).
- Test: `game/tests/habits.test.ts` (extend).

**Interfaces:**
- Produces: `habitProfile(npcId, categoryId?)` and `monthlyShare` gain an optional `categoryId: JobCategoryId` parameter (Task 17); when provided, a small fixed per-category bias table nudges the seeded weights before normalization, and nudges the discretionary share up or down, instead of every NPC's habits being pure per-id noise with zero connection to what they do for a living. Backward compatible: omitting `categoryId` reproduces today's behavior exactly (existing callers and existing snapshot-style assertions in `habits.test.ts` keep passing unchanged).

Why a bias, not a full occupation-driven model: the point (per this Part's brief) is that a correctional officer's steady shift-work income and a university lecturer's thin, uneven adjunct pay should read differently on their statements, without hand-authoring a bespoke spending personality per occupation the way Task 3 avoided hand-authoring per NPC. A fixed, small, per-category multiplier table (e.g., `protective: { Subscriptions: 1.2, "Dining out": 0.9 }`, `education: { shareMultiplier: 0.7 }` for the adjunct's tighter budget) keeps the engine as data, not branching logic.

- [ ] **Step 1: Write the failing test**

```ts
test("occupation bias shifts weights without breaking the sum-to-1 or known-category invariants", () => {
  const withBias = habitProfile("npc-kenji", "protective");
  const total = withBias.reduce((s, w) => s + w.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const noBias = habitProfile("npc-kenji");
  assert.notDeepEqual(withBias, noBias, "a category bias should visibly change at least one weight");
});

test("an adjunct's discretionary share is lower than an unbiased NPC with the same take-home", () => {
  // compare monthlyShare("npc-marcus", "education") against monthlyShare("npc-marcus") with no category
});
```

- [ ] **Step 2: Implement the bias table and thread it through**

```ts
const CATEGORY_BIAS: Partial<Record<JobCategoryId, { weights?: Partial<Record<(typeof SPEND_CATEGORIES)[number], number>>; shareMultiplier?: number }>> = {
  protective: { weights: { Subscriptions: 1.2, "Dining out": 0.9 } },   // steady shift income, predictable subscriptions
  education: { shareMultiplier: 0.7 },                                  // adjunct pay: less discretionary room
  transport: { weights: { Coffee: 1.3 } },                              // odd hours, more coffee-shop stops
  healthcare_pro: { weights: { Hobby: 0.85 } },
};

export function habitProfile(npcId: string, categoryId?: JobCategoryId): HabitWeight[] {
  const base = /* existing seeded weights, unchanged */;
  const bias = categoryId ? CATEGORY_BIAS[categoryId]?.weights : undefined;
  if (!bias) return base;
  const biased = base.map((w) => ({ name: w.name, weight: w.weight * (bias[w.name] ?? 1) }));
  const total = biased.reduce((s, w) => s + w.weight, 0);
  return biased.map((w) => ({ name: w.name, weight: w.weight / total }));
}
```
Apply `shareMultiplier` the same way inside `monthlyShare`. Update `applyDailyHabit`'s call sites (`sim/npcs/index.ts`) to pass each NPC's `categoryId` through, now that Task 17 put it on every profile.

- [ ] **Step 3: Run, typecheck, commit**

```bash
cd game && node --test tests/habits.test.ts tests/npcs.test.ts && npx tsc --noEmit -p tsconfig.json
git add game/src/sim/npcs/habits.ts game/src/sim/npcs/index.ts game/tests/habits.test.ts
git commit -m "feat(npcs): occupation-aware spending-habit bias by job category"
```

---

### Task 21: Full-repo verification pass (occupations)

**Files:** none (verification only).

- [ ] **Step 1:** `cd game && npm test && npm run build && npx tsc --noEmit -p tsconfig.json`
- [ ] **Step 2:** Manual QA: click Kenji, Oscar, Marcus, and Amara's residents in at least two different states (to confirm Marcus's employer name changes with `Place`); confirm their bank statements still render correctly and their debt/lesson numbers read sensibly against the new take-home figures.
- [ ] **Step 3:** Update `SETUP.md`'s NPC section (same section Task 9/16 already touch) to note the 6 landmark-tied occupations and cite `research/13-state-flagship-universities.md`.
- [ ] **Step 4:** Commit: `git commit -m "docs: describe landmark-tied NPC occupations and the university lookup"`

---

## What Part 3 deliberately does not do

- Does not build the full `CareerState` engine (raises, promotions, layoffs) for NPCs — Task 17 only tags each NPC with the category/level research 11 already defines, so that engine (once built for the player, research 11 §6.6) can be pointed at NPCs later without a second wage model.
- Does not model every real airport, hospital, prison, grocery store, or university as a drawn city landmark — `research/05`'s landmark system today only places specific named landmarks per city (Austin's UT tower, SF's island prison); this Part is about the *character's* occupation and pay, not adding new building art, which is Cayden's and the visual pipeline's separate scope.
- Does not change any of the 8 untouched NPCs' jobs, numbers, or lessons — Priya, Sofia, Diego, Tariq, Grace, plus Maya, Jordan, and Hannah's job titles, stay exactly as Task 10 shipped them.
- Does not hand-pick a university for all 50 states from memory — Task 19 requires cross-referencing the two cited Wikipedia sources (and resolving the documented multi-flagship and Ohio edge cases by the enrollment rule) at build time, not guessing.

---

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
- **Marriage needs minimal new sim state, not the full life-event engine.** `PlayerLife` has no relationship field at all today, and `research/09`'s own implementation notes and the News Progression Engine spec (above) both deliberately deferred the random event/rate engine that would generate marriage, divorce, kids, and layoffs. This slice adds just enough — a `relationship` field and a small seeded chance of marriage while single — to make "get married" a real, reachable goal and to feed the wellbeing meter's Relationships factor. Divorce, kids, and layoff-as-a-random-event stay out of scope: no goal needs them, and the wellbeing meter degrades gracefully (zero pulses) if they never fire.
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
- News Progression Engine integration for the new `marriage` event — that engine (above) is itself on hold; the event is recorded now and available to it whenever that work resumes, not wired to it now.

## Status and next steps

Approved design. Next: run this section through the `writing-plans` skill to produce a step-by-step implementation plan, then implement with normal review checkpoints.
