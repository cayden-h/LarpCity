# Larp City - Research Brief

A self-contained brief to paste into ChatGPT (or anywhere) as the starting context for the system design and PRD.
Written 2026-09-11 for HackRice 2026 (Sep 11-13, Rice University).
Full details and sources are in the research files next to this one:

- [01-avatar-and-persona.md](01-avatar-and-persona.md)
- [02-states-cost-of-living.md](02-states-cost-of-living.md) (plus [data/states-sample.json](data/states-sample.json))
- [03-stock-market-and-simulation.md](03-stock-market-and-simulation.md)
- [04-impact-learning-and-judging.md](04-impact-learning-and-judging.md)
- [05-city-visuals-and-art-pipeline.md](05-city-visuals-and-art-pipeline.md) (backgrounds, weather, landmarks, traffic, states map)
- [06-debt-and-credit.md](06-debt-and-credit.md) (credit cards, student loans, auto, mortgage, BNPL, payday, credit score, delinquency, bankruptcy)
- [07-debt-system-design.md](07-debt-system-design.md) (how the debt engine is built: daily tick, ladder, score, strategies, wiring, diagrams)
- [08-cards-loans-accounts.md](08-cards-loans-accounts.md) (card applications, perks, loans, moving money, and the real card data in Tiger Data)

## 1. What Larp City is

Larp City is an educational financial-life simulation game with real impact as the goal.
It teaches people to make better financial decisions by letting them live out, in minutes, how those decisions shape a life over decades.
The look and core loop are modeled on LEGO City Adventures: Build and Protect (an isometric PixiJS city builder), but the "fires and crimes" become financial events and the "buildings" become savings, investments, and homes.

Core features (updated after the team's 2026-09-11 game design meeting, see [../meeting-2026-09-11-game-design.md](../meeting-2026-09-11-game-design.md); where this brief conflicts with it, the meeting wins):

- **Retirement is the end goal.** The player lives their own life, from today to retirement.
- **Personalized:** The player enters their real finances, so the challenge scales to them; no preset jobs or salaries, though a made-up scenario is allowed.
- **Avatar onboarding:** The player takes a selfie, which Persona verifies as a real human aged 18+, and gets a look-alike game avatar.
- **Multi-state map:** The player can move between US states and live in any of them, each with real cost of living, taxes, and wages, grouped into LCOL, MCOL, and HCOL tiers.
- **Daily calendar:** The simulation advances one day per tick (Stardew Valley style), with skips to the next day, week, month, or event.
- **Age teleport:** Jump to a future age (for example 24 to 60) from an annual contribution, return rate, and bond allocation; bankruptcy stops the jump and explains why.
- **Goals and milestones:** Skip until a goal (buy a house, move states) is met and see the year and why; at retirement, look back through the milestones.
- **Events slow time:** Big market events (crash, AI bubble pop) and life events (layoff, marriage, divorce with a prenup option, kids) pause for a decision, such as selling out of the market or holding.
- **AI feedback** only at goals, bankruptcy, and big portfolio swings; a newspaper sums up recent days.
- **Stock market:** The core system, designed so its lessons match real market history.

## 2. Why it matters (pitch numbers)

- US financial literacy is at a 10-year low: 47% of questions answered correctly on average, 38% for Gen Z (TIAA-GFLEC P-Fin Index 2026).
- 37% of adults cannot cover a $400 emergency with cash (Federal Reserve SHED, May 2026).
- US credit card debt is $1.26T (NY Fed, Q2 2026).
- Only 22% of 18-29 year olds think their retirement savings are on track.
- Missing the 10 best market days from 2005 to 2024 cut $71,750 to $32,871, and 7 of those days came within two weeks of the worst days (J.P. Morgan).
- Classroom-style financial education barely changes behavior and fades within about 20 months (Fernandes, Lynch & Netemeyer 2014).
  What does work is just-in-time education at the moment of a decision (Kaiser & Menkhoff), which is exactly what a simulation delivers.
- Seeing an aged version of yourself increases saving (Hershfield 2011, plus a field test with about 50,000 people), which the selfie avatar enables.

The gap: existing products are quizzes (Financial Football, Zogo) or single-topic games (Spent, NGPF Payback, the SIFMA Stock Market Game).
None combines a persistent personal life, real state costs, event-driven decisions, "what if" counterfactuals, and a real-life plan at the end.

## 3. Learning design principles

- Every lesson happens at a decision point, then the player sees the consequence, a short reflection, and the counterfactual.
- A "ghost" net-worth line replays the same run with better choices, for example "that panic sale cost future-you $X".
- The aged avatar on the good path looks hopeful, not gloomy, because a doom-inducing future self backfires.
- Every income level can win, and there is always a path to recover.
- Name every crash and give it a recap, so it is a learnable lesson and not random noise.
- Score on long-run outcomes, not short-term trading gains.
- Show a disclaimer that this is education, not financial advice, and use fictional tickers.
- Measure impact: a short pre/post quiz plus a per-decision quality score, tested on 5-10 hackers for real before/after numbers.
- End with a real-life takeaway, a personalized plan based on the player's actual state and choices.

## 4. Avatar and Persona pipeline

- **Persona:** The embedded Web SDK (`npm i persona`) runs selfie liveness plus a selfie-only 18+ age check, and it is free in Sandbox.
  The server should confirm the result through Persona's API rather than trust the browser, then call Redact Inquiry to delete the data.
  Risk: Sandbox may return a sample image instead of the real selfie, so test that in hour 1.
  Until it's confirmed, capture our own photo with `getUserMedia` and use Persona only as the "real human, 18+" check.
- **Avatar generation:** Gemini 3.1 Flash Image gets the selfie plus one sprite from our art pack as a style reference and returns a turnaround sheet on a flat magenta background.
  We slice it, key out the background, and mirror it into 8 directions, at about $0.07 and 10-20 s per player.
  OpenAI gpt-image-2 is the drop-in backup.
- **3D:** Stretch goal only; Meshy, Tripo, or Hunyuan3D take 1-4 min per player.
  If we do it, render the model into 8 sprite frames with three.js; pixi3d is dead and doesn't support PixiJS v8.
- **Ready Player Me is shut down** (Netflix, public API ended 2026-01-31), and Avaturn costs $800/month, so no avatar SDKs.
- **Privacy:** Texas's biometric law (CUBI) requires notice and consent before capture.
  For the demo, show one consent screen with a skip option, keep the selfie in memory only, and store just the cartoon sprite.
- **Fallbacks, in order:** gpt-image-2, then a pick-your-parts avatar (which also covers the NPCs), then pre-made avatars saved in the app for a no-Wi-Fi demo.

## 5. States and cost of living

- All 50 states plus DC can be filled from free public data: BEA Regional Price Parities (via FRED), Census ACS (via Census Reporter, no key needed), Zillow ZORI and ZHVI, BLS OEWS wages by occupation, Tax Foundation brackets, KFF premiums, EIA electricity, and AAA gas.
- Skip MIT Living Wage (licensing limits) and C2ER COLI (paid).
- Precompute one static `states.json` at build time and ship it with the app, so the demo never depends on a live API.
- Taxes come from our own roughly 60-line function covering federal brackets, FICA, and state brackets stored in the JSON.
- Moving between states has three job cases: a local job resets salary to the destination wage after a 2-8 week search, a transfer re-bands pay by the state wage ratio, and a remote job keeps the salary but risks a location pay-cut event.
- Teleporting is not free: about $4,300-4,500 for an interstate move plus first month's rent, a deposit, a lease-break fee, DMV fees, and unpaid days off, all shown on the confirmation screen.
- Teaching moments from the real sample data:
  - On the same $100k remote salary, Ohio leaves about $14,600 a year more than California after taxes and rent.
  - A software developer's 37% raise for moving from Texas to California nearly disappears after costs.
  - A Florida nurse moving to California really does come out about $22,500 a year ahead.
  - Texas has no income tax but a 1.31% property tax rate, versus 0.75% in Florida.
  - A retail worker ends the year in the red in every sample state except Ohio.
- Caveat: state averages hide city costs (NYC rent is about $3,627 against a $1,634 state median), so use Zillow metro rents for the player's move-in rent.

## 6. Stock market and simulation engine

- **Market model:** A hybrid with templated regime switching.
  The market sits in a calm bull phase with fat-tailed weekly moves.
  Bear markets start as named events based on real crashes: Flash Crash (1987), Pandemic Plunge (2020), Housing Crunch (2008), Rate Shock (2022), Stagflation (1973), plus a one-time AI Bubble Pop.
- **Calibration (history since 1928):** about 8.2% a year compounded with 18.5% volatility.
  Bull phases run +0.38% a week (1.94% weekly volatility), bear phases -1.05% a week (4.16%).
  A bear starts with a 0.45% chance each week (about one every 5 years) and lasts about 41 weeks on average.
- **Seeded determinism:** Each source of randomness (market, city, each NPC) is keyed by seed and week, so the player's choices never change the market path.
  That makes rewind exact, and shadow "Held" and "Autopilot" portfolios on the same path give honest "if you had held" comparisons.
- **Time:** The meeting moved to 1 tick = 1 day (the weekly numbers here convert with daily drift = weekly / 5 and daily volatility = weekly / sqrt(5)).
  Normal speed is 1 in-game week every 10 real seconds (about 1.4 s per day, 8.7 min per year), so decades are covered by skipping.
  A detailed newspaper says what happened, where, and what it affects for the player, and becomes a digest after a skip.
  Skips to the next day, week, month, or event, plus the age teleport, run the same seeded engine headless.
  Big events drop to slow motion, then auto-pause for a decision (Paradox-style).
- **Instruments:** Total-market and S&P-style index funds, bonds, cash/HYSA, a few fictional stocks including an "AI hype" stock that can bubble and pop, and target-date funds in the 401(k).
- **Accounts:** Checking, savings, emergency fund, Roth IRA, 401(k) with employer match (average 4.7%), and brokerage.
- **2026 rules:**
  - 401(k) limit $24,500 (catch-up $8,000, or $11,250 at ages 60-63).
  - Roth IRA limit $7,500, phasing out at $153k-$168k income.
  - Long-term capital gains are 0% up to $49,450 and 15% up to $545,500.
  - Early withdrawals carry a 10% penalty.
- **The key link between market and city:** Layoffs get 3x more likely in bear markets, so NPCs without an emergency fund are forced to sell at the bottom.
- **Data:** Don't bundle the S&P 500 series (licensing) or Yahoo (personal-use only).
- The research file also has TypeScript interfaces, a tick function sketch, and a table of 15 events with probabilities and effects.

### Debt and credit (added 2026-09-11, see [06-debt-and-credit.md](06-debt-and-credit.md))

- Model six debts with real 2026 terms: credit card (about 19-25% APR, daily interest, minimum of $25 or 1% plus interest), federal student loan (Standard or the new RAP plan, since SAVE ended July 1, 2026), auto loan (6.9% prime vs 16.11% deep subprime), mortgage (6.76%), BNPL, and payday loans (about 390% APR).
- A simplified credit score (300-850) uses FICO's five factors and weights and sets the APR on every new loan.
- Missed payments walk down a visible ladder (late fee, 30/60/90 days, default, collections, garnishment), with a real recovery option at each step, ending in a Chapter 7 or Chapter 13 bankruptcy choice that also defines when a skip or teleport stops.
- Rates come from the market's cash rate, so the Rate Shock template raises card APRs and the Housing Crunch cuts credit limits.
- The teleport gets a debt strategy input (minimums, snowball, or avalanche plus an extra amount), and "become debt-free" is a goal, which keeps AI feedback to the meeting's three triggers.
- Map hook: each debt is a building that shrinks as it is paid and is demolished at $0; late payments set it on fire.
- Headline lesson: $5,000 at 23.96% takes 19.5 years and $8,871 of interest at the minimum, versus 35 months and $1,995 at $200 a month.
- **Built on Sep 11** (see [07-debt-system-design.md](07-debt-system-design.md)): a deterministic daily engine in `game/src/sim/debt/` shared by live play, skips, and the teleport; the Credit Desk, a markets-terminal view of the same engine, at `game/debt.html`; 16 tests (`npm test`); and pitch-deck diagrams in `diagrams/debt/`.
  The engine's sample household ($44,500 of debt) takes 22.3 years and $22,425 of interest on minimums, versus 4 years and about $7,200 with $300 a month extra; snowball clears its first debt at month 5, avalanche at month 21, for $92 more interest.

### Cards, loans, and moving money (added 2026-09-11, see [08-cards-loans-accounts.md](08-cards-loans-accounts.md))

- Real data, free and keyless: the CFPB's card survey (663 plans with APR by credit tier and every fee), an open dataset of 175 sign-up bonuses, and FRED rates, all loaded into Tiger Data by `game/db/load.py`.
- Applications follow real lender steps: the CARD Act under 21, issuer rules (Chase 5/24, Capital One one per 6 months, Citi 8/65, Amex once-per-lifetime bonuses), debt-to-income, then score-based odds and a seeded roll; prequalification is a soft pull.
- Loans: personal (origination fee withheld), auto and mortgage (45-day rate shopping counts one inquiry), credit union PAL (28% cap), and 401(k) loans.
- Moving money: ACH lands in 2 business days, instant costs 1.75%, cash advances cost 5% and accrue from day one, and early 401(k) withdrawals lose 10% plus tax.
- Lessons from the data: credit unions run about 10 APR points cheaper at every tier, and a 2% card earns $364 a year on average spending while a $3,000 balance at 23% costs $690.

## 7. Tech stack (proposed)

- Vite + TypeScript, PixiJS v8 for the isometric map (the LEGO reference game is itself built on PixiJS), with the DOM/React HUD and modals layered over the canvas.
- A deterministic seeded daily tick engine in TypeScript, running in the browser, run headless for skips and the age teleport.
- Static data: `states.json`, built at build time.
- Persona Web SDK plus a small server to verify inquiries and redact them.
- Gemini 3.1 Flash Image for the avatar, with gpt-image-2 as backup.
- ElevenLabs for the voice onboarding interview, Capital One Nessie as the fake bank API, and an LLM for "what went wrong" recaps (with templated fallback strings).
- Tiger Data (Postgres with TimescaleDB) as the database for weekly NPC finances, market prices, events, and current city data.
- Vultr to host the game and backend, with a GoDaddy Registry domain.
- Backboard for AI memory across sessions, RAG over our research docs, and model routing.

Built so far (2026-09-11 night), all in `game/`:

- The city for every state (PixiJS), with NPCs, weather, traffic, and the states map.
- The player's daily money life (`src/sim/life/`): paychecks, state-scaled rent and living costs, accounts, and the debt engine (`src/sim/debt/`) at the real Fed funds rate; the home tier follows net worth and bankruptcy stops skips.
- Cards, loans, and moving money (`src/sim/money/`), with the real card catalog.
- The phone hub on the city screen (`src/ui/phone.ts`): Stocks is live, and News, Mail, and Bank are next.
- The Credit Desk (`debt.html`), a stock-market terminal in the game's look with the Card Shop, opened from the phone's Stocks app.
- Market data: a year of FRED rates and indexes shipped in `src/data/market.ts`, plus optional live Alpha Vantage quotes.
- 51 tests via `npm test`.

## 8. Hackathon logistics and prizes

- Devpost closes Sunday 9/13 at 9:00 AM, and a 3-4 minute video is mandatory.
- Live judging is Sunday 9:30 AM-12 PM, with 2 minutes of demo plus 1 minute of Q&A, repeated 3-4 times.
- A project can enter only one track, but any number of sponsor challenges.
- **Track decision:** Finance vs. Games & Gamification, which explicitly asks for "gamified learning".
- **Prizes to stack:** Capital One "Best Financial Hack" ($250 in gift cards per member), Persona "Prove You're Human" (surprise prize; "access depends on a verified human", which our verified-adult full mode fits), ElevenLabs (3 months Scale tier), MLH Best Use of ElevenLabs, and MLH Best Use of Gemini.
- Recheck on Saturday: the unposted Goldman Sachs challenge and Discord announcements.
- Setup for every API (keys, env vars, backend, costs) is in [../SETUP.md](../SETUP.md): Gemini image generation is paid only, Tiger Data is a 30-day trial, and Persona Sandbox performs no real verification.
- **MLH sponsor prizes** ([prize page](https://www.mlh.com/events/hackrice-71/prizes)), each with a role in the game:
  - **Gemini API:** avatar creation, the aged "future you" avatar, recaps, and the "Your Real Plan" text.
  - **ElevenLabs:** the game's narrator (mayor, news anchor, life events such as bankruptcy, eviction, and NPC deaths, handled respectfully), plus sound effects and captions.
  - **Tiger Data:** time-series database for weekly NPC finances, market, events, and current city data, powering live charts, the leaderboard, and rewind.
  - **Vultr:** hosts the game and backend ($100 MLH credits), with a GPU or serverless inference as a stretch.
  - **Backboard:** player memory across sessions, RAG over our research, and model routing.
  - **GoDaddy Registry:** a domain for the Vultr server.
  - Solana and Presage are a low fit.

## 9. Open questions for the team

Answered in the 2026-09-11 meeting: the player lives their own life, retirement is the end goal, and time runs daily with skips.

Game design:

1. Do the ~50 NPCs stay as a city backdrop around the player's life?
2. Is the score net worth at retirement, a mix with a wellbeing meter, or how fast goals are reached?
3. How does the event system (gacha/random events) work with the time skips, the age teleport, and goal skips?
4. Is rewind free at any decision point, or limited by "rewind tokens"?
5. Should bear markets visibly change the map (shuttered shops, grey palette, fewer cars)?
6. Is under-18 a hard block or a restricted learning mode?

Simulation:

7. Flat simplified tax rates or real brackets?
8. Crypto as an asset, only as a FOMO event, or not at all?
9. Should demo seeds be curated to guarantee an AI Bubble Pop and one crash by minute 5?
10. Are recaps templated strings, LLM-written, or LLM with a templated fallback?

Avatar and art:

11. Does Persona Sandbox return the real captured selfie? (Test in hour 1.)
12. Can the Persona booth give us production credits or an age-estimation template?
13. Which isometric asset pack sets the art style?
14. Does the avatar walk on the map (8 directions, walk cycles), or only appear on the HUD and profile?
15. Is 3D worth the 1-4 min wait per player during judging?
16. Who owns the Gemini billing key?

Submission:

17. Finance track or Games & Gamification track?
