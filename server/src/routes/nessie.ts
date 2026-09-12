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
import { Router, type Request } from "express";
import { FailoverNessie } from "../adapters/failover-nessie.js";
import { Nessie, NessieError } from "../adapters/nessie.js";
import { pool } from "../db.js";
import { env } from "../env.js";
import { handle, HttpError, parse, type ErrorMap } from "../http.js";
import { ENTITY, entriesBody, MirrorService, openBody } from "../mirror.js";
import { startReplaySweep } from "../replay.js";
import { LocalNessie } from "../store/local-nessie.js";

export const nessieRouter = Router();

const liveNessie = new Nessie({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY });
const localNessie = new LocalNessie(pool);
const failoverNessie = new FailoverNessie(liveNessie, localNessie);
startReplaySweep(liveNessie, localNessie);

export const mirror = new MirrorService(failoverNessie, env.NESSIE_TAG);

/** A Nessie failure is a 502 to the game, never its message (which names Nessie's paths). */
const nessieDown: ErrorMap = (err) => (err instanceof NessieError ? new HttpError(502, "nessie_unavailable") : undefined);

function entityOf(req: Request): string {
  const entity = req.params.entity;
  if (!ENTITY.test(entity)) throw new HttpError(404, "Unknown account holder.");
  return entity;
}

nessieRouter.get("/status", handle(async () => ({ ok: true, ...(await mirror.status()) }), nessieDown));
nessieRouter.post("/:entity/open", handle(async (req) => mirror.open(req.playerId, entityOf(req), parse(openBody, req.body)), nessieDown));
nessieRouter.post("/:entity/entries", handle(async (req) => mirror.post(req.playerId, entityOf(req), parse(entriesBody, req.body)), nessieDown));
nessieRouter.get("/:entity", handle(async (req) => mirror.statement(req.playerId, entityOf(req)), nessieDown));
