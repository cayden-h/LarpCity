import { Router } from "express";
import { z } from "zod";
import { getSignedVoiceUrl, speak, soundEffect } from "../adapters/elevenlabs.js";
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
  voice: z.enum(["mayor", "anchor"]),
});

voiceRouter.post("/tts", async (req, res) => {
  const parsed = ttsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const voiceId = parsed.data.voice === "mayor" ? env.ELEVENLABS_VOICE_MAYOR : env.ELEVENLABS_VOICE_ANCHOR;
  try {
    const result = await speak(voiceId, parsed.data.text);
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
