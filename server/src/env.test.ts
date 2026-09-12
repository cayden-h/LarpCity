import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "./env.js";

const VALID: NodeJS.ProcessEnv = {
  CORS_ORIGIN: "http://localhost:5173",
  SESSION_SECRET: "a".repeat(32),
  DATABASE_URL: "postgres://user:pass@host:5432/db",
  PERSONA_API_KEY: "persona_sandbox_x",
  PERSONA_WEBHOOK_SECRET: "wbhsec_x",
  NESSIE_API_KEY: "nessie_x",
  ELEVENLABS_API_KEY: "el_x",
  ELEVENLABS_AGENT_ID: "agent_x",
  ELEVENLABS_VOICE_MAYOR: "voice_1",
  ELEVENLABS_VOICE_ANCHOR: "voice_2",
  GEMINI_API_KEYS: "key1,key2",
  BACKBOARD_API_KEY: "bb_x",
  BACKBOARD_COACH_ASSISTANT_ID: "asst_x",
  BACKBOARD_SMALL_MODEL: "anthropic/claude-haiku-4-5",
  BACKBOARD_LARGE_MODEL: "anthropic/claude-sonnet-5",
};

test("parseEnv accepts a fully populated environment", () => {
  const result = parseEnv(VALID);
  assert.equal(result.CORS_ORIGIN, "http://localhost:5173");
  assert.equal(result.PORT, 3000);
});

test("parseEnv rejects a missing required secret", () => {
  const { NESSIE_API_KEY, ...missing } = VALID;
  assert.throws(() => parseEnv(missing));
});

test("Persona keys are optional, and blank counts as unset", () => {
  const { PERSONA_API_KEY, PERSONA_WEBHOOK_SECRET, ...withoutPersona } = VALID;
  assert.equal(parseEnv(withoutPersona).PERSONA_API_KEY, undefined);
  const blank = parseEnv({ ...VALID, PERSONA_API_KEY: "", PERSONA_WEBHOOK_SECRET: "" });
  assert.equal(blank.PERSONA_API_KEY, undefined);
  assert.equal(blank.PERSONA_WEBHOOK_SECRET, undefined);
});

test("parseEnv rejects a too-short session secret", () => {
  assert.throws(() => parseEnv({ ...VALID, SESSION_SECRET: "short" }));
});
