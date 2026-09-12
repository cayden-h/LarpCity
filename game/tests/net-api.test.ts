// game/tests/net-api.test.ts
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiFetch, ApiError } from "../src/net/api.ts";

afterEach(() => {
  mock.reset();
});

test("apiFetch joins the base URL and path, sends credentials, and parses JSON", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const result = await apiFetch<{ ok: boolean }>("/health", { baseUrl: "http://localhost:3000" });
  assert.equal(capturedUrl, "http://localhost:3000/api/health");
  assert.equal(capturedInit?.credentials, "include");
  assert.deepEqual(result, { ok: true });
});

test("apiFetch throws ApiError with the status on a non-ok response", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 }));
  await assert.rejects(
    () => apiFetch("/bank/acc_1", { baseUrl: "http://localhost:3000" }),
    (err: unknown) => err instanceof ApiError && err.status === 403,
  );
});
