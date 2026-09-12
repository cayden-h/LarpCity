// server/src/routes/persona.ts
import { Router, raw } from "express";
import { z } from "zod";
import { getInquiry, redactInquiry, verifyWebhookSignature } from "../adapters/persona.js";
import { env } from "../env.js";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const personaRouter = Router();

const completeBody = z.object({ inquiryId: z.string().min(1).max(200) });

personaRouter.post("/complete", async (req, res) => {
  if (!env.PERSONA_API_KEY) {
    res.status(503).json({ error: "persona_not_configured" });
    return;
  }
  const parsed = completeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const inquiry = await getInquiry(parsed.data.inquiryId);
    const verified = inquiry.status === "approved" && inquiry.ageCheckPassed;
    await pool.query(
      `UPDATE players SET verified = $1, verified_at = now() WHERE id = $2`,
      [verified, req.playerId],
    );
    await redactInquiry(parsed.data.inquiryId);
    res.json({ verified });
  } catch (err) {
    logger.error({ err }, "persona complete failed");
    res.status(502).json({ error: "persona_unavailable" });
  }
});

const seenEventIds = new Set<string>();

export const personaWebhookRouter = Router();

personaWebhookRouter.post("/webhook", raw({ type: "*/*" }), (req, res) => {
  const secret = env.PERSONA_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).end();
    return;
  }
  const signatureHeader = req.header("Persona-Signature");
  const rawBody = (req.body as Buffer).toString("utf8");
  if (!signatureHeader || !verifyWebhookSignature(signatureHeader, rawBody, secret)) {
    res.status(401).end();
    return;
  }

  // Deviation from brief: the signature only proves the body wasn't tampered
  // with in transit, not that it's well-formed JSON. A verified-but-malformed
  // payload would otherwise throw synchronously inside this handler and crash
  // the process (same class of bug as the unguarded decodeURIComponent fixed
  // in session.ts). Guard the parse and respond 400 instead of letting it throw.
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    logger.warn({ err }, "persona webhook: invalid JSON after verified signature");
    res.status(400).end();
    return;
  }

  const eventId: string | undefined = event?.data?.id;
  if (eventId) {
    if (seenEventIds.has(eventId)) {
      res.status(200).end();
      return;
    }
    seenEventIds.add(eventId);
  }
  logger.info({ eventId, kind: event?.data?.attributes?.name }, "persona webhook received");
  res.status(200).end();
});
