// server/src/store/save-slots.db.test.ts
// A player's three save slots against a real TimescaleDB (see runs.db.test.ts for the setup).
// Skipped unless TEST_DATABASE_URL is set.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { createRun } from "./runs.js";
import { deleteLife, getSave, listSlots, putSave } from "./saves.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;

before(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  dbName = `larp_test_slots_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  db = new pg.Pool({ connectionString: u.toString() });
  for (const s of splitSql(read("../../../game/db/schema.sql"))) await db.query(s);
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

async function freshPlayer(): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO players (id, name) VALUES ($1, $2)`, [id, `guest-${id.slice(0, 8)}`]);
  return id;
}

const lifeState = (age: number, job: string, abbr: string, netWorth: number) => ({ life: { age, job, place: { abbr }, history: [{ netWorth: 0 }, { netWorth }] } });

test("each slot keeps its own save and its own rev", { skip }, async () => {
  const player = await freshPlayer();
  const runA = await createRun(db, player, 7);
  const runB = await createRun(db, player, 8);
  await putSave(db, player, { runId: runA, seed: 7, version: 1, gameDay: 10, state: lifeState(22, "Nurse", "CA", 5_000), baseRev: null }, 0);
  await putSave(db, player, { runId: runB, seed: 8, version: 1, gameDay: 9_000, state: lifeState(46, "", "TX", 310_000), baseRev: null }, 2);
  assert.equal((await getSave(db, player, 0))?.gameDay, 10);
  assert.equal(await getSave(db, player, 1), null);
  assert.equal((await getSave(db, player, 2))?.gameDay, 9_000);

  // Slot 0 moves on; slot 2's rev doesn't.
  assert.equal(await putSave(db, player, { runId: runA, seed: 7, version: 1, gameDay: 11, state: lifeState(22, "Nurse", "CA", 5_100), baseRev: 1 }, 0), 2);
  assert.equal((await getSave(db, player, 2))?.rev, 1);

  const slots = await listSlots(db, player);
  assert.equal(slots.length, 3);
  assert.deepEqual({ ...slots[0], updatedAt: "" }, { slot: 0, gameDay: 11, updatedAt: "", age: 22, job: "Nurse", state: "CA", netWorth: 5_100 });
  assert.equal(slots[1], null);
  assert.deepEqual({ ...slots[2], updatedAt: "" }, { slot: 2, gameDay: 9_000, updatedAt: "", age: 46, job: null, state: "TX", netWorth: 310_000 });
});

test("a new life in one slot leaves the other slots and their runs alone", { skip }, async () => {
  const player = await freshPlayer();
  const runA = await createRun(db, player, 7);
  const runB = await createRun(db, player, 8);
  await putSave(db, player, { runId: runA, seed: 7, version: 1, gameDay: 1, state: {}, baseRev: null }, 0);
  await putSave(db, player, { runId: runB, seed: 8, version: 1, gameDay: 2, state: {}, baseRev: null }, 1);
  await deleteLife(db, player, 1);
  assert.equal(await getSave(db, player, 1), null);
  assert.equal((await getSave(db, player, 0))?.runId, runA);
  const { rows } = await db.query(`SELECT id, ended_at FROM runs WHERE id = ANY($1)`, [[runA, runB]]);
  const ended = Object.fromEntries(rows.map((r) => [r.id, r.ended_at !== null]));
  assert.deepEqual(ended, { [runA]: false, [runB]: true });
});

test("another player's slot is never touched", { skip }, async () => {
  const alice = await freshPlayer();
  const bob = await freshPlayer();
  const run = await createRun(db, alice, 7);
  await putSave(db, alice, { runId: run, seed: 7, version: 1, gameDay: 1, state: {}, baseRev: null }, 1);
  // Bob can't write into Alice's run, and deleting his slot 1 leaves hers.
  await assert.rejects(putSave(db, bob, { runId: run, seed: 7, version: 1, gameDay: 2, state: {}, baseRev: null }, 1));
  await deleteLife(db, bob, 1);
  assert.equal((await getSave(db, alice, 1))?.gameDay, 1);
});

test("a save from before slots is slot 0", { skip }, async () => {
  const player = await freshPlayer();
  const run = await createRun(db, player, 7);
  await db.query(`INSERT INTO saves (player_id, run_id, seed, version, game_day, state) VALUES ($1, $2, 7, 1, 3, '{}')`, [player, run]);
  assert.equal((await getSave(db, player, 0))?.gameDay, 3);
  assert.equal((await listSlots(db, player))[0]?.gameDay, 3);
});

test("the table refuses a slot the game doesn't have", { skip }, async () => {
  const player = await freshPlayer();
  const run = await createRun(db, player, 7);
  await assert.rejects(
    db.query(`INSERT INTO saves (player_id, slot, run_id, seed, version, game_day, state) VALUES ($1, 'slot3', $2, 7, 1, 0, '{}')`, [player, run]),
    /saves_slot_check/,
  );
});
