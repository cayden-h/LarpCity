import rateLimit from "express-rate-limit";

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

export const strictLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Provider webhooks (Persona, ElevenLabs) come from the providers' servers and
 * retry in bursts, so they get their own, looser limit. It goes on each
 * webhook route rather than on the webhook routers' mounts: those mounts
 * share a path with the player routers, so a limiter there would count every
 * player request a second time.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
