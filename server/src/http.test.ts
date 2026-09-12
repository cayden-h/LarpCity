// server/src/http.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { z } from "zod";
import { handle, HttpError, parse, Reply } from "./http.js";
import { eventsBody, historyQuery, snapshotBody } from "./routes/snapshot.js";
import { splitSql } from "./sql.js";

function fakeRes() {
  const out: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(s: number) {
      out.status = s;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
  };
  return { res: res as unknown as Response, out };
}

async function run(fn: Parameters<typeof handle>[0], mapError?: Parameters<typeof handle>[1]) {
  const { res, out } = fakeRes();
  handle(fn, mapError)({ path: "/x" } as Request, res);
  await new Promise((r) => setTimeout(r, 5));
  return out;
}

test("handle answers every outcome: body, Reply, HttpError, mapped error, and anything else as a 500", async () => {
  assert.deepEqual(await run(async () => ({ ok: 1 })), { status: 200, body: { ok: 1 } });
  assert.deepEqual(await run(async () => new Reply(201, { id: "r" })), { status: 201, body: { id: "r" } });
  assert.deepEqual(await run(async () => { throw new HttpError(403, "forbidden"); }), { status: 403, body: { error: "forbidden" } });
  class ProviderDown extends Error {}
  const mapped = await run(async () => { throw new ProviderDown("secret detail"); }, (e) => (e instanceof ProviderDown ? new HttpError(502, "down") : undefined));
  assert.deepEqual(mapped, { status: 502, body: { error: "down" } });
  assert.deepEqual(await run(async () => { throw new Error("db exploded"); }), { status: 500, body: { error: "internal_error" } });
});

test("parse turns a bad body into a 400", () => {
  assert.throws(() => parse(z.object({ a: z.number() }), { a: "x" }), (e: HttpError) => e.status === 400);
});

test("run data bodies are validated before the database sees them", () => {
  const runId = "aaaaaaaa-0000-4000-8000-000000000001";
  const entry = { day: 3, netWorth: 1, checking: 1, savings: 1, brokerage: 1, retirement: 1, debt: 1 };
  assert.ok(snapshotBody.safeParse({ runId, entries: [entry] }).success);
  assert.ok(!snapshotBody.safeParse({ runId: "not-a-uuid", entries: [entry] }).success, "a bad uuid would be a Postgres error");
  assert.ok(!snapshotBody.safeParse({ runId, entries: [{ ...entry, netWorth: Infinity }] }).success);
  const ev = { key: "3:0", day: 3, kind: "paycheck", payload: { takeHome: 1 } };
  assert.ok(eventsBody.safeParse({ runId, events: [ev] }).success);
  assert.ok(!eventsBody.safeParse({ runId, events: [{ ...ev, kind: "Drop Table" }] }).success);
  assert.ok(!eventsBody.safeParse({ runId, events: [{ ...ev, key: "x" }] }).success);
  assert.deepEqual(historyQuery.parse({}), { bucket: "week", from: 0, to: 100_000 });
  assert.deepEqual(historyQuery.parse({ bucket: "month", from: "10", to: "20" }), { bucket: "month", from: 10, to: 20 });
  assert.ok(!historyQuery.safeParse({ bucket: "year" }).success);
});

test("splitSql runs a migration file one statement at a time", () => {
  const sql = "-- header; not a statement\nALTER TABLE a ADD COLUMN b int;\n\nCREATE VIEW v AS\n  SELECT 1;\n-- trailing\n";
  assert.deepEqual(splitSql(sql), ["ALTER TABLE a ADD COLUMN b int", "CREATE VIEW v AS\n  SELECT 1"]);
});
