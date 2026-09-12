import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, unsign } from "./session.js";

test("unsign recovers the original value after sign", () => {
  const signed = sign("secret-key-123", "player-abc");
  assert.equal(unsign("secret-key-123", signed), "player-abc");
});

test("unsign rejects a tampered value", () => {
  const signed = sign("secret-key-123", "player-abc");
  const tampered = signed.replace("player-abc", "player-xyz");
  assert.equal(unsign("secret-key-123", tampered), null);
});

test("unsign rejects a value signed with a different secret", () => {
  const signed = sign("secret-key-123", "player-abc");
  assert.equal(unsign("different-secret", signed), null);
});

test("unsign rejects a malformed cookie", () => {
  assert.equal(unsign("secret-key-123", "not-a-signed-value"), null);
});
