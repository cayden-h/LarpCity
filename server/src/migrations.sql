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
