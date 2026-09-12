# News Progression Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every recorded `LifeEvent`/`DebtEvent` for newsworthiness (severity + rarity + the player's own dollar magnitude), persist the ones that clear the bar as branch-scoped `news_stories` rows, and lazily write their headline/blurb/impact (Gemini, with the existing template fallback) so the phone's News app, the post-fast-forward digest, and calendar revisit can all read the same table.

**Architecture:** A pure scorer (`server/src/news/scorer.ts`) turns one event into a score/prominence/category, or `null` for routine events (paychecks, bills, buys). A thin pipeline (`server/src/news/pipeline.ts`) runs that scorer over every batch `POST /api/events` already receives, using two cheap queries (the player's own net-worth baseline, and how many times each kind has happened before) so it costs nothing extra on a multi-year fast-forward. Scored rows land in a new `news_stories` table with `facts` stored verbatim (no prose yet); a writer (`server/src/news/writer.ts`, same Gemini-with-template-fallback shape as `ai/coach.ts`) fills in prose lazily, capped per request, the first time a range is read. `GET /api/news/:runId?from&to` is the one read path for the feed, a calendar-day revisit, and (later) the digest.

**Tech Stack:** TypeScript, Express + Zod, `pg` (Tiger Data / TimescaleDB), Node's built-in test runner (`node --test`, no framework), the existing Gemini adapter (`server/src/adapters/gemini.ts`).

## Global Constraints

- Every provider key stays server-side; this plan adds no new provider — it reuses the existing `Gemini` client already constructed in `server/src/routes/ai.ts`.
- `server/src/migrations.sql` is additive only, one statement at a time, `CREATE TABLE IF NOT EXISTS` — never edit a past statement (matches the file's existing convention exactly).
- Every route goes through `handle`/`parse`/`HttpError` (`server/src/http.ts`) and `ownRun` (`server/src/routes/snapshot.ts`) for auth — no new auth surface.
- `npx tsc --noEmit -p tsconfig.json` (from `server/`) is the correctness gate; there is no separate lint step.
- Test conventions: `node --test src/<path>/<name>.test.ts`, plain `node:test`/`node:assert/strict`, no framework. Files needing a real database are named `*.db.test.ts` and skip unless `TEST_DATABASE_URL` is set (`server/README.md`), following `server/src/store/runs.db.test.ts`'s throwaway-database pattern exactly.
- `facts` on every `news_stories` row is stored verbatim from the source event's payload — never invent a number that isn't in it (the same rule already enforced in `ai/facts.ts`/`ai/coach.ts`).
- No browser-supplied free text is ever part of a prompt — scorer and writer inputs come only from server-held recorded events.
- Branches don't exist server-side yet: every task uses `branchId = runId` (the root branch), never invents branch logic beyond that column existing.

---

## Current state (verified 2026-09-12 by reading the code, not assuming)

- `server/src/store/runs.ts`: `insertEvents(db, runId, entries: EventRow[])` inserts once per `key` (`ON CONFLICT DO NOTHING`); `EventRow` is `{ key, day, kind, payload }`. `POST /api/events` (`server/src/routes/snapshot.ts:105-111`) validates with `eventsBody` (up to 5,000 events, `kind` matching `/^[a-z_]{1,40}$/`) and calls `insertEvents` directly — this is the batch-insert hook the spec's architecture diagram points at.
- Event kinds that actually exist today (`game/src/sim/life/player.ts`'s `LifeEvent`, `game/src/sim/debt/types.ts`'s `DebtEvent`): `paycheck`, `bill`, `savings_interest`, `moved`, `job`, `trade`, `trade_skipped`, `bear_market`, `market_recovered`, `payment`, `statement`, `missed`, `late_mark`, `penalty_apr`, `collections`, `repossessed`, `default`, `paid_off`, `cannot_cover`, `bankruptcy_eligible`, `score_change`. The identity-level kinds the original design spec names (marriage, divorce, hospitalization, kids, home purchase) **do not exist as typed events yet** — the spec itself calls this out as future work, so this plan's `FLOOR` table only carries `bankruptcy_eligible` today.
- `server/src/ai/facts.ts`'s `describe(event)` already picks the "notable" kinds out of the noise (`paid_off`, `missed`, `late_mark`, `penalty_apr`, `collections`, `repossessed`, `default`, `bankruptcy_eligible`, `moved`, `job`, `trade` when `side === "sell"`) and turns each into one plain-language line; this plan's `SEVERITY`/`CATEGORY` tables cover the same set (plus `bear_market`/`market_recovered`, which aren't in `describe()` but are already used by the recovery feedback flow), and the template writer reuses `describe()` and a newly-exported `impactOf()` instead of re-deriving that text.
- `server/src/ai/coach.ts` + `server/src/ai/facts.ts` are the pattern to copy for the writer: a JSON schema + Zod output type, a prompt built only from facts, `model.json()` tried first, any failure (bad schema, thrown error, no model) falls back to a deterministic template built from the same facts, and the caller gets `{ ..., source: "gemini" | "template" }`.
- `server/src/routes/ai.ts` already constructs `export const gemini = new Gemini({ keys: geminiKeys, models: geminiTextModels })` — this plan imports that instance rather than constructing a second one.
- `server/db/schema.sql`'s `events` table is a TimescaleDB hypertable (`ts, run_id, kind, payload`, no id column); `runs.id` is a `uuid PRIMARY KEY`. `news_stories.run_id` can `REFERENCES runs(id)` directly.
- `server/src/store/runs.db.test.ts` is the template for a real-database test: it spins up a throwaway database per run (`CREATE DATABASE larp_test_<ts>`), applies `game/db/schema.sql` then `server/src/migrations.sql`, and every test is `{ skip }`-gated on `TEST_DATABASE_URL`.

---

## File structure

New files:
- `server/src/news/scorer.ts` — pure severity/rarity/magnitude/score/prominence/category logic and the batch-assignment function. No I/O, no imports from `pg` or `gemini`.
- `server/src/news/scorer.test.ts` — unit tests for the above.
- `server/src/news/store.ts` — the `news_stories` DB layer (mirrors `store/runs.ts`'s shape: plain `async function`s taking a `Db`).
- `server/src/news/store.db.test.ts` — real-database tests for `store.ts`, following `runs.db.test.ts`'s pattern.
- `server/src/news/pipeline.ts` — `scoreAndStoreEvents(db, runId, events)`, the thin wrapper that ties `scorer.ts` to `store.ts` and is called from `POST /api/events`.
- `server/src/news/pipeline.db.test.ts` — real-database tests for the wrapper (rarity decay across two separate requests, retried batches don't double-insert).
- `server/src/news/writer.ts` — `storyPrompt`, `templateStory`, `writeStory`, `writeUnwrittenNews` (the Gemini-with-fallback writer).
- `server/src/news/writer.test.ts` — unit tests with a fake `JsonModel`, mirroring `ai/coach.test.ts`.
- `server/src/routes/news.ts` — `GET /api/news/:runId?from&to`.
- `server/src/routes/news.test.ts` — validation/wiring tests for the route (no real DB needed).

Modified files:
- `server/src/migrations.sql` — add the `news_stories` table (additive).
- `server/src/ai/facts.ts` — export `money` and `impactOf` (both already exist as unexported locals) so `writer.ts` reuses them instead of duplicating money-formatting and impact text.
- `server/src/routes/snapshot.ts` — call `scoreAndStoreEvents` from the `POST /events` handler.
- `server/src/app.ts` — mount `newsRouter` at `/api/news`.
- `server/README.md` — document the new route and table in the existing route-table style.
- `docs/superpowers/specs/2026-09-12-news-progression-engine-design.md` — flip the status line from "on hold" to "implemented" once Task 7 lands, noting what shipped vs. what's still deferred.

---

### Task 1: Pure scorer — severity, rarity, magnitude, one event at a time

**Files:**
- Create: `server/src/news/scorer.ts`
- Test: `server/src/news/scorer.test.ts`

**Interfaces:**
- Produces: `export interface ScoreInput { kind: string; payload: Record<string, unknown>; netWorthBaseline: number; priorCount: number }`, `export interface ScoreResult { score: number; prominence: "front_page" | "section" | "brief"; category: "personal" | "financial" | "world" }`, `export function isEligible(kind: string, payload: Record<string, unknown>): boolean`, `export function score(input: ScoreInput): ScoreResult | null`. Task 2 (`assignScores`) and Task 4 (`pipeline.ts`) both import these exact names.

- [ ] **Step 1: Write the failing test**

Create `server/src/news/scorer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligible, score } from "./scorer.ts";

test("routine kinds are never eligible", () => {
  assert.equal(isEligible("paycheck", {}), false);
  assert.equal(isEligible("bill", {}), false);
  assert.equal(isEligible("statement", {}), false);
  assert.equal(isEligible("payment", {}), false);
  assert.equal(isEligible("savings_interest", {}), false);
  assert.equal(isEligible("score_change", {}), false);
});

test("a buy trade is routine, but a sell trade is eligible (matches ai/facts.ts's describe())", () => {
  assert.equal(isEligible("trade", { side: "buy", amount: 500 }), false);
  assert.equal(isEligible("trade", { side: "sell", amount: 500 }), true);
});

test("a small missed payment doesn't clear the publish threshold", () => {
  const r = score({ kind: "missed", payload: { due: 20, fee: 5 }, netWorthBaseline: 500_000, priorCount: 3 });
  assert.equal(r, null);
});

test("the same dollar amount scores higher for a poorer player (magnitude is relative)", () => {
  const poor = score({ kind: "missed", payload: { due: 500, fee: 25 }, netWorthBaseline: 2_000, priorCount: 0 })!;
  const rich = score({ kind: "missed", payload: { due: 500, fee: 25 }, netWorthBaseline: 2_000_000, priorCount: 0 })!;
  assert.ok(poor.score > rich.score, `poor ${poor.score} should outscore rich ${rich.score}`);
});

test("bankruptcy_eligible always clears the floor regardless of baseline or history", () => {
  const r = score({ kind: "bankruptcy_eligible", payload: { reason: "180 days delinquent" }, netWorthBaseline: 10_000_000, priorCount: 50 })!;
  assert.ok(r.score >= 100, `expected the floor to hold, got ${r.score}`);
  assert.equal(r.category, "personal");
});

test("rarity decays: the same kind happening again scores lower, all else equal", () => {
  const first = score({ kind: "late_mark", payload: { severity: 30, scoreBefore: 700, scoreAfter: 660 }, netWorthBaseline: 50_000, priorCount: 0 })!;
  const fifth = score({ kind: "late_mark", payload: { severity: 30, scoreBefore: 700, scoreAfter: 660 }, netWorthBaseline: 50_000, priorCount: 4 })!;
  assert.ok(first.score > fifth.score, `first ${first.score} should outscore fifth ${fifth.score}`);
});

test("prominence tiers follow the score", () => {
  const big = score({ kind: "bankruptcy_eligible", payload: { reason: "x" }, netWorthBaseline: 1000, priorCount: 0 })!;
  assert.equal(big.prominence, "front_page");
  const mid = score({ kind: "job", payload: { employed: false }, netWorthBaseline: 50_000, priorCount: 0 })!;
  assert.ok(mid.prominence === "section" || mid.prominence === "front_page", mid.prominence);
});

test("category comes from a fixed per-kind table", () => {
  assert.equal(score({ kind: "bear_market", payload: { drop: 0.3, stocks: 10_000 }, netWorthBaseline: 40_000, priorCount: 0 })!.category, "world");
  assert.equal(score({ kind: "moved", payload: { from: "TX", to: "CA", rent: 2000, living: 1500 }, netWorthBaseline: 40_000, priorCount: 0 })!.category, "personal");
  assert.equal(score({ kind: "collections", payload: { balance: 3000 }, netWorthBaseline: 40_000, priorCount: 0 })!.category, "financial");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test src/news/scorer.test.ts`
Expected: FAIL — `Cannot find module './scorer.ts'`.

- [ ] **Step 3: Implement**

Create `server/src/news/scorer.ts`:

```ts
// server/src/news/scorer.ts
// Turns one recorded event into a newsworthiness score, or null for routine
// events (paychecks, bills, buys, statements) that stay in `events` only —
// the same "notable vs. routine" split server/src/ai/facts.ts's describe()
// already makes, just as a number instead of a line of prose. Pure: no
// database, no network, so a 40-year fast-forward can call this per event
// without slowing down (docs/superpowers/specs/2026-09-12-news-progression-engine-design.md).

export type Category = "personal" | "financial" | "world";
export type Prominence = "front_page" | "section" | "brief";

export interface ScoreInput {
  kind: string;
  payload: Record<string, unknown>;
  /** The player's own net worth just before this event, from player_snapshots. Makes magnitude relative, not absolute. */
  netWorthBaseline: number;
  /** How many times this kind has already happened to this player (this run's root branch). */
  priorCount: number;
}

export interface ScoreResult {
  score: number;
  prominence: Prominence;
  category: Category;
}

/** Static per-kind severity. Kinds not listed here are routine and never scored (mirrors ai/facts.ts's describe()). */
const SEVERITY: Record<string, number> = {
  bankruptcy_eligible: 100,
  repossessed: 85,
  collections: 80,
  default: 75,
  bear_market: 70,
  market_recovered: 65,
  cannot_cover: 60,
  job: 55,
  paid_off: 50,
  penalty_apr: 45,
  missed: 40,
  moved: 40,
  late_mark: 35,
  trade: 20,
};

/** Per-kind score floor for events that should always be newsworthy no matter the dollar size. Only bankruptcy_eligible
 *  exists as a typed event today; marriage/divorce/hospitalization/kids/home-purchase belong here once they're modeled
 *  (docs/superpowers/specs/2026-09-12-news-progression-engine-design.md's "explicitly out of scope"). */
const FLOOR: Record<string, number> = {
  bankruptcy_eligible: 100,
};

const CATEGORY: Record<string, Category> = {
  bankruptcy_eligible: "personal",
  job: "personal",
  moved: "personal",
  repossessed: "financial",
  collections: "financial",
  default: "financial",
  cannot_cover: "financial",
  paid_off: "financial",
  penalty_apr: "financial",
  missed: "financial",
  late_mark: "financial",
  trade: "financial",
  bear_market: "world",
  market_recovered: "world",
};

const PUBLISH_THRESHOLD = 40;
const RARITY_BASE = 20;
const MAGNITUDE_SCALE = 15;
const MAGNITUDE_CAP = 30;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The dollar figure that makes this kind's magnitude personal, or 0 for kinds with no natural dollar figure. */
function amountOf(kind: string, payload: Record<string, unknown>): number {
  switch (kind) {
    case "missed":
    case "cannot_cover":
      return num(payload.due);
    case "collections":
      return num(payload.balance);
    case "repossessed":
      return num(payload.deficiency);
    case "bear_market":
      return num(payload.stocks);
    case "market_recovered":
      return num(payload.you);
    case "trade":
      return num(payload.amount);
    case "moved":
      return num(payload.rent) * 12; // a year of the new rent signals how big a move this was
    default:
      return 0;
  }
}

function rarity(priorCount: number): number {
  return RARITY_BASE / (1 + priorCount);
}

/** Log-scaled so a dollar amount matters relative to the player's own net worth, not in absolute terms. */
function magnitude(amount: number, baseline: number): number {
  if (amount <= 0) return 0;
  const ratio = amount / Math.max(1, baseline);
  return Math.min(MAGNITUDE_CAP, Math.log10(1 + ratio) * MAGNITUDE_SCALE);
}

function prominenceOf(total: number): Prominence {
  if (total >= 80) return "front_page";
  if (total >= 55) return "section";
  return "brief";
}

/** True for a kind/payload combination this scorer should even consider; `trade` only counts on the sell side (a buy is routine, matching ai/facts.ts's describe()). */
export function isEligible(kind: string, payload: Record<string, unknown>): boolean {
  if (!(kind in SEVERITY)) return false;
  if (kind === "trade" && payload.side !== "sell") return false;
  return true;
}

/** null means "stays in events only" (below the publish threshold, or not an eligible kind at all). */
export function score(input: ScoreInput): ScoreResult | null {
  if (!isEligible(input.kind, input.payload)) return null;
  const sev = SEVERITY[input.kind];
  const rar = rarity(input.priorCount);
  const mag = magnitude(amountOf(input.kind, input.payload), input.netWorthBaseline);
  let total = sev + rar + mag;
  const floor = FLOOR[input.kind];
  if (floor !== undefined) total = Math.max(total, floor);
  if (total < PUBLISH_THRESHOLD) return null;
  return { score: Math.round(total * 100) / 100, prominence: prominenceOf(total), category: CATEGORY[input.kind] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test src/news/scorer.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add server/src/news/scorer.ts server/src/news/scorer.test.ts
git commit -m "feat(news): pure newsworthiness scorer"
```

---

### Task 2: Batch assignment — scoring a whole `POST /api/events` payload at once

**Files:**
- Modify: `server/src/news/scorer.ts` (append)
- Test: `server/src/news/scorer.test.ts` (append)

**Interfaces:**
- Consumes: `isEligible`, `score`, `ScoreResult` (Task 1).
- Produces: `export interface ScorableEvent { key: string; day: number; kind: string; payload: Record<string, unknown> }`, `export interface ScoredEvent extends ScorableEvent { category: Category; score: number; prominence: Prominence }`, `export function assignScores(events: ScorableEvent[], netWorthBaseline: number, priorCounts: Map<string, number>): ScoredEvent[]`. Task 4's `pipeline.ts` is the only caller.

Why a pure batch function separate from the DB wrapper: this is where the interesting bug lives (two events of the same kind in one 5,000-row fast-forward batch must decay rarity against *each other*, not just against history before the batch) and it needs zero database mocking to test.

- [ ] **Step 1: Write the failing test**

Append to `server/src/news/scorer.test.ts`:

```ts
import { assignScores, type ScorableEvent } from "./scorer.ts";

test("routine events are dropped, eligible ones keep their key/day", () => {
  const events: ScorableEvent[] = [
    { key: "1:0", day: 1, kind: "paycheck", payload: { takeHome: 2000 } },
    { key: "1:1", day: 1, kind: "paid_off", payload: { debtId: "d1", name: "Car loan" } },
  ];
  const out = assignScores(events, 50_000, new Map());
  assert.equal(out.length, 1);
  assert.equal(out[0].key, "1:1");
  assert.equal(out[0].day, 1);
  assert.equal(out[0].kind, "paid_off");
});

test("three late_marks in one batch decay against each other, not just against prior history", () => {
  const events: ScorableEvent[] = [0, 1, 2].map((i) => ({
    key: `${i}:0`,
    day: i,
    kind: "late_mark",
    payload: { severity: 30, scoreBefore: 700 - i * 10, scoreAfter: 690 - i * 10 },
  }));
  const out = assignScores(events, 50_000, new Map());
  assert.equal(out.length, 3);
  assert.ok(out[0].score > out[1].score, `1st ${out[0].score} > 2nd ${out[1].score}`);
  assert.ok(out[1].score > out[2].score, `2nd ${out[1].score} > 3rd ${out[2].score}`);
});

test("prior history from earlier requests lowers the first event in a new batch", () => {
  const events: ScorableEvent[] = [{ key: "10:0", day: 10, kind: "job", payload: { employed: false } }];
  const fresh = assignScores(events, 50_000, new Map())[0];
  const seenBefore = assignScores(events, 50_000, new Map([["job", 5]]))[0];
  assert.ok(fresh.score > seenBefore.score, `fresh ${fresh.score} > seenBefore ${seenBefore.score}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test src/news/scorer.test.ts --test-name-pattern="batch|decay|prior history"`
Expected: FAIL — `assignScores is not a function` / not exported.

- [ ] **Step 3: Implement**

Append to `server/src/news/scorer.ts`:

```ts
export interface ScorableEvent {
  key: string;
  day: number;
  kind: string;
  payload: Record<string, unknown>;
}

export interface ScoredEvent extends ScorableEvent {
  category: Category;
  score: number;
  prominence: Prominence;
}

/**
 * Scores a whole POST /api/events batch (one event per day in live play, or thousands at once after a
 * fast-forward) in one pass. `priorCounts` is this kind's count from *before* the batch (server/src/news/pipeline.ts
 * queries it once, before inserting the batch's own events, so a repeat within the batch decays correctly
 * against events earlier in the very same batch, not just against older requests).
 */
export function assignScores(events: ScorableEvent[], netWorthBaseline: number, priorCounts: Map<string, number>): ScoredEvent[] {
  const counts = new Map(priorCounts);
  const out: ScoredEvent[] = [];
  for (const e of events) {
    const priorCount = counts.get(e.kind) ?? 0;
    counts.set(e.kind, priorCount + 1);
    const result = score({ kind: e.kind, payload: e.payload, netWorthBaseline, priorCount });
    if (!result) continue;
    out.push({ ...e, category: result.category, score: result.score, prominence: result.prominence });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test src/news/scorer.test.ts`
Expected: PASS (all cases, Task 1's and Task 2's).

- [ ] **Step 5: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 6: Commit**

```bash
git add server/src/news/scorer.ts server/src/news/scorer.test.ts
git commit -m "feat(news): score a whole event batch, decaying rarity within it"
```

---

### Task 3: `news_stories` migration and DB store layer

**Files:**
- Modify: `server/src/migrations.sql` (append)
- Create: `server/src/news/store.ts`
- Test: `server/src/news/store.db.test.ts`

**Interfaces:**
- Produces: `export type Db = pg.Pool`, `export interface NewNewsStory { runId, branchId, day, eventKey, kind, category, score, prominence, facts }`, `export interface NewsStoryRow extends NewNewsStory { id, headline, blurb, impact, source }`, `export async function insertNewsStories(db, rows: NewNewsStory[]): Promise<number>`, `export async function priorKindCounts(db, runId, kinds: string[]): Promise<Map<string, number>>`, `export async function runBaseline(db, runId, uptoDay): Promise<number>`, `export async function unwrittenNewsStories(db, runId, branchId, limit): Promise<NewsStoryRow[]>`, `export async function markNewsStoryWritten(db, id, headline, blurb, impact, source): Promise<void>`, `export async function listNewsStories(db, runId, branchId, from, to): Promise<NewsStoryRow[]>`. Task 4 (`pipeline.ts`) and Task 5/6 (`writer.ts`, `routes/news.ts`) are the consumers.

- [ ] **Step 1: Add the migration**

Append to `server/src/migrations.sql` (after the existing "Investing lines" section — check the file's tail with `tail -30 server/src/migrations.sql` first and add after the last statement, keeping the file's one-statement-at-a-time, additive-only convention):

```sql
-- News Progression Engine (docs/superpowers/specs/2026-09-12-news-progression-engine-design.md):
-- events that clear the newsworthiness score, branch-scoped for calendar rewind. branch_id defaults
-- to run_id (the root branch) until server-side branching exists; facts is stored verbatim so every
-- story is auditable and regeneratable, same discipline as ai/facts.ts.

CREATE TABLE IF NOT EXISTS news_stories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES runs(id),
  branch_id    uuid NOT NULL,
  day          int  NOT NULL,
  event_key    text NOT NULL,
  kind         text NOT NULL,
  category     text NOT NULL,
  score        real NOT NULL,
  prominence   text NOT NULL,
  facts        jsonb NOT NULL,
  headline     text,
  blurb        text,
  impact       text,
  source       text,
  written_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, branch_id, event_key)
);
CREATE INDEX IF NOT EXISTS news_stories_run_branch_day ON news_stories (run_id, branch_id, day);
```

- [ ] **Step 2: Write the failing test**

Create `server/src/news/store.db.test.ts`:

```ts
// server/src/news/store.db.test.ts
// news_stories against a real TimescaleDB, same throwaway-database pattern as
// server/src/store/runs.db.test.ts. Skipped unless TEST_DATABASE_URL is set:
//   TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.ts";
import { createRun, insertEvents, insertSnapshots } from "../store/runs.ts";
import {
  insertNewsStories,
  listNewsStories,
  markNewsStoryWritten,
  priorKindCounts,
  runBaseline,
  unwrittenNewsStories,
  type NewNewsStory,
} from "./store.ts";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;

before(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  dbName = `larp_test_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  db = new pg.Pool({ connectionString: u.toString() });
  for (const s of splitSql(read("../../../game/db/schema.sql"))) await db.query(s);
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
  await db.query(`INSERT INTO players (id, name) VALUES ($1, 'guest-alice')`, [ALICE]);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

const row = (runId: string, over: Partial<NewNewsStory> = {}): NewNewsStory => ({
  runId,
  branchId: runId,
  day: 10,
  eventKey: "10:0",
  kind: "paid_off",
  category: "financial",
  score: 72,
  prominence: "section",
  facts: { debtId: "d1", name: "Car loan" },
  ...over,
});

test("a story inserts once per (run, branch, event key); a retry is a no-op", { skip }, async () => {
  const run = await createRun(db, ALICE, 1);
  assert.equal(await insertNewsStories(db, [row(run)]), 1);
  assert.equal(await insertNewsStories(db, [row(run)]), 0, "retried batch inserts nothing new");
  const stories = await listNewsStories(db, run, run, 0, 30);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].headline, null, "no prose yet");
});

test("priorKindCounts counts this run's own events table, per kind", { skip }, async () => {
  const run = await createRun(db, ALICE, 2);
  await insertEvents(db, run, [
    { key: "1:0", day: 1, kind: "late_mark", payload: {} },
    { key: "2:0", day: 2, kind: "late_mark", payload: {} },
    { key: "3:0", day: 3, kind: "job", payload: { employed: false } },
  ]);
  const counts = await priorKindCounts(db, run, ["late_mark", "job", "moved"]);
  assert.equal(counts.get("late_mark"), 2);
  assert.equal(counts.get("job"), 1);
  assert.equal(counts.has("moved"), false);
});

test("runBaseline reads the latest snapshot at or before the given day", { skip }, async () => {
  const run = await createRun(db, ALICE, 3);
  await insertSnapshots(db, run, [
    { day: 5, netWorth: 1000, checking: 500, savings: 500, brokerage: 0, retirement: 0, debt: 0 },
    { day: 15, netWorth: 2000, checking: 1000, savings: 1000, brokerage: 0, retirement: 0, debt: 0 },
  ]);
  assert.equal(await runBaseline(db, run, 10), 1000);
  assert.equal(await runBaseline(db, run, 20), 2000);
  assert.equal(await runBaseline(db, run, 0), 0, "no snapshot yet: baseline is 0, not an error");
});

test("unwrittenNewsStories then markNewsStoryWritten moves a row out of the unwritten queue", { skip }, async () => {
  const run = await createRun(db, ALICE, 4);
  await insertNewsStories(db, [row(run)]);
  const unwritten = await unwrittenNewsStories(db, run, run, 20);
  assert.equal(unwritten.length, 1);
  await markNewsStoryWritten(db, unwritten[0].id, "Car loan paid off", "The last payment cleared the balance.", "More cash free for savings.", "template");
  assert.equal((await unwrittenNewsStories(db, run, run, 20)).length, 0);
  const [written] = await listNewsStories(db, run, run, 0, 30);
  assert.equal(written.headline, "Car loan paid off");
  assert.equal(written.source, "template");
});

test("listNewsStories only returns this run's own stories, and only within the day range", { skip }, async () => {
  const runA = await createRun(db, ALICE, 5);
  const runB = await createRun(db, ALICE, 6);
  await insertNewsStories(db, [row(runA, { day: 5, eventKey: "5:0" }), row(runA, { day: 50, eventKey: "50:0" }), row(runB, { day: 5, eventKey: "5:0" })]);
  const inRange = await listNewsStories(db, runA, runA, 0, 10);
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0].day, 5);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && node --test src/news/store.db.test.ts`
Expected: FAIL — `Cannot find module './store.ts'` (or all tests skipped with a clear message if `TEST_DATABASE_URL` isn't set; run with it set per `server/README.md` to actually exercise this task).

- [ ] **Step 4: Implement**

Create `server/src/news/store.ts`:

```ts
// server/src/news/store.ts
// news_stories in Tiger Data: insert (once per event), the two reads the scorer needs (a baseline and
// prior-kind counts), and the reads the writer and the API need (unwritten queue, a day range).
import type pg from "pg";

export type Db = pg.Pool;

export interface NewNewsStory {
  runId: string;
  /** Root branch = runId until server-side branching exists. */
  branchId: string;
  day: number;
  eventKey: string;
  kind: string;
  category: string;
  score: number;
  prominence: string;
  facts: Record<string, unknown>;
}

export interface NewsStoryRow extends NewNewsStory {
  id: string;
  headline: string | null;
  blurb: string | null;
  impact: string | null;
  source: string | null;
}

const SELECT_COLUMNS = `id, run_id AS "runId", branch_id AS "branchId", day, event_key AS "eventKey", kind, category,
  score, prominence, facts, headline, blurb, impact, source`;

/** Inserts once per (run, branch, event key); a retried batch (same events resent) inserts nothing new. */
export async function insertNewsStories(db: Db, rows: NewNewsStory[]): Promise<number> {
  if (!rows.length) return 0;
  const r = await db.query(
    `INSERT INTO news_stories (run_id, branch_id, day, event_key, kind, category, score, prominence, facts)
     SELECT $1, b, d, k, kd, c, s, p, f
     FROM unnest($2::uuid[], $3::int[], $4::text[], $5::text[], $6::text[], $7::real[], $8::text[], $9::jsonb[])
       AS t(b, d, k, kd, c, s, p, f)
     ON CONFLICT (run_id, branch_id, event_key) DO NOTHING`,
    [
      rows[0].runId,
      rows.map((r) => r.branchId),
      rows.map((r) => r.day),
      rows.map((r) => r.eventKey),
      rows.map((r) => r.kind),
      rows.map((r) => r.category),
      rows.map((r) => r.score),
      rows.map((r) => r.prominence),
      rows.map((r) => JSON.stringify(r.facts)),
    ],
  );
  return r.rowCount ?? 0;
}

/** How many of each kind has already happened in this run's events table (root branch scope, same as everywhere else today). */
export async function priorKindCounts(db: Db, runId: string, kinds: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(kinds)];
  if (!uniq.length) return new Map();
  const { rows } = await db.query<{ kind: string; count: string }>(
    `SELECT kind, count(*)::text AS count FROM events WHERE run_id = $1 AND kind = ANY($2::text[]) GROUP BY kind`,
    [runId, uniq],
  );
  return new Map(rows.map((r) => [r.kind, Number(r.count)]));
}

/** The player's net worth at or before `uptoDay`; 0 (not an error) before the first snapshot lands. */
export async function runBaseline(db: Db, runId: string, uptoDay: number): Promise<number> {
  const { rows } = await db.query<{ netWorth: number }>(
    `SELECT net_worth AS "netWorth" FROM player_snapshots WHERE run_id = $1 AND day <= $2 ORDER BY day DESC LIMIT 1`,
    [runId, uptoDay],
  );
  return rows[0]?.netWorth ?? 0;
}

/** Stories with no headline yet, oldest first, capped so one request can't trigger unlimited Gemini calls. */
export async function unwrittenNewsStories(db: Db, runId: string, branchId: string, limit: number): Promise<NewsStoryRow[]> {
  const { rows } = await db.query<NewsStoryRow>(
    `SELECT ${SELECT_COLUMNS} FROM news_stories WHERE run_id = $1 AND branch_id = $2 AND headline IS NULL ORDER BY day ASC LIMIT $3`,
    [runId, branchId, limit],
  );
  return rows;
}

export async function markNewsStoryWritten(db: Db, id: string, headline: string, blurb: string, impact: string, source: string): Promise<void> {
  await db.query(`UPDATE news_stories SET headline = $2, blurb = $3, impact = $4, source = $5, written_at = now() WHERE id = $1`, [
    id,
    headline,
    blurb,
    impact,
    source,
  ]);
}

/** One run's stories in a day range, oldest first — the same query shape for the feed, a calendar-day revisit, and the digest. */
export async function listNewsStories(db: Db, runId: string, branchId: string, from: number, to: number): Promise<NewsStoryRow[]> {
  const { rows } = await db.query<NewsStoryRow>(
    `SELECT ${SELECT_COLUMNS} FROM news_stories WHERE run_id = $1 AND branch_id = $2 AND day BETWEEN $3 AND $4 ORDER BY day ASC`,
    [runId, branchId, from, to],
  );
  return rows;
}
```

Note on `insertNewsStories`: `unnest()` cannot cast a `jsonb[]` array cleanly alongside scalar arrays in one `FROM unnest(...)` in this Postgres version's parser in every case, so `facts` is zipped in via a second `unnest(...) WITH ORDINALITY` joined by row position — if this proves unnecessary (test it first), simplify to a single `unnest($2::uuid[], ..., $9::jsonb[])` call exactly like `insertEvents`'s existing pattern (`server/src/store/runs.ts:114-123` already does `$5::jsonb[]` in one `unnest` — try that simpler form first in Step 4 and only fall back to the two-`unnest` version if it errors).

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' node --test src/news/store.db.test.ts` (from `server/`; start the local TimescaleDB per `server/README.md` first if it isn't running: `docker run -d --name larp-pg -e POSTGRES_PASSWORD=larp -p 5433:5432 timescale/timescaledb:latest-pg17`)
Expected: PASS (all 5 cases). If the single-`unnest` form from the Step 4 note works, use it — it's simpler and matches `insertEvents` exactly.

- [ ] **Step 6: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 7: Commit**

```bash
git add server/src/migrations.sql server/src/news/store.ts server/src/news/store.db.test.ts
git commit -m "feat(news): news_stories table and DB store layer"
```

---

### Task 4: Pipeline wrapper and wiring into `POST /api/events`

**Files:**
- Create: `server/src/news/pipeline.ts`
- Create: `server/src/news/pipeline.db.test.ts`
- Modify: `server/src/routes/snapshot.ts`

**Interfaces:**
- Consumes: `assignScores` (Task 2), `insertNewsStories`/`priorKindCounts`/`runBaseline` (Task 3).
- Produces: `export async function scoreAndStoreEvents(db: Db, runId: string, events: ScorableEvent[]): Promise<number>`. `routes/snapshot.ts` is the only caller.

Why scoring runs **before** `insertEvents`, not after (the design spec's architecture diagram draws it after — this is a deliberate, documented correction found while implementing): `priorKindCounts` counts rows already in the `events` table. If it ran after `insertEvents` for the same batch, a batch's own events would already be counted, so the *first* occurrence of a kind in a batch would look like it had already happened several times. Scoring first means `priorKindCounts` only ever reflects events from *earlier* requests, and `assignScores`'s own within-batch counter (Task 2) correctly decays repeats inside the current batch. Both orderings finish in the same request, so nothing in the spec's efficiency guarantee changes — only correctness of the rarity number does.

- [ ] **Step 1: Write the failing test**

Create `server/src/news/pipeline.db.test.ts`:

```ts
// server/src/news/pipeline.db.test.ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.ts";
import { createRun, insertEvents, insertSnapshots } from "../store/runs.ts";
import { listNewsStories } from "./store.ts";
import { scoreAndStoreEvents } from "./pipeline.ts";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;

before(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  dbName = `larp_test_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  db = new pg.Pool({ connectionString: u.toString() });
  for (const s of splitSql(read("../../../game/db/schema.sql"))) await db.query(s);
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
  await db.query(`INSERT INTO players (id, name) VALUES ($1, 'guest-alice')`, [ALICE]);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

test("a batch scores eligible events, drops routine ones, and a retry stores nothing new", { skip }, async () => {
  const run = await createRun(db, ALICE, 1);
  await insertSnapshots(db, run, [{ day: 0, netWorth: 5000, checking: 2500, savings: 2500, brokerage: 0, retirement: 0, debt: 0 }]);
  const events = [
    { key: "1:0", day: 1, kind: "paycheck", payload: { takeHome: 2000, garnished: 0, unemployed: false } },
    { key: "1:1", day: 1, kind: "paid_off", payload: { debtId: "d1", name: "Car loan" } },
  ];
  await insertEvents(db, run, events);
  const stored = await scoreAndStoreEvents(db, run, events);
  assert.equal(stored, 1, "only paid_off is eligible");
  const stories = await listNewsStories(db, run, run, 0, 10);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].kind, "paid_off");

  const retried = await scoreAndStoreEvents(db, run, events);
  assert.equal(retried, 0, "the same event key never scores twice");
});

test("rarity decays across two separate requests, not just within one batch", { skip }, async () => {
  const run = await createRun(db, ALICE, 2);
  await insertSnapshots(db, run, [{ day: 0, netWorth: 40_000, checking: 20_000, savings: 20_000, brokerage: 0, retirement: 0, debt: 0 }]);

  const first = [{ key: "1:0", day: 1, kind: "late_mark", payload: { severity: 30, scoreBefore: 700, scoreAfter: 660 } }];
  await insertEvents(db, run, first);
  await scoreAndStoreEvents(db, run, first);

  const second = [{ key: "2:0", day: 2, kind: "late_mark", payload: { severity: 30, scoreBefore: 660, scoreAfter: 620 } }];
  await insertEvents(db, run, second);
  await scoreAndStoreEvents(db, run, second);

  const [story1, story2] = await listNewsStories(db, run, run, 0, 10);
  assert.ok(story1.score > story2.score, `request 1's story (${story1.score}) should outscore request 2's (${story2.score})`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test src/news/pipeline.db.test.ts`
Expected: FAIL — `Cannot find module './pipeline.ts'`.

- [ ] **Step 3: Implement**

Create `server/src/news/pipeline.ts`:

```ts
// server/src/news/pipeline.ts
// The one call routes/snapshot.ts's POST /events makes: score this batch and store whatever clears
// the publish threshold. Two queries total, no matter the batch size (a multi-year fast-forward is
// still just two queries plus one insert), because assignScores (scorer.ts) does the per-event math
// in memory and priorKindCounts/runBaseline each run once for the whole batch.
import { assignScores, type ScorableEvent } from "./scorer.ts";
import { insertNewsStories, priorKindCounts, runBaseline, type Db, type NewNewsStory } from "./store.ts";

export async function scoreAndStoreEvents(db: Db, runId: string, events: ScorableEvent[]): Promise<number> {
  if (!events.length) return 0;
  const maxDay = Math.max(...events.map((e) => e.day));
  const [baseline, counts] = await Promise.all([runBaseline(db, runId, maxDay), priorKindCounts(db, runId, events.map((e) => e.kind))]);
  const scored = assignScores(events, baseline, counts);
  if (!scored.length) return 0;
  const branchId = runId; // root branch = run_id until server-side branching exists
  const rows: NewNewsStory[] = scored.map((e) => ({
    runId,
    branchId,
    day: e.day,
    eventKey: e.key,
    kind: e.kind,
    category: e.category,
    score: e.score,
    prominence: e.prominence,
    facts: e.payload,
  }));
  return insertNewsStories(db, rows);
}
```

Now wire it into `server/src/routes/snapshot.ts`. Add the import near the top (with the other local imports):

```ts
import { scoreAndStoreEvents } from "../news/pipeline.js";
```

Replace the existing `/events` handler (`server/src/routes/snapshot.ts:105-111`):

```ts
snapshotRouter.post(
  "/events",
  handle(async (req) => {
    const body = parse(eventsBody, req.body);
    const runId = await ownRun(req, body.runId);
    // Scores before inserting: priorKindCounts reads the events table, and scoring after insert would
    // count this batch's own rows, making a kind's first occurrence in the batch look like a repeat
    // (server/src/news/pipeline.ts's file header has the full reasoning).
    await scoreAndStoreEvents(pool, runId, body.events);
    return { stored: await insertEvents(pool, runId, body.events) };
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' node --test src/news/pipeline.db.test.ts` (from `server/`)
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json && npm test` (the db tests still skip without `TEST_DATABASE_URL`; run once more with it set to be sure nothing else broke: `TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test`)

- [ ] **Step 6: Commit**

```bash
git add server/src/news/pipeline.ts server/src/news/pipeline.db.test.ts server/src/routes/snapshot.ts
git commit -m "feat(news): score and store every POST /api/events batch"
```

---

### Task 5: Writer — Gemini prose with the existing template fallback

**Files:**
- Modify: `server/src/ai/facts.ts` (export two existing locals)
- Create: `server/src/news/writer.ts`
- Test: `server/src/news/writer.test.ts`

**Interfaces:**
- Consumes: `describe`, `gameDate` (already exported from `ai/facts.ts`), `money`, `impactOf` (newly exported by this task), `NewsStoryRow` (Task 3), `JsonModel` (`adapters/gemini.ts`, already exists).
- Produces: `export interface WrittenStory { headline: string; blurb: string; impact: string }`, `export function storyPrompt(row: NewsStoryRow): string`, `export function templateStory(row: NewsStoryRow): WrittenStory`, `export async function writeStory(model: JsonModel | null, row: NewsStoryRow): Promise<{ story: WrittenStory; source: "gemini" | "template"; model?: string }>`, `export async function writeUnwrittenNews(db: Db, model: JsonModel | null, runId: string, branchId: string, limit: number): Promise<number>`. Task 6's route is the consumer.

- [ ] **Step 1: Export the two locals `writer.ts` needs**

In `server/src/ai/facts.ts`, change:

```ts
const money = (x: number) => `${x < 0 ? "-" : ""}$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
```

to:

```ts
export const money = (x: number) => `${x < 0 ? "-" : ""}$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
```

and change:

```ts
function impactOf(kind: string): string {
```

to:

```ts
export function impactOf(kind: string): string {
```

- [ ] **Step 2: Run the existing facts test to confirm nothing broke**

Run: `cd server && node --test src/ai/facts.test.ts`
Expected: PASS unchanged (this is a pure export-visibility change, no behavior differs).

- [ ] **Step 3: Commit the export change on its own (small, reviewable independently)**

```bash
git add server/src/ai/facts.ts
git commit -m "refactor(ai): export money and impactOf for reuse by the news writer"
```

- [ ] **Step 4: Write the failing test for the writer**

Create `server/src/news/writer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { JsonModel } from "../adapters/gemini.ts";
import type { NewsStoryRow } from "./store.ts";
import { storyPrompt, templateStory, writeStory } from "./writer.ts";

const row: NewsStoryRow = {
  id: "s1",
  runId: "r1",
  branchId: "r1",
  day: 50,
  eventKey: "50:0",
  kind: "paid_off",
  category: "financial",
  score: 72,
  prominence: "section",
  facts: { debtId: "d1", name: "Car loan" },
  headline: null,
  blurb: null,
  impact: null,
  source: null,
};

const model = (value: unknown | (() => never)): JsonModel & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    prompts,
    async json(prompt) {
      prompts.push(prompt);
      if (typeof value === "function") (value as () => never)();
      return { value, model: "gemini-test" };
    },
  };
};

test("templateStory reuses ai/facts.ts's describe() and impactOf() verbatim", () => {
  const s = templateStory(row);
  assert.match(s.headline, /Paid off the Car loan/);
  assert.match(s.impact, /free for savings/);
});

test("the prompt carries only the story's own facts, not the browser's text", () => {
  const p = storyPrompt(row);
  assert.match(p, /Larp City Ledger/);
  assert.ok(p.includes(JSON.stringify({ kind: row.kind, day: "2026-10-30", ...row.facts })) || p.includes(row.kind));
});

test("a valid Gemini answer is used and labeled", async () => {
  const m = model({ headline: "Car loan paid off", blurb: "The last payment cleared it.", impact: "More room for savings." });
  const r = await writeStory(m, row);
  assert.equal(r.source, "gemini");
  assert.equal(r.story.headline, "Car loan paid off");
});

test("a bad answer, a thrown error, or no model falls back to the template", async () => {
  for (const bad of [{ headline: "x" }, {}, "text"]) {
    assert.equal((await writeStory(model(bad), row)).source, "template", JSON.stringify(bad));
  }
  const throws = model(() => {
    throw new Error("503 high demand");
  });
  assert.equal((await writeStory(throws, row)).source, "template");
  const none = await writeStory(null, row);
  assert.equal(none.source, "template");
  assert.match(none.story.headline, /Car loan/);
});
```

Adjust the day-50 date assertion above if `gameDate(50)` doesn't land on `2026-10-30` — check `server/src/ai/facts.ts`'s `GAME_START_MS` (`Date.UTC(2026, 8, 11)`, i.e. 2026-09-11) and compute `new Date(Date.UTC(2026,8,11) + 50*86400000).toISOString().slice(0,10)` before hardcoding; the test only needs the prompt to contain the facts JSON, so simplify to `assert.ok(p.includes(JSON.stringify(row.facts).slice(1, -1)))`-style substring checks if the exact date string is inconvenient to hardcode.

- [ ] **Step 5: Run test to verify it fails**

Run: `cd server && node --test src/news/writer.test.ts`
Expected: FAIL — `Cannot find module './writer.ts'`.

- [ ] **Step 6: Implement**

Create `server/src/news/writer.ts`:

```ts
// server/src/news/writer.ts
// Fills in one news_stories row's headline/blurb/impact: Gemini first, the same
// deterministic-template-from-facts fallback pattern as server/src/ai/coach.ts otherwise.
import { z } from "zod";
import type { JsonModel } from "../adapters/gemini.ts";
import { describe, gameDate, impactOf } from "../ai/facts.ts";
import { logger } from "../logger.ts";
import { markNewsStoryWritten, unwrittenNewsStories, type Db, type NewsStoryRow } from "./store.ts";

export type Source = "gemini" | "template";

export interface WrittenStory {
  headline: string;
  blurb: string;
  impact: string;
}

const STORY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "A newspaper headline, at most 10 words." },
    blurb: { type: "string", description: "One or two sentences on what happened." },
    impact: { type: "string", description: "One sentence on what it means for the player's money." },
  },
  required: ["headline", "blurb", "impact"],
};

const storyOut = z.object({
  headline: z.string().trim().min(1).max(100),
  blurb: z.string().trim().min(1).max(500),
  impact: z.string().trim().min(1).max(300),
});

export function storyPrompt(row: NewsStoryRow): string {
  return [
    "You write one story for the Larp City Ledger, the in-game newspaper.",
    `It ran on ${gameDate(row.day)} in the "${row.category}" section, prominence "${row.prominence}".`,
    "Rules:",
    "- Use only the facts below; every number must come from them. Don't invent events, places, or people.",
    "- Write money as whole dollars with a dollar sign and commas, like $12,345 or -$12,345.",
    "- headline: at most 10 words. blurb: one or two sentences. impact: one sentence on what it means for the player's money.",
    "- Plain, warm newspaper style. Education, not financial advice.",
    "Facts (JSON):",
    JSON.stringify({ kind: row.kind, day: gameDate(row.day), ...row.facts }),
  ].join("\n");
}

/** The deterministic fallback: the same plain-language line ai/facts.ts's newspaper digest already writes per event, split into headline/blurb/impact instead of one combined line. */
export function templateStory(row: NewsStoryRow): WrittenStory {
  const text = describe({ key: row.eventKey, day: row.day, kind: row.kind, payload: row.facts }) ?? `Something changed: ${row.kind.replace(/_/g, " ")}.`;
  return {
    headline: text.length > 70 ? `${text.slice(0, 67)}...` : text,
    blurb: `On ${gameDate(row.day)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}.`,
    impact: impactOf(row.kind),
  };
}

export async function writeStory(model: JsonModel | null, row: NewsStoryRow): Promise<{ story: WrittenStory; source: Source; model?: string }> {
  if (model) {
    try {
      const r = await model.json(storyPrompt(row), STORY_SCHEMA);
      return { story: storyOut.parse(r.value), source: "gemini", model: r.model };
    } catch (err) {
      logger.warn({ message: err instanceof Error ? err.message : String(err) }, "news story fell back to the template");
    }
  }
  return { story: templateStory(row), source: "template" };
}

/** Writes prose for up to `limit` unwritten stories, oldest first. Returns how many were written. */
export async function writeUnwrittenNews(db: Db, model: JsonModel | null, runId: string, branchId: string, limit: number): Promise<number> {
  const rows = await unwrittenNewsStories(db, runId, branchId, limit);
  for (const row of rows) {
    const { story, source } = await writeStory(model, row);
    await markNewsStoryWritten(db, row.id, story.headline, story.blurb, story.impact, source);
  }
  return rows.length;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd server && node --test src/news/writer.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`

- [ ] **Step 9: Commit**

```bash
git add server/src/news/writer.ts server/src/news/writer.test.ts
git commit -m "feat(news): Gemini story writer with the existing template fallback"
```

---

### Task 6: `GET /api/news/:runId` route

**Files:**
- Create: `server/src/routes/news.ts`
- Test: `server/src/routes/news.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `gemini` (already exported from `routes/ai.ts`), `ownRun` (already exported from `routes/snapshot.ts`), `listNewsStories` (Task 3), `writeUnwrittenNews` (Task 5).
- Produces: `export const newsRouter: Router`. `app.ts` mounts it; nothing else consumes it directly.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/news.test.ts` (validation-only, no real database — mirrors `routes/snapshot.test.ts`'s style of testing the Zod schemas and small pure pieces directly rather than spinning up the whole app):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedQuery } from "./news.ts";

test("from/to default to the full day range", () => {
  const q = feedQuery.parse({});
  assert.equal(q.from, 0);
  assert.ok(q.to > 0);
});

test("from/to reject out-of-range or non-numeric values", () => {
  assert.equal(feedQuery.safeParse({ from: -1 }).success, false);
  assert.equal(feedQuery.safeParse({ from: "not-a-number" }).success, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test src/routes/news.test.ts`
Expected: FAIL — `Cannot find module './news.ts'`.

- [ ] **Step 3: Implement**

Create `server/src/routes/news.ts`:

```ts
// server/src/routes/news.ts
// The one read path for the phone's News app, a calendar-day revisit, and (later) the post-skip
// digest: same query shape, a different day range.
//
//   GET /api/news/:runId  ?from&to   -> [{ id, day, kind, category, score, prominence, headline, blurb, impact, source, ... }]
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { handle, parse } from "../http.js";
import { listNewsStories } from "../news/store.js";
import { writeUnwrittenNews } from "../news/writer.js";
import { gemini } from "./ai.js";
import { ownRun } from "./snapshot.js";

export const newsRouter = Router();

const MAX_DAY = 100_000;
/** Caps how many stories one request can ask Gemini to write, so a big unread range can't fire hundreds of model calls in one request. */
const WRITE_CAP = 20;

export const feedQuery = z.object({
  from: z.coerce.number().int().min(0).max(MAX_DAY).default(0),
  to: z.coerce.number().int().min(0).max(MAX_DAY).default(MAX_DAY),
});

newsRouter.get(
  "/:runId",
  handle(async (req) => {
    const q = parse(feedQuery, req.query);
    const runId = await ownRun(req, req.params.runId);
    const branchId = runId; // root branch = run_id until server-side branching exists
    await writeUnwrittenNews(pool, gemini, runId, branchId, WRITE_CAP);
    return listNewsStories(pool, runId, branchId, q.from, q.to);
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test src/routes/news.test.ts`
Expected: PASS.

- [ ] **Step 5: Mount the router**

In `server/src/app.ts`, add the import next to the other route imports:

```ts
import { newsRouter } from "./routes/news.js";
```

Add the mount next to the other authenticated routes (after `app.use("/api", snapshotRouter);`):

```ts
app.use("/api/news", newsRouter);
```

- [ ] **Step 6: Full server suite + typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json && npm test`
Then, with the local database running, run everything including the db tests: `TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/news.ts server/src/routes/news.test.ts server/src/app.ts
git commit -m "feat(news): GET /api/news/:runId, mounted in the app"
```

---

### Task 7: Docs

**Files:**
- Modify: `server/README.md`
- Modify: `docs/superpowers/specs/2026-09-12-news-progression-engine-design.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add the route to `server/README.md`'s route table**

In `server/README.md`, add a new subsection after "## AI coach and newspaper (Gemini)" (matching that section's exact style: a short paragraph, then a route table):

```markdown
## News Progression Engine

Every `POST /api/events` batch is scored for newsworthiness before it's inserted (`src/news/scorer.ts`:
severity + rarity + the player's own dollar magnitude relative to their net worth), and whatever clears
the publish threshold is stored in `news_stories` with its facts verbatim, no prose yet. Prose is written
lazily — Gemini with the same template fallback as the coach and newspaper above — the first time a day
range is read.

| Route | Query | Returns |
| --- | --- | --- |
| `GET /api/news/:runId` | `?from&to` | stories in that day range, oldest first, with prose already filled in (writing capped at 20 per request) |

Branches don't exist server-side yet, so every story's `branch_id` is its `run_id` (the root branch); see
`docs/superpowers/specs/2026-09-12-news-progression-engine-design.md` for the rewind design this reserves.
```

- [ ] **Step 2: Update the design spec's status**

In `docs/superpowers/specs/2026-09-12-news-progression-engine-design.md`, replace the header's `Status:` line:

```
Status: Approved design, on hold until other open PRs (Nessie fallback, etc.) merge to `main`; this doc is the starting point when work resumes.
```

with:

```
Status: Implemented (docs/superpowers/plans/2026-09-12-news-progression-engine.md). The scorer, storage, and lazy writer described below are built and live behind `GET /api/news/:runId`. Still deferred, per "Explicitly out of scope" below: the frontend News app UI, the random event/rate engine, the fast-forward interrupt engine, and real server-side branch forking (branch_id exists and defaults to the run's own id).
```

- [ ] **Step 3: Commit**

```bash
git add server/README.md docs/superpowers/specs/2026-09-12-news-progression-engine-design.md
git commit -m "docs: News Progression Engine is implemented"
```

---

## Self-review notes (spec coverage)

- Scoring mechanism (severity + rarity + magnitude, floor for identity-level kinds, three prominence tiers, category metadata): Task 1 + Task 2.
- "Must work identically whether events arrive one per day or thousands at once", "no LLM in the hot path": Task 4 (`scoreAndStoreEvents` is pure arithmetic plus two queries regardless of batch size; the writer, the only place an LLM is called, runs on read in Task 6, capped).
- Branch-aware storage, "old branch's stories stay queryable untouched": Task 3's schema carries `branch_id` from day one; every read/write is scoped by it. Real forking isn't built (out of scope in the original spec) — documented as deferred in Task 7.
- "Revisit is the same query shape as the feed and the digest, just a different day range": `listNewsStories(db, runId, branchId, from, to)`, the one read function, used by the one route in Task 6.
- Ownership/security ("every read is gated by the existing ownsRun check"): Task 6's route uses `ownRun`, the same helper every other authenticated route uses.
- "facts stored verbatim, auditable and regeneratable": Task 3's `facts jsonb NOT NULL` column, populated straight from the event's own payload in Task 4, never touched again except by the writer filling in prose columns.
- "No browser-supplied free text ever in a prompt": Task 5's `storyPrompt` only serializes `row.facts`, which only ever came from a scored event's payload (Task 4) — never from request body text directly.
- Explicitly out of scope (unchanged, not attempted by this plan): the random event/rate engine, the fast-forward interrupt/decision-modal engine, frontend News app UI, full branch forking beyond the `branch_id` column.
