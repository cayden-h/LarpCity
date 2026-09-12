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
