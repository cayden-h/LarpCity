// server/src/store/runs.db.test.ts
// Run data against a real TimescaleDB: a throwaway database gets the game's
// schema plus the server's migrations, then the store's writes and reads.
// Skipped unless TEST_DATABASE_URL points at a server where we may create a
// database (the local Docker one in server/README.md):
//   TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { createRun, history, insertEvents, insertSnapshots, leaderboard, listEvents, ownsRun, type HistoryBucket, type SnapshotRow } from "./runs.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";

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
  await db.query(`INSERT INTO players (id, name) VALUES ($1, 'guest-alice'), ($2, 'guest-bob')`, [ALICE, BOB]);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

const snap = (day: number, netWorth = 1000 + day * 10): SnapshotRow => ({ day, netWorth, checking: 100 + day, savings: 50, brokerage: day, retirement: 0, debt: 500 - day / 10 });

test("migrations apply twice without complaint", { skip }, async () => {
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
  const { rows } = await db.query(`SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name LIKE 'player_snapshots_%' ORDER BY 1`);
  assert.deepEqual(rows.map((r) => r.view_name), ["player_snapshots_monthly", "player_snapshots_weekly"]);
});

test("a run belongs to the player who started it", { skip }, async () => {
  const run = await createRun(db, ALICE, 20260912);
  assert.equal(await ownsRun(db, ALICE, run), true);
  assert.equal(await ownsRun(db, BOB, run), false);
});

test("snapshots are one row per day and a re-sent day keeps its latest numbers", { skip }, async () => {
  const run = await createRun(db, ALICE, 1);
  assert.equal(await insertSnapshots(db, run, Array.from({ length: 800 }, (_, d) => snap(d))), 800);
  await insertSnapshots(db, run, [snap(5, 1), snap(5, 99_999), snap(6, 42)]);
  const days = (await history(db, run, "day", 0, 10)) as SnapshotRow[];
  assert.equal(days.length, 11);
  assert.equal(days[5].netWorth, 99_999, "the last copy of a day in a batch wins");
  assert.equal(days[6].netWorth, 42);
  assert.equal(((await history(db, run, "day", 0, 100_000)) as SnapshotRow[]).length, 800);
});

test("daily snapshots keep the investing lines, and rows without them read back as null", { skip }, async () => {
  const run = await createRun(db, ALICE, 3);
  await insertSnapshots(db, run, [{ ...snap(1), you: 10, held: 12, autopilot: 11 }, snap(2)]);
  const days = (await history(db, run, "day", 0, 10)) as SnapshotRow[];
  assert.deepEqual([days[0].you, days[0].held, days[0].autopilot], [10, 12, 11]);
  assert.deepEqual([days[1].you, days[1].held, days[1].autopilot], [null, null, null]);
});

test("a resent day without the investing lines keeps the stored ones", { skip }, async () => {
  const run = await createRun(db, ALICE, 4);
  await insertSnapshots(db, run, [{ ...snap(1), you: 10, held: 12, autopilot: 11 }]);
  await insertSnapshots(db, run, [snap(1, 5)]);
  const [day] = (await history(db, run, "day", 1, 1)) as SnapshotRow[];
  assert.equal(day.netWorth, 5, "the day's other numbers still take the latest copy");
  assert.deepEqual([day.you, day.held, day.autopilot], [10, 12, 11]);
});

test("weekly and monthly history come from the continuous aggregates, fresh without a refresh", { skip }, async () => {
  const run = await createRun(db, ALICE, 2);
  await insertSnapshots(db, run, Array.from({ length: 400 }, (_, d) => snap(d)));
  const weeks = (await history(db, run, "week", 0, 100_000)) as HistoryBucket[];
  const months = (await history(db, run, "month", 0, 100_000)) as HistoryBucket[];
  assert.ok(weeks.length >= 57 && weeks.length <= 59, `${weeks.length} weeks`);
  assert.ok(months.length >= 13 && months.length <= 14, `${months.length} months`);
  for (const [i, w] of weeks.entries()) {
    assert.ok(w.peak >= w.netWorth && w.netWorth >= w.low);
    if (i) assert.equal(w.firstDay, weeks[i - 1].lastDay + 1, "buckets tile the days");
  }
  assert.equal(months.at(-1)!.lastDay, 399);
  assert.equal(months.at(-1)!.netWorth, snap(399).netWorth, "a bucket's value is its last day's");

  await db.query(`CALL refresh_continuous_aggregate('player_snapshots_weekly', NULL, NULL)`);
  assert.deepEqual(await history(db, run, "week", 0, 100_000), weeks, "materializing changes nothing");
  // Day 0 (2000-01-01) is a Saturday and week buckets start on Mondays, so weeks run days 2-8, 9-15, ...
  const touching = weeks.filter((w) => w.lastDay >= 100 && w.firstDay <= 120);
  assert.deepEqual(await history(db, run, "week", 100, 120), touching, "a window returns the weeks it touches");
  assert.deepEqual(touching.map((w) => [w.firstDay, w.lastDay]), [[100, 106], [107, 113], [114, 120]]);
});

test("events are stored once per key and read back by day and kind", { skip }, async () => {
  const run = await createRun(db, ALICE, 3);
  const events = [
    { key: "1:0", day: 1, kind: "paycheck", payload: { type: "paycheck", day: 1, takeHome: 1825 } },
    { key: "1:1", day: 1, kind: "bill", payload: { type: "bill", day: 1, name: "Rent", amount: 1317, paid: 1317 } },
    { key: "40:0", day: 40, kind: "missed", payload: { type: "missed", day: 40, debtId: "card", due: 95, fee: 32 } },
  ];
  assert.equal(await insertEvents(db, run, events), 3);
  assert.equal(await insertEvents(db, run, events), 0, "a retried batch adds nothing");
  const all = await listEvents(db, run, { from: 0, to: 100 });
  assert.deepEqual(all.map((e) => [e.day, e.key, e.kind]), [[1, "1:0", "paycheck"], [1, "1:1", "bill"], [40, "40:0", "missed"]]);
  assert.equal((all[1].payload as { name: string }).name, "Rent");
  assert.deepEqual((await listEvents(db, run, { from: 0, to: 100, kinds: ["missed"] })).map((e) => e.key), ["40:0"]);
  assert.deepEqual((await listEvents(db, run, { from: 2, to: 40 })).map((e) => e.key), ["40:0"], "to is inclusive");
});

test("the leaderboard ranks each run by its latest day and can require verified players", { skip }, async () => {
  const run = await createRun(db, BOB, 4);
  await insertSnapshots(db, run, [snap(0, 5), snap(1, 10_000_000)]);
  const open = await leaderboard(db, false);
  assert.equal(open[0].runId, run);
  assert.equal(open[0].netWorth, 10_000_000);
  assert.equal(open[0].day, 1);
  assert.ok(!(await leaderboard(db, true)).some((r) => r.runId === run), "unverified players drop out once Persona is required");
  await db.query(`UPDATE players SET verified = true WHERE id = $1`, [BOB]);
  assert.equal((await leaderboard(db, true))[0].runId, run);
});
