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
The game is San Francisco, California (`#CA`); any other state in the URL falls back to it.
The first visit opens the title screen, where Sammy (the owl narrator) can walk you through the game, then the save slots.
`?slot=0` (1, 2) goes straight into a slot, `?intake=1` starts a new life over its save, and `?intake=0` skips the title and Sammy's setup.

## What you can do

- **Title screen and Learn:** a new life opens on Larp City's name, Sammy, and a Learn button over a blurred San Francisco (`src/ui/title.ts`).
  Learn has Sammy walk through the game in eight bubbles (who you are, the retirement goal, the phone, milestones and where you live, time and skips, what stops a skip, his tips, then the save slots and goals), with Back, Next, and Skip; the script is `src/narration/learn.ts`.
  Finishing or skipping it, or "Skip to save slots", opens the save slot picker full screen (`src/ui/slots.ts`): play a saved life, start a new one in an empty slot ("New life" over a saved one asks twice), or load a demo life.
- **Sammy's setup:** a new life never asks for money. Everyone starts the same way (`defaultAnswers` and `starterFor` in `src/sim/life/intake.ts`): age 22, a new-grad job, a salary drawn from $35,000-$50,000 (20% higher in a high cost-of-living state), $20,000-$40,000 of debt as a credit card plus a personal loan, a 600 credit score, the fixed car loan, rent at the state's median, and $3,700 in high-yield savings, all drawn from the run's seed.
  Sammy presents that life, then the player picks a name and a man or a woman, a health plan, and a starter card, and sets the four permanent goals one at a time, each with the age to reach it: retire by, debt-free by, own a home by (with the down payment), and married by (or not a priority) (`src/ui/intake.ts`).
  Everyone also starts with the starter portfolio (`STARTER_PORTFOLIO`), so net worth moves with the market from day one.
- **Sammy:** the owl narrator reads out the big moments at the bottom of the screen, read aloud with each word lighting up as it's spoken: arriving, paying off a debt, a missed payment, collections, bankruptcy, a big credit score change, a new home, a move, a market crash (a bear market, as the Money window opens on the crash decision) and the market's return to its high, and the end of a fast-forward.
  While Sammy talks over the Money window or the fast-forward, the window leaves a band clear at the bottom for it.
  The mute button keeps the captions and drops the voice.
  The lines are in `src/narration/lines.ts` (his name is `NARRATOR_NAME` there); the owl's animations are cut from the sheets in `art/owl/` by `art/owl/slice.py`.
- **Sammy's tours:** the first time you open Stocks, Sammy offers a two-minute tour of investing, and the first time a tax return is ready, opening Taxes walks you through it, ending on the bottom-line question.
  He stands next to the real UI, spotlights it, and explains it with your own numbers; the city's time stops until the tour ends.
  The "?" in the Stocks header and on the Taxes tab plays a tour again, as does `larp.tour("stocks")` from the console.
- Drag to pan anywhere in the world, and scroll to zoom (zoom out to see the suburbs, farms, and the state's terrain).
- **NPCs:** click a person on the sidewalk to see their name, job, and what they are thinking about money right now.
- **Your home:** the one card always on screen, at the bottom left.
  Click the home name or any home lot to compare the six tiers, neighborhoods, monthly payments, cash needed, and mortgage qualification reasons.
  The picker pauses the calendar; choose 3.5%, 10%, or 20% down and confirm the costs to move.
  Each tier has its own lot, and the pin moves to the chosen home.
  The tent is emergency shelter after eviction, foreclosure, or bankruptcy, not a voluntary purchase.
  Press the pin button to fly the camera to the current home.
- **Phone:** the hub for everything else, pulled up from the bottom-right corner (click its top edge to put it away or bring it back).
  The home screen shows the date, an S&P 500 widget, and the apps.
  **Stocks** lists the HackRice sponsor stocks at today's game prices (tap one to open its page in the Money desk) and a market watchlist, and opens the Money desk over the city (city time pauses while it is open).
  **Goals** opens the fast-forward.
  **Map** shows San Francisco and its cost-of-living tier.
  **Weather** shows the city's weather, any event under way, and the season (dropped from the phone per the 2026-09-13 meeting, in P2).
  **Calendar** shows the player's days as a month grid in the pixel theme: red chips for money days and events, blue for their own choices, only scheduled money on future days, and a yellow "?" on the next decision day, which never says what it is.
  Tapping a past day goes back to that morning (a real rewind, `src/sim/rewind/`) once the end-of-game review opens it; during play the day's sheet says so instead, tapping the "?" plays the days up to it as a time-lapse, the back arrow zooms out to the year, and the speed strip is pause, 1x, and 2x.
  "Start a new life," in the year view, erases the save and starts over.
  **Save slots**, also in the year view (or open the game at `/?slots=1`), lists your three lives and loads a judges' demo life into any slot: year one in San Francisco before the first tax day, married into the AI bubble, or almost retired.
  Your life is saved on the server as you play and resumes where you left off on reload.
  **Mail** shows your life's letters (a bank statement, a missed payment, a goal reached).
  **News** is the Larp City Ledger, a monthly newspaper the server writes from your run's stored data.
  **Bank** is your Capital One Nessie bank statement.
- The city's event buttons (hurricane, crash, boom, and the rest), the sky slider, and the zoom buttons are gone from the screen.
  The events still run from the console, for example `larp.scene().trigger("crash")`; the others are `hurricane`, `snowstorm`, `wildfire`, `drought`, `fog`, `pandemic`, `boom`, and `clear` (which ends them).
  `larp.scene().resetCamera()` recenters the camera, and `larp.clock.pinnedTimeOfDay = 0.8` holds the sky at one time of day (`null` lets it run again).
- **Goals (fast-forward to a goal):** pick an emergency fund, debt-free, life savings, a home, marriage, or a career-income target. Set the plan, preview its finances across 100 other possible markets, then fast-forward until the goal is met, bankruptcy, or an age cap. Marriage timing is not forecast by the financial preview; income targets use current pay until salary progression exists.
- **Life score:** the Money desk's Score tab shows retirement readiness, lifetime wellbeing and nine wellbeing factors. Completed marriage, income and life-savings goals show the same combined score. [Engine contracts and assumptions](../docs/life-goals-wellbeing.md) cover frontend integration and the research behind the model.
- **Money:** every game day the player is paid on the 1st and 15th, pays rent and living costs for the current state, and pays their debts; with a plan in force, paychecks also fund the 401(k) (with the employer match), the emergency fund, and recurring investments. Housing follows the player's choice rather than net worth, and bankruptcy stops a skip or fast-forward.
- **Life events:** car breakdowns, injuries, divorce, penny-stock tips, and recessions roll from the run's seed.
  The ones with a choice (repair or replace the car, pay the hospital or take its 0% plan, buy the tip or pass, sign a prenup at the wedding) pause the city and open in the Money desk; one left unanswered for a week takes its default.
- **Taxes:** the Money desk's Taxes tab walks the first return through a tutorial that ends by asking for the bottom line; get it right and every later return files itself on tax day.

The game is always San Francisco, California: any other state in the URL hash (`#TX`) falls back to `#CA`.
From the browser console, `larp.step(5)` simulates 5 seconds (useful in background tabs, which throttle animation).
`larp.slots()` opens the save slots, and `larp.review()` opens going back to past days (until P2's Retire button opens it at the end of the game).

## How it is built

- PixiJS v8, Vite, TypeScript; the HUD and the phone are plain DOM over the canvas.
- `src/ui/pixel-theme.css`: the pixel look over the whole DOM UI (hard-edged panels, pixel buttons, the phone's apps, and the map), imported by `src/main.ts`.
  It sets the Pixelify Sans font (`public/fonts/`, preloaded in `index.html`); `src/ui/pixel-icons.ts` draws the pixel icons for the phone and the HUD.
- `src/engine/`: the scene and camera, the world builder that wraps each city in suburbs, farms, and terrain (`world.ts`), isometric math, the chunked studded ground (`ground.ts`), the brick building builder (`bricks.ts`), traffic drawing and boats (`traffic.ts`), NPCs on foot (`people.ts`, whose street walkers use `roads/sidewalks.ts`), weather effects, and the player's home.
- `src/engine/roads/`: the road network and traffic sim ([spec](../docs/superpowers/specs/2026-09-12-roads-traffic-design.md)).
  Cities and the world builder emit `RoadDef` vectors (`types.ts`, `outskirts.ts` for the generated roads, highway ring, and interchanges), and the layout's road tiles are stamped from them.
  `graph.ts` builds nodes, lanes, and movements with their conflicts; `control.ts` picks signals, stop signs, and yields and runs signal phases; `sim.ts` drives cars (car-following, intersection admission, lane changes, a watchdog); `router.ts` and `trips.ts` plan rush-hour trips, curb parking, buses, and cable cars; `sidewalks.ts` walks people and crosses them at crosswalks; `marks.ts` and `draw.ts` paint markings, signals, signs, and overpass decks.
  None of it but `draw.ts` imports PixiJS, so it is all tested headless (`tests/roads-*.test.ts`).
- `src/cities/`: the six hand-made cities (Houston, Dallas, Austin, San Francisco, New York, Miami) with their landmarks, the per-state vibes (`vibes.ts`) and regional templates that cover every other state, and the feature landmark library (`features/`).
- `src/data/states.ts`: generated by `../research/data/build_states_rpp.py` from BEA data; do not edit by hand.
- `src/sim/debt/`: the daily debt engine ([design](../research/07-debt-system-design.md)); `src/sim/money/`: accounts and transfers, card and loan applications, and rewards ([design](../research/08-cards-loans-accounts.md)).
- `src/sim/life/`: the player's money life (`PlayerLife`): paychecks, state-scaled rent and living costs, the accounts ledger, the debt engine, brokerage holdings and recurring buys, and the standing orders' 401(k), emergency fund, and crash rule, run from `Clock.onDay` in `src/main.ts`; `rates.ts` reads the market snapshot, and `events.ts` rolls the seeded life events (breakdowns, injuries, divorce, penny stocks, recessions) whose choices the Money desk asks.
  The year-1 tax tutorial is `src/sim/tax/tutorial.ts`.
  `twins.ts` keeps the "if you had held" and 90/10 autopilot shadow portfolios of every dollar of new money the player invests (never sold, on the same seeded prices), so each daily snapshot carries `you`, `held`, and `autopilot`, and `PlayerLife` emits `bear_market` the first time the total market closes 20% below its high while the player owns stocks, then `market_recovered` at its next high.
- `src/sim/market/`: the seeded market path (`MarketPath`): real FRED history before game day 0, then research/03's bull/bear regime model on trading days, with the preset AI Boom and AI Bubble Pop, priced for the LTM, BOND, and NNST instruments and the HackRice sponsors as stocks (COF, GOOG, and GDDY start near their real prices; ElevenLabs, Tiger Data, Vultr, Backboard, and Persona are private, so their tickers are made up). Each instrument is priced only when asked for, from the market's stored daily shocks.
- `src/sim/skip/`: goal fast-forwards ([design](../research/10-teleport-and-goal-skips.md)): standing orders (`orders.ts`), goals and their price tags (`goals.ts`), the crash rule shared by the daily life and the preview (`crash.ts`), the preview's 100 other futures built in a Web Worker (`futures.ts`, `futures.worker.ts`), the live preview (`preview.ts`), and the headless run (`run.ts`).
- `src/sim/save/`: the whole game as one saved document ([spec](../docs/superpowers/specs/2026-09-12-save-and-connected-apps-design.md)): `types.ts` (`GameSave`, `DeskState`), a `toSave`/`fromSave` pair on each stateful sim class, `codec.ts` (`restoreGame`, `parseSave`, refusing a save it can't read whole rather than half-loading it), `boot.ts` (which of resume, build from profile, intake, or offline the app takes), and `manager.ts` (`SaveManager`), which autosaves on decisions, new months, and skips, debounces bursts into one write, and treats a 409 as another tab or session now owning the life.
  `slot.ts` picks which of the player's three save slots the page plays (`?slot=`, remembered per browser), and `src/ui/slots.ts` is the picker (Calendar year view, or `/?slots=1`) that plays a slot or loads a demo life from `public/demo/` (rebuild with `npm run demo:slots`).
  Player history is compacted to the recent days plus one snapshot a day further back (`compactHistory` in `src/sim/life/player.ts`) so a long game's save stays small; new sim state has to join both the save codec and `tests/save.test.ts`, or it won't survive a reload.
- `src/sim/mail/`: the phone's Mail app (`inbox.ts`, `MAX_MAIL` letters kept, newest first): letters built from the life's events (a bill, a missed payment, a credit score move, a raise, a market crash), skipping routine days so the inbox reads like the moments that matter; opening a decision letter opens the Money desk on it.
  The inbox is part of the saved game.
- `src/sim/wellbeing/`: pure wellbeing factors, decaying event pulses, retirement readiness and the combined life score. `PlayerLife` supplies state and stores a daily wellbeing value alongside its separate credit score.
- `src/ui/title.ts`: the title screen before the save slots; Learn borrows the `Narrator` in tour mode (`beginTour`, `tourLine`, `place`, `endTour`), centered, to read `src/narration/learn.ts`.
  Its lines join `allLines()`, so the narration pack voices them like every other line.
- `src/ui/phone.ts`: the phone hub and its app registry (add new apps to `APPS`), with the Stocks, Map, Weather, and Timeline views, the Calendar (`src/ui/calendar.ts`, data in `src/sim/calendar/`), and the Money window.
  `src/main.ts` gives it the city (`getWorld`) and the time-lapse skip (`skipTo`).
  `src/ui/skip-setup.ts` is the fast-forward setup screen; `src/ui/hud.ts` (the home card) and `npccard.ts` are the rest of the DOM HUD.
- `src/ui/intake.ts`: Sammy's setup for a new life (the generated life, name and avatar, health plan, starter card, and the four goals with their ages); `src/ui/goal-picker.ts` turns its picks into goals.
- `debt.html` + `src/debt-demo/main.ts`: the Money desk ([design](../research/12-credit-desk-ui.md)) in Robinhood's look: a logo-and-search top bar (`/` or ⌘K finds stocks, cards, debts, and pages), a floating time dock, Home (net worth), Cash (accounts, transfers, and a bank-style statement), Investing (funds, stocks, and the HackRice sponsors, each with a position and key statistics page), Debt, Credit, and Cards, over the city's `PlayerLife` (opened from the phone) or its own (standalone), both with the starter portfolio (`STARTER_PORTFOLIO`), so net worth moves with the market from day one and charts show the real market before day 0.
  Investing charts you, if you had held, and autopilot on one zero-based chart; a bear market pauses time for Sell everything, Sell half, Hold, or Buy more; the recovery card compares the lines and shows the coach's lesson; and a card warns when one stock is over 20% of the portfolio ([spec](../docs/superpowers/specs/2026-09-12-investing-twins-design.md)).
  Standalone, the desk records its own run through `src/sim/record/`; `src/net/recap.ts` asks the server's coach for the recovery lesson.
- `src/data/market.ts`: a year of the S&P 500, Nasdaq, Dow, Fed funds, 10-year Treasury, and 30-year mortgage from FRED, generated by `npm run market:snapshot`; do not edit by hand.
- `vite.config.ts`: builds both pages and serves `/api/market/*`, which proxies Alpha Vantage quotes when `ALPHAVANTAGE_API_KEY` is set (in `game/.env.local` or the root `.env`), caching in `.cache/market/` for the free tier's 25 requests a day; without a key the pages use the FRED snapshot.
  This is development only: the production server doesn't serve `/api/market/*` yet, so the deployed game always uses the snapshot.
- `src/data/cards.ts`: 335 national card plans (CFPB survey), 124 sign-up offers, and the latest FRED rates, generated by `../research/data/cards/build_cards.py`; do not edit by hand.
- `src/data/cards-curated.ts`: the Card Shop's 23 real cards (issuer-page details, CFPB terms, official art in `public/cards/art/`), from the same script; do not edit by hand.
- `src/debt-demo/shop.ts`: the Card Shop on the Money desk's Cards tab (`/debt.html`), in the desk's look and sorted by default by year-one value times your approval odds; `shop-value.ts` holds the year-one value math.
- `db/`: the Tiger Data schema (`schema.sql`) and loader (`load.py`); see [SETUP.md](../SETUP.md).
- Everything random is seeded, so a city, its weather, and its traffic replay the same way.

## Sammy's tours

A tour is a list of steps (`src/narration/tour.ts`); the stocks and taxes tours are in `src/narration/tours.ts`, and `src/ui/tour.ts` puts them on screen.
Each step has Sammy's line (fixed text, or a function of the player's numbers), a reaction (`anim`) and a mood, and optionally:

- `target`: a CSS selector in the city (`doc: "city"`) or in the Money desk's iframe (`doc: "desk"`); every match is spotlit as one box.
  Point at `data-tour` attributes rather than classes, so a restyle keeps the tour pointing at the right thing.
- `setup`: what to open first: a phone app, a desk tab, or a fund's page.
- `advance`: a Next button (the default; `interactive: true` lets clicks reach the target), or `action`, which waits for a life event (a trade) or a click inside the target, and offers Next anyway after `timeoutMs`.
- `when`: the step shows only when this holds for the player's state; `capture` keeps what the player did for later steps.

To add a step, add it to a tour in `tours.ts` and mark its target with a `data-tour` attribute.
A fixed line joins the voice pack through `allLines()`, so run `node scripts/build-narration.ts` afterward; lines with numbers are voiced on the fly, and read silently without the server.
To add a tour, add its id to `TourId` and `TOUR_IDS`, its definition to `TOURS`, and its trigger to `TourGuide.trigger`.

While a tour is open the clock is held (`Clock.held`), so it resumes at the same speed after, and the speed buttons, skips, and fast-forward are off.
Event cues wait in Sammy's queue until the tour ends.
Finishing or skipping records the tour in the save (`GameSave.tours`), so it never starts on its own again.
A reload mid-tour starts that tour over from its first step.

## Houses and choosing a home

The [approved houses design](../docs/superpowers/specs/2026-09-12-blender-houses-design.md) covers the art and housing rules.
`art/lib/houses.py` builds Victorian, Edwardian, Sunset stucco, suburban, and walk-up models with detailed doors, bays, roofs, yards, and windows.
`art/lib/homes.py` builds the six shared hero homes in `public/sprites/common/home/`.
The model rotates for each facing while the camera and light stay fixed.
The day, night, and painted-wall layers pass through `art/pixelize.py`.
Wall overlays use dedicated neutral greys, then the game applies a seeded color from the city palette without tinting windows or roof details.
`art/lib/property_sign.py` supplies the small sale and rental yard boards in `public/sprites/common/property/`, lettered with 3x5 pixel capitals so they read at 1x without hiding the house.

`src/engine/lots.ts` chooses a house's footprint, street-facing door, neighborhood family, and wall tint.
House styling uses its own seeded randomness and preserves the commercial population stream.
`src/engine/home-lots.ts` reserves six distinct lots beside surface roads without covering landmarks or violating sightlines, and never behind a landmark.
Filler buildings in front of a home lot are height-capped like those in front of landmarks, so every home stays visible from the default camera.
SF's curated locations are translated with the world and tested against the widened roads; other cities use geographic placement rules.
`src/engine/scene.ts` draws every home, with sale or rental signs on vacant lots and the ring and pin on the occupied lot.

`src/sim/life/homes.ts` is the shared housing price and quote contract.
`PlayerLife.quoteHome` previews a move without modifying accounts; `chooseHome` rechecks it before spending cash, selling a current property, and opening a mortgage.
The mortgage, property tax, insurance, and PMI are part of the same daily life used by the Money desk, saves, rewind, and fast-forward.
Selling deducts 6% costs and repays the mortgage; moving states sells an owned home and starts a studio rental.
Home value stays flat, and net worth includes the owned property less its debt.
Goals and fast-forward previews include this asset and the ownership bills; PMI ends at 80% loan-to-value, including when extra debt payments accelerate it.
`src/ui/home-picker.ts` displays the quote and confirms a move; the HUD no longer has debug tier buttons.

To rebuild the new shared sets from `game/`:

```sh
blender -b -P art/build.py -- --city common/home
python3 art/pixelize.py common/home --new-palette
python3 art/check_register.py common/home
blender -b -P art/build.py -- --city common/property
python3 art/pixelize.py common/property --new-palette
python3 art/check_register.py common/property
```

## Scripts and tests

| Command | What it does |
| --- | --- |
| `npm run dev` | The city at `/` and the Money desk at `/debt.html` |
| `npm run build` | Typecheck, then build both pages into `dist/` |
| `npm test` | Node's built-in test runner over `tests/` (debt engine, money life, money, market, sprites, Card Shop, and goal fast-forwards); no test dependencies |
| `npm run market:snapshot` | Refresh `src/data/market.ts` from FRED (no key needed) |
| `npm run debt:charts` | Redraw the pitch chart `../diagrams/debt/05-payoff-strategies.svg` from the engine |

## Building sprites (Blender)

Cities with a sprite set draw their buildings from pre-rendered pixel-art sprites instead of the procedural builder (`src/engine/bricks.ts`, still used for lots no sprite fits and for cities without sprites).
San Francisco retains its 43 landmark and commercial sprites and adds 64 house sprites, from 16 models in four facings ([design and approved look](../docs/superpowers/specs/2026-09-12-blender-houses-design.md)).
Run these commands from `game/`, with Blender and the repository's Python dependencies installed:

```sh
brew install --cask blender                         # macOS; runs headless
python3 art/make_ads.py                             # regenerate sign art
blender -b -P art/build.py -- --city san-francisco   # raw 4x layers, art/.raw/san-francisco/
python3 art/pixelize.py san-francisco                # final 1x sprites, using the kept palette
python3 art/check_register.py san-francisco          # full catalog, registration, layers, alpha, and palette checks
python3 art/contact.py san-francisco                 # paged 1x and 4x review sheets
python3 -m unittest discover -s art/tests            # pixel pipeline unit and integration tests
npm run art:sf                                     # sign art, render, pixelize, registration check
```

- `art/brands.py` is the brand roster: 37 companies (HackRice sponsors first), each one entry with its wordmark, colors, drawn mark, and placements (rooftop bulletin, wall board, painted wall, storefront, HQ, freeway V board, shelter) ([design](../docs/superpowers/specs/2026-09-13-sf-brands-design.md), [progress](../docs/superpowers/plans/2026-09-13-sf-brands-progress.md)).
  Adding a company is one entry, plus a mark function in `make_ads.py`'s `MARKS` if it needs a new shape.
- `art/catalog.py` defines archetypes, footprints, floors, and zones, and builds every branded entry from the roster.
  The game places branded buildings first, each on the best free lot of its footprint: in its area (`areas` in the city definition, such as SoMa or the Embarcadero), then in its zone's core, then anywhere in the zone (`brandLots` in `src/engine/lots.ts`), so every brand appears whenever its footprint fits.
- `art/lib/` contains the camera matched to the game's 2:1 projection, the archetypes, signs, and flat pixel materials with a day/night switch.
  Brick joints and stone courses use procedural patterns aligned to the 1x pixel grid; no photo textures or texture-download step are needed.
- `art/build.py` writes day, night, and exact face-id layers at 4x, plus optional crown masks and `raw.json`, into the gitignored `art/.raw/<city>/` directory.
  A warm key light lights the left face and shades the right, with a bounded cast shadow behind the building.
- `art/pixelize.py` splits off shadows, flattens each id region to at most three tones, shrinks by majority color with sign-stroke preservation, quantizes without dithering, and draws ink outlines.
  Shadows are restored as one flat translucent tone without an outline.
  The city palette in `art/palettes/<city>.json` is kept across rerenders; `--new-palette` rebuilds it for the whole set and cannot be combined with `--only`.
  SF uses 60 day colors, including 32 reserved for signs and lit shop glass, and 16 night colors.
- To rerender one sprite after a full local render, pass the same id to both commands, for example `blender -b -P art/build.py -- --city san-francisco --only loft-1x1-f3-14`, then `python3 art/pixelize.py san-francisco --only loft-1x1-f3-14`.
  `build.py --missing` resumes missing raw layers; pixelize reports missing or stale outputs.
- Signage follows how SF actually looks (research in the [spec](../docs/superpowers/specs/2026-09-12-realistic-sprites-design.md)): no rooftop signs or crowns downtown (SF bans rooftop signs there), brands at street level (storefronts with lit bands and blade signs, lobby logo walls, monuments), HQ name bands over the lobby and across the top floor as wall signs, lit wall boards on low downtown offices, rooftop bulletins on old SoMa lofts, V boards beside the freeway nearest downtown (`placeVBoards`), painted murals and ghost signs (Levi's, Ghirardelli), backlit Muni shelters, the Salesforce Tower's LED crown, and the Ferry Building's red "PORT OF SAN FRANCISCO" name on its frieze.
- `art/make_ads.py` draws sign and ad art into `art/ads/` using the game's own bold Pixelify Sans (`public/fonts/pixelify-sans-bold.ttf`, with its OFL license alongside it) and flat paint wear.
  Every text element is fitted to its box, and the script fails if anything leaves the sign's safe area.
  The first brands' signs are drawn by hand (`CUSTOM`); every other file the catalog names is drawn from its roster entry with shared layouts, and `art/tests/test_brands.py` checks that each new sign's capitals are at least 6 or 7 game px at 1x and that its letters stand out from its field.
  Blender maps each image onto a face with its aspect ratio preserved.
  The sponsor pass uses larger readable panels and simpler lettering for small sign surfaces.
- Output in `public/sprites/<city>/` is a day PNG and an additive night PNG per sprite, optional crown masks, and `sprites.json` with `scale: 1`, footprints, anchors, and heights.
- `art/check_register.py` checks day pixels against the city palette, allows only the fixed cast-shadow translucency, and enforces registration within one game pixel for full-lot buildings.
- `art/contact.py` writes numbered `art/_contact-<city>-<page>.png` review sheets at 1x and 4x; an optional id prefix filters the set.
  These local review sheets are not committed.
- `src/engine/sprite-pick.ts` chooses a sprite per lot (tested in `tests/sprites.test.ts`); `src/engine/sprites.ts` loads the set and returns the brick builder's `Built` shape.
  Nearest magnification keeps enlarged pixels crisp, while linear minification reduces shimmer when zoomed out.

## Pixel world (code-drawn art)

Everything in the world that is not a building sprite is pixel art drawn in code at 1x, to the same rules as the Blender pixel pass: hard edges, a `#2b2233` ink outline, at most three flat tones per surface from one upper-left key light, and flat ink shadows at alpha 96 ([design](../docs/superpowers/specs/2026-09-13-pixel-world-design.md), [progress and deviations](../docs/superpowers/plans/2026-09-13-pixel-world-progress.md)).

- `src/engine/pixel/canvas.ts` is `PixelCanvas`, a small rasterizer with no DOM (polygons, rectangles, ellipses, and lines filled by pixel center, part-aware outlines, flat shadows); `tones.ts` has the three-tone ramp.
- `atlas.ts` packs each drawing into shared 2048 x 2048 atlas pages the first time its key is used, so trees, cars, boats, people, and props batch; `patterns.ts` makes the repeating ground textures.
- Families: `plants.ts` (oak, Monterey cypress, pine, palm, and bush in four seeded variants, bare and snowy states, cacti, boulders, reeds), `ground-art.ts` (seamless 16 x 16 terrain patterns and the 3-frame water glints), `vehicles.ts` (every vehicle kind in eight facings, plus the additive lamps), `boats.ts` (seven kinds in four directions with a 2-frame wake), `people-art.ts` (three walk frames per side), and `props.ts` (signals with per-state lamps, stop and yield signs).
- Water animates in whole steps, never fades: glints at 4 frames a second and a 2-frame foam line where land meets water, drawn on the land's back edges where raised land would hide it; beaches get a wet-sand band.
- The Painted Ladies are five of the SF Victorian house sprites with pastel wall tints (`ladiesFromSprites` in `src/cities/san-francisco.landmarks.ts`).
- `src/engine/pixel/catalog.ts` lists every family; `tests/pixel-art.test.ts` checks each one's outline, alpha, and palette, and `npm run art:contact-code` writes `art/_contact-code-1x.png` and `-4x.png` review sheets (not committed; pass a family prefix such as `tree` to filter).

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

The final sprite validator requires the entire catalog and all facings by default.
Use `--allow-partial` only when reviewing a deliberately incomplete sample render; it keeps every per-sprite check.
Run `python3 -m unittest discover -s art/tests` for the pixel pipeline and `blender -b --python-exit-code 1 -P art/check_houses.py` for house geometry checks.
`tests/houses-assets.test.ts` checks the actual shipped catalogs, residential placement coverage, matching layer sizes, and the 8 MB sprite budget.
