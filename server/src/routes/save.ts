// server/src/routes/save.ts
// The player's profile and saved game (src/store/saves.ts), keyed by the
// session's player. The game calls GET /api/me once on boot to decide
// between resuming, building a life from the profile, and the intake.
//
//   GET    /api/me        -> { player, profile, save }
//   PUT    /api/profile   the confirmed intake          -> 204
//   PUT    /api/save      { runId, seed, version, gameDay, state, baseRev } -> { rev } | 409
//   DELETE /api/save      "New life": save, profile, and the run's end -> 204
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { handle, HttpError, parse, Reply } from "../http.js";
import { deleteLife, getProfile, getSave, putProfile, putSave, SaveConflict } from "../store/saves.js";
import { ownRun } from "./snapshot.js";

export const saveRouter = Router();

/** A 60-year save is under 1 MB once history is compacted (game/src/sim/save/codec.ts). */
export const MAX_STATE_BYTES = 1_500_000;

const dollars = z.number().finite().min(0).max(10_000_000);

export const profileBody = z.discriminatedUnion("source", [
  z.object({
    source: z.enum(["voice", "typed"]),
    job: z.string().max(60),
    salary: dollars,
    rent: dollars,
    debt: dollars,
    savings: dollars,
    state: z.string().regex(/^[A-Z]{2}$/),
  }),
  z.object({
    source: z.literal("skipped"),
    job: z.null(),
    salary: z.null(),
    rent: z.null(),
    debt: z.null(),
    savings: z.null(),
    state: z.string().regex(/^[A-Z]{2}$/),
  }),
]);

export const saveBody = z.object({
  runId: z.string().uuid(),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  version: z.number().int().min(1).max(1000),
  gameDay: z.number().int().min(0).max(100_000),
  state: z.record(z.unknown()).refine((s) => JSON.stringify(s).length <= MAX_STATE_BYTES, "save too large"),
  baseRev: z.number().int().min(1).nullable(),
});

saveRouter.get(
  "/me",
  handle(async (req) => {
    const { rows } = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM players WHERE id = $1`, [req.playerId]);
    const [profile, save] = await Promise.all([getProfile(pool, req.playerId), getSave(pool, req.playerId)]);
    return { player: rows[0] ?? { id: req.playerId, name: null }, profile, save };
  }),
);

saveRouter.put(
  "/profile",
  handle(async (req) => {
    await putProfile(pool, req.playerId, parse(profileBody, req.body));
    return new Reply(204, null);
  }),
);

saveRouter.put(
  "/save",
  handle(async (req) => {
    const body = parse(saveBody, req.body);
    const runId = await ownRun(req, body.runId);
    try {
      return { rev: await putSave(pool, req.playerId, { ...body, runId }) };
    } catch (err) {
      if (err instanceof SaveConflict) throw new HttpError(409, "save_conflict");
      throw err;
    }
  }),
);

saveRouter.delete(
  "/save",
  handle(async (req) => {
    await deleteLife(pool, req.playerId);
    return new Reply(204, null);
  }),
);
