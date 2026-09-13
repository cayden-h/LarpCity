# Larp City

A financial-life city sim for HackRice 2026 (Finance track).
We copy the core loop of LEGO City Adventures: Build and Protect, then reskin it so the "fires and criminals" are financial disasters and the "buildings" are your savings, investments, and home.
Build your wealth, protect yourself from going broke, and make it to retirement.

## Vision (updated 2026-09-11, after the game design meeting)

Larp City is built for learning, with real impact as the goal.
It teaches people to make better financial decisions by letting them live out how those decisions affect their lives.
The player lives their own financial life, from today to retirement.

- **Retirement is the end goal.**
- **Personalized:** The player enters their real finances, so the challenge scales to them (no preset jobs or salaries); anyone who just wants to play can make up a scenario.
  Onboarding asks for gross salary, age, job category, marital status, and location; the game infers a job level from real salary ranges and projects a realistic salary path.
- **Avatar onboarding:** The player takes a selfie, which is verified through Persona (sponsor), and gets a game avatar that resembles them (3D or Pixi game-style).
- **Daily calendar:** Time advances day by day, Stardew Valley style, at 1 in-game week every 5 real seconds (1x), with 2x, +1 month, and a "Skip to next event" button.
  The phone's Calendar app circles events in red and big decisions and milestones in blue.
- **Review and rewind:** Tapping a past circled date shows what happened, the outcome, and how to do better next time.
  The player can change that decision: time rewinds to that date on the same market and luck, they keep playing the new branch, and the old path stays as a ghost line to compare against (unlimited rewinds).
- **Detailed news:** Each story says what happened, where (state, city, or sector), and what it affects for the player; after a skip, a full-screen newspaper digests what was skipped and is kept in the phone's News app.
- **Score:** retirement readiness (net worth, credit score, debt) plus a wellbeing meter (marital status, financial stability, job and salary, closeness to retirement).
  It always reflects the current branch, and rewinds are never penalized: it's a learning game, so players should get better.
- **Fast-forward to goals:** Set the recurring investment deposit and related inputs (pre-filled with your current habits), then fast-forward until a goal is met.
  A bankruptcy along the way stops it and shows why.
  The age teleport was removed on 2026-09-12.
- **Goals and milestones:** Goals like buying a house or moving states; skip until one is met and see the year and why.
  At retirement, look back through the milestones (stretch).
- **Big events slow time down:** Major events (market crash, layoff, AI bubble pop) and life events (layoff, marriage, divorce with a prenup option, kids) pause the simulation and ask the player to decide.
- **AI feedback** at goals, at bankruptcy, on big portfolio swings, and when the market recovers after a crash; a newspaper sums up recent days.
- **Multi-state map:** The player can move between US states, each in a low, medium, or high cost-of-living tier.
- **Stock market:** The core system, which needs heavy design work around how the simulation runs.

Meeting decisions and next steps: [meeting-2026-09-11-game-design.md](meeting-2026-09-11-game-design.md).
Research for each area lives in [research/](research/); where it conflicts with the meeting, the meeting wins.
City art direction (backgrounds with day/night/weather, landmarks, traffic, the states map) is in [research/05-city-visuals-and-art-pipeline.md](research/05-city-visuals-and-art-pipeline.md).
The playable city prototype (every state, 6 hand-made cities, generated backgrounds, weather, traffic) is in [game/](game/): `cd game && npm install && npm run dev`.
Debt and credit (card, student, auto, mortgage, BNPL, payday loans, credit score, delinquency, bankruptcy) is in [research/06-debt-and-credit.md](research/06-debt-and-credit.md), mirrored to Notion as the "💳 Debt & Credit" section and research sub-page.
The debt engine is built and wired into the city: design in [research/07-debt-system-design.md](research/07-debt-system-design.md), engine in `game/src/sim/debt/`, the player's money life (paychecks, state rent, accounts, debt) in `game/src/sim/life/` running on every game day, the Money desk at `/debt.html` (opened from the phone's Stocks app; real FRED rates and index history, plus live Alpha Vantage quotes in local development when `ALPHAVANTAGE_API_KEY` is set), tests via `npm test`, and pitch-deck diagrams in [diagrams/debt/](diagrams/debt/).
Card applications, perks, loans, and moving money between accounts are in [research/08-cards-loans-accounts.md](research/08-cards-loans-accounts.md), with a real card catalog (663 CFPB plans, 175 bonus offers, FRED rates) in Tiger Data (`game/db/`) and the engine in `game/src/sim/money/`, mirrored to Notion as the "🏦 Cards, Loans & Accounts" section.
The Card Shop is playable on the Money desk's **Cards** tab (`/debt.html`): 23 real cards with official art, issuer-page earn rates and offers, CFPB terms, year-one value on your spending, and soft-pull odds before a hard-pull application that opens the card as a real debt.
Investing in the Money desk (**Investing**, in the city from the phone's Stocks app or standalone at `/debt.html`) charts the player against "if you had held" and a 90/10 autopilot on the same seeded market, starting all three at the starter portfolio's value; when a bear market starts it pauses time and opens a decision (in the city, the phone opens the desk on it), and at the recovery shows what the choice cost, with a lesson from the Gemini coach written from the run's own Tiger Data ([spec](docs/superpowers/specs/2026-09-12-investing-twins-design.md)).
How to set up Persona and every other API (keys, env vars, the backend we need, signup checklist) is in [SETUP.md](SETUP.md), mirrored to Notion as the "🔌 Setup & API Keys" section.

The player's phone (the hub for the game's apps: Stocks, Goals, Map, Weather, and Timeline now; News, Mail, and Bank next) pulls up from the bottom-right corner of the city, in Eric's pixel theme; see `game/src/ui/phone.ts`.

Everything above is merged into `main` (2026-09-12) and live at https://144-202-68-33.sslip.io on a Vultr VPS; [server/README.md](server/README.md) has the redeploy steps.

## Repository layout

Everything for Larp City lives in this folder, which is the private GitHub repository https://github.com/cayden-h/LarpCity (branch `main`).

| Path | What it is |
| --- | --- |
| `game/` | The playable app (Vite + PixiJS + TypeScript): the city at `/`, the Money desk at `/debt.html`, the simulation in `game/src/sim/`, tests in `game/tests/`, and build scripts in `game/scripts/`. See [game/README.md](game/README.md). `game/plates-src/` (95 MB of regenerable plate sources) is gitignored. |
| `server/` | The API server (Express + Zod + pg over Tiger Data): holds every key from the root `.env` and serves `/api/*` (runs and history, the Nessie bank mirror, the voice intake, the Gemini coach and newspaper). See [server/README.md](server/README.md), including how to deploy. |
| `docs/superpowers/` | Specs and plans for feature work (the backend, the investing twins, the Nessie fallback, and more). |
| `CLAUDE.md` | Commands and architecture for Claude Code sessions working in this repository. |
| `research/` | Research and design docs (start with [research/SUMMARY.md](research/SUMMARY.md)), plus the data builders and their raw inputs in `research/data/` (the card-art upscaler weights go in the gitignored `research/data/cards/models/`). |
| `requirements.txt` | Python dependencies for the data builders and loaders (the game itself is Node: `cd game && npm install`). |
| `diagrams/` | Pitch-deck diagrams (SVG sources and PNG exports), currently for the debt system. |
| `reference/` | Screenshots of the LEGO reference game. |
| `SETUP.md`, `.env.example` | API keys and integrations; copy `.env.example` to `.env` (never committed). |
| `meeting-*.md`, `notion-*.md` | Meeting decisions and backups of the team Notion page before each automated edit. |

Team Notion page (organized, the live source of truth): https://app.notion.com/p/Larp-City-3d846cd8aa24804a9c63c8bfc95a5e6b
Backup of the team's original Notion notes, before reorganizing: [notion-notes.md](notion-notes.md).
Reference screenshots: [reference/screenshots/](reference/screenshots/).

## The reference game

LEGO City Adventures: Build and Protect (Nickelodeon), playable at https://plays.org/game/lego-city-adventures-build-and-protect/.

What we confirmed by loading it and reading its shipped JS bundles:

- **Engine:** PixiJS (`pixi.js-legacy` is bundled in `vendor.js`), with Howler.js for audio.
  It is a single full-screen canvas, isometric 2D, no 3D engine.
- **View:** Isometric tile map of city blocks, roads, and a fenced-off locked district.
  Small cars drive the roads.
  Zoom in/out buttons on the right.
- **HUD:** Coin counter bottom-left (starts at 1,000), dig button bottom-right (costs 300), police and fire alert badges top-left, pause and inventory top-right.
- **Onboarding:** Mayor Solomon Fleck pops up in a modal and walks you through the first actions (collect coins, pick a dig site, place police and fire stations, first build, then free build).
- **Core loop** (from the game's own string keys):
  1. Buildings generate coins over time up to a cap (`coin_ready`, `coinCap`).
  2. Spend coins to dig up LEGO bricks at dig sites (`dig_minigame`, `digPrices`).
  3. Spend bricks on blueprints to build buildings (`blueprints_build`, `quick_build`).
  4. Fires and crimes break out as random events; dispatch the Fire Chief or Police Sergeant, or the building burns and loses value (`burntBuildingCoinValue`).
  5. Build 25 buildings in a district to unlock the next district, working toward a full metropolis.

| # | Screenshot |
| --- | --- |
| 1 | [Title screen](reference/screenshots/01-title-screen.jpg) |
| 2 | [Mayor onboarding](reference/screenshots/02-onboarding-mayor.jpg) |
| 3 | [City map + HUD](reference/screenshots/03-city-map-hud.jpg) |

## Our twist: LEGO mechanic to Larp City mechanic

| LEGO City | Larp City |
| --- | --- |
| Mayor onboarding modal | The owl narrator (ElevenLabs voice agent) interviews you for your real finances: job, salary, rent, debt, savings |
| Coin income from buildings | Paychecks hitting your checking account |
| Dig for bricks, spend on blueprints | Allocate money into Emergency Fund, Roth IRA, 401k, brokerage, savings |
| Buildings on the map | Each NPC's home and assets; they visibly upgrade or decay with net worth |
| Fires and crimes | Financial events: layoff, medical bill, car breakdown, rent hike, market crash |
| Dispatch police/fire | Player makes a decision at that moment (dip into emergency fund, take a loan, sell stocks) |
| Burnt building loses value | Bankruptcy or homelessness, followed by a "what went wrong" breakdown |
| Unlock next district at 25 buildings | Reach a goal (buy a house, move states), which becomes a milestone on the way to retirement |
| Day/night, city growth | A daily calendar, with seasons and map changes as months and years pass |

Events are probabilistic, each with its own likelihood and timing.
Some are one-offs, like the AI bubble pop, which can only happen once per run; it and the AI Boom before it are preset to fixed dates so they always show up in the demo.
The calendar lets the player review any past event or decision, change it, and see on the same market path what actually works.

## Tech plan

- **Rendering: PixiJS (v8) over Phaser.**
  The game we are copying is itself built on PixiJS, so the art style and isometric feel map one-to-one.
  We need a sprite renderer plus our own simulation, not a physics or scene engine, which is Phaser's main value-add.
- **App:** Vite + TypeScript.
  The HUD and modals (bank dashboard, decision prompts, "what went wrong") can be DOM/React overlaid on the canvas, which is faster to build than Pixi UI.
- **Simulation:** A deterministic, seeded daily tick engine for the player's life, with preloaded persistent data and a reset option.
  Seeded RNG gives us exact rewind for free: store the seed plus the player's decisions and re-simulate.
  The same engine run headless powers the time skips and goal fast-forwards.
  Built so far: the debt engine (`game/src/sim/debt/`), accounts, cards, and loans (`game/src/sim/money/`), and the player's daily money life that ties them to the city clock (`game/src/sim/life/`).
- **Market data:** a year of real FRED rates and index levels ships with the game (`game/src/data/market.ts`); live Alpha Vantage quotes are optional through the Vite dev server only (the production server doesn't serve `/api/market/*` yet, so the deployed game uses the snapshot).
- **Backend:** A small Node server holds every API key; the browser only calls our own `/api/*` routes (see [SETUP.md](SETUP.md)).
  Persona's template and environment ids are the only provider values that are safe in the browser.
- **Bank data:** Capital One Nessie as the fake bank API (the "fake nestlie api" in the notes), with Plaid Sandbox as a stretch "connect your real bank" idea.
- **Voice:** ElevenLabs for the owl narrator: the onboarding interview (a voice agent) and the voiced lines for big moments (text to speech with word timings).
- **Feedback:** An LLM turns the event log into the "what went wrong" post-mortem when an NPC goes broke.
- **Database:** Tiger Data (Postgres with TimescaleDB) stores every week of NPC finances, market prices, events, and current city data.
- **Hosting:** Vultr runs the game and backend at https://144-202-68-33.sslip.io (Caddy serves the game over HTTPS and proxies `/api/*` to the Node server under systemd); the GoDaddy Registry domain is still to come.
- **AI memory:** Backboard remembers each player's past decisions and answers questions from our research docs.

## Sponsor prize plan (MLH)

From the [MLH HackRice prizes page](https://www.mlh.com/events/hackrice-71/prizes).
All of these stack on one Devpost submission, on top of the track, Capital One, and Persona.

| Prize | Reward | How Larp City uses it |
| --- | --- | --- |
| Best Use of Gemini API | Google swag kits | Avatar creation from the verified selfie, the aged "future you" avatar, "what went wrong" recaps, and "Your Real Plan" text |
| Best Use of ElevenLabs | Wireless earbuds | The owl narrator: a voice-agent onboarding interview, then expressive voiced lines with live captions for big life moments (a debt paid off, collections, bankruptcy, a move, a crash), plus news-anchor alerts and sound effects |
| Best Use of Tiger Data | Stream Deck Mini | Time-series database for weekly NPC finances, market, events, and current city data, powering live charts, the leaderboard, and calendar rewind (free tier, 750 MB) |
| Best Use of Vultr | Portable screens | Hosts the game and backend with API keys server-side ($100 MLH credits); stretch: GPU or serverless inference for NPC dialogue |
| Best Use of Backboard | Tile Essentials Pack | Player memory across sessions, RAG over our research and 2026 rules, and routing between small and large models |
| Best Domain Name (GoDaddy Registry) | Digital gift card | A domain like larpcity.xyz for the Vultr server |
| Solana, Presage | Various | Low fit; skip |

NPC deaths should be handled as a respectful lesson about life insurance, emergency funds, and wills, not a shock moment.
- **Art:** Isometric tile and building sprites; a free isometric city asset pack gets us close to the LEGO look without their IP.

## 24-hour MVP

1. Onboarding where the player enters their real finances (or a made-up scenario).
2. Isometric map of one district, pan and zoom.
3. Daily tick engine with paychecks, bills, and the five account types from the notes.
4. Random event system with per-event probabilities, at least one one-off (AI bubble pop), and life events (layoff, marriage, divorce).
5. HUD: net worth, date, pause / 1x / 2x / +1 month and "Skip to next event", event alerts like the LEGO police and fire badges; a Calendar app in the phone with red (event) and blue (decision, milestone) circles.
6. Decision modal when an event hits the player.
7. Fast-forward to a goal with bankruptcy stopping it, and the "what went wrong" breakdown.
8. AI feedback at goals, bankruptcy, and big portfolio swings.

Stretch: voice onboarding, Nessie/Plaid integration, seasons, a second district, milestone replay at retirement.

Status (2026-09-11 night): 2 is built for every state; 3 exists as `PlayerLife` (paychecks, bills, checking, savings, emergency fund, brokerage, and debts) running on the city clock; 6 exists in the Credit Desk; the HUD for money, the event system, goal fast-forwards, and AI feedback are next.

Status (2026-09-12): everything is merged into `main` and deployed.
1 is built as the owl's voice or typed intake, and 2 as every state's city in Eric's pixel UI.
3 runs every day with the starter portfolio, and the market crash and recovery are the first scripted events (4).
6 is the Money desk: the city opens it on a crash, a payment it can't cover, or bankruptcy, and keeps time paused until play.
7 is built (goal fast-forwards), and 8 covers the Gemini coach's recovery lesson, written from the run's Tiger Data.
Still to come: the Calendar app with "Skip to next event", life events (marriage, divorce, kids), and the rest of the random event table.

## Open questions

Answered in the 2026-09-11 meeting: time runs daily with skips, the goal is retirement, and the player lives their own life.
Answered on 2026-09-12 (see the meeting file's "Follow-up decisions"): events during skips, scoring, unlimited rewind from the calendar, run speeds, and a preset AI Bubble Pop date instead of curated demo seeds.
Still open:

- The dates of the preset AI Boom and AI Bubble Pop.
- The full list of wellbeing factors and their weights, from real data (research/09).
- The setup screen before a goal fast-forward (recurring deposit and related inputs) and which events interrupt it (research/10).
- The job categories and salary progression model (research/11).
- Whether the ~50 NPCs stay as a city backdrop.
- How much of the milestone replay to build.
- Whether to frame it as a finance game or a finance LARP.

## Choosing a home

The player's home is a financial choice with its own lot, rather than an automatic net-worth upgrade.
Click the home card or a home lot to compare a studio rental and four ownership tiers, inspect monthly costs and qualification reasons, and choose a down payment.
Purchases, sales, housing bills, and forced moves are recorded in the same saved life as the Money desk.
San Francisco's residential houses use Blender-rendered pixel sprites, with four facings and palette-tinted walls; six hero home models are shared by every city.
See [the game architecture and rebuild commands](game/README.md#houses-and-choosing-a-home) and [the design](docs/superpowers/specs/2026-09-12-blender-houses-design.md).
