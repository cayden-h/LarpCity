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

-- Net worth by week and by month for the charts and the milestone look-back. Real-time
-- (materialized_only = false), so the newest days show before the policy materializes them.
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

-- Investing lines (docs/superpowers/specs/2026-09-12-investing-twins-design.md): the player's
-- brokerage plus cash sells took out, the same buys never sold, and a 90/10 autopilot. Daily rows only;
-- the weekly and monthly aggregates above don't carry them.
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS you double precision;
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS held double precision;
ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS autopilot double precision;
