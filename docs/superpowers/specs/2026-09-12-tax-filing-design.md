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
- **Server scope for this slice:** record the events, don't build the News Engine integration. Tax events are recorded through the existing `RunRecorder` → `insertEvents` path (`server/src/store/runs.ts`) as new `LifeEvent` kinds — no new table, no new route. They become available to the News Progression Engine ([`2026-09-12-news-progression-engine-design.md`](2026-09-12-news-progression-engine-design.md)) whenever that work resumes, since that engine is itself on hold; wiring actual scoring/story-writing for tax events now would jump ahead of a design that isn't being built yet.

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
- **Scalable:** reuses the same batched event-insert path the News Progression Engine design already validated as safe for thousands-of-days fast-forwards; adding tax events doesn't add a new hot-path dependency.

## Explicitly out of scope for this slice

- Married filing jointly, dependents, and the Child Tax Credit (no sim state for marital status or kids yet — tracked as future work once `research/09`'s wellbeing-meter marital status field is actually modeled).
- Itemized deductions and additional schedules (Schedule A/C/1/2) — the simplified 1040-style shape only.
- Mid-year state-move proration (file using the state lived in on Dec 31 of the tax year, the same simplification `research/02` already proposed).
- News Progression Engine scoring/story-writing for tax events — events are recorded now, scored later, once that engine itself resumes.

## Status and next steps

Approved design. Next: run this section through the `writing-plans` skill to produce a step-by-step implementation plan, then implement with normal review checkpoints.
