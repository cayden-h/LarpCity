# Larp City Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `server/`, a Node/TypeScript/Express backend that holds every third-party secret
(Persona, Nessie, ElevenLabs, Gemini, Backboard, Tiger Data/Postgres) server-side and exposes a
small `/api/*` surface the existing browser game can call, without touching the client-side
simulation in `game/src/sim/**`.

**Architecture:** One Express app. `adapters/` hold one thin typed client per external provider
(isolating each provider's quirks). `routes/` validate input with Zod and call an adapter or the
DB. `session.ts` mints an anonymous signed-cookie `playerId` per browser on first visit — no
password, no signup. The Postgres schema in `game/db/schema.sql` is reused as-is; `server/src/migrations.sql`
additively extends the `players` table with server-owned columns (verification flag, provider ids).
Simulation results (net worth, debt, etc.) are computed entirely client-side and merely persisted
by `/api/snapshot`.

**Tech Stack:** Node 22, TypeScript (ESM, `NodeNext` module resolution), Express 4, Zod, `pg`,
pino, `@elevenlabs/elevenlabs-js`, `backboard-sdk`, `tsx` (dev runner + test loader), Node's
built-in `node:test` runner (matches `game/`'s existing convention — no Jest/Vitest).

## Global Constraints

- Node 22 (matches the Vultr provisioning script in `SETUP.md`).
- `"type": "module"` throughout `server/`; all relative imports use explicit `.js` extensions
  (TypeScript + `NodeNext` resolution requirement) even though the source files are `.ts`.
- No secret env var may be imported outside files in `server/src/adapters/` or `server/src/env.ts`.
- No env var may be read directly via `process.env.X` outside `env.ts` — always import the
  validated `env` object.
- Every `/api/*` route validates its input with a Zod schema before touching an adapter or the DB.
- Nessie customers are created with synthetic names only (`Larp` / `<tag>-<id prefix>`) — never a
  real name.
- Persona's raw inquiry/selfie data is never written to Postgres or disk — only the
  approved/declined boolean.
- Tests use `node --import tsx --test <glob>`; no new test framework dependency.
- Every task ends with a commit.

---

### Task 1: Server scaffold — env validation, logger, health route, bootable app

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/.gitignore`
- Create: `server/src/env.ts`
- Create: `server/src/env.test.ts`
- Create: `server/src/logger.ts`
- Create: `server/src/middleware/rateLimit.ts`
- Create: `server/src/middleware/errorHandler.ts`
- Create: `server/src/routes/health.ts`
- Create: `server/src/index.ts`
- Modify: `.env.example` (repo root) — add `SESSION_SECRET`

**Interfaces:**
- Produces: `parseEnv(raw: NodeJS.ProcessEnv): Env`, `env: Env` (both from `env.ts`) — every later
  task imports `{ env }` from `../env.js`.
- Produces: `logger` (pino instance) from `logger.ts` — every later task imports `{ logger }` from
  `../logger.js`.
- Produces: `generalLimiter`, `strictLimiter` (Express `RequestHandler`) from `middleware/rateLimit.ts`.
- Produces: `errorHandler` (Express `ErrorRequestHandler`) from `middleware/errorHandler.ts`.
- Produces: `healthRouter` (Express `Router`) from `routes/health.ts`.

- [ ] **Step 1: Create the server package**

```json
// server/package.json
{
  "name": "larp-city-server",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "node --import tsx --test src/**/*.test.ts"
  },
  "dependencies": {
    "@elevenlabs/elevenlabs-js": "^2.9.0",
    "backboard-sdk": "^1.5.16",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "express-rate-limit": "^7.4.1",
    "helmet": "^8.0.0",
    "pg": "^8.13.1",
    "pino": "^9.5.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.2",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "~5.7.2"
  }
}
```

```json
// server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

```
# server/.gitignore
node_modules/
dist/
.cache/
```

- [ ] **Step 2: Write env.ts with a testable parse function**

```ts
// server/src/env.ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  DATABASE_URL: z.string().min(1),

  PERSONA_API_KEY: z.string().min(1),
  PERSONA_WEBHOOK_SECRET: z.string().min(1),
  PERSONA_API_VERSION: z.string().min(1).default("2025-12-08"),

  NESSIE_API_KEY: z.string().min(1),
  NESSIE_BASE_URL: z.string().url().default("https://api.nessieisreal.com"),
  NESSIE_TAG: z.string().min(1).default("larpcity"),

  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_AGENT_ID: z.string().min(1),
  ELEVENLABS_VOICE_MAYOR: z.string().min(1),
  ELEVENLABS_VOICE_ANCHOR: z.string().min(1),

  GEMINI_API_KEYS: z.string().min(1),
  GEMINI_TEXT_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  GEMINI_IMAGE_MODEL: z.string().min(1).default("gemini-3.1-flash-image"),

  BACKBOARD_API_KEY: z.string().min(1),
  BACKBOARD_COACH_ASSISTANT_ID: z.string().min(1),
  BACKBOARD_SMALL_MODEL: z.string().min(1),
  BACKBOARD_LARGE_MODEL: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  return schema.parse(raw);
}

export const env: Env = parseEnv(process.env);

export const geminiKeys: string[] = env.GEMINI_API_KEYS.split(",")
  .map((k) => k.trim())
  .filter(Boolean);
```

- [ ] **Step 3: Write the failing test for parseEnv**

```ts
// server/src/env.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "./env.js";

const VALID: NodeJS.ProcessEnv = {
  CORS_ORIGIN: "http://localhost:5173",
  SESSION_SECRET: "a".repeat(32),
  DATABASE_URL: "postgres://user:pass@host:5432/db",
  PERSONA_API_KEY: "persona_sandbox_x",
  PERSONA_WEBHOOK_SECRET: "wbhsec_x",
  NESSIE_API_KEY: "nessie_x",
  ELEVENLABS_API_KEY: "el_x",
  ELEVENLABS_AGENT_ID: "agent_x",
  ELEVENLABS_VOICE_MAYOR: "voice_1",
  ELEVENLABS_VOICE_ANCHOR: "voice_2",
  GEMINI_API_KEYS: "key1,key2",
  BACKBOARD_API_KEY: "bb_x",
  BACKBOARD_COACH_ASSISTANT_ID: "asst_x",
  BACKBOARD_SMALL_MODEL: "anthropic/claude-haiku-4-5",
  BACKBOARD_LARGE_MODEL: "anthropic/claude-sonnet-5",
};

test("parseEnv accepts a fully populated environment", () => {
  const result = parseEnv(VALID);
  assert.equal(result.CORS_ORIGIN, "http://localhost:5173");
  assert.equal(result.PORT, 3000);
});

test("parseEnv rejects a missing required secret", () => {
  const { PERSONA_API_KEY, ...missing } = VALID;
  assert.throws(() => parseEnv(missing));
});

test("parseEnv rejects a too-short session secret", () => {
  assert.throws(() => parseEnv({ ...VALID, SESSION_SECRET: "short" }));
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && npm install && npm test`
Expected: FAIL (module `./env.js` doesn't exist as compiled output yet, or test file not found —
confirm the failure is about the missing test wiring, not a passing assertion) — since `env.ts`
already exists, if it fails only on `npm install` not being run yet, run `npm install` first.

- [ ] **Step 5: Confirm test passes**

Run: `cd server && npm test`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 6: Write logger.ts**

```ts
// server/src/logger.ts
import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.api_key",
      "*.password",
      "*.secret",
    ],
    remove: true,
  },
});
```

- [ ] **Step 7: Write rate limit and error handler middleware**

```ts
// server/src/middleware/rateLimit.ts
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
```

```ts
// server/src/middleware/errorHandler.ts
import type { ErrorRequestHandler } from "express";
import { logger } from "../logger.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error({ err }, "unhandled request error");
  res.status(500).json({ error: "internal_error" });
};
```

- [ ] **Step 8: Write the health route**

```ts
// server/src/routes/health.ts
import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});
```

- [ ] **Step 9: Write index.ts — bootable app with only health wired in**

```ts
// server/src/index.ts
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keys live in the repo-root .env (see SETUP.md); load it before anything
// else touches process.env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { generalLimiter } from "./middleware/rateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(generalLimiter);

app.use("/api", healthRouter);

app.use(errorHandler);

app.listen(env.PORT, () => logger.info({ port: env.PORT }, "larp-city server listening"));
```

- [ ] **Step 10: Manually verify the server boots**

Run: `cd server && cp ../.env.example ../.env` (fill in placeholder values so `env.ts` doesn't
throw — for a local smoke test any non-empty string satisfies the schema) then `npm run dev`.
Expected: log line `"larp-city server listening"`, then `curl localhost:3000/api/health` returns
`{"ok":true}`.

- [ ] **Step 11: Add SESSION_SECRET to the root .env.example**

Modify `.env.example`, right after the `CORS_ORIGIN=http://localhost:5173` line:

```
PORT=3000
CORS_ORIGIN=http://localhost:5173
SESSION_SECRET=
```

- [ ] **Step 12: Commit**

```bash
git add server/package.json server/tsconfig.json server/.gitignore server/src/env.ts \
  server/src/env.test.ts server/src/logger.ts server/src/middleware/rateLimit.ts \
  server/src/middleware/errorHandler.ts server/src/routes/health.ts server/src/index.ts \
  .env.example
git commit -m "server: scaffold Express app with validated env, logger, health route"
```

---

### Task 2: Postgres pool, additive migrations, anonymous session cookie

**Files:**
- Create: `server/src/db.ts`
- Create: `server/src/migrations.sql`
- Create: `server/src/session.ts`
- Create: `server/src/session.test.ts`
- Modify: `server/src/index.ts:1-30` (mount migrations-on-boot and session middleware)

**Interfaces:**
- Consumes: `env` from `./env.js` (Task 1), `logger` from `./logger.js` (Task 1).
- Produces: `pool: pg.Pool`, `runMigrations(): Promise<void>` from `db.ts` — every later task that
  touches Postgres imports `{ pool }` from `../db.js`.
- Produces: `sign(secret: string, value: string): string`, `unsign(secret: string, signed: string): string | null`
  (pure, exported for testing), and `sessionMiddleware` (Express `RequestHandler`, augments
  `req.playerId: string`) from `session.ts`.

- [ ] **Step 1: Write the additive migrations file**

```sql
-- server/src/migrations.sql
-- Additive only: never drops or renames a column from game/db/schema.sql.
-- Safe to run on every boot against the already-provisioned Tiger Data instance.

ALTER TABLE players ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_customer_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_checking_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_savings_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nessie_credit_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS backboard_assistant_id text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS backboard_thread_id text;
```

- [ ] **Step 2: Write db.ts**

```ts
// server/src/db.ts
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { env } from "./env.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, "migrations.sql"), "utf8");
  await pool.query(sql);
  logger.info("server migrations applied");
}
```

- [ ] **Step 3: Write the failing test for the cookie sign/unsign helpers**

```ts
// server/src/session.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, unsign } from "./session.js";

test("unsign recovers the original value after sign", () => {
  const signed = sign("secret-key-123", "player-abc");
  assert.equal(unsign("secret-key-123", signed), "player-abc");
});

test("unsign rejects a tampered value", () => {
  const signed = sign("secret-key-123", "player-abc");
  const tampered = signed.replace("player-abc", "player-xyz");
  assert.equal(unsign("secret-key-123", tampered), null);
});

test("unsign rejects a value signed with a different secret", () => {
  const signed = sign("secret-key-123", "player-abc");
  assert.equal(unsign("different-secret", signed), null);
});

test("unsign rejects a malformed cookie", () => {
  assert.equal(unsign("secret-key-123", "not-a-signed-value"), null);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `session.ts` does not exist yet.

- [ ] **Step 5: Write session.ts**

```ts
// server/src/session.ts
import type { Request, Response, NextFunction } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "./db.js";
import { env } from "./env.js";

const COOKIE_NAME = "larp_session";

declare module "express-serve-static-core" {
  interface Request {
    playerId: string;
  }
}

export function sign(secret: string, value: string): string {
  const sig = createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${sig}`;
}

export function unsign(secret: string, signed: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(value).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(sig, "hex");
  } catch {
    return null;
  }
  if (expectedBuf.length !== actualBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return null;
  return value;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookies = parseCookies(req.header("cookie"));
  const raw = cookies[COOKIE_NAME];
  let playerId = raw ? unsign(env.SESSION_SECRET, raw) : null;

  if (!playerId) {
    playerId = randomUUID();
    res.cookie(COOKIE_NAME, sign(env.SESSION_SECRET, playerId), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }

  req.playerId = playerId;

  try {
    await pool.query(
      `INSERT INTO players (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [playerId, `guest-${playerId.slice(0, 8)}`],
    );
    next();
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS — all `session.test.ts` cases green (these are pure-function tests; no live
database connection is needed since `sign`/`unsign` don't touch `pool`).

- [ ] **Step 7: Wire migrations and session into index.ts**

Modify `server/src/index.ts`, replacing the block from `const app = express();` through
`app.use("/api", healthRouter);`:

```ts
import { runMigrations } from "./db.js";
import { sessionMiddleware } from "./session.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(sessionMiddleware);
app.use(generalLimiter);

app.use("/api", healthRouter);

app.use(errorHandler);

async function main(): Promise<void> {
  await runMigrations();
  app.listen(env.PORT, () => logger.info({ port: env.PORT }, "larp-city server listening"));
}

main().catch((err) => {
  logger.error({ err }, "server failed to start");
  process.exit(1);
});
```

Remove the old bare `app.listen(...)` call at the bottom of the file (replaced by `main()` above).

- [ ] **Step 8: Manually verify against a real database**

Run: `cd server && npm run dev` (with a real `DATABASE_URL` in the root `.env`).
Expected: log line `"server migrations applied"`, then `"larp-city server listening"`. Then
`curl -i localhost:3000/api/health -c /tmp/larp-cookie.txt` and confirm a `Set-Cookie: larp_session=...`
header appears, and `psql "$DATABASE_URL" -c "select id, name from players order by created_at desc limit 1"`
shows the new row.

- [ ] **Step 9: Commit**

```bash
git add server/src/db.ts server/src/migrations.sql server/src/session.ts \
  server/src/session.test.ts server/src/index.ts
git commit -m "server: add Postgres pool, additive migrations, anonymous session cookie"
```

---

### Task 3: Persona adapter and routes (identity verification)

**Files:**
- Create: `server/src/adapters/persona.ts`
- Create: `server/src/adapters/persona.test.ts`
- Create: `server/src/routes/persona.ts`
- Modify: `server/src/index.ts` (mount the webhook router before the JSON body parser, mount the
  regular router after)

**Interfaces:**
- Consumes: `env` from `../env.js`, `pool` from `../db.js`, `logger` from `../logger.js`.
- Produces: `getInquiry(inquiryId: string): Promise<PersonaInquiry>`,
  `redactInquiry(inquiryId: string): Promise<void>`,
  `verifyWebhookSignature(signatureHeader: string, rawBody: string, secret: string): boolean`
  from `adapters/persona.ts`.
- Produces: `personaRouter` (mount at `/api/persona`, needs JSON body + session),
  `personaWebhookRouter` (mount at `/api/persona`, needs the **raw** body, must be mounted before
  `express.json()`) from `routes/persona.ts`.

- [ ] **Step 1: Write the failing test for webhook signature verification**

```ts
// server/src/adapters/persona.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "./persona.js";

function sign(secret: string, t: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${digest}`;
}

test("verifyWebhookSignature accepts a correctly signed body", () => {
  const body = JSON.stringify({ data: { id: "evt_1" } });
  const header = sign("whsec_test", "1700000000", body);
  assert.equal(verifyWebhookSignature(header, body, "whsec_test"), true);
});

test("verifyWebhookSignature rejects a tampered body", () => {
  const body = JSON.stringify({ data: { id: "evt_1" } });
  const header = sign("whsec_test", "1700000000", body);
  assert.equal(verifyWebhookSignature(header, body + "x", "whsec_test"), false);
});

test("verifyWebhookSignature rejects the wrong secret", () => {
  const body = JSON.stringify({ data: { id: "evt_1" } });
  const header = sign("whsec_test", "1700000000", body);
  assert.equal(verifyWebhookSignature(header, body, "whsec_other"), false);
});

test("verifyWebhookSignature rejects a malformed header", () => {
  assert.equal(verifyWebhookSignature("not-a-valid-header", "{}", "whsec_test"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `adapters/persona.ts` does not exist yet.

- [ ] **Step 3: Write adapters/persona.ts**

```ts
// server/src/adapters/persona.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

const BASE = "https://api.withpersona.com/api/v1";

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.PERSONA_API_KEY}`,
    "Persona-Version": env.PERSONA_API_VERSION,
  };
}

export interface PersonaInquiry {
  id: string;
  status: string;
  ageCheckPassed: boolean;
}

export async function getInquiry(inquiryId: string): Promise<PersonaInquiry> {
  const r = await fetch(`${BASE}/inquiries/${inquiryId}?include=verifications`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`Persona GET inquiry ${r.status}`);
  const body = (await r.json()) as any;
  const status: string = body.data?.attributes?.status ?? "unknown";
  const included: any[] = body.included ?? [];
  const selfie = included.find((v) => v.type === "verification/selfie");
  const checks: any[] = selfie?.attributes?.checks ?? [];
  const ageCheck = checks.find((c) => c.name === "selfie_age_comparison");
  return { id: inquiryId, status, ageCheckPassed: ageCheck?.status === "passed" };
}

export async function redactInquiry(inquiryId: string): Promise<void> {
  const r = await fetch(`${BASE}/inquiries/${inquiryId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok && r.status !== 404) throw new Error(`Persona DELETE inquiry ${r.status}`);
}

export function verifyWebhookSignature(signatureHeader: string, rawBody: string, secret: string): boolean {
  const map = new Map<string, string>();
  for (const pair of signatureHeader.split(",")) {
    const [k, v] = pair.trim().split("=");
    if (k && v) map.set(k, v);
  }
  const t = map.get("t");
  const v1 = map.get("v1");
  if (!t || !v1) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(v1, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS — all four `persona.test.ts` cases green.

- [ ] **Step 5: Write routes/persona.ts**

```ts
// server/src/routes/persona.ts
import { Router, raw } from "express";
import { z } from "zod";
import { getInquiry, redactInquiry, verifyWebhookSignature } from "../adapters/persona.js";
import { env } from "../env.js";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const personaRouter = Router();

const completeBody = z.object({ inquiryId: z.string().min(1).max(200) });

personaRouter.post("/complete", async (req, res) => {
  const parsed = completeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const inquiry = await getInquiry(parsed.data.inquiryId);
    const verified = inquiry.status === "approved" && inquiry.ageCheckPassed;
    await pool.query(
      `UPDATE players SET verified = $1, verified_at = now() WHERE id = $2`,
      [verified, req.playerId],
    );
    await redactInquiry(parsed.data.inquiryId);
    res.json({ verified });
  } catch (err) {
    logger.error({ err }, "persona complete failed");
    res.status(502).json({ error: "persona_unavailable" });
  }
});

const seenEventIds = new Set<string>();

export const personaWebhookRouter = Router();

personaWebhookRouter.post("/webhook", raw({ type: "*/*" }), (req, res) => {
  const signatureHeader = req.header("Persona-Signature");
  const rawBody = (req.body as Buffer).toString("utf8");
  if (!signatureHeader || !verifyWebhookSignature(signatureHeader, rawBody, env.PERSONA_WEBHOOK_SECRET)) {
    res.status(401).end();
    return;
  }
  const event = JSON.parse(rawBody);
  const eventId: string | undefined = event?.data?.id;
  if (eventId) {
    if (seenEventIds.has(eventId)) {
      res.status(200).end();
      return;
    }
    seenEventIds.add(eventId);
  }
  logger.info({ eventId, kind: event?.data?.attributes?.name }, "persona webhook received");
  res.status(200).end();
});
```

- [ ] **Step 6: Mount both routers in index.ts with the correct ordering**

Modify `server/src/index.ts`: import the routers, and mount `personaWebhookRouter` **before**
`express.json()` (it needs the raw body), and `personaRouter` after `sessionMiddleware` (it needs
`req.playerId`):

```ts
import { personaRouter, personaWebhookRouter } from "./routes/persona.js";
import { strictLimiter } from "./middleware/rateLimit.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

// Mounted before express.json(): Persona's HMAC check needs the exact raw body.
app.use("/api/persona", strictLimiter, personaWebhookRouter);

app.use(express.json({ limit: "2mb" }));
app.use(sessionMiddleware);
app.use(generalLimiter);

app.use("/api", healthRouter);
app.use("/api/persona", strictLimiter, personaRouter);

app.use(errorHandler);
```

- [ ] **Step 7: Commit**

```bash
git add server/src/adapters/persona.ts server/src/adapters/persona.test.ts \
  server/src/routes/persona.ts server/src/index.ts
git commit -m "server: add Persona identity verification adapter and routes"
```

---

### Task 4: Nessie adapter and routes (bank ledger)

**Files:**
- Create: `server/src/adapters/nessie.ts`
- Create: `server/src/adapters/nessie.test.ts`
- Create: `server/src/routes/nessie.ts`
- Modify: `server/src/index.ts` (mount `nessieRouter` at `/api/bank`)

**Interfaces:**
- Consumes: `env` from `../env.js`, `pool` from `../db.js`, `logger` from `../logger.js`.
- Produces: `provisionPlayer(playerId: string): Promise<NessieAccounts>`,
  `getAccount(accountId: string): Promise<unknown>`,
  `postDeposit(accountId: string, amount: number, description: string): Promise<unknown>`
  from `adapters/nessie.ts`, where
  `interface NessieAccounts { customerId: string; checkingId: string; savingsId: string; creditId: string }`.
- Produces: `nessieRouter` (mount at `/api/bank`) from `routes/nessie.ts`.

- [ ] **Step 1: Write the failing test for the low-level nessie() request wrapper behavior**

```ts
// server/src/adapters/nessie.test.ts
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAccount } from "./nessie.js";

afterEach(() => {
  mock.reset();
});

test("getAccount unwraps a plain JSON response", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ _id: "acc_1", balance: 500 }), { status: 200 }),
  );
  const result = await getAccount("acc_1");
  assert.deepEqual(result, { _id: "acc_1", balance: 500 });
});

test("getAccount throws on a non-ok response", async () => {
  mock.method(globalThis, "fetch", async () => new Response("not found", { status: 404 }));
  await assert.rejects(() => getAccount("missing"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `adapters/nessie.ts` does not exist yet.

- [ ] **Step 3: Write adapters/nessie.ts**

```ts
// server/src/adapters/nessie.ts
import { env } from "../env.js";

async function nessie<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${env.NESSIE_BASE_URL}${path}?key=${env.NESSIE_API_KEY}`;
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Nessie ${method} ${path} ${r.status} ${await r.text()}`);
  const j = (await r.json()) as any;
  return (j.objectCreated ?? j) as T;
}

export interface NessieAccounts {
  customerId: string;
  checkingId: string;
  savingsId: string;
  creditId: string;
}

export async function provisionPlayer(playerId: string): Promise<NessieAccounts> {
  const customer = await nessie<{ _id: string }>("POST", "/customers", {
    first_name: "Larp",
    last_name: `${env.NESSIE_TAG}-${playerId.slice(0, 6)}`,
    address: { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" },
  });

  const open = (type: string, balance: number) =>
    nessie<{ _id: string }>("POST", `/customers/${customer._id}/accounts`, {
      type,
      nickname: `${env.NESSIE_TAG}:${playerId}:${type}`,
      rewards: 0,
      balance,
    });

  const [checking, savings, credit] = await Promise.all([
    open("Checking", 500),
    open("Savings", 0),
    open("Credit Card", 0),
  ]);

  return {
    customerId: customer._id,
    checkingId: checking._id,
    savingsId: savings._id,
    creditId: credit._id,
  };
}

export async function getAccount(accountId: string): Promise<unknown> {
  return nessie("GET", `/accounts/${accountId}`);
}

export async function postDeposit(accountId: string, amount: number, description: string): Promise<unknown> {
  return nessie("POST", `/accounts/${accountId}/deposits`, {
    medium: "balance",
    transaction_date: new Date().toISOString().slice(0, 10),
    status: "completed",
    amount,
    description,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Write routes/nessie.ts with an ownership check**

A player must only be able to read or post to a Nessie account id that the server itself
provisioned for that player — otherwise any player could pass another player's account id and
read or move their money.

```ts
// server/src/routes/nessie.ts
import { Router } from "express";
import { z } from "zod";
import { provisionPlayer, getAccount, postDeposit } from "../adapters/nessie.js";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const nessieRouter = Router();

async function ownsAccount(playerId: string, accountId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM players
     WHERE id = $1 AND $2 IN (nessie_checking_id, nessie_savings_id, nessie_credit_id)`,
    [playerId, accountId],
  );
  return rows.length > 0;
}

nessieRouter.post("/provision", async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT nessie_checking_id, nessie_savings_id, nessie_credit_id FROM players WHERE id = $1`,
      [req.playerId],
    );
    const row = existing.rows[0];
    if (row?.nessie_checking_id) {
      res.json({
        checkingId: row.nessie_checking_id,
        savingsId: row.nessie_savings_id,
        creditId: row.nessie_credit_id,
      });
      return;
    }
    const accounts = await provisionPlayer(req.playerId);
    await pool.query(
      `UPDATE players
       SET nessie_customer_id = $1, nessie_checking_id = $2, nessie_savings_id = $3, nessie_credit_id = $4
       WHERE id = $5`,
      [accounts.customerId, accounts.checkingId, accounts.savingsId, accounts.creditId, req.playerId],
    );
    res.json({ checkingId: accounts.checkingId, savingsId: accounts.savingsId, creditId: accounts.creditId });
  } catch (err) {
    logger.error({ err }, "nessie provision failed");
    res.status(502).json({ error: "nessie_unavailable" });
  }
});

const syncBody = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive().max(1_000_000),
  description: z.string().min(1).max(200),
});

nessieRouter.post("/sync", async (req, res) => {
  const parsed = syncBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  if (!(await ownsAccount(req.playerId, parsed.data.accountId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const result = await postDeposit(parsed.data.accountId, parsed.data.amount, parsed.data.description);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "nessie sync failed");
    res.status(502).json({ error: "nessie_unavailable" });
  }
});

nessieRouter.get("/:accountId", async (req, res) => {
  if (!(await ownsAccount(req.playerId, req.params.accountId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const account = await getAccount(req.params.accountId);
    res.json(account);
  } catch (err) {
    logger.error({ err }, "nessie get account failed");
    res.status(502).json({ error: "nessie_unavailable" });
  }
});
```

- [ ] **Step 6: Mount the router in index.ts**

Modify `server/src/index.ts`, adding after the persona router line:

```ts
import { nessieRouter } from "./routes/nessie.js";
```

```ts
app.use("/api/bank", nessieRouter);
```

- [ ] **Step 7: Commit**

```bash
git add server/src/adapters/nessie.ts server/src/adapters/nessie.test.ts \
  server/src/routes/nessie.ts server/src/index.ts
git commit -m "server: add Nessie bank ledger adapter and ownership-checked routes"
```

---

### Task 5: ElevenLabs adapter and routes (voice onboarding, narration, sfx)

**Files:**
- Create: `server/src/adapters/elevenlabs.ts`
- Create: `server/src/adapters/elevenlabs.test.ts`
- Create: `server/src/routes/voice.ts`
- Modify: `server/src/index.ts` (mount `voiceRouter` at `/api/voice`)

**Interfaces:**
- Consumes: `env` from `../env.js`.
- Produces: `buildCaptions(characters: string[], starts: number[]): { word: string; start: number }[]`
  (pure, exported for testing), `getSignedVoiceUrl(): Promise<string>`,
  `speak(voiceId: string, text: string): Promise<{ audioBase64: string; words: { word: string; start: number }[] }>`,
  `soundEffect(promptText: string, durationSeconds: number): Promise<string>` from `adapters/elevenlabs.ts`.
- Produces: `voiceRouter` (mount at `/api/voice`) from `routes/voice.ts`.

- [ ] **Step 1: Write the failing test for the caption word-grouping logic**

```ts
// server/src/adapters/elevenlabs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptions } from "./elevenlabs.js";

test("buildCaptions groups characters into words at spaces", () => {
  const chars = ["h", "i", " ", "y", "o", "u"];
  const starts = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
  assert.deepEqual(buildCaptions(chars, starts), [
    { word: "hi", start: 0.0 },
    { word: "you", start: 0.3 },
  ]);
});

test("buildCaptions handles a single word with no spaces", () => {
  const chars = ["o", "k"];
  const starts = [1.0, 1.1];
  assert.deepEqual(buildCaptions(chars, starts), [{ word: "ok", start: 1.0 }]);
});

test("buildCaptions returns an empty array for empty input", () => {
  assert.deepEqual(buildCaptions([], []), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `adapters/elevenlabs.ts` does not exist yet.

- [ ] **Step 3: Write adapters/elevenlabs.ts**

```ts
// server/src/adapters/elevenlabs.ts
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";

const client = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY });
const CACHE_DIR = path.join(process.cwd(), ".cache", "voice");

export function buildCaptions(characters: string[], starts: number[]): { word: string; start: number }[] {
  const words: { word: string; start: number }[] = [];
  let current = "";
  let wordStart = starts[0] ?? 0;
  characters.forEach((ch, i) => {
    if (ch === " ") {
      if (current) words.push({ word: current, start: wordStart });
      current = "";
      wordStart = starts[i + 1] ?? wordStart;
    } else {
      if (!current) wordStart = starts[i] ?? wordStart;
      current += ch;
    }
  });
  if (current) words.push({ word: current, start: wordStart });
  return words;
}

async function readCache(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function getSignedVoiceUrl(): Promise<string> {
  const r = (await client.conversationalAi.conversations.getSignedUrl({
    agentId: env.ELEVENLABS_AGENT_ID,
  })) as any;
  return r.signedUrl ?? r.signed_url;
}

export async function speak(
  voiceId: string,
  text: string,
): Promise<{ audioBase64: string; words: { word: string; start: number }[] }> {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash("sha256").update(`tts|${voiceId}|eleven_flash_v2_5|${text}`).digest("hex");
  const audioFile = path.join(CACHE_DIR, `${key}.mp3`);
  const captionsFile = path.join(CACHE_DIR, `${key}.json`);

  const cachedAudio = await readCache(audioFile);
  if (cachedAudio) {
    const cachedCaptions = await readFile(captionsFile, "utf8").catch(() => "[]");
    return { audioBase64: cachedAudio.toString("base64"), words: JSON.parse(cachedCaptions) };
  }

  const result = (await client.textToSpeech.convertWithTimestamps(voiceId, {
    text,
    modelId: "eleven_flash_v2_5",
  })) as any;
  const audioBase64: string = result.audioBase64 ?? result.audio_base64;
  const alignment = result.alignment ?? result.normalized_alignment ?? {};
  const characters: string[] = alignment.characters ?? [];
  const starts: number[] = alignment.character_start_times_seconds ?? [];
  const words = buildCaptions(characters, starts);

  const buffer = Buffer.from(audioBase64, "base64");
  await writeFile(audioFile, buffer);
  await writeFile(captionsFile, JSON.stringify(words));

  return { audioBase64, words };
}

export async function soundEffect(promptText: string, durationSeconds: number): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash("sha256").update(`sfx|${promptText}|${durationSeconds}`).digest("hex");
  const file = path.join(CACHE_DIR, `${key}.mp3`);

  const cached = await readCache(file);
  if (cached) return cached.toString("base64");

  const audio = (await client.textToSoundEffects.convert({
    text: promptText,
    durationSeconds,
    promptInfluence: 0.5,
  })) as AsyncIterable<Buffer>;
  const buffer = await streamToBuffer(audio);
  await writeFile(file, buffer);
  return buffer.toString("base64");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Write routes/voice.ts**

```ts
// server/src/routes/voice.ts
import { Router } from "express";
import { z } from "zod";
import { getSignedVoiceUrl, speak, soundEffect } from "../adapters/elevenlabs.js";
import { env } from "../env.js";
import { logger } from "../logger.js";

export const voiceRouter = Router();

voiceRouter.get("/signed-url", async (_req, res) => {
  try {
    const signedUrl = await getSignedVoiceUrl();
    res.json({ signedUrl });
  } catch (err) {
    logger.error({ err }, "elevenlabs signed url failed");
    res.status(502).json({ error: "voice_unavailable" });
  }
});

const ttsBody = z.object({
  text: z.string().min(1).max(2000),
  voice: z.enum(["mayor", "anchor"]),
});

voiceRouter.post("/tts", async (req, res) => {
  const parsed = ttsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const voiceId = parsed.data.voice === "mayor" ? env.ELEVENLABS_VOICE_MAYOR : env.ELEVENLABS_VOICE_ANCHOR;
  try {
    const result = await speak(voiceId, parsed.data.text);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "elevenlabs tts failed");
    res.status(502).json({ error: "voice_unavailable" });
  }
});

const sfxBody = z.object({
  prompt: z.string().min(1).max(200),
  durationSeconds: z.number().positive().max(10),
});

voiceRouter.post("/sfx", async (req, res) => {
  const parsed = sfxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const audioBase64 = await soundEffect(parsed.data.prompt, parsed.data.durationSeconds);
    res.json({ audioBase64 });
  } catch (err) {
    logger.error({ err }, "elevenlabs sfx failed");
    res.status(502).json({ error: "voice_unavailable" });
  }
});
```

- [ ] **Step 6: Mount the router in index.ts**

```ts
import { voiceRouter } from "./routes/voice.js";
```

```ts
app.use("/api/voice", strictLimiter, voiceRouter);
```

- [ ] **Step 7: Commit**

```bash
git add server/src/adapters/elevenlabs.ts server/src/adapters/elevenlabs.test.ts \
  server/src/routes/voice.ts server/src/index.ts
git commit -m "server: add ElevenLabs voice, narration, and sfx adapter and routes"
```

---

### Task 6: Gemini adapter and routes (avatar, feedback, news) with key rotation

**Files:**
- Create: `server/src/adapters/gemini.ts`
- Create: `server/src/adapters/gemini.test.ts`
- Create: `server/src/routes/ai.ts`
- Modify: `server/src/index.ts` (mount `aiRouter` at `/api`)

**Interfaces:**
- Consumes: `env` from `../env.js`, `logger` from `../logger.js`.
- Produces: `callGemini(model: string, body: unknown): Promise<any>` (exported for testing),
  `generateAvatar(selfieBase64: string, styleBase64: string): Promise<string>`,
  `generateFeedback(eventSummary: string): Promise<Feedback>`,
  `generateNewsDigest(eventsSummary: string): Promise<NewsStory[]>` from `adapters/gemini.ts`,
  where `interface Feedback { headline: string; tip: string; mood: "cheer" | "warn" | "console" }`
  and `interface NewsStory { title: string; where: string; blurb: string; impact: string }`.
- Produces: `aiRouter` (mount at `/api`) from `routes/ai.ts`.

**Note on Gemini API choice:** SETUP.md documents both the newer "Interactions API"
(`ai.interactions.create`) and the long-stable REST `generateContent` endpoint. This task uses
`generateContent` directly via `fetch` (no SDK dependency) because it is the better-documented,
less likely to have breaking changes under time pressure, and keeps the adapter dependency-free.

- [ ] **Step 1: Write the failing test for key rotation on 429/503**

```ts
// server/src/adapters/gemini.test.ts
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callGemini } from "./gemini.js";

afterEach(() => {
  mock.reset();
});

test("callGemini rotates to the next key on 429 and succeeds", async () => {
  let call = 0;
  mock.method(globalThis, "fetch", async () => {
    call += 1;
    if (call === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const result = await callGemini("gemini-3.8-flash", { contents: [] });
  assert.deepEqual(result, { ok: true });
  assert.equal(call, 2);
});

test("callGemini throws when every key is exhausted", async () => {
  mock.method(globalThis, "fetch", async () => new Response("overloaded", { status: 503 }));
  await assert.rejects(() => callGemini("gemini-3.8-flash", { contents: [] }));
});

test("callGemini throws immediately on a non-retryable error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("bad request", { status: 400 }));
  await assert.rejects(() => callGemini("gemini-3.8-flash", { contents: [] }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `adapters/gemini.ts` does not exist yet. (Note: `GEMINI_API_KEYS` in the test
environment's `.env`/`env.ts` must contain at least two comma-separated values for the rotation
test to meaningfully exercise two calls; the shared test env in Task 1 already sets `"key1,key2"`.)

- [ ] **Step 3: Write adapters/gemini.ts**

```ts
// server/src/adapters/gemini.ts
import { env, geminiKeys } from "../env.js";
import { logger } from "../logger.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function callGemini(model: string, body: unknown): Promise<any> {
  let lastError: unknown;
  for (const key of geminiKeys) {
    const r = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status === 503) {
      lastError = new Error(`Gemini ${model} ${r.status}`);
      logger.warn({ status: r.status }, "gemini key exhausted, rotating");
      continue;
    }
    throw new Error(`Gemini ${model} ${r.status} ${await r.text()}`);
  }
  throw lastError ?? new Error("Gemini: no keys configured");
}

export async function generateAvatar(selfieBase64: string, styleBase64: string): Promise<string> {
  const result = await callGemini(env.GEMINI_IMAGE_MODEL, {
    contents: [
      {
        parts: [
          {
            text:
              "Image 1 is the player. Image 2 is the art style. Draw a 4-column turnaround " +
              "sheet (front, 3/4, side, back) of this person as a chibi isometric citizen, " +
              "full body, feet on one baseline, flat #FF00FF background.",
          },
          { inlineData: { mimeType: "image/jpeg", data: selfieBase64 } },
          { inlineData: { mimeType: "image/png", data: styleBase64 } },
        ],
      },
    ],
  });
  const part = result.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!part) throw new Error("Gemini returned no image");
  return part.inlineData.data as string;
}

export interface Feedback {
  headline: string;
  tip: string;
  mood: "cheer" | "warn" | "console";
}

export async function generateFeedback(eventSummary: string): Promise<Feedback> {
  const result = await callGemini(env.GEMINI_TEXT_MODEL, {
    contents: [
      {
        parts: [
          {
            text:
              `Player event: ${eventSummary}. Give short, kind financial coaching as JSON ` +
              `with keys headline, tip, mood (cheer|warn|console).`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no feedback text");
  return JSON.parse(text) as Feedback;
}

export interface NewsStory {
  title: string;
  where: string;
  blurb: string;
  impact: string;
}

export async function generateNewsDigest(eventsSummary: string): Promise<NewsStory[]> {
  const result = await callGemini(env.GEMINI_TEXT_MODEL, {
    contents: [
      {
        parts: [
          {
            text:
              `Summarize these skipped game events into a short newspaper digest as JSON ` +
              `{"stories": [{"title","where","blurb","impact"}]}: ${eventsSummary}`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no digest text");
  const parsed = JSON.parse(text);
  return parsed.stories as NewsStory[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Write routes/ai.ts**

```ts
// server/src/routes/ai.ts
import { Router } from "express";
import { z } from "zod";
import { generateAvatar, generateFeedback, generateNewsDigest } from "../adapters/gemini.js";
import { logger } from "../logger.js";

export const aiRouter = Router();

const avatarBody = z.object({
  selfieBase64: z.string().min(1),
  styleBase64: z.string().min(1),
});

aiRouter.post("/avatar", async (req, res) => {
  const parsed = avatarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const imageBase64 = await generateAvatar(parsed.data.selfieBase64, parsed.data.styleBase64);
    res.json({ imageBase64 });
  } catch (err) {
    logger.error({ err }, "gemini avatar failed");
    res.status(502).json({ error: "avatar_unavailable" });
  }
});

const feedbackBody = z.object({ eventSummary: z.string().min(1).max(2000) });

aiRouter.post("/feedback", async (req, res) => {
  const parsed = feedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const feedback = await generateFeedback(parsed.data.eventSummary);
    res.json(feedback);
  } catch (err) {
    logger.error({ err }, "gemini feedback failed");
    res.status(502).json({ error: "feedback_unavailable" });
  }
});

const newsBody = z.object({ eventsSummary: z.string().min(1).max(4000) });

aiRouter.post("/news", async (req, res) => {
  const parsed = newsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const stories = await generateNewsDigest(parsed.data.eventsSummary);
    res.json({ stories });
  } catch (err) {
    logger.error({ err }, "gemini news failed");
    res.status(502).json({ error: "news_unavailable" });
  }
});
```

- [ ] **Step 6: Mount the router in index.ts**

```ts
import { aiRouter } from "./routes/ai.js";
```

```ts
app.use("/api", aiRouter);
```

- [ ] **Step 7: Commit**

```bash
git add server/src/adapters/gemini.ts server/src/adapters/gemini.test.ts \
  server/src/routes/ai.ts server/src/index.ts
git commit -m "server: add Gemini avatar/feedback/news adapter with key rotation"
```

---

### Task 7: Backboard adapter and routes (AI memory/RAG coach)

**Files:**
- Create: `server/src/adapters/backboard.ts`
- Create: `server/src/adapters/backboard.test.ts`
- Create: `server/src/routes/coach.ts`
- Modify: `server/src/index.ts` (mount `coachRouter` at `/api/coach`)

**Interfaces:**
- Consumes: `env` from `../env.js`, `pool` from `../db.js`, `logger` from `../logger.js`.
- Produces: `createBackboardAdapter(client: BackboardClientLike): BackboardAdapter` (dependency-
  injectable factory, exported for testing) and `backboard: BackboardAdapter` (the real, wired-up
  instance) from `adapters/backboard.ts`, where
  `interface BackboardAdapter { ensurePlayerAssistant(playerId: string, existingAssistantId: string | null): Promise<string>; createThread(assistantId: string): Promise<string>; ask(assistantId: string, threadId: string, content: string, deep: boolean): Promise<string>; remember(assistantId: string, threadId: string, fact: string): Promise<void> }`.
- Produces: `coachRouter` (mount at `/api/coach`) from `routes/coach.ts`.

- [ ] **Step 1: Write the failing test using a fake client (no network, no real SDK)**

```ts
// server/src/adapters/backboard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackboardAdapter, type BackboardClientLike } from "./backboard.js";

function fakeClient(overrides: Partial<BackboardClientLike> = {}): BackboardClientLike {
  return {
    cloneAssistant: async () => ({ assistantId: "asst_clone_1" }),
    createThread: async () => ({ threadId: "thread_1" }),
    sendMessage: async () => ({ content: "you're doing great" }),
    ...overrides,
  };
}

test("ensurePlayerAssistant returns the existing id without cloning", async () => {
  let cloned = false;
  const adapter = createBackboardAdapter(
    fakeClient({ cloneAssistant: async () => { cloned = true; return { assistantId: "should-not-happen" }; } }),
  );
  const id = await adapter.ensurePlayerAssistant("player-1", "asst_existing");
  assert.equal(id, "asst_existing");
  assert.equal(cloned, false);
});

test("ensurePlayerAssistant clones a new assistant when none exists", async () => {
  const adapter = createBackboardAdapter(fakeClient());
  const id = await adapter.ensurePlayerAssistant("player-1", null);
  assert.equal(id, "asst_clone_1");
});

test("ask returns the message content from sendMessage", async () => {
  const adapter = createBackboardAdapter(fakeClient());
  const answer = await adapter.ask("asst_1", "thread_1", "why did I go bankrupt?", false);
  assert.equal(answer, "you're doing great");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `adapters/backboard.ts` does not exist yet.

- [ ] **Step 3: Write adapters/backboard.ts**

```ts
// server/src/adapters/backboard.ts
import { BackboardClient } from "backboard-sdk";
import { env } from "../env.js";

export interface BackboardClientLike {
  cloneAssistant(assistantId: string, opts: { name: string; copy_documents: boolean }): Promise<any>;
  createThread(assistantId: string): Promise<any>;
  sendMessage(opts: {
    assistantId: string;
    threadId: string;
    content: string;
    memory: "Auto" | "Readonly";
    stream: boolean;
    llm_provider: string;
    model_name: string;
  }): Promise<any>;
}

export interface BackboardAdapter {
  ensurePlayerAssistant(playerId: string, existingAssistantId: string | null): Promise<string>;
  createThread(assistantId: string): Promise<string>;
  ask(assistantId: string, threadId: string, content: string, deep: boolean): Promise<string>;
  remember(assistantId: string, threadId: string, fact: string): Promise<void>;
}

export function createBackboardAdapter(client: BackboardClientLike): BackboardAdapter {
  function modelFor(deep: boolean): [string, string] {
    const modelString = deep ? env.BACKBOARD_LARGE_MODEL : env.BACKBOARD_SMALL_MODEL;
    const [provider, model] = modelString.split("/");
    return [provider, model];
  }

  return {
    async ensurePlayerAssistant(playerId, existingAssistantId) {
      if (existingAssistantId) return existingAssistantId;
      const clone = await client.cloneAssistant(env.BACKBOARD_COACH_ASSISTANT_ID, {
        name: `player-${playerId}`,
        copy_documents: true,
      });
      return clone.assistantId ?? clone.assistant_id;
    },

    async createThread(assistantId) {
      const thread = await client.createThread(assistantId);
      return thread.threadId ?? thread.thread_id;
    },

    async ask(assistantId, threadId, content, deep) {
      const [provider, model] = modelFor(deep);
      const r = await client.sendMessage({
        assistantId,
        threadId,
        content,
        memory: "Readonly",
        stream: false,
        llm_provider: provider,
        model_name: model,
      });
      return r.content ?? r.message ?? "";
    },

    async remember(assistantId, threadId, fact) {
      const [provider, model] = modelFor(false);
      await client.sendMessage({
        assistantId,
        threadId,
        content: fact,
        memory: "Auto",
        stream: false,
        llm_provider: provider,
        model_name: model,
      });
    },
  };
}

const realClient = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY });
export const backboard: BackboardAdapter = createBackboardAdapter(realClient as unknown as BackboardClientLike);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Write routes/coach.ts**

```ts
// server/src/routes/coach.ts
import { Router } from "express";
import { z } from "zod";
import { backboard } from "../adapters/backboard.js";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const coachRouter = Router();

async function getOrCreateAssistantAndThread(playerId: string): Promise<{ assistantId: string; threadId: string }> {
  const { rows } = await pool.query(
    `SELECT backboard_assistant_id, backboard_thread_id FROM players WHERE id = $1`,
    [playerId],
  );
  let assistantId: string | null = rows[0]?.backboard_assistant_id ?? null;
  let threadId: string | null = rows[0]?.backboard_thread_id ?? null;

  if (!assistantId) {
    assistantId = await backboard.ensurePlayerAssistant(playerId, null);
    threadId = await backboard.createThread(assistantId);
    await pool.query(
      `UPDATE players SET backboard_assistant_id = $1, backboard_thread_id = $2 WHERE id = $3`,
      [assistantId, threadId, playerId],
    );
  }
  return { assistantId, threadId: threadId! };
}

const askBody = z.object({ question: z.string().min(1).max(1000), deep: z.boolean().default(false) });

coachRouter.post("/ask", async (req, res) => {
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const { assistantId, threadId } = await getOrCreateAssistantAndThread(req.playerId);
    const answer = await backboard.ask(assistantId, threadId, parsed.data.question, parsed.data.deep);
    res.json({ answer });
  } catch (err) {
    logger.error({ err }, "backboard ask failed");
    res.status(502).json({ error: "coach_unavailable" });
  }
});

const rememberBody = z.object({ fact: z.string().min(1).max(500) });

coachRouter.post("/remember", async (req, res) => {
  const parsed = rememberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const { assistantId, threadId } = await getOrCreateAssistantAndThread(req.playerId);
    await backboard.remember(assistantId, threadId, parsed.data.fact);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "backboard remember failed");
    res.status(502).json({ error: "coach_unavailable" });
  }
});
```

- [ ] **Step 6: Mount the router in index.ts**

```ts
import { coachRouter } from "./routes/coach.js";
```

```ts
app.use("/api/coach", coachRouter);
```

- [ ] **Step 7: Commit**

```bash
git add server/src/adapters/backboard.ts server/src/adapters/backboard.test.ts \
  server/src/routes/coach.ts server/src/index.ts
git commit -m "server: add Backboard AI memory/RAG coach adapter and routes"
```

---

### Task 8: Snapshot, history, and leaderboard routes (Tiger Data persistence)

**Files:**
- Create: `server/src/routes/snapshot.ts`
- Create: `server/src/routes/snapshot.test.ts`
- Modify: `server/src/index.ts` (mount `snapshotRouter` at `/api`)

**Interfaces:**
- Consumes: `pool` from `../db.js`, `logger` from `../logger.js`.
- Produces: `dayToTimestamp(day: number): string` (pure, exported for testing), `snapshotRouter`
  (mount at `/api`) from `routes/snapshot.ts`. Depends on the `runs` and `player_snapshots` tables
  already defined in `game/db/schema.sql` (Task 2's migrations do not touch them).

- [ ] **Step 1: Write the failing test for the day-to-timestamp conversion and schema validation**

```ts
// server/src/routes/snapshot.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayToTimestamp } from "./snapshot.js";

test("dayToTimestamp maps day 0 to 2000-01-01", () => {
  assert.equal(dayToTimestamp(0), "2000-01-01T00:00:00.000Z");
});

test("dayToTimestamp maps day 365 to 2001-01-01 (2000 is a leap year)", () => {
  assert.equal(dayToTimestamp(366), "2001-01-01T00:00:00.000Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `routes/snapshot.ts` does not exist yet.

- [ ] **Step 3: Write routes/snapshot.ts**

```ts
// server/src/routes/snapshot.ts
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { logger } from "../logger.js";

export const snapshotRouter = Router();

const DAY_ZERO_MS = Date.UTC(2000, 0, 1);

export function dayToTimestamp(day: number): string {
  return new Date(DAY_ZERO_MS + day * 86_400_000).toISOString();
}

const startRunBody = z.object({ seed: z.number().int() });

snapshotRouter.post("/runs", async (req, res) => {
  const parsed = startRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const runId = randomUUID();
  try {
    await pool.query(`INSERT INTO runs (id, player_id, seed) VALUES ($1, $2, $3)`, [
      runId,
      req.playerId,
      parsed.data.seed,
    ]);
    res.status(201).json({ runId });
  } catch (err) {
    logger.error({ err }, "run creation failed");
    res.status(500).json({ error: "run_creation_failed" });
  }
});

async function ownsRun(playerId: string, runId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM runs WHERE id = $1 AND player_id = $2`, [runId, playerId]);
  return rows.length > 0;
}

const snapshotEntry = z.object({
  day: z.number().int().min(0).max(100_000),
  netWorth: z.number().finite(),
  checking: z.number().finite(),
  savings: z.number().finite(),
  brokerage: z.number().finite(),
  retirement: z.number().finite(),
  debt: z.number().finite(),
});

const snapshotBody = z.object({
  runId: z.string().uuid(),
  entries: z.array(snapshotEntry).min(1).max(5000),
});

snapshotRouter.post("/snapshot", async (req, res) => {
  const parsed = snapshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const { runId, entries } = parsed.data;
  if (!(await ownsRun(req.playerId, runId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO player_snapshots (ts, run_id, day, net_worth, checking, savings, brokerage, retirement, debt)
       SELECT '2000-01-01'::timestamptz + d * interval '1 day', $1, d, nw, ch, sv, br, rt, dt
       FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[])
         AS t(d, nw, ch, sv, br, rt, dt)
       ON CONFLICT DO NOTHING`,
      [
        runId,
        entries.map((e) => e.day),
        entries.map((e) => e.netWorth),
        entries.map((e) => e.checking),
        entries.map((e) => e.savings),
        entries.map((e) => e.brokerage),
        entries.map((e) => e.retirement),
        entries.map((e) => e.debt),
      ],
    );
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "snapshot insert failed");
    res.status(500).json({ error: "snapshot_failed" });
  }
});

snapshotRouter.get("/history/:runId", async (req, res) => {
  if (!(await ownsRun(req.playerId, req.params.runId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT day, net_worth, checking, savings, brokerage, retirement, debt
     FROM player_snapshots WHERE run_id = $1 ORDER BY day ASC`,
    [req.params.runId],
  );
  res.json(rows);
});

snapshotRouter.get("/leaderboard", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.name, s.day, s.net_worth
    FROM (
      SELECT DISTINCT ON (run_id) run_id, day, net_worth
      FROM player_snapshots ORDER BY run_id, ts DESC
    ) s
    JOIN runs r ON r.id = s.run_id
    JOIN players p ON p.id = r.player_id
    WHERE p.verified = true
    ORDER BY s.net_worth DESC
    LIMIT 50
  `);
  res.json(rows);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Mount the router in index.ts**

```ts
import { snapshotRouter } from "./routes/snapshot.js";
```

```ts
app.use("/api", snapshotRouter);
```

- [ ] **Step 6: Manually verify end to end against a real database**

Run: `cd server && npm run dev`, then:
```
curl -s -c /tmp/c.txt -b /tmp/c.txt -X POST localhost:3000/api/runs \
  -H 'Content-Type: application/json' -d '{"seed": 42}'
```
Expected: `{"runId":"<uuid>"}`. Then post one snapshot entry to `/api/snapshot` with that `runId`
and confirm `GET /api/history/<runId>` returns it.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/snapshot.ts server/src/routes/snapshot.test.ts server/src/index.ts
git commit -m "server: add snapshot, history, and leaderboard persistence routes"
```

---

### Task 9: Deployment templates and server README

**Files:**
- Create: `server/deploy/Caddyfile`
- Create: `server/deploy/larp-server.service`
- Create: `server/README.md`

**Interfaces:**
- None — these are static deployment artifacts, not imported by any code.

- [ ] **Step 1: Write the Caddyfile template**

```
# server/deploy/Caddyfile
# Copy to /etc/caddy/Caddyfile on the Vultr box; replace {$DOMAIN} via an env var
# or hardcode the real domain once registered (see SETUP.md > Domain).
{$DOMAIN} {
  encode gzip

  handle /api/* {
    reverse_proxy localhost:3000
  }

  handle {
    root * /var/www/larp-city
    try_files {path} /index.html
    file_server
  }
}
```

- [ ] **Step 2: Write the systemd unit template**

```ini
# server/deploy/larp-server.service
# Copy to /etc/systemd/system/larp-server.service on the Vultr box.
[Unit]
Description=Larp City backend
After=network.target

[Service]
User=larp
WorkingDirectory=/home/larp/larp-city/server
EnvironmentFile=/etc/larp-city/server.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write server/README.md**

```markdown
# Larp City server

Node/Express backend that holds every third-party secret (Persona, Nessie, ElevenLabs, Gemini,
Backboard, Tiger Data/Postgres) and exposes `/api/*` to the browser game in `../game`. See
`docs/superpowers/specs/2026-09-12-backend-design.md` for the design and `../SETUP.md` for how to
obtain each provider's keys.

## Local development

1. Fill in the repo-root `.env` (copy `.env.example`; see `SETUP.md` for where each key comes from).
2. `npm install`
3. `npm run dev` — starts on `PORT` (default 3000), applies additive migrations on boot, and
   serves `/api/health`.

## Tests

`npm test` runs `node --import tsx --test` over every `*.test.ts` file. These are adapter-level
unit tests with mocked `fetch`/injected fake clients — no live database or external API calls are
made during `npm test`.

## Deploy

See `deploy/Caddyfile` and `deploy/larp-server.service`, and the Vultr section of `../SETUP.md`
for the full VPS provisioning steps (Node 22, Caddy, systemd, `/etc/larp-city/server.env` at
mode 600).
```

- [ ] **Step 4: Commit**

```bash
git add server/deploy/Caddyfile server/deploy/larp-server.service server/README.md
git commit -m "server: add Caddy/systemd deploy templates and README"
```

---

### Task 10: Client-side API helper (game/ wiring)

**Files:**
- Create: `game/src/net/api.ts`
- Create: `game/tests/net-api.test.ts`

**Interfaces:**
- Produces: `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — the one function future
  UI work (phone.ts's Bank app, avatar onboarding, coach panel) should import from `../net/api.js`
  to call any `/api/*` route. Wiring those specific call sites into the UI is follow-up work, out
  of scope for this backend plan; this task only ships the shared client so that follow-up work
  has one correct, already-tested place to call into.

- [ ] **Step 1: Write the failing test**

```ts
// game/tests/net-api.test.ts
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiFetch, ApiError } from "../src/net/api.ts";

afterEach(() => {
  mock.reset();
});

test("apiFetch joins the base URL and path, sends credentials, and parses JSON", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const result = await apiFetch<{ ok: boolean }>("/health", { baseUrl: "http://localhost:3000" });
  assert.equal(capturedUrl, "http://localhost:3000/api/health");
  assert.equal(capturedInit?.credentials, "include");
  assert.deepEqual(result, { ok: true });
});

test("apiFetch throws ApiError with the status on a non-ok response", async () => {
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 }));
  await assert.rejects(
    () => apiFetch("/bank/acc_1", { baseUrl: "http://localhost:3000" }),
    (err: unknown) => err instanceof ApiError && err.status === 403,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game && npm test`
Expected: FAIL — `src/net/api.ts` does not exist yet.

- [ ] **Step 3: Write game/src/net/api.ts**

```ts
// game/src/net/api.ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Overrides `import.meta.env.VITE_API_BASE_URL` — used for tests. */
  baseUrl?: string;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { baseUrl, ...init } = options;
  const base = baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
  const url = `${base}/api${path}`;

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, `${path} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd game && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add game/src/net/api.ts game/tests/net-api.test.ts
git commit -m "game: add shared apiFetch client helper for the new server/ API"
```

---

## Plan self-review notes

- **Spec coverage:** every endpoint in the design spec's table is implemented by a task (health →
  T1, persona/complete+webhook → T3, bank/provision+sync+get → T4, voice/signed-url+tts+sfx → T5,
  avatar+feedback+news → T6, coach/ask+remember → T7, runs+snapshot+history+leaderboard → T8,
  deploy templates → T9). Session/identity, security middleware, and migrations from the spec are
  covered in T1/T2.
- **Type consistency verified across tasks:** `req.playerId` (declared once in T2's `session.ts`,
  used identically in T3/T4/T7/T8), `pool` from `db.ts` (T2, reused everywhere), `env`/`logger`
  import paths (`../env.js`, `../logger.js` from `routes/`, `./env.js`, `./logger.js` from
  `adapters/` — consistent relative depth throughout).
- **No placeholders:** every step has complete, runnable code; no "TODO" or "add validation" left
  unexpanded.
