// server/src/routes/coach.ts
import { Router } from "express";
import { z } from "zod";
import { backboard } from "../adapters/backboard.js";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const coachRouter = Router();

async function getOrCreateAssistantAndThread(playerId: string): Promise<{ assistantId: string; threadId: string }> {
  const { rows } = await pool.query(
    `SELECT backboard_assistant_id, backboard_thread_id FROM players WHERE id = $1`,
    [playerId],
  );
  let assistantId: string | null = rows[0]?.backboard_assistant_id ?? null;
  let threadId: string | null = rows[0]?.backboard_thread_id ?? null;

  if (!assistantId) {
    assistantId = await backboard.ensurePlayerAssistant(playerId, null);
    threadId = await backboard.createThread(assistantId);
    await pool.query(
      `UPDATE players SET backboard_assistant_id = $1, backboard_thread_id = $2 WHERE id = $3`,
      [assistantId, threadId, playerId],
    );
  }
  return { assistantId, threadId: threadId! };
}

const askBody = z.object({ question: z.string().min(1).max(1000), deep: z.boolean().default(false) });

coachRouter.post("/ask", async (req, res) => {
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const { assistantId, threadId } = await getOrCreateAssistantAndThread(req.playerId);
    const answer = await backboard.ask(assistantId, threadId, parsed.data.question, parsed.data.deep);
    res.json({ answer });
  } catch (err) {
    logger.error({ err }, "backboard ask failed");
    res.status(502).json({ error: "coach_unavailable" });
  }
});

const rememberBody = z.object({ fact: z.string().min(1).max(500) });

coachRouter.post("/remember", async (req, res) => {
  const parsed = rememberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const { assistantId, threadId } = await getOrCreateAssistantAndThread(req.playerId);
    await backboard.remember(assistantId, threadId, parsed.data.fact);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "backboard remember failed");
    res.status(502).json({ error: "coach_unavailable" });
  }
});
