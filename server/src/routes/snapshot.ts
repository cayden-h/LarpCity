// server/src/routes/snapshot.ts
// The player's run in Tiger Data (src/store/runs.ts):
//
//   POST /api/runs               { seed }                -> 201 { runId }
//   POST /api/runs/:runId/fork   { throughDay }          -> 201 { runId }  a rewind's branch, with the run through that day
//   POST /api/snapshot           { runId, entries }      -> { stored }   one row per game day, latest wins
//   POST /api/events             { runId, events }       -> { stored }   once per event key
//   GET  /api/history/:runId     ?bucket=day|week|month&from&to   (week and month bucket the run's own rows)
//   GET  /api/events/:runId      ?from&to&kinds=a,b
//   GET  /api/leaderboard        each run's latest net worth
import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { env } from "../env.js";
import { handle, HttpError, parse, Reply } from "../http.js";
import { scoreAndStoreEvents } from "../news/pipeline.js";
import { createRun, forkRun, history, insertEvents, insertSnapshots, leaderboard, listEvents, ownsRun } from "../store/runs.js";

export const snapshotRouter = Router();

const DAY_ZERO_MS = Date.UTC(2000, 0, 1);

export function dayToTimestamp(day: number): string {
  return new Date(DAY_ZERO_MS + day * 86_400_000).toISOString();
}

const MAX_DAY = 100_000;
const day = z.number().int().min(0).max(MAX_DAY);
const money = z.number().finite();
const runId = z.string().uuid();

const startRunBody = z.object({ seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });

/** The last day a rewind's branch keeps from the run it leaves. */
export const forkBody = z.object({ throughDay: day });

export const snapshotBody = z.object({
  runId,
  entries: z
    .array(
      z.object({
        day,
        netWorth: money,
        checking: money,
        savings: money,
        brokerage: money,
        retirement: money,
        debt: money,
        you: money.optional(),
        held: money.optional(),
        autopilot: money.optional(),
      }),
    )
    .min(1)
    .max(5000),
});

export const eventsBody = z.object({
  runId,
  events: z
    .array(
      z.object({
        key: z.string().regex(/^\d{1,6}:\d{1,4}$/),
        day,
        kind: z.string().regex(/^[a-z_]{1,40}$/),
        payload: z.record(z.unknown()),
      }),
    )
    .min(1)
    .max(5000),
});

export const historyQuery = z.object({
  bucket: z.enum(["day", "week", "month"]).default("week"),
  from: z.coerce.number().int().min(0).max(MAX_DAY).default(0),
  to: z.coerce.number().int().min(0).max(MAX_DAY).default(MAX_DAY),
});

const eventsQuery = z.object({
  from: z.coerce.number().int().min(0).max(MAX_DAY).default(0),
  to: z.coerce.number().int().min(0).max(MAX_DAY).default(MAX_DAY),
  kinds: z
    .string()
    .regex(/^[a-z_]{1,40}(,[a-z_]{1,40})*$/)
    .transform((s) => s.split(","))
    .optional(),
});

/** The run id from the URL or body, after checking it belongs to this session's player. */
export async function ownRun(req: Request, id: unknown): Promise<string> {
  const r = runId.safeParse(id);
  if (!r.success) throw new HttpError(400, "invalid run id");
  if (!(await ownsRun(pool, req.playerId, r.data))) throw new HttpError(403, "forbidden");
  return r.data;
}

snapshotRouter.post(
  "/runs",
  handle(async (req) => new Reply(201, { runId: await createRun(pool, req.playerId, parse(startRunBody, req.body).seed) })),
);

snapshotRouter.post(
  "/runs/:runId/fork",
  handle(async (req) => {
    const { throughDay } = parse(forkBody, req.body);
    return new Reply(201, { runId: await forkRun(pool, await ownRun(req, req.params.runId), throughDay) });
  }),
);

snapshotRouter.post(
  "/snapshot",
  handle(async (req) => {
    const body = parse(snapshotBody, req.body);
    return { stored: await insertSnapshots(pool, await ownRun(req, body.runId), body.entries) };
  }),
);

snapshotRouter.post(
  "/events",
  handle(async (req) => {
    const body = parse(eventsBody, req.body);
    const runId = await ownRun(req, body.runId);
    // Scores before inserting: priorKindCounts reads the events table, and scoring after insert would
    // count this batch's own rows, making a kind's first occurrence in the batch look like a repeat
    // (server/src/news/pipeline.ts's file header has the full reasoning).
    await scoreAndStoreEvents(pool, runId, body.events);
    return { stored: await insertEvents(pool, runId, body.events) };
  }),
);

snapshotRouter.get(
  "/history/:runId",
  handle(async (req) => {
    const q = parse(historyQuery, req.query);
    return history(pool, await ownRun(req, req.params.runId), q.bucket, q.from, q.to);
  }),
);

snapshotRouter.get(
  "/events/:runId",
  handle(async (req) => {
    const q = parse(eventsQuery, req.query);
    return listEvents(pool, await ownRun(req, req.params.runId), q);
  }),
);

// Only verified players rank once the Persona gate is live; until then everyone does.
snapshotRouter.get("/leaderboard", handle(async () => leaderboard(pool, Boolean(env.PERSONA_API_KEY))));
