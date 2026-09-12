# Nessie Local Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bank mirror (`/api/bank/*`) keep working when live Nessie (`api.nessieisreal.com`) is unreachable, by transparently falling back to a Postgres-backed local mirror, and automatically replaying anything local-only back into Nessie once it recovers.

**Architecture:** A new `FailoverNessie` class sits between `MirrorService` (`server/src/mirror.ts`, unchanged) and the real `Nessie` client (`server/src/adapters/nessie.ts`, unchanged). Every write tries live Nessie first and falls back to a new Postgres-backed `LocalNessie` store on failure; every read comes from `LocalNessie` only, since it shadow-copies every successful live write too. A periodic sweep (`server/src/replay.ts`) pushes anything still local-only into live Nessie once it's reachable again.

**Tech Stack:** TypeScript, Node's built-in `node:test` + `node:assert/strict` (matches the rest of `server/`), `pg` (`pg.Pool`, no ORM), Zod is not needed here (no new HTTP input surface). Full spec: `docs/superpowers/specs/2026-09-12-nessie-fallback-design.md`.

## Global Constraints

- Scope is exactly the 9 methods `MirrorService` calls today: `listCustomers`, `createCustomer`, `listAccounts`, `createAccount`, `deleteAccount`, `deposit`, `withdraw`, `listDeposits`, `listWithdrawals`. Do not add fallback support for `transfer`, `createBill`, `createLoan`, `renameAccount`, `listTransfers`, or `listBills` — nothing calls them.
- Local ids are permanent and canonical (`local-<uuid>`, via `node:crypto`'s `randomUUID()`); a `nessieId`/`nessie_id` column records the real Nessie id once (and if) a live call succeeds. Nothing ever renames or remaps a local id.
- No circuit breaker, no manual toggle, no health-check poller. Every write independently tries live, every single time, per the spec's "automatic per-call failover" decision.
- `/api/bank/*` response shapes do not change. No `live`/`fallback` flag is added anywhere in the HTTP contract.
- Postgres itself being unavailable is explicitly out of scope; it already fails the whole app the same way it does today (`server/src/db.ts`'s pool). Do not add retry/resilience logic for that.
- Migrations are additive only (`CREATE TABLE IF NOT EXISTS`), appended to `server/src/migrations.sql`, matching that file's existing comment ("Additive only: never drops or renames a column").
- Test runner is `node --import tsx --test`, invoked via `npm test` from `server/`. DB-backed tests follow the existing skip-unless-`TEST_DATABASE_URL` pattern from `server/src/store/runs.db.test.ts` — do not make any test in this plan require a database unless it is specifically testing the Postgres store, and gate those with the same `{ skip }` pattern.
- Follow existing file/naming conventions: one adapter per concern in `server/src/adapters/`, one store per concern in `server/src/store/`, test doubles in `server/src/test/`.

---

### Task 1: Extract a `NessieLike` interface so `MirrorService` can take more than a real `Nessie`

**Files:**
- Modify: `server/src/adapters/nessie.ts`
- Modify: `server/src/mirror.ts:1,95-105`

**Interfaces:**
- Produces: `export interface NessieLike` in `server/src/adapters/nessie.ts`, with exactly the 9 methods `MirrorService` calls (see Global Constraints). `export type NewTx = ...` (currently unexported). `export class Nessie implements NessieLike`.
- Consumes: nothing new — this is a pure type-level refactor of existing code.

This task changes no runtime behavior. There is no new test to write first (TDD's "red" step doesn't apply to a type-only refactor) — instead, the existing test suites (`server/src/adapters/nessie.test.ts` and `server/src/mirror.test.ts`) are the safety net: they must still pass unchanged afterward.

- [ ] **Step 1: Export `NewTx` and add the `NessieLike` interface in `adapters/nessie.ts`**

In `server/src/adapters/nessie.ts`, change line 97 from:

```ts
type NewTx = Omit<MoneyTx, "_id" | "medium"> & { medium?: MoneyTx["medium"] };
```

to:

```ts
export type NewTx = Omit<MoneyTx, "_id" | "medium"> & { medium?: MoneyTx["medium"] };

/** The subset of Nessie's API the bank mirror actually calls; also implemented by the local fallback. */
export interface NessieLike {
  listCustomers(): Promise<Customer[]>;
  createCustomer(c: Omit<Customer, "_id">): Promise<Customer>;
  listAccounts(customerId: string): Promise<Account[]>;
  createAccount(customerId: string, a: { type: AccountType; nickname: string; balance: number; rewards?: number }): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
  deposit(accountId: string, tx: NewTx): Promise<MoneyTx>;
  withdraw(accountId: string, tx: NewTx): Promise<MoneyTx>;
  listDeposits(accountId: string): Promise<MoneyTx[]>;
  listWithdrawals(accountId: string): Promise<MoneyTx[]>;
}
```

Place this new code directly above the existing `export class Nessie {` line (currently line 108). Then change that class declaration from:

```ts
export class Nessie {
```

to:

```ts
export class Nessie implements NessieLike {
```

- [ ] **Step 2: Point `mirror.ts` at the interface instead of the concrete class**

In `server/src/mirror.ts`, change the import on line 18 from:

```ts
import type { Account, AccountType, Customer, MoneyTx, Nessie } from "./adapters/nessie.js";
```

to:

```ts
import type { Account, AccountType, Customer, MoneyTx, NessieLike } from "./adapters/nessie.js";
```

Then in the `MirrorService` class (around line 95-105), change:

```ts
export class MirrorService {
  private readonly nessie: Nessie;
  private readonly tag: string;
  private readonly live = new Map<string, Live>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private customers: Map<string, Customer> | null = null;

  constructor(nessie: Nessie, tag: string) {
```

to:

```ts
export class MirrorService {
  private readonly nessie: NessieLike;
  private readonly tag: string;
  private readonly live = new Map<string, Live>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private customers: Map<string, Customer> | null = null;

  constructor(nessie: NessieLike, tag: string) {
```

- [ ] **Step 3: Run the existing test suites to confirm nothing broke**

Run: `cd server && npm test`
Expected: all existing tests still pass, including `src/adapters/nessie.test.ts` and `src/mirror.test.ts`. No test file changes were needed for this task — `new Nessie(...)` still satisfies `NessieLike` structurally and `fakeNessie()` in `server/src/test/fake-nessie.ts` is still only used to fake `fetch` under a real `Nessie`, unaffected.

- [ ] **Step 4: Commit**

```bash
cd /Users/tringuyen2007/Documents/Projects/LarpCity
git add server/src/adapters/nessie.ts server/src/mirror.ts
git commit -m "refactor: extract NessieLike interface so the mirror can take more than a real Nessie client"
```

---

### Task 2: Local Postgres schema and the `LocalNessie` store

**Files:**
- Modify: `server/src/migrations.sql`
- Create: `server/src/store/local-nessie.ts`
- Test: `server/src/store/local-nessie.db.test.ts`

**Interfaces:**
- Consumes: `Account`, `AccountType`, `Customer`, `MoneyTx` types from `server/src/adapters/nessie.ts` (Task 1, already merged).
- Produces:
  - `export interface LocalCustomer extends Customer { nessieId: string | null }`
  - `export interface LocalAccount extends Account { nessieId: string | null; deleted: boolean }`
  - `export interface LocalTx extends MoneyTx { nessieId: string | null; accountId: string; kind: "deposit" | "withdrawal" }`
  - `export interface LocalNessieLike` (see Step 3 below) — implemented by `LocalNessie` (Step 4) and, in Task 4, by an in-memory test fake.
  - `export class LocalNessie implements LocalNessieLike` — constructed as `new LocalNessie(pool)` where `pool` is a `pg.Pool`.

- [ ] **Step 1: Write the failing test**

Create `server/src/store/local-nessie.db.test.ts`:

```ts
// server/src/store/local-nessie.db.test.ts
// The local Nessie mirror against a real TimescaleDB: same throwaway-database
// pattern as ../runs.db.test.ts. Skipped unless TEST_DATABASE_URL points at a
// server where we may create a database (server/README.md).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { LocalNessie } from "./local-nessie.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const HOUSTON = { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" };

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;
let local: LocalNessie;

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
  local = new LocalNessie(db);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

test("a customer is created with no nessie id, and can be marked synced", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer", address: HOUSTON });
  assert.ok(c._id.startsWith("local-"));
  assert.equal(c.nessieId, null);
  const listed = await local.listCustomers();
  assert.ok(listed.some((x) => x._id === c._id));

  await local.markCustomerSynced(c._id, "real-nessie-id-1");
  const fetched = await local.getCustomer(c._id);
  assert.equal(fetched?.nessieId, "real-nessie-id-1");
  assert.deepEqual(await local.listUnsyncedCustomers(), [], "a synced customer drops out of the unsynced list");
});

test("an account's balance is truncated and a negative balance is rejected", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-2", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 500.9 });
  assert.equal(a.balance, 500, "cents are truncated, matching live Nessie");
  assert.equal(a.nessieId, null);
  await assert.rejects(() => local.insertAccount(c._id, { type: "Savings", nickname: "t:savings", balance: -1 }));
});

test("an account only appears as unsynced once its parent customer has synced", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-3", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.deepEqual(await local.listUnsyncedAccounts(), [], "parent customer isn't synced yet");
  await local.markCustomerSynced(c._id, "real-cust-3");
  const pending = await local.listUnsyncedAccounts();
  assert.ok(pending.some((x) => x._id === a._id));
  await local.markAccountSynced(a._id, "real-acct-3");
  assert.ok(!(await local.listUnsyncedAccounts()).some((x) => x._id === a._id));
});

test("soft-deleting an account hides it from listAccounts and, if it was live, queues a live delete", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-4", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 0 });
  await local.markCustomerSynced(c._id, "real-cust-4");
  await local.markAccountSynced(a._id, "real-acct-4");
  await local.softDeleteAccount(a._id, false);
  assert.deepEqual(await local.listAccounts(c._id), []);
  const pendingDeletes = await local.listUnsyncedDeletes();
  assert.ok(pendingDeletes.some((x) => x._id === a._id));
  await local.markAccountDeleteSynced(a._id);
  assert.ok(!(await local.listUnsyncedDeletes()).some((x) => x._id === a._id));
});

test("deposits and withdrawals are stored per account and kind, and only queued for replay once the account is synced", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-5", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 0 });
  const tx = await local.insertTransaction(a._id, "deposit", { transaction_date: "2026-09-12", status: "completed", amount: 100.4, description: "larpcity|r1|k1|Paycheck" });
  assert.equal(tx.amount, 100, "cents truncated");
  assert.deepEqual(await local.listUnsyncedTransactions(), [], "account isn't synced yet");
  assert.deepEqual((await local.listTransactions(a._id, "deposit")).map((t) => t._id), [tx._id]);
  assert.deepEqual(await local.listTransactions(a._id, "withdrawal"), []);

  await local.markCustomerSynced(c._id, "real-cust-5");
  await local.markAccountSynced(a._id, "real-acct-5");
  assert.ok((await local.listUnsyncedTransactions()).some((t) => t._id === tx._id));
  await local.markTransactionSynced(tx._id, "real-tx-5");
  assert.ok(!(await local.listUnsyncedTransactions()).some((t) => t._id === tx._id));
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```sh
docker run -d --name larp-pg-fallback -e POSTGRES_PASSWORD=larp -p 5434:5432 timescale/timescaledb:latest-pg17
cd server && TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5434/postgres' npm test
```
Expected: FAIL — `Cannot find module './local-nessie.js'` (the file doesn't exist yet).

- [ ] **Step 3: Add the three tables to `server/src/migrations.sql`**

Append to the end of `server/src/migrations.sql`:

```sql
-- Local Nessie fallback (docs/superpowers/specs/2026-09-12-nessie-fallback-design.md). Local ids
-- are permanent; nessie_id is filled in once (and if) a live Nessie call for that row succeeds.

CREATE TABLE IF NOT EXISTS nessie_customers (
  id          text PRIMARY KEY,
  nessie_id   text UNIQUE,
  first_name  text NOT NULL,
  last_name   text NOT NULL UNIQUE,
  address     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nessie_accounts (
  id             text PRIMARY KEY,
  nessie_id      text UNIQUE,
  customer_id    text NOT NULL REFERENCES nessie_customers(id),
  type           text NOT NULL,
  nickname       text NOT NULL,
  rewards        integer NOT NULL DEFAULT 0,
  balance        integer NOT NULL,
  account_number text NOT NULL,
  deleted        boolean NOT NULL DEFAULT false,
  delete_synced  boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nessie_accounts_customer ON nessie_accounts (customer_id);

CREATE TABLE IF NOT EXISTS nessie_transactions (
  id               text PRIMARY KEY,
  nessie_id        text UNIQUE,
  account_id       text NOT NULL REFERENCES nessie_accounts(id),
  kind             text NOT NULL CHECK (kind IN ('deposit','withdrawal')),
  amount           integer NOT NULL,
  transaction_date text NOT NULL,
  status           text NOT NULL,
  description      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nessie_transactions_account ON nessie_transactions (account_id, kind);
```

- [ ] **Step 4: Write `server/src/store/local-nessie.ts`**

```ts
// server/src/store/local-nessie.ts
// The local half of the Nessie fallback (docs/superpowers/specs/2026-09-12-nessie-fallback-design.md):
// a Postgres-backed mirror of every customer/account/transaction the bank mirror has ever created,
// live or local-only. Local ids are permanent; nessieId is filled in once a live Nessie call for
// that row actually succeeds — nothing ever renames or remaps a local id.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Account, AccountType, Customer, MoneyTx } from "../adapters/nessie.js";

export interface LocalCustomer extends Customer {
  nessieId: string | null;
}
export interface LocalAccount extends Account {
  nessieId: string | null;
  deleted: boolean;
}
export interface LocalTx extends MoneyTx {
  nessieId: string | null;
  accountId: string;
  kind: "deposit" | "withdrawal";
}

export interface LocalNessieLike {
  listCustomers(): Promise<LocalCustomer[]>;
  getCustomer(id: string): Promise<LocalCustomer | null>;
  insertCustomer(c: Omit<Customer, "_id">): Promise<LocalCustomer>;
  markCustomerSynced(id: string, nessieId: string): Promise<void>;

  listAccounts(customerId: string): Promise<LocalAccount[]>;
  getAccount(id: string): Promise<LocalAccount | null>;
  insertAccount(customerId: string, a: { type: AccountType; nickname: string; balance: number; rewards?: number }): Promise<LocalAccount>;
  markAccountSynced(id: string, nessieId: string): Promise<void>;
  softDeleteAccount(id: string, deleteSynced: boolean): Promise<void>;
  markAccountDeleteSynced(id: string): Promise<void>;

  insertTransaction(accountId: string, kind: "deposit" | "withdrawal", tx: { transaction_date: string; status: string; amount: number; description: string }): Promise<LocalTx>;
  markTransactionSynced(id: string, nessieId: string): Promise<void>;
  listTransactions(accountId: string, kind: "deposit" | "withdrawal"): Promise<LocalTx[]>;

  listUnsyncedCustomers(): Promise<LocalCustomer[]>;
  listUnsyncedAccounts(): Promise<LocalAccount[]>;
  listUnsyncedDeletes(): Promise<LocalAccount[]>;
  listUnsyncedTransactions(): Promise<LocalTx[]>;
}

const localId = () => `local-${randomUUID()}`;

const CUSTOMER_COLS = `id AS "_id", first_name, last_name, address, nessie_id AS "nessieId"`;
const ACCOUNT_COLS = `id AS "_id", type, nickname, rewards, balance, account_number, customer_id, nessie_id AS "nessieId", deleted`;
const TX_COLS = `id AS "_id", account_id AS "accountId", kind, amount, transaction_date, status, description, nessie_id AS "nessieId"`;

export class LocalNessie implements LocalNessieLike {
  constructor(private readonly db: pg.Pool) {}

  async listCustomers(): Promise<LocalCustomer[]> {
    const { rows } = await this.db.query<LocalCustomer>(`SELECT ${CUSTOMER_COLS} FROM nessie_customers ORDER BY created_at`);
    return rows;
  }

  async getCustomer(id: string): Promise<LocalCustomer | null> {
    const { rows } = await this.db.query<LocalCustomer>(`SELECT ${CUSTOMER_COLS} FROM nessie_customers WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async insertCustomer(c: Omit<Customer, "_id">): Promise<LocalCustomer> {
    const { rows } = await this.db.query<LocalCustomer>(
      `INSERT INTO nessie_customers (id, first_name, last_name, address) VALUES ($1, $2, $3, $4) RETURNING ${CUSTOMER_COLS}`,
      [localId(), c.first_name, c.last_name, JSON.stringify(c.address)],
    );
    return rows[0];
  }

  async markCustomerSynced(id: string, nessieId: string): Promise<void> {
    await this.db.query(`UPDATE nessie_customers SET nessie_id = $2 WHERE id = $1`, [id, nessieId]);
  }

  async listAccounts(customerId: string): Promise<LocalAccount[]> {
    const { rows } = await this.db.query<LocalAccount>(
      `SELECT ${ACCOUNT_COLS} FROM nessie_accounts WHERE customer_id = $1 AND NOT deleted ORDER BY created_at`,
      [customerId],
    );
    return rows;
  }

  async getAccount(id: string): Promise<LocalAccount | null> {
    const { rows } = await this.db.query<LocalAccount>(`SELECT ${ACCOUNT_COLS} FROM nessie_accounts WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async insertAccount(customerId: string, a: { type: AccountType; nickname: string; balance: number; rewards?: number }): Promise<LocalAccount> {
    const balance = Math.trunc(a.balance);
    if (balance < 0) throw new Error("balance must be >= 0");
    const { rows } = await this.db.query<LocalAccount>(
      `INSERT INTO nessie_accounts (id, customer_id, type, nickname, rewards, balance, account_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${ACCOUNT_COLS}`,
      [localId(), customerId, a.type, a.nickname, a.rewards ?? 0, balance, String(1_000_000_000_000_000 + Math.floor(Math.random() * 1e9))],
    );
    return rows[0];
  }

  async markAccountSynced(id: string, nessieId: string): Promise<void> {
    await this.db.query(`UPDATE nessie_accounts SET nessie_id = $2 WHERE id = $1`, [id, nessieId]);
  }

  async softDeleteAccount(id: string, deleteSynced: boolean): Promise<void> {
    await this.db.query(`UPDATE nessie_accounts SET deleted = true, delete_synced = $2 WHERE id = $1`, [id, deleteSynced]);
  }

  async markAccountDeleteSynced(id: string): Promise<void> {
    await this.db.query(`UPDATE nessie_accounts SET delete_synced = true WHERE id = $1`, [id]);
  }

  async insertTransaction(
    accountId: string,
    kind: "deposit" | "withdrawal",
    tx: { transaction_date: string; status: string; amount: number; description: string },
  ): Promise<LocalTx> {
    const { rows } = await this.db.query<LocalTx>(
      `INSERT INTO nessie_transactions (id, account_id, kind, amount, transaction_date, status, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${TX_COLS}`,
      [localId(), accountId, kind, Math.trunc(tx.amount), tx.transaction_date, tx.status, tx.description],
    );
    return rows[0];
  }

  async markTransactionSynced(id: string, nessieId: string): Promise<void> {
    await this.db.query(`UPDATE nessie_transactions SET nessie_id = $2 WHERE id = $1`, [id, nessieId]);
  }

  async listTransactions(accountId: string, kind: "deposit" | "withdrawal"): Promise<LocalTx[]> {
    const { rows } = await this.db.query<LocalTx>(
      `SELECT ${TX_COLS} FROM nessie_transactions WHERE account_id = $1 AND kind = $2 ORDER BY created_at`,
      [accountId, kind],
    );
    return rows;
  }

  async listUnsyncedCustomers(): Promise<LocalCustomer[]> {
    const { rows } = await this.db.query<LocalCustomer>(`SELECT ${CUSTOMER_COLS} FROM nessie_customers WHERE nessie_id IS NULL ORDER BY created_at`);
    return rows;
  }

  async listUnsyncedAccounts(): Promise<LocalAccount[]> {
    const { rows } = await this.db.query<LocalAccount>(
      `SELECT a.id AS "_id", a.type, a.nickname, a.rewards, a.balance, a.account_number, a.customer_id,
              a.nessie_id AS "nessieId", a.deleted
       FROM nessie_accounts a JOIN nessie_customers c ON c.id = a.customer_id
       WHERE a.nessie_id IS NULL AND c.nessie_id IS NOT NULL ORDER BY a.created_at`,
    );
    return rows;
  }

  async listUnsyncedDeletes(): Promise<LocalAccount[]> {
    const { rows } = await this.db.query<LocalAccount>(
      `SELECT ${ACCOUNT_COLS} FROM nessie_accounts WHERE deleted AND NOT delete_synced AND nessie_id IS NOT NULL ORDER BY created_at`,
    );
    return rows;
  }

  async listUnsyncedTransactions(): Promise<LocalTx[]> {
    const { rows } = await this.db.query<LocalTx>(
      `SELECT t.id AS "_id", t.account_id AS "accountId", t.kind, t.amount, t.transaction_date, t.status,
              t.description, t.nessie_id AS "nessieId"
       FROM nessie_transactions t JOIN nessie_accounts a ON a.id = t.account_id
       WHERE t.nessie_id IS NULL AND a.nessie_id IS NOT NULL ORDER BY t.created_at`,
    );
    return rows;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5434/postgres' npm test`
Expected: all 5 new tests in `local-nessie.db.test.ts` PASS, plus the full existing suite still passes.

- [ ] **Step 6: Commit**

```bash
cd /Users/tringuyen2007/Documents/Projects/LarpCity
git add server/src/migrations.sql server/src/store/local-nessie.ts server/src/store/local-nessie.db.test.ts
git commit -m "feat: add Postgres-backed LocalNessie store for the Nessie fallback"
```

---

### Task 3: In-memory `LocalNessieLike` test fake

**Files:**
- Create: `server/src/test/fake-local-nessie.ts`

**Interfaces:**
- Consumes: `LocalNessieLike`, `LocalCustomer`, `LocalAccount`, `LocalTx` from `server/src/store/local-nessie.ts` (Task 2).
- Produces: `export function fakeLocalNessie(): LocalNessieLike & { customers: LocalCustomer[]; accounts: LocalAccount[]; txns: LocalTx[] }` — used by Task 4 and Task 5's tests so `FailoverNessie` and the replay sweep can be tested without a database, the same way `server/src/test/fake-nessie.ts` already lets `mirror.test.ts` run without a database.

This is a test double with no behavior of its own to TDD against; it exists to make Tasks 4 and 5 possible. It's verified indirectly by every test in those tasks passing.

- [ ] **Step 1: Write `server/src/test/fake-local-nessie.ts`**

```ts
// server/src/test/fake-local-nessie.ts
// An in-memory LocalNessieLike, for testing FailoverNessie and the replay sweep without a database.
import type { Account, AccountType, Customer } from "../adapters/nessie.js";
import type { LocalAccount, LocalCustomer, LocalNessieLike, LocalTx } from "../store/local-nessie.js";

export function fakeLocalNessie(): LocalNessieLike & { customers: LocalCustomer[]; accounts: LocalAccount[]; txns: LocalTx[] } {
  const customers: LocalCustomer[] = [];
  const accounts: LocalAccount[] = [];
  const txns: LocalTx[] = [];
  let seq = 0;
  const id = () => `local-${++seq}`;

  return {
    customers,
    accounts,
    txns,

    async listCustomers() {
      return [...customers];
    },
    async getCustomer(id) {
      return customers.find((c) => c._id === id) ?? null;
    },
    async insertCustomer(c: Omit<Customer, "_id">) {
      const created: LocalCustomer = { ...c, _id: id(), nessieId: null };
      customers.push(created);
      return created;
    },
    async markCustomerSynced(localId, nessieId) {
      const c = customers.find((x) => x._id === localId);
      if (c) c.nessieId = nessieId;
    },

    async listAccounts(customerId) {
      return accounts.filter((a) => a.customer_id === customerId && !a.deleted);
    },
    async getAccount(id) {
      return accounts.find((a) => a._id === id) ?? null;
    },
    async insertAccount(customerId, a: { type: AccountType; nickname: string; balance: number; rewards?: number }) {
      if (a.balance < 0) throw new Error("balance must be >= 0");
      const created: LocalAccount = {
        _id: id(),
        type: a.type,
        nickname: a.nickname,
        rewards: a.rewards ?? 0,
        balance: Math.trunc(a.balance),
        account_number: id(),
        customer_id: customerId,
        nessieId: null,
        deleted: false,
      };
      accounts.push(created);
      return created;
    },
    async markAccountSynced(localId, nessieId) {
      const a = accounts.find((x) => x._id === localId);
      if (a) a.nessieId = nessieId;
    },
    async softDeleteAccount(localId, deleteSynced) {
      const a = accounts.find((x) => x._id === localId);
      if (a) {
        a.deleted = true;
        (a as unknown as { deleteSynced: boolean }).deleteSynced = deleteSynced;
      }
    },
    async markAccountDeleteSynced(localId) {
      const a = accounts.find((x) => x._id === localId);
      if (a) (a as unknown as { deleteSynced: boolean }).deleteSynced = true;
    },

    async insertTransaction(accountId, kind, tx) {
      const created: LocalTx = { _id: id(), accountId, kind, medium: "balance", nessieId: null, ...tx, amount: Math.trunc(tx.amount) };
      txns.push(created);
      return created;
    },
    async markTransactionSynced(localId, nessieId) {
      const t = txns.find((x) => x._id === localId);
      if (t) t.nessieId = nessieId;
    },
    async listTransactions(accountId, kind) {
      return txns.filter((t) => t.accountId === accountId && t.kind === kind);
    },

    async listUnsyncedCustomers() {
      return customers.filter((c) => c.nessieId === null);
    },
    async listUnsyncedAccounts() {
      return accounts.filter((a) => a.nessieId === null && customers.find((c) => c._id === a.customer_id)?.nessieId != null);
    },
    async listUnsyncedDeletes() {
      return accounts.filter((a) => a.deleted && a.nessieId != null && !(a as unknown as { deleteSynced?: boolean }).deleteSynced);
    },
    async listUnsyncedTransactions() {
      return txns.filter((t) => t.nessieId === null && accounts.find((a) => a._id === t.accountId)?.nessieId != null);
    },
  };
}
```

Note: `deleteSynced` is tracked as an ad-hoc field on the fake's account objects (cast through `unknown`) rather than added to the `LocalAccount` type, since real `LocalNessie` tracks it purely as a Postgres column (`delete_synced`) that's never read back through the `LocalAccount` shape in Task 2's real implementation either — `listUnsyncedDeletes()` is the only place that needs it, both for the real store (a `WHERE` clause) and this fake (a filter predicate).

- [ ] **Step 2: Sanity-check it compiles and behaves via Task 4/5's tests**

There is no standalone test for this file — Step 4 of Task 4 (below) is what proves it works. Do not write a separate `fake-local-nessie.test.ts`; that would just re-test `FailoverNessie` under a different name.

- [ ] **Step 3: Commit**

```bash
cd /Users/tringuyen2007/Documents/Projects/LarpCity
git add server/src/test/fake-local-nessie.ts
git commit -m "test: add in-memory LocalNessieLike fake for fallback/replay tests"
```

---

### Task 4: `FailoverNessie` — the transparent decorator

**Files:**
- Create: `server/src/adapters/failover-nessie.ts`
- Test: `server/src/adapters/failover-nessie.test.ts`

**Interfaces:**
- Consumes: `NessieLike`, `NewTx` from `server/src/adapters/nessie.ts` (Task 1); `LocalNessieLike` from `server/src/store/local-nessie.ts` (Task 2); `fakeLocalNessie` from `server/src/test/fake-local-nessie.ts` (Task 3).
- Produces: `export class FailoverNessie implements NessieLike`, constructed as `new FailoverNessie(live, local)` where `live: NessieLike` and `local: LocalNessieLike`. This is what `routes/nessie.ts` will construct `MirrorService` with in Task 6.

- [ ] **Step 1: Write the failing test**

Create `server/src/adapters/failover-nessie.test.ts`:

```ts
// server/src/adapters/failover-nessie.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account, Customer, MoneyTx, NessieLike, NewTx } from "./nessie.js";
import { FailoverNessie } from "./failover-nessie.js";
import { fakeLocalNessie } from "../test/fake-local-nessie.js";

const HOUSTON = { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" };

/** A fake live Nessie that can be told to fail, and mints ids prefixed "live-" so they're easy to spot in assertions. */
function fakeLive(opts: { up?: boolean } = {}): NessieLike & { calls: string[] } {
  let up = opts.up ?? true;
  let seq = 0;
  const id = () => `live-${++seq}`;
  const guard = () => {
    if (!up) throw new Error("nessie is down");
  };
  const calls: string[] = [];
  return {
    calls,
    set up(v: boolean) {
      up = v;
    },
    async listCustomers() {
      calls.push("listCustomers");
      guard();
      return [];
    },
    async createCustomer(c: Omit<Customer, "_id">) {
      calls.push("createCustomer");
      guard();
      return { ...c, _id: id() };
    },
    async listAccounts() {
      calls.push("listAccounts");
      guard();
      return [];
    },
    async createAccount(customerId: string, a) {
      calls.push("createAccount");
      guard();
      return { ...a, rewards: a.rewards ?? 0, _id: id(), account_number: id(), customer_id: customerId } as Account;
    },
    async deleteAccount() {
      calls.push("deleteAccount");
      guard();
    },
    async deposit(_accountId: string, tx: NewTx) {
      calls.push("deposit");
      guard();
      return { ...tx, _id: id(), medium: "balance" } as MoneyTx;
    },
    async withdraw(_accountId: string, tx: NewTx) {
      calls.push("withdraw");
      guard();
      return { ...tx, _id: id(), medium: "balance" } as MoneyTx;
    },
    async listDeposits() {
      calls.push("listDeposits");
      guard();
      return [];
    },
    async listWithdrawals() {
      calls.push("listWithdrawals");
      guard();
      return [];
    },
  } as NessieLike & { up: boolean; calls: string[] };
}

test("when live Nessie is up, writes sync immediately and get a nessieId", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);

  const customer = await failover.createCustomer({ first_name: "Test", last_name: "up-customer", address: HOUSTON });
  assert.equal(local.customers[0].nessieId, "live-1", "shadow-written to local with the live id recorded");

  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.equal(local.accounts[0].nessieId, "live-2");

  const tx = await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 50, description: "d1" });
  assert.equal(local.txns[0].nessieId, "live-3");
  assert.equal(tx._id, local.txns[0]._id, "returns the local row");
});

test("when live Nessie is down, writes still succeed locally and stay unsynced", async () => {
  const live = fakeLive({ up: false });
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);

  const customer = await failover.createCustomer({ first_name: "Test", last_name: "down-customer", address: HOUSTON });
  assert.ok(customer._id.startsWith("local-"));
  assert.equal(local.customers[0].nessieId, null);

  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.equal(local.accounts[0].nessieId, null);

  await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 50, description: "d1" });
  assert.equal(local.txns[0].nessieId, null);

  const listed = await failover.listAccounts(customer._id);
  assert.equal(listed.length, 1, "reads come from local, so the fallback account is still visible");
});

test("an account creation is not even attempted against live until its parent customer has synced", async () => {
  const live = fakeLive({ up: false });
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);

  const customer = await failover.createCustomer({ first_name: "Test", last_name: "unsynced-parent", address: HOUSTON });
  await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });

  assert.deepEqual(live.calls, ["createCustomer"], "createAccount never called live, since the customer never synced");
});

test("a deposit is not attempted against live until its account has synced", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);
  const customer = await failover.createCustomer({ first_name: "Test", last_name: "deposit-parent-test", address: HOUSTON });
  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.ok(local.accounts[0].nessieId, "account synced live in this test");

  live.up = false;
  await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 10, description: "d" });
  assert.equal(local.txns[0].nessieId, null, "the deposit attempt failed live and stayed local-only");
});

test("deleteAccount soft-deletes locally and, if the account was live, tries a live delete too", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);
  const customer = await failover.createCustomer({ first_name: "Test", last_name: "delete-test", address: HOUSTON });
  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });

  await failover.deleteAccount(account._id);
  assert.deepEqual(await failover.listAccounts(customer._id), [], "deleted accounts drop out of listAccounts");
  assert.ok(live.calls.includes("deleteAccount"), "a live-synced account gets a live delete attempt");
});

test("listCustomers, listDeposits, and listWithdrawals never call live", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);
  const customer = await failover.createCustomer({ first_name: "Test", last_name: "read-only-test", address: HOUSTON });
  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 10, description: "d" });
  live.calls.length = 0;

  await failover.listCustomers();
  await failover.listDeposits(account._id);
  await failover.listWithdrawals(account._id);
  assert.deepEqual(live.calls, [], "all three reads were served from local");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './failover-nessie.js'`.

- [ ] **Step 3: Write `server/src/adapters/failover-nessie.ts`**

```ts
// server/src/adapters/failover-nessie.ts
// Sits between MirrorService and live Nessie (docs/superpowers/specs/2026-09-12-nessie-fallback-design.md):
// every write tries live first and falls back to the local mirror on failure; every read comes
// from local only, since local shadow-copies every successful live write too. No circuit breaker,
// no manual toggle — each call independently decides, every time.
import type { LocalNessieLike } from "../store/local-nessie.js";
import type { Account, AccountType, Customer, MoneyTx, NessieLike, NewTx } from "./nessie.js";

export class FailoverNessie implements NessieLike {
  constructor(
    private readonly live: NessieLike,
    private readonly local: LocalNessieLike,
  ) {}

  async listCustomers(): Promise<Customer[]> {
    return this.local.listCustomers();
  }

  async createCustomer(c: Omit<Customer, "_id">): Promise<Customer> {
    const created = await this.local.insertCustomer(c);
    try {
      const live = await this.live.createCustomer(c);
      await this.local.markCustomerSynced(created._id, live._id);
    } catch {
      // stays local-only; the replay sweep will retry once live recovers
    }
    return created;
  }

  async listAccounts(customerId: string): Promise<Account[]> {
    return this.local.listAccounts(customerId);
  }

  async createAccount(
    customerId: string,
    a: { type: AccountType; nickname: string; balance: number; rewards?: number },
  ): Promise<Account> {
    const created = await this.local.insertAccount(customerId, a);
    const customer = await this.local.getCustomer(customerId);
    if (customer?.nessieId) {
      try {
        const live = await this.live.createAccount(customer.nessieId, a);
        await this.local.markAccountSynced(created._id, live._id);
      } catch {
        // stays local-only
      }
    }
    return created;
  }

  async deleteAccount(id: string): Promise<void> {
    const account = await this.local.getAccount(id);
    if (!account) return;
    const deleteSynced = !account.nessieId; // nothing live to delete if it never synced
    await this.local.softDeleteAccount(id, deleteSynced);
    if (account.nessieId) {
      try {
        await this.live.deleteAccount(account.nessieId);
        await this.local.markAccountDeleteSynced(id);
      } catch {
        // delete_synced stays false; the replay sweep retries
      }
    }
  }

  async deposit(accountId: string, tx: NewTx): Promise<MoneyTx> {
    return this.postTx(accountId, "deposit", tx);
  }

  async withdraw(accountId: string, tx: NewTx): Promise<MoneyTx> {
    return this.postTx(accountId, "withdrawal", tx);
  }

  private async postTx(accountId: string, kind: "deposit" | "withdrawal", tx: NewTx): Promise<MoneyTx> {
    const entry = { transaction_date: tx.transaction_date, status: tx.status, amount: tx.amount, description: tx.description };
    const created = await this.local.insertTransaction(accountId, kind, entry);
    const account = await this.local.getAccount(accountId);
    if (account?.nessieId) {
      try {
        const live = kind === "deposit" ? await this.live.deposit(account.nessieId, tx) : await this.live.withdraw(account.nessieId, tx);
        await this.local.markTransactionSynced(created._id, live._id);
      } catch {
        // stays local-only
      }
    }
    return created;
  }

  async listDeposits(accountId: string): Promise<MoneyTx[]> {
    return this.local.listTransactions(accountId, "deposit");
  }

  async listWithdrawals(accountId: string): Promise<MoneyTx[]> {
    return this.local.listTransactions(accountId, "withdrawal");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: all 6 new tests in `failover-nessie.test.ts` PASS, plus the full existing suite (Tasks 1-3's tests included) still passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/tringuyen2007/Documents/Projects/LarpCity
git add server/src/adapters/failover-nessie.ts server/src/adapters/failover-nessie.test.ts
git commit -m "feat: add FailoverNessie, the live-then-local decorator for the bank mirror"
```

---

### Task 5: The replay sweep

**Files:**
- Create: `server/src/replay.ts`
- Test: `server/src/replay.test.ts`

**Interfaces:**
- Consumes: `NessieLike` from `server/src/adapters/nessie.ts`; `LocalNessieLike` from `server/src/store/local-nessie.ts`; `fakeLocalNessie` from `server/src/test/fake-local-nessie.ts`; `logger` from `server/src/logger.ts`.
- Produces: `export async function replayOnce(live: NessieLike, local: LocalNessieLike): Promise<void>` and `export function startReplaySweep(live: NessieLike, local: LocalNessieLike, intervalMs?: number): () => void` (the returned function stops the sweep — used by tests and, if ever needed, graceful shutdown). `routes/nessie.ts` (Task 6) calls `startReplaySweep`.

- [ ] **Step 1: Write the failing test**

Create `server/src/replay.test.ts`:

```ts
// server/src/replay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account, Customer, MoneyTx, NessieLike, NewTx } from "./adapters/nessie.js";
import { fakeLocalNessie } from "./test/fake-local-nessie.js";
import { replayOnce } from "./replay.js";

const HOUSTON = { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" };

function fakeLive(opts: { up?: boolean } = {}): NessieLike & { up: boolean; calls: string[] } {
  let seq = 0;
  const id = () => `live-${++seq}`;
  const calls: string[] = [];
  const state = { up: opts.up ?? true };
  const guard = () => {
    if (!state.up) throw new Error("nessie is down");
  };
  return {
    get up() {
      return state.up;
    },
    set up(v: boolean) {
      state.up = v;
    },
    calls,
    async listCustomers() {
      return [];
    },
    async createCustomer(c: Omit<Customer, "_id">) {
      calls.push("createCustomer");
      guard();
      return { ...c, _id: id() };
    },
    async listAccounts() {
      return [];
    },
    async createAccount(customerId: string, a) {
      calls.push("createAccount");
      guard();
      return { ...a, rewards: a.rewards ?? 0, _id: id(), account_number: id(), customer_id: customerId } as Account;
    },
    async deleteAccount() {
      calls.push("deleteAccount");
      guard();
    },
    async deposit(_accountId: string, tx: NewTx) {
      calls.push("deposit");
      guard();
      return { ...tx, _id: id(), medium: "balance" } as MoneyTx;
    },
    async withdraw(_accountId: string, tx: NewTx) {
      calls.push("withdraw");
      guard();
      return { ...tx, _id: id(), medium: "balance" } as MoneyTx;
    },
    async listDeposits() {
      return [];
    },
    async listWithdrawals() {
      return [];
    },
  } as NessieLike & { up: boolean; calls: string[] };
}

test("replayOnce syncs an unsynced customer, then its account, then its transaction, in that order", async () => {
  const local = fakeLocalNessie();
  const c = await local.insertCustomer({ first_name: "Test", last_name: "replay-customer", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  await local.insertTransaction(a._id, "deposit", { transaction_date: "2026-09-12", status: "completed", amount: 50, description: "d1" });

  const live = fakeLive();
  await replayOnce(live, local);

  assert.ok((await local.getCustomer(c._id))?.nessieId, "customer synced");
  assert.ok((await local.getAccount(a._id))?.nessieId, "account synced");
  assert.deepEqual(await local.listUnsyncedTransactions(), [], "transaction synced");
  assert.deepEqual(live.calls, ["createCustomer", "createAccount", "deposit"], "replay follows parent-before-child order");
});

test("replayOnce stops at the first failure in a sweep and leaves the rest for next tick", async () => {
  const local = fakeLocalNessie();
  const c1 = await local.insertCustomer({ first_name: "Test", last_name: "replay-fail-1", address: HOUSTON });
  const c2 = await local.insertCustomer({ first_name: "Test", last_name: "replay-fail-2", address: HOUSTON });

  const live = fakeLive({ up: false });
  await replayOnce(live, local);

  assert.equal((await local.getCustomer(c1._id))?.nessieId, null);
  assert.equal((await local.getCustomer(c2._id))?.nessieId, null);
  assert.equal(live.calls.length, 1, "only the first attempt was made before the sweep gave up for this tick");
});

test("replayOnce syncs a queued account delete once its account is live", async () => {
  const local = fakeLocalNessie();
  const c = await local.insertCustomer({ first_name: "Test", last_name: "replay-delete", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 0 });
  await local.markCustomerSynced(c._id, "real-c");
  await local.markAccountSynced(a._id, "real-a");
  await local.softDeleteAccount(a._id, false);

  const live = fakeLive();
  await replayOnce(live, local);

  assert.deepEqual(await local.listUnsyncedDeletes(), []);
  assert.ok(live.calls.includes("deleteAccount"));
});

test("a second replayOnce call after live recovers finishes what the first left pending", async () => {
  const local = fakeLocalNessie();
  const c = await local.insertCustomer({ first_name: "Test", last_name: "replay-recovers", address: HOUSTON });
  await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 10 });

  const live = fakeLive({ up: false });
  await replayOnce(live, local);
  assert.equal((await local.getCustomer(c._id))?.nessieId, null, "still down on the first tick");

  live.up = true;
  await replayOnce(live, local);
  assert.ok((await local.getCustomer(c._id))?.nessieId, "synced once live recovered");
  assert.ok((await local.listUnsyncedAccounts()).length === 0, "the account synced too, same tick, since its parent just synced");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './replay.js'`.

- [ ] **Step 3: Write `server/src/replay.ts`**

```ts
// server/src/replay.ts
// Periodically pushes anything the Nessie fallback (adapters/failover-nessie.ts) could only write
// locally back into live Nessie, once it's reachable again. Stops at the first failure in a sweep:
// if live Nessie is still down, every later attempt in that tick would fail too, so there's no
// point spending the retry/backoff time confirming that repeatedly before the next tick.
import type { NessieLike } from "./adapters/nessie.js";
import { logger } from "./logger.js";
import type { LocalNessieLike } from "./store/local-nessie.js";

export async function replayOnce(live: NessieLike, local: LocalNessieLike): Promise<void> {
  for (const c of await local.listUnsyncedCustomers()) {
    try {
      const created = await live.createCustomer({ first_name: c.first_name, last_name: c.last_name, address: c.address });
      await local.markCustomerSynced(c._id, created._id);
    } catch {
      return;
    }
  }

  for (const a of await local.listUnsyncedAccounts()) {
    const customer = await local.getCustomer(a.customer_id);
    if (!customer?.nessieId) continue; // parent didn't sync this tick after all; try again next tick
    try {
      const created = await live.createAccount(customer.nessieId, { type: a.type, nickname: a.nickname, balance: a.balance, rewards: a.rewards });
      await local.markAccountSynced(a._id, created._id);
    } catch {
      return;
    }
  }

  for (const a of await local.listUnsyncedDeletes()) {
    try {
      await live.deleteAccount(a.nessieId!);
      await local.markAccountDeleteSynced(a._id);
    } catch {
      return;
    }
  }

  for (const t of await local.listUnsyncedTransactions()) {
    const account = await local.getAccount(t.accountId);
    if (!account?.nessieId) continue;
    try {
      const entry = { transaction_date: t.transaction_date, status: t.status, amount: t.amount, description: t.description };
      const created = t.kind === "deposit" ? await live.deposit(account.nessieId, entry) : await live.withdraw(account.nessieId, entry);
      await local.markTransactionSynced(t._id, created._id);
    } catch {
      return;
    }
  }
}

/** Starts the periodic sweep; call the returned function to stop it (tests, graceful shutdown). */
export function startReplaySweep(live: NessieLike, local: LocalNessieLike, intervalMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    replayOnce(live, local)
      .catch((err: unknown) => logger.error({ err }, "nessie replay sweep failed"))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: all 4 new tests in `replay.test.ts` PASS, plus the full existing suite still passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/tringuyen2007/Documents/Projects/LarpCity
git add server/src/replay.ts server/src/replay.test.ts
git commit -m "feat: add the periodic replay sweep that catches live Nessie back up after an outage"
```

---

### Task 6: Wire it into `routes/nessie.ts`

**Files:**
- Modify: `server/src/routes/nessie.ts`

**Interfaces:**
- Consumes: `LocalNessie` (Task 2), `FailoverNessie` (Task 4), `startReplaySweep` (Task 5), the existing `pool` export from `server/src/db.ts`.
- Produces: nothing new — `export const mirror` keeps its existing type (`MirrorService`), and every existing route in this file is unchanged. This task only changes what `mirror` is constructed with.

This is a composition-only change: no new logic, so there's no new unit test to write. It's verified with the existing test suite (nothing regresses) plus a manual smoke test against a local database, since this is the one place that wires real Postgres, a real (or down) Nessie, and the HTTP layer together end-to-end.

- [ ] **Step 1: Update the imports and the `mirror` construction in `server/src/routes/nessie.ts`**

Change:

```ts
import { Router, type Request } from "express";
import { Nessie, NessieError } from "../adapters/nessie.js";
import { env } from "../env.js";
import { handle, HttpError, parse, type ErrorMap } from "../http.js";
import { ENTITY, entriesBody, MirrorService, openBody } from "../mirror.js";

export const nessieRouter = Router();

export const mirror = new MirrorService(new Nessie({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY }), env.NESSIE_TAG);
```

to:

```ts
import { Router, type Request } from "express";
import { FailoverNessie } from "../adapters/failover-nessie.js";
import { Nessie, NessieError } from "../adapters/nessie.js";
import { pool } from "../db.js";
import { env } from "../env.js";
import { handle, HttpError, parse, type ErrorMap } from "../http.js";
import { ENTITY, entriesBody, MirrorService, openBody } from "../mirror.js";
import { startReplaySweep } from "../replay.js";
import { LocalNessie } from "../store/local-nessie.js";

export const nessieRouter = Router();

const liveNessie = new Nessie({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY });
const localNessie = new LocalNessie(pool);
const failoverNessie = new FailoverNessie(liveNessie, localNessie);
startReplaySweep(liveNessie, localNessie);

export const mirror = new MirrorService(failoverNessie, env.NESSIE_TAG);
```

Every route below this in the file (`GET /status`, `POST /:entity/open`, `POST /:entity/entries`, `GET /:entity`) is unchanged — they all call `mirror.*`, which now happens to be backed by `FailoverNessie` instead of a raw `Nessie`.

Note: `nessieDown` (the `ErrorMap` at line 25 mapping a `NessieError` to a 502) now only fires if `FailoverNessie` itself throws a `NessieError` — which it doesn't, since it always falls back to local instead of throwing. It's left in place unchanged: if `LocalNessie`/Postgres throws (out of scope per this plan's Global Constraints), that's some other error type and falls through to the existing unhandled-error path (a 500), which is the correct behavior for a Postgres outage.

- [ ] **Step 2: Run the full test suite**

Run: `cd server && npm test`
Expected: all tests across every task still pass. `mirror.test.ts` is unaffected since it constructs its own `MirrorService` directly with a fake `Nessie`, not through `routes/nessie.ts`.

- [ ] **Step 3: Manual smoke test against a local database**

```sh
docker run -d --name larp-pg-smoke -e POSTGRES_PASSWORD=larp -p 5435:5432 timescale/timescaledb:latest-pg17
PGPASSWORD=larp psql -h 127.0.0.1 -p 5435 -U postgres -f game/db/schema.sql
```

In the repo-root `.env`, temporarily point `DATABASE_URL` at `postgres://postgres:larp@127.0.0.1:5435/postgres?sslmode=disable` and set `NESSIE_BASE_URL` to an address that will refuse the connection (proving the fallback, since live Nessie is down as of this writing anyway) — e.g. `http://127.0.0.1:9/`. Then:

```sh
cd server && npm run dev
```

In another terminal:

```sh
curl -s http://127.0.0.1:3000/api/bank/status
# Expected: {"ok":true,"customers":0}  — no 502, even though NESSIE_BASE_URL is unreachable

curl -s -X POST http://127.0.0.1:3000/api/bank/player/open \
  -H 'Content-Type: application/json' -H 'Cookie: <a session cookie from any earlier request to this server>' \
  -d '{"run":"smoke1","opening":{"checking":1200,"savings":2500,"credit":7000}}'
# Expected: 200 {"run":"smoke1","reused":0,"balances":{"checking":1200,"savings":2500,"credit":7000}}

curl -s -X POST http://127.0.0.1:3000/api/bank/player/entries \
  -H 'Content-Type: application/json' -H 'Cookie: <same session cookie>' \
  -d '{"run":"smoke1","entries":[{"key":"m1:checking:paycheck","account":"checking","kind":"deposit","amount":2450,"date":"2026-09-12","memo":"Paycheck"}]}'
# Expected: 200 {"posted":1,"skipped":0,"balances":{"checking":3650,"savings":2500,"credit":7000}}

curl -s http://127.0.0.1:3000/api/bank/player
# Expected: 200, a statement showing the checking account's opening 1200 plus the 2450 deposit,
# with the account/transaction ids all starting with "local-" (visible in the response), confirming
# the fallback — not live Nessie — served every one of these calls.
```

Restore `.env` to its real `NESSIE_BASE_URL`/`DATABASE_URL` values afterward, and `docker rm -f larp-pg-smoke larp-pg-fallback larp-pg-test 2>/dev/null` (or whatever names Task 2/6's throwaway containers ended up with) to clean up.

- [ ] **Step 4: Commit**

```bash
cd /Users/tringuyen2007/Documents/Projects/LarpCity
git add server/src/routes/nessie.ts
git commit -m "feat: wire the Nessie fallback into the bank mirror routes"
```

---

## Summary of new/changed files

| File | Change |
|---|---|
| `server/src/adapters/nessie.ts` | + `NessieLike` interface, export `NewTx`, `Nessie implements NessieLike` |
| `server/src/mirror.ts` | type-only: depends on `NessieLike` instead of `Nessie` |
| `server/src/migrations.sql` | + `nessie_customers`, `nessie_accounts`, `nessie_transactions` |
| `server/src/store/local-nessie.ts` | new: `LocalNessie`, `LocalNessieLike` |
| `server/src/store/local-nessie.db.test.ts` | new, DB-gated |
| `server/src/test/fake-local-nessie.ts` | new test double |
| `server/src/adapters/failover-nessie.ts` | new: `FailoverNessie` |
| `server/src/adapters/failover-nessie.test.ts` | new |
| `server/src/replay.ts` | new: `replayOnce`, `startReplaySweep` |
| `server/src/replay.test.ts` | new |
| `server/src/routes/nessie.ts` | construction wiring only |
