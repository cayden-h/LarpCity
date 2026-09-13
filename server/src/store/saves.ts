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

/** A player's save slots (meeting 2026-09-13): three, so judges can jump between pre-built lives. */
export const SLOTS = [0, 1, 2] as const;
export type Slot = (typeof SLOTS)[number];

/** The saves table's name for a slot. Slot 0 keeps the name every save had before slots, so those still load. */
export const slotKey = (slot: Slot): string => (slot === 0 ? "main" : `slot${slot}`);
const slotOfKey = (key: string): Slot | null => SLOTS.find((s) => slotKey(s) === key) ?? null;

/** What the slot picker shows about a saved life, read out of its save. */
export interface SlotSummary {
  slot: Slot;
  gameDay: number;
  updatedAt: string;
  age: number | null;
  job: string | null;
  state: string | null;
  netWorth: number | null;
}

const numOrNull = (v: string | null) => (v === null || !Number.isFinite(Number(v)) ? null : Number(v));

/** The player's three slots, in order; an empty slot is null. */
export async function listSlots(db: Db, playerId: string): Promise<(SlotSummary | null)[]> {
  const { rows } = await db.query(
    `SELECT slot, game_day, updated_at,
            state->'life'->>'age' AS age, state->'life'->>'job' AS job, state->'life'->'place'->>'abbr' AS place,
            state->'life'->'history'->-1->>'netWorth' AS net_worth
       FROM saves WHERE player_id = $1`,
    [playerId],
  );
  const out: (SlotSummary | null)[] = SLOTS.map(() => null);
  for (const r of rows) {
    const slot = slotOfKey(r.slot);
    if (slot === null) continue;
    out[slot] = {
      slot,
      gameDay: r.game_day,
      updatedAt: new Date(r.updated_at).toISOString(),
      age: numOrNull(r.age),
      job: r.job || null,
      state: r.place ?? null,
      netWorth: numOrNull(r.net_worth),
    };
  }
  return out;
}

export async function getSave(db: Db, playerId: string, slot: Slot = 0): Promise<SaveRow | null> {
  const { rows } = await db.query(
    `SELECT run_id, seed, version, game_day, state, rev, updated_at FROM saves WHERE player_id = $1 AND slot = $2`,
    [playerId, slotKey(slot)],
  );
  const r = rows[0];
  if (!r) return null;
  return { runId: r.run_id, seed: Number(r.seed), version: r.version, gameDay: r.game_day, state: r.state, rev: r.rev, updatedAt: new Date(r.updated_at).toISOString() };
}

// A save may only target a run that is still live and belongs to this player,
// with that run's own seed. Without this, a stale tab that never saved (and
// so still holds baseRev null with an old runId) could resurrect a life that
// "New life" already ended, and a mismatched seed would decode a different
// market than the one the run actually played.
const RUN_IS_LIVE_AND_OWNED = `EXISTS (
  SELECT 1 FROM runs WHERE id = $2 AND player_id = $1 AND ended_at IS NULL AND seed = $3
)`;

/** Writes the save and returns its new rev; throws SaveConflict when `baseRev` is stale, or the run is not a live run of this player with its own seed. */
export async function putSave(db: Db, playerId: string, w: SaveWrite, slot: Slot = 0): Promise<number> {
  const params = [playerId, w.runId, w.seed, w.version, w.gameDay, JSON.stringify(w.state), slotKey(slot)];
  const { rows } =
    w.baseRev === null
      ? await db.query<{ rev: number }>(
          `INSERT INTO saves (player_id, run_id, seed, version, game_day, state, slot)
           SELECT $1, $2, $3, $4, $5, $6, $7 WHERE ${RUN_IS_LIVE_AND_OWNED}
           ON CONFLICT (player_id, slot) DO NOTHING RETURNING rev`,
          params,
        )
      : await db.query<{ rev: number }>(
          `UPDATE saves SET run_id = $2, seed = $3, version = $4, game_day = $5, state = $6, rev = rev + 1, updated_at = now()
           WHERE player_id = $1 AND slot = $7 AND rev = $8 AND ${RUN_IS_LIVE_AND_OWNED} RETURNING rev`,
          [...params, w.baseRev],
        );
  if (!rows[0]) throw new SaveConflict("stale save");
  return rows[0].rev;
}

/**
 * "New life" in a slot: forgets that slot's save and the profile (so the slot's next life starts
 * with the intake) and marks the slot's run ended, all in one transaction. Other slots keep theirs.
 */
export async function deleteLife(db: Db, playerId: string, slot: Slot = 0): Promise<void> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `WITH d AS (DELETE FROM saves WHERE player_id = $1 AND slot = $2 RETURNING run_id)
       UPDATE runs SET ended_at = now() WHERE id IN (SELECT run_id FROM d) AND ended_at IS NULL`,
      [playerId, slotKey(slot)],
    );
    await c.query(`DELETE FROM profiles WHERE player_id = $1`, [playerId]);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}
