import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, unsign, parseCookies } from "./session.js";

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

test("parseCookies does not throw on a malformed percent-encoded value", () => {
  // Direct repro of the crash: decodeURIComponent("%") throws a URIError.
  // Previously this propagated out of parseCookies uncaught; since
  // sessionMiddleware is async and this happens before any await, it became
  // an unhandled promise rejection that crashed the whole process on a
  // single request with `Cookie: foo=%`.
  assert.doesNotThrow(() => parseCookies("foo=%"));
  const cookies = parseCookies("foo=%; bar=baz");
  assert.equal(cookies.foo, "%");
  assert.equal(cookies.bar, "baz");
});
