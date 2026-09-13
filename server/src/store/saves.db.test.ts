// server/src/store/saves.db.test.ts
// Profiles and saves against a real TimescaleDB (see runs.db.test.ts for the setup).
// Skipped unless TEST_DATABASE_URL is set.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { createRun } from "./runs.js";
import { deleteLife, getProfile, getSave, putProfile, putSave, SaveConflict } from "./saves.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ALICE = "aaaaaaaa-0000-4000-8000-000000000011";
const BOB = "bbbbbbbb-0000-4000-8000-000000000012";

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;

before(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  dbName = `larp_test_saves_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  db = new pg.Pool({ connectionString: u.toString() });
  for (const s of splitSql(read("../../../game/db/schema.sql"))) await db.query(s);
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
  await db.query(`INSERT INTO players (id, name) VALUES ($1, 'guest-alice2'), ($2, 'guest-bob2')`, [ALICE, BOB]);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

const answers = { job: "Nurse", salary: 72_000, rent: 1_400, debt: 9_000, savings: 3_000, state: "TX", source: "typed" as const };

/** A fresh player row, so a test's writes never collide with another test's. */
async function freshPlayer(): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO players (id, name) VALUES ($1, $2)`, [id, `guest-${id.slice(0, 8)}`]);
  return id;
}

test("migrations apply twice without complaint", { skip }, async () => {
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
});

test("a profile upserts and reads back", { skip }, async () => {
  const player = await freshPlayer();
  assert.equal(await getProfile(db, player), null);
  await putProfile(db, player, answers);
  await putProfile(db, player, { ...answers, salary: 80_000 });
  const p = await getProfile(db, player);
  assert.equal(p?.salary, 80_000);
  assert.equal(p?.job, "Nurse");
  assert.equal(p?.source, "typed");
});

test("a skipped intake stores no numbers", { skip }, async () => {
  const player = await freshPlayer();
  await putProfile(db, player, { job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" });
  const p = await getProfile(db, player);
  assert.equal(p?.source, "skipped");
  assert.equal(p?.salary, null);
});

test("saves bump rev and refuse a stale base", { skip }, async () => {
  const player = await freshPlayer();
  const run = await createRun(db, player, 7);
  const first = await putSave(db, player, { runId: run, seed: 7, version: 1, gameDay: 10, state: { a: 1 }, baseRev: null });
  assert.equal(first, 1);
  // A second tab that also thinks this is a new life loses.
  await assert.rejects(() => putSave(db, player, { runId: run, seed: 7, version: 1, gameDay: 11, state: { a: 2 }, baseRev: null }), SaveConflict);
  const second = await putSave(db, player, { runId: run, seed: 7, version: 1, gameDay: 12, state: { a: 3 }, baseRev: 1 });
  assert.equal(second, 2);
  await assert.rejects(() => putSave(db, player, { runId: run, seed: 7, version: 1, gameDay: 13, state: { a: 4 }, baseRev: 1 }), SaveConflict);
  const s = await getSave(db, player);
  assert.equal(s?.rev, 2);
  assert.equal(s?.gameDay, 12);
  assert.deepEqual(s?.state, { a: 3 });
  assert.equal(s?.runId, run);
});

test("a save into an ended run is refused, new base and all", { skip }, async () => {
  const player = await freshPlayer();
  const run = await createRun(db, player, 5);
  await db.query(`UPDATE runs SET ended_at = now() WHERE id = $1`, [run]);
  await assert.rejects(() => putSave(db, player, { runId: run, seed: 5, version: 1, gameDay: 0, state: {}, baseRev: null }), SaveConflict);
  // The same guard applies once a save already exists and the write is an update.
  const player2 = await freshPlayer();
  const run2 = await createRun(db, player2, 5);
  await putSave(db, player2, { runId: run2, seed: 5, version: 1, gameDay: 0, state: {}, baseRev: null });
  await db.query(`UPDATE runs SET ended_at = now() WHERE id = $1`, [run2]);
  await assert.rejects(() => putSave(db, player2, { runId: run2, seed: 5, version: 1, gameDay: 1, state: {}, baseRev: 1 }), SaveConflict);
});

test("a save whose seed does not match the run's own seed is refused", { skip }, async () => {
  const player = await freshPlayer();
  const run = await createRun(db, player, 42);
  await assert.rejects(() => putSave(db, player, { runId: run, seed: 43, version: 1, gameDay: 0, state: {}, baseRev: null }), SaveConflict);
  const ok = await putSave(db, player, { runId: run, seed: 42, version: 1, gameDay: 0, state: {}, baseRev: null });
  assert.equal(ok, 1);
  // And on the update path too.
  await assert.rejects(() => putSave(db, player, { runId: run, seed: 43, version: 1, gameDay: 1, state: {}, baseRev: 1 }), SaveConflict);
});

test("a player may not save against another player's run", { skip }, async () => {
  const alice = await freshPlayer();
  const bob = await freshPlayer();
  const aliceRun = await createRun(db, alice, 99);
  await assert.rejects(() => putSave(db, bob, { runId: aliceRun, seed: 99, version: 1, gameDay: 0, state: {}, baseRev: null }), SaveConflict);
  assert.equal(await getSave(db, bob), null);
});

test("one player never sees or overwrites another's save", { skip }, async () => {
  const alice = await freshPlayer();
  const bob = await freshPlayer();
  const aliceRun = await createRun(db, alice, 11);
  await putSave(db, alice, { runId: aliceRun, seed: 11, version: 1, gameDay: 3, state: { a: true }, baseRev: null });
  assert.equal(await getSave(db, bob), null);
  const s = await getSave(db, alice);
  assert.deepEqual(s?.state, { a: true });
});

test("deleteLife removes the save and profile and ends the run, atomically", { skip }, async () => {
  const player = await freshPlayer();
  await putProfile(db, player, answers);
  const run = await createRun(db, player, 8);
  await putSave(db, player, { runId: run, seed: 8, version: 1, gameDay: 0, state: {}, baseRev: null });
  await deleteLife(db, player);
  assert.equal(await getSave(db, player), null);
  assert.equal(await getProfile(db, player), null);
  const { rows } = await db.query(`SELECT ended_at FROM runs WHERE id = $1`, [run]);
  assert.notEqual(rows[0].ended_at, null);
  // After a new life, the first save starts from a null base again.
  const run2 = await createRun(db, player, 9);
  assert.equal(await putSave(db, player, { runId: run2, seed: 9, version: 1, gameDay: 0, state: {}, baseRev: null }), 1);
});

test("deleteLife is a no-op, not an error, when there is nothing to delete", { skip }, async () => {
  const player = await freshPlayer();
  await deleteLife(db, player);
  assert.equal(await getSave(db, player), null);
  assert.equal(await getProfile(db, player), null);
});
