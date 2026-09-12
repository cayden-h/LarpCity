// server/src/store/saves.db.test.ts
// Profiles and saves against a real TimescaleDB (see runs.db.test.ts for the setup).
// Skipped unless TEST_DATABASE_URL is set.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
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

test("migrations apply twice without complaint", { skip }, async () => {
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
});

test("a profile upserts and reads back", { skip }, async () => {
  assert.equal(await getProfile(db, ALICE), null);
  await putProfile(db, ALICE, answers);
  await putProfile(db, ALICE, { ...answers, salary: 80_000 });
  const p = await getProfile(db, ALICE);
  assert.equal(p?.salary, 80_000);
  assert.equal(p?.job, "Nurse");
  assert.equal(p?.source, "typed");
});

test("a skipped intake stores no numbers", { skip }, async () => {
  await putProfile(db, BOB, { job: null, salary: null, rent: null, debt: null, savings: null, state: "CA", source: "skipped" });
  const p = await getProfile(db, BOB);
  assert.equal(p?.source, "skipped");
  assert.equal(p?.salary, null);
  await deleteLife(db, BOB);
});

test("saves bump rev and refuse a stale base", { skip }, async () => {
  const run = await createRun(db, ALICE, 7);
  const first = await putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 10, state: { a: 1 }, baseRev: null });
  assert.equal(first, 1);
  // A second tab that also thinks this is a new life loses.
  await assert.rejects(() => putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 11, state: { a: 2 }, baseRev: null }), SaveConflict);
  const second = await putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 12, state: { a: 3 }, baseRev: 1 });
  assert.equal(second, 2);
  await assert.rejects(() => putSave(db, ALICE, { runId: run, seed: 7, version: 1, gameDay: 13, state: { a: 4 }, baseRev: 1 }), SaveConflict);
  const s = await getSave(db, ALICE);
  assert.equal(s?.rev, 2);
  assert.equal(s?.gameDay, 12);
  assert.deepEqual(s?.state, { a: 3 });
  assert.equal(s?.runId, run);
});

test("one player never sees another's save", { skip }, async () => {
  assert.equal(await getSave(db, BOB), null);
});

test("deleteLife removes the save and profile and ends the run", { skip }, async () => {
  const s = await getSave(db, ALICE);
  await deleteLife(db, ALICE);
  assert.equal(await getSave(db, ALICE), null);
  assert.equal(await getProfile(db, ALICE), null);
  const { rows } = await db.query(`SELECT ended_at FROM runs WHERE id = $1`, [s!.runId]);
  assert.notEqual(rows[0].ended_at, null);
  // After a new life, the first save starts from a null base again.
  const run = await createRun(db, ALICE, 8);
  assert.equal(await putSave(db, ALICE, { runId: run, seed: 8, version: 1, gameDay: 0, state: {}, baseRev: null }), 1);
});
