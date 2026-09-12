// server/src/news/pipeline.db.test.ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { createRun, insertEvents, insertSnapshots } from "../store/runs.js";
import { listNewsStories } from "./store.js";
import { scoreAndStoreEvents } from "./pipeline.js";

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

test("a batch scores eligible events, drops routine ones, and a retry stores nothing new", { skip }, async () => {
  const run = await createRun(db, ALICE, 1);
  await insertSnapshots(db, run, [{ day: 0, netWorth: 5000, checking: 2500, savings: 2500, brokerage: 0, retirement: 0, debt: 0 }]);
  const events = [
    { key: "1:0", day: 1, kind: "paycheck", payload: { takeHome: 2000, garnished: 0, unemployed: false } },
    { key: "1:1", day: 1, kind: "paid_off", payload: { debtId: "d1", name: "Car loan" } },
  ];
  await insertEvents(db, run, events);
  const stored = await scoreAndStoreEvents(db, run, events);
  assert.equal(stored, 1, "only paid_off is eligible");
  const stories = await listNewsStories(db, run, run, 0, 10);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].kind, "paid_off");

  const retried = await scoreAndStoreEvents(db, run, events);
  assert.equal(retried, 0, "the same event key never scores twice");
});

test("rarity decays across two separate requests, not just within one batch", { skip }, async () => {
  const run = await createRun(db, ALICE, 2);
  await insertSnapshots(db, run, [{ day: 0, netWorth: 40_000, checking: 20_000, savings: 20_000, brokerage: 0, retirement: 0, debt: 0 }]);

  const first = [{ key: "1:0", day: 1, kind: "late_mark", payload: { severity: 30, scoreBefore: 700, scoreAfter: 660 } }];
  await insertEvents(db, run, first);
  await scoreAndStoreEvents(db, run, first);

  const second = [{ key: "2:0", day: 2, kind: "late_mark", payload: { severity: 30, scoreBefore: 660, scoreAfter: 620 } }];
  await insertEvents(db, run, second);
  await scoreAndStoreEvents(db, run, second);

  const [story1, story2] = await listNewsStories(db, run, run, 0, 10);
  assert.ok(story1.score > story2.score, `request 1's story (${story1.score}) should outscore request 2's (${story2.score})`);
});

test("a fast-forward batch scores each event against its own net worth, not the batch's final one", { skip }, async () => {
  const run = await createRun(db, ALICE, 3);
  // ~40 years of history in one fast-forward: poor at the start, rich at the end.
  await insertSnapshots(db, run, [
    { day: 0, netWorth: 2_000, checking: 1_000, savings: 1_000, brokerage: 0, retirement: 0, debt: 0 },
    { day: 14_000, netWorth: 2_000_000, checking: 0, savings: 2_000_000, brokerage: 0, retirement: 0, debt: 0 },
  ]);
  // The same $500 missed payment near the poor start and near the rich end, in ONE batch.
  const events = [
    { key: "30:0", day: 30, kind: "missed", payload: { due: 500, fee: 25 } },
    { key: "14000:0", day: 14_000, kind: "missed", payload: { due: 500, fee: 25 } },
  ];
  // Score BEFORE inserting the events, exactly as routes/snapshot.ts's POST /events does, so
  // priorKindCounts sees an empty events table (the early miss is this kind's first occurrence).
  await scoreAndStoreEvents(db, run, events);
  await insertEvents(db, run, events);

  const stored = await listNewsStories(db, run, run, 0, 100_000);
  const early = stored.find((s) => s.day === 30);
  const late = stored.find((s) => s.day === 14_000);
  assert.ok(early, "the early $500 miss at a $2k net worth is newsworthy and should publish");
  // The reviewed bug scored the whole batch against the run's FINAL ($2M) net worth, which flattens the
  // early miss's magnitude term to ~0 and its score to ~45. Resolving the early miss against its own
  // ~$2k net worth makes the magnitude term fire, lifting the score above 45.
  assert.ok(
    early!.score > 45.5,
    `the early miss must be scored against the ~$2k the player had at day 30 (got ${early?.score}); the batch's final $2M net worth would have flattened it to ~45`,
  );
  // The identical $500 miss at a $2M net worth simply isn't news — it stays out of the paper.
  assert.ok(!late, "the identical $500 miss at a $2M net worth is not newsworthy and should not publish");
});
