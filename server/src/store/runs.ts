// server/src/store/runs.ts
// Run data in Tiger Data: runs, the player's daily snapshots, life events,
// and the history and leaderboard reads. Sim day N is stored at
// '2000-01-01' + N days (the schema's convention), so time_bucket and the
// continuous aggregates in migrations.sql work on it.
import type pg from "pg";

export type Db = pg.Pool;
export type Bucket = "day" | "week" | "month";

export interface SnapshotRow {
  day: number;
  netWorth: number;
  checking: number;
  savings: number;
  brokerage: number;
  retirement: number;
  debt: number;
  /** Investing lines (game/src/sim/life/twins.ts); null on rows sent before they existed. */
  you?: number | null;
  held?: number | null;
  autopilot?: number | null;
}

export interface EventRow {
  /** The game's own id for the event, `day:sequence`; a retried batch never inserts it twice. */
  key: string;
  day: number;
  kind: string;
  payload: Record<string, unknown>;
}

export interface HistoryBucket {
  firstDay: number;
  lastDay: number;
  netWorth: number;
  peak: number;
  low: number;
  checking: number;
  savings: number;
  brokerage: number;
  retirement: number;
  debt: number;
}

export interface LeaderRow {
  name: string;
  verified: boolean;
  runId: string;
  day: number;
  netWorth: number;
}

const AT_DAY = (param: string) => `'2000-01-01'::timestamptz + ${param} * interval '1 day'`;
const DAY_OF_TS = `(extract(epoch from (ts - '2000-01-01'::timestamptz)) / 86400)::int`;
/** The continuous aggregates (migrations.sql); a fixed map, never user input, goes into the SQL. */
const VIEWS = { week: "player_snapshots_weekly", month: "player_snapshots_monthly" } as const;

export async function createRun(db: Db, playerId: string, seed: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO runs (player_id, seed) VALUES ($1, $2) RETURNING id`, [playerId, seed]);
  return rows[0].id;
}

/** True once Persona has verified this player as a human adult (routes/persona.ts). */
export async function playerVerified(db: Db, playerId: string): Promise<boolean> {
  const { rows } = await db.query<{ verified: boolean }>(`SELECT verified FROM players WHERE id = $1`, [playerId]);
  return rows[0]?.verified === true;
}

export async function ownsRun(db: Db, playerId: string, runId: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM runs WHERE id = $1 AND player_id = $2`, [runId, playerId]);
  return rows.length > 0;
}

/**
 * Upserts one row per day: a day the game records again (a trade after the day's tick) keeps its latest numbers.
 * The investing lines (you, held, autopilot) keep their stored values when a resend omits them.
 */
export async function insertSnapshots(db: Db, runId: string, entries: SnapshotRow[]): Promise<number> {
  const byDay = new Map(entries.map((e) => [e.day, e])); // ON CONFLICT can't touch one row twice in a statement
  const rows = [...byDay.values()];
  const col = <K extends keyof SnapshotRow>(k: K) => rows.map((r) => r[k]);
  const r = await db.query(
    `INSERT INTO player_snapshots (ts, run_id, day, net_worth, checking, savings, brokerage, retirement, debt, you, held, autopilot)
     SELECT ${AT_DAY("d")}, $1, d, nw, ch, sv, br, rt, dt, yo, hd, ap
     FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::float8[], $10::float8[], $11::float8[])
       AS t(d, nw, ch, sv, br, rt, dt, yo, hd, ap)
     ON CONFLICT (run_id, ts) DO UPDATE SET
       net_worth = EXCLUDED.net_worth, checking = EXCLUDED.checking, savings = EXCLUDED.savings,
       brokerage = EXCLUDED.brokerage, retirement = EXCLUDED.retirement, debt = EXCLUDED.debt,
       you = COALESCE(EXCLUDED.you, player_snapshots.you),
       held = COALESCE(EXCLUDED.held, player_snapshots.held),
       autopilot = COALESCE(EXCLUDED.autopilot, player_snapshots.autopilot)`,
    [
      runId,
      col("day"),
      col("netWorth"),
      col("checking"),
      col("savings"),
      col("brokerage"),
      col("retirement"),
      col("debt"),
      rows.map((r) => r.you ?? null),
      rows.map((r) => r.held ?? null),
      rows.map((r) => r.autopilot ?? null),
    ],
  );
  return r.rowCount ?? 0;
}

/** Inserts events once per key; returns how many were new. */
export async function insertEvents(db: Db, runId: string, entries: EventRow[]): Promise<number> {
  const r = await db.query(
    `INSERT INTO events (ts, run_id, key, kind, payload)
     SELECT ${AT_DAY("d")}, $1, k, kd, p
     FROM unnest($2::int[], $3::text[], $4::text[], $5::jsonb[]) AS t(d, k, kd, p)
     ON CONFLICT (run_id, ts, key) DO NOTHING`,
    [runId, entries.map((e) => e.day), entries.map((e) => e.key), entries.map((e) => e.kind), entries.map((e) => JSON.stringify(e.payload))],
  );
  return r.rowCount ?? 0;
}

/** Daily rows, or weekly and monthly buckets from the continuous aggregates, between two days. */
export async function history(db: Db, runId: string, bucket: Bucket, from: number, to: number): Promise<(SnapshotRow | HistoryBucket)[]> {
  if (bucket === "day") {
    const { rows } = await db.query<SnapshotRow>(
      `SELECT day, net_worth AS "netWorth", checking, savings, brokerage, retirement, debt, you, held, autopilot
       FROM player_snapshots WHERE run_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day`,
      [runId, from, to],
    );
    return rows;
  }
  const { rows } = await db.query<HistoryBucket>(
    `SELECT first_day AS "firstDay", last_day AS "lastDay", net_worth AS "netWorth", peak, low,
            checking, savings, brokerage, retirement, debt
     FROM ${VIEWS[bucket]} WHERE run_id = $1 AND last_day >= $2 AND first_day <= $3 ORDER BY bucket`,
    [runId, from, to],
  );
  return rows;
}

/** Events between two days (inclusive), optionally only some kinds, oldest first. */
export async function listEvents(db: Db, runId: string, o: { from: number; to: number; kinds?: string[] }): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT ${DAY_OF_TS} AS day, key, kind, payload FROM events
     WHERE run_id = $1 AND ts >= ${AT_DAY("$2::int")} AND ts < ${AT_DAY("($3::int + 1)")}
       AND ($4::text[] IS NULL OR kind = ANY($4::text[]))
     ORDER BY ts, key LIMIT 5000`,
    [runId, o.from, o.to, o.kinds ?? null],
  );
  return rows;
}

/** Each run's latest net worth, best first; `verifiedOnly` once the Persona gate is live. */
export async function leaderboard(db: Db, verifiedOnly: boolean): Promise<LeaderRow[]> {
  const { rows } = await db.query<LeaderRow>(
    `SELECT p.name, p.verified, s.run_id AS "runId", s.day, s.net_worth AS "netWorth"
     FROM (SELECT DISTINCT ON (run_id) run_id, day, net_worth FROM player_snapshots ORDER BY run_id, ts DESC) s
     JOIN runs r ON r.id = s.run_id
     JOIN players p ON p.id = r.player_id
     WHERE p.verified OR NOT $1::boolean
     ORDER BY s.net_worth DESC LIMIT 50`,
    [verifiedOnly],
  );
  return rows;
}
