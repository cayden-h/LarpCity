import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callGemini } from "./gemini.js";

afterEach(() => {
  mock.reset();
});

test("callGemini rotates to the next key on 429 and succeeds", async () => {
  let call = 0;
  mock.method(globalThis, "fetch", async () => {
    call += 1;
    if (call === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const result = await callGemini("gemini-3.8-flash", { contents: [] });
  assert.deepEqual(result, { ok: true });
  assert.equal(call, 2);
});

test("callGemini throws when every key is exhausted", async () => {
  mock.method(globalThis, "fetch", async () => new Response("overloaded", { status: 503 }));
  await assert.rejects(() => callGemini("gemini-3.8-flash", { contents: [] }));
});

test("callGemini throws immediately on a non-retryable error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("bad request", { status: 400 }));
  await assert.rejects(() => callGemini("gemini-3.8-flash", { contents: [] }));
});
