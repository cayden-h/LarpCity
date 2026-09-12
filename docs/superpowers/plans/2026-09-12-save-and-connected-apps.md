# Save, Profile, and Connected Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player's life (money, holdings, debts, orders, NPCs, inbox, desk feed) is saved to Tiger Data under their player id and restored on reload; the intake is a server profile; Stocks, News, Mail, Bank, the HUD, and standalone `/debt.html` read that one saved life.

**Architecture:** Each stateful sim class gets a `toSave()` / `fromSave()` pair; `sim/save/codec.ts` assembles them into one versioned `GameSave` JSON document.
The server stores it opaquely in a `saves` row keyed by `players.id` with an integer `rev` for optimistic concurrency, next to a `profiles` row for the intake.
A `SaveManager` in the game debounces writes after decisions, on each game month, after skips, and when the tab hides.

**Tech Stack:** TypeScript, Vite, PixiJS (game); Express, Zod, pg, TimescaleDB (server); Node's built-in test runner on both sides.

**Spec:** `docs/superpowers/specs/2026-09-12-save-and-connected-apps-design.md`.
Two refinements found while planning, applied to the spec in Task 1:
- Concurrency uses an integer `rev` instead of `updated_at` (JavaScript dates drop Postgres's microseconds, so a timestamp compare would always fail).
- Saved `history` is compacted (daily for the last 400 days, weekly before that; NPCs keep 30 daily days) so a 60-year save stays under the server's 1.5 MB cap, and the `pagehide` save is only sent with `keepalive` when it fits the browser's 64 KB keepalive limit (otherwise the last decision or month save stands).

**Working directory:** the worktree `../larp-save` (branch `save-connected-apps`). All paths below are relative to it.

**Conventions:** no enums, namespaces, or constructor parameter properties (`erasableSyntaxOnly`); game imports inside `src/sim/` use `.ts` extensions; server imports use `.js`. Commit messages have no agent co-author line.

---

## File structure

Server:
- Modify `server/src/migrations.sql`: `profiles` and `saves` tables.
- Create `server/src/store/saves.ts`: profile and save reads and writes.
- Create `server/src/store/saves.db.test.ts`: database tests.
- Create `server/src/routes/save.ts`: `GET /api/me`, `PUT /api/profile`, `PUT /api/save`, `DELETE /api/save`, plus Zod bodies.
- Create `server/src/routes/save.test.ts`: body schema tests.
- Modify `server/src/app.ts`: mount the router.
- Modify `server/src/ai/facts.ts`, `server/src/routes/ai.ts`: the player's profile in coach and news facts.

Game sim:
- Modify `game/src/sim/life/twins.ts`, `game/src/sim/money/accounts.ts`, `game/src/sim/skip/crash.ts`, `game/src/sim/life/player.ts`, `game/src/sim/npcs/index.ts`: `toSave`/`fromSave`.
- Create `game/src/sim/mail/inbox.ts`: the Mail inbox built from life events.
- Create `game/src/sim/save/types.ts`: `GameSave`, `DeskState`, and friends.
- Create `game/src/sim/save/codec.ts`: `encodeGame`, `parseSave`, `SAVE_VERSION`.
- Create `game/src/sim/save/client.ts`: the `/api/me`, profile, and save calls.
- Create `game/src/sim/save/manager.ts`: `SaveManager`.
- Modify `game/src/sim/record/index.ts`: resume an existing run.

Game UI:
- Modify `game/src/ui/intake.ts`: drop localStorage; report the answers' source.
- Modify `game/src/main.ts`: the boot flow and save wiring.
- Modify `game/src/ui/hud.ts`: name or job and the save chip.
- Modify `game/src/ui/narrator.ts`: speak a custom line (the welcome back).
- Modify `game/src/ui/phone.ts`: in-game markets, Mail, News, Bank, New life.
- Create `game/src/ui/phone-apps.ts`: the Mail, News, and Bank views' markup and loaders (keeps `phone.ts` from growing).
- Modify `game/src/debt-demo/main.ts`: report changes to the host; standalone load from the save.

Tests (game): `game/tests/save.test.ts`, `game/tests/mail.test.ts`, `game/tests/save-manager.test.ts`, additions to `game/tests/record.test.ts`.

---

## Task 1: Spec refinements and database tables

**Files:**
- Modify: `docs/superpowers/specs/2026-09-12-save-and-connected-apps-design.md`
- Modify: `server/src/migrations.sql` (append at the end)
- Create: `server/src/store/saves.db.test.ts`

- [ ] **Step 1: Update the spec**

In the spec's `saves` table, replace the `updated_at` row with two rows:

```markdown
| `rev` | int, bumped on every write |
| `updated_at` | timestamptz, informational |
```

In the API section, replace the `PUT /api/save` bullet and its sub-line with:

```markdown
- `PUT /api/save` takes `{ runId, seed, version, gameDay, state, baseRev }` and returns the new `rev`.
  `baseRev` is null for a new life's first save.
  If the stored `rev` is not `baseRev` (or a save already exists when `baseRev` is null), it returns 409 so a second tab (or, later, a second device) cannot silently overwrite progress.
  The `runId` must belong to the player.
```

Append to the "Game: save format" section:

```markdown
- Saved `history` is compacted: every day in the last 400 days, and every 7th day before that; NPC lives keep their last 30 days.
  The server caps `state` at 1.5 MB.
```

Append to the "Game: autosave" section:

```markdown
The `pagehide` save uses `keepalive` only when the body is under the browser's 64 KB keepalive limit; otherwise the last decision or month save stands.
```

- [ ] **Step 2: Write the failing database test**

Create `server/src/store/saves.db.test.ts`:

```ts
// server/src/store/saves.db.test.ts
// Profiles and saves against a real TimescaleDB (see runs.db.test.ts for the setup).
// Skipped unless TEST_DATABASE_URL is set.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { createRun } from "./runs.js";
import { deleteLife, getProfile, getSave, putProfile, putSave, SaveConflict } from "./saves.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ALICE = "aaaaaaaa-0000-4000-8000-000000000011";
const BOB = "bbbbbbbb-0000-4000-8000-000000000012";

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;

before(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  dbName = `larp_test_saves_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  db = new pg.Pool({ connectionString: u.toString() });
  for (const s of splitSql(read("../../../game/db/schema.sql"))) await db.query(s);
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
  await db.query(`INSERT INTO players (id, name) VALUES ($1, 'guest-alice2'), ($2, 'guest-bob2')`, [ALICE, BOB]);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

const answers = { job: "Nurse", salary: 72_000, rent: 1_400, debt: 9_000, savings: 3_000, state: "TX", source: "typed" as const };

test("migrations apply twice without complaint", { skip }, async () => {
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
});

test("a profile upserts and reads back", { skip }, async () => {
  assert.equal(await getProfile(db, ALICE), null);
  await putProfile(db, ALICE, answers);
  await putProfile(db, ALICE, { ...answers, salary: 80_000 });
  const p = await getProfile(db, ALICE);
  assert.equal(p?.salary, 80_000);
  assert.equal(p?.job, "Nurse");
  assert.equal(p?.source, "typed");
});

test("a skipped intake stores no numbers", { skip }, async () => {
  await putProfile(db, BOB, { job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" });
  const p = await getProfile(db, BOB);
  assert.equal(p?.source, "skipped");
  assert.equal(p?.salary, null);
  await deleteLife(db, BOB);
});

test("saves bump rev and refuse a stale base", { skip }, async () => {
  const run = await createRun(db, ALICE, 7);
  const first = await putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 10, state: { a: 1 }, baseRev: null });
  assert.equal(first, 1);
  // A second tab that also thinks this is a new life loses.
  await assert.rejects(() => putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 11, state: { a: 2 }, baseRev: null }), SaveConflict);
  const second = await putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 12, state: { a: 3 }, baseRev: 1 });
  assert.equal(second, 2);
  await assert.rejects(() => putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 13, state: { a: 4 }, baseRev: 1 }), SaveConflict);
  const s = await getSave(db, ALICE);
  assert.equal(s?.rev, 2);
  assert.equal(s?.gameDay, 12);
  assert.deepEqual(s?.state, { a: 3 });
  assert.equal(s?.runId, run);
});

test("one player never sees another's save", { skip }, async () => {
  assert.equal(await getSave(db, BOB), null);
});

test("deleteLife removes the save and profile and ends the run", { skip }, async () => {
  const s = await getSave(db, ALICE);
  await deleteLife(db, ALICE);
  assert.equal(await getSave(db, ALICE), null);
  assert.equal(await getProfile(db, ALICE), null);
  const { rows } = await db.query(`SELECT ended_at FROM runs WHERE id = $1`, [s!.runId]);
  assert.notEqual(rows[0].ended_at, null);
  // After a new life, the first save starts from a null base again.
  const run = await createRun(db, ALICE, 8);
  assert.equal(await putSave(db, ALICE, { runId: run, seed: 8, version: 1, gameDay: 0, state: {}, baseRev: null }), 1);
});
```

- [ ] **Step 3: Run it to verify it fails**

Start the local database if it isn't running (the one-line Docker command in `server/README.md`, port 5433), then:

Run: `cd server && TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' node --import tsx --env-file=.env.test --test src/store/saves.db.test.ts`
Expected: FAIL, `Cannot find module './saves.js'`.

- [ ] **Step 4: Add the tables**

Append to `server/src/migrations.sql`:

```sql

-- The player's confirmed intake (docs/superpowers/specs/2026-09-12-save-and-connected-apps-design.md).
-- Numbers are null when the player skipped to the sample household.
CREATE TABLE IF NOT EXISTS profiles (
  player_id    uuid PRIMARY KEY REFERENCES players ON DELETE CASCADE,
  display_name text,
  job          text,
  salary       numeric,
  rent         numeric,
  debt         numeric,
  savings      numeric,
  state        text NOT NULL,
  source       text NOT NULL CHECK (source IN ('voice','typed','skipped')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The player's saved game: one opaque JSON document per player and slot. `rev` guards
-- against two tabs (later, two devices) overwriting each other.
CREATE TABLE IF NOT EXISTS saves (
  player_id  uuid NOT NULL REFERENCES players ON DELETE CASCADE,
  slot       text NOT NULL DEFAULT 'main',
  run_id     uuid NOT NULL REFERENCES runs,
  seed       bigint NOT NULL,
  version    int NOT NULL,
  game_day   int NOT NULL,
  state      jsonb NOT NULL,
  rev        int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, slot)
);
```

- [ ] **Step 5: Commit (the store comes in Task 2; the test still fails until then)**

```bash
git add docs/superpowers/specs/2026-09-12-save-and-connected-apps-design.md server/src/migrations.sql server/src/store/saves.db.test.ts
git commit -m "Saves: profiles and saves tables, and the spec's rev and compaction notes"
```

---

## Task 2: The saves store

**Files:**
- Create: `server/src/store/saves.ts`
- Test: `server/src/store/saves.db.test.ts` (from Task 1)

- [ ] **Step 1: Write the store**

Create `server/src/store/saves.ts`:

```ts
// server/src/store/saves.ts
// The player's profile (the confirmed intake) and saved game in Tiger Data.
// The save's `state` is opaque here: only the game knows its shape. `rev`
// is optimistic concurrency: a write names the rev it started from, and a
// stale one is a SaveConflict (the route answers 409).
import type { Db } from "./runs.js";

export type ProfileSource = "voice" | "typed" | "skipped";

export interface Profile {
  displayName: string | null;
  job: string | null;
  salary: number | null;
  rent: number | null;
  debt: number | null;
  savings: number | null;
  state: string;
  source: ProfileSource;
}

export interface SaveRow {
  runId: string;
  seed: number;
  version: number;
  gameDay: number;
  state: unknown;
  rev: number;
  updatedAt: string;
}

export interface SaveWrite {
  runId: string;
  seed: number;
  version: number;
  gameDay: number;
  state: unknown;
  /** The rev this write started from; null for a new life's first save. */
  baseRev: number | null;
}

export class SaveConflict extends Error {}

const num = (v: string | null) => (v === null ? null : Number(v));

export async function getProfile(db: Db, playerId: string): Promise<Profile | null> {
  const { rows } = await db.query(
    `SELECT display_name, job, salary, rent, debt, savings, state, source FROM profiles WHERE player_id = $1`,
    [playerId],
  );
  const r = rows[0];
  if (!r) return null;
  return { displayName: r.display_name, job: r.job, salary: num(r.salary), rent: num(r.rent), debt: num(r.debt), savings: num(r.savings), state: r.state, source: r.source };
}

export async function putProfile(db: Db, playerId: string, p: Omit<Profile, "displayName">): Promise<void> {
  await db.query(
    `INSERT INTO profiles (player_id, job, salary, rent, debt, savings, state, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (player_id) DO UPDATE SET job = EXCLUDED.job, salary = EXCLUDED.salary, rent = EXCLUDED.rent,
       debt = EXCLUDED.debt, savings = EXCLUDED.savings, state = EXCLUDED.state, source = EXCLUDED.source, updated_at = now()`,
    [playerId, p.job, p.salary, p.rent, p.debt, p.savings, p.state, p.source],
  );
}

export async function getSave(db: Db, playerId: string): Promise<SaveRow | null> {
  const { rows } = await db.query(
    `SELECT run_id, seed, version, game_day, state, rev, updated_at FROM saves WHERE player_id = $1 AND slot = 'main'`,
    [playerId],
  );
  const r = rows[0];
  if (!r) return null;
  return { runId: r.run_id, seed: Number(r.seed), version: r.version, gameDay: r.game_day, state: r.state, rev: r.rev, updatedAt: new Date(r.updated_at).toISOString() };
}

/** Writes the save and returns its new rev; throws SaveConflict when `baseRev` is stale. */
export async function putSave(db: Db, playerId: string, w: SaveWrite): Promise<number> {
  const params = [playerId, w.runId, w.seed, w.version, w.gameDay, JSON.stringify(w.state)];
  const { rows } =
    w.baseRev === null
      ? await db.query<{ rev: number }>(
          `INSERT INTO saves (player_id, run_id, seed, version, game_day, state) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (player_id, slot) DO NOTHING RETURNING rev`,
          params,
        )
      : await db.query<{ rev: number }>(
          `UPDATE saves SET run_id = $2, seed = $3, version = $4, game_day = $5, state = $6, rev = rev + 1, updated_at = now()
           WHERE player_id = $1 AND slot = 'main' AND rev = $7 RETURNING rev`,
          [...params, w.baseRev],
        );
  if (!rows[0]) throw new SaveConflict("stale save");
  return rows[0].rev;
}

/** "New life": forgets the save and the profile and marks the saved run ended. */
export async function deleteLife(db: Db, playerId: string): Promise<void> {
  await db.query(
    `UPDATE runs SET ended_at = now() WHERE id = (SELECT run_id FROM saves WHERE player_id = $1 AND slot = 'main') AND ended_at IS NULL`,
    [playerId],
  );
  await db.query(`DELETE FROM saves WHERE player_id = $1`, [playerId]);
  await db.query(`DELETE FROM profiles WHERE player_id = $1`, [playerId]);
}
```

- [ ] **Step 2: Run the database test to verify it passes**

Run: `cd server && TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' node --import tsx --env-file=.env.test --test src/store/saves.db.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 3: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server/src/store/saves.ts
git commit -m "Saves: the profile and save store with rev conflicts"
```

---

## Task 3: The save routes

**Files:**
- Create: `server/src/routes/save.ts`
- Create: `server/src/routes/save.test.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `server/src/routes/save.test.ts`:

```ts
// server/src/routes/save.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STATE_BYTES, profileBody, saveBody } from "./save.js";

const RUN = "aaaaaaaa-0000-4000-8000-000000000001";
const save = { runId: RUN, seed: 20260912, version: 1, gameDay: 40, state: { life: {} }, baseRev: null };

test("a save body takes a JSON object state and a null or positive base rev", () => {
  assert.equal(saveBody.safeParse(save).success, true);
  assert.equal(saveBody.safeParse({ ...save, baseRev: 3 }).success, true);
  assert.equal(saveBody.safeParse({ ...save, baseRev: 0 }).success, false);
  assert.equal(saveBody.safeParse({ ...save, state: "x" }).success, false);
  assert.equal(saveBody.safeParse({ ...save, runId: "nope" }).success, false);
});

test("a save body over the size cap is refused", () => {
  const big = { blob: "x".repeat(MAX_STATE_BYTES) };
  assert.equal(saveBody.safeParse({ ...save, state: big }).success, false);
});

test("a profile needs every number unless it was skipped", () => {
  const typed = { job: "Nurse", salary: 72000, rent: 1400, debt: 0, savings: 500, state: "TX", source: "typed" };
  assert.equal(profileBody.safeParse(typed).success, true);
  assert.equal(profileBody.safeParse({ ...typed, salary: null }).success, false);
  assert.equal(profileBody.safeParse({ job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" }).success, true);
  assert.equal(profileBody.safeParse({ ...typed, state: "Texas" }).success, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && node --import tsx --env-file=.env.test --test src/routes/save.test.ts`
Expected: FAIL, `Cannot find module './save.js'`.

- [ ] **Step 3: Write the routes**

Create `server/src/routes/save.ts`:

```ts
// server/src/routes/save.ts
// The player's profile and saved game (src/store/saves.ts), keyed by the
// session's player. The game calls GET /api/me once on boot to decide
// between resuming, building a life from the profile, and the intake.
//
//   GET    /api/me        -> { player, profile, save }
//   PUT    /api/profile   the confirmed intake          -> 204
//   PUT    /api/save      { runId, seed, version, gameDay, state, baseRev } -> { rev } | 409
//   DELETE /api/save      "New life": save, profile, and the run's end -> 204
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { handle, HttpError, parse, Reply } from "../http.js";
import { deleteLife, getProfile, getSave, putProfile, putSave, SaveConflict } from "../store/saves.js";
import { ownRun } from "./snapshot.js";

export const saveRouter = Router();

/** A 60-year save is under 1 MB once history is compacted (game/src/sim/save/codec.ts). */
export const MAX_STATE_BYTES = 1_500_000;

const dollars = z.number().finite().min(0).max(10_000_000);

export const profileBody = z.discriminatedUnion("source", [
  z.object({
    source: z.enum(["voice", "typed"]),
    job: z.string().max(60),
    salary: dollars,
    rent: dollars,
    debt: dollars,
    savings: dollars,
    state: z.string().regex(/^[A-Z]{2}$/),
  }),
  z.object({
    source: z.literal("skipped"),
    job: z.null(),
    salary: z.null(),
    rent: z.null(),
    debt: z.null(),
    savings: z.null(),
    state: z.string().regex(/^[A-Z]{2}$/),
  }),
]);

export const saveBody = z.object({
  runId: z.string().uuid(),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  version: z.number().int().min(1).max(1000),
  gameDay: z.number().int().min(0).max(100_000),
  state: z.record(z.unknown()).refine((s) => JSON.stringify(s).length <= MAX_STATE_BYTES, "save too large"),
  baseRev: z.number().int().min(1).nullable(),
});

saveRouter.get(
  "/me",
  handle(async (req) => {
    const { rows } = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM players WHERE id = $1`, [req.playerId]);
    const [profile, save] = await Promise.all([getProfile(pool, req.playerId), getSave(pool, req.playerId)]);
    return { player: rows[0] ?? { id: req.playerId, name: null }, profile, save };
  }),
);

saveRouter.put(
  "/profile",
  handle(async (req) => {
    await putProfile(pool, req.playerId, parse(profileBody, req.body));
    return new Reply(204, null);
  }),
);

saveRouter.put(
  "/save",
  handle(async (req) => {
    const body = parse(saveBody, req.body);
    const runId = await ownRun(req, body.runId);
    try {
      return { rev: await putSave(pool, req.playerId, { ...body, runId }) };
    } catch (err) {
      if (err instanceof SaveConflict) throw new HttpError(409, "save_conflict");
      throw err;
    }
  }),
);

saveRouter.delete(
  "/save",
  handle(async (req) => {
    await deleteLife(pool, req.playerId);
    return new Reply(204, null);
  }),
);
```

`Reply(204, null)` makes Express send `null` as JSON with a 204, which Express strips; the game's `apiFetch` already returns `undefined` for 204.

- [ ] **Step 4: Mount it**

In `server/src/app.ts`, add the import after the `snapshotRouter` import:

```ts
import { saveRouter } from "./routes/save.js";
```

and mount it after `app.use("/api", snapshotRouter);`:

```ts
  app.use("/api", saveRouter);
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd server && node --import tsx --env-file=.env.test --test src/routes/save.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, 3 tests; no tsc output.

- [ ] **Step 6: Run the whole server suite with the database**

Run: `cd server && TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/save.ts server/src/routes/save.test.ts server/src/app.ts
git commit -m "Saves: GET /api/me, PUT /api/profile, PUT and DELETE /api/save"
```

---

## Task 4: The profile in the coach's and the newspaper's facts

The prompts already embed the whole facts object as JSON (`coachPrompt`, `newsPrompt` in `server/src/ai/coach.ts`), so adding a `player` field to the facts is enough; it comes from the database, never from the browser.

**Files:**
- Modify: `server/src/ai/facts.ts`
- Modify: `server/src/routes/ai.ts:70` and the `/news` handler
- Create: `server/src/ai/player-facts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/ai/player-facts.test.ts`:

```ts
// server/src/ai/player-facts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { newsPrompt } from "./coach.js";
import { newsFacts, playerFacts } from "./facts.js";

test("playerFacts keeps only the job and state, and nothing for a skipped intake", () => {
  assert.deepEqual(
    playerFacts({ displayName: null, job: "Nurse", salary: 72000, rent: 1400, debt: 0, savings: 500, state: "TX", source: "typed" }),
    { job: "Nurse", state: "TX" },
  );
  assert.deepEqual(playerFacts({ displayName: null, job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" }), { job: null, state: "CA" });
  assert.equal(playerFacts(null), undefined);
});

test("the newspaper prompt carries the player's job", () => {
  const f = { ...newsFacts(0, 30, [], []), player: { job: "Nurse", state: "TX" } };
  assert.match(newsPrompt(f), /"job":"Nurse"/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && node --import tsx --env-file=.env.test --test src/ai/player-facts.test.ts`
Expected: FAIL, `playerFacts` is not exported.

- [ ] **Step 3: Add the facts**

In `server/src/ai/facts.ts`, change the import line to:

```ts
import type { EventRow, SnapshotRow } from "../store/runs.js";
import type { Profile } from "../store/saves.js";
```

Add after the `gameDate` function:

```ts
/** Who the player is, from their stored profile: the job they gave the owl and their state. Never salary or balances; the snapshots carry the money. */
export interface PlayerFacts {
  job: string | null;
  state: string;
}

export function playerFacts(p: Profile | null): PlayerFacts | undefined {
  return p ? { job: p.job, state: p.state } : undefined;
}
```

Add `player?: PlayerFacts;` as the last field of both `FeedbackFacts` and `NewsFacts`, each with the comment `/** The player's stored profile, when they have one. */`.

- [ ] **Step 4: Fill it in the routes**

In `server/src/routes/ai.ts`, change the facts import to:

```ts
import { crashAndRecovery, feedbackFacts, newsFacts, playerFacts } from "../ai/facts.js";
```

add:

```ts
import { getProfile } from "../store/saves.js";
```

Replace line 70:

```ts
      const facts = feedbackFacts(b.trigger, b.day, snaps, events, b.goal, recoveryEvents);
```

with:

```ts
      const facts = { ...feedbackFacts(b.trigger, b.day, snaps, events, b.goal, recoveryEvents), player: playerFacts(await getProfile(pool, req.playerId)) };
```

In the `/news` handler, replace:

```ts
      const facts = newsFacts(b.from, b.to, snaps, events);
```

with:

```ts
      const facts = { ...newsFacts(b.from, b.to, snaps, events), player: playerFacts(await getProfile(pool, req.playerId)) };
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd server && node --import tsx --env-file=.env.test --test src/ai/player-facts.test.ts && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: PASS; no tsc output; the full suite passes.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/facts.ts server/src/ai/player-facts.test.ts server/src/routes/ai.ts
git commit -m "Coach and newspaper: the player's job and state from their stored profile"
```

---

## Task 5: Save and restore for Twins, Ledger, and the crash watch

**Files:**
- Modify: `game/src/sim/life/twins.ts`
- Modify: `game/src/sim/money/accounts.ts` (class `Ledger`, line 143)
- Modify: `game/src/sim/skip/crash.ts`
- Create: `game/tests/save.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `game/tests/save.test.ts`:

```ts
// Save and restore: every stateful sim piece encodes to plain JSON and comes
// back identical, and a restored life plays on exactly like one never saved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Twins } from "../src/sim/life/twins.ts";
import { Ledger } from "../src/sim/money/accounts.ts";
import { CrashWatch } from "../src/sim/skip/crash.ts";
import { MarketPath } from "../src/sim/market/index.ts";

const START = new Date(2026, 8, 11);
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test("twins round-trip through JSON", () => {
  const market = new MarketPath(3, START);
  const t = new Twins(market);
  t.seedHolding("LTM", 10, 0);
  t.buy("NNST", 500, 20);
  t.sell(120);
  t.buy("LTM", 300, 60);
  const back = Twins.fromSave(json(t.toSave()), market);
  assert.deepEqual(back.toSave(), t.toSave());
  assert.equal(back.held(400), t.held(400));
  assert.equal(back.autopilot(400), t.autopilot(400));
});

test("a ledger round-trips with a pending transfer and keeps numbering transfers", () => {
  const l = new Ledger([
    { id: "checking", kind: "checking", name: "Checking", balance: 1000, apy: 0, openedDay: 0 },
    { id: "savings", kind: "savings", name: "Savings", balance: 0, apy: 0.04, openedDay: 0 },
  ]);
  const ctx = { day: 5, date: new Date(2026, 8, 16), age: 27 };
  l.transfer("checking", "savings", 100, "ach", ctx);
  const back = Ledger.fromSave(json(l.toSave()));
  assert.deepEqual(back.toSave(), l.toSave());
  const a = l.transfer("checking", "savings", 50, "internal", ctx);
  const b = back.transfer("checking", "savings", 50, "internal", ctx);
  assert.equal(b.id, a.id);
  assert.deepEqual(back.toSave(), l.toSave());
});

test("the crash watch keeps its private recovery count", () => {
  const c = new CrashWatch();
  c.update(100, "sell_all");
  c.update(70, "sell_all"); // sells
  c.update(101, "sell_all"); // recovered, month 0
  const back = CrashWatch.fromSave(json(c.toSave()));
  assert.deepEqual(back.toSave(), c.toSave());
  assert.equal(back.update(102, "sell_all"), c.update(102, "sell_all"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/save.test.ts`
Expected: FAIL, `Twins.fromSave is not a function` (and the others).

- [ ] **Step 3: Twins**

In `game/src/sim/life/twins.ts`, add after `type Units = ...`:

```ts
/** Twins as plain JSON, for the saved game (sim/save). */
export interface TwinsSave {
  invested: number;
  cashOut: number;
  heldUnits: Units;
  autoUnits: Units;
}
```

and add these methods inside the class, after the constructor:

```ts
  toSave(): TwinsSave {
    return { invested: this.invested, cashOut: this.cashOut, heldUnits: { ...this.heldUnits }, autoUnits: { ...this.autoUnits } };
  }

  static fromSave(s: TwinsSave, market: MarketPath): Twins {
    const t = new Twins(market);
    t.invested = s.invested;
    t.cashOut = s.cashOut;
    Object.assign(t.heldUnits, s.heldUnits);
    Object.assign(t.autoUnits, s.autoUnits);
    return t;
  }
```

- [ ] **Step 4: Ledger**

In `game/src/sim/money/accounts.ts`, add before `export class Ledger`:

```ts
/** A ledger as plain JSON, for the saved game (sim/save). */
export interface LedgerSave {
  accounts: Account[];
  pending: Transfer[];
  history: Transfer[];
  seq: number;
}
```

and add inside the class, after the constructor:

```ts
  toSave(): LedgerSave {
    return structuredClone({ accounts: [...this.accounts.values()], pending: this.pending, history: this.history, seq: this.seq });
  }

  static fromSave(s: LedgerSave): Ledger {
    const copy = structuredClone(s);
    const l = new Ledger(copy.accounts);
    l.pending = copy.pending;
    l.history = copy.history;
    l.seq = copy.seq;
    return l;
  }
```

(`Account` and `Transfer` are already imported in this file; if `Transfer` is only imported as a value, make sure the import is `type`.)

- [ ] **Step 5: CrashWatch**

In `game/src/sim/skip/crash.ts`, add before the class:

```ts
/** The crash rule's memory as plain JSON, for the saved game (sim/save). */
export interface CrashSave {
  peak: number;
  crashPeak: number | null;
  recoveredFor: number;
}
```

and inside the class, after the `recoveredFor` field:

```ts
  toSave(): CrashSave {
    return { peak: this.peak, crashPeak: this.crashPeak, recoveredFor: this.recoveredFor };
  }

  static fromSave(s: CrashSave): CrashWatch {
    const c = new CrashWatch();
    c.peak = s.peak;
    c.crashPeak = s.crashPeak;
    c.recoveredFor = s.recoveredFor;
    return c;
  }
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `cd game && node --test tests/save.test.ts && npx tsc --noEmit`
Expected: PASS, 3 tests; no tsc output.

- [ ] **Step 7: Commit**

```bash
git add game/src/sim/life/twins.ts game/src/sim/money/accounts.ts game/src/sim/skip/crash.ts game/tests/save.test.ts
git commit -m "Saves: Twins, Ledger, and the crash watch encode to JSON and back"
```

---

## Task 6: Save and restore for PlayerLife, with the determinism test

This is the safety net for the whole feature: a life saved and restored on any day must play on identically to one that was never saved.

**Files:**
- Modify: `game/src/sim/life/player.ts`
- Test: `game/tests/save.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `game/tests/save.test.ts`:

```ts
import { PlayerLife, STARTER_PORTFOLIO, compactHistory, type LifeEvent, type Place } from "../src/sim/life/index.ts";
import { lifeFromIntake } from "../src/sim/life/intake.ts";
import { applyOrders } from "../src/sim/skip/orders.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};

/** The player's choices, on fixed days, the same for the saved and the unsaved life. */
function decide(life: PlayerLife, day: number): void {
  if (day === 20) life.buy("LTM", 300, day);
  if (day === 45)
    applyOrders(life, { depositMonthly: 400, k401Pct: 0.06, stockPct: 0.9, debtStrategy: "avalanche", extraMonthly: 100, emergencyMonths: 3, lifestyle: "normal", crashRule: "sell_half" });
  if (day === 200) life.sell("NNST", "all", day);
  if (day === 260) {
    const ctx = { day, date: dateOf(day), age: life.age };
    if (life.ledger.quote("savings", "checking", 200, "internal", ctx).ok) life.ledger.transfer("savings", "checking", 200, "internal", ctx);
  }
  if (day === 300) life.setEmployed(false, day);
  if (day === 420) life.setEmployed(true, day);
  if (day === 500) life.setPlace(CA, day);
  if (day === 600) life.book.extraMonthly = 200;
}

function play(life: PlayerLife, from: number, to: number): LifeEvent[] {
  const all: LifeEvent[] = [];
  life.onEvents((events) => all.push(...events));
  for (let day = from + 1; day <= to; day++) {
    life.onDay(day, dateOf(day));
    decide(life, day);
  }
  return all;
}

const LIVES: [string, (market: MarketPath) => PlayerLife][] = [
  ["sample household", (market) => new PlayerLife({ place: TX, day: 0, market, holdings: STARTER_PORTFOLIO })],
  [
    "intake life",
    (market) =>
      lifeFromIntake({ job: "Nurse", salary: 72_000, rent: 1_400, debt: 15_000, savings: 3_000 }, { place: TX, day: 0, market, holdings: STARTER_PORTFOLIO }),
  ],
];
const END = 900;

for (const seed of [5, 20260912]) {
  for (const [name, make] of LIVES) {
    for (const saveDay of [1, 44, 301, 777]) {
      test(`${name}, seed ${seed}, saved on day ${saveDay}, plays on exactly like one never saved`, () => {
        const control = make(new MarketPath(seed, START));
        const controlEvents = play(control, 0, END).filter((e) => e.day > saveDay);

        const before = make(new MarketPath(seed, START));
        play(before, 0, saveDay);
        const restored = PlayerLife.fromSave(json(before.toSave()), { market: new MarketPath(seed, START) });
        const restoredEvents = play(restored, saveDay, END);

        assert.deepEqual(restoredEvents, controlEvents);
        assert.deepEqual(restored.toSave(), control.toSave());
        assert.equal(restored.netWorth(), control.netWorth());
      });
    }
  }
}

test("saved history is daily for the recent past and weekly before it", () => {
  const snaps = Array.from({ length: 1000 }, (_, day) => ({ day }) as never);
  const kept = compactHistory(snaps, 999, 400).map((s: { day: number }) => s.day);
  assert.ok(kept.includes(600) && kept.includes(999));
  assert.ok(kept.includes(0) && kept.includes(7) && !kept.includes(8));
  assert.equal(kept.length, 400 + Math.floor(599 / 7) + 1);
});

test("a restored life keeps its home state's rent after a move", () => {
  const life = new PlayerLife({ place: TX, day: 0, rent: 1_000 });
  life.setPlace(CA, 3);
  const back = PlayerLife.fromSave(json(life.toSave()), { market: new MarketPath() });
  assert.equal(back.rent, life.rent);
  assert.equal(back.place.abbr, "CA");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/save.test.ts`
Expected: FAIL, `compactHistory` is not exported / `PlayerLife.fromSave is not a function`.

- [ ] **Step 3: Add the save type and compaction**

In `game/src/sim/life/player.ts`, change the imports to add the save types:

```ts
import { Ledger, type LedgerSave } from "../money/accounts.ts";
import { CrashWatch, PANIC_DRAWDOWN, type CrashSave } from "../skip/crash.ts";
import { Twins, type TwinsSave } from "./twins.ts";
```

Add after the `TradeResult` type:

```ts
/** A life as plain JSON, for the saved game (sim/save). Listeners are not saved: whoever restores the life re-attaches them. */
export interface LifeSave {
  place: Place;
  employed: boolean;
  age: number;
  monthlyTakeHome: number;
  grossAnnual: number;
  job: string;
  orders: StandingOrders | null;
  recurring: RecurringBuy[];
  today: number;
  history: LifeSnapshot[];
  book: DebtBook;
  ledger: LedgerSave;
  twins: TwinsSave;
  startDay: number;
  startAge: number;
  rentAnchor: { amount: number; housing: number } | null;
  crash: CrashSave;
  crashCash: number;
  lastFirst: { stock: number; bond: number } | null;
  k401Year: number;
  k401Ytd: number;
  ltmPeak: number;
  inBear: boolean;
  startUnits: [InstrumentId, number][];
  startSnap: LifeSnapshot;
}

/** Days of daily history a saved player life keeps; older days keep every 7th. */
export const SAVE_DAILY_DAYS = 400;

/** History for a save: every day in the last `keepDaily` days before `today`, and every 7th day before that. */
export function compactHistory(history: LifeSnapshot[], today: number, keepDaily: number): LifeSnapshot[] {
  return history.filter((s) => s.day > today - keepDaily || s.day % 7 === 0);
}
```

- [ ] **Step 4: Restore in the constructor**

Change the crash field from:

```ts
  private readonly crash = new CrashWatch();
```

to:

```ts
  private readonly crash: CrashWatch;
```

Replace the constructor's first line `constructor(o: LifeOptions) {` and the lines up to (not including) `this.place = o.place;` with a branch that restores from a save, so the whole constructor reads:

```ts
  constructor(o: LifeOptions, saved?: LifeSave) {
    this.market = o.market ?? new MarketPath();
    this.cashRate = o.cashRate ?? cashRateOn;
    if (saved) {
      const s = structuredClone(saved);
      this.place = s.place;
      this.startDay = s.startDay;
      this.startAge = s.startAge;
      this.age = s.age;
      this.today = s.today;
      this.book = s.book;
      this.monthlyTakeHome = s.monthlyTakeHome;
      this.grossAnnual = s.grossAnnual;
      this.job = s.job;
      this.employed = s.employed;
      this.rentAnchor = s.rentAnchor;
      this.orders = s.orders;
      this.recurring = s.recurring;
      this.ledger = Ledger.fromSave(s.ledger);
      this.twins = Twins.fromSave(s.twins, this.market);
      this.crash = CrashWatch.fromSave(s.crash);
      this.crashCash = s.crashCash;
      this.lastFirst = s.lastFirst;
      this.k401Year = s.k401Year;
      this.k401Ytd = s.k401Ytd;
      this.ltmPeak = s.ltmPeak;
      this.inBear = s.inBear;
      this.startUnits.push(...s.startUnits);
      this.history.push(...s.history);
      this.startSnap = s.startSnap;
      return;
    }
    this.crash = new CrashWatch();
    this.place = o.place;
    this.startDay = o.day;
    this.startAge = o.age ?? 27;
    this.age = this.startAge;
    this.today = o.day;
    this.book = o.book ?? sampleHousehold(o.day, "avalanche", 300);
    this.monthlyTakeHome = o.monthlyTakeHome ?? this.book.monthlyTakeHome;
    this.grossAnnual = o.grossAnnual ?? Math.round((this.monthlyTakeHome * 12) / TAKE_HOME_SHARE);
    this.job = o.job ?? "";
    this.rentAnchor = o.rent === undefined ? null : { amount: o.rent, housing: o.place.rpp.housing };
    // The engine's bankruptcy test compares minimums with the book's take-home, so keep them in sync.
    this.book.monthlyTakeHome = this.monthlyTakeHome;
    this.ledger = new Ledger(o.accounts ?? defaultAccounts(o.day));
    this.ltmPeak = this.market.price("LTM", o.day);
    this.twins = new Twins(this.market);
    if (o.holdings) this.seedHoldings(o.holdings, o.day);
    this.startSnap = this.snapshot(o.day);
    this.record(o.day);
  }

  /** The life from a save, on `market` (rebuilt from the save's seed; it isn't stored). */
  static fromSave(s: LifeSave, o: { market: MarketPath; cashRate?: (date: Date) => number }): PlayerLife {
    return new PlayerLife({ place: s.place, day: s.startDay, market: o.market, cashRate: o.cashRate }, s);
  }

  /** Everything needed to carry on from today, as plain JSON; history keeps `keepDaily` days daily and weekly before. */
  toSave(keepDaily = SAVE_DAILY_DAYS): LifeSave {
    return structuredClone({
      place: { abbr: this.place.abbr, name: this.place.name, rpp: this.place.rpp },
      employed: this.employed,
      age: this.age,
      monthlyTakeHome: this.monthlyTakeHome,
      grossAnnual: this.grossAnnual,
      job: this.job,
      orders: this.orders,
      recurring: this.recurring,
      today: this.today,
      history: compactHistory(this.history, this.today, keepDaily),
      book: this.book,
      ledger: this.ledger.toSave(),
      twins: this.twins.toSave(),
      startDay: this.startDay,
      startAge: this.startAge,
      rentAnchor: this.rentAnchor,
      crash: this.crash.toSave(),
      crashCash: this.crashCash,
      lastFirst: this.lastFirst,
      k401Year: this.k401Year,
      k401Ytd: this.k401Ytd,
      ltmPeak: this.ltmPeak,
      inBear: this.inBear,
      startUnits: this.startUnits,
      startSnap: this.startSnap,
    });
  }
```

The old constructor lines that set `this.market`, `this.cashRate` move to the top as shown; every other line is unchanged, only reordered so `market` exists before `ltmPeak`.

- [ ] **Step 5: Export the new names**

Check `game/src/sim/life/index.ts`; if it re-exports `player.ts` with `export *`, nothing to do. Otherwise add `compactHistory`, `SAVE_DAILY_DAYS`, and `type LifeSave` to its export list.

- [ ] **Step 6: Run the tests and typecheck**

Run: `cd game && node --test tests/save.test.ts && npx tsc --noEmit`
Expected: PASS, 21 tests; no tsc output.
If a determinism case fails, the diff names the field the save missed: add it to `LifeSave`, `toSave`, and the restore branch, never loosen the test.

- [ ] **Step 7: Run the whole game suite**

Run: `cd game && npm test`
Expected: all pass (the constructor reorder must not change any existing behavior).

- [ ] **Step 8: Commit**

```bash
git add game/src/sim/life/player.ts game/src/sim/life/index.ts game/tests/save.test.ts
git commit -m "Saves: PlayerLife encodes to JSON and a restored life plays on identically"
```

---

## Task 7: Save and restore for the NPC town

**Files:**
- Modify: `game/src/sim/npcs/index.ts`
- Test: `game/tests/save.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `game/tests/save.test.ts`:

```ts
import { NpcTown } from "../src/sim/npcs/index.ts";

test("the NPC town restores and keeps living like one never saved", () => {
  const make = (saved?: ReturnType<NpcTown["toSave"]>) => new NpcTown({ place: TX, day: 0, market: new MarketPath(9, START), start: START, saved });
  const control = make();
  for (let d = 1; d <= 120; d++) control.onDay(d);
  const before = make();
  for (let d = 1; d <= 60; d++) before.onDay(d);
  const restored = make(json(before.toSave()));
  for (let d = 61; d <= 120; d++) restored.onDay(d);
  assert.deepEqual(restored.toSave(), control.toSave());
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/save.test.ts --test-name-pattern="NPC town"`
Expected: FAIL, `before.toSave is not a function`.

- [ ] **Step 3: Implement**

In `game/src/sim/npcs/index.ts`, change the player import to:

```ts
import { defaultAccounts, PlayerLife, TAKE_HOME_SHARE, type LifeSave, type Place } from "../life/player.ts";
```

Add before the class:

```ts
/** Days of daily history a saved NPC keeps; nothing reads further back. */
export const NPC_SAVE_DAYS = 30;
```

Change the constructor signature and loop to:

```ts
  constructor(o: { place: Place; day: number; market: MarketPath; start: Date; roster?: NpcProfile[]; saved?: Record<string, LifeSave> }) {
    this.start = o.start;
    for (const p of o.roster ?? NPCS) {
      this.profiles.set(p.id, p);
      const saved = o.saved?.[p.id];
      // A roster entry added since the save starts fresh; one removed since is dropped.
      this.lives.set(p.id, saved ? PlayerLife.fromSave(saved, { market: o.market }) : npcLife(p, o));
    }
  }

  /** Every NPC's life as plain JSON, for the saved game. */
  toSave(): Record<string, LifeSave> {
    return Object.fromEntries([...this.lives].map(([id, life]) => [id, life.toSave(NPC_SAVE_DAYS)]));
  }
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd game && node --test tests/save.test.ts && npx tsc --noEmit`
Expected: PASS; no tsc output.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/npcs/index.ts game/tests/save.test.ts
git commit -m "Saves: the NPC town encodes to JSON and restores"
```

---

## Task 8: The Mail inbox

A pure module: life events in, mail items out. The phone's Mail app (Task 15) draws it; the save carries it.

**Files:**
- Create: `game/src/sim/mail/inbox.ts`
- Create: `game/tests/mail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `game/tests/mail.test.ts`:

```ts
// Mail inbox tests: which life events become mail, unread counts, and the cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Inbox, MAX_MAIL, mailFor } from "../src/sim/mail/inbox.ts";
import type { LifeEvent } from "../src/sim/life/index.ts";

const names = (id: string) => (id === "card" ? "Credit card" : "Personal loan");

test("routine days send no mail, money trouble and wins do", () => {
  assert.equal(mailFor({ type: "payment", day: 3, debtId: "card", amount: 50, interest: 4 }, names), null);
  assert.equal(mailFor({ type: "bill", day: 1, name: "Rent", amount: 1200, paid: 1200 }, names), null);
  const short = mailFor({ type: "bill", day: 1, name: "Rent", amount: 1200, paid: 900 }, names);
  assert.equal(short?.tone, "bad");
  assert.match(short!.subject, /Rent/);
  const late = mailFor({ type: "late_mark", day: 40, debtId: "card", severity: 30, scoreBefore: 700, scoreAfter: 640 }, names);
  assert.match(late!.body, /Credit card/);
  assert.match(late!.body, /640/);
  assert.equal(mailFor({ type: "paid_off", day: 90, debtId: "loan", name: "Personal loan" }, names)?.tone, "good");
  assert.equal(mailFor({ type: "cannot_cover", day: 9, debtId: "card", due: 80, available: 10 }, names)?.decision, true);
  assert.equal(mailFor({ type: "score_change", day: 9, from: 700, to: 704 }, names), null);
  assert.ok(mailFor({ type: "score_change", day: 9, from: 700, to: 720 }, names));
});

test("the inbox counts unread mail, marks it read, and keeps the newest", () => {
  const inbox = new Inbox();
  const events: LifeEvent[] = [
    { type: "paycheck", day: 1, takeHome: 2000, garnished: 0, unemployed: false },
    { type: "job", day: 2, employed: false },
  ];
  inbox.add(events, names);
  assert.equal(inbox.unread(), 2);
  assert.equal(inbox.items[0].day, 2, "newest first");
  inbox.markRead(inbox.items[0].id);
  assert.equal(inbox.unread(), 1);
  for (let d = 3; d < 3 + MAX_MAIL + 10; d++) inbox.add([{ type: "job", day: d, employed: d % 2 === 0 }], names);
  assert.equal(inbox.items.length, MAX_MAIL);
});

test("the inbox round-trips through JSON", () => {
  const inbox = new Inbox();
  inbox.add([{ type: "job", day: 2, employed: false }], names);
  const back = new Inbox(JSON.parse(JSON.stringify(inbox.toSave())));
  assert.deepEqual(back.toSave(), inbox.toSave());
  back.add([{ type: "job", day: 3, employed: true }], names);
  assert.notEqual(back.items[0].id, back.items[1].id);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/mail.test.ts`
Expected: FAIL, cannot find `../src/sim/mail/inbox.ts`.

- [ ] **Step 3: Implement**

Create `game/src/sim/mail/inbox.ts`:

```ts
// The phone's Mail app: letters from the bank, the landlord, the credit
// bureau, and the market, built from the life's events. Routine days
// (a bill paid in full, a normal card payment) send nothing, so the inbox
// reads like the moments that matter. Decision mail (a payment the player
// can't cover, bankruptcy, a crash) opens the Money desk on that decision.
// The inbox is part of the saved game.

import type { LifeEvent } from "../life/player.ts";

export type MailTone = "good" | "bad" | "info";

export interface MailItem {
  id: string;
  day: number;
  from: string;
  subject: string;
  body: string;
  tone: MailTone;
  /** Opening it opens the Money desk. */
  decision: boolean;
  read: boolean;
}

export interface InboxSave {
  items: MailItem[];
  seq: number;
}

/** The inbox keeps this many letters, newest first. */
export const MAX_MAIL = 200;
/** A score move smaller than this isn't worth a letter. */
const SCORE_MAIL_STEP = 10;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type Letter = Omit<MailItem, "id" | "read" | "day" | "decision"> & { decision?: boolean };

/** The letter an event sends, or null for a routine one. `debtName` names a debt by id. */
export function mailFor(e: LifeEvent, debtName: (id: string) => string): (Letter & { decision: boolean }) | null {
  const l = letter(e, debtName);
  return l ? { ...l, decision: l.decision ?? false } : null;
}

function letter(e: LifeEvent, debtName: (id: string) => string): Letter | null {
  switch (e.type) {
    case "paycheck":
      return { from: "Payroll", subject: e.unemployed ? "Unemployment benefits paid" : "Your pay stub", body: `${usd(e.takeHome)} landed in checking${e.garnished ? `, after ${usd(e.garnished)} was garnished` : ""}${e.retirement ? `. ${usd(e.retirement)} went to your 401(k)` : ""}.`, tone: "info" };
    case "bill":
      if (e.amount - e.paid < 0.5) return null;
      return { from: e.name === "Rent" ? "Your landlord" : "Utilities", subject: `${e.name} came up short`, body: `${e.name} was ${usd(e.amount)} and only ${usd(e.paid)} could be paid. Short by ${usd(e.amount - e.paid)}.`, tone: "bad" };
    case "missed":
      return { from: debtName(e.debtId), subject: "Payment missed", body: `The ${usd(e.due)} payment on your ${debtName(e.debtId)} was missed${e.fee ? `, with a ${usd(e.fee)} late fee` : ""}.`, tone: "bad" };
    case "late_mark":
      return { from: "Credit bureau", subject: `Reported ${e.severity} days late`, body: `Your ${debtName(e.debtId)} was reported ${e.severity} days late. Your score went from ${e.scoreBefore} to ${e.scoreAfter}.`, tone: "bad" };
    case "penalty_apr":
      return { from: debtName(e.debtId), subject: "Penalty rate applied", body: `Your ${debtName(e.debtId)} now charges ${(e.apr * 100).toFixed(2)}% after late payments.`, tone: "bad" };
    case "collections":
      return { from: "Collections agency", subject: "Your account was sold", body: `Your ${debtName(e.debtId)} (${usd(e.balance)}) was sold to a debt collector.`, tone: "bad" };
    case "repossessed":
      return { from: debtName(e.debtId), subject: "Vehicle repossessed", body: `Your car was repossessed. ${usd(e.deficiency)} is still owed after the sale.`, tone: "bad" };
    case "default":
      return { from: debtName(e.debtId), subject: "Loan in default", body: `Your ${debtName(e.debtId)} defaulted. 15% of each paycheck will be garnished.`, tone: "bad" };
    case "paid_off":
      return { from: e.name, subject: "Paid in full!", body: `${e.name} is paid off. Its payment now goes to your next debt.`, tone: "good" };
    case "score_change":
      if (Math.abs(e.to - e.from) < SCORE_MAIL_STEP) return null;
      return { from: "Credit bureau", subject: `Score ${e.to > e.from ? "up" : "down"} to ${e.to}`, body: `Your credit score moved from ${e.from} to ${e.to}.`, tone: e.to > e.from ? "good" : "bad" };
    case "cannot_cover":
      return { from: debtName(e.debtId), subject: "You can't cover this payment", body: `${usd(e.due)} is due and only ${usd(e.available)} is available. Open Money to decide what to do.`, tone: "bad", decision: true };
    case "bankruptcy_eligible":
      return { from: "Bankruptcy court", subject: "You may qualify for bankruptcy", body: `${e.reason} Open Money to decide.`, tone: "bad", decision: true };
    case "bear_market":
      return { from: "Larp Markets", subject: `Stocks are down ${Math.round(e.drop * 100)}%`, body: `Your ${usd(e.stocks)} in stocks is in a bear market. Open Money to decide whether to hold.`, tone: "bad", decision: true };
    case "market_recovered":
      return { from: "Larp Markets", subject: "Stocks are back at their high", body: `Your investing line is at ${usd(e.you)}; holding would be ${usd(e.held)}, autopilot ${usd(e.autopilot)}.`, tone: "good" };
    case "moved":
      return { from: "Your new landlord", subject: `Welcome to ${e.to}`, body: `Rent here is ${usd(e.rent)} a month and living costs are ${usd(e.living)}.`, tone: "info" };
    case "job":
      return e.employed
        ? { from: "HR", subject: "Welcome back", body: "Full paychecks resume on the next payday.", tone: "good" }
        : { from: "HR", subject: "You've been laid off", body: "Unemployment pays about 40% of your take-home until you're back at work.", tone: "bad" };
    default:
      return null;
  }
}

export class Inbox {
  items: MailItem[];
  private seq: number;

  constructor(saved?: InboxSave) {
    this.items = saved ? structuredClone(saved.items) : [];
    this.seq = saved?.seq ?? 0;
  }

  /** Files a letter for every event that sends one; returns the new letters. */
  add(events: LifeEvent[], debtName: (id: string) => string): MailItem[] {
    const added: MailItem[] = [];
    for (const e of events) {
      const l = mailFor(e, debtName);
      if (l) added.push({ ...l, id: `m${++this.seq}`, day: e.day, read: false });
    }
    if (!added.length) return added;
    this.items.unshift(...added.reverse());
    if (this.items.length > MAX_MAIL) this.items.length = MAX_MAIL;
    return added;
  }

  unread(): number {
    return this.items.reduce((n, m) => n + (m.read ? 0 : 1), 0);
  }

  markRead(id: string): void {
    const m = this.items.find((x) => x.id === id);
    if (m) m.read = true;
  }

  toSave(): InboxSave {
    return structuredClone({ items: this.items, seq: this.seq });
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd game && node --test tests/mail.test.ts && npx tsc --noEmit`
Expected: PASS, 3 tests; no tsc output.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/mail/inbox.ts game/tests/mail.test.ts
git commit -m "Mail: an inbox of the life's moments that matter"
```

---

## Task 9: The saved game's format

**Files:**
- Create: `game/src/sim/save/types.ts`
- Create: `game/src/sim/save/codec.ts`
- Test: `game/tests/save.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `game/tests/save.test.ts`:

```ts
import { encodeGame, parseSave, SAVE_VERSION, SaveFormatError } from "../src/sim/save/codec.ts";
import { Inbox } from "../src/sim/mail/inbox.ts";

test("a whole game encodes, survives JSON, and parses back", () => {
  const market = new MarketPath(11, START);
  const life = new PlayerLife({ place: TX, day: 0, market, holdings: STARTER_PORTFOLIO });
  const town = new NpcTown({ place: TX, day: 0, market, start: START });
  const mail = new Inbox();
  const save = encodeGame({ seed: 11, day: 0, hash: "TX", bankRun: "11-abc", life, town, mail, desk: null });
  assert.equal(save.version, SAVE_VERSION);
  const back = parseSave(json(save));
  assert.deepEqual(back, save);
});

test("a save from an unknown version or with no life is refused, not half-loaded", () => {
  assert.throws(() => parseSave({ version: SAVE_VERSION + 1, seed: 1, day: 0, life: {} }), SaveFormatError);
  assert.throws(() => parseSave({ version: SAVE_VERSION, seed: 1, day: 0 }), SaveFormatError);
  assert.throws(() => parseSave("nope"), SaveFormatError);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/save.test.ts --test-name-pattern="whole game|unknown version"`
Expected: FAIL, cannot find `codec.ts`.

- [ ] **Step 3: The types**

Create `game/src/sim/save/types.ts`:

```ts
// The saved game's shape (docs/superpowers/specs/2026-09-12-save-and-connected-apps-design.md).
// The server stores it as an opaque JSON document; only the game reads it.

import type { LifeSave } from "../life/player.ts";
import type { InboxSave } from "../mail/inbox.ts";

export type DeskTone = "up" | "down" | "flat";

/** One line of the Money desk's activity feed. */
export interface DeskFeedItem {
  day: number;
  text: string;
  amount?: number;
  tone: DeskTone;
}

/** One line on the Money desk's Cash tab statement. */
export interface DeskBankTxn {
  day: number;
  name: string;
  category: string;
  icon: string;
  amount: number;
  kind: "in" | "out" | "move";
}

/** What the Money desk remembers between visits. */
export interface DeskState {
  feed: DeskFeedItem[];
  bank: DeskBankTxn[];
  crash: { day: number; drop: number; choice: string } | null;
  recovery: { day: number; you: number; held: number; autopilot: number } | null;
}

export interface GameSave {
  version: number;
  seed: number;
  /** The clock's game day. */
  day: number;
  /** Where the player is: a state (TX) or a specialized city (dallas), as in the URL hash. */
  hash: string;
  /** The Nessie mirror's run id, so a resumed game keeps the same bank accounts. */
  bankRun: string;
  life: LifeSave;
  npcs: Record<string, LifeSave>;
  mail: InboxSave;
  desk: DeskState | null;
}
```

- [ ] **Step 4: The codec**

Create `game/src/sim/save/codec.ts`:

```ts
// Builds the saved game from the live pieces and checks one read back from
// the server. A save in a format this build doesn't know is refused whole
// (SaveFormatError) so the game offers a new life instead of half-loading.
// Bump SAVE_VERSION whenever a saved shape changes incompatibly.

import type { PlayerLife } from "../life/player.ts";
import type { Inbox } from "../mail/inbox.ts";
import type { NpcTown } from "../npcs/index.ts";
import type { DeskState, GameSave } from "./types.ts";

export const SAVE_VERSION = 1;

export class SaveFormatError extends Error {}

export interface GameParts {
  seed: number;
  day: number;
  hash: string;
  bankRun: string;
  life: PlayerLife;
  town: NpcTown;
  mail: Inbox;
  desk: DeskState | null;
}

export function encodeGame(g: GameParts): GameSave {
  return {
    version: SAVE_VERSION,
    seed: g.seed,
    day: g.day,
    hash: g.hash,
    bankRun: g.bankRun,
    life: g.life.toSave(),
    npcs: g.town.toSave(),
    mail: g.mail.toSave(),
    desk: g.desk ? structuredClone(g.desk) : null,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseSave(raw: unknown): GameSave {
  if (!isObject(raw)) throw new SaveFormatError("not a save");
  if (raw.version !== SAVE_VERSION) throw new SaveFormatError(`save version ${String(raw.version)}, this game reads ${SAVE_VERSION}`);
  if (typeof raw.seed !== "number" || typeof raw.day !== "number" || !isObject(raw.life)) throw new SaveFormatError("save is missing its life");
  return {
    version: SAVE_VERSION,
    seed: raw.seed,
    day: raw.day,
    hash: typeof raw.hash === "string" ? raw.hash : "",
    bankRun: typeof raw.bankRun === "string" ? raw.bankRun : "",
    life: raw.life as unknown as GameSave["life"],
    npcs: isObject(raw.npcs) ? (raw.npcs as GameSave["npcs"]) : {},
    mail: isObject(raw.mail) ? (raw.mail as unknown as GameSave["mail"]) : { items: [], seq: 0 },
    desk: isObject(raw.desk) ? (raw.desk as unknown as DeskState) : null,
  };
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd game && node --test tests/save.test.ts && npx tsc --noEmit`
Expected: PASS; no tsc output.

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/save/types.ts game/src/sim/save/codec.ts game/tests/save.test.ts
git commit -m "Saves: the versioned GameSave format"
```

---

## Task 10: The save client and SaveManager

**Files:**
- Create: `game/src/sim/save/client.ts`
- Create: `game/src/sim/save/manager.ts`
- Create: `game/tests/save-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `game/tests/save-manager.test.ts`:

```ts
// SaveManager tests: debounced writes, the rev chain, conflicts, offline
// retries, and the keepalive size limit. Timers are driven by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/net/api.ts";
import { KEEPALIVE_MAX, SaveManager, type SaveStatus } from "../src/sim/save/manager.ts";
import type { SaveApi, SavePut } from "../src/sim/save/client.ts";
import type { GameSave } from "../src/sim/save/types.ts";

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    timers: { set: (fn: () => void, ms: number) => (pending.set(next, { fn, ms }), next++), clear: (id: number) => void pending.delete(id) },
    pending,
    /** Runs every due timer once. */
    run: () => {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, t] of due) t.fn();
      return due.map(([, t]) => t.ms);
    },
  };
}

const game = (day: number, size = 10): GameSave => ({ version: 1, seed: 1, day, hash: "TX", bankRun: "b", life: { pad: "x".repeat(size) } as never, npcs: {}, mail: { items: [], seq: 0 }, desk: null });

function fakeApi(o: { fail?: () => number | null } = {}) {
  const puts: SavePut[] = [];
  const keepalive: SavePut[] = [];
  let rev = 0;
  const api: SaveApi = {
    me: async () => ({ player: { id: "p", name: null }, profile: null, save: null }),
    putProfile: async () => undefined,
    deleteSave: async () => undefined,
    putSave: async (b) => {
      const status = o.fail?.() ?? null;
      if (status === 0) throw new TypeError("network down");
      if (status) throw new ApiError(status, "no");
      puts.push(b);
      if (b.baseRev !== (rev || null)) throw new ApiError(409, "conflict");
      return { rev: ++rev };
    },
    putSaveKeepalive: (b) => void keepalive.push(b),
  };
  return { api, puts, keepalive };
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

test("a burst of requests sends one save, and each save names the last rev", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  let day = 1;
  const m = new SaveManager({ api, build: () => game(day), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  m.request();
  m.request();
  assert.deepEqual(t.run(), [1000]);
  await settle();
  assert.equal(puts.length, 1);
  assert.equal(puts[0].baseRev, null);
  day = 2;
  m.request();
  t.run();
  await settle();
  assert.equal(puts[1].baseRev, 1);
  assert.equal(puts[1].gameDay, 2);
  assert.equal(m.status, "saved");
});

test("a conflict stops saving for good", async () => {
  const t = fakeTimers();
  const { api } = fakeApi();
  const statuses: SaveStatus[] = [];
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: 5, timers: t.timers, onStatus: (s) => statuses.push(s) });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "conflict");
  m.request();
  assert.equal(t.pending.size, 0);
  assert.ok(statuses.includes("conflict"));
});

test("while the server is down it retries with a growing wait, then recovers", async () => {
  const t = fakeTimers();
  let down = true;
  const { api, puts } = fakeApi({ fail: () => (down ? 0 : null) });
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.request();
  t.run();
  await settle();
  assert.equal(m.status, "offline");
  assert.deepEqual(t.run(), [2000]);
  await settle();
  assert.deepEqual(t.run(), [4000]);
  await settle();
  down = false;
  t.run();
  await settle();
  assert.equal(m.status, "saved");
  assert.equal(puts.length, 1);
});

test("with no run to save under, it reports offline and sends nothing", async () => {
  const t = fakeTimers();
  const { api, puts } = fakeApi();
  const m = new SaveManager({ api, build: () => game(1), runId: () => null, baseRev: null, timers: t.timers });
  await m.flush();
  assert.equal(m.status, "offline");
  assert.equal(puts.length, 0);
});

test("the hide save uses keepalive only when it fits", () => {
  const t = fakeTimers();
  const { api, keepalive } = fakeApi();
  let size = 10;
  const m = new SaveManager({ api, build: () => game(1, size), runId: () => "run", baseRev: null, timers: t.timers });
  m.flushOnUnload();
  assert.equal(keepalive.length, 1);
  size = KEEPALIVE_MAX;
  m.flushOnUnload();
  assert.equal(keepalive.length, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/save-manager.test.ts`
Expected: FAIL, cannot find `manager.ts`.

- [ ] **Step 3: The client**

Create `game/src/sim/save/client.ts`:

```ts
// The server's profile and save routes (server/src/routes/save.ts).

import { apiFetch } from "../../net/api.ts";

export type ProfileSource = "voice" | "typed" | "skipped";

export interface Profile {
  displayName: string | null;
  job: string | null;
  salary: number | null;
  rent: number | null;
  debt: number | null;
  savings: number | null;
  state: string;
  source: ProfileSource;
}

export interface SaveRecord {
  runId: string;
  seed: number;
  version: number;
  gameDay: number;
  state: unknown;
  rev: number;
  updatedAt: string;
}

export interface Me {
  player: { id: string; name: string | null };
  profile: Profile | null;
  save: SaveRecord | null;
}

export interface SavePut {
  runId: string;
  seed: number;
  version: number;
  gameDay: number;
  state: unknown;
  baseRev: number | null;
}

export interface SaveApi {
  me(): Promise<Me>;
  putProfile(p: Omit<Profile, "displayName">): Promise<void>;
  putSave(body: SavePut): Promise<{ rev: number }>;
  /** Fire-and-forget with keepalive, for a page that is going away. */
  putSaveKeepalive(body: SavePut): void;
  deleteSave(): Promise<void>;
}

export function saveApi(baseUrl?: string): SaveApi {
  const o = baseUrl === undefined ? {} : { baseUrl };
  return {
    me: () => apiFetch<Me>("/me", o),
    putProfile: (p) => apiFetch<void>("/profile", { ...o, method: "PUT", body: JSON.stringify(p) }),
    putSave: (body) => apiFetch<{ rev: number }>("/save", { ...o, method: "PUT", body: JSON.stringify(body) }),
    putSaveKeepalive: (body) => {
      void apiFetch<{ rev: number }>("/save", { ...o, method: "PUT", body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
    },
    deleteSave: () => apiFetch<void>("/save", { ...o, method: "DELETE" }),
  };
}
```

- [ ] **Step 4: The manager**

Create `game/src/sim/save/manager.ts`:

```ts
// Autosave. The game calls request() after a decision, on each new game
// month, and after a skip; requests within a second collapse into one
// write. Each write names the rev it started from, so a second tab can't
// silently overwrite this one's progress (the server answers 409 and this
// manager stops for good: the other tab owns the life now). While the server
// is down it keeps retrying, waiting longer each time, and never drops a save.

import { ApiError } from "../../net/api.ts";
import type { SaveApi, SavePut } from "./client.ts";
import type { GameSave } from "./types.ts";

export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "conflict";

/** Browsers refuse keepalive requests with bodies over 64 KB; stay under it. */
export const KEEPALIVE_MAX = 60_000;
const DEBOUNCE_MS = 1_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

export interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface SaveManagerOptions {
  api: SaveApi;
  /** The game as it stands right now. */
  build: () => GameSave;
  /** The run the save belongs to; null while run recording is off. */
  runId: () => string | null;
  /** The loaded save's rev, or null for a new life. */
  baseRev: number | null;
  timers?: Timers;
  onStatus?: (status: SaveStatus) => void;
}

const browserTimers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) };

export class SaveManager {
  status: SaveStatus = "idle";
  private rev: number | null;
  private readonly o: SaveManagerOptions;
  private readonly timers: Timers;
  private timer: number | null = null;
  private failures = 0;
  private inflight: Promise<void> | null = null;
  private again = false;

  constructor(o: SaveManagerOptions) {
    this.o = o;
    this.rev = o.baseRev;
    this.timers = o.timers ?? browserTimers;
  }

  /** Save soon; a burst of requests sends one write. */
  request(): void {
    if (this.status === "conflict") return;
    this.schedule(DEBOUNCE_MS);
  }

  /** Save now (resolves when this write, and any it had to wait for, is done). */
  async flush(): Promise<void> {
    if (this.status === "conflict") return;
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    this.inflight = this.write().finally(() => (this.inflight = null));
    await this.inflight;
    if (this.again) {
      this.again = false;
      await this.flush();
    }
  }

  /** The page is going away: one keepalive write when it fits, otherwise the last save stands. */
  flushOnUnload(): void {
    if (this.status === "conflict") return;
    const body = this.body();
    if (!body || JSON.stringify(body).length >= KEEPALIVE_MAX) return;
    this.o.api.putSaveKeepalive(body);
  }

  private body(): SavePut | null {
    const runId = this.o.runId();
    if (!runId) return null;
    const g = this.o.build();
    return { runId, seed: g.seed, version: g.version, gameDay: g.day, state: g, baseRev: this.rev };
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private async write(): Promise<void> {
    const body = this.body();
    if (!body) return this.setStatus("offline");
    this.setStatus("saving");
    try {
      this.rev = (await this.o.api.putSave(body)).rev;
      this.failures = 0;
      this.setStatus("saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return this.setStatus("conflict");
      this.setStatus("offline");
      this.schedule(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures++));
    }
  }

  private setStatus(s: SaveStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.o.onStatus?.(s);
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd game && node --test tests/save-manager.test.ts && npx tsc --noEmit`
Expected: PASS, 5 tests; no tsc output.

- [ ] **Step 6: Commit**

```bash
git add game/src/sim/save/client.ts game/src/sim/save/manager.ts game/tests/save-manager.test.ts
git commit -m "Saves: the save client and a debounced, conflict-aware SaveManager"
```

---

## Task 11: The run recorder resumes a saved run

**Files:**
- Modify: `game/src/sim/record/index.ts`
- Test: `game/tests/record.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `game/tests/record.test.ts`:

```ts
test("a resumed recorder keeps its run and never starts a new one", async () => {
  const life = newLife();
  const server = fakeServer();
  const recorder = new RunRecorder({ life, seed: 5, fetchFn: server.fetchFn, runId: "saved-run", log: () => undefined });
  assert.equal(await recorder.begin(), true);
  assert.equal(recorder.runId, "saved-run");
  for (let day = 1; day <= 3; day++) life.onDay(day, dateOf(day));
  await recorder.tick(true);
  assert.ok(!server.calls.some((c) => c.path.endsWith("/runs")));
  assert.ok(server.calls.some((c) => c.path.endsWith("/snapshot")));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/record.test.ts --test-name-pattern="resumed recorder"`
Expected: FAIL, a `/runs` call is made.

- [ ] **Step 3: Implement**

In `game/src/sim/record/index.ts`, add to `RunRecorderOptions`:

```ts
  /** A saved game's run: record into it instead of starting a new one. */
  runId?: string;
```

In the constructor, after `this.log = ...`, add:

```ts
    this.runId = o.runId ?? null;
```

At the top of `begin()`, add:

```ts
    if (this.runId) return true;
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd game && node --test tests/record.test.ts && npx tsc --noEmit`
Expected: PASS; no tsc output.

- [ ] **Step 5: Commit**

```bash
git add game/src/sim/record/index.ts game/tests/record.test.ts
git commit -m "Run recorder: resume a saved game's run"
```

---

## Task 12: The intake becomes a profile

The intake stops remembering answers in localStorage; the server profile is the source of truth.
Two pure helpers convert between the intake's answers and the profile.

**Files:**
- Modify: `game/src/sim/life/intake.ts`
- Modify: `game/src/ui/intake.ts`
- Test: `game/tests/intake.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `game/tests/intake.test.ts` (keep its existing imports; add these):

```ts
import { answersFromProfile, profileFromIntake } from "../src/sim/life/intake.ts";

test("intake answers become a profile and come back unchanged", () => {
  const a = { job: "Nurse", salary: 72_000, rent: 1_400, debt: 9_000, savings: 3_000 };
  const p = profileFromIntake(a, "voice", "TX");
  assert.deepEqual(p, { ...a, state: "TX", source: "voice" });
  assert.deepEqual(answersFromProfile({ ...p, displayName: null }), a);
});

test("a skipped intake is a profile with no numbers, and no answers", () => {
  const p = profileFromIntake(null, "skipped", "CA");
  assert.deepEqual(p, { job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" });
  assert.equal(answersFromProfile({ ...p, displayName: null }), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/intake.test.ts`
Expected: FAIL, `profileFromIntake` is not exported.

- [ ] **Step 3: The helpers**

Append to `game/src/sim/life/intake.ts`:

```ts
/** The intake as the server's profile (server/src/routes/save.ts); a skip stores no numbers. */
export function profileFromIntake(a: IntakeAnswers | null, source: ProfileSource, state: string): Omit<Profile, "displayName"> {
  if (!a) return { job: null, salary: null, rent: null, debt: null, savings: null, state, source: "skipped" };
  return { job: a.job, salary: a.salary, rent: a.rent, debt: a.debt, savings: a.savings, state, source };
}

/** The intake answers a stored profile holds, or null for a skipped intake (the sample household). */
export function answersFromProfile(p: Profile): IntakeAnswers | null {
  if (p.source === "skipped") return null;
  return completeAnswers({ job: p.job ?? "", salary: p.salary ?? undefined, rent: p.rent ?? undefined, debt: p.debt ?? undefined, savings: p.savings ?? undefined });
}
```

and add to its imports:

```ts
import type { Profile, ProfileSource } from "../save/client.ts";
```

- [ ] **Step 4: The intake screen reports its source and forgets localStorage**

In `game/src/ui/intake.ts`:

1. Replace the header comment's last three lines (from `// Answers are remembered per browser;`) with:

```ts
// The answers become the player's server profile (main.ts), so the interview
// runs once per player; ?intake=1 forces it again and ?intake=0 skips it (for tests).
```

2. Delete `const STORAGE_KEY = "larp.intake.v1";`, and the `loadSaved` and `save` functions.

3. Change the imports to add the source type:

```ts
import type { ProfileSource } from "../sim/save/client";
```

4. Replace `runIntake` with:

```ts
export interface IntakeResult {
  /** The player's answers, or null to start with the sample household. */
  answers: IntakeAnswers | null;
  source: ProfileSource;
}

/** Runs the interview (or the typed form) and resolves with what the player gave. */
export function runIntake(o: IntakeOptions): Promise<IntakeResult> {
  if (new URLSearchParams(location.search).get("intake") === "0") return Promise.resolve({ answers: null, source: "skipped" });
  preloadOwl(["wave", "idle", "talk", "think", "cheer", "type", "read", "tip-hat"]);
  return new Promise((resolve) => new Intake(o, resolve).welcome());
}
```

5. In the `Intake` class, change the `resolve` field and constructor parameter type from `(answers: IntakeAnswers | null) => void` to `(r: IntakeResult) => void`, and add a field under `private answers`:

```ts
  /** "voice" once the Narrator's call handed over answers; the form alone is "typed". */
  private source: "voice" | "typed" = "typed";
```

6. In `onSubmitFinances`, after `this.answers = answers;` add `this.source = "voice";`.
In `fetchNotes`, replace `if (r.ready) return coerceAnswers(r.answers);` with:

```ts
        if (r.ready) {
          const notes = coerceAnswers(r.answers);
          if (Object.keys(notes).length) this.source = "voice";
          return notes;
        }
```

7. In `finish`, delete the `save(answers);` line and replace `this.resolve(answers);` with:

```ts
    this.resolve(answers ? { answers, source: this.source } : { answers: null, source: "skipped" });
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd game && node --test tests/intake.test.ts && npx tsc --noEmit`
Expected: the intake tests pass; tsc reports errors only in `src/main.ts` (it still expects the old `runIntake` result). Task 14 fixes it; do not commit a broken typecheck, so continue straight to Task 13 and 14 before committing, or commit with Task 14.

- [ ] **Step 6: Stage (commit happens at the end of Task 14)**

```bash
git add game/src/sim/life/intake.ts game/src/ui/intake.ts game/tests/intake.test.ts
```

---

## Task 13: HUD save chip and name, a notice card, and the welcome back

**Files:**
- Modify: `game/src/ui/hud.ts`
- Create: `game/src/ui/notice.ts`
- Modify: `game/src/ui/narrator.ts`
- Modify: `game/src/narration/lines.ts`
- Modify: `game/src/ui/pixel-theme.css`
- Test: `game/tests/narration.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `game/tests/narration.test.ts`:

```ts
import { welcomeBackLine } from "../src/narration/lines.ts";

test("the welcome back names the date and, when there is one, the job", () => {
  const date = new Date(2031, 2, 4);
  assert.equal(welcomeBackLine("Nurse", date), "Welcome back, nurse. It's March 4, 2031, and your money is right where you left it.");
  assert.equal(welcomeBackLine(null, date), "Welcome back. It's March 4, 2031, and your money is right where you left it.");
  assert.equal(welcomeBackLine("  ", date), "Welcome back. It's March 4, 2031, and your money is right where you left it.");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd game && node --test tests/narration.test.ts`
Expected: FAIL, `welcomeBackLine` is not exported.

- [ ] **Step 3: The line**

Append to `game/src/narration/lines.ts` (it is not one of the pre-voiced `CUES` lines, so the narrator voices it through the server's TTS, and the pack tests don't expect a clip for it):

```ts
/** The owl's greeting for a returning player: their job (from the intake) and the game date they're back on. */
export function welcomeBackLine(job: string | null, date: Date): string {
  const who = job?.trim() ? `, ${job.trim().toLowerCase()}` : "";
  const when = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `Welcome back${who}. It's ${when}, and your money is right where you left it.`;
}
```

- [ ] **Step 4: The narrator speaks a custom line**

In `game/src/ui/narrator.ts`:

Change the queue field to:

```ts
  private queue: { cue: Cue; line?: string }[] = [];
```

Replace the `cue` method with:

```ts
  /** Speaks a line for `cue` if the timing rules allow it now. */
  cue(cue: Cue): void {
    if (!this.gate.allow(cue, performance.now())) return;
    this.enqueue({ cue });
  }

  /** Speaks `line` (not from the pre-voiced pack) with `as`'s reaction and mood; the server voices it. */
  speak(line: string, as: Cue): void {
    this.enqueue({ cue: as, line });
  }

  private enqueue(item: { cue: Cue; line?: string }): void {
    this.queue.push(item);
    this.queue.sort((a, b) => CUES[b.cue].priority - CUES[a.cue].priority);
    this.queue.length = Math.min(this.queue.length, QUEUE_MAX);
    if (!this.busy) void this.next();
  }
```

In `next()`, replace from `const cue = this.queue.shift();` through `await this.say(line, cue);` with:

```ts
    const item = this.queue.shift();
    if (!item) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const line = item.line ?? pickLine(item.cue, this.lastLine.get(item.cue));
    if (!item.line) this.lastLine.set(item.cue, line);
    await this.say(line, item.cue);
```

- [ ] **Step 5: The notice card**

Create `game/src/ui/notice.ts`:

```ts
// A blocking card over the city for the rare moments the game can't go on by
// itself: a save from another version, or this life being played in another
// tab. Resolves when the player presses the button. (No window.confirm: it
// blocks the page and browser automation.)

export function showNotice(o: { title: string; body: string; action: string }): Promise<void> {
  const el = document.createElement("div");
  el.className = "notice-overlay";
  el.innerHTML = `<div class="notice-card" role="alertdialog" aria-modal="true" aria-labelledby="notice-title">
      <h2 id="notice-title"></h2>
      <p></p>
      <button type="button" class="btn"></button>
    </div>`;
  el.querySelector("h2")!.textContent = o.title;
  el.querySelector("p")!.textContent = o.body;
  const button = el.querySelector("button")!;
  button.textContent = o.action;
  document.body.appendChild(el);
  button.focus();
  return new Promise((done) =>
    button.addEventListener("click", () => {
      el.remove();
      done();
    }),
  );
}
```

- [ ] **Step 6: The HUD shows who you are and when saving stopped**

Replace the `Hud` class body in `game/src/ui/hud.ts` so the card gains a subtitle and a chip, keeping the existing home controls:

```ts
import type { SaveStatus } from "../sim/save/manager";

export class Hud {
  private readonly el: HTMLElement;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;

  constructor(root: HTMLElement, actions: HudActions) {
    this.el = root;
    root.innerHTML = `
      <section class="card home">
        <div class="label">${pixelIcon("home")} Your home <span class="hud-who" data-who></span></div>
        <div class="home-row">
          <button class="round" data-tier-step="-1" title="Net worth down">−</button>
          <div class="home-name" data-home></div>
          <button class="round" data-tier-step="1" title="Net worth up">+</button>
          <button class="round find" data-home-focus title="Find my home">${pixelIcon("pin")}</button>
        </div>
        <div class="hud-chip" data-save-chip hidden></div>
      </section>`;
    this.el.querySelectorAll<HTMLButtonElement>("[data-tier-step]").forEach((b) =>
      b.addEventListener("click", () => actions.tier(Number(b.dataset.tierStep))),
    );
    this.q<HTMLButtonElement>("[data-home-focus]").addEventListener("click", () => actions.focusHome());
  }

  render(homeTier: number | null): void {
    this.q("[data-home]").textContent = homeTier === null ? "No home lot" : HOME_TIERS[homeTier];
  }

  /** The player's job from the intake (their name, once accounts exist). */
  setWho(text: string): void {
    this.q("[data-who]").textContent = text ? `· ${text}` : "";
  }

  /** Shows a chip only when saving has stopped; a working save stays quiet. */
  setSave(status: SaveStatus): void {
    const chip = this.q("[data-save-chip]");
    const text = status === "offline" ? "Offline, not saving" : status === "conflict" ? "Open in another tab, not saving" : "";
    chip.textContent = text;
    chip.hidden = !text;
  }
}
```

- [ ] **Step 7: Styles**

Append to `game/src/ui/pixel-theme.css` (the pixel theme's palette and font; compare with `.st-row` and `.timeline-jump` around lines 123 and 306 and match their border and color variables):

```css
/* HUD: who the player is, and a chip when saving stops (ui/hud.ts). */
.hud-who { font-weight: 400; opacity: 0.75; margin-left: 4px; }
.hud-chip {
  margin-top: 8px;
  padding: 4px 8px;
  border: 2px solid #b3261e;
  background: #fde8e6;
  color: #7a1712;
  font: 12px/1.2 "Pixelify Sans", system-ui, sans-serif;
  image-rendering: pixelated;
}

/* A blocking notice over the city (ui/notice.ts). */
.notice-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgb(20 28 24 / 0.55);
}
.notice-card {
  max-width: min(420px, 90vw);
  padding: 20px 22px;
  border: 3px solid #1d2b22;
  background: #f6fbf7;
  box-shadow: 6px 6px 0 #1d2b22;
  font-family: "Pixelify Sans", system-ui, sans-serif;
}
.notice-card h2 { margin: 0 0 8px; font-size: 20px; }
.notice-card p { margin: 0 0 16px; line-height: 1.4; }
```

- [ ] **Step 8: Run the narration tests**

Run: `cd game && node --test tests/narration.test.ts tests/narration-pack.test.ts`
Expected: PASS.

- [ ] **Step 9: Stage (commit happens at the end of Task 14)**

```bash
git add game/src/ui/hud.ts game/src/ui/notice.ts game/src/ui/narrator.ts game/src/narration/lines.ts game/src/ui/pixel-theme.css game/tests/narration.test.ts
```

---

## Task 14: Boot from the save, and autosave

**Files:**
- Modify: `game/src/main.ts`
- Modify: `game/src/ui/phone.ts` (`PhoneDeps`, `MoneyHost`, the host object in the constructor)

- [ ] **Step 1: The Money desk's save hooks on the host**

In `game/src/ui/phone.ts`, add the import:

```ts
import type { DeskState } from "../sim/save/types";
```

Add to `PhoneDeps`:

```ts
  /** The Money desk changed something the save must keep (a payment, a trade, its feed). */
  changed: (desk: DeskState) => void;
  /** What the Money desk last reported, so it comes back when the desk opens. */
  deskState: () => DeskState | null;
```

Add to `MoneyHost`:

```ts
  /** The desk calls this after anything the player does, with its feed and statement, so the city saves. */
  changed: (desk: DeskState) => void;
  /** The desk's feed and statement from the save, to restore on load. */
  deskState: () => DeskState | null;
```

and in the constructor's `host` object add:

```ts
      changed: (desk) => this.deps.changed(desk),
      deskState: () => this.deps.deskState(),
```

- [ ] **Step 2: The boot flow**

In `game/src/main.ts`, add these imports next to the existing ones:

```ts
import { welcomeBackLine } from "./narration/lines";
import { answersFromProfile, lifeFromIntake, profileFromIntake } from "./sim/life/intake";
import { Inbox } from "./sim/mail/inbox";
import { saveApi } from "./sim/save/client";
import { encodeGame, parseSave } from "./sim/save/codec";
import { SaveManager } from "./sim/save/manager";
import type { DeskState, GameSave } from "./sim/save/types";
import { showNotice } from "./ui/notice";
```

(`lifeFromIntake` is already imported from `./sim/life/intake`; merge it into this line rather than importing twice.)

Replace everything from `const clock = new Clock();` down to (not including) `// The owl narrates the big moments from here on` with:

```ts
const clock = new Clock();
let scene: CityScene | null = null;
let skipping = 0;
const params = new URLSearchParams(location.search);

// Who this is and where they left off (server/src/routes/save.ts); null when the server is down,
// in which case the player gets a fresh life that isn't saved (the HUD says so).
const saves = saveApi();
const me = await saves.me().catch(() => null);
let saved: GameSave | null = null;
if (me?.save && params.get("intake") !== "1") {
  try {
    saved = parseSave(me.save.state);
  } catch {
    await showNotice({
      title: "A save from another version",
      body: "This life was saved by a different version of Larp City and can't be loaded here.",
      action: "Start a new life",
    });
    await saves.deleteSave().catch(() => undefined);
    me.save = null;
    me.profile = null;
  }
}

// The hash is a state (#CA) or a specialized city (#dallas).
const stateFor = (h: string) => STATES.find((s) => s.abbr === h.toUpperCase()) ?? stateForPin(h.toLowerCase(), STATES);
const fromHash = () => stateFor(location.hash.slice(1));
// A saved game goes back where the player was. Otherwise start where the link points, so the
// rent the player states belongs to that state, or in their profile's state.
let state: StateInfo =
  (saved ? stateFor(saved.hash) : undefined) ??
  fromHash() ??
  STATES.find((s) => s.abbr === me?.profile?.state) ??
  STATES.find((s) => s.abbr === "TX")!;
if (saved?.hash) history.replaceState(null, "", `#${saved.hash}`);

// The run's seed: the market path and every random draw hang off it (?seed= to replay one).
const seed = saved?.seed ?? (Number(params.get("seed")) || 20260912);
const market = new MarketPath(seed, clock.start);

// The player's money life: restored from the save, or built from the profile. With no profile,
// the owl's voice interview (or the typed form) asks first and the answers become the profile.
let player: PlayerLife;
if (saved) {
  clock.jumpTo(saved.day);
  player = PlayerLife.fromSave(saved.life, { market });
  player.place = state;
} else {
  let profile = me?.profile ?? null;
  if (!profile || params.get("intake") === "1") {
    const r = await runIntake({ backdrop: `${import.meta.env.BASE_URL}cities/${state.cityId}/plates/day.jpg` });
    const p = profileFromIntake(r.answers, r.source, state.abbr);
    profile = { ...p, displayName: null };
    // With the server down this is lost and the next visit asks again, like the save itself.
    void saves.putProfile(p).catch(() => undefined);
  }
  const answers = answersFromProfile(profile);
  player = answers
    ? lifeFromIntake(answers, { place: state, day: clock.day, market, holdings: STARTER_PORTFOLIO })
    : new PlayerLife({ place: state, day: clock.day, market, holdings: STARTER_PORTFOLIO });
}
```

Then replace the town, bank, and recorder block (from `const town = new NpcTown(` through `void recorder.begin();`) with:

```ts
const town = new NpcTown({ place: state, day: clock.day, market: player.market, start: clock.start, saved: saved?.npcs });
const api = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
// A resumed game keeps its Nessie accounts: the server reopens the same run and reads back its balances.
const bankRun = saved?.bankRun || `${seed}-${Date.now().toString(36)}`;
const bank = new BankSync({ run: bankRun, start: clock.start, base: `${api}/bank` });
bank.add("player", "Player", player);
for (const [id, life] of town.lives) bank.add(id, town.profiles.get(id)!.first, life);
void bank.begin();
// The player's daily snapshots and life events, recorded in Tiger Data; a resumed game records into its saved run.
const recorder = new RunRecorder({ life: player, seed, base: api, runId: saved ? me?.save?.runId : undefined });

// The phone's Mail inbox (sim/mail) and what the Money desk remembers; both ride in the save.
const mail = new Inbox(saved?.mail);
let desk: DeskState | null = saved?.desk ?? null;
```

In the `clock.onDay` callback, after `void recorder.tick();` add:

```ts
  // Save each new game month, so time-lapses and long idle play are kept too.
  if (clock.date.getDate() === 1) saver.request();
```

In `open()`, inside `if (next.abbr !== state.abbr) {`, after `narrator.cue("moved");` add:

```ts
    saver.request();
```

In the `FastForward` `onFinished` callback, after `void recorder.tick(true);` add:

```ts
    saver.request();
```

In the `new Phone({...})` deps, add:

```ts
  changed: (d) => {
    desk = d;
    saver.request();
  },
  deskState: () => desk,
```

- [ ] **Step 3: The SaveManager**

After the line `setInterval(() => hud.render(scene?.hero?.tier ?? null), 200);` add:

```ts
// Autosave (sim/save/manager.ts): after decisions, each game month, and skips; a second tab loses.
const saver = new SaveManager({
  api: saves,
  build: () => encodeGame({ seed, day: clock.day, hash: location.hash.slice(1), bankRun, life: player, town, mail, desk }),
  runId: () => recorder.runId,
  // ?intake=1 over an existing save overwrites it rather than conflicting with it.
  baseRev: me?.save?.rev ?? null,
  onStatus: (s) => {
    hud.setSave(s);
    if (s !== "conflict") return;
    clock.speed = 0;
    void showNotice({
      title: "Playing somewhere else",
      body: "This life is open in another tab, so this one stopped saving. Reload to carry on from there.",
      action: "Reload",
    }).then(() => location.reload());
  },
});
hud.setWho(player.job);
void recorder.begin().then(() => saver.request());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void saver.flush();
});
window.addEventListener("pagehide", () => saver.flushOnUnload());
// Back from the back/forward cache, this page's rev may be stale: load the life fresh instead.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
```

`saver` is used inside callbacks declared earlier (`clock.onDay`, `open`, `onFinished`, the phone deps); none of them runs before this line, because the clock only advances from the ticker and `open(state)` is awaited at the bottom of the file.

- [ ] **Step 4: The owl greets a returning player**

Replace the arrival block at the bottom (`// The owl opens the story once per browser tab.` and the `try`/`catch` after it) with:

```ts
// The owl opens the story once per browser tab, or welcomes a returning player back.
if (saved) narrator.speak(welcomeBackLine(player.job || null, clock.date), "arrival");
else {
  try {
    if (!sessionStorage.getItem("larp.narrator.arrived")) {
      sessionStorage.setItem("larp.narrator.arrived", "1");
      narrator.cue("arrival");
    }
  } catch {
    narrator.cue("arrival");
  }
}
```

Add `saver, mail` to the `larp` object in the last line.

- [ ] **Step 5: Typecheck and test**

Run: `cd game && npx tsc --noEmit && npm test`
Expected: no tsc output; all tests pass.

- [ ] **Step 6: Check it in the browser**

Start the local database and server (`cd server && DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/larp_dev?sslmode=disable' npm run dev`, after creating `larp_dev` and loading `game/db/schema.sql` into it), and the game (`cd game && npm run dev`).
Open the city, do the typed intake, set speed 4×, wait past the 1st of a game month, and reload.
Expected: no intake; the Timeline app shows the same date; the owl says "Welcome back, …"; `select game_day, rev from saves` shows the save.

- [ ] **Step 7: Commit (includes the staged Tasks 12 and 13)**

```bash
git add game/src/main.ts game/src/ui/phone.ts
git commit -m "Saves: the city boots from the saved game or the profile, and autosaves"
```

---

## Task 15: Stocks shows the game's market

The Markets section and the home widget stop showing a frozen FRED snapshot and a dead live-quote fetch.
They show the funds the player can buy, on today's game prices; real interest rates stay, labeled as real.

**Files:**
- Modify: `game/src/ui/phone.ts`

- [ ] **Step 1: Replace the watchlist and the live quotes**

In `game/src/ui/phone.ts`:

1. Replace the header comment's second through fourth lines ("Stocks lists the HackRice sponsor stocks ... when the dev server has a key), and opens the") with:

```ts
// bottom-right corner. Stocks lists the city's funds and the HackRice sponsor
// stocks at today's game prices (tap one to open its page), the real interest
// rates the game doesn't simulate (labeled as real), and opens the
```

2. Delete the `LiveQuote` interface, the `private live: LiveQuote[] = [];` field, the `void this.loadLive();` call in the constructor, and the whole `loadLive` method.

3. Replace the `WATCHLIST` constant with:

```ts
/** Real interest rates the game doesn't simulate: shown from the FRED snapshot and labeled as real. */
const RATES: { id: SeriesId; ticker: string; name: string }[] = [
  { id: "DFF", ticker: "FED", name: "Fed Funds Rate" },
  { id: "DGS10", ticker: "10Y", name: "10-Year Treasury Yield" },
  { id: "MORTGAGE30US", ticker: "30Y MTG", name: "30-Year Fixed Mortgage" },
];
```

4. Change the market import to `import { INSTRUMENTS, type Instrument, type InstrumentId } from "../sim/market";`.

- [ ] **Step 2: The home widget is filled on each game day**

In `markup()`, delete the first four lines of the method body (`const home = WATCHLIST[0];` through `const up = ...`), and replace the whole `<button class="widget" ...>...</button>` element with:

```ts
            <button class="widget" data-app="stocks" aria-label="Open Stocks">
              <div class="w-top"><span class="w-name">LTM</span><span class="w-chg" data-w-chg></span></div>
              <div class="w-value" data-w-value></div>
              <div data-w-spark style="display: contents"></div>
              <div class="w-foot">Larp Total Market · in game</div>
            </button>
```

- [ ] **Step 3: One quote helper for every instrument**

Replace `sponsorRows()` with:

```ts
  /** An instrument on the city player's market: today's close, the move since the last trading day, and about six weeks of closes. */
  private quote(id: InstrumentId): { px: number; chg: number; pts: number[]; tone: "up" | "down" | "flat" } {
    const market = this.deps.player.market;
    const day = this.deps.clock.day;
    const trading = (d: number) => ![0, 6].includes(market.dateOf(d).getDay());
    let today = day;
    while (!trading(today)) today--;
    let prev = today - 1;
    while (!trading(prev)) prev--;
    const px = market.price(id, today);
    const chg = px / market.price(id, prev) - 1;
    const pts = market.series(id, day - 42, day).filter((p) => trading(p.day)).map((p) => p.value);
    return { px, chg, pts, tone: Math.abs(chg) < 1e-6 ? "flat" : chg > 0 ? "up" : "down" };
  }

  private instrumentRows(list: readonly Instrument[]): string[] {
    return list.map((i) => {
      const { px, chg, pts, tone } = this.quote(i.id);
      return `<button class="st-row link" data-stock="${i.id}" aria-label="${i.name}: open in Money"><div class="st-name"><b>${i.id}</b><span>${i.name}${i.listed === false ? " · private" : ""}</span></div>${sparkline(pts, pts[pts.length - 1] >= pts[0])}<div class="st-right"><span class="st-px">$${fmtIndex(px)}</span><span class="st-pill ${tone}">${chg >= 0 ? "+" : "−"}${Math.abs(chg * 100).toFixed(2)}%</span></div></button>`;
    });
  }
```

- [ ] **Step 4: The list**

Replace `renderStocks()` with:

```ts
  private renderStocks() {
    this.stockDay = this.deps.clock.day;
    const item = (row: string) => `<li class="st-item">${row}</li>`;
    const sec = (title: string, note: string) => `<li class="st-sec"><span>${title}</span><span>${note}</span></li>`;
    const rates = RATES.map((r) => {
      const l = latest(r.id);
      const pts = MARKET.series[r.id].points.slice(-60).map((p) => p[1]);
      const up = l.change >= 0;
      return `<div class="st-row"><div class="st-name"><b>${r.ticker}</b><span>${r.name}</span></div>${sparkline(pts, pts[pts.length - 1] >= pts[0])}<div class="st-right"><span class="st-px">${l.value.toFixed(2)}%</span><span class="st-pill ${up ? "up" : "down"}">${up ? "+" : "−"}${Math.abs(l.change * 100).toFixed(0)} bp</span></div></div>`;
    });
    const asOf = new Date(`${MARKET.asOf}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    this.q("[data-st-list]").innerHTML = [
      sec("Funds and stocks", "In game"),
      ...this.instrumentRows(INSTRUMENTS.filter((i) => !i.sponsor)).map(item),
      // "In game" (not "Game prices") so the full title fits on the phone's 192px row.
      sec("HackRice sponsors", "In game"),
      ...this.instrumentRows(INSTRUMENTS.filter((i) => i.sponsor)).map(item),
      sec("Real rates", `FRED, ${asOf}`),
      ...rates.map(item),
    ].join("");
    this.q("[data-st-sub]").textContent = `Larp City, ${this.deps.clock.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

    const ltm = this.quote("LTM");
    const chg = this.q("[data-w-chg]");
    chg.textContent = `${ltm.chg >= 0 ? "+" : "−"}${Math.abs(ltm.chg * 100).toFixed(2)}%`;
    chg.className = `w-chg ${ltm.chg >= 0 ? "up" : "down"}`;
    this.q("[data-w-value]").textContent = `$${fmtIndex(ltm.px)}`;
    this.q("[data-w-spark]").innerHTML = sparkline(ltm.pts, ltm.pts[ltm.pts.length - 1] >= ltm.pts[0]).replace(
      'width="56" height="22"',
      'width="100%" height="34" preserveAspectRatio="none"',
    );
  }
```

- [ ] **Step 5: Typecheck, test, and look**

Run: `cd game && npx tsc --noEmit && npm test`
Expected: no tsc output (an unused `SeriesId` or `latest` import would fail `noUnusedLocals`; both are still used by `RATES`); tests pass.
In the browser, open the phone's Stocks app and the home screen at 1× for a few game days.
Expected: the widget shows LTM with a sparkline the same size as before; the list shows LTM, BOND, NNST, the sponsors, and three real rates; prices change each game day; no request to `/api/market/quotes` in the network panel.

- [ ] **Step 6: Commit**

```bash
git add game/src/ui/phone.ts
git commit -m "Stocks: the game's own funds on today's prices, real rates labeled as real"
```

---

## Task 16: Mail, News, Bank, and New life on the phone

**Files:**
- Create: `game/src/ui/phone-apps.ts`
- Create: `game/tests/phone-apps.test.ts`
- Modify: `game/src/ui/phone.ts`
- Modify: `game/src/sim/save/manager.ts` (a `stop()`)
- Modify: `game/tests/save-manager.test.ts`
- Modify: `game/src/main.ts`
- Modify: `game/src/ui/phone.css`

- [ ] **Step 1: Write the failing tests**

Create `game/tests/phone-apps.test.ts`:

```ts
// The phone's Mail, News, and Bank views are plain markup from data, so they test without a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bankHtml, mailHtml, newsHtml } from "../src/ui/phone-apps.ts";
import type { MailItem } from "../src/sim/mail/inbox.ts";

const letter = (o: Partial<MailItem> = {}): MailItem => ({ id: "m1", day: 3, from: "Credit bureau", subject: "Score up to 720", body: "Moved <b>up</b>.", tone: "good", decision: false, read: false, ...o });
const dateOf = (day: number) => new Date(2026, 8, 11 + day);

test("mail lists letters, marks unread, escapes text, and opens one", () => {
  const html = mailHtml([letter(), letter({ id: "m2", read: true, subject: "Old news" })], "m1", dateOf);
  assert.match(html, /data-mail-id="m1"/);
  assert.match(html, /mail-unread/);
  assert.match(html, /&#60;b&#62;up/);
  assert.match(html, /Moved/);
  assert.match(mailHtml([], null, dateOf), /No mail yet/);
  assert.match(mailHtml([letter({ decision: true })], "m1", dateOf), /data-desk/);
});

test("news shows stories, a loading line, and an off message", () => {
  assert.match(newsHtml({ status: "loading" }), /Printing/);
  assert.match(newsHtml({ status: "off" }), /newsroom is closed/i);
  const html = newsHtml({ status: "ready", label: "September 2026", stories: [{ title: "Card paid off", where: "Your finances", blurb: "It's gone.", impact: "More room." }] });
  assert.match(html, /Card paid off/);
  assert.match(html, /September 2026/);
});

test("the bank shows each mirrored account and its latest transactions", () => {
  const html = bankHtml({
    entity: "player",
    name: "Player",
    run: "r",
    accounts: [{ account: "checking", nessieId: "n1", accountNumber: "123456789", opening: 100, balance: 250, transactions: [{ date: "2026-09-30", amount: 150, memo: "Paycheck", key: "k" }] }],
  });
  assert.match(html, /Checking/);
  assert.match(html, /\$250/);
  assert.match(html, /Paycheck/);
  assert.match(html, /6789/);
  assert.match(bankHtml("off"), /isn't connected/);
});
```

Append to `game/tests/save-manager.test.ts`:

```ts
test("a stopped manager sends nothing, even on unload", async () => {
  const t = fakeTimers();
  const { api, puts, keepalive } = fakeApi();
  const m = new SaveManager({ api, build: () => game(1), runId: () => "run", baseRev: null, timers: t.timers });
  m.stop();
  m.request();
  await m.flush();
  m.flushOnUnload();
  assert.equal(puts.length + keepalive.length, 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd game && node --test tests/phone-apps.test.ts tests/save-manager.test.ts`
Expected: FAIL, cannot find `phone-apps.ts`; `m.stop is not a function`.

- [ ] **Step 3: SaveManager.stop**

In `game/src/sim/save/manager.ts`, add a field `private stopped = false;`, this method after `flushOnUnload`:

```ts
  /** Never save again (the life was just erased for a new one). */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
```

and make `request`, `flush`, and `flushOnUnload` return early when stopped: change each `if (this.status === "conflict") return;` to `if (this.stopped || this.status === "conflict") return;`.

- [ ] **Step 4: The views**

Create `game/src/ui/phone-apps.ts`:

```ts
// Markup for the phone's Mail, News, and Bank apps (ui/phone.ts draws them).
// Mail is the life's letters (sim/mail); News is the Larp City Ledger for the
// last game month, written by the server from the run's stored data
// (POST /api/news); Bank is the player's Capital One Nessie mirror
// (GET /api/bank/player). Plain functions of data, so they test in Node.

import type { MailItem } from "../sim/mail/inbox";

/** One Ledger story (server/src/ai/facts.ts Story). */
export interface Story {
  title: string;
  where: string;
  blurb: string;
  impact: string;
}

export type NewsView = { status: "loading" } | { status: "off" } | { status: "ready"; label: string; stories: Story[] };

/** The player's mirrored bank statement (server/src/mirror.ts Statement). */
export interface BankStatement {
  entity: string;
  name: string;
  run: string;
  accounts: {
    account: "checking" | "savings" | "credit";
    nessieId: string;
    accountNumber: string;
    opening: number;
    balance: number;
    transactions: { date: string; amount: number; memo: string; key: string }[];
  }[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const ACCOUNT_NAME = { checking: "Checking", savings: "Savings", credit: "Credit card" } as const;
/** Latest transactions shown per account. */
const BANK_ROWS = 5;

export function mailHtml(items: MailItem[], openId: string | null, dateOf: (day: number) => Date): string {
  if (!items.length) return `<li class="app-empty">No mail yet. Letters arrive when something big happens to your money.</li>`;
  return items
    .map((m) => {
      const date = dateOf(m.day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const open = m.id === openId;
      return `<li class="st-item"><button class="mail-row ${m.tone}${m.read ? "" : " mail-unread"}" data-mail-id="${m.id}" aria-expanded="${open}">
          <span class="mail-from">${esc(m.from)}<em>${date}</em></span>
          <span class="mail-subject">${esc(m.subject)}</span>
        </button>${
          open
            ? `<div class="mail-body"><p>${esc(m.body)}</p>${m.decision ? `<button class="st-open" data-desk>Open Money <span aria-hidden="true">↗</span></button>` : ""}</div>`
            : ""
        }</li>`;
    })
    .join("");
}

export function newsHtml(v: NewsView): string {
  if (v.status === "loading") return `<p class="app-empty">Printing this month's Ledger…</p>`;
  if (v.status === "off") return `<p class="app-empty">The newsroom is closed: the Ledger needs the game's server and a recorded run.</p>`;
  if (!v.stories.length) return `<p class="app-empty">A quiet month in ${esc(v.label)}. Nothing made the paper.</p>`;
  return `<p class="news-date">${esc(v.label)}</p>${v.stories
    .map((s) => `<article class="news-story"><span class="news-where">${esc(s.where)}</span><h3>${esc(s.title)}</h3><p>${esc(s.blurb)}</p><p class="news-impact">${esc(s.impact)}</p></article>`)
    .join("")}`;
}

export function bankHtml(s: BankStatement | "off" | "loading"): string {
  if (s === "loading") return `<p class="app-empty">Calling the bank…</p>`;
  if (s === "off" || !s.accounts.length) return `<p class="app-empty">Your bank isn't connected yet. Statements post here once a game month ends.</p>`;
  return s.accounts
    .map(
      (a) => `<section class="bank-acct">
        <header><b>${ACCOUNT_NAME[a.account]}</b><span>•••• ${esc(a.accountNumber.slice(-4))}</span><strong>${usd(a.balance)}</strong></header>
        <ul>${a.transactions
          .slice(-BANK_ROWS)
          .reverse()
          .map((t) => `<li><span>${esc(t.memo)}<em>${esc(t.date)}</em></span><span class="${t.amount >= 0 ? "up" : "down"}">${t.amount >= 0 ? "+" : ""}${usd(t.amount)}</span></li>`)
          .join("")}</ul>
      </section>`,
    )
    .join("");
}
```

- [ ] **Step 5: Wire them into the phone**

In `game/src/ui/phone.ts`:

1. Imports:

```ts
import { apiFetch } from "../net/api";
import type { Inbox } from "../sim/mail/inbox";
import { bankHtml, mailHtml, newsHtml, type BankStatement, type NewsView, type Story } from "./phone-apps";
```

2. In `APPS`, set `ready: true` on news, mail, and bank.

3. Add to `PhoneDeps`:

```ts
  /** The Mail inbox (sim/mail). */
  mail: Inbox;
  /** Erases this life and starts over with the intake; rejects when the server can't be reached. */
  newLife: () => Promise<void>;
```

4. Add to `MoneyHost` and its host object:

```ts
  /** The desk's "Start over": the phone asks for confirmation in Timeline. */
  newLife: () => void;
```

```ts
      newLife: () => {
        this.closeDesk();
        this.setOpen(true);
        this.show("timeline");
        this.armNewLife();
      },
```

5. Fields:

```ts
  private openMail: string | null = null;
  /** The Ledger by game month ("2026-09"), so reopening News doesn't re-ask the server. */
  private readonly news = new Map<string, NewsView>();
  private newLifeTimer = 0;
```

6. In the app grid markup, give every app a badge slot: replace `${a.ready ? "" : `<span class="app-badge">Soon</span>`}` with:

```ts
                  ${a.ready ? `<span class="app-badge" data-badge="${a.id}" hidden></span>` : `<span class="app-badge">Soon</span>`}
```

7. Add three views after the timeline `</section>`:

```ts
          <section class="view view-mail" data-view="mail" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Mail</div><div class="st-sub">Letters about your money</div></div>
            </header>
            <ul class="st-list" data-mail-list></ul>
          </section>

          <section class="view view-news" data-view="news" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">The Ledger</div><div class="st-sub">Larp City's newspaper</div></div>
            </header>
            <div class="news-body" data-news></div>
          </section>

          <section class="view view-bank" data-view="bank" hidden>
            <header class="phone-app-head">
              <button class="st-back" data-home aria-label="Back to home">‹</button>
              <div><div class="st-title">Bank</div><div class="st-sub">Capital One Nessie statement</div></div>
            </header>
            <div class="bank-body" data-bank></div>
          </section>
```

and in the Timeline view, after the "Jump ahead" section, add:

```ts
            <div class="timeline-section">
              <span class="timeline-label">Start over</span>
              <button class="timeline-jump danger" data-new-life>New life</button>
            </div>
```

8. In the constructor, after `this.renderStocks();` add `this.renderMail();`.

9. In `onClick`, before `const id = btn.dataset.app`, add:

```ts
    if (btn.dataset.mailId) {
      this.openMail = this.openMail === btn.dataset.mailId ? null : btn.dataset.mailId;
      this.deps.mail.markRead(btn.dataset.mailId);
      this.renderMail();
      return;
    }
    if (btn.dataset.newLife !== undefined) return this.onNewLife(btn);
```

and replace the last line `this.show(id);` with:

```ts
    this.show(id);
    if (id === "mail") this.renderMail();
    if (id === "news") void this.loadNews();
    if (id === "bank") void this.loadBank();
```

10. Methods:

```ts
  /** Redraws the inbox and the unread badge; main.ts calls it when new mail arrives. */
  renderMail() {
    const { mail, clock } = this.deps;
    const dateOf = (day: number) => {
      const d = new Date(clock.start);
      d.setDate(d.getDate() + day);
      return d;
    };
    this.q("[data-mail-list]").innerHTML = mailHtml(mail.items, this.openMail, dateOf);
    const badge = this.q("[data-badge=mail]");
    const n = mail.unread();
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = n === 0;
  }

  /** The Ledger for the game month so far, from the run's stored days (sent first, so the paper is current). */
  private async loadNews() {
    const { clock, recorder } = this.deps;
    const d = clock.date;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const el = this.q("[data-news]");
    const cached = this.news.get(key);
    if (cached) return void (el.innerHTML = newsHtml(cached));
    el.innerHTML = newsHtml({ status: "loading" });
    const runId = recorder?.runId;
    let view: NewsView = { status: "off" };
    if (recorder && runId) {
      try {
        await recorder.tick(true);
        const from = Math.max(0, clock.day - (d.getDate() - 1));
        const r = await apiFetch<{ stories: Story[] }>("/news", { method: "POST", body: JSON.stringify({ runId, from, to: clock.day }) });
        view = { status: "ready", label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }), stories: r.stories };
        this.news.set(key, view);
      } catch {
        // Leave it "off"; the next open asks again.
      }
    }
    el.innerHTML = newsHtml(view);
  }

  private async loadBank() {
    const el = this.q("[data-bank]");
    el.innerHTML = bankHtml("loading");
    try {
      el.innerHTML = bankHtml(await apiFetch<BankStatement>("/bank/player"));
    } catch {
      el.innerHTML = bankHtml("off");
    }
  }

  /** "New life" asks twice: the first tap arms it for four seconds. */
  private armNewLife() {
    const btn = this.q<HTMLButtonElement>("[data-new-life]");
    btn.dataset.armed = "1";
    btn.textContent = "Tap again to erase this life";
    clearTimeout(this.newLifeTimer);
    this.newLifeTimer = window.setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = "New life";
    }, 4000);
  }

  private onNewLife(btn: HTMLButtonElement) {
    if (!btn.dataset.armed) return this.armNewLife();
    clearTimeout(this.newLifeTimer);
    btn.disabled = true;
    btn.textContent = "Erasing…";
    this.deps.newLife().catch(() => {
      btn.disabled = false;
      delete btn.dataset.armed;
      btn.textContent = "New life";
      this.toast("Can't reach the server");
    });
  }
```

(The `news` field shadows nothing; if `this.news` conflicts with an existing name, rename it `newsCache`.)

- [ ] **Step 6: Styles**

Append to `game/src/ui/phone.css`, matching `.st-row` (line 299) for borders, spacing, and the pixel font:

```css
/* Mail, News, and Bank (ui/phone-apps.ts). */
.app-empty { margin: 16px 12px; opacity: 0.7; line-height: 1.4; }
.app-badge[data-badge] { background: #ff453a; color: #fff; }
.mail-row {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
.mail-row.mail-unread .mail-subject { font-weight: 700; }
.mail-row.mail-unread::before { content: "●"; color: #0a84ff; font-size: 10px; }
.mail-from { display: flex; justify-content: space-between; font-size: 12px; opacity: 0.75; }
.mail-from em { font-style: normal; }
.mail-row.bad .mail-subject { color: #ff453a; }
.mail-row.good .mail-subject { color: #30d158; }
.mail-body { padding: 0 12px 12px; line-height: 1.4; }
.news-body, .bank-body { padding: 8px 12px; overflow-y: auto; }
.news-date { margin: 0 0 8px; font-size: 12px; opacity: 0.75; }
.news-story + .news-story { border-top: 2px solid currentColor; margin-top: 10px; padding-top: 10px; }
.news-story h3 { margin: 2px 0 4px; font-size: 16px; }
.news-story p { margin: 0 0 4px; line-height: 1.35; }
.news-where { font-size: 11px; text-transform: uppercase; opacity: 0.7; }
.news-impact { font-style: italic; }
.bank-acct + .bank-acct { margin-top: 12px; }
.bank-acct header { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; }
.bank-acct header strong { grid-column: 1 / -1; font-size: 20px; }
.bank-acct ul { list-style: none; margin: 6px 0 0; padding: 0; }
.bank-acct li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; }
.bank-acct li em { display: block; font-style: normal; font-size: 11px; opacity: 0.7; }
.bank-acct .up { color: #30d158; }
.bank-acct .down { color: #ff453a; }
.timeline-jump.danger { color: #ff453a; }
```

- [ ] **Step 7: main.ts files letters and erases lives**

In `game/src/main.ts`, after `let desk: DeskState | null = saved?.desk ?? null;` add:

```ts
const debtName = (id: string) => player.book.debts.find((d) => d.id === id)?.name ?? "Your loan";
player.onEvents((events) => {
  if (mail.add(events, debtName).length) phone.renderMail();
});
```

and add to the `new Phone({...})` deps:

```ts
  mail,
  newLife: async () => {
    await saves.deleteSave();
    // The erased life must not be saved again on the way out.
    saver.stop();
    location.href = location.pathname;
  },
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `cd game && node --test tests/phone-apps.test.ts tests/save-manager.test.ts && npx tsc --noEmit && npm test`
Expected: PASS; no tsc output; the suite passes.

- [ ] **Step 9: Look at every new screen**

With the server and game running, play at 4× for three game months, then open Mail, News, and Bank, open a letter, and tap New life once (don't confirm).
Expected: an unread badge on Mail that clears as letters are opened; a Ledger for the current month; a Nessie statement (or the "isn't connected" line when `NESSIE_API_KEY` is unset); the New life button shows the confirm text and resets after four seconds.
Check each screen at the phone's real size: nothing clipped, the pixel font throughout, colors consistent with the Stocks app.

- [ ] **Step 10: Commit**

```bash
git add game/src/ui/phone-apps.ts game/tests/phone-apps.test.ts game/src/ui/phone.ts game/src/ui/phone.css game/src/sim/save/manager.ts game/tests/save-manager.test.ts game/src/main.ts
git commit -m "Phone: Mail from the life's big moments, the Ledger, the Nessie statement, and New life"
```

---

## Task 17: The Money desk saves, and standalone loads the saved life

**Files:**
- Modify: `game/src/debt-demo/main.ts`
- Modify: `game/src/debt-demo/desk.css`

- [ ] **Step 1: Imports and shared types**

In `game/src/debt-demo/main.ts`, add after the `RunRecorder` import:

```ts
import { saveApi } from "../sim/save/client.ts";
import { parseSave } from "../sim/save/codec.ts";
import { SaveManager } from "../sim/save/manager.ts";
import type { DeskBankTxn, DeskFeedItem, DeskState, GameSave } from "../sim/save/types.ts";
import { showNotice } from "../ui/notice.ts";
```

Replace the `interface FeedItem { ... }` and `interface BankTxn { ... }` declarations (lines 39-54) with:

```ts
// The feed and statement ride in the saved game, so their shapes live in sim/save/types.ts.
type FeedItem = DeskFeedItem;
/** One line on the Cash tab's bank statement: money into or out of cash, or a move between cash accounts. */
type BankTxn = DeskBankTxn;
```

- [ ] **Step 2: Standalone loads the saved life**

Replace this block:

```ts
const clock = host?.clock ?? new Clock();
const market = host?.life().market ?? new MarketPath();
let rateShock = 0;
let life = host ? host.life() : makeLife();
if (host) life.onEvents(onLifeEvents);
// Standalone, the desk records its own run in Tiger Data; inside the city, the city's recorder already records this life.
const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
let recorder = host ? null : startRecorder();

function startRecorder(): RunRecorder {
  const r = new RunRecorder({ life, seed: market.seed, base: API_BASE });
  void r.begin();
  return r;
}
```

with:

```ts
// Standalone, the desk shows the player's saved city life. With the server down it runs the
// sample household as a demo; with the server up and no saved life, it sends the player to the city.
const saves = saveApi();
const me = host ? null : await saves.me().catch(() => null);
const standaloneSave: GameSave | null = (() => {
  if (!me?.save) return null;
  try {
    return parseSave(me.save.state);
  } catch {
    return null;
  }
})();
const noLife = !host && me !== null && !standaloneSave;
const clock = host?.clock ?? new Clock();
if (standaloneSave) clock.jumpTo(standaloneSave.day);
const market = host?.life().market ?? new MarketPath(standaloneSave?.seed);
let rateShock = 0;
let life = host ? host.life() : standaloneSave ? restoreLife(standaloneSave) : makeLife();
if (host) life.onEvents(onLifeEvents);
// Standalone, the desk records into the saved run (or its own); inside the city, the city's recorder already records this life.
const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;
let recorder = host ? null : startRecorder(standaloneSave ? me?.save?.runId : undefined);

function startRecorder(runId?: string): RunRecorder {
  const r = new RunRecorder({ life, seed: market.seed, base: API_BASE, runId });
  void r.begin();
  return r;
}

function restoreLife(s: GameSave): PlayerLife {
  const l = PlayerLife.fromSave(s.life, { market, cashRate: (d) => seriesOn("DFF", d) / 100 + rateShock });
  l.onEvents(onLifeEvents);
  return l;
}

// Standalone with a saved life, the desk saves it too; the NPCs and mail ride along unchanged
// (the city catches the NPCs up on its next load). Inside the city, the city saves.
const standaloneSaver =
  standaloneSave && me?.save
    ? new SaveManager({
        api: saves,
        build: () => ({ ...standaloneSave, day: clock.day, life: life.toSave(), desk: deskState() }),
        runId: () => recorder?.runId ?? null,
        baseRev: me.save.rev,
        onStatus: (s) => {
          if (s !== "conflict") return;
          clock.speed = 0;
          void showNotice({
            title: "Playing somewhere else",
            body: "This life is open in another tab, so this one stopped saving. Reload to carry on from there.",
            action: "Reload",
          }).then(() => location.reload());
        },
      })
    : null;
```

- [ ] **Step 3: The desk's memory comes back and goes out**

After `const bank: BankTxn[] = [];` add:

```ts
// What the desk remembered last time: from the city (inside it) or the save (standalone).
const remembered = host ? host.deskState() : (standaloneSave?.desk ?? null);
if (remembered) {
  feed.push(...remembered.feed);
  bank.push(...remembered.bank);
  crash = remembered.crash;
  recovery = remembered.recovery;
}
```

Add after the `bankLog` function:

```ts
function deskState(): DeskState {
  return { feed, bank, crash, recovery };
}

/** After anything the player does: the city (or the standalone saver) saves the life and this desk's memory. */
function saveDesk() {
  if (host) host.changed(deskState());
  else standaloneSaver?.request();
}
```

In the click listener, change its final `render();` (just before `});` and `window.addEventListener("resize", ...)`) to:

```ts
  render();
  saveDesk();
```

and change the shop's mount so its changes save too:

```ts
const shop = mountShop({ root: shopEl, life: () => life, clock, log: (day, _tag, text, tone) => log(day, text, tone === "info" ? "flat" : tone), onChange: () => {
  render();
  saveDesk();
} });
```

- [ ] **Step 4: Start over goes through New life**

Replace the `case "reset":` body with:

```ts
    case "reset":
      menuOpen = false;
      if (host) {
        // Inside the city, the phone's Timeline asks for confirmation, then erases the life.
        host.newLife();
      } else if (standaloneSaver) {
        standaloneSaver.stop();
        void saves.deleteSave().then(() => (location.href = "/"));
      } else {
        // The offline demo: a fresh sample household.
        feed.length = 0;
        bank.length = 0;
        xferMsg = null;
        rateShock = 0;
        life = makeLife();
        recorder = startRecorder();
        crash = recovery = recap = null;
        shopShown = false;
      }
      break;
```

- [ ] **Step 5: The start**

Replace the Start section's last part, from `window.addEventListener("hashchange", () => {` to the end of the file, with:

```ts
window.addEventListener("hashchange", () => {
  if (!noLife && openFromHash()) render();
});

if (noLife) {
  // The server is up but this player has no life yet: it starts in the city, with the owl.
  app.innerHTML = `<div class="d-nolife"><h1>No life here yet</h1><p>Your money lives in Larp City. Move in with the Narrator first, then come back.</p><a class="btn primary" href="/">Go to Larp City</a></div>`;
} else {
  openFromHash();
  if (host) {
    // The city's ticker drives the clock and the city calls life.onDay; every day's events
    // reach onLifeEvents, which re-renders. Decision moments come through the phone.
    host.onShow(showParkedDecisions);
    showParkedDecisions();
  } else {
    clock.onDay((day) => {
      life.onDay(day, clock.date);
      void recorder?.tick();
      if (clock.date.getDate() === 1) standaloneSaver?.request();
    });
    if (standaloneSaver) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void standaloneSaver.flush();
      });
      window.addEventListener("pagehide", () => standaloneSaver.flushOnUnload());
    }
    clock.speed = 1;
    let last = performance.now();
    const frame = (now: number) => {
      clock.update(Math.min(0.25, (now - last) / 1000));
      last = now;
      requestAnimationFrame(frame);
    };
    render();
    requestAnimationFrame(frame);
  }
}
```

(The original bare `openFromHash();` call just above this section moves inside the `else`; delete it.)

- [ ] **Step 6: The "no life" page's style**

Append to `game/src/debt-demo/desk.css`:

```css
/* Standalone /debt.html with no saved life (main.ts, Start). */
.d-nolife {
  max-width: 440px;
  margin: 18vh auto 0;
  padding: 24px;
  text-align: center;
}
.d-nolife h1 { margin: 0 0 8px; }
.d-nolife p { margin: 0 0 20px; line-height: 1.45; opacity: 0.8; }
```

- [ ] **Step 7: Typecheck, test, and look**

Run: `cd game && npx tsc --noEmit && npm test && npm run build`
Expected: no tsc output; tests pass; the build writes both pages.
In the browser:
- In the city, open Money, make a $100 extra payment and buy $50 of LTM, close it, reload the city, reopen Money. Expected: the payment and the buy are still in the feed and the Cash statement.
- Open `/debt.html` in a new tab with the city tab closed. Expected: the same net worth, day, and feed; a trade here survives reloading the city.
- Open `/debt.html` from a fresh browser profile (a new cookie) with the server up. Expected: the "No life here yet" page, styled and centered.

- [ ] **Step 8: Commit**

```bash
git add game/src/debt-demo/main.ts game/src/debt-demo/desk.css
git commit -m "Money desk: saves its decisions and memory; standalone opens the saved life"
```

---

## Task 18: Docs and the end-to-end check

**Files:**
- Modify: `game/README.md` ("What you can do", "How it is built")
- Modify: `server/README.md` (a new "Profile and saves" section before "AI coach and newspaper")
- Modify: `CLAUDE.md` (game architecture and server architecture)

- [ ] **Step 1: Docs**

Follow the repo's Markdown rule: one sentence per line.

In `game/README.md`, "What you can do": add bullets that your life is saved on the server and resumes on reload (New life in Timeline starts over), and that the phone's Mail, News (the Ledger), and Bank (the Nessie statement) apps show your life's letters, newspaper, and bank.
In "How it is built": add a paragraph on `sim/save/` (the `GameSave` format, `toSave`/`fromSave` on each stateful class, `SaveManager`'s triggers and `rev` conflicts, history compaction) and `sim/mail/`, and that a new piece of sim state must be added to its class's save and covered by `tests/save.test.ts`.

In `server/README.md`, add:

```markdown
## Profile and saves

The player's confirmed intake is a `profiles` row and their game is one `saves` row, both keyed by the session's player (and, once accounts exist, by the account's player).
`GET /api/me` returns the player, profile, and save; `PUT /api/profile` stores the intake; `PUT /api/save` writes the game and bumps `rev`, answering 409 when the caller's `baseRev` is stale (another tab saved since); `DELETE /api/save` starts a new life.
The save's `state` is opaque JSON the game owns (`game/src/sim/save/`), capped at 1.5 MB.
The coach and the newspaper read the player's job and state from the profile.
```

In `CLAUDE.md`, game architecture: add a `sim/save/` bullet (the saved game: `toSave`/`fromSave` on each stateful sim class, `encodeGame`/`parseSave`, `SaveManager`; new sim state must join the save and `tests/save.test.ts`) and a `sim/mail/` bullet (the Mail inbox from life events), and note in the UI paragraph that Mail, News, and Bank are live phone apps.
Server architecture: add `store/saves.ts` and `routes/save.ts` (profiles and saves with `rev` conflicts).

- [ ] **Step 2: Full verification**

Run: `cd game && npx tsc --noEmit && npm test && npm run build`
Run: `cd server && npx tsc --noEmit -p tsconfig.json && TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test`
Expected: everything passes.

- [ ] **Step 3: End to end, as a player, in the browser**

Use Claude in Chrome against the local server (local database, never the team's shared Tiger Data) and `npm run dev`. Record a GIF of the run.

1. Fresh cookie: the owl's intake appears; type the numbers and move in. `select source, job from profiles` shows the row.
2. Play at 4× for two game months; make a trade and apply for a card in the Card Shop; open Mail and read a letter.
3. Reload: no intake, the owl says "Welcome back, …", the Timeline date, net worth, the card, the trade, the read letter, and the desk feed are all as they were.
4. Open `/debt.html` in a second tab while the city is open, make a payment there; switch to the city and wait for a save. Expected: one tab shows the "Playing somewhere else" notice and stops saving; reloading it carries on from the other tab's save.
5. Stop the server: the HUD chip says "Offline, not saving"; start it again and the chip goes away after the next save.
6. Timeline, New life, confirm: the intake runs again and the old run shows `ended_at` in `runs`.
7. Change a saved row's `version` to 999 in the database and reload: the "A save from another version" notice, then the intake.

Be picky about every screen along the way (HUD card, chip, notice card, the three new phone apps, the "No life here yet" page): alignment, spacing, the pixel font, colors against the pixel theme, nothing clipped at the phone's size. Fix anything off, even if unrelated, and rerun the checks it touches.

- [ ] **Step 4: Commit**

```bash
git add game/README.md server/README.md CLAUDE.md
git commit -m "Docs: saved games, the profile, and the live Mail, News, and Bank apps"
```

- [ ] **Step 5: Finish the branch**

Fetch and check `origin/main` (other sessions push to it), rebase or merge as needed, rerun Step 2, then use superpowers:finishing-a-development-branch to open the PR.
