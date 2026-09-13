-- server/src/migrations.sql
-- Additive only: never drops or renames a column from game/db/schema.sql.
-- Safe to run on every boot against the already-provisioned Tiger Data instance.

ALTER TABLE players ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_customer_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_checking_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_savings_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_credit_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS backboard_assistant_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS backboard_thread_id text;

-- Run data (src/store/runs.ts). Statements run one at a time (src/sql.ts): TimescaleDB won't create a
-- continuous aggregate inside a transaction.

-- Events carry the game's own key (day:sequence), so a retried batch never inserts one twice.
ALTER TABLE events ADD COLUMN IF NOT EXISTS key text;
CREATE UNIQUE INDEX IF NOT EXISTS events_key ON events (run_id, ts, key);

-- Net worth by week and by month across all runs, for analytics. A single run's history
-- (store/runs.ts) buckets its own rows with the same expressions instead: every run starts at
-- 2000-01-01, so once a long run is materialized, the watermark is past a newer run's days and
-- real-time aggregation would leave them out until the next refresh.
CREATE MATERIALIZED VIEW IF NOT EXISTS player_snapshots_weekly
  WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
  SELECT time_bucket('7 days', ts) AS bucket, run_id,
         min(day) AS first_day, max(day) AS last_day,
         last(net_worth, ts) AS net_worth, max(net_worth) AS peak, min(net_worth) AS low,
         last(checking, ts) AS checking, last(savings, ts) AS savings, last(brokerage, ts) AS brokerage,
         last(retirement, ts) AS retirement, last(debt, ts) AS debt
  FROM player_snapshots GROUP BY bucket, run_id WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS player_snapshots_monthly
  WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
  SELECT time_bucket('1 month', ts) AS bucket, run_id,
         min(day) AS first_day, max(day) AS last_day,
         last(net_worth, ts) AS net_worth, max(net_worth) AS peak, min(net_worth) AS low,
         last(checking, ts) AS checking, last(savings, ts) AS savings, last(brokerage, ts) AS brokerage,
         last(retirement, ts) AS retirement, last(debt, ts) AS debt
  FROM player_snapshots GROUP BY bucket, run_id WITH NO DATA;

-- Sim days are timestamps from 2000 on, far from now(), so refresh the whole range every minute.
SELECT add_continuous_aggregate_policy('player_snapshots_weekly', start_offset => NULL, end_offset => NULL,
  schedule_interval => INTERVAL '1 minute', if_not_exists => true);
SELECT add_continuous_aggregate_policy('player_snapshots_monthly', start_offset => NULL, end_offset => NULL,
  schedule_interval => INTERVAL '1 minute', if_not_exists => true);

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

-- Voice interview answers from the ElevenLabs post-call webhook (routes/voice.ts). A row appears
-- when either the webhook or the player's claim arrives first; received_at is set by the webhook.
CREATE TABLE IF NOT EXISTS voice_interviews (
  conversation_id text PRIMARY KEY,
  player_id       uuid REFERENCES players,
  agent_id        text,
  status          text,
  answers         jsonb,
  summary         text,
  received_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Investing lines (docs/superpowers/specs/2026-09-12-investing-twins-design.md): the player's
-- brokerage plus cash sells took out, the same buys never sold, and a 90/10 autopilot. Daily rows only;
-- the weekly and monthly aggregates above don't carry them.
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS you double precision;
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS held double precision;
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS autopilot double precision;

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

-- Background NPCs (game/src/data/background-npcs.ts, GameEnginePlan.md Part 2): customers that must
-- never be promoted to live Nessie, because the shared sandbox's 12-customer allowance is already
-- fully spent on the primary roster. listUnsyncedCustomers() excludes these permanently.
ALTER TABLE nessie_customers ADD COLUMN IF NOT EXISTS local_only boolean NOT NULL DEFAULT false;

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
