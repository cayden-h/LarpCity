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
