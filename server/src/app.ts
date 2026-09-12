// server/src/app.ts
// The Express app: every middleware and route, in order. index.ts loads the
// repo-root .env first, then builds this and listens; tests build it directly.

import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./env.js";
import { generalLimiter, strictLimiter } from "./middleware/rateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { personaRouter, personaWebhookRouter } from "./routes/persona.js";
import { nessieRouter } from "./routes/nessie.js";
import { voiceRouter, voiceWebhookRouter } from "./routes/voice.js";
import { aiRouter } from "./routes/ai.js";
import { coachRouter } from "./routes/coach.js";
import { snapshotRouter } from "./routes/snapshot.js";
import { sessionMiddleware } from "./session.js";

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  app.use("/api", healthRouter);

  // Mounted before express.json(): the Persona and ElevenLabs HMAC checks need the exact raw body.
  // No limiter on these mounts: they share paths with the player routers below, so a limiter here
  // would count every player request twice. Each webhook route carries webhookLimiter itself.
  app.use("/api/persona", personaWebhookRouter);
  app.use("/api/voice", voiceWebhookRouter);

  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware);
  app.use(generalLimiter);

  app.use("/api/persona", strictLimiter, personaRouter);
  app.use("/api/bank", nessieRouter);
  app.use("/api/voice", strictLimiter, voiceRouter);
  app.use("/api", aiRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api", snapshotRouter);

  app.use(errorHandler);
  return app;
}
