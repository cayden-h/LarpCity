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
