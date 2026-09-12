# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Larp City: a financial-life city sim built for HackRice 2026 (Finance track). It copies the core loop of
LEGO City Adventures: Build and Protect and reskins it so "fires and criminals" are financial disasters and
"buildings" are the player's savings, investments, and home. The player enters their real (or made-up)
finances and plays their own life on a daily calendar toward retirement.

The full design is in [README.md](README.md); it is the source of truth for vision and mechanics and changes
often, so re-read it (and [meeting-2026-09-11-game-design.md](meeting-2026-09-11-game-design.md), which wins
over `research/` where they conflict) before assuming a mechanic is still current.

Everything playable lives in `game/`; everything else (`research/`, `docs/`, `diagrams/`, `reference/`) is
design docs, data builders, and assets that feed it. [game/README.md](game/README.md) is the detailed
architecture doc for the app itself — read it before working in `game/src/`.

## Commands

All game commands run from `game/`:

```sh
cd game && npm install
npm run dev              # city at /, Credit Desk at /debt.html
npm run build             # tsc typecheck, then vite build (both pages)
npm test                  # node --test tests/ — no test framework dependency
node --test tests/debt.test.ts              # run a single test file
node --test tests/debt.test.ts --test-name-pattern="foo"   # run a single test by name
npm run market:snapshot   # regenerate src/data/market.ts from FRED (no key needed)
npm run debt:charts       # regenerate diagrams/debt/05-payoff-strategies.svg from the live engine
```

Node's built-in test runner (`node --test`) strips TypeScript types natively (Node 23+ required) — there is
no ts-node/jest/vitest layer. Tests live in `game/tests/` and cover the debt engine, money life, money,
market, sprites, Card Shop, and goal fast-forwards.

There is no lint script configured; `npm run build`'s `tsc` step (`noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`) is the correctness gate.

Python tooling (data builders/loaders only, not the game) uses `requirements.txt` from the repo root:
`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

## Architecture

**Simulation core (`game/src/sim/`)** is a deterministic, seeded daily tick engine — this is what makes
rewind/fast-forward/"what-if" branches possible: store the seed + decisions and re-simulate rather than
recording state.

- `sim/debt/` — the debt engine (cards, student/auto/mortgage/BNPL/payday loans, credit score, delinquency,
  bankruptcy). Design: `research/07-debt-system-design.md`.
- `sim/money/` — accounts, transfers, card/loan applications, rewards.
- `sim/life/` (`PlayerLife`) — ties the above into the player's actual daily life: paychecks (1st/15th),
  state-scaled rent and living costs, brokerage holdings/recurring buys, and standing orders (401(k) match,
  emergency fund, crash rule). Driven from `Clock.onDay` in `src/main.ts`.
- `sim/market/` (`MarketPath`) — real FRED history before game day 0, then a bull/bear regime model on
  trading days, with preset AI Boom/AI Bubble Pop events, pricing the LTM/BOND/NNST instruments.
- `sim/skip/` — goal fast-forwards: standing orders, goals + price tags, the shared crash rule, a 100-future
  preview run in a Web Worker (`futures.worker.ts`), and the headless run used for actual fast-forwarding.

**Rendering/world (`game/src/engine/`, `game/src/cities/`)**: PixiJS v8 isometric renderer. `engine/world.ts`
wraps each city in generated suburbs/farms/terrain; `engine/bricks.ts` is the procedural building builder
(fallback where no sprite set exists); `cities/` holds the 6 hand-made cities (Houston, Dallas, Austin, SF,
NYC, Miami) plus per-state "vibe" templates covering every other state. Everything random is seeded so a
city's weather/traffic replay identically.

**Sprites**: cities with a sprite set (SF is the first) draw pre-rendered Blender sprites instead of the
procedural builder. `src/engine/sprite-pick.ts` chooses a sprite per lot; the Blender pipeline lives in
`game/art/` (see `game/README.md`'s "Building sprites" section for the full workflow).

**UI (`game/src/ui/`)**: DOM overlaid on the canvas, not Pixi UI. `phone.ts` is the app hub/registry (add new
apps to `APPS`); `skip-setup.ts` is the goal fast-forward setup screen; `hud.ts`, `usmap.ts`, `npccard.ts`
round out the HUD.

**Credit Desk** (`game/debt.html` + `src/debt-demo/`): a separate entry point / page, a markets-terminal-style
view of the same `PlayerLife` sim, opened from the phone's Stocks app. `src/debt-demo/shop.ts` is the Card
Shop (23 curated real cards with official art and CFPB terms); `shop-value.ts` computes year-one card value.

**Generated data — never hand-edit, regenerate via the listed script instead**:
- `src/data/states.ts` ← `research/data/build_states_rpp.py` (BEA cost-of-living data)
- `src/data/market.ts` ← `npm run market:snapshot` (FRED)
- `src/data/cards.ts`, `src/data/cards-curated.ts` ← `research/data/cards/build_cards.py` (CFPB card survey,
  needs `openpyxl`)

**Backend boundary**: API keys live only in a small Node server; the browser only ever calls `/api/*`. Persona
template/environment IDs are the only provider values safe to expose client-side. See `SETUP.md` for every
integration (Persona, Nessie, ElevenLabs, Alpha Vantage, Tiger Data/Postgres) and where each key goes.
`vite.config.ts` proxies `/api/market/*` to Alpha Vantage when `ALPHAVANTAGE_API_KEY` is set (in
`game/.env.local` or the root `.env`), caching in `.cache/market/`; without a key it falls back to the FRED
snapshot.

**Database**: Tiger Data (Postgres + TimescaleDB), schema in `game/db/schema.sql`, loader in `game/db/load.py`
(needs `psycopg`).

## Repo layout outside `game/`

- `research/` — design docs, start at `research/SUMMARY.md`; numbered files 01–12 are cited by topic
  throughout `README.md` and `game/README.md`. `research/data/` holds the Python data builders and their raw
  inputs.
- `docs/superpowers/` — specs and plans referenced by feature work (e.g. the SF sprite design spec).
- `diagrams/debt/` — pitch-deck SVGs, some regenerated by `npm run debt:charts`.
- `meeting-*.md`, `notion-*.md` — decision log and pre-edit backups of the team's Notion page (the live
  source of truth is Notion; these are historical snapshots, not to be treated as current design).
