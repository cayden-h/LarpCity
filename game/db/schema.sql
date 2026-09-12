-- Larp City schema for Tiger Data (Postgres + TimescaleDB 2.20+).
-- Apply with `python3 db/load.py` (it runs this file, then loads the seed data).
-- Design notes: research/08-cards-loans-accounts.md (cards, loans, accounts) and SETUP.md (Tiger Data).
--
-- Two kinds of tables:
--   reference data  - real-world catalogs loaded from public datasets (plain tables)
--   run data        - what happens in each player's game, one row per game day or action (hypertables)
-- Sim day N is stored as '2000-01-01'::timestamptz + N days, so continuous aggregates get a real timestamp.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- One row per plan in the CFPB Terms of Credit Card Plans survey (research/data/cards/card_products.csv).
-- Rates are fractions (0.2399 = 23.99%). min_tier: 0 no score, 1 = 619 or less, 2 = 620-719, 3 = 720+.
CREATE TABLE IF NOT EXISTS card_products (
  id                  text PRIMARY KEY,
  institution         text NOT NULL,
  issuer_key          text,
  product_name        text NOT NULL,
  top25_issuer        boolean NOT NULL,
  availability        text,
  state               text,
  requires_membership boolean NOT NULL,
  secured             boolean NOT NULL,
  credit_tiers        smallint[] NOT NULL,
  min_tier            smallint,
  variable_rate       boolean NOT NULL,
  apr_no_score        double precision,
  apr_poor            double precision,
  apr_good            double precision,
  apr_great           double precision,
  apr_min             double precision,
  apr_median          double precision,
  apr_max             double precision,
  intro_apr           double precision,
  intro_months        double precision,
  bt_apr              double precision,
  bt_months           double precision,
  bt_fee_pct          double precision,
  bt_fee_min          double precision,
  cash_apr            double precision,
  cash_fee_pct        double precision,
  cash_fee_min        double precision,
  grace_days          double precision,
  annual_fee          double precision NOT NULL,
  monthly_fee         double precision NOT NULL,
  foreign_fee_pct     double precision NOT NULL,
  late_fee            double precision,
  rewards             text[] NOT NULL,
  other_rewards       text,
  features            text[] NOT NULL,
  website             text,
  report_date         date NOT NULL
);
CREATE INDEX IF NOT EXISTS card_products_issuer ON card_products (issuer_key);
CREATE INDEX IF NOT EXISTS card_products_tier ON card_products (min_tier) WHERE availability = 'National';

-- Sign-up bonuses and fees for name-brand cards (research/data/cards/card_offers.csv).
CREATE TABLE IF NOT EXISTS card_offers (
  card_id               text PRIMARY KEY,
  name                  text NOT NULL,
  issuer_key            text NOT NULL,
  network               text,
  currency              text NOT NULL,
  is_business           boolean NOT NULL,
  annual_fee            double precision NOT NULL,
  first_year_fee_waived boolean NOT NULL,
  base_earn_pct         double precision NOT NULL,
  bonus_amount          double precision,
  bonus_value_usd       double precision,
  bonus_spend           double precision,
  bonus_days            integer,
  counts_toward_524     boolean NOT NULL,
  point_value_cents     double precision,
  url                   text,
  discontinued          boolean NOT NULL,
  tccp_product_id       text REFERENCES card_products (id)
);

-- Real rates from FRED (research/data/cards/macro_rates.csv), as percents.
CREATE TABLE IF NOT EXISTS macro_rates (
  ts     timestamptz NOT NULL,
  series text NOT NULL,
  value  double precision NOT NULL
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'series', tsdb.chunk_interval = '5 years');
CREATE UNIQUE INDEX IF NOT EXISTS macro_rates_key ON macro_rates (series, ts);

-- ---------------------------------------------------------------------------
-- Players and runs (from SETUP.md)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS players (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid REFERENCES players,
  seed       bigint NOT NULL,
  nessie     jsonb,
  started_at timestamptz DEFAULT now(),
  ended_at   timestamptz
);

CREATE TABLE IF NOT EXISTS player_snapshots (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, day int NOT NULL,
  net_worth double precision, checking double precision, savings double precision,
  brokerage double precision, retirement double precision, debt double precision
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'run_id', tsdb.chunk_interval = '1 year');
CREATE UNIQUE INDEX IF NOT EXISTS player_snapshots_key ON player_snapshots (run_id, ts);

CREATE TABLE IF NOT EXISTS market_prices (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, symbol text NOT NULL, price double precision
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'run_id,symbol', tsdb.chunk_interval = '1 year');

CREATE TABLE IF NOT EXISTS events (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, kind text, payload jsonb
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.chunk_interval = '1 year');

-- ---------------------------------------------------------------------------
-- Run data: debt, cards, loans, and money movement
-- ---------------------------------------------------------------------------

-- One row per open debt per day (research/07-debt-system-design.md).
CREATE TABLE IF NOT EXISTS debt_daily (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, day int NOT NULL, debt_id text NOT NULL,
  kind text NOT NULL, balance double precision NOT NULL, apr double precision NOT NULL,
  accrued double precision NOT NULL, days_past_due int NOT NULL, status text NOT NULL
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'run_id', tsdb.chunk_interval = '1 year');
CREATE UNIQUE INDEX IF NOT EXISTS debt_daily_key ON debt_daily (run_id, debt_id, ts);

CREATE TABLE IF NOT EXISTS credit_score_monthly (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, day int NOT NULL, score int NOT NULL,
  payment_history double precision, utilization double precision, history_length double precision,
  new_credit double precision, credit_mix double precision
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'run_id', tsdb.chunk_interval = '5 years');

-- Every card or loan application, approved or not.
CREATE TABLE IF NOT EXISTS credit_applications (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, day int NOT NULL,
  kind text NOT NULL,                -- card | secured_card | personal | auto | mortgage | pal | k401
  product_id text,                   -- card_products.id or card_offers.card_id
  prequal boolean NOT NULL,          -- soft pull only
  decision text NOT NULL,            -- approved | denied | pending
  reasons text[] NOT NULL,
  score int NOT NULL, dti double precision,
  amount double precision, credit_limit double precision, apr double precision,
  hard_inquiry boolean NOT NULL
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'run_id', tsdb.chunk_interval = '5 years');

-- Money moving between the player's accounts and cards.
CREATE TABLE IF NOT EXISTS account_transfers (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, day int NOT NULL, transfer_id text NOT NULL,
  from_account text NOT NULL, to_account text NOT NULL,
  rail text NOT NULL,                -- internal | ach | same_day_ach | wire | instant | cash_advance | balance_transfer
  amount double precision NOT NULL, fee double precision NOT NULL,
  penalty double precision NOT NULL, settles_day int NOT NULL, status text NOT NULL
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'run_id', tsdb.chunk_interval = '1 year');

-- Card spending and the rewards it earned, per card per category per month.
CREATE TABLE IF NOT EXISTS rewards_ledger (
  ts timestamptz NOT NULL, run_id uuid NOT NULL, day int NOT NULL, card_id text NOT NULL,
  category text NOT NULL, spend double precision NOT NULL, earned_usd double precision NOT NULL,
  bonus_usd double precision NOT NULL DEFAULT 0, fee_usd double precision NOT NULL DEFAULT 0
) WITH (tsdb.hypertable, tsdb.partition_column = 'ts', tsdb.segmentby = 'run_id', tsdb.chunk_interval = '1 year');

-- ---------------------------------------------------------------------------
-- Continuous aggregates
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS macro_rates_monthly WITH (timescaledb.continuous) AS
  SELECT time_bucket('1 month', ts) AS bucket, series, avg(value) AS value
  FROM macro_rates GROUP BY bucket, series WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS debt_monthly WITH (timescaledb.continuous) AS
  SELECT time_bucket('1 month', ts) AS bucket, run_id,
         sum(balance) FILTER (WHERE kind = 'credit_card') AS card_balance_sum,
         max(days_past_due) AS worst_days_past_due,
         last(balance, ts) AS last_balance
  FROM debt_daily GROUP BY bucket, run_id WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS rewards_yearly WITH (timescaledb.continuous) AS
  SELECT time_bucket('1 year', ts) AS bucket, run_id, card_id,
         sum(spend) AS spend, sum(earned_usd) AS earned_usd, sum(bonus_usd) AS bonus_usd, sum(fee_usd) AS fee_usd
  FROM rewards_ledger GROUP BY bucket, run_id, card_id WITH NO DATA;

-- Reference view: the average offered APR by credit tier for national plans, next to the Fed's
-- real "accounts assessed interest" APR. Powers the "what would you pay?" card shop screen.
CREATE OR REPLACE VIEW card_apr_by_tier AS
  SELECT 'poor (619 or less)' AS tier, round(avg(apr_poor)::numeric * 100, 2) AS avg_apr_pct, count(apr_poor) AS plans
    FROM card_products WHERE availability = 'National'
  UNION ALL SELECT 'good (620-719)', round(avg(apr_good)::numeric * 100, 2), count(apr_good)
    FROM card_products WHERE availability = 'National'
  UNION ALL SELECT 'great (720+)', round(avg(apr_great)::numeric * 100, 2), count(apr_great)
    FROM card_products WHERE availability = 'National'
  UNION ALL SELECT 'Fed G.19, accounts assessed interest (latest)', round(value::numeric, 2), 1
    FROM (SELECT value FROM macro_rates WHERE series = 'TERMCBCCINTNS' ORDER BY ts DESC LIMIT 1) latest;
