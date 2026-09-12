// Recovery lesson client tests: only the run and the day go to the coach, and a failing server means no lesson.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRecoveryLesson, type Api } from "../src/net/recap.ts";

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
  const api: Api = async () => {
    throw new Error("offline");
  };
  assert.equal(await fetchRecoveryLesson("run-1", 400, api), null);
});
