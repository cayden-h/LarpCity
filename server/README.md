# Larp City server

Node/Express backend that holds every third-party secret (Persona, Nessie, ElevenLabs, Gemini,
Backboard, Tiger Data/Postgres) and exposes `/api/*` to the browser game in `../game`. See
`docs/superpowers/specs/2026-09-12-backend-design.md` for the design and `../SETUP.md` for how to
obtain each provider's keys.

## Local development

1. Fill in the repo-root `.env` (copy `.env.example`; see `SETUP.md` for where each key comes from).
   Persona is optional for now: without its keys the server still boots and `/api/persona/*` answers 503.
2. `npm install`
3. `npm run dev` starts on `PORT` (default 3000), applies additive migrations on boot, and
   serves `/api/health`.
4. `cd ../game && npm run dev`: the game calls the server at `VITE_API_BASE_URL` from the root `.env`.

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
| `POST /api/runs/:runId/fork` | `{ throughDay }` | `201 { runId }`: a rewind's branch, a new run for the same player and seed that starts with the old run's snapshots and events through that day; the old run is kept |
| `POST /api/snapshot` | `{ runId, entries }` (up to 5,000 days; each may carry `you`, `held`, `autopilot`) | `{ stored }`; a re-sent day keeps its latest numbers, and its stored investing lines when the resend leaves them out |
| `POST /api/events` | `{ runId, events }` (up to 5,000, keyed `day:sequence`) | `{ stored }`; a retried batch adds nothing |
| `GET /api/history/:runId` | `?bucket=day\|week\|month&from&to` | daily rows (with `you`, `held`, `autopilot`, null on older rows), or weekly/monthly buckets (`firstDay`, `lastDay`, `netWorth`, `peak`, `low`, ...) |
| `GET /api/events/:runId` | `?from&to&kinds=a,b` | events oldest first |
| `GET /api/leaderboard` | | each run's latest net worth; verified players only once `PERSONA_API_KEY` is set |

Weekly and monthly history bucket the run's own rows with `time_bucket`, so a 40-year run charts
from about 2,100 weekly rows instead of 14,600 daily ones, and its newest days always show.
They use the same expressions as the two real-time continuous aggregates over `player_snapshots`
(`player_snapshots_weekly`, `player_snapshots_monthly`, created in `src/migrations.sql` with a
one-minute refresh policy), which stay for cross-run analytics.
History doesn't read the aggregates because every run starts at 2000-01-01: once a long run is
materialized, the watermark is past all of a newer run's days, and real-time aggregation would leave
them out until the next refresh.
Migrations run one statement at a time (`src/sql.ts`), because TimescaleDB won't create a
continuous aggregate inside a transaction.

`npm test` skips the database tests unless `TEST_DATABASE_URL` points at a TimescaleDB where they may
create a throwaway database (the local Docker one above works):
`TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test`.

## Profile and saves

Each player's confirmed intake and saved game live in Tiger Data (`profiles` and `saves` tables,
`src/store/saves.ts`), keyed by the session's player.
`GET /api/me` is the one call the game makes on boot, to decide between resuming, building a life
from the profile, and running the intake.

| Route | Body | Returns |
| --- | --- | --- |
| `GET /api/me?slot=N` | | `{ player, profile, save, slot, slots }`: slot N's save, and a summary of all three slots (null when empty) |
| `PUT /api/profile` | the confirmed intake | `204` |
| `PUT /api/save?slot=N` | `{ runId, seed, version, gameDay, state, baseRev }` | `{ rev }`, or `409` when `baseRev` is stale, the run has ended, the run isn't this player's, or its seed doesn't match the run's own seed |
| `DELETE /api/save?slot=N` | | `204`; "New life" in slot N: forgets its save and the profile and ends its run, all in one transaction; other slots keep theirs |

Each player has three save slots: `N` is 0, 1, or 2 (0 when absent; anything else is a 400), and slot 0 keeps the `main` name saves had before slots existed.

The save's `state` is opaque JSON (only the game's own codec, `game/src/sim/save/`, knows its
shape) capped at 1.5 MB (`MAX_STATE_BYTES` in `src/routes/save.ts`), which a 60-year save stays well
under once its history is compacted.
`rev` is optimistic concurrency: a write names the rev it started from, so two tabs (or a stale
retry) can't silently clobber each other's progress.
The AI coach and the newspaper below read the player's job and financial state from this same
profile, never from text the browser sends.

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

## News Progression Engine

Every `POST /api/events` batch is scored for newsworthiness before it's inserted (`src/news/scorer.ts`:
severity + rarity + the player's own dollar magnitude relative to their net worth), and whatever clears
the publish threshold is stored in `news_stories` with its facts verbatim, no prose yet. Prose is written
lazily — Gemini with the same template fallback as the coach and newspaper above — the first time a day
range is read.

| Route | Query | Returns |
| --- | --- | --- |
| `GET /api/news/:runId` | `?from&to` | stories in that day range, oldest first, with prose already filled in (writing capped at 20 per request) |

Branches don't exist server-side yet, so every story's `branch_id` is its `run_id` (the root branch); see
`docs/superpowers/specs/2026-09-12-news-progression-engine-design.md` for the rewind design this reserves.

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

`npm test` runs `node --import tsx --test` over every `*.test.ts` file.
Most are unit tests with mocked `fetch` or injected fake clients, so no external API is called.
The store and local-Nessie tests (`*.db.test.ts`) run against a real TimescaleDB only when
`TEST_DATABASE_URL` is set (see "Run data" above); otherwise they are skipped.

## Deploy

The game and this server are live at https://144-202-68-33.sslip.io on a Vultr VPS (Ubuntu 24.04,
Node 22, Tri Nguyen's account), running `main` since 2026-09-12.
Provisioning is in the Vultr section of `../SETUP.md`, with the unit and proxy files in `deploy/`.

On the box (SSH as `larp@144.202.68.33` with the team's deploy key; ask Cayden):

| What | Where |
| --- | --- |
| Game (static files, served by Caddy) | `/var/www/larp-city` |
| This server (systemd `larp-server`, runs `dist/index.js`) | `/home/larp/larp-city/server` |
| Secrets (root, mode 600) | `/etc/larp-city/server.env` |
| Caddy's domain | `/etc/systemd/system/caddy.service.d/domain.conf` (`DOMAIN=...`) |

The box has no git checkout: deploy by building locally and copying.
Stage both halves first and swap only once both are ready, so the live site never mixes versions:

1. Build `main` from a clean worktree: `npm ci && npm test && npm run build` in `game/` (the committed root
   `.env.production` keeps API calls relative, so `dist/` must not contain `localhost:3000`), and
   `npm ci && npm test` in `server/`.
2. Copy `server/` without `node_modules`, `dist`, `.cache`, or `.env*` to `~/larp-city/server-next`,
   then run `npm ci && npm run build` there.
3. Check the real secrets satisfy the new settings (as root):
   `cd /home/larp/larp-city/server-next && set -a && . /etc/larp-city/server.env && set +a && node -e "import('./dist/env.js')"`.
4. Copy `game/dist/` to `~/web-next`.
5. Swap: `mv server server-prev-<time> && mv server-next server`, `sudo systemctl restart larp-server`,
   and poll `curl localhost:3000/api/health`; if it never answers, move the old folder back and restart.
6. `rsync -a --delete ~/web-next/ /var/www/larp-city/` (keep a copy of the old web root first).
7. Check `journalctl -u larp-server` (as root) shows "server migrations applied", then load the site and
   `/debt.html` in a browser.

Migrations run against the shared Tiger Data on every boot, so they must stay additive and idempotent.
macOS's `rsync` is Apple's `openrsync`: give the remote destination as an absolute path.
The production server doesn't serve `/api/market/*` (live quotes exist only in the Vite dev server),
so the deployed game uses the FRED snapshot.
