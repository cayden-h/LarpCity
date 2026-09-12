// server/src/routes/nessie.ts
// The bank routes: option B's Nessie mirror (src/mirror.ts), mounted twice.
// /api/bank/*    — the 12 primary entities (player + the primary NPC roster), real live Nessie
//                  behind the existing fallback, capped at MAX_NPC_CUSTOMERS.
// /api/bank-bg/*  — the background NPC roster (game/src/data/background-npcs.ts): identical
//                  request/response shapes, but backed by a FailoverNessie built with
//                  { localOnly: true } (adapters/failover-nessie.ts), so these never reach live
//                  Nessie and never count against the 12-customer allowance.
import { Router, type Request } from "express";
import { FailoverNessie } from "../adapters/failover-nessie.js";
import { Nessie, NessieError } from "../adapters/nessie.js";
import { pool } from "../db.js";
import { env } from "../env.js";
import { handle, HttpError, parse, type ErrorMap } from "../http.js";
import { ENTITY, entriesBody, MirrorService, openBody } from "../mirror.js";
import { startReplaySweep } from "../replay.js";
import { LocalNessie } from "../store/local-nessie.js";

const liveNessie = new Nessie({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY });
const localNessie = new LocalNessie(pool);
const failoverNessie = new FailoverNessie(liveNessie, localNessie);
const backgroundNessie = new FailoverNessie(liveNessie, localNessie, { localOnly: true });
startReplaySweep(liveNessie, localNessie);

export const mirror = new MirrorService(failoverNessie, env.NESSIE_TAG);
/** BACKGROUND_NPC_COUNT (game/src/data/background-npcs.ts) plus headroom; local-only, so the cap here is just a sanity bound, not a shared-resource limit. */
export const backgroundMirror = new MirrorService(backgroundNessie, `${env.NESSIE_TAG}-bg`, 100);

/** A Nessie failure is a 502 to the game, never its message (which names Nessie's paths). */
const nessieDown: ErrorMap = (err) => (err instanceof NessieError ? new HttpError(502, "nessie_unavailable") : undefined);

function entityOf(req: Request): string {
  const entity = req.params.entity;
  if (!ENTITY.test(entity)) throw new HttpError(404, "Unknown account holder.");
  return entity;
}

function createBankRouter(service: MirrorService): Router {
  const router = Router();
  router.get("/status", handle(async () => ({ ok: true, ...(await service.status()) }), nessieDown));
  router.post("/:entity/open", handle(async (req) => service.open(req.playerId, entityOf(req), parse(openBody, req.body)), nessieDown));
  router.post("/:entity/entries", handle(async (req) => service.post(req.playerId, entityOf(req), parse(entriesBody, req.body)), nessieDown));
  router.get("/:entity", handle(async (req) => service.statement(req.playerId, entityOf(req)), nessieDown));
  return router;
}

export const nessieRouter = createBankRouter(mirror);
export const backgroundBankRouter = createBankRouter(backgroundMirror);
