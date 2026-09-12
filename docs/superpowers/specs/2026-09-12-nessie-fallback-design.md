# Nessie Local Fallback — Design Spec

Date: 2026-09-12
Status: Approved for implementation
Branch: `NessieFallBack`

## Problem

The bank mirror (`server/src/mirror.ts`, exposed at `/api/bank/*` in `server/src/routes/nessie.ts`)
depends entirely on Capital One's Nessie sandbox (`api.nessieisreal.com`) being reachable. Nessie is
an unmaintained hackathon API with no SLA and no status page — live testing on 2026-09-12 found it
healthy at that moment, but it has no published uptime guarantee, and it is down as of this writing.
When it is unreachable, every `/api/bank/*` route currently fails with `502 nessie_unavailable`
(`routes/nessie.ts`'s `nessieDown` error map), taking the in-game Bank app down with it, even though
the game's own financial simulation (the actual source of truth, per `SETUP.md`: "Nessie is a
transaction log, not a ledger") is completely unaffected.

This spec adds a local, Postgres-backed fallback so the bank mirror keeps working when Nessie is
down, and automatically catches Nessie back up once it's reachable again — without changing what
the mirror is for or how the rest of the app talks to it.

## Scope

Covers exactly the Nessie surface `MirrorService` uses today — nothing more:
`listCustomers`, `createCustomer`, `listAccounts`, `createAccount`, `deleteAccount`, `deposit`,
`withdraw`, `listDeposits`, `listWithdrawals`. The unused parts of `adapters/nessie.ts`
(`transfer`, `createBill`, `createLoan`, `renameAccount`, `listTransfers`, `listBills`) are out of
scope — nothing calls them, so nothing needs a fallback for them.

Out of scope: Postgres itself becoming unavailable. It is already a hard dependency for the whole
app (`server/src/db.ts`, snapshots, history, leaderboard); this feature does not add resilience
against that and does not attempt to.

## Decisions locked in during brainstorming

- **Failover trigger:** automatic, per call, no circuit breaker and no manual toggle. Every write
  is tried against live Nessie fresh, every time; there is no "stay in fallback mode for N minutes"
  state.
- **Storage:** Postgres (the existing Tiger Data instance via `server/src/db.ts`), not in-memory
  and not a second storage engine. Durable across server restarts.
- **Reconciliation:** anything created only locally while Nessie was down is auto-replayed into
  live Nessie once it starts accepting calls again, via a periodic sweep.
- **API contract:** fully transparent. `/api/bank/*` responses are byte-identical whether backed by
  live Nessie or the local fallback — no `live: false` flag, no visible signal to the frontend.
- **No ID remapping.** Local ids are canonical and permanent for the lifetime of an object; a
  `nessie_id` column records the real Nessie id once (and if) a live call for that object succeeds.
  `mirror.ts` never has to notice that an object it's holding a reference to grew a live
  counterpart later.

## Architecture

```
MirrorService (mirror.ts, unchanged)
        │  depends on a NessieLike interface (the 9 methods above)
        ▼
FailoverNessie (new: server/src/adapters/failover-nessie.ts)
   ├─ every write: insert into Postgres first (always succeeds or the request fails loudly),
   │               then attempt the same call against live Nessie, recording nessie_id on success
   └─ every read: served from Postgres only — it is a complete mirror of everything this app
                  has ever created, live or local-only, so there is no reason to also call live
        │                                            ▲
        ▼                                            │
   live Nessie (adapters/nessie.ts, UNCHANGED)   LocalNessie (new: server/src/store/local-nessie.ts)
                                                       │
                                              replay sweep (new: server/src/replay.ts)
                                              every 60s: pushes any row with nessie_id IS NULL
                                              into live Nessie, oldest first, stops at first
                                              failure (retries next tick)
```

`adapters/nessie.ts` and `mirror.ts` keep their current responsibilities untouched:
`adapters/nessie.ts` is still the only thing that knows Nessie's HTTP shape and quirks;
`mirror.ts` is still the only thing that knows how a game month becomes bank entries. The new
pieces sit strictly between them.

**Type change required (the only edit to an existing file's contract):** `mirror.ts` currently
types its dependency as the concrete `Nessie` class. It changes to a `NessieLike` interface (the
same 9 method signatures, extracted from `Nessie`), so `MirrorService` can be constructed with a
`Nessie`, a `LocalNessie`, or a `FailoverNessie` interchangeably. This is a type-only change with
no behavior difference for `mirror.ts` itself.

**Behavioral improvement, called out explicitly:** `mirror.status()` (backing `GET
/api/bank/status`, which today the game uses to decide whether to turn the mirror on at all) stops
502ing when Nessie is down, because its `listCustomers()` call now always resolves from Postgres.
This is intentional and desired — "is the bank mirror available" and "is live Nessie reachable"
were conflated before; after this change the former is true whenever Postgres is up, which is the
whole point of building a fallback.

## Data model

Three new tables in `server/src/migrations.sql` (additive only, matching that file's existing
`CREATE TABLE IF NOT EXISTS` convention; verified no naming collision and no foreign-key
relationship to `players`, `runs`, `events`, or `player_snapshots` — this module correlates to game
sessions purely through the `tag:entity:session:run:kind` nickname/description scheme
`mirror.ts` already uses, the same way it does against live Nessie today).

```sql
CREATE TABLE IF NOT EXISTS nessie_customers (
  id          text PRIMARY KEY,        -- "local-<uuid>", assigned once, permanent
  nessie_id   text UNIQUE,             -- real Nessie _id once synced; NULL = not yet live
  first_name  text NOT NULL,
  last_name   text NOT NULL UNIQUE,    -- mirror.ts already keys its customer map by last_name
  address     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nessie_accounts (
  id             text PRIMARY KEY,
  nessie_id      text UNIQUE,
  customer_id    text NOT NULL REFERENCES nessie_customers(id),
  type           text NOT NULL,        -- "Checking" | "Savings" | "Credit Card"
  nickname       text NOT NULL,
  balance        integer NOT NULL,     -- opening balance, truncated dollars (matches live Nessie)
  account_number text NOT NULL,
  deleted        boolean NOT NULL DEFAULT false,
  delete_synced  boolean NOT NULL DEFAULT true,  -- false = soft-deleted locally, live delete owed
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
  description      text NOT NULL,      -- carries mirror.ts's tag|run|key|memo, same as live
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nessie_transactions_account ON nessie_transactions (account_id, kind);
```

| MirrorService call | FailoverNessie behavior |
|---|---|
| `createCustomer(c)` | Insert into `nessie_customers` (mints local id). Try live create; on success set `nessie_id`. On failure the row simply keeps `nessie_id = NULL` — that state *is* "pending replay," no separate flag. |
| `listCustomers()` | Always reads `nessie_customers` — no live call. |
| `createAccount(customerId, a)` | Same pattern; only attempts live if the parent customer already has a `nessie_id`. |
| `listAccounts(customerId)` | Reads `nessie_accounts WHERE customer_id = ... AND NOT deleted`. |
| `deposit`/`withdraw` | Local insert always; attempts live only if the account's `nessie_id` is set. |
| `listDeposits`/`listWithdrawals` | Reads `nessie_transactions` filtered by account + kind. |
| `deleteAccount(id)` | Soft-delete locally; if `nessie_id` is set, also attempts live delete, recording the outcome in `delete_synced`. |

## Error handling

Every write follows the same shape:

```
async createAccount(customerId, a):
  local = await localDb.insertAccount(customerId, a)      // always durable, or the request fails loudly
  if !local.customer.nessie_id: return local                // parent not live yet — nothing to attempt
  try:
    live_result = await live.createAccount(local.customer.nessie_id, a)
    await localDb.setNessieId('accounts', local.id, live_result._id)
  catch (NessieError | network error):
    // already fell back — the row's nessie_id just stays NULL
  return local
```

- `adapters/nessie.ts` is unmodified: its own retry logic (2 retries with backoff for
  throttling/5xx on non-POST calls) still runs first. "Live failed" means the call *and* its
  built-in retries all failed — so an outage adds some latency to writes before falling back
  (existing property of the adapter, not new), it does not fail instantly.
- Only `NessieError` and network failures (already wrapped as `NessieError(502, ...)` by the
  adapter) are treated as "fall back." Nothing else is swallowed.
- If `localDb` itself throws (Postgres down), that propagates unchanged through `mirror.ts`'s
  existing error path — no new failure mode, matches the explicitly out-of-scope item above.
- Reads never touch live Nessie, so there is no read-path error handling to add.

## Replay sweep

`server/src/replay.ts`, started once alongside `mirror` in `routes/nessie.ts`:

```
every 60s (skip if a previous sweep is still running):
  for each customer where nessie_id IS NULL, oldest first:
    try live.createCustomer(...) -> set nessie_id; on failure, stop this sweep (retry next tick)
  for each account where nessie_id IS NULL AND parent.nessie_id IS NOT NULL:
    try live.createAccount(parent.nessie_id, ...) -> set nessie_id; on failure, stop
  for each account where deleted AND NOT delete_synced AND nessie_id IS NOT NULL:
    try live.deleteAccount(nessie_id) -> set delete_synced = true
  for each transaction where nessie_id IS NULL AND parent.nessie_id IS NOT NULL, oldest first:
    try live.deposit/withdraw(parent.nessie_id, ...) -> set nessie_id; on failure, stop
```

Stopping at the first failure in a tick is deliberate: if Nessie is still down, every later attempt
in that same tick would fail too, so there's no point spending the retry/backoff time on each one —
the sweep just tries the whole thing again in 60s. Because nothing else in the codebase reacts to
when `nessie_id` gets filled in (it's a pure background side effect), the sweep can die and resume
at any point without needing to track its own progress separately from the table state.

## Testing

Follows the existing patterns already in the repo:

- `server/src/store/local-nessie.ts` gets a DB-backed test, same shape as
  `server/src/store/runs.db.test.ts`.
- `server/src/adapters/failover-nessie.ts` gets a unit test using an injected fake `live` client
  (same style as `server/src/test/fake-nessie.ts`'s `fetchFn` injection into `Nessie`, but here
  injecting a fake `NessieLike` directly) to simulate: live always up, live always down, live down
  then recovering mid-test (to exercise the replay sweep), and a partial failure (customer synced,
  account creation fails).
- `server/src/mirror.test.ts` is unaffected — `MirrorService` is tested against a fake `NessieLike`
  already and does not need to know a fallback exists.
- `server/src/replay.test.ts` (new): seeds `nessie_id IS NULL` rows directly, runs one sweep tick
  against a fake live client, asserts the right rows got a `nessie_id` and the right ones were left
  alone (parent-not-synced-yet cases).

## What this spec explicitly does not do

- Does not change `game/src/sim/mirror/**` (how the game turns a month into entries) at all.
- Does not add a circuit breaker, health-check poller, or manual override toggle.
- Does not add resilience against Postgres itself being down.
- Does not implement fallback for Nessie methods `MirrorService` doesn't call.
- Does not expose fallback/live status to the frontend or change the `/api/bank/*` response shape.
