// Recovery lesson client tests: only the run and the day go to the coach, and a failing server means no lesson.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { fetchRecoveryLesson, type Api } from "../src/net/recap.ts";
import { ApiError } from "../src/net/api.ts";

test("the client sends only the run, the trigger, and the day", async () => {
  let seen: { path: string; init?: RequestInit } | null = null;
  const api: Api = async <T,>(path: string, init?: RequestInit) => {
    seen = { path, init };
    return { headline: "Selling cost you $550", tip: "Holding got the rebound.", mood: "console", source: "template" } as T;
  };
  const r = await fetchRecoveryLesson("run-1", 400, api);
  assert.equal(r?.headline, "Selling cost you $550");
  assert.equal(seen!.path, "/feedback");
  assert.equal(seen!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(seen!.init?.body)), { runId: "run-1", trigger: "recovery", day: 400 });
});

test("no server, no lesson", async () => {
  const warn = mock.method(console, "warn", () => {});
  const api: Api = async () => {
    throw new Error("offline");
  };
  assert.equal(await fetchRecoveryLesson("run-1", 400, api), null);
  warn.mock.restore();
});

test("a 409 is retried once", async () => {
  let calls = 0;
  const api: Api = async <T,>() => {
    calls++;
    if (calls === 1) throw new ApiError(409, "not yet");
    return { headline: "Selling cost you $550", tip: "Holding got the rebound.", mood: "console", source: "template" } as T;
  };
  const r = await fetchRecoveryLesson("run-1", 400, api, { retryMs: 0 });
  assert.equal(r?.headline, "Selling cost you $550");
  assert.equal(calls, 2);
});

test("the request carries a timeout signal", async () => {
  let seen: RequestInit | undefined;
  const api: Api = async <T,>(_path: string, init?: RequestInit) => {
    seen = init;
    return { headline: "h", tip: "t", mood: "console", source: "template" } as T;
  };
  await fetchRecoveryLesson("run-1", 400, api);
  assert.ok(seen?.signal instanceof AbortSignal);
});
