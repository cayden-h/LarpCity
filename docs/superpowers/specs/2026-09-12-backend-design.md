# Larp City Backend — Design Spec

Date: 2026-09-12
Status: Approved for implementation (hackathon-grade, demo-first)
Deadline context: Devpost submission due 2026-09-13 09:00 CDT. This spec deliberately trades
future-proofing for "works live, securely, tomorrow morning."

## Problem

`game/` is a browser-only Vite/TypeScript/PixiJS app. Every third-party key it needs
(Persona, Nessie, ElevenLabs, Gemini, Backboard, the Tiger Data Postgres connection string) is
secret, so none of it can be called from the browser directly. `SETUP.md` already specifies the
intended integrations and a Postgres/TimescaleDB schema (`game/db/schema.sql`) exists and is
loaded with reference data, but no server code exists yet (confirmed: no `server/` directory,
no server dependencies in `game/package.json`, no auth/session code anywhere in the repo).

This spec covers building that server.

## Decisions locked in during brainstorming

- **Framing:** hackathon-grade, demo-first. Skip anything judges won't see (horizontal scaling,
  CI/CD, full test coverage, an admin panel). Do not skip anything that causes a live secret leak
  or a broken demo.
- **Integrations in scope:** all six — Persona, Capital One Nessie, ElevenLabs, Gemini, Backboard,
  Tiger Data/Postgres.
- **Player identity:** anonymous device session. First visit mints a random `playerId` (UUID),
  server sets a signed httpOnly cookie. No password, no email, no signup flow. A `players` row is
  created on first sight (reusing the existing `players.name UNIQUE NOT NULL` column — the cookie
  session generates a synthetic name like `guest-<shortid>` if the player never sets one).
- **Simulation authority:** stays client-side. `game/src/sim/**` (PlayerLife, market path, debt
  engine, skip/goal fast-forward) is unchanged. The server persists what the client reports and
  serves reference/AI data; it does not recompute or validate financial outcomes. Accepted
  tradeoff: a player could in theory post a fabricated snapshot to inflate a leaderboard entry.
  Not addressed in this pass — acceptable for a hackathon demo, called out explicitly so it is
  never mistaken for an oversight.
- **Framework:** Express + TypeScript + Zod (request validation). Chosen over Fastify/Hono for
  the most battle-tested security middleware ecosystem (helmet, express-rate-limit,
  cookie-session) and lowest risk of misconfiguration under time pressure.

## Architecture

```
browser (game/, unchanged sim)                    server (Node/Express, new, server/)
──────────────────────────────                    ───────────────────────────────────
session cookie (anon player id) ───────────────►  every /api/* route reads req.playerId
selfie (memory only) ──────────────────────────►  POST /api/persona/complete ──► Persona API
                                        Persona ──► POST /api/persona/webhook (HMAC-verified)
mic ────────────────────────────────────────────► GET /api/voice/signed-url ──► ElevenLabs Agent
narrator/news text ──────────────────────────────► POST /api/tts, /api/sfx (cached) ──► ElevenLabs
event/goal/bankruptcy payload ───────────────────► POST /api/feedback, /api/avatar ──► Gemini
decision facts, "why?" questions ────────────────► POST /api/coach/* ──► Backboard
bank dashboard ───────────────────────────────────► GET/POST /api/bank/* ──► Nessie
end-of-day/week state, skip results ─────────────► POST /api/snapshot, GET /api/history/*,
                                                     GET /api/leaderboard ──► Postgres (Tiger Data)
```

The server does two jobs: a thin secret-holding proxy in front of the five external providers,
and a persistence API in front of the existing Postgres schema. It never renders game logic.

## Layout

```
server/
  src/
    index.ts            # boot: env validation, middleware, mount routes, listen
    env.ts               # Zod-validated process.env parsing; refuses to boot if a required
                          # secret is missing
    db.ts                 # single pg.Pool against DATABASE_URL
    session.ts            # signed httpOnly cookie <-> playerId; creates players row on first sight
    logger.ts             # pino with a redaction list covering every secret env var name
    middleware/
      rateLimit.ts
      errorHandler.ts
    adapters/              # one thin typed client per external provider
      persona.ts
      nessie.ts
      elevenlabs.ts
      gemini.ts
      backboard.ts
    routes/                # one file per integration; Zod-validates input before calling
                            # an adapter or the DB
      persona.ts
      nessie.ts
      voice.ts
      ai.ts
      coach.ts
      snapshot.ts
      health.ts
  deploy/
    Caddyfile
    larp-server.service    # systemd unit template
  test/                     # adapter unit tests (mocked fetch): HMAC verification,
                             # Gemini key-rotation-on-429/503
  package.json
  tsconfig.json
```

## Endpoints

| Route | Method | Purpose | Provider |
| --- | --- | --- | --- |
| `/api/health` | GET | liveness check | — |
| `/api/persona/complete` | POST | poll inquiry result after client SDK completes, redact PII | Persona |
| `/api/persona/webhook` | POST | HMAC-verified async status (approved/declined/failed/expired) | Persona |
| `/api/voice/signed-url` | GET | short-lived wss URL for the onboarding voice agent | ElevenLabs |
| `/api/tts` | POST | cached TTS with word-timestamp captions | ElevenLabs |
| `/api/sfx` | POST | cached sound effect generation | ElevenLabs |
| `/api/avatar` | POST | selfie + style reference -> turnaround sprite sheet | Gemini |
| `/api/feedback` | POST | structured JSON coaching at goals/bankruptcy/swings | Gemini |
| `/api/news` | POST | post-skip digest generation | Gemini |
| `/api/coach/ask` | POST | RAG question against the player's cloned coach assistant | Backboard |
| `/api/coach/remember` | POST | store a short decision fact after a big choice | Backboard |
| `/api/bank/provision` | POST | create Nessie customer + checking/savings/credit accounts | Nessie |
| `/api/bank/sync` | POST | manual monthly mirror (paycheck deposit, savings transfer, purchases) | Nessie |
| `/api/bank/:accountId` | GET | balance + history for the in-game bank dashboard | Nessie |
| `/api/snapshot` | POST | batched end-of-day/week state, or bulk after a skip | Postgres |
| `/api/history/:runId` | GET | net-worth/portfolio series for charts and rewind | Postgres |
| `/api/leaderboard` | GET | latest snapshot per run, sorted by net worth | Postgres |

## Security posture

- Every secret stays server-side, imported only inside `adapters/`; only `VITE_`-prefixed values
  ever reach the browser bundle (Persona template id, environment id).
- `helmet()` on every response; `cors()` locked to `CORS_ORIGIN`, no wildcard.
- `express-rate-limit` on all `/api/*`, tighter limits on `/api/persona/*` and `/api/voice/*`
  (billed/quota-limited providers).
- The Persona webhook route is mounted before the JSON body parser (needs the raw body) and
  verifies `Persona-Signature` with `crypto.timingSafeEqual`; handler is idempotent, keyed on
  event id, since Persona retries up to 7 times and can deliver out of order.
- Persona PII is never persisted: read the inquiry's `approved`/`declined`/age-check result once,
  store only that boolean/enum, then call `DELETE /inquiries/{id}` immediately.
- Nessie customers are created with synthetic names (`Larp`/`LC-<id>`) only — real names are
  never sent, because `/enterprise/*` on Nessie is world-readable by every team.
- Gemini selfie bytes exist only in the request's memory for the duration of the call; never
  written to disk or the database. `GEMINI_API_KEYS` (comma-separated) rotate server-side on
  HTTP 429/503.
- Backboard: one cloned assistant per player (`cloneAssistant`), so memories never cross player
  boundaries.
- `/api/snapshot` validates day/value ranges and rate-limits per player; it explicitly does not
  attempt to detect fabricated values (see "simulation authority" decision above).
- Structured logging (pino) with a redaction list naming every secret env var, so an incidental
  log of a request/response object cannot leak a key.
- `env.ts` uses Zod to validate all required env vars at boot; the process exits immediately if
  one is missing, rather than silently sending `undefined` to a provider.

## Deployment

Unchanged from `SETUP.md`: one Vultr VPS running Caddy (HTTPS, serves `game/dist`, reverse-proxies
`/api/*` to Node on port 3000), systemd loads `/etc/larp-city/server.env` (mode 600). This spec
commits `server/deploy/Caddyfile` and `server/deploy/larp-server.service` as templates; the actual
SSH deploy to a live box is a manual step the team runs when ready, not automated here.

## Testing

Adapter-level unit tests with mocked `fetch`: Persona HMAC verification (valid/invalid/replayed
signature), Gemini key-rotation-on-429/503. No end-to-end suite. SETUP.md's existing per-provider
"Test first" curl checklists serve as the manual smoke test before the live demo.

## Explicitly out of scope

Horizontal scaling, CI pipeline, password/email auth, admin panel, automated Nessie monthly-sync
cron (a manually-triggered `/api/bank/sync` endpoint instead, to avoid designing background-job
error recovery under time pressure).
