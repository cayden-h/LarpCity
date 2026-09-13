# Larp City: game prototype

The city renderer for Larp City: a full-screen toy-brick world for every US state, with day and night, weather, traffic, NPCs, and landmarks.
Each city's core (hand-made for Houston, Dallas, Austin, San Francisco, New York, and Miami; generated from a per-state "vibe" everywhere else) sits inside a larger generated world of suburbs, a beltway, country roads, farms, forest, and the state's terrain, so the map fills the screen and there is always more to drag around to.
Design notes: [../research/05-city-visuals-and-art-pipeline.md](../research/05-city-visuals-and-art-pipeline.md).

## Run it

```sh
npm install
npm run dev
```

Open the printed URL.
Add a state to the URL to jump straight there, for example `#CA` or `#NY`; `#TX` (Houston) is the default.
The first visit opens the owl narrator's intake; the voice call needs the server from `../server` running and a microphone, and typing the numbers or skipping works without either.
The answers are remembered in the browser: add `?intake=1` to do the intake again, or `?intake=0` to skip it (the sample household).

## What you can do

- **Intake:** before the city opens, the owl narrator (an ElevenLabs voice agent with a dry, deadpan English voice) asks for your job, salary, rent, debt, and savings, real or made up, and you check the numbers before moving in. You can type them instead, or skip to the sample household. Your life starts from those numbers: take-home is 80% of the salary, the rent is what you said (rescaled if you move states), the debt is a credit card for the first $5,000 plus a personal loan for the rest, and the savings sit in high-yield savings.
  Everyone also starts with the starter portfolio (`STARTER_PORTFOLIO`), on top of the stated savings and debt, so net worth moves with the market from day one.
- **Narrator:** the owl narrates the big moments at the bottom of the screen, read aloud with each word lighting up as it's spoken: arriving, paying off a debt, a missed payment, collections, bankruptcy, a big credit score change, a new home, a move, a market crash (a bear market, as the Money window opens on the crash decision) and the market's return to its high, and the end of a fast-forward.
  While the owl talks over the U.S. map, the Money window, or the fast-forward, the window leaves a band clear at the bottom for it.
  The mute button keeps the captions and drops the voice.
  The lines are in `src/narration/lines.ts`; the owl's animations are cut from the sheets in `art/owl/` by `art/owl/slice.py`.
- Drag to pan anywhere in the world, and scroll to zoom (zoom out to see the suburbs, farms, and the state's terrain).
- **NPCs:** click a person on the sidewalk to see their name, job, and what they are thinking about money right now.
- **Your home:** the one card always on screen, at the bottom left.
  Step the player's net-worth tier up or down and watch the home rebuild (tent, studio, small house, townhouse, large house, retirement villa), or press the pin to fly the camera to it.
- **Phone:** the hub for everything else, pulled up from the bottom-right corner (click its top edge to put it away or bring it back).
  The home screen shows the date, an S&P 500 widget, and the apps.
  **Stocks** lists the HackRice sponsor stocks at today's game prices (tap one to open its page in the Money desk) and a market watchlist, and opens the Money desk over the city (city time pauses while it is open).
  **Goals** opens the fast-forward.
  **Map** shows the city you are in, its cost-of-living tier, and a button to the U.S. map.
  **Weather** shows the city's weather, any event under way, and the season.
  **Timeline** sets the speed (pause, 1x at 1 game week per 10 seconds, 2x, 4x) and plays +1 week and +1 month skips as a time-lapse.
  News, Mail, and Bank are coming.
- **U.S. map:** a pixel map shaded by cost-of-living tier (BEA price parities), with pixel pins for the hand-made cities, a marker on where you are, and a preview of your city captured from the canvas; visit any state for free.
- The city's event buttons (hurricane, crash, boom, and the rest), the sky slider, and the zoom buttons are gone from the screen.
  The events still run from the console, for example `larp.scene().trigger("crash")`; the others are `hurricane`, `snowstorm`, `wildfire`, `drought`, `fog`, `pandemic`, `boom`, and `clear` (which ends them).
  `larp.scene().resetCamera()` recenters the camera, and `larp.clock.pinnedTimeOfDay = 0.8` holds the sky at one time of day (`null` lets it run again).
- **Goals (fast-forward to a goal):** pick an emergency fund, debt-free, life savings, a home, marriage, or a career-income target. Set the plan, preview its finances across 100 other possible markets, then fast-forward until the goal is met, bankruptcy, or an age cap. Marriage timing is not forecast by the financial preview; income targets use current pay until salary progression exists.
- **Life score:** the Money desk's Score tab shows retirement readiness, lifetime wellbeing and nine wellbeing factors. Completed marriage, income and life-savings goals show the same combined score. [Engine contracts and assumptions](../docs/life-goals-wellbeing.md) cover frontend integration and the research behind the model.
- **Money:** every game day the player is paid on the 1st and 15th, pays rent and living costs for the current state, and pays their debts; with a plan in force, paychecks also fund the 401(k) (with the employer match), the emergency fund, and recurring investments. The home tier follows net worth, and bankruptcy stops a skip or fast-forward.

From the browser console, `larp.visit("CO")` opens a state and `larp.step(5)` simulates 5 seconds (useful in background tabs, which throttle animation).

## How it is built

- PixiJS v8, Vite, TypeScript; the HUD, the phone, and the U.S. map are plain DOM over the canvas.
- `src/ui/pixel-theme.css`: the pixel look over the whole DOM UI (hard-edged panels, pixel buttons, the phone's apps, and the map), imported by `src/main.ts`.
  It sets the Pixelify Sans font (`public/fonts/`, preloaded in `index.html`); `src/ui/pixel-icons.ts` draws the pixel icons for the phone and the HUD.
- `src/engine/`: the scene and camera, the world builder that wraps each city in suburbs, farms, and terrain (`world.ts`), isometric math, the chunked studded ground and roads (`ground.ts`), the brick building builder (`bricks.ts`), traffic and boats (`traffic.ts`), NPCs on foot (`people.ts`), weather effects, and the player's home.
- `src/cities/`: the six hand-made cities (Houston, Dallas, Austin, San Francisco, New York, Miami) with their landmarks, the per-state vibes (`vibes.ts`) and regional templates that cover every other state, and the feature landmark library (`features/`).
- `src/data/states.ts`: generated by `../research/data/build_states_rpp.py` from BEA data; do not edit by hand.
- `src/sim/debt/`: the daily debt engine ([design](../research/07-debt-system-design.md)); `src/sim/money/`: accounts and transfers, card and loan applications, and rewards ([design](../research/08-cards-loans-accounts.md)).
- `src/sim/life/`: the player's money life (`PlayerLife`): paychecks, state-scaled rent and living costs, the accounts ledger, the debt engine, brokerage holdings and recurring buys, and the standing orders' 401(k), emergency fund, and crash rule, run from `Clock.onDay` in `src/main.ts`; `rates.ts` reads the market snapshot.
  `twins.ts` keeps the "if you had held" and 90/10 autopilot shadow portfolios of every dollar of new money the player invests (never sold, on the same seeded prices), so each daily snapshot carries `you`, `held`, and `autopilot`, and `PlayerLife` emits `bear_market` the first time the total market closes 20% below its high while the player owns stocks, then `market_recovered` at its next high.
- `src/sim/market/`: the seeded market path (`MarketPath`): real FRED history before game day 0, then research/03's bull/bear regime model on trading days, with the preset AI Boom and AI Bubble Pop, priced for the LTM, BOND, and NNST instruments and the HackRice sponsors as stocks (COF, GOOG, and GDDY start near their real prices; ElevenLabs, Tiger Data, Vultr, Backboard, and Persona are private, so their tickers are made up). Each instrument is priced only when asked for, from the market's stored daily shocks.
- `src/sim/skip/`: goal fast-forwards ([design](../research/10-teleport-and-goal-skips.md)): standing orders (`orders.ts`), goals and their price tags (`goals.ts`), the crash rule shared by the daily life and the preview (`crash.ts`), the preview's 100 other futures built in a Web Worker (`futures.ts`, `futures.worker.ts`), the live preview (`preview.ts`), and the headless run (`run.ts`).
- `src/sim/wellbeing/`: pure wellbeing factors, decaying event pulses, retirement readiness and the combined life score. `PlayerLife` supplies state and stores a daily wellbeing value alongside its separate credit score.
- `src/ui/phone.ts`: the phone hub and its app registry (add new apps to `APPS`), with the Stocks, Map, Weather, and Timeline views and the Money window.
  `src/main.ts` gives it the city (`getWorld`), the U.S. map (`openMap`, with a preview from `captureCityPreview`), and the time-lapse skip (`skipDays`).
  `src/ui/skip-setup.ts` is the fast-forward setup screen; `src/ui/hud.ts` (the home card), `usmap.ts`, and `npccard.ts` are the rest of the DOM HUD.
- `debt.html` + `src/debt-demo/main.ts`: the Money desk ([design](../research/12-credit-desk-ui.md)) in Robinhood's look: a logo-and-search top bar (`/` or ⌘K finds stocks, cards, debts, and pages), a floating time dock, Home (net worth), Cash (accounts, transfers, and a bank-style statement), Investing (funds, stocks, and the HackRice sponsors, each with a position and key statistics page), Debt, Credit, and Cards, over the city's `PlayerLife` (opened from the phone) or its own (standalone), both with the starter portfolio (`STARTER_PORTFOLIO`), so net worth moves with the market from day one and charts show the real market before day 0.
  Investing charts you, if you had held, and autopilot on one zero-based chart; a bear market pauses time for Sell everything, Sell half, Hold, or Buy more; the recovery card compares the lines and shows the coach's lesson; and a card warns when one stock is over 20% of the portfolio ([spec](../docs/superpowers/specs/2026-09-12-investing-twins-design.md)).
  Standalone, the desk records its own run through `src/sim/record/`; `src/net/recap.ts` asks the server's coach for the recovery lesson.
- `src/data/market.ts`: a year of the S&P 500, Nasdaq, Dow, Fed funds, 10-year Treasury, and 30-year mortgage from FRED, generated by `npm run market:snapshot`; do not edit by hand.
- `vite.config.ts`: builds both pages and serves `/api/market/*`, which proxies Alpha Vantage quotes when `ALPHAVANTAGE_API_KEY` is set (in `game/.env.local` or the root `.env`), caching in `.cache/market/` for the free tier's 25 requests a day; without a key the pages use the FRED snapshot.
- `src/data/cards.ts`: 335 national card plans (CFPB survey), 124 sign-up offers, and the latest FRED rates, generated by `../research/data/cards/build_cards.py`; do not edit by hand.
- `src/data/cards-curated.ts`: the Card Shop's 23 real cards (issuer-page details, CFPB terms, official art in `public/cards/art/`), from the same script; do not edit by hand.
- `src/debt-demo/shop.ts`: the Card Shop on the Money desk's Cards tab (`/debt.html`), in the desk's look and sorted by default by year-one value times your approval odds; `shop-value.ts` holds the year-one value math.
- `db/`: the Tiger Data schema (`schema.sql`) and loader (`load.py`); see [SETUP.md](../SETUP.md).
- Everything random is seeded, so a city, its weather, and its traffic replay the same way.

## Scripts and tests

| Command | What it does |
| --- | --- |
| `npm run dev` | The city at `/` and the Credit Desk at `/debt.html` |
| `npm run build` | Typecheck, then build both pages into `dist/` |
| `npm test` | Node's built-in test runner over `tests/` (debt engine, money life, money, market, sprites, Card Shop, and goal fast-forwards); no test dependencies |
| `npm run market:snapshot` | Refresh `src/data/market.ts` from FRED (no key needed) |
| `npm run debt:charts` | Redraw the pitch chart `../diagrams/debt/05-payoff-strategies.svg` from the engine |

## Building sprites (Blender)

Cities with a sprite set draw their buildings from pre-rendered Blender sprites instead of the procedural builder (`src/engine/bricks.ts`, still used for lots no sprite fits and for cities without sprites).
San Francisco is the first city with a set ([design](../docs/superpowers/specs/2026-09-12-realistic-sprites-design.md)).

```sh
brew install --cask blender   # once; the scripts run it headless
npm run art:sf                # textures, ad art, render, registration check
blender -b -P art/build.py -- --city san-francisco --only glass-2x2-f16-salesforce   # rerender one sprite
```

- `art/catalog.py`: which sprites a city gets (archetype, footprint, floors, zones, and brand signage); branded entries are placed once per city, first.
- `art/lib/`: the camera matched to the game's 2:1 projection (`iso.py`, `scene.py`), materials with a day/night switch, the archetypes (glass tower, brick loft, concrete office), and signs (3D channel letters, rooftop billboard).
- Signage follows how SF actually looks (research in the [spec](../docs/superpowers/specs/2026-09-12-realistic-sprites-design.md)): no brand names on tower tops (SF bans rooftop signs downtown), brands at street level (the Capital One Café, Jeni's, a Wells Fargo branch, lobby logo walls and monuments for Google, Uber, Meta, OpenAI, Goldman Sachs), AI-style billboards on old SoMa lofts and freeway V boards, painted murals and the Levi's ghost sign, backlit Muni shelters, the Salesforce Tower's LED crown, and the Ferry Building's red "PORT OF SAN FRANCISCO" letters.
- `art/make_ads.py` draws all sign and ad art into `art/ads/` (review sheet: `art/ads/_contact.png`). Every text element is fitted to its box and the script fails if anything leaves the sign's safe area; Blender maps each image onto a face with exactly its aspect ratio, so art never runs off a sign.
- `art/fetch_textures.sh` downloads CC0 photo textures from [ambientCG](https://ambientcg.com) into `art/textures/`.
- Output: `public/sprites/<city>/`, a day PNG and a night PNG per sprite (the night pass is black except what glows, drawn with additive blending) plus `sprites.json` (footprint, anchor pixel, height).
- `art/check_register.py` fails if a sprite is off its tile diamond by more than one game pixel.
- `src/engine/sprite-pick.ts` chooses a sprite per lot (tested in `tests/sprites.test.ts`); `src/engine/sprites.ts` loads the set and returns the same `Built` shape as the brick builder.

## Plate images (states-map thumbnails)

The game itself uses no background images: the city fills the screen.
The generated plates are only shown as thumbnails on the states map.
Each city has 4 plates in `public/cities/<id>/plates/`: `day`, `golden`, `night`, `overcast`.
They come from ChatGPT Images 2.0 through the Codex CLI, which uses your ChatGPT login (no API key):

```sh
python3 scripts/gen_plates.py houston              # all 4 plates for one city
python3 scripts/gen_plates.py houston --only night # just one
python3 scripts/gen_plates.py --all --jobs 3       # everything missing
python3 scripts/gen_plates.py miami --force        # regenerate
```

The day plate is generated from the prompt in `scripts/plate-prompts.json`; the other three are edits of it, so the skyline stays in place.
Only the JPEGs live in `public/` (about 16 MB for all 14 sets); the full-size PNGs (the edit references) and Codex logs go to `plates-src/` (about 95 MB), which never ships.
If this folder goes into git, keep `plates-src/` out of it or put it on Git LFS.
To refine a city's look, edit its prompt and rerun with `--force`.
If a plate is missing, the game paints a simple fallback sky, so nothing breaks.
