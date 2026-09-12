// server/src/routes/ai.ts
// Gemini routes. Feedback and the newspaper are written from the run's own
// data in Tiger Data (src/ai/facts.ts), never from text the browser sends,
// and fall back to plain-text versions when Gemini is busy (src/ai/coach.ts).
//
//   POST /api/feedback  { runId, trigger: goal|bankruptcy|swing|recovery, day, goal? } -> { headline, tip, mood, source, model?, facts }
//   POST /api/news      { runId, from, to }                                   -> { stories, source, model?, facts }
//   POST /api/avatar    { selfieBase64, styleBase64 }                          -> { imageBase64 }  (verified adults only)
import { Router } from "express";
import { z } from "zod";
import { Gemini, GeminiError } from "../adapters/gemini.js";
import { coachFeedback, writeNews } from "../ai/coach.js";
import { crashAndRecovery, feedbackFacts, newsFacts } from "../ai/facts.js";
import { pool } from "../db.js";
import { env, geminiKeys, geminiTextModels } from "../env.js";
import { handle, HttpError, parse, type ErrorMap } from "../http.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { history, listEvents, playerVerified, type SnapshotRow } from "../store/runs.js";
import { ownRun } from "./snapshot.js";

export const aiRouter = Router();

export const gemini = new Gemini({ keys: geminiKeys, models: geminiTextModels });

/** The same moment asked twice (a re-render, a retry) costs one Gemini call. */
const cache = new Map<string, unknown>();
const CACHE_MAX = 500;
async function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const value = await make();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

const day = z.number().int().min(0).max(100_000);

const feedbackBody = z.object({
  runId: z.string(),
  trigger: z.enum(["goal", "bankruptcy", "swing", "recovery"]),
  day,
  /** The goal's name from the game's goal list, for the headline. */
  goal: z.string().regex(/^[A-Za-z0-9 $,.'()%-]{1,60}$/).optional(),
});

const newsBody = z
  .object({ runId: z.string(), from: day, to: day })
  .refine((b) => b.to >= b.from && b.to - b.from <= 60 * 366, "from..to must be forward and at most 60 years");

aiRouter.post(
  "/feedback",
  strictLimiter,
  handle(async (req) => {
    const b = parse(feedbackBody, req.body);
    const runId = await ownRun(req, b.runId);
    return cached(`${runId}|feedback|${b.trigger}|${b.day}|${b.goal ?? ""}`, async () => {
      const snaps = (await history(pool, runId, "day", Math.max(0, b.day - 100), b.day)) as SnapshotRow[];
      if (!snaps.length) throw new HttpError(409, "No snapshots recorded for that day yet.");
      const events = await listEvents(pool, runId, { from: Math.max(0, b.day - 180), to: b.day });
      let recoveryEvents = events;
      if (b.trigger === "recovery") {
        // Crashes and recoveries are rare, so a 10-year look-back of just those fits well under listEvents' cap;
        // trades are read only between the two.
        const marks = await listEvents(pool, runId, { from: Math.max(0, b.day - 3650), to: b.day, kinds: ["bear_market", "market_recovered"] });
        const pair = crashAndRecovery(b.day, marks);
        if (!pair) throw new HttpError(409, "No market recovery recorded for that day yet.");
        const trades = await listEvents(pool, runId, { from: pair.bear.day, to: pair.rec.day, kinds: ["trade"] });
        recoveryEvents = [...marks, ...trades];
      }
      const facts = feedbackFacts(b.trigger, b.day, snaps, events, b.goal, recoveryEvents);
      const r = await coachFeedback(gemini, facts);
      return { ...r.feedback, source: r.source, ...(r.model ? { model: r.model } : {}), facts };
    });
  }),
);

aiRouter.post(
  "/news",
  strictLimiter,
  handle(async (req) => {
    const b = parse(newsBody, req.body);
    const runId = await ownRun(req, b.runId);
    return cached(`${runId}|news|${b.from}|${b.to}`, async () => {
      const snaps = (await history(pool, runId, "day", b.from, b.to)) as SnapshotRow[];
      const events = await listEvents(pool, runId, { from: b.from, to: b.to });
      const facts = newsFacts(b.from, b.to, snaps, events);
      const r = await writeNews(gemini, facts);
      return { stories: r.stories, source: r.source, ...(r.model ? { model: r.model } : {}), facts };
    });
  }),
);

const avatarBody = z.object({
  selfieBase64: z.string().min(1).max(1_500_000),
  styleBase64: z.string().min(1).max(1_500_000),
});

const AVATAR_PROMPT =
  "Image 1 is the player. Image 2 is the art style. Draw a 4-column turnaround sheet (front, 3/4, side, back) " +
  "of this person as a chibi isometric citizen, full body, feet on one baseline, flat #FF00FF background.";

const avatarDown: ErrorMap = (err) => (err instanceof GeminiError ? new HttpError(502, "avatar_unavailable") : undefined);

// Gemini's terms require users to be 18+, so a selfie only goes to Gemini after Persona verifies an adult.
aiRouter.post(
  "/avatar",
  strictLimiter,
  handle(async (req) => {
    const b = parse(avatarBody, req.body);
    if (!(await playerVerified(pool, req.playerId))) throw new HttpError(403, "verify_first");
    const imageBase64 = await gemini.image(env.GEMINI_IMAGE_MODEL, AVATAR_PROMPT, [
      { mimeType: "image/jpeg", data: b.selfieBase64 },
      { mimeType: "image/png", data: b.styleBase64 },
    ]);
    return { imageBase64 };
  }, avatarDown),
);
