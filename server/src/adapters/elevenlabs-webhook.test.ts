// server/src/adapters/elevenlabs-webhook.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parsePostCall, verifyElevenLabsSignature } from "./elevenlabs-webhook.js";

const NOW = 1_789_000_000;

function sign(secret: string, t: number, body: string): string {
  const digest = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v0=${digest}`;
}

const body = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "conv_1" } });

test("verifyElevenLabsSignature accepts a correctly signed body", () => {
  assert.equal(verifyElevenLabsSignature(sign("wsec_test", NOW, body), body, "wsec_test", NOW), true);
});

test("verifyElevenLabsSignature rejects a tampered body", () => {
  assert.equal(verifyElevenLabsSignature(sign("wsec_test", NOW, body), body + "x", "wsec_test", NOW), false);
});

test("verifyElevenLabsSignature rejects the wrong secret", () => {
  assert.equal(verifyElevenLabsSignature(sign("wsec_test", NOW, body), body, "wsec_other", NOW), false);
});

test("verifyElevenLabsSignature rejects timestamps more than 30 minutes off either way", () => {
  const stale = NOW - 31 * 60;
  const future = NOW + 31 * 60;
  assert.equal(verifyElevenLabsSignature(sign("wsec_test", stale, body), body, "wsec_test", NOW), false);
  assert.equal(verifyElevenLabsSignature(sign("wsec_test", future, body), body, "wsec_test", NOW), false);
  const recent = NOW - 29 * 60;
  assert.equal(verifyElevenLabsSignature(sign("wsec_test", recent, body), body, "wsec_test", NOW), true);
});

test("verifyElevenLabsSignature rejects malformed headers", () => {
  for (const header of ["", "not-a-header", `t=${NOW}`, "v0=abcd", `t=soon,v0=abcd`, `t=${NOW},v0=zz`]) {
    assert.equal(verifyElevenLabsSignature(header, body, "wsec_test", NOW), false, header);
  }
});

test("parsePostCall keeps the collected values and summary", () => {
  const event = {
    type: "post_call_transcription",
    event_timestamp: NOW,
    data: {
      agent_id: "agent_1",
      conversation_id: "conv_1",
      status: "done",
      transcript: [{ role: "agent", message: "Welcome to Larp City!" }],
      analysis: {
        call_successful: "success",
        transcript_summary: "The player is a nurse.",
        data_collection_results: {
          job: { data_collection_id: "job", value: "Nurse", rationale: "They said nurse." },
          salary: { data_collection_id: "salary", value: 85000, rationale: "..." },
          debt: { data_collection_id: "debt", value: null, rationale: "Not mentioned." },
        },
      },
    },
  };
  assert.deepEqual(parsePostCall(event), {
    conversationId: "conv_1",
    agentId: "agent_1",
    status: "done",
    answers: { job: "Nurse", salary: 85000, debt: null },
    summary: "The player is a nurse.",
  });
});

test("parsePostCall tolerates a call without analysis", () => {
  const event = { type: "post_call_transcription", data: { agent_id: "agent_1", conversation_id: "conv_2" } };
  assert.deepEqual(parsePostCall(event), {
    conversationId: "conv_2",
    agentId: "agent_1",
    status: null,
    answers: {},
    summary: null,
  });
});

test("parsePostCall ignores other event types and malformed payloads", () => {
  assert.equal(parsePostCall({ type: "post_call_audio", data: { conversation_id: "conv_1" } }), null);
  assert.equal(parsePostCall({ type: "call_initiation_failure", data: {} }), null);
  assert.equal(parsePostCall({ type: "post_call_transcription", data: {} }), null);
  assert.equal(parsePostCall("nope"), null);
});
