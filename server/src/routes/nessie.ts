// server/src/routes/nessie.ts
// The bank routes: option B's Nessie mirror (src/mirror.ts). The game posts
// each month's statement entries for the session's player and the named NPCs,
// and reads a statement back for the in-game Bank app. Balances come from the
// mirror, not from Nessie's `balance`, which never changes after an account
// is created.
//
//   GET  /api/bank/status            Nessie is reachable (the game turns the mirror on)
//   POST /api/bank/:entity/open      { run, name?, opening } -> { run, reused, balances }
//   POST /api/bank/:entity/entries   { run, entries }        -> { posted, skipped, balances }
//   GET  /api/bank/:entity           this session's statement
//
// `:entity` is "player" or a named NPC ("npc-maya").
import { Router, type Request, type Response } from "express";
import type { z } from "zod";
import { Nessie, NessieError } from "../adapters/nessie.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { ENTITY, entriesBody, MirrorError, MirrorService, openBody } from "../mirror.js";

export const nessieRouter = Router();

export const mirror = new MirrorService(new Nessie({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY }), env.NESSIE_TAG);

/** Runs a handler and turns every failure into a JSON reply (Express 4 doesn't catch rejected promises). */
function handle(fn: (req: Request) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req)
      .then((body) => res.json(body))
      .catch((err: unknown) => {
        if (err instanceof MirrorError) return res.status(err.status).json({ error: err.message });
        if (err instanceof NessieError) {
          logger.error({ status: err.status, message: err.message }, "nessie request failed");
          return res.status(502).json({ error: "nessie_unavailable" });
        }
        logger.error({ err }, "bank route failed");
        return res.status(500).json({ error: "internal_error" });
      });
  };
}

function entityOf(req: Request): string {
  const entity = req.params.entity;
  if (!ENTITY.test(entity)) throw new MirrorError(404, "Unknown account holder.");
  return entity;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new MirrorError(400, "invalid body");
  return r.data;
}

nessieRouter.get("/status", handle(async () => ({ ok: true, ...(await mirror.status()) })));
nessieRouter.post("/:entity/open", handle(async (req) => mirror.open(req.playerId, entityOf(req), parse(openBody, req.body))));
nessieRouter.post("/:entity/entries", handle(async (req) => mirror.post(req.playerId, entityOf(req), parse(entriesBody, req.body))));
nessieRouter.get("/:entity", handle(async (req) => mirror.statement(req.playerId, entityOf(req))));
