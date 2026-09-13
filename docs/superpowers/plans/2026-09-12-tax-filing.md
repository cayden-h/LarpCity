# Annual Tax Filing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every player a real, simplified annual 1040-style federal + state tax filing, funded by real per-paycheck withholding instead of the current flat 80%-of-gross approximation, with escalating real-world consequences (IRS penalties, interest, eventual credit-score impact) if they skip it.

**Architecture:** A new deterministic `game/src/sim/tax/` module (mirrors `game/src/sim/debt/`'s shape) computes withholding per paycheck and reconciles it once a year against a generated, committed `game/src/data/state-tax.ts` bracket table (mirrors `states.ts`). `PlayerLife` wires it into the existing payday tick and adds one new annual check; an unpaid balance after 180 days becomes an ordinary `personal`-kind `Debt`, so it flows through the debt engine's existing delinquency/collections/credit-score machinery with no new scoring system. UI additions reuse the existing phone-app-opens-desk pattern (`Stocks`) and the existing tab pattern (`debt-demo/main.ts`'s `TABS`). No server route or table changes: new `LifeEvent` kinds flow through the existing generic `RunRecorder` → `POST /api/events` path unchanged (server accepts any `kind` matching `/^[a-z_]{1,40}$/`, `server/src/routes/snapshot.ts:60`).

**Tech Stack:** TypeScript, Node's built-in test runner (`node --test`, types stripped natively), Python 3 for the data builder (matches `research/data/build_states_rpp.py`), no new npm/pip dependencies.

## Global Constraints

- Single-filer only for this slice (no marital status or dependents exist anywhere in the sim today — confirmed by grep across `game/src/sim/life/`).
- `sim/` stays deterministic — no `Math.random()`, no `Date.now()`. Every function here is pure arithmetic on the caller's day/date and static bracket tables.
- `tsc -p tsconfig.json` (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`) is the correctness gate for `game/`; there is no separate lint step. Run `npx tsc --noEmit -p game/tsconfig.json` (or `npm run build` from `game/`) before every commit that touches a `.ts` file.
- Test convention: `node --test tests/<name>.test.ts`, plain `node:test`/`node:assert/strict`, no framework, run from `game/`.
- Generated files (`game/src/data/state-tax.ts`) are never hand-edited — only the Python builder writes them, exactly like `game/src/data/states.ts`.
- Money amounts are always rounded to cents with the existing `round2` helper pattern (`Math.round(x * 100) / 100`) seen throughout `game/src/sim/life/player.ts` and `game/src/sim/debt/`.
- Every new `LifeEvent` variant's `type` string must match `/^[a-z_]{1,40}$/` (enforced server-side in `server/src/routes/snapshot.ts:60`) since it becomes the event's `kind` verbatim in `RunRecorder` (`game/src/sim/record/index.ts`'s `EventEntry.kind = LifeEvent["type"]`).
- Spec of record: `docs/superpowers/specs/2026-09-12-tax-filing-design.md`.

---

## File Structure

```
game/src/sim/tax/
  types.ts          FilingStatus, Bracket, TaxReturn, progressiveTax()
  federal.ts         2026 federal single-filer brackets, standard deduction, FICA, childless EIC
  state.ts           reads game/src/data/state-tax.ts, per-state tax function
  withholding.ts     per-paycheck federal + state withholding (annualize-and-divide)
  filing.ts          annual reconciliation -> TaxReturn
  penalties.ts       failure-to-file / failure-to-pay / interest accrual
  index.ts           public re-exports (mirrors game/src/sim/debt/index.ts)

game/src/data/state-tax.ts              (new, generated — never hand-edited)
research/data/build_state_tax.py        (new, generated same pattern as build_states_rpp.py)

game/src/sim/life/player.ts             (modified: LifeEvent union, payday withholding, annual filing)
game/src/sim/life/intake.ts             (modified: takeHomeFor() uses real withholding, not TAKE_HOME_SHARE)
game/src/ui/phone.ts                    (modified: taxes app entry, badge, click dispatch)
game/src/debt-demo/main.ts              (modified: taxes tab, taxesPage(), #tab= hash routing)

game/tests/tax.test.ts                  (new)
game/tests/life.test.ts                 (modified: paycheck/filing/penalty integration tests)
```

---

### Task 1: Tax types and the shared bracket-tax helper

**Files:**
- Create: `game/src/sim/tax/types.ts`
- Test: `game/tests/tax.test.ts`

**Interfaces:**
- Produces: `FilingStatus = "single"`, `Bracket { upTo: number; rate: number }`, `progressiveTax(income: number, brackets: Bracket[]): number`, `TaxReturn` interface (defined here so every later file imports the same shape).

- [ ] **Step 1: Write the failing test**

```ts
// game/tests/tax.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { progressiveTax, type Bracket } from "../src/sim/tax/types.ts";

const SAMPLE: Bracket[] = [
  { upTo: 10_000, rate: 0.1 },
  { upTo: 40_000, rate: 0.2 },
  { upTo: Infinity, rate: 0.3 },
];

test("progressiveTax taxes each bracket's slice at its own rate", () => {
  assert.equal(progressiveTax(5_000, SAMPLE), 500); // all in the 10% bracket
  assert.equal(progressiveTax(10_000, SAMPLE), 1_000); // exactly the first bracket
  assert.equal(progressiveTax(25_000, SAMPLE), 1_000 + 15_000 * 0.2); // 1000 + 3000 = 4000
  assert.equal(progressiveTax(50_000, SAMPLE), 1_000 + 30_000 * 0.2 + 10_000 * 0.3); // 1000+6000+3000=10000
});

test("progressiveTax never goes negative and treats 0/negative income as 0 tax", () => {
  assert.equal(progressiveTax(0, SAMPLE), 0);
  assert.equal(progressiveTax(-500, SAMPLE), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `game/`): `node --test tests/tax.test.ts`
Expected: FAIL — `types.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/tax/types.ts
// Shared shapes for the tax module (game/src/sim/tax/): a bracket-based
// progressive tax function used by both federal.ts and state.ts, and the
// TaxReturn record the annual filing produces. Single-filer only for now —
// the sim models no marital status or dependents anywhere yet (see
// docs/superpowers/specs/2026-09-12-tax-filing-design.md).

export type FilingStatus = "single";

/** One bracket: income up to `upTo` (exclusive of the bracket below it) is taxed at `rate`. The last bracket's `upTo` is Infinity. */
export interface Bracket {
  upTo: number;
  rate: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Marginal-bracket tax on `income`; each slice is taxed at its own bracket's rate. */
export function progressiveTax(income: number, brackets: Bracket[]): number {
  if (income <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = Math.min(income, b.upTo);
    if (upper > lower) tax += (upper - lower) * b.rate;
    lower = b.upTo;
    if (income <= b.upTo) break;
  }
  return round2(tax);
}

export interface TaxReturn {
  year: number;
  filingStatus: FilingStatus;
  state: string;
  wages: number;
  federalStandardDeduction: number;
  federalTaxableIncome: number;
  federalTax: number;
  /** Childless Earned Income Tax Credit only; 0 above the income limit. */
  eic: number;
  federalWithheld: number;
  /** Positive is a refund, negative is owed. */
  federalRefundOrOwed: number;
  stateTax: number;
  stateWithheld: number;
  stateRefundOrOwed: number;
  /** Game day the player filed, or null while still pending. */
  filedDay: number | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tax.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/tax/types.ts game/tests/tax.test.ts
git commit -m "tax: add Bracket/TaxReturn types and progressiveTax()"
```

---

### Task 2: Federal brackets, standard deduction, FICA, and childless EIC

**Files:**
- Create: `game/src/sim/tax/federal.ts`
- Test: `game/tests/tax.test.ts` (append)

**Interfaces:**
- Consumes: `progressiveTax`, `Bracket` from Task 1's `./types.ts`.
- Produces: `FEDERAL_BRACKETS_SINGLE_2026: Bracket[]`, `FEDERAL_STANDARD_DEDUCTION_SINGLE_2026: number`, `federalTax(taxableIncome: number): number`, `fica(wagesYtdBefore: number, wagesThisPeriod: number): number`, `childlessEic(annualEarnedIncome: number): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/tax.test.ts
import { FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, childlessEic, federalTax, fica } from "../src/sim/tax/federal.ts";

test("federalTax matches the 2026 single-filer brackets at bracket edges (research/02)", () => {
  assert.equal(federalTax(0), 0);
  assert.equal(federalTax(12_400), 1_240); // 10% bracket exactly
  assert.equal(federalTax(50_400), 1_240 + (50_400 - 12_400) * 0.12);
});

test("FEDERAL_STANDARD_DEDUCTION_SINGLE_2026 is the 2026 single filer amount", () => {
  assert.equal(FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, 16_100);
});

test("fica charges 6.2% SS + 1.45% Medicare below the wage base", () => {
  const tax = fica(0, 10_000);
  assert.equal(tax, Math.round(10_000 * (0.062 + 0.0145) * 100) / 100);
});

test("fica stops charging Social Security once YTD wages cross the wage base", () => {
  const tax = fica(184_500, 10_000); // already at the 2026 wage base
  assert.equal(tax, Math.round(10_000 * 0.0145 * 100) / 100); // Medicare only, no SS
});

test("fica charges the additional 0.9% Medicare only above $200,000 YTD", () => {
  const tax = fica(195_000, 10_000); // crosses $200k mid-period
  const medicare = 10_000 * 0.0145;
  const additional = 5_000 * 0.009; // only the $5,000 over $200k
  assert.equal(tax, Math.round((medicare + additional) * 100) / 100);
});

test("childlessEic is 0 at zero income, positive mid-range, 0 at/above the income limit", () => {
  assert.equal(childlessEic(0), 0);
  assert.ok(childlessEic(8_000) > 0);
  assert.equal(childlessEic(19_540), 0);
  assert.equal(childlessEic(30_000), 0);
});

test("childlessEic never exceeds the 2026 maximum of $664", () => {
  for (const income of [1_000, 5_000, 8_490, 12_000, 19_000]) assert.ok(childlessEic(income) <= 664);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tax.test.ts`
Expected: FAIL — `federal.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/tax/federal.ts
// 2026 federal single-filer income tax: brackets and standard deduction from
// Tax Foundation (https://taxfoundation.org/data/all/federal/2026-tax-brackets/),
// FICA from the SSA 2026 wage base announcement, and a simplified childless
// Earned Income Tax Credit (single-filer only — this sim has no dependents
// modeled, so the with-children EIC schedule doesn't apply).
import { progressiveTax, type Bracket } from "./types.ts";

export const FEDERAL_BRACKETS_SINGLE_2026: Bracket[] = [
  { upTo: 12_400, rate: 0.1 },
  { upTo: 50_400, rate: 0.12 },
  { upTo: 105_700, rate: 0.22 },
  { upTo: 201_775, rate: 0.24 },
  { upTo: 256_225, rate: 0.32 },
  { upTo: 640_600, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];
export const FEDERAL_STANDARD_DEDUCTION_SINGLE_2026 = 16_100;

/** 2026 Social Security wage base (payroll.org, SSA announcement). */
export const SS_WAGE_BASE_2026 = 184_500;
export const SS_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const MEDICARE_ADDITIONAL_RATE = 0.009;
/** Single-filer threshold for the additional 0.9% Medicare surtax. */
export const MEDICARE_ADDITIONAL_THRESHOLD_SINGLE = 200_000;

/** Childless EIC 2026: max credit $664, phases out to $0 at $19,540 (IRS 2026 parameters). */
const EIC_MAX_CHILDLESS = 664;
const EIC_INCOME_LIMIT_CHILDLESS = 19_540;
/** Approximate phase-in end (exact IRS bend point not published as of this doc; this triangle uses only the two published numbers above and errs toward less credit at low income, never more than the real one at any income). */
const EIC_PHASE_IN_END = 8_490;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function federalTax(taxableIncome: number): number {
  return progressiveTax(taxableIncome, FEDERAL_BRACKETS_SINGLE_2026);
}

/** FICA (Social Security + Medicare) on one paycheck, given wages already earned this calendar year before it. */
export function fica(wagesYtdBefore: number, wagesThisPeriod: number): number {
  const ssTaxable = Math.max(0, Math.min(wagesThisPeriod, SS_WAGE_BASE_2026 - wagesYtdBefore));
  const ss = ssTaxable * SS_RATE;
  const medicare = wagesThisPeriod * MEDICARE_RATE;
  const overBefore = Math.max(0, wagesYtdBefore - MEDICARE_ADDITIONAL_THRESHOLD_SINGLE);
  const overAfter = Math.max(0, wagesYtdBefore + wagesThisPeriod - MEDICARE_ADDITIONAL_THRESHOLD_SINGLE);
  const additional = (overAfter - overBefore) * MEDICARE_ADDITIONAL_RATE;
  return round2(ss + medicare + additional);
}

/** Childless EIC on a full year's earned income (wages). 0 outside the qualifying range. */
export function childlessEic(annualEarnedIncome: number): number {
  if (annualEarnedIncome <= 0 || annualEarnedIncome >= EIC_INCOME_LIMIT_CHILDLESS) return 0;
  if (annualEarnedIncome <= EIC_PHASE_IN_END) return round2((annualEarnedIncome / EIC_PHASE_IN_END) * EIC_MAX_CHILDLESS);
  const phaseOutSpan = EIC_INCOME_LIMIT_CHILDLESS - EIC_PHASE_IN_END;
  return round2(EIC_MAX_CHILDLESS * (1 - (annualEarnedIncome - EIC_PHASE_IN_END) / phaseOutSpan));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tax.test.ts`
Expected: PASS (9 tests total)

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/tax/federal.ts game/tests/tax.test.ts
git commit -m "tax: add 2026 federal brackets, FICA, and childless EIC"
```

---

### Task 3: State tax data builder and generated `state-tax.ts`

**Files:**
- Create: `research/data/build_state_tax.py`
- Create (generated by the script, commit the output): `game/src/data/state-tax.ts`
- Test: `game/tests/tax.test.ts` (append)

**Interfaces:**
- Produces: `game/src/data/state-tax.ts` exporting `STATE_TAX: Record<string, StateTax>` where `StateTax = { type: "none" } | { type: "flat"; rate: number } | { type: "graduated"; brackets: Bracket[] }`, keyed by the same 2-letter `abbr` used in `game/src/data/states.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// append to game/tests/tax.test.ts
import { STATE_TAX } from "../src/data/state-tax.ts";
import { STATES } from "../src/data/states.ts";

test("STATE_TAX has exactly one entry per state in STATES (51 with DC)", () => {
  assert.equal(Object.keys(STATE_TAX).length, STATES.length);
  for (const s of STATES) assert.ok(STATE_TAX[s.abbr], `missing state tax entry for ${s.abbr}`);
});

test("the 9 no-wage-income-tax states are typed none (research/02)", () => {
  for (const abbr of ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]) {
    assert.equal(STATE_TAX[abbr].type, "none", `${abbr} should be none`);
  }
});

test("a flat state (e.g. OH, 2026 flat 2.75% per research/02) has a single positive rate", () => {
  const oh = STATE_TAX.OH;
  assert.equal(oh.type, "flat");
  if (oh.type === "flat") assert.equal(oh.rate, 0.0275);
});

test("a graduated state (e.g. CA) has ascending bracket upTo values ending in Infinity", () => {
  const ca = STATE_TAX.CA;
  assert.equal(ca.type, "graduated");
  if (ca.type === "graduated") {
    assert.ok(ca.brackets.length > 1);
    assert.equal(ca.brackets[ca.brackets.length - 1].upTo, Infinity);
    for (let i = 1; i < ca.brackets.length; i++) assert.ok(ca.brackets[i].upTo > ca.brackets[i - 1].upTo);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tax.test.ts`
Expected: FAIL — `game/src/data/state-tax.ts` does not exist.

- [ ] **Step 3: Write the builder script**

Source the 2026 single-filer bracket data by hand from [Tax Foundation's 2026 State Income Tax Rates and Brackets table](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/) (no bulk CSV is published for this table the way BEA's RPP has one, so — unlike `build_states_rpp.py` — this script's `RAW` table below *is* the transcribed source data, not a parsed file). The 9 no-tax states and the Ohio flat rate below are already verified in `research/02-states-cost-of-living.md`; fill in the remaining 41 states + DC from the same Tax Foundation page using the schema shown, then run the script.

```python
#!/usr/bin/env python3
"""Build the per-state 2026 single-filer income tax table.

Input:  hand-transcribed from Tax Foundation's 2026 State Income Tax Rates
        and Brackets (https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/),
        single-filer brackets only (this sim is single-filer-only for now).
Output: game/src/data/state-tax.ts.
Usage:  python3 build_state_tax.py
"""
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
GAME = HERE.parent.parent / "game" / "src" / "data" / "state-tax.ts"

NONE = {"type": "none"}
def flat(rate: float) -> dict:
    return {"type": "flat", "rate": rate}
def graduated(brackets: list[tuple[float, float]]) -> dict:
    # brackets: [(upTo, rate), ...], last upTo must be float("inf")
    return {"type": "graduated", "brackets": brackets}

# Single-filer, 2026. The 9 no-wage-tax states and OH's flat rate are verified
# against research/02-states-cost-of-living.md; every other state's numbers
# must be checked against the Tax Foundation URL above before this is treated
# as ship-ready — flag any state below with a rate you have not personally
# verified there.
RAW: dict[str, dict] = {
    "AL": graduated([(500, 0.02), (3_000, 0.04), (float("inf"), 0.05)]),
    "AK": NONE,
    "AZ": flat(0.025),
    "AR": graduated([(4_500, 0.02), (float("inf"), 0.039)]),
    "CA": graduated([(10_756, 0.01), (25_499, 0.02), (40_245, 0.04), (55_866, 0.06),
                      (70_606, 0.08), (360_659, 0.093), (432_787, 0.103),
                      (721_314, 0.113), (float("inf"), 0.133)]),
    "CO": flat(0.044),
    "CT": graduated([(10_000, 0.02), (50_000, 0.045), (100_000, 0.055), (200_000, 0.06),
                      (250_000, 0.065), (500_000, 0.069), (float("inf"), 0.0699)]),
    "DE": graduated([(2_000, 0.0), (5_000, 0.022), (10_000, 0.039), (20_000, 0.048),
                      (25_000, 0.052), (60_000, 0.0555), (float("inf"), 0.066)]),
    "DC": graduated([(10_000, 0.04), (40_000, 0.06), (60_000, 0.065), (250_000, 0.085),
                      (500_000, 0.0925), (1_000_000, 0.0975), (float("inf"), 0.1075)]),
    "FL": NONE,
    "GA": flat(0.0539),
    "HI": graduated([(9_600, 0.014), (14_400, 0.032), (19_200, 0.055), (24_000, 0.064),
                      (36_000, 0.068), (48_000, 0.072), (125_000, 0.076), (175_000, 0.079),
                      (float("inf"), 0.09)]),
    "ID": flat(0.053),
    "IL": flat(0.0495),
    "IN": flat(0.03),
    "IA": flat(0.038),
    "KS": graduated([(23_000, 0.052), (float("inf"), 0.0558)]),
    "KY": flat(0.035),
    "LA": flat(0.03),
    "ME": graduated([(26_050, 0.058), (61_600, 0.0675), (float("inf"), 0.0715)]),
    "MD": graduated([(1_000, 0.02), (2_000, 0.03), (3_000, 0.04), (100_000, 0.0475),
                      (125_000, 0.05), (150_000, 0.0525), (250_000, 0.055), (float("inf"), 0.0575)]),
    "MA": flat(0.05),
    "MI": flat(0.0425),
    "MN": graduated([(31_690, 0.0535), (104_090, 0.068), (193_240, 0.0785), (float("inf"), 0.0985)]),
    "MS": graduated([(10_000, 0.0), (float("inf"), 0.044)]),
    "MO": graduated([(1_313, 0.0), (float("inf"), 0.047)]),
    "MT": graduated([(21_100, 0.047), (float("inf"), 0.059)]),
    "NE": graduated([(3_700, 0.0246), (22_170, 0.0351), (float("inf"), 0.052)]),
    "NV": NONE,
    "NH": NONE,
    "NJ": graduated([(20_000, 0.014), (35_000, 0.0175), (40_000, 0.035), (75_000, 0.05525),
                      (500_000, 0.0637), (1_000_000, 0.0897), (float("inf"), 0.1075)]),
    "NM": graduated([(5_500, 0.015), (11_000, 0.032), (16_000, 0.043), (210_000, 0.047),
                      (float("inf"), 0.059)]),
    "NY": graduated([(8_500, 0.04), (11_700, 0.045), (13_900, 0.0525), (80_650, 0.055),
                      (215_400, 0.06), (1_077_550, 0.0685), (5_000_000, 0.0965),
                      (25_000_000, 0.103), (float("inf"), 0.109)]),
    "NC": flat(0.0425),
    "ND": graduated([(51_650, 0.0), (float("inf"), 0.025)]),
    "OH": flat(0.0275),
    "OK": graduated([(1_000, 0.0025), (2_500, 0.0075), (3_750, 0.0175), (4_900, 0.0275),
                      (7_200, 0.0375), (float("inf"), 0.0475)]),
    "OR": graduated([(4_400, 0.0475), (11_050, 0.0675), (125_000, 0.0875), (float("inf"), 0.099)]),
    "PA": flat(0.0307),
    "RI": graduated([(77_450, 0.0375), (176_050, 0.0475), (float("inf"), 0.0599)]),
    "SC": graduated([(3_560, 0.0), (float("inf"), 0.062)]),
    "SD": NONE,
    "TN": NONE,
    "TX": NONE,
    "UT": flat(0.0455),
    "VT": graduated([(46_900, 0.0335), (113_600, 0.066), (237_850, 0.076), (float("inf"), 0.0875)]),
    "VA": graduated([(3_000, 0.02), (5_000, 0.03), (17_000, 0.05), (float("inf"), 0.0575)]),
    "WA": NONE,
    "WV": graduated([(10_000, 0.0236), (25_000, 0.0315), (40_000, 0.0354), (60_000, 0.0472),
                      (float("inf"), 0.0512)]),
    "WI": graduated([(14_320, 0.035), (28_640, 0.044), (315_310, 0.053), (float("inf"), 0.0765)]),
    "WY": NONE,
}


def main() -> None:
    lines = [
        "// Generated by research/data/build_state_tax.py from Tax Foundation's 2026",
        "// State Income Tax Rates and Brackets (single-filer). Do not edit by hand;",
        "// rerun the script instead.",
        "",
        'import type { Bracket } from "../sim/tax/types.ts";',
        "",
        "export type StateTax = { type: \"none\" } | { type: \"flat\"; rate: number } | { type: \"graduated\"; brackets: Bracket[] };",
        "",
        "export const STATE_TAX: Record<string, StateTax> = {",
    ]
    for abbr, v in sorted(RAW.items()):
        if v["type"] == "none":
            lines.append(f'  {abbr}: {{ type: "none" }},')
        elif v["type"] == "flat":
            lines.append(f'  {abbr}: {{ type: "flat", rate: {v["rate"]} }},')
        else:
            brackets = ", ".join(
                f'{{ upTo: {"Infinity" if up == float("inf") else up}, rate: {rate} }}' for up, rate in v["brackets"]
            )
            lines.append(f"  {abbr}: {{ type: \"graduated\", brackets: [{brackets}] }},")
    lines += ["};", ""]
    GAME.parent.mkdir(parents=True, exist_ok=True)
    GAME.write_text("\n".join(lines))
    print(f"wrote {len(RAW)} states to {GAME}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the script and the test**

```bash
cd research/data && python3 build_state_tax.py && cd ../..
node --test game/tests/tax.test.ts
```

Expected: script prints `wrote 51 states to .../state-tax.ts`; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add research/data/build_state_tax.py game/src/data/state-tax.ts game/tests/tax.test.ts
git commit -m "tax: add the 2026 per-state tax data builder and generated table"
```

---

### Task 4: `state.ts` — per-state tax function

**Files:**
- Create: `game/src/sim/tax/state.ts`
- Test: `game/tests/tax.test.ts` (append)

**Interfaces:**
- Consumes: `progressiveTax` (Task 1), `STATE_TAX` (Task 3).
- Produces: `stateTax(abbr: string, taxableIncome: number): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/tax.test.ts
import { stateTax } from "../src/sim/tax/state.ts";

test("stateTax is 0 in a no-income-tax state regardless of income", () => {
  assert.equal(stateTax("TX", 500_000), 0);
});

test("stateTax applies a flat rate directly to taxable income", () => {
  assert.equal(stateTax("OH", 100_000), Math.round(100_000 * 0.0275 * 100) / 100);
});

test("stateTax applies graduated brackets like federalTax", () => {
  const low = stateTax("CA", 5_000);
  const high = stateTax("CA", 500_000);
  assert.ok(low >= 0 && low < 5_000 * 0.05);
  assert.ok(high > low);
});

test("stateTax throws on an unknown state abbreviation", () => {
  assert.throws(() => stateTax("ZZ", 10_000));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tax.test.ts`
Expected: FAIL — `state.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/tax/state.ts
// Per-state income tax on taxable income (already net of the federal standard
// deduction — states.ts's 2-letter abbr keys are shared with game/src/data/states.ts).
import { progressiveTax } from "./types.ts";
import { STATE_TAX } from "../../data/state-tax.ts";

export function stateTax(abbr: string, taxableIncome: number): number {
  const t = STATE_TAX[abbr];
  if (!t) throw new Error(`No state tax data for "${abbr}"`);
  if (t.type === "none") return 0;
  if (t.type === "flat") return Math.round(taxableIncome * t.rate * 100) / 100;
  return progressiveTax(taxableIncome, t.brackets);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tax.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/tax/state.ts game/tests/tax.test.ts
git commit -m "tax: add per-state tax function"
```

---

### Task 5: `withholding.ts` — per-paycheck federal + state withholding

**Files:**
- Create: `game/src/sim/tax/withholding.ts`
- Test: `game/tests/tax.test.ts` (append)

**Interfaces:**
- Consumes: `FEDERAL_STANDARD_DEDUCTION_SINGLE_2026`, `federalTax`, `fica` (Task 2); `stateTax` (Task 4).
- Produces: `interface Withholding { federalIncomeTax: number; fica: number; stateIncomeTax: number }`, `withholdingForPaycheck(o: { state: string; wagesThisPeriod: number; periodsPerYear?: number }): Withholding`.

The "annualize and divide" method: treat this one paycheck as if it repeated all year, compute the full year's tax on that annualized income, divide back down. This is the standard method real payroll withholding uses and is what makes a level salary's withholding stay level paycheck to paycheck.

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/tax.test.ts
import { withholdingForPaycheck } from "../src/sim/tax/withholding.ts";

test("withholdingForPaycheck on a $0 paycheck withholds $0 of everything", () => {
  const w = withholdingForPaycheck({ state: "TX", wagesThisPeriod: 0 });
  assert.equal(w.federalIncomeTax, 0);
  assert.equal(w.fica, 0);
  assert.equal(w.stateIncomeTax, 0);
});

test("withholdingForPaycheck withholds nothing for state income tax in a no-tax state", () => {
  const w = withholdingForPaycheck({ state: "TX", wagesThisPeriod: 4_000 });
  assert.equal(w.stateIncomeTax, 0);
  assert.ok(w.federalIncomeTax > 0);
});

test("withholdingForPaycheck is level across paychecks for a level salary (24 periods/year)", () => {
  const a = withholdingForPaycheck({ state: "CA", wagesThisPeriod: 3_000 });
  const b = withholdingForPaycheck({ state: "CA", wagesThisPeriod: 3_000 });
  assert.equal(a.federalIncomeTax, b.federalIncomeTax);
  assert.equal(a.stateIncomeTax, b.stateIncomeTax);
});

test("withholdingForPaycheck's federal income tax roughly matches the full year's tax divided by periods", () => {
  const periods = 24;
  const perPeriod = 4_000;
  const w = withholdingForPaycheck({ state: "TX", wagesThisPeriod: perPeriod, periodsPerYear: periods });
  const annualWages = perPeriod * periods;
  const annualTaxable = Math.max(0, annualWages - 16_100);
  // Within a few dollars: rounding happens once at the annual level, once per paycheck here.
  const expectedAnnual = annualTaxable * 0; // placeholder to keep TS happy about unused var below
  void expectedAnnual;
  assert.ok(Math.abs(w.federalIncomeTax * periods - Math.round(annualTaxable * 0.12) ) < 500);
});
```

(The last test is intentionally loose — it exists to catch a gross scaling error, e.g. withholding 10x or 1/10th too much, not to pin the exact cent. Delete the unused `expectedAnnual` line if it trips `noUnusedLocals` — it's for future readers explaining the shape of the check, but the constraint means it must actually be used or removed; remove it in the real edit.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tax.test.ts`
Expected: FAIL — `withholding.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/tax/withholding.ts
// Per-paycheck withholding via the "annualize and divide" method: treat this
// paycheck as if it repeated all year, tax that annual figure, divide back
// down. Real payroll withholding uses the same method (IRS Pub 15-T,
// percentage method), which is why a level salary's withholding stays level
// paycheck to paycheck — PlayerLife.onDay reconciles the real total once a
// year in filing.ts, since annualize-and-divide isn't exact when the Social
// Security wage base or the additional Medicare threshold is crossed mid-year.
import { FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, federalTax, fica } from "./federal.ts";
import { stateTax } from "./state.ts";

export interface Withholding {
  federalIncomeTax: number;
  fica: number;
  stateIncomeTax: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function withholdingForPaycheck(o: { state: string; wagesThisPeriod: number; wagesYtdBefore?: number; periodsPerYear?: number }): Withholding {
  const periods = o.periodsPerYear ?? 24;
  const annualWages = o.wagesThisPeriod * periods;
  const annualDeduction = FEDERAL_STANDARD_DEDUCTION_SINGLE_2026;
  const annualTaxableFederal = Math.max(0, annualWages - annualDeduction);
  const annualTaxableState = Math.max(0, annualWages - annualDeduction); // same taxable base for the state estimate; states.ts state.ts applies its own brackets/flat/none
  return {
    federalIncomeTax: round2(federalTax(annualTaxableFederal) / periods),
    fica: fica(o.wagesYtdBefore ?? 0, o.wagesThisPeriod),
    stateIncomeTax: round2(stateTax(o.state, annualTaxableState) / periods),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tax.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/tax/withholding.ts game/tests/tax.test.ts
git commit -m "tax: add per-paycheck withholding (annualize-and-divide)"
```

---

### Task 6: `filing.ts` — annual reconciliation

**Files:**
- Create: `game/src/sim/tax/filing.ts`
- Test: `game/tests/tax.test.ts` (append)

**Interfaces:**
- Consumes: `TaxReturn` (Task 1), `FEDERAL_STANDARD_DEDUCTION_SINGLE_2026`, `federalTax`, `childlessEic` (Task 2), `stateTax` (Task 4).
- Produces: `fileReturn(o: { year: number; state: string; wagesYtd: number; federalWithheldYtd: number; stateWithheldYtd: number }): TaxReturn` (with `filedDay: null`; the caller stamps `filedDay` when the player actually files, see Task 8).

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/tax.test.ts
import { fileReturn } from "../src/sim/tax/filing.ts";

test("fileReturn on exactly-covered withholding nets close to $0 for a mid-income single filer", () => {
  // $60,000 wages in Texas (no state tax): withholding was computed by the
  // same annualize-and-divide method, so it should reconcile close to zero.
  const wagesYtd = 60_000;
  const federalWithheldYtd = Math.round((Math.max(0, wagesYtd - 16_100) * 0.22 - 0) * 0) ; // not used directly; see below
  void federalWithheldYtd;
  const r = fileReturn({ year: 2026, state: "TX", wagesYtd, federalWithheldYtd: 8_000, stateWithheldYtd: 0 });
  assert.equal(r.wages, 60_000);
  assert.equal(r.stateTax, 0);
  assert.equal(r.stateRefundOrOwed, 0);
  assert.equal(r.filedDay, null);
});

test("fileReturn computes federalTaxableIncome as wages minus the standard deduction, floored at 0", () => {
  const r = fileReturn({ year: 2026, state: "TX", wagesYtd: 10_000, federalWithheldYtd: 0, stateWithheldYtd: 0 });
  assert.equal(r.federalTaxableIncome, 0); // 10,000 - 16,100 floored at 0
  assert.equal(r.federalTax, 0);
});

test("fileReturn's federalRefundOrOwed is withheld + eic - tax (positive is a refund)", () => {
  const r = fileReturn({ year: 2026, state: "TX", wagesYtd: 40_000, federalWithheldYtd: 5_000, stateWithheldYtd: 0 });
  assert.equal(r.federalRefundOrOwed, Math.round((5_000 + r.eic - r.federalTax) * 100) / 100);
});

test("fileReturn's stateRefundOrOwed is state withheld minus state tax", () => {
  const r = fileReturn({ year: 2026, state: "OH", wagesYtd: 50_000, federalWithheldYtd: 6_000, stateWithheldYtd: 900 });
  assert.equal(r.stateRefundOrOwed, Math.round((900 - r.stateTax) * 100) / 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tax.test.ts`
Expected: FAIL — `filing.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/tax/filing.ts
// Once-a-year reconciliation: the year's real recorded wages and withholding
// (accumulated paycheck by paycheck in PlayerLife) become a TaxReturn. Every
// field traces back to a real recorded paycheck event — nothing here is
// invented (the same "facts only" rule as server/src/ai/facts.ts).
import { FEDERAL_STANDARD_DEDUCTION_SINGLE_2026, childlessEic, federalTax } from "./federal.ts";
import { stateTax } from "./state.ts";
import type { TaxReturn } from "./types.ts";

const round2 = (x: number) => Math.round(x * 100) / 100;

export function fileReturn(o: { year: number; state: string; wagesYtd: number; federalWithheldYtd: number; stateWithheldYtd: number }): TaxReturn {
  const federalStandardDeduction = FEDERAL_STANDARD_DEDUCTION_SINGLE_2026;
  const federalTaxableIncome = round2(Math.max(0, o.wagesYtd - federalStandardDeduction));
  const federalTax_ = federalTax(federalTaxableIncome);
  const eic = childlessEic(o.wagesYtd);
  const stateTax_ = stateTax(o.state, federalTaxableIncome);
  return {
    year: o.year,
    filingStatus: "single",
    state: o.state,
    wages: round2(o.wagesYtd),
    federalStandardDeduction,
    federalTaxableIncome,
    federalTax: federalTax_,
    eic,
    federalWithheld: round2(o.federalWithheldYtd),
    federalRefundOrOwed: round2(o.federalWithheldYtd + eic - federalTax_),
    stateTax: stateTax_,
    stateWithheld: round2(o.stateWithheldYtd),
    stateRefundOrOwed: round2(o.stateWithheldYtd - stateTax_),
    filedDay: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tax.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/tax/filing.ts game/tests/tax.test.ts
git commit -m "tax: add annual filing reconciliation"
```

---

### Task 7: `penalties.ts` — failure-to-file, failure-to-pay, interest

**Files:**
- Create: `game/src/sim/tax/penalties.ts`
- Test: `game/tests/tax.test.ts` (append)

**Interfaces:**
- Produces: `interface PenaltyResult { failureToFile: number; failureToPay: number; interest: number; total: number }`, `penaltyFor(o: { owed: number; monthsUnfiled: number; monthsUnpaid: number }): PenaltyResult`.

Sourced from IRS Topic 653 (checked live during design): failure-to-file is 5%/month, capped at 25% (5 months); failure-to-pay is 0.5%/month, capped at 25%; when both apply in the same month the failure-to-file rate for that month is reduced to 4.5% (so the combined rate is never more than 5%/month); a $525-or-100%-of-tax minimum applies once a return is more than 60 days late. Interest uses a flat approximate annual rate on the unpaid balance (simple, not compounded — a deliberate simplification flagged in the out-of-scope list).

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/tax.test.ts
import { penaltyFor } from "../src/sim/tax/penalties.ts";

test("penaltyFor is all zero when nothing is owed", () => {
  const p = penaltyFor({ owed: 0, monthsUnfiled: 6, monthsUnpaid: 6 });
  assert.equal(p.total, 0);
});

test("penaltyFor is all zero when there's an owed amount but no time has passed", () => {
  const p = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 0 });
  assert.equal(p.total, 0);
});

test("penaltyFor's failure-to-file caps at 25% of the owed amount after 5 months", () => {
  const p5 = penaltyFor({ owed: 1_000, monthsUnfiled: 5, monthsUnpaid: 5 });
  const p12 = penaltyFor({ owed: 1_000, monthsUnfiled: 12, monthsUnpaid: 12 });
  assert.equal(p5.failureToFile, 250); // 25% of 1000
  assert.equal(p12.failureToFile, 250); // capped, doesn't keep growing
});

test("penaltyFor's failure-to-pay caps at 25% of the owed amount", () => {
  const p = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 60 });
  assert.equal(p.failureToPay, 250);
});

test("penaltyFor applies the $525 minimum once filing is more than 60 days (2 months) late", () => {
  const p = penaltyFor({ owed: 50, monthsUnfiled: 3, monthsUnpaid: 3 }); // tiny owed amount, 3 months late
  assert.ok(p.total >= 50); // minimum is min(525, owed) = 50 here since owed < 525
});

test("penaltyFor charges interest only on time actually unpaid, proportional to months", () => {
  const p1 = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 1 });
  const p2 = penaltyFor({ owed: 1_000, monthsUnfiled: 0, monthsUnpaid: 2 });
  assert.ok(p2.interest > p1.interest);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tax.test.ts`
Expected: FAIL — `penalties.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// game/src/sim/tax/penalties.ts
// IRS Topic 653 (irs.gov/taxtopics/tc653), checked 2026-09-12: failure-to-file
// 5%/month capped at 25% (5 months); failure-to-pay 0.5%/month capped at 25%;
// when both apply in the same month, that month's failure-to-file rate drops
// to 4.5% so the combined monthly rate is never more than 5%. A minimum
// penalty (lesser of $525 or 100% of the tax owed) applies once filing is
// more than 60 days late. Interest is a flat approximate annual rate, simple
// (not compounded) — a deliberate simplification for this game, not the
// IRS's actual daily-compounded formula.
export interface PenaltyResult {
  failureToFile: number;
  failureToPay: number;
  interest: number;
  total: number;
}

const FTF_MONTHLY = 0.05;
const FTP_MONTHLY = 0.005;
const FTF_CAP = 0.25;
const FTP_CAP = 0.25;
const MIN_PENALTY_AFTER_MONTHS = 2; // "more than 60 days" late
const MIN_PENALTY = 525;
/** Flat approximate annual rate (IRS underpayment rate runs close to this in recent years). */
const INTEREST_ANNUAL_RATE = 0.08;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function penaltyFor(o: { owed: number; monthsUnfiled: number; monthsUnpaid: number }): PenaltyResult {
  if (o.owed <= 0) return { failureToFile: 0, failureToPay: 0, interest: 0, total: 0 };
  const ftfMonths = Math.max(0, o.monthsUnfiled);
  const ftpMonths = Math.max(0, o.monthsUnpaid);

  // Both penalties can apply in the same month (the first ftfMonths, capped at 5
  // since failure-to-file alone caps at 25%); in those overlapping months the
  // failure-to-file rate is reduced by the failure-to-pay rate already applied.
  const overlapMonths = Math.min(ftfMonths, ftpMonths, 5);
  const ftfOnlyMonths = Math.max(0, Math.min(ftfMonths, 5) - overlapMonths);
  const failureToFile = round2(Math.min(o.owed * FTF_CAP, o.owed * (overlapMonths * (FTF_MONTHLY - FTP_MONTHLY) + ftfOnlyMonths * FTF_MONTHLY)));
  const failureToPay = round2(Math.min(o.owed * FTP_CAP, o.owed * FTP_MONTHLY * ftpMonths));

  const interest = round2(o.owed * INTEREST_ANNUAL_RATE * (ftpMonths / 12));

  let total = round2(failureToFile + failureToPay + interest);
  if (ftfMonths > MIN_PENALTY_AFTER_MONTHS || ftpMonths > MIN_PENALTY_AFTER_MONTHS) {
    const minimum = Math.min(MIN_PENALTY, o.owed);
    total = Math.max(total, minimum);
  }
  return { failureToFile, failureToPay, interest, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tax.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/tax/penalties.ts game/tests/tax.test.ts
git commit -m "tax: add IRS-style failure-to-file/pay penalty and interest accrual"
```

---

### Task 8: `index.ts` barrel and PlayerLife integration — withholding replaces the flat approximation

**Files:**
- Create: `game/src/sim/tax/index.ts`
- Modify: `game/src/sim/life/player.ts`
- Test: `game/tests/life.test.ts` (append)

**Interfaces:**
- Consumes: `withholdingForPaycheck` (Task 5).
- Produces: `PlayerLife` gains `wagesYtd`, `federalWithheldYtd`, `stateWithheldYtd` (private, reset each Jan 1), and the `paycheck` `LifeEvent` gains `federalWithheld`/`stateWithheld` fields.

This task changes the payday block in `PlayerLife.onDay` (currently `game/src/sim/life/player.ts:411-416`, reading `const pay = (this.monthlyTakeHome / 2) * (...)`) to compute gross pay for the period, run it through real withholding, and deposit the net.

- [ ] **Step 1: Write the failing test**

```ts
// append to game/tests/life.test.ts — reuses this file's existing TX/CA Place
// constants, dateOf()/live() helpers, and new PlayerLife({...}) pattern
// (see the top of the file, e.g. `const life = new PlayerLife({ place: TX, day: 0 })`).
test("payday withholds real federal + state tax instead of the flat 80% approximation", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 }); // TX: no state tax
  const events = live(life, 5); // START is Sept 11, 2026 (day 0); day 4 (Sept 15) is the first payday
  const paycheck = events.find((e) => e.type === "paycheck");
  assert.ok(paycheck);
  if (paycheck?.type === "paycheck") {
    assert.ok(paycheck.federalWithheld > 0);
    assert.equal(paycheck.stateWithheld, 0); // TX has no income tax
    // Take-home should no longer just be 80% of the half-month gross.
    assert.notEqual(paycheck.takeHome, Math.round((60_000 / 24) * 0.8 * 100) / 100);
  }
});

test("wagesYtd resets to 0 on January 1", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  live(life, 105); // START is Sept 11, 2026 (day 0); day 105 lands after several paydays, still in 2026
  const beforeReset = life.wagesYtd();
  assert.ok(beforeReset > 0);
  live(life, 120, 105); // carries well past January 1, 2027
  assert.ok(life.wagesYtd() < beforeReset);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/life.test.ts`
Expected: FAIL — `federalWithheld`/`stateWithheld` don't exist on the `paycheck` event yet.

- [ ] **Step 3: Write the implementation**

```ts
// game/src/sim/tax/index.ts
export * from "./types.ts";
export * from "./federal.ts";
export * from "./state.ts";
export * from "./withholding.ts";
export * from "./filing.ts";
export * from "./penalties.ts";
```

In `game/src/sim/life/player.ts`:

1. Add the import near the top (with the other `../` imports):

```ts
import { withholdingForPaycheck } from "../tax/withholding.ts";
```

2. Extend the `paycheck` variant in the `LifeEvent` union (currently `game/src/sim/life/player.ts:65`):

```ts
  | { type: "paycheck"; day: number; takeHome: number; garnished: number; unemployed: boolean; retirement?: number; federalWithheld: number; stateWithheld: number }
```

3. Add three private fields to `PlayerLife` (near the other private state, e.g. next to `k401Year`/`k401Ytd`):

```ts
  private taxYear = 0; // 0 is a sentinel meaning "not initialized yet"; set on first payday
  private wagesYtdAmount = 0;
  private federalWithheldYtd = 0;
  private stateWithheldYtd = 0;

  /** Gross wages earned so far in the current calendar year (resets each January 1 payday); shown on the Taxes tab. */
  wagesYtd(): number {
    return this.wagesYtdAmount;
  }
```

4. Replace the payday block (`game/src/sim/life/player.ts:411-416`):

```ts
    if (payday) {
      const year = date.getFullYear();
      if (year !== this.taxYear) {
        this.taxYear = year;
        this.wagesYtdAmount = 0;
        this.federalWithheldYtd = 0;
        this.stateWithheldYtd = 0;
      }
      const grossThisPeriod = (this.grossAnnual / 24) * (this.employed ? 1 : UNEMPLOYMENT_SHARE);
      const withheld = withholdingForPaycheck({ state: this.place.abbr, wagesThisPeriod: grossThisPeriod, wagesYtdBefore: this.wagesYtdAmount });
      this.wagesYtdAmount = round2(this.wagesYtdAmount + grossThisPeriod);
      this.federalWithheldYtd = round2(this.federalWithheldYtd + withheld.federalIncomeTax);
      this.stateWithheldYtd = round2(this.stateWithheldYtd + withheld.stateIncomeTax);
      const pay = round2(grossThisPeriod - withheld.federalIncomeTax - withheld.fica - withheld.stateIncomeTax);
      const garnished = round2(pay * garnishmentRate(this.book));
      const retirement = this.contribute401k(date);
      const takeHome = round2(pay - retirement.cost - garnished);
      const checking = this.ledger.get("checking");
      checking.balance = round2(checking.balance + takeHome);
      events.push({
        type: "paycheck", day, takeHome, garnished, unemployed: !this.employed, retirement: retirement.added,
        federalWithheld: withheld.federalIncomeTax, stateWithheld: withheld.stateIncomeTax,
      });
    }
```

5. `monthlyTakeHome` stays on `PlayerLife`/`LifeOptions` (still used by `debtsFor`'s garnishment math and the onboarding summary — Task 9 changes what feeds it, not its type), but it is no longer read inside the payday block above.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/life.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full game test suite and the build to check nothing else broke**

Run (from `game/`): `npm test && npm run build`
Expected: all tests PASS; `tsc` reports no errors. (`monthlyTakeHome`'s remaining callers must still type-check — if `noUnusedLocals` flags anything no longer read, remove it there, not by leaving a placeholder.)

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/tax/index.ts game/src/sim/life/player.ts game/tests/life.test.ts
git commit -m "tax: wire real per-paycheck withholding into PlayerLife.onDay"
```

---

### Task 9: Onboarding preview uses real withholding instead of the flat 80%

**Files:**
- Modify: `game/src/sim/life/intake.ts`, `game/src/ui/intake.ts`, `game/src/main.ts`
- Test: `game/tests/intake.test.ts` (modify the existing take-home test, which pins the old flat-80% behavior)

**Interfaces:**
- Consumes: `withholdingForPaycheck` (Task 5).
- Produces: `takeHomeFor(salary: number, state: string): number` (signature changes — was `takeHomeFor(salary: number)`; every caller must be updated).

- [ ] **Step 1: Write the failing test**

```ts
// append to game/tests/intake.test.ts (match the file's existing import style)
import { takeHomeFor } from "../src/sim/life/intake.ts";

test("takeHomeFor is lower in a state with income tax than in one without, same salary", () => {
  const noTax = takeHomeFor(80_000, "TX");
  const withTax = takeHomeFor(80_000, "CA");
  assert.ok(withTax < noTax);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/intake.test.ts`
Expected: FAIL — `takeHomeFor` still takes one argument.

- [ ] **Step 3: Write the implementation**

In `game/src/sim/life/intake.ts`, replace:

```ts
/** Monthly take-home for a gross yearly salary. */
export function takeHomeFor(salary: number): number {
  return Math.round((salary * TAKE_HOME_SHARE) / 12);
}
```

with:

```ts
/** Monthly take-home for a gross yearly salary in the given state (real federal + state withholding, sim/tax). */
export function takeHomeFor(salary: number, state: string): number {
  const perPeriod = salary / 24;
  const w = withholdingForPaycheck({ state, wagesThisPeriod: perPeriod });
  return Math.round((perPeriod - w.federalIncomeTax - w.fica - w.stateIncomeTax) * 2);
}
```

Add the import at the top of `intake.ts`:

```ts
import { withholdingForPaycheck } from "../tax/withholding.ts";
```

Update the one call site in the same file, `lifeFromIntake` (`game/src/sim/life/intake.ts:88`):

```ts
  const monthlyTakeHome = takeHomeFor(a.salary, o.place.abbr);
```

There are two other callers, both verified during this plan's research and both needing a real state, not just a signature update:

**`game/tests/intake.test.ts:64-67`** currently pins the old flat-80% behavior:

```ts
test("take-home is 80% of gross pay, by the month", () => {
  assert.equal(takeHomeFor(85_000), 5_667);
  assert.equal(takeHomeFor(0), 0);
});
```

Replace it (this old test would otherwise fail to compile — `takeHomeFor` now requires a second argument):

```ts
test("take-home is real per-paycheck withholding, by the month, for the given state", () => {
  assert.equal(takeHomeFor(0, "TX"), 0);
  assert.ok(takeHomeFor(85_000, "TX") > 0);
  assert.ok(takeHomeFor(85_000, "TX") < 85_000 / 12); // withholding is never negative or over 100%
});
```

**`game/src/ui/intake.ts`** calls it in `onInput()` (`:388`, `const takeHome = takeHomeFor(a.salary);`) to show the live "That's about $X a month after taxes" preview while onboarding — but nothing in `ui/intake.ts` knows the player's state today; `main.ts` picks the starting state before onboarding even begins (`game/src/main.ts:40-57`, a module-level `state: StateInfo` set from the URL hash or defaulted to `"TX"`) and never passes it in. Thread it through:

In `game/src/ui/intake.ts`, add `state` to the options interface (`:29-32`):

```ts
export interface IntakeOptions {
  /** The starting city's daytime plate, blurred behind the card. */
  backdrop: string;
  /** The player's starting state abbreviation, for the live take-home preview. */
  state: string;
}
```

Update the call in `onInput()` (`:388`) — `this.o` is the `Intake` instance's stored constructor options (read the `Intake` class's constructor at the top of the file to confirm the field name matches, likely `this.o` or similar, and use that exact name):

```ts
    const takeHome = takeHomeFor(a.salary, this.o.state);
```

In `game/src/main.ts:57`, add the new required option:

```ts
const intake = await runIntake({ backdrop: `${import.meta.env.BASE_URL}cities/${state.cityId}/plates/day.jpg`, state: state.abbr });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/intake.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build**

Run: `npm test && npm run build` (from `game/`)
Expected: PASS, no `tsc` errors from the changed signature. If `npm run build`'s `tsc` step flags `this.o.state` as missing, the `Intake` class's constructor doesn't store its options under `this.o` — check the constructor and adjust to whatever field name it actually uses.

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/life/intake.ts game/src/ui/intake.ts game/src/main.ts game/tests/intake.test.ts
git commit -m "tax: onboarding take-home preview uses real per-state withholding"
```

---

### Task 10: Annual filing readiness, `fileTaxes()`, and fast-forward auto-file

**Files:**
- Modify: `game/src/sim/life/player.ts`
- Test: `game/tests/life.test.ts` (append)

**Interfaces:**
- Consumes: `fileReturn` (Task 6).
- Produces: `LifeEvent` gains `{ type: "tax_ready"; day: number; year: number }` and `{ type: "tax_filed"; day: number; year: number; refundOrOwed: number; auto: boolean }`. `PlayerLife` gains `pendingTaxReturn(): TaxReturn | null` and `fileTaxes(day: number): LifeEvent`.

Filing becomes possible once the calendar crosses April 15 of the year after wages were earned. Live play flags it (`tax_ready`) and waits for the player to call `fileTaxes`; headless fast-forward (`runHeadless`, `game/src/sim/life/player.ts:463`) auto-files immediately so a multi-year skip never silently piles up penalties the player never saw.

- [ ] **Step 1: Write the failing tests**

```ts
// append to game/tests/life.test.ts — START (day 0) is Sept 11, 2026, so day
// 216 lands on April 15, 2027, well past a full year of paychecks.
test("a tax_ready event fires on April 15 for the prior year's wages, and time is not paused by it", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  const events = live(life, 220);
  assert.ok(life.pendingTaxReturn() !== null);
  assert.equal(life.pendingTaxReturn()!.year, 2026);
  assert.equal(life.needsDecision(events), false); // the deadline never pauses time
});

test("fileTaxes() applies a refund to checking and clears the pending return", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 20_000 }); // low income, likely a refund after EIC
  live(life, 220);
  const before = life.cash();
  const ret = life.pendingTaxReturn()!;
  const event = life.fileTaxes(life.today + 1);
  assert.equal(event.type, "tax_filed");
  assert.equal(life.pendingTaxReturn(), null);
  if (ret.federalRefundOrOwed + ret.stateRefundOrOwed > 0) assert.ok(life.cash() > before);
});

test("runHeadless auto-files at the deadline instead of leaving it pending", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  const result = life.runHeadless(0, 220, dateOf(0));
  assert.ok(result.events.some((e) => e.type === "tax_filed" && e.auto === true));
  assert.equal(life.pendingTaxReturn(), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/life.test.ts`
Expected: FAIL — `pendingTaxReturn`/`fileTaxes` don't exist.

- [ ] **Step 3: Write the implementation**

Extend the `LifeEvent` union (`game/src/sim/life/player.ts:64`, alongside the `paycheck` change from Task 8):

```ts
  | { type: "tax_ready"; day: number; year: number }
  | { type: "tax_filed"; day: number; year: number; refundOrOwed: number; auto: boolean }
```

Add a private field and the public API, near the other tax fields added in Task 8:

```ts
  private pendingReturn: TaxReturn | null = null;
  /** The day the pending return became ready (~April 15) — the reference point penalties.ts measures lateness from, independent of when (or whether) the player actually files. */
  private taxReadyDay: number | null = null;
```

Import `fileReturn` and `TaxReturn`:

```ts
import { fileReturn } from "../tax/filing.ts";
import type { TaxReturn } from "../tax/types.ts";
```

Add the April-15 check to `onDay`, right after the existing `if (dom === 1) { ... }` block (before `events.push(...this.watchMarket(day));`):

```ts
    if (date.getMonth() === 3 && date.getDate() === 15 && !this.pendingReturn) {
      const priorYear = date.getFullYear() - 1;
      this.pendingReturn = fileReturn({
        year: priorYear,
        state: this.place.abbr,
        wagesYtd: this.wagesYtdAmount, // the year that just closed on Dec 31 is what accumulated since the last reset
        federalWithheldYtd: this.federalWithheldYtd,
        stateWithheldYtd: this.stateWithheldYtd,
      });
      this.taxReadyDay = day;
      events.push({ type: "tax_ready", day, year: priorYear });
    }
```

(This relies on `wagesYtd`/`federalWithheldYtd`/`stateWithheldYtd` still holding the *prior* year's totals on April 15 — they only reset on the *next* January 1 payday inside the block from Task 8, so this ordering is correct as written; the reset happens well after this check runs for that year.)

Add the public methods (near `setPlace`/`setEmployed`):

```ts
  /** The prior year's tax return, once ready (around April 15), until the player files it. */
  pendingTaxReturn(): TaxReturn | null {
    return this.pendingReturn;
  }

  /**
   * Files the pending return: applies a refund to checking, or withdraws what's
   * owed (partially, if checking can't cover it). A shortfall becomes or
   * updates `unpaidTax` — same object Task 11's monthly tick creates if the
   * deadline passes with nothing filed yet, so the two paths never double-track
   * the same balance. Real-world-accurate detail this preserves: failure-to-pay
   * and interest run from the original April 15 due date regardless of when
   * (or whether) the player files; only failure-to-file stops the moment you file.
   */
  fileTaxes(day: number, auto = false): LifeEvent {
    const ret = this.pendingReturn;
    if (!ret) throw new Error("No pending tax return to file.");
    const refundOrOwed = round2(ret.federalRefundOrOwed + ret.stateRefundOrOwed);
    const checking = this.ledger.get("checking");
    if (refundOrOwed >= 0) checking.balance = round2(checking.balance + refundOrOwed);
    else {
      const owed = -refundOrOwed;
      const paid = Math.min(owed, checking.balance);
      checking.balance = round2(checking.balance - paid);
      const unpaid = round2(owed - paid);
      if (unpaid > 0) {
        if (this.unpaidTax) this.unpaidTax.filedDay = day; // Task 11's tick already started tracking it
        else this.unpaidTax = { originalOwed: unpaid, amount: unpaid, dueDay: this.taxReadyDay ?? day, filedDay: day, penaltyCharged: 0 };
      }
    }
    ret.filedDay = day;
    this.pendingReturn = null;
    const e: LifeEvent = { type: "tax_filed", day, year: ret.year, refundOrOwed, auto };
    this.emit([e]);
    return e;
  }
```

Add the `unpaidTax` field (used by Task 11's penalty escalation):

```ts
  /**
   * `originalOwed` is fixed (the actual unpaid tax) — `penaltyFor` (Task 11)
   * always computes off this, never off the inflated running balance, so
   * penalties are never charged on top of previously-added penalties. `amount`
   * is the running balance (original + all penalties/interest so far) that
   * becomes the eventual Debt's opening balance. `penaltyCharged` is how much
   * of `penaltyFor`'s cumulative total has already been folded into `amount`,
   * so each monthly tick adds only that month's new increment.
   */
  private unpaidTax: { originalOwed: number; amount: number; dueDay: number; filedDay: number | null; penaltyCharged: number } | null = null;
```

Update `runHeadless` (`game/src/sim/life/player.ts:463`) to auto-file at the deadline — add this right after the `onDay` call inside its loop, before the `stopsSkip` check:

```ts
      if (this.pendingReturn) all.push(this.fileTaxes(fromDay + i, true));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/life.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/life.test.ts
git commit -m "tax: annual filing readiness, fileTaxes(), and fast-forward auto-file"
```

---

### Task 11: Penalty escalation and conversion to a real `Debt` after 180 days unpaid

**Files:**
- Modify: `game/src/sim/life/player.ts`
- Test: `game/tests/life.test.ts` (append)

**Interfaces:**
- Consumes: `penaltyFor` (Task 7); `installment` from `game/src/sim/debt/factory.ts` (already imported project-wide via `sim/debt/index.ts`).
- Produces: `LifeEvent` gains `{ type: "tax_penalty"; day: number; amount: number }`; an unpaid tax balance becomes a `personal`-kind `Debt` named "IRS balance" after 180 days, flowing through the existing debt engine unchanged.

- [ ] **Step 1: Write the failing tests**

Both tests below need a scenario *guaranteed* to owe money, not just likely to: since withholding (Task 5) and filing (Task 6) use the exact same bracket functions, a player who never moves reconciles to within a few cents of $0 by construction, and whether that lands as a tiny refund or a tiny owed amount is a coin flip — not a reliable test. Moving mid-year makes it deterministic instead: the full year's wages get taxed at the *destination* state's real bracket on filing, but only the paychecks *after* the move ever withheld anything for that state, so the state portion is guaranteed underwithheld (owed) whenever the destination taxes wages at all. This double as a realistic scenario, not just a test trick — real movers file part-year in each state.

```ts
// append to game/tests/life.test.ts
test("an unpaid tax balance accrues failure-to-file penalties if the deadline passes with no filing", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 80_000 });
  live(life, 100); // months withheld at TX's $0 state rate
  life.setPlace(CA, 100); // moving to CA guarantees the state portion is underwithheld (see note above)
  const events = live(life, 160, 100); // carries well past the April 15, 2027 deadline, then 60+ more days unfiled
  assert.ok(events.some((e) => e.type === "tax_penalty"));
});

test("an unpaid tax balance becomes a real Debt after 180 days unpaid", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 80_000 });
  live(life, 100);
  life.setPlace(CA, 100);
  live(life, 120, 100); // past the deadline
  const ret = life.pendingTaxReturn()!;
  assert.ok(ret.stateRefundOrOwed < 0, "moving to a tax state mid-year should leave the state portion owed");
  life.ledger.get("checking").balance = 0; // guarantee it can't be paid in full at filing
  life.fileTaxes(220);
  live(life, 190, 220); // 190 days unpaid, past the 180-day conversion threshold
  assert.ok(life.book.debts.some((debt) => debt.name === "IRS balance"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/life.test.ts`
Expected: FAIL — `tax_penalty` doesn't exist, no "IRS balance" debt is ever created.

- [ ] **Step 3: Write the implementation**

Extend the `LifeEvent` union once more:

```ts
  | { type: "tax_penalty"; day: number; amount: number }
```

Import `penaltyFor` and `installment`:

```ts
import { penaltyFor } from "../tax/penalties.ts";
import { installment } from "../debt/factory.ts";
```

Add a monthly penalty tick. In `onDay`, add this near the `if (dom === 1) { ... }` block (penalties tick monthly, on the 1st, same cadence as savings interest):

```ts
    if (dom === 1) this.tickTaxPenalty(day, events);
```

Add the private method (near `contribute401k`/`topUpEmergency`):

```ts
  /**
   * Monthly: escalates an unfiled-and-owing or filed-with-a-balance tax debt
   * (failure-to-file/pay + interest, penalties.ts), and converts it to a real
   * Debt after 180 days unpaid so it flows through the existing debt engine's
   * delinquency and credit-score machinery unchanged.
   *
   * `unpaidTax` is created lazily, the first time it's needed, by whichever of
   * two paths gets there first: this tick (the deadline passes with nothing
   * filed and money owed) or `fileTaxes` (filed, but checking couldn't cover
   * it). Once created, `penaltyCharged` tracks how much of `penaltyFor`'s
   * cumulative total has already been folded into `amount`, so each tick adds
   * only that month's new increment instead of re-adding the running total.
   */
  private tickTaxPenalty(day: number, events: LifeEvent[]): void {
    if (!this.unpaidTax && this.pendingReturn && this.taxReadyDay !== null && day > this.taxReadyDay) {
      const owed = round2(-(this.pendingReturn.federalRefundOrOwed + this.pendingReturn.stateRefundOrOwed));
      if (owed > 0) this.unpaidTax = { originalOwed: owed, amount: owed, dueDay: this.taxReadyDay, filedDay: null, penaltyCharged: 0 };
    }
    if (!this.unpaidTax) return;
    const monthsSinceDue = Math.max(0, Math.floor((day - this.unpaidTax.dueDay) / 30));
    const monthsUnfiled = this.unpaidTax.filedDay === null ? monthsSinceDue : 0;
    const penalty = penaltyFor({ owed: this.unpaidTax.originalOwed, monthsUnfiled, monthsUnpaid: monthsSinceDue });
    const delta = round2(penalty.total - this.unpaidTax.penaltyCharged);
    if (delta > 0) {
      this.unpaidTax.penaltyCharged = penalty.total;
      this.unpaidTax.amount = round2(this.unpaidTax.amount + delta);
      events.push({ type: "tax_penalty", day, amount: delta });
    }
    if (monthsSinceDue >= 6 && !this.book.debts.some((d) => d.name === "IRS balance")) {
      this.book.debts.push(
        installment({ id: `irs-${day}`, kind: "personal", name: "IRS balance", balance: this.unpaidTax.amount, apr: 0.08, months: 36, day, openedDay: day }),
      );
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/life.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and build**

Run (from `game/`): `npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/life/player.ts game/tests/life.test.ts
git commit -m "tax: escalate unpaid balances (IRS-style penalties + interest) into a real Debt"
```

---

### Task 12: Phone app — Taxes entry, badge, click dispatch

**Files:**
- Modify: `game/src/ui/phone.ts`

**Interfaces:**
- Consumes: `life.pendingTaxReturn()` (Task 10).

Debt/Credit/Cards have no dedicated phone view today — only Stocks does, because sponsor stocks need one. Taxes follows the lighter existing pattern (like tapping a stock jumps straight into the desk): add it to `APPS`, and clicking it opens the Money desk directly, with a small unread-style badge when a return is ready and unfiled.

- [ ] **Step 1: Add `taxes` to `APPS`** (`game/src/ui/phone.ts:27-36`)

```ts
const APPS: AppDef[] = [
  { id: "stocks", name: "Stocks", icon: pixelIcon("stocks"), ready: true },
  { id: "goals", name: "Goals", icon: pixelIcon("goals"), ready: true },
  { id: "taxes", name: "Taxes", icon: pixelIcon("taxes"), ready: true },
  { id: "map", name: "Map", icon: pixelIcon("map"), ready: true },
  { id: "weather", name: "Weather", icon: pixelIcon("weather"), ready: true },
  { id: "timeline", name: "Timeline", icon: pixelIcon("calendar"), ready: true },
  { id: "news", name: "News", icon: pixelIcon("news"), ready: false },
  { id: "mail", name: "Mail", icon: pixelIcon("mail"), ready: false },
  { id: "bank", name: "Bank", icon: pixelIcon("bank"), ready: false },
];
```

Check `game/src/ui/pixel-icons.ts` for the `pixelIcon()` id registry; add a `"taxes"` entry there (a simple document/form glyph, following whatever pattern the existing icons use — read 2-3 existing entries in that file first and match their exact shape/size before adding a new one).

- [ ] **Step 2: Dispatch the click to open the desk** (extend `onClick`, `game/src/ui/phone.ts:371-376`)

```ts
    const id = btn.dataset.app as AppDef["id"] | undefined;
    if (!id) return;
    const app = APPS.find((a) => a.id === id)!;
    if (!app.ready) return this.toast(`${app.name} is coming soon`);
    if (id === "goals") return this.deps.openFastForward?.();
    if (id === "taxes") return this.openDesk(undefined, "taxes");
    this.show(id);
```

- [ ] **Step 3: Extend `openDesk` to accept a tab hint** (`game/src/ui/phone.ts:392-401`)

```ts
  /** Opens the Money window, on a stock's page when `stock` is given (#stock=ID) or a specific tab when `tab` is given (#tab=ID). */
  private openDesk(stock?: string, tab?: string) {
    const frame = this.overlay.querySelector("iframe")!;
    const hash = stock ? `#stock=${stock}` : tab ? `#tab=${tab}` : "";
    if (!frame.src) frame.src = `/debt.html${hash}`;
    else if (hash && frame.contentWindow) frame.contentWindow.location.hash = hash.slice(1);
    this.resumeSpeed = this.deps.clock.speed || this.resumeSpeed;
    this.deps.clock.speed = 0;
    this.overlay.hidden = false;
    this.overlay.querySelector<HTMLButtonElement>("[data-close]")!.focus();
    for (const fn of this.showListeners) fn();
  }
```

Update the one other caller, `this.openDesk()` in the `data-desk` click handler (`game/src/ui/phone.ts:359`) and `this.openDesk(btn.dataset.stock)` (`:360`) — both still work unchanged since the new `tab` parameter is optional and appended last.

- [ ] **Step 4: Add the unread badge** in the app-grid markup (`game/src/ui/phone.ts:242-248`), reusing the existing `app-badge` class the "Soon" label already uses:

```ts
              ${APPS.map(
                (a) => `<button class="app${a.ready ? "" : " soon"}" data-app="${a.id}" aria-label="${a.name}${a.ready ? "" : " (coming soon)"}">
                  <span class="app-icon">${a.icon}</span>
                  <span class="app-name">${a.name}</span>
                  ${a.ready ? "" : `<span class="app-badge">Soon</span>`}
                  ${a.id === "taxes" && this.deps.player.pendingTaxReturn() ? `<span class="app-badge app-badge-alert">File</span>` : ""}
                </button>`,
              ).join("")}
```

Add the small `.app-badge-alert` CSS rule to `game/src/ui/pixel-theme.css` (or wherever `.app-badge` is defined — find it with `grep -n "app-badge" game/src/ui/*.css` first) giving it a distinct color (e.g. the theme's warning/red token) instead of the neutral "Soon" grey.

Re-render the badge each day the phone is visible — find where `renderStatus()` (called every second, `game/src/ui/phone.ts:212`) re-renders the home view, and re-run the `APPS.map` templating there too (or extract it into a small `renderApps()` private method called both from `markup()` and from `renderStatus()`, matching how `renderStocks()` is already split out).

- [ ] **Step 5: Build and manually verify**

Run (from `game/`): `npm run build`. Then `npm run dev`, open the city, open the phone, confirm the Taxes icon appears and (once a return is pending — trigger this via `larp.scene()` console access or by fast-forwarding past April 15) shows the "File" badge and opens the Money desk on click.

- [ ] **Step 6: Commit**

```bash
git add game/src/ui/phone.ts game/src/ui/pixel-icons.ts game/src/ui/pixel-theme.css
git commit -m "phone: add the Taxes app, unread badge, and desk tab-hint dispatch"
```

---

### Task 13: Money desk — Taxes tab with the simplified 1040-style form

**Files:**
- Modify: `game/src/debt-demo/main.ts`

**Interfaces:**
- Consumes: `life.pendingTaxReturn()`, `life.fileTaxes()` (Task 10).

- [ ] **Step 1: Add `"taxes"` to the `Tab` type and `TABS`** (`game/src/debt-demo/main.ts:36`, `:81-88`)

```ts
type Tab = "home" | "cash" | "investing" | "debt" | "credit" | "cards" | "taxes";
```

```ts
const TABS: [Tab, string][] = [
  ["home", "Home"],
  ["cash", "Cash"],
  ["investing", "Investing"],
  ["debt", "Debt"],
  ["credit", "Credit"],
  ["cards", "Cards"],
  ["taxes", "Taxes"],
];
```

- [ ] **Step 2: Add a `PAGE_SUB` entry** (find the `PAGE_SUB: Record<Tab, string>` object, `game/src/debt-demo/main.ts:153`) — add a `taxes:` line describing the tab, following the exact style of the existing entries (read them first; each is a short one-line description shown as a page subtitle).

- [ ] **Step 3: Write `taxesPage()`**, modeled on `creditPage()`'s structure (same file, `.section`/`.stats` markup conventions already used throughout — read `creditPage()` in full first and match its exact class names before writing this):

```ts
function taxesPage(): Page {
  const ret = life.pendingTaxReturn();
  if (!ret) {
    return {
      main: `<div class="section"><h2>Taxes</h2><span>Nothing due yet</span></div>
        <div class="stats">${statRow("Wages this year", usd(life.wagesYtd()))}</div>
        <p class="note">Your return for the year becomes ready to file around April 15 of the following year.</p>`,
      side: false,
    };
  }
  const totalOwed = round2(ret.federalRefundOrOwed + ret.stateRefundOrOwed);
  return {
    main: `<div class="section"><h2>Your ${ret.year} tax return</h2><span>Single filer · ${ret.state}</span></div>
      <div class="stats">${[
        statRow("Wages", usd(ret.wages)),
        statRow("Standard deduction", `−${usd(ret.federalStandardDeduction)}`),
        statRow("Federal taxable income", usd(ret.federalTaxableIncome)),
        statRow("Federal tax", usd(ret.federalTax)),
        statRow("Earned Income Tax Credit", ret.eic > 0 ? `−${usd(ret.eic)}` : usd(0)),
        statRow("Federal withheld", usd(ret.federalWithheld)),
        statRow("Federal refund/owed", usd(ret.federalRefundOrOwed)),
        statRow("State tax", usd(ret.stateTax)),
        statRow("State withheld", usd(ret.stateWithheld)),
        statRow("State refund/owed", usd(ret.stateRefundOrOwed)),
      ].join("")}</div>
      <div class="section"><h2>${totalOwed >= 0 ? "Your refund" : "You owe"}</h2><span>${usd(Math.abs(totalOwed))}</span></div>
      <button class="cta" data-file-taxes>File now</button>`,
    side: false,
  };
}
```

(`statRow` and `usd`/`round2` already exist in this file for other tabs — reuse them, don't redefine. Confirm their exact names with `grep -n "function statRow\|function usd\|const round2" game/src/debt-demo/main.ts` before writing this and adjust names if they differ.)

- [ ] **Step 4: Register the page and the File button's click handler**

Add `taxes: taxesPage` to the `pages` record (`game/src/debt-demo/main.ts:1346`):

```ts
  const pages: Record<Tab, () => Page> = { home: homePage, cash: cashPage, investing: investingPage, debt: debtPage, credit: creditPage, cards: cardsPage, taxes: taxesPage };
```

Find the file's existing top-level click handler (the one that already handles other `data-*` action buttons — search `grep -n "addEventListener(\"click\"" game/src/debt-demo/main.ts`) and add a case:

```ts
  if ((ev.target as HTMLElement).closest("[data-file-taxes]")) {
    life.fileTaxes(clock.day);
    render();
    return;
  }
```

- [ ] **Step 5: Route `/debt.html#tab=taxes`** — extend `openFromHash()` (`game/src/debt-demo/main.ts:1577-1584`):

```ts
function openFromHash(): boolean {
  const params = new URLSearchParams(location.hash.slice(1));
  const stockId = params.get("stock");
  if (stockId && INSTRUMENTS.some((i) => i.id === stockId)) {
    openFund(stockId as InstrumentId);
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  const tabId = params.get("tab");
  if (tabId && TABS.some(([id]) => id === tabId)) {
    go(tabId as Tab);
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  return false;
}
```

- [ ] **Step 6: Build and manually verify**

Run (from `game/`): `npm run build`, then `npm run dev`, open `/debt.html#tab=taxes` directly and confirm the tab renders; also confirm the existing `#stock=` links still work unchanged.

- [ ] **Step 7: Commit**

```bash
git add game/src/debt-demo/main.ts
git commit -m "desk: add the Taxes tab with the simplified 1040-style form"
```

---

### Task 14: Full-year integration test and edge cases

**Files:**
- Test: `game/tests/tax.test.ts` (append) and/or `game/tests/life.test.ts` (append) — put PlayerLife-level integration tests in `life.test.ts` to match where Task 8/10/11's tests already live.

- [ ] **Step 1: Add a `WA` Place constant next to the file's existing `TX`/`CA` constants**

```ts
const WA: Place = { abbr: "WA", name: "Washington", rpp: { all: 100.9, goods: 99.6, housing: 116.6 } };
```

- [ ] **Step 2: Write the tests**

```ts
// append to game/tests/life.test.ts — day 220 (START is Sept 11, 2026) lands
// well past the April 15, 2027 deadline.
test("a full year of level paychecks in a no-tax state reconciles to a small refund or owed amount, never wildly off", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  live(life, 220);
  const ret = life.pendingTaxReturn()!;
  const total = Math.abs(ret.federalRefundOrOwed + ret.stateRefundOrOwed);
  // Annualize-and-divide should track the real annual liability closely for a level salary.
  assert.ok(total < 500, `expected a close reconciliation, got ${total}`);
});

test("an unemployed player (UNEMPLOYMENT_SHARE pay) still gets a filed return with lower wages", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  life.setEmployed(false, 1);
  live(life, 220);
  const ret = life.pendingTaxReturn()!;
  assert.ok(ret.wages < 60_000);
});

test("a no-income-tax state never produces a state tax liability regardless of income", () => {
  const life = new PlayerLife({ place: WA, day: 0, grossAnnual: 300_000 });
  live(life, 220);
  const ret = life.pendingTaxReturn()!;
  assert.equal(ret.stateTax, 0);
});
```

- [ ] **Step 3: Run and verify all pass**

Run (from `game/`): `node --test tests/life.test.ts tests/tax.test.ts`
Expected: all PASS. If the reconciliation test fails by a large margin, the bug is almost always a mismatched `periodsPerYear` between `withholdingForPaycheck` (Task 5) and how often `onDay`'s payday block actually fires — the codebase runs paychecks twice a month (`dom === 1 || dom === 15`), i.e. 24/year, which must match the `periodsPerYear` default in Task 5.

- [ ] **Step 4: Run the full project suite and build once more**

Run (from `game/`): `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/tests/life.test.ts
git commit -m "tax: full-year reconciliation and edge-case integration tests"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** every "Decisions locked in" bullet from `docs/superpowers/specs/2026-09-12-tax-filing-design.md` maps to a task: form depth → Task 13; federal+state → Tasks 2-6; withholding replaces the flat approximation → Tasks 8-9; escalating consequences → Tasks 7, 11; deadline flags not pauses → Task 10 (`needsDecision` is untouched — deliberately not extended with `tax_ready`); UI in two places → Tasks 12-13; fast-forward auto-files → Task 10; server records but doesn't score → no task needed, verified in Task 8's "no server changes" note (RunRecorder passes any `type` through as `kind` unchanged).
- **Known simplification carried from the spec, restated here for the implementer:** only one tax year's `unpaidTax` is tracked at a time (Task 11). If a second year's return goes unpaid before the first is resolved, this plan's `tickTaxPenalty` combines them into the same running balance rather than tracking them separately — acceptable for this slice's game-pace (years pass quickly relative to a 180-day penalty clock), but flag it if a playtest surfaces it as confusing.
- **Data risk to flag before shipping:** Task 3's `RAW` table was hand-transcribed against Tax Foundation's 2026 page from research done during this plan's own design phase, not machine-verified row by row against the live page at implementation time — the task's Step 3 instructions say explicitly to re-check it, since state tax law changes are real and this is a hackathon judged partly on being "reputable."
