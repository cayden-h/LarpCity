# Larp City server

Node/Express backend that holds every third-party secret (Persona, Nessie, ElevenLabs, Gemini,
Backboard, Tiger Data/Postgres) and exposes `/api/*` to the browser game in `../game`. See
`docs/superpowers/specs/2026-09-12-backend-design.md` for the design and `../SETUP.md` for how to
obtain each provider's keys.

## Local development

1. Fill in the repo-root `.env` (copy `.env.example`; see `SETUP.md` for where each key comes from).
   Persona is optional for now: without its keys the server still boots and `/api/persona/*` answers 503.
2. `npm install`
3. `npm run dev` — starts on `PORT` (default 3000), applies additive migrations on boot, and
   serves `/api/health`.
4. `cd ../game && npm run dev` — the game calls the server at `VITE_API_BASE_URL` from the root `.env`.

To try it without touching the team's Tiger Data, run a local TimescaleDB and point the server at it
(`sslmode=disable` turns TLS off for a local database):

```sh
docker run -d --name larp-pg -e POSTGRES_PASSWORD=larp -p 5433:5432 timescale/timescaledb:latest-pg17
PGPASSWORD=larp psql -h 127.0.0.1 -p 5433 -U postgres -f ../game/db/schema.sql
DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres?sslmode=disable' npm run dev
```

## Run data (Tiger Data)

The game records the player's run (`game/src/sim/record/`): one snapshot per game day and every life
event, sent about once a game month and in 5,000-row chunks after a fast-forward. Queries live in
`src/store/runs.ts`; sim day N is stored at `2000-01-01 + N days`.

| Route | Body or query | Returns |
| --- | --- | --- |
| `POST /api/runs` | `{ seed }` | `201 { runId }` |
| `POST /api/snapshot` | `{ runId, entries }` (up to 5,000 days; each may carry `you`, `held`, `autopilot`) | `{ stored }`; a re-sent day keeps its latest numbers, and its stored investing lines when the resend leaves them out |
| `POST /api/events` | `{ runId, events }` (up to 5,000, keyed `day:sequence`) | `{ stored }`; a retried batch adds nothing |
| `GET /api/history/:runId` | `?bucket=day\|week\|month&from&to` | daily rows (with `you`, `held`, `autopilot`, null on older rows), or weekly/monthly buckets (`firstDay`, `lastDay`, `netWorth`, `peak`, `low`, ...) |
| `GET /api/events/:runId` | `?from&to&kinds=a,b` | events oldest first |
| `GET /api/leaderboard` | | each run's latest net worth; verified players only once `PERSONA_API_KEY` is set |

Weekly and monthly history come from two real-time continuous aggregates over `player_snapshots`
(`player_snapshots_weekly`, `player_snapshots_monthly`, created in `src/migrations.sql` with a
one-minute refresh policy), so a 40-year run charts from about 2,100 weekly rows instead of 14,600
daily ones, and the newest days show before they're materialized. Migrations run one statement at a
time (`src/sql.ts`), because TimescaleDB won't create a continuous aggregate inside a transaction.

`npm test` skips the database tests unless `TEST_DATABASE_URL` points at a TimescaleDB where they may
create a throwaway database (the local Docker one above works):
`TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test`.

## AI coach and newspaper (Gemini)

Feedback and the newspaper are written from the run's own data in Tiger Data, never from text the
browser sends: `src/ai/facts.ts` builds a fact sheet in whole dollars, `src/ai/coach.ts` asks Gemini
for a fixed JSON shape and checks it, and anything that fails (a busy model, a bad answer, no key)
falls back to plain text from the same facts. Answers come back with `source: "gemini" | "template"`.

| Route | Body | Returns |
| --- | --- | --- |
| `POST /api/feedback` | `{ runId, trigger: "goal" \| "bankruptcy" \| "swing" \| "recovery", day, goal? }` | `{ headline, tip, mood, source, model?, facts }`; `recovery` compares the player with holding after a crash and answers 409 until that day's `market_recovered` event is stored |
| `POST /api/news` | `{ runId, from, to }` | `{ stories: [{ title, where, blurb, impact }], source, model?, facts }` |
| `POST /api/avatar` | `{ selfieBase64, styleBase64 }` | `{ imageBase64 }`; 403 until Persona has verified an adult (Gemini's terms) |

The client (`src/adapters/gemini.ts`) tries `GEMINI_TEXT_MODEL` and then `GEMINI_FALLBACK_MODELS`
(15 seconds each; `gemini-3.8-flash` is often busy), rotates `GEMINI_API_KEYS` on 429, and keeps the
key in a header. The same moment asked twice is cached in memory, and the routes share the strict
rate limit.

## Bank mirror (Capital One Nessie)

The player and the game's named NPCs (`game/src/data/npcs.ts`) each have a Nessie bank statement.
The game works out each month's entries (`game/src/sim/mirror/`) and posts them here; `src/mirror.ts`
posts them to Nessie once per key and reads them back.

| Route | Body | Returns |
| --- | --- | --- |
| `GET /api/bank/status` | | `{ ok, customers }` when Nessie is reachable; the game turns the mirror on from this |
| `POST /api/bank/:entity/open` | `{ run, name?, opening }` | `{ run, reused, balances }` |
| `POST /api/bank/:entity/entries` | `{ run, entries }` | `{ posted, skipped, balances }` |
| `GET /api/bank/:entity` | | this session's statement: each account's opening balance, transactions, and balance |

`:entity` is `player` or a named NPC (`npc-maya`).
Nessie never changes an account's `balance` after creating it, so every balance here is the opening
balance plus the run's entries. Customers can't be deleted, so NPC customers are shared by every
session and capped at 12, and a player gets one customer per session; accounts are per session and
run, and a new run deletes the session's old ones. The probe results behind these rules are in
`../SETUP.md` (Capital One Nessie, "What the live API does").

## Tests

`npm test` runs `node --import tsx --test` over every `*.test.ts` file. These are adapter-level
unit tests with mocked `fetch`/injected fake clients — no live database or external API calls are
made during `npm test`.

## Deploy

See `deploy/Caddyfile` and `deploy/larp-server.service`, and the Vultr section of `../SETUP.md`
for the full VPS provisioning steps (Node 22, Caddy, systemd, `/etc/larp-city/server.env` at
mode 600).
