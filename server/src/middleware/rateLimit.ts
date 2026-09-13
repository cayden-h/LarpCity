import rateLimit from "express-rate-limit";

/** The bank mirror's routes (/api/bank, /api/bank-bg), which carry bankLimiter instead. */
const isBankPath = (path: string) => /^\/api\/bank(-bg)?(\/|$)/.test(path);

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isBankPath(req.path),
});

/**
 * The bank mirror opens and posts one account per NPC (about 35 in a city), all
 * at once on boot and at each month's end. Under the general limit those bursts
 * used up the player's budget, so /api/me and saves got 429s and the game
 * booted offline. The mirror retries on its next tick, so it gets its own,
 * looser bucket and never starves the player's own requests.
 */
export const bankLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1_200,
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
