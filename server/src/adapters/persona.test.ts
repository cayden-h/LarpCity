// server/src/adapters/persona.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "./persona.js";

function sign(secret: string, t: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${digest}`;
}

test("verifyWebhookSignature accepts a correctly signed body", () => {
  const body = JSON.stringify({ data: { id: "evt_1" } });
  const header = sign("whsec_test", "1700000000", body);
  assert.equal(verifyWebhookSignature(header, body, "whsec_test"), true);
});

test("verifyWebhookSignature rejects a tampered body", () => {
  const body = JSON.stringify({ data: { id: "evt_1" } });
  const header = sign("whsec_test", "1700000000", body);
  assert.equal(verifyWebhookSignature(header, body + "x", "whsec_test"), false);
});

test("verifyWebhookSignature rejects the wrong secret", () => {
  const body = JSON.stringify({ data: { id: "evt_1" } });
  const header = sign("whsec_test", "1700000000", body);
  assert.equal(verifyWebhookSignature(header, body, "whsec_other"), false);
});

test("verifyWebhookSignature rejects a malformed header", () => {
  assert.equal(verifyWebhookSignature("not-a-valid-header", "{}", "whsec_test"), false);
});
