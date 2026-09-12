# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Larp City is a financial-life city sim for HackRice 2026 (Finance track): a LEGO City Adventures-style build/protect loop reskinned so buildings are the player's savings/investments/home and fires/crimes are financial disasters (layoff, market crash, medical bill). The player enters their real finances, lives day-by-day toward retirement, and can rewind past decisions to compare outcomes. Full vision, mechanics mapping, and open questions: [README.md](README.md). Design decisions live in [meeting-2026-09-11-game-design.md](meeting-2026-09-11-game-design.md); `research/*.md` (start at [research/SUMMARY.md](research/SUMMARY.md)) has area-by-area design docs — where research conflicts with the meeting file, the meeting wins.

This is a private repo (`cayden-h/LarpCity`, branch `main`) for a hackathon team; expect fast-moving, sometimes half-built systems.

## Repository layout

- `game/` — the actual playable app (Vite + PixiJS v8 + TypeScript). Everything else is design docs, research, or data-generation scripts feeding it.
- `research/` — design docs plus `research/data/` (Python builders + raw inputs that generate files under `game/src/data/`).
- `diagrams/`, `reference/` — pitch-deck diagrams and reference-game screenshots.
- `docs/superpowers/` — specs/plans for in-flight features (e.g. the Blender sprite pipeline).
- `SETUP.md`, `.env.example` — API keys/integrations; copy `.env.example` to `.env` (never commit it).
- `requirements.txt` — Python deps for the data builders/loaders (`research/data/`, `game/db/load.py`). The game itself is pure Node.

## Commands

All game development happens inside `game/`:

```sh
cd game && npm install
npm run dev                       # city at /, Credit Desk at /debt.html
npm run build                     # tsc typecheck, then vite build (both pages) into dist/
node --test tests/*.test.ts       # debt engine, money life, money, market, sprites, Card Shop, goal fast-forwards
node --test tests/debt.test.ts    # run a single test file
npm run market:snapshot           # regenerate src/data/market.ts from FRED (no key needed)
npm run debt:charts               # redraw ../diagrams/debt/05-payoff-strategies.svg from the live engine
```

`npm test` is defined as `node --test tests/`, but on Node v25 that directory form throws `MODULE_NOT_FOUND` — use the glob form (`node --test tests/*.test.ts`) shown above instead.

There is no lint script; `npm run build`'s `tsc` step (strict-ish config: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) is the type-safety gate.

Python data builders (`research/data/`, `game/db/load.py`) use `requirements.txt`: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

Sprite rendering (Blender, currently only San Francisco) and states-map plate generation (ChatGPT Images via Codex CLI) are documented in [game/README.md](game/README.md#building-sprites-blender) and [game/README.md](game/README.md#plate-images-states-map-thumbnails) — don't run these unless the task specifically calls for new art.

## Architecture

**Rendering:** PixiJS v8 canvas for the world; DOM overlays for all HUD/UI (HUD, states map, phone, modals). Two HTML entry pages share the build: `/` (the city) and `/debt.html` (the Credit Desk, a standalone markets-terminal UI with its own `PlayerLife` instance). `vite.config.ts` also runs a dev-server proxy for optional live Alpha Vantage quotes (`/api/market/*`), disk-cached in `.cache/market/`, falling back to the static FRED snapshot when no key is set.

**Simulation is a deterministic, seeded daily tick**, driven by `Clock.onDay` in `src/main.ts`. This determinism is what makes calendar rewind and goal fast-forwards work: store the seed + decisions, re-simulate. Key pieces:

- `src/sim/life/` — `PlayerLife`: the player's whole money life (paychecks, state-scaled rent/living costs, accounts ledger, debt, brokerage holdings, standing orders for 401k/emergency-fund/recurring-buys/crash-rule). This is the central object most gameplay logic touches.
- `src/sim/debt/` — the debt engine (cards, student/auto/mortgage/BNPL/payday loans, credit score, delinquency, bankruptcy). Design: [research/07-debt-system-design.md](research/07-debt-system-design.md).
- `src/sim/money/` — accounts, transfers, card/loan applications, rewards. Design: [research/08-cards-loans-accounts.md](research/08-cards-loans-accounts.md).
- `src/sim/market/` — `MarketPath`: real FRED history before game day 0, then a bull/bear regime model on trading days (research/03), with preset AI Boom / AI Bubble Pop dates, pricing LTM/BOND/NNST instruments. Uses numeric stream keys and O(1) trading-day counts for speed (recent perf work — see `research/10`).
- `src/sim/skip/` — goal fast-forwards (research/10): `orders.ts` (standing orders), `goals.ts` (goals + price tags), `crash.ts` (crash rule shared with daily life), `futures.ts`/`futures.worker.ts` (100-future live preview in a Web Worker), `run.ts` (headless run used by both time-skips and goal fast-forwards).
- `src/engine/` — scene/camera, `world.ts` (wraps each hand-made city in generated suburbs/farms/terrain), isometric math, `ground.ts`, `bricks.ts` (procedural building builder — still used where no sprite exists), `traffic.ts`, `people.ts` (NPCs), weather, player home. `sprite-pick.ts`/`sprites.ts` load pre-rendered Blender sprite sets where available (SF only, so far) and fall back to `bricks.ts`.
- `src/cities/` — the 6 hand-made cities (Houston, Dallas, Austin, SF, NYC, Miami) plus `vibes.ts` (per-state vibes/regional templates for every other state) and `features/` (landmark library).
- `src/ui/` — DOM HUD. `phone.ts` is the in-game phone hub with an `APPS` registry (add new phone apps here); `skip-setup.ts` is the fast-forward setup screen; `hud.ts`, `usmap.ts`, `npccard.ts` round out the rest.
- `src/debt-demo/` — the Credit Desk page (`debt.html`): ticker tape, net worth/credit, payoff/net-worth/S&P/rates chart, liabilities, strategy, rates, credit report, activity, scenarios; `shop.ts` + `shop-value.ts` are the Card Shop (23 curated real cards with official art and year-one value math).
- `db/` — Tiger Data (Postgres + TimescaleDB) schema (`schema.sql`) and loader (`load.py`); see [SETUP.md](SETUP.md).

**Generated data — do not hand-edit, regenerate via the listed script instead:**
- `src/data/states.ts` ← `research/data/build_states_rpp.py` (BEA cost-of-living data)
- `src/data/market.ts` ← `npm run market:snapshot` (FRED)
- `src/data/cards.ts`, `src/data/cards-curated.ts` ← `research/data/cards/build_cards.py` (CFPB survey + issuer data)

**Everything random is seeded** (city layout, weather, traffic, market path) so a run replays identically — this is load-bearing for the rewind/fast-forward features, not incidental.

**Backend/secrets:** a small Node server (Vite dev proxy today) is meant to hold every third-party API key; the browser only ever calls `/api/*`. Only Persona's template/environment ids are safe to expose client-side. Full key/integration list: [SETUP.md](SETUP.md).

## Working conventions

- Design docs and code can drift on a hackathon timeline; when research/*.md and the current code disagree, prefer reading the code, and flag the doc as stale rather than assuming it's current.
- `meeting-*.md` and `notion-*.md` files at the repo root are point-in-time snapshots (meeting notes, pre-edit Notion backups) — treat them as history, not a live spec.
