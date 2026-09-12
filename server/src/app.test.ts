// server/src/app.test.ts
// The real app's middleware order: a player's request counts once against its
// rate limit, and provider webhooks have their own. The webhook routers share
// paths with the player routers, so a limiter on both mounts once counted
// every voice request twice (players got 10 a minute, not 20).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { pool } from "./db.js";

// No database in tests: the session middleware's player insert just succeeds.
pool.query = (async () => ({ rows: [], rowCount: 0 })) as unknown as typeof pool.query;
const { createApp } = await import("./app.js");

const server = createApp().listen(0);
await new Promise((ready) => server.once("listening", ready));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.closeAllConnections();
  server.close();
});

test("a player's voice request counts once against the voice rate limit", async () => {
  const remaining: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${base}/api/voice/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "", voice: "narrator" }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("ratelimit-policy"), "20;w=60");
    remaining.push(Number(r.headers.get("ratelimit-remaining")));
  }
  assert.deepEqual(remaining, [19, 18, 17]);
});

test("provider webhooks have their own, looser limit", async () => {
  const r = await fetch(`${base}/api/voice/webhook`, { method: "POST", body: "{}" });
  assert.equal(r.headers.get("ratelimit-policy"), "120;w=60");
  assert.equal(Number(r.headers.get("ratelimit-remaining")), 119);
});
