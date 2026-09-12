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
