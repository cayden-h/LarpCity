# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Larp City is a financial-life city sim built for HackRice 2026 (Finance track).
It copies the core loop of LEGO City Adventures: Build and Protect and reskins it so "fires and criminals" are financial disasters and "buildings" are the player's savings, investments, and home.
The player enters their real (or made-up) finances, by voice with the owl narrator or a typed form, and plays their own life on a daily calendar toward retirement.

The full design is in [README.md](README.md); it is the source of truth for vision and mechanics and changes often.
Re-read it, and [meeting-2026-09-11-game-design.md](meeting-2026-09-11-game-design.md) (which wins over `research/` where they conflict), before assuming a mechanic is still current.

The app is two parts: the browser game in `game/` and the API server in `server/`.
Everything else (`research/`, `docs/`, `diagrams/`, `reference/`) is design docs, data builders, and assets that feed them.
[game/README.md](game/README.md) is the detailed architecture doc for the game, and [server/README.md](server/README.md) for the server; read the matching one before working in either.

## Branches

`main` holds everything: it was assembled on 2026-09-12 from the team's integration branch `Tri` (PRs #1-#12) plus Eric's UI branch, and `Tri` was fast-forwarded to match.
Other people and sessions push to this repository at the same time, so fetch and check `origin/main` before starting and before opening a PR.
The live site at https://144-202-68-33.sslip.io runs `main` on a Vultr VPS; redeploy with the steps in [server/README.md](server/README.md) (Deploy).

## Commands

Keys live in the repo-root `.env` (copy `.env.example`; see [SETUP.md](SETUP.md)); both the game and the server read it.

Game, from `game/`:

```sh
npm install
npm run dev               # city at /, Money desk at /debt.html (calls the server at VITE_API_BASE_URL)
npm run build             # tsc typecheck, then vite build (both pages)
npm test                  # node --test tests/ (no test framework dependency)
node --test tests/debt.test.ts                              # one test file
node --test tests/debt.test.ts --test-name-pattern="foo"    # one test by name
npm run market:snapshot   # regenerate src/data/market.ts from FRED (no key needed)
npm run debt:charts       # regenerate diagrams/debt/05-payoff-strategies.svg from the live engine
```

Server, from `server/`:

```sh
npm install
npm run dev               # Express on PORT (default 3000); applies src/migrations.sql on boot
npm test                  # node --test with tsx and .env.test; database tests skip without TEST_DATABASE_URL
TEST_DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/postgres' npm test   # include the database tests
npx tsc --noEmit -p tsconfig.json
```

The database tests need a TimescaleDB they may create throwaway databases on; `server/README.md` has the one-line Docker command (port 5433).
For local play without touching the team's shared Tiger Data, point the server at a local database with `DATABASE_URL='postgres://postgres:larp@127.0.0.1:5433/<db>?sslmode=disable'` after loading `game/db/schema.sql` into it.

The game's tests run on Node's built-in test runner, which strips TypeScript types natively (Node 23+).
There is no lint script; the `tsc` step (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`) is the correctness gate, so no enums, namespaces, or constructor parameter properties.

Python tooling (data builders and loaders only) uses `requirements.txt` from the repo root: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

## Game architecture

**Simulation core (`game/src/sim/`)** is a deterministic, seeded daily tick engine.
That is what makes rewind, fast-forward, and "what if" comparisons possible: store the seed and the decisions and re-simulate, rather than recording state.

- `sim/debt/`: the debt engine (cards, student, auto, mortgage, BNPL, payday loans, credit score, delinquency, bankruptcy); design in `research/07-debt-system-design.md`.
- `sim/money/`: accounts, transfers, card and loan applications, rewards.
- `sim/life/` (`PlayerLife`): the player's daily life: paychecks (1st and 15th), state-scaled rent and living costs, brokerage holdings and recurring buys, standing orders (401(k) match, emergency fund, crash rule), and the starter portfolio (`STARTER_PORTFOLIO`).
  `twins.ts` keeps the "if you had held" and 90/10 autopilot shadow portfolios; `PlayerLife` emits `bear_market` and `market_recovered`, and `needsDecision` marks the events that pause the city for a decision.
  `intake.ts` (`lifeFromIntake`) builds a life from the voice or typed intake.
  Driven from `Clock.onDay` in `src/main.ts`.
- `sim/market/` (`MarketPath`): real FRED history before game day 0, then a bull/bear regime model on trading days with the preset AI Boom and AI Bubble Pop, pricing LTM, BOND, NNST, and the HackRice sponsor stocks.
- `sim/skip/`: goal fast-forwards: standing orders, goals and price tags, the shared crash rule, a 100-future preview in a Web Worker (`futures.worker.ts`), and the headless run.
- `sim/record/` (`RunRecorder`): sends the run's daily snapshots and every life event to the server (Tiger Data); `sim/npcs/` and `sim/mirror/` run the named NPCs and the Capital One Nessie bank mirror.
- `sim/rewind/` (`LifeTimeline`): a checkpoint of a life for every game day, restored into the same `PlayerLife`, so the Calendar goes back to any past day exactly; `rewindTo` in `src/main.ts` rewinds the clock, NPCs, bank mirror, and recorder (which forks the run on the server) with it.
- `sim/calendar/`: the Calendar's day chips (`marksFor`), each future day's scheduled money (`scheduleFor`, matching the debt engine's due days), and the next decision day (`nextDecisionDay`, a detached copy run ahead).
- `sim/save/`: the whole game as one saved document (`GameSave`, `toSave`/`fromSave` on each stateful sim class), `codec.ts` (`restoreGame`), `boot.ts` (resume, from-profile, intake, or offline), and `manager.ts` (`SaveManager`, autosaving on decisions, new months, and skips, and treating a 409 as another tab now owning the life).
- `sim/mail/` (`Inbox`): the phone's Mail app, letters built from the life's events, skipping routine days; opening a decision letter opens the Money desk on it.

**Rendering and world (`game/src/engine/`, `game/src/cities/`)**: a PixiJS v8 isometric renderer.
`engine/world.ts` wraps each city in generated suburbs, farms, and terrain; `engine/bricks.ts` is the procedural building builder where no sprite set exists; `cities/` holds the 6 hand-made cities (Houston, Dallas, Austin, San Francisco, New York, Miami) plus per-state "vibe" templates.
Cities with a sprite set draw pre-rendered Blender sprites (`engine/sprite-pick.ts`; pipeline in `game/art/`, see `game/README.md`).
Everything random is seeded, so a city's weather and traffic replay identically.

**UI (`game/src/ui/`)**: DOM over the canvas, in Eric's pixel theme (`pixel-theme.css`, the Pixelify Sans font, `pixel-icons.ts`).
The HUD (`hud.ts`) is just the "Your home" card; the phone (`phone.ts`, pulled up from the bottom-right) is the hub: Stocks (sponsor stocks and markets, opens the Money desk), Goals (the fast-forward, `skip-setup.ts`), Map (the pixel U.S. map, `usmap.ts`), Weather, Calendar (`calendar.ts`: the month and year views, going back to a past day, skipping to the next decision day, the speed, and "Start a new life" from the year view), and the live Mail, News, and Bank apps (`phone-apps.ts`), reading the life's inbox, the Ledger, and the Nessie statement.
Add new phone apps to `APPS`.
`intake.ts` is the onboarding (voice interview through ElevenLabs, or a typed form), and `narrator.ts` with `src/narration/lines.ts` is the owl narrator and its pre-voiced lines.
Scene events, camera reset, and the pinned sky time have no buttons anymore; use them from the console (`larp.scene().trigger("crash")`).

**Money desk (`game/debt.html` + `src/debt-demo/`)**: a separate page, a Robinhood-style view of the same `PlayerLife`: Home, Cash, Investing, Debt, Credit, and Cards (with the Card Shop, `shop.ts`).
Inside the city it opens in a window from the phone and reads the city's life and clock through `window.larpMoney`; the city parks decision moments (crash, can't cover, bankruptcy) for it to show, and time stays paused until the player presses play.
Standalone, it runs and records its own life.

**Generated data (never hand-edit; regenerate with the listed script)**:
- `src/data/states.ts` from `research/data/build_states_rpp.py` (BEA cost-of-living data).
- `src/data/market.ts` from `npm run market:snapshot` (FRED).
- `src/data/cards.ts`, `src/data/cards-curated.ts` from `research/data/cards/build_cards.py` (CFPB card survey; needs `openpyxl`).

## Server architecture

Express + Zod + pg in `server/src/`; every provider key stays here and the browser only calls `/api/*` (the Persona template and environment ids are the only values safe client-side).
Routes use the `handle`/`parse`/`HttpError` helpers in `http.ts`; provider clients are in `adapters/` (Persona, Nessie with a local fallback and replay, ElevenLabs, Gemini with key and model rotation, Backboard).
Run data lives in Tiger Data (Postgres + TimescaleDB): `store/runs.ts` for runs, snapshots, events, and history (weekly and monthly buckets of the run's own rows; the continuous aggregates are for cross-run analytics); `store/saves.ts` and `routes/save.ts` for the player's profile and saved game (`GET /api/me`, `PUT /api/profile`, `PUT /api/save` with optimistic-concurrency `rev`, `DELETE /api/save` for "New life"); `migrations.sql` is additive, runs one statement at a time on boot, and must stay idempotent.
The Gemini coach and newspaper (`ai/facts.ts`, `ai/coach.ts`) write only from the run's stored data, never from browser text, and fall back to plain-text templates; `/api/feedback` triggers are goal, bankruptcy, swing, and recovery.
The base schema is `game/db/schema.sql` (loader `game/db/load.py`, needs `psycopg`); deployment notes (Caddy, systemd, Vultr) are in `server/deploy/` and `server/README.md`.

## Repo layout outside `game/` and `server/`

- `research/`: design docs, starting at `research/SUMMARY.md`; numbered files 01-12 are cited by topic throughout the READMEs; `research/data/` holds the Python data builders and their raw inputs.
- `docs/superpowers/`: specs and plans for feature work (for example the investing twins and the Nessie fallback).
- `diagrams/debt/`: pitch-deck SVGs, some regenerated by `npm run debt:charts`.
- `meeting-*.md`, `notion-*.md`: the decision log and pre-edit backups of the team's Notion page; the live source of truth is Notion, and these are historical snapshots.
