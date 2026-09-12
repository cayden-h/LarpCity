import { Router, raw } from "express";
import { z } from "zod";
import { getSignedVoiceUrl, speak, soundEffect } from "../adapters/elevenlabs.js";
import { parsePostCall, verifyElevenLabsSignature } from "../adapters/elevenlabs-webhook.js";
import { pool } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";

export const voiceRouter = Router();

voiceRouter.get("/signed-url", async (_req, res) => {
  try {
    const signedUrl = await getSignedVoiceUrl();
    res.json({ signedUrl });
  } catch (err) {
    logger.error({ err }, "elevenlabs signed url failed");
    res.status(502).json({ error: "voice_unavailable" });
  }
});

const ttsBody = z.object({
  text: z.string().min(1).max(2000),
  voice: z.enum(["narrator", "anchor"]),
});

/** The owl narrates on the expressive model (it performs [sighs] and the like); the news anchor needs speed more than drama. */
const NARRATOR_MODEL = "eleven_v3";
const ANCHOR_MODEL = "eleven_flash_v2_5";

voiceRouter.post("/tts", async (req, res) => {
  const parsed = ttsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const narrator = parsed.data.voice === "narrator";
  const voiceId = narrator ? env.ELEVENLABS_VOICE_NARRATOR : env.ELEVENLABS_VOICE_ANCHOR;
  try {
    const result = await speak(voiceId, parsed.data.text, narrator ? NARRATOR_MODEL : ANCHOR_MODEL);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "elevenlabs tts failed");
    res.status(502).json({ error: "voice_unavailable" });
  }
});

const sfxBody = z.object({
  prompt: z.string().min(1).max(200),
  durationSeconds: z.number().positive().max(10),
});

voiceRouter.post("/sfx", async (req, res) => {
  const parsed = sfxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const audioBase64 = await soundEffect(parsed.data.prompt, parsed.data.durationSeconds);
    res.json({ audioBase64 });
  } catch (err) {
    logger.error({ err }, "elevenlabs sfx failed");
    res.status(502).json({ error: "voice_unavailable" });
  }
});

const claimBody = z.object({ conversationId: z.string().min(1).max(200) });

// The browser learns its conversation id from the ElevenLabs client when the
// interview connects, then polls this after hanging up. The first player to
// claim an id owns it, whether the claim or the webhook arrives first.
voiceRouter.post("/interview/claim", async (req, res) => {
  const parsed = claimBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO voice_interviews (conversation_id, player_id) VALUES ($1, $2)
     ON CONFLICT (conversation_id)
       DO UPDATE SET player_id = COALESCE(voice_interviews.player_id, EXCLUDED.player_id)
     RETURNING player_id, received_at, status, answers, summary`,
    [parsed.data.conversationId, req.playerId],
  );
  const row = rows[0];
  if (row.player_id !== req.playerId) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!row.received_at) {
    res.json({ ready: false });
    return;
  }
  res.json({ ready: true, status: row.status, answers: row.answers, summary: row.summary });
});

export const voiceWebhookRouter = Router();

// ElevenLabs retries non-200 answers and disables the webhook after repeated
// failures, so only a bad signature or a database error gets one.
voiceWebhookRouter.post("/webhook", raw({ type: "*/*", limit: "5mb" }), async (req, res) => {
  const secret = env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).end();
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const signature = req.header("elevenlabs-signature");
  if (!signature || !verifyElevenLabsSignature(signature, rawBody, secret)) {
    res.status(401).end();
    return;
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    logger.warn({ err }, "elevenlabs webhook: invalid JSON after verified signature");
    res.status(400).end();
    return;
  }

  const call = parsePostCall(event);
  if (!call) {
    // Audio and call-failure events, which the game doesn't use.
    res.status(200).end();
    return;
  }
  if (call.agentId !== env.ELEVENLABS_AGENT_ID) {
    logger.warn({ agentId: call.agentId }, "elevenlabs webhook: call from another agent ignored");
    res.status(200).end();
    return;
  }

  try {
    await pool.query(
      `INSERT INTO voice_interviews (conversation_id, agent_id, status, answers, summary, received_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (conversation_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id, status = EXCLUDED.status, answers = EXCLUDED.answers,
         summary = EXCLUDED.summary, received_at = EXCLUDED.received_at`,
      [call.conversationId, call.agentId, call.status, JSON.stringify(call.answers), call.summary],
    );
    logger.info({ conversationId: call.conversationId }, "elevenlabs interview stored");
    res.status(200).end();
  } catch (err) {
    logger.error({ err }, "elevenlabs webhook: storing the interview failed");
    res.status(500).end();
  }
});
