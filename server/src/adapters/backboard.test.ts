// server/src/adapters/backboard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackboardAdapter, type BackboardClientLike } from "./backboard.js";

function fakeClient(overrides: Partial<BackboardClientLike> = {}): BackboardClientLike {
  return {
    cloneAssistant: async () => ({ assistantId: "asst_clone_1" }),
    createThread: async () => ({ threadId: "thread_1" }),
    sendMessage: async () => ({ content: "you're doing great" }),
    ...overrides,
  };
}

test("ensurePlayerAssistant returns the existing id without cloning", async () => {
  let cloned = false;
  const adapter = createBackboardAdapter(
    fakeClient({ cloneAssistant: async () => { cloned = true; return { assistantId: "should-not-happen" }; } }),
  );
  const id = await adapter.ensurePlayerAssistant("player-1", "asst_existing");
  assert.equal(id, "asst_existing");
  assert.equal(cloned, false);
});

test("ensurePlayerAssistant clones a new assistant when none exists", async () => {
  const adapter = createBackboardAdapter(fakeClient());
  const id = await adapter.ensurePlayerAssistant("player-1", null);
  assert.equal(id, "asst_clone_1");
});

test("ask returns the message content from sendMessage", async () => {
  const adapter = createBackboardAdapter(fakeClient());
  const answer = await adapter.ask("asst_1", "thread_1", "why did I go bankrupt?", false);
  assert.equal(answer, "you're doing great");
});
