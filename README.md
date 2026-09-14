# Larp City

🏆 **Capital One HackRice Track Winner** - [Devpost](https://devpost.com/software/temp-6yaocn?ref_content=user-portfolio&ref_feature=in_progress)

Play it live: www.larpcity.club

A financial-life city sim for HackRice 16.
Build your wealth, protect yourself from going broke, and make it to retirement.

## Vision (updated 2026-09-13, after the revamp meeting)

Larp City is built for learning, with real impact as the goal.
It teaches people to make better financial decisions by letting them live out how those decisions affect their lives.
The player lives their own financial life, from today to retirement.

- **Retirement is the end goal.**
  When the player is ready, a Retire button unlocks; retiring before 65 passes, and the score blends their financial decisions with their happiness.
  Finishing signals financial literacy to the bank, which could qualify the player for real cards.
- **Starting life:** Every player starts at 22, just out of college, with a randomized $35,000 to $50,000 salary (about $60,000 in San Francisco), $20,000 to $40,000 of debt, and a 600 credit score.
  A preset, fake Plaid connection frames those numbers as already known.
- **Sammy's onboarding:** Sammy, the owl narrator, presents the snapshot and walks through a health insurance plan, one of 3 real beginner cards, a 6-month emergency fund, Roth IRA and 401(k) contributions ($0 to $7,500, with a 2% match), low, medium, or high expenses, and the car ($500 a month over 6 years, $200 a month to insure).
  Every value stays changeable during the game.
- **Avatar:** A male or female preset with no customization (this replaced the Persona selfie avatar on 2026-09-13).
- **Daily calendar:** Time advances day by day, Stardew Valley style, at 1 in-game week every 5 real seconds (1x), with 2x, +1 month, and a "Skip to next event" button.
  The phone's Calendar app circles events in red and big decisions and milestones in blue.
- **Review and going back:** Tapping a past circled date shows what happened, the outcome, and how to do better next time.
  During play every choice sticks: going back to a past day opens only in the end-of-game review, where time rewinds to that date on the same market and luck (decided 2026-09-13).
  "Skip to next event" stays available the whole game.
- **Detailed news:** Each story says what happened, where (state, city, or sector), and what it affects for the player; after a skip, a full-screen newspaper digests what was skipped and is kept in the phone's News app.
- **Score:** retirement readiness (net worth, credit score, debt) plus a wellbeing meter (marital status, financial stability, job and salary, closeness to retirement).
  It always reflects the current branch, and going back in the review is never penalized: it's a learning game, so players should get better.
- **Fast-forward to goals:** Set the recurring investment deposit and related inputs (pre-filled with your current habits), then fast-forward until a goal is met.
  A bankruptcy along the way stops it and shows why.
  The age teleport was removed on 2026-09-12.
- **Goals:** Set once at the start and permanent, but tracked with a progress bar in the Goals app: the retirement age, marriage, being debt-free by an age, and buying a house.
  Happiness is a soft goal on top: vacations and family time raise it; injuries, major financial events, and falling stocks lower it.
  At retirement, look back through the milestones.
- **Big events slow time down:** Events are rolled from a seeded formula, so a run replays exactly.
  The stock market is the main one (crashes, booms, recessions, penny-stock tips, and the AI bubble pop); life events are car breakdowns (likelier as the car ages; repair it or buy a new one), injuries (a car crash raises car insurance; without health insurance the whole bill is yours), and divorce (a prenup signed at the wedding keeps the money; without one the player loses half).
  Events with a choice pause the simulation and ask; natural disasters were dropped as too complex.
- **Taxes:** The first return is a tutorial that ends by asking for the bottom line; get it right and every later return files itself on tax day.
- **Save slots:** Three per player, and judges can load pre-built demo lives into any of them from the Calendar's year view (or open the game at `/?slots=1`).
- **AI feedback** at goals, at bankruptcy, on big portfolio swings, and when the market recovers after a crash; a newspaper sums up recent days.
- **Multi-state map:** The player can move between US states, each in a low, medium, or high cost-of-living tier.
- **Stock market:** The core system, which needs heavy design work around how the simulation runs.

Meeting decisions and next steps: [the 2026-09-13 revamp](docs/meetings/2026-09-13-revamp.md) (the latest, which wins where they differ) and [the 2026-09-11 game design meeting](docs/meetings/2026-09-11-game-design.md).
Research for each area lives in [research/](research/); where it conflicts with the meeting, the meeting wins.
City art direction (backgrounds with day/night/weather, landmarks, traffic, the states map) is in [research/05-city-visuals-and-art-pipeline.md](research/05-city-visuals-and-art-pipeline.md).
The playable city prototype (every state, 6 hand-made cities, generated backgrounds, weather, traffic) is in [game/](game/): `cd game && npm install && npm run dev`.
Debt and credit (card, student, auto, mortgage, BNPL, payday loans, credit score, delinquency, bankruptcy) is in [research/06-debt-and-credit.md](research/06-debt-and-credit.md), mirrored to Notion as the "💳 Debt & Credit" section and research sub-page.
The debt engine is built and wired into the city: design in [research/07-debt-system-design.md](research/07-debt-system-design.md), engine in `game/src/sim/debt/`, the player's money life (paychecks, state rent, accounts, debt) in `game/src/sim/life/` running on every game day, the Money desk at `/debt.html` (opened from the phone's Stocks app; real FRED rates and index history, plus live Alpha Vantage quotes in local development when `ALPHAVANTAGE_API_KEY` is set), tests via `npm test`, and pitch-deck diagrams in [docs/diagrams/debt/](docs/diagrams/debt/).
Card applications, perks, loans, and moving money between accounts are in [research/08-cards-loans-accounts.md](research/08-cards-loans-accounts.md), with a real card catalog (663 CFPB plans, 175 bonus offers, FRED rates) in Tiger Data (`game/db/`) and the engine in `game/src/sim/money/`, mirrored to Notion as the "🏦 Cards, Loans & Accounts" section.
The Card Shop is playable on the Money desk's **Cards** tab (`/debt.html`): 23 real cards with official art, issuer-page earn rates and offers, CFPB terms, year-one value on your spending, and soft-pull odds before a hard-pull application that opens the card as a real debt.
Investing in the Money desk (**Investing**, in the city from the phone's Stocks app or standalone at `/debt.html`) charts the player against "if you had held" and a 90/10 autopilot on the same seeded market, starting all three at the starter portfolio's value; when a bear market starts it pauses time and opens a decision (in the city, the phone opens the desk on it), and at the recovery shows what the choice cost, with a lesson from the Gemini coach written from the run's own Tiger Data ([spec](docs/superpowers/specs/2026-09-12-investing-twins-design.md)).
How to set up Persona and every other API (keys, env vars, the backend we need, signup checklist) is in [SETUP.md](SETUP.md), mirrored to Notion as the "🔌 Setup & API Keys" section.

The player's phone (the hub for the game's apps: Stocks, Goals, Map, Calendar, News for market stories, Mail for bills, Bank, and Taxes; Weather was dropped on 2026-09-13) pulls up from the bottom-right corner of the city, in Eric's pixel theme; see `game/src/ui/phone.ts`.

Everything above through 2026-09-12 is merged into `main` and live at https://144-202-68-33.sslip.io on a Vultr VPS; [server/README.md](server/README.md) has the redeploy steps.
The 2026-09-13 revamp lands in three pull requests: onboarding (P1), goals, happiness, and the Retire button (P2), and life events, the tax tutorial, save slots, and going back only in the review (P3).

## Repository layout

Everything for Larp City lives in this folder, which is the private GitHub repository https://github.com/cayden-h/LarpCity (branch `main`).

| Path | What it is |
| --- | --- |
| `game/` | The playable app (Vite + PixiJS + TypeScript): the city at `/`, the Money desk at `/debt.html`, the simulation in `game/src/sim/`, tests in `game/tests/`, and build scripts in `game/scripts/`. See [game/README.md](game/README.md). `game/plates-src/` (95 MB of regenerable plate sources) is gitignored. |
| `server/` | The API server (Express + Zod + pg over Tiger Data): holds every key from the root `.env` and serves `/api/*` (runs and history, the Nessie bank mirror, the voice intake, the Gemini coach and newspaper). See [server/README.md](server/README.md), including how to deploy. |
| `research/` | Research and design docs (start with [research/SUMMARY.md](research/SUMMARY.md)), plus the data builders and their raw inputs in `research/data/` (the card-art upscaler weights go in the gitignored `research/data/cards/models/`). |
| `docs/` | Everything else written about the project; see [docs/README.md](docs/README.md). |
| `docs/meetings/` | The team's decision log; a later meeting wins over an earlier one. |
| `docs/superpowers/` | Specs and plans for feature work (the backend, the investing twins, the Nessie fallback, and more). |
| `docs/diagrams/` | Pitch-deck diagrams (SVG sources and PNG exports), currently for the debt system. |
| `docs/screenshots/` | Screenshots of the game, grouped by the feature they document. |
| `docs/notion/`, `docs/history/` | The team's original Notion notes, backups of the Notion page before each automated edit, and resolved integration records. |
| `SETUP.md`, `.env.example` | API keys and integrations; copy `.env.example` to `.env` (never committed). |
| `CLAUDE.md` | Commands and architecture for Claude Code sessions working in this repository. |
| `requirements.txt` | Python dependencies for the data builders and loaders (the game itself is Node: `cd game && npm install`). |

Team Notion page (organized, the live source of truth): https://app.notion.com/p/Larp-City-3d846cd8aa24804a9c63c8bfc95a5e6b
Backup of the team's original Notion notes, before reorganizing: [docs/notion/original-notes.md](docs/notion/original-notes.md).

## How it plays

| Part of the game | What it means in Larp City |
| --- | --- |
| Onboarding | Sammy, the owl narrator (ElevenLabs voice agent), walks you through your starting life: job, salary, rent, debt, savings |
| Income | Paychecks hitting your checking account |
| Building up | Allocate money into Emergency Fund, Roth IRA, 401k, brokerage, savings |
| The city | Each NPC's home and assets; they visibly upgrade or decay with net worth |
| Disasters | Financial events: market crash, the AI bubble pop, recession, layoff, injury and hospital bill, car breakdown, divorce, penny-stock tip |
| Responding | Player makes a decision at that moment (hold or sell stocks, repair or replace the car, a hospital payment plan, sign the prenup) |
| Losing | Bankruptcy or homelessness, followed by a "what went wrong" breakdown |
| Progress | Reach a goal (buy a house, move states), which becomes a milestone on the way to retirement |
| Time | A daily calendar, with seasons and map changes as months and years pass |

Events are probabilistic, each with its own likelihood and timing.
Some are one-offs, like the AI bubble pop, which can only happen once per run; it and the AI Boom before it are preset to fixed dates so they always show up in the demo.
At the end-of-game review, the calendar lets the player go back to any past decision, change it, and see on the same market path what actually works; during play every choice sticks.

## Tech plan

- **Rendering: PixiJS (v8) over Phaser.**
  It is built for 2D isometric sprite scenes like ours.
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
- **Voice:** ElevenLabs for Sammy, the owl narrator: the onboarding interview (a voice agent) and the voiced lines for big moments (text to speech with word timings).
- **Feedback:** An LLM turns the event log into the "what went wrong" post-mortem when an NPC goes broke.
- **Database:** Tiger Data (Postgres with TimescaleDB) stores every week of NPC finances, market prices, events, and current city data.
- **Hosting:** Vultr runs the game and backend at https://144-202-68-33.sslip.io (Caddy serves the game over HTTPS and proxies `/api/*` to the Node server under systemd); the GoDaddy Registry domain is still to come.
- **AI memory:** Backboard remembers each player's past decisions and answers questions from our research docs.

## Sponsor prize plan (MLH)

From the [MLH HackRice prizes page](https://www.mlh.com/events/hackrice-71/prizes).
All of these stack on one Devpost submission, on top of the track, Capital One, and Persona.

| Prize | Reward | How Larp City uses it |
| --- | --- | --- |
| Best Use of Gemini API | Google swag kits | The coach's lessons, the newspaper, "what went wrong" recaps, and "Your Real Plan" text (the selfie avatar was dropped for a preset avatar on 2026-09-13) |
| Best Use of ElevenLabs | Wireless earbuds | Sammy, the owl narrator: a voice-agent onboarding interview, then expressive voiced lines with live captions for big life moments (a debt paid off, collections, bankruptcy, a move, a crash), plus news-anchor alerts and sound effects |
| Best Use of Tiger Data | Stream Deck Mini | Time-series database for weekly NPC finances, market, events, and current city data, powering live charts, the leaderboard, and the end-of-game review's rewind (free tier, 750 MB) |
| Best Use of Vultr | Portable screens | Hosts the game and backend with API keys server-side ($100 MLH credits); stretch: GPU or serverless inference for NPC dialogue |
| Best Use of Backboard | Tile Essentials Pack | Player memory across sessions, RAG over our research and 2026 rules, and routing between small and large models |
| Best Domain Name (GoDaddy Registry) | Digital gift card | A domain like larpcity.xyz for the Vultr server |
| Solana, Presage | Various | Low fit; skip |

NPC deaths should be handled as a respectful lesson about life insurance, emergency funds, and wills, not a shock moment.
- **Art:** Isometric pixel-art tiles and building sprites.

## 24-hour MVP

1. Onboarding where the player enters their real finances (or a made-up scenario).
2. Isometric map of one district, pan and zoom.
3. Daily tick engine with paychecks, bills, and the five account types from the notes.
4. Random event system with per-event probabilities, at least one one-off (AI bubble pop), and life events (layoff, marriage, divorce with a prenup, injuries, car breakdowns).
5. HUD: net worth, date, pause / 1x / 2x / +1 month and "Skip to next event", event alert badges; a Calendar app in the phone with red (event) and blue (decision, milestone) circles.
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

Status (2026-09-13): the Calendar with "Skip to next event" is built.
The revamp's P3 adds seeded life events (car breakdowns, injuries, divorce and the prenup, penny-stock tips, recessions), the year-1 tax tutorial, three save slots with judge demo lives, and going back only in the end-of-game review.
P1 (Sammy's onboarding) and P2 (goals, happiness, and the Retire button with its "You passed!" end screen) are built.

## Open questions

Answered in the 2026-09-11 meeting: time runs daily with skips, the goal is retirement, and the player lives their own life.
Answered on 2026-09-12 (see the meeting file's "Follow-up decisions"): events during skips, scoring, unlimited rewind from the calendar (narrowed on 2026-09-13 to the end-of-game review), run speeds, and a preset AI Bubble Pop date instead of curated demo seeds.
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
