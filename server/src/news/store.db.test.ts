// server/src/news/store.db.test.ts
// news_stories against a real TimescaleDB, same throwaway-database pattern as
// server/src/store/runs.db.test.ts. Skipped unless TEST_DATABASE_URL is set:
//   TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { createRun, insertEvents, insertSnapshots } from "../store/runs.js";
import {
  insertNewsStories,
  listNewsStories,
  markNewsStoryWritten,
  priorKindCounts,
  runBaseline,
  unwrittenNewsStories,
  type NewNewsStory,
} from "./store.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;

before(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  dbName = `larp_test_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  db = new pg.Pool({ connectionString: u.toString() });
  for (const s of splitSql(read("../../../game/db/schema.sql"))) await db.query(s);
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
  await db.query(`INSERT INTO players (id, name) VALUES ($1, 'guest-alice')`, [ALICE]);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

const row = (runId: string, over: Partial<NewNewsStory> = {}): NewNewsStory => ({
  runId,
  branchId: runId,
  day: 10,
  eventKey: "10:0",
  kind: "paid_off",
  category: "financial",
  score: 72,
  prominence: "section",
  facts: { debtId: "d1", name: "Car loan" },
  ...over,
});

test("a story inserts once per (run, branch, event key); a retry is a no-op", { skip }, async () => {
  const run = await createRun(db, ALICE, 1);
  assert.equal(await insertNewsStories(db, [row(run)]), 1);
  assert.equal(await insertNewsStories(db, [row(run)]), 0, "retried batch inserts nothing new");
  const stories = await listNewsStories(db, run, run, 0, 30);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].headline, null, "no prose yet");
});

test("priorKindCounts counts this run's own events table, per kind", { skip }, async () => {
  const run = await createRun(db, ALICE, 2);
  await insertEvents(db, run, [
    { key: "1:0", day: 1, kind: "late_mark", payload: {} },
    { key: "2:0", day: 2, kind: "late_mark", payload: {} },
    { key: "3:0", day: 3, kind: "job", payload: { employed: false } },
  ]);
  const counts = await priorKindCounts(db, run, ["late_mark", "job", "moved"]);
  assert.equal(counts.get("late_mark"), 2);
  assert.equal(counts.get("job"), 1);
  assert.equal(counts.has("moved"), false);
});

test("runBaseline reads the latest snapshot at or before the given day", { skip }, async () => {
  const run = await createRun(db, ALICE, 3);
  await insertSnapshots(db, run, [
    { day: 5, netWorth: 1000, checking: 500, savings: 500, brokerage: 0, retirement: 0, debt: 0 },
    { day: 15, netWorth: 2000, checking: 1000, savings: 1000, brokerage: 0, retirement: 0, debt: 0 },
  ]);
  assert.equal(await runBaseline(db, run, 10), 1000);
  assert.equal(await runBaseline(db, run, 20), 2000);
  assert.equal(await runBaseline(db, run, 0), 0, "no snapshot yet: baseline is 0, not an error");
});

test("unwrittenNewsStories then markNewsStoryWritten moves a row out of the unwritten queue", { skip }, async () => {
  const run = await createRun(db, ALICE, 4);
  await insertNewsStories(db, [row(run)]);
  const unwritten = await unwrittenNewsStories(db, run, run, 0, 100_000, 20);
  assert.equal(unwritten.length, 1);
  await markNewsStoryWritten(db, unwritten[0].id, "Car loan paid off", "The last payment cleared the balance.", "More cash free for savings.", "template");
  assert.equal((await unwrittenNewsStories(db, run, run, 0, 100_000, 20)).length, 0);
  const [written] = await listNewsStories(db, run, run, 0, 30);
  assert.equal(written.headline, "Car loan paid off");
  assert.equal(written.source, "template");
});

test("listNewsStories only returns this run's own stories, and only within the day range", { skip }, async () => {
  const runA = await createRun(db, ALICE, 5);
  const runB = await createRun(db, ALICE, 6);
  await insertNewsStories(db, [row(runA, { day: 5, eventKey: "5:0" }), row(runA, { day: 50, eventKey: "50:0" }), row(runB, { day: 5, eventKey: "5:0" })]);
  const inRange = await listNewsStories(db, runA, runA, 0, 10);
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0].day, 5);
  // Discriminates run_id specifically, not just branch_id: runB's row must genuinely carry
  // run_id = runB (not runA) for this to find it at all.
  const runBOwn = await listNewsStories(db, runB, runB, 0, 10);
  assert.equal(runBOwn.length, 1);
  assert.equal(runBOwn[0].runId, runB);
});
