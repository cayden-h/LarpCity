// server/src/routes/news.ts
// The one read path for the phone's News app, a calendar-day revisit, and (later) the post-skip
// digest: same query shape, a different day range.
//
//   GET /api/news/:runId  ?from&to   -> [{ id, day, kind, category, score, prominence, headline, blurb, impact, source, ... }]
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { handle, parse } from "../http.js";
import { listNewsStories } from "../news/store.js";
import { writeUnwrittenNews } from "../news/writer.js";
import { gemini } from "./ai.js";
import { ownRun } from "./snapshot.js";

export const newsRouter = Router();

const MAX_DAY = 100_000;
/** Caps how many stories one request can ask Gemini to write, so a big unread range can't fire hundreds of model calls in one request. */
const WRITE_CAP = 20;

export const feedQuery = z.object({
  from: z.coerce.number().int().min(0).max(MAX_DAY).default(0),
  to: z.coerce.number().int().min(0).max(MAX_DAY).default(MAX_DAY),
});

newsRouter.get(
  "/:runId",
  handle(async (req) => {
    const q = parse(feedQuery, req.query);
    const runId = await ownRun(req, req.params.runId);
    const branchId = runId; // root branch = run_id until server-side branching exists
    await writeUnwrittenNews(pool, gemini, runId, branchId, q.from, q.to, WRITE_CAP);
    return listNewsStories(pool, runId, branchId, q.from, q.to);
  }),
);
