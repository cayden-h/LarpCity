import { Router } from "express";
import { z } from "zod";
import { generateAvatar, generateFeedback, generateNewsDigest } from "../adapters/gemini.js";
import { logger } from "../logger.js";

export const aiRouter = Router();

const avatarBody = z.object({
  selfieBase64: z.string().min(1),
  styleBase64: z.string().min(1),
});

aiRouter.post("/avatar", async (req, res) => {
  const parsed = avatarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const imageBase64 = await generateAvatar(parsed.data.selfieBase64, parsed.data.styleBase64);
    res.json({ imageBase64 });
  } catch (err) {
    logger.error({ err }, "gemini avatar failed");
    res.status(502).json({ error: "avatar_unavailable" });
  }
});

const feedbackBody = z.object({ eventSummary: z.string().min(1).max(2000) });

aiRouter.post("/feedback", async (req, res) => {
  const parsed = feedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const feedback = await generateFeedback(parsed.data.eventSummary);
    res.json(feedback);
  } catch (err) {
    logger.error({ err }, "gemini feedback failed");
    res.status(502).json({ error: "feedback_unavailable" });
  }
});

const newsBody = z.object({ eventsSummary: z.string().min(1).max(4000) });

aiRouter.post("/news", async (req, res) => {
  const parsed = newsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const stories = await generateNewsDigest(parsed.data.eventsSummary);
    res.json({ stories });
  } catch (err) {
    logger.error({ err }, "gemini news failed");
    res.status(502).json({ error: "news_unavailable" });
  }
});
