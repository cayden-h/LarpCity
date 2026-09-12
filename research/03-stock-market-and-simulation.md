# 03 - Stock Market and Simulation Engine

Research for Larp City, HackRice 2026 (Sep 11-13, 2026).
Scope: how the market should move, what players can invest in, which behavioral lessons we target, and how the weekly tick engine, events, speed controls, and replay/rewind should work.
The recommended design is at the end, followed by an event table and open questions.

## TL;DR

- Use a **templated regime-switching model**: a calm "bull" baseline with fat-tailed weekly noise, plus bear markets that start as named, history-inspired events (Flash Crash, Housing Crunch, Pandemic Plunge, Rate Shock, AI Bubble Pop).
- This is option (d) from the brief, and it is the best fit for a game because the director controls when drama happens while the long-run statistics still match real market history.
- Split the seeded RNG into independent streams (market, city events, per-NPC), so a player's choices never change the market path.
- That independence is what makes honest counterfactuals ("if you had held...") and rewind possible.
- Run 1 simulated week per second at normal speed, and auto-pause for big events.
- A 10-minute demo comfortably covers 15-25 simulated years with 6-10 decision pauses.

## 1. Market model options

### Calibration targets from history

Annual figures for 1928-2025 are from [Damodaran's historical returns dataset (NYU Stern)](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html).

| Asset | Arithmetic mean | Geometric mean | Std dev (annual) | Weekly log drift | Weekly vol |
| --- | --- | --- | --- | --- | --- |
| S&P 500 incl. dividends | ~9.8% | ~8.2% | ~18.5% | ln(1.082)/52 = 0.152% | 18.5%/sqrt(52) = 2.57% |
| 10-year Treasury bond | ~5.2% | ~5.0% | ~9.8% | 0.094% | 1.36% |
| 3-month T-bill (cash) | ~3.6% | ~3.4% | ~3.2% | 0.064% | ~0 week to week (the rate drifts slowly) |

Bear and bull market facts from [Hartford Funds, "10 Things You Should Know About Bear Markets"](https://www.hartfordfunds.com/practice-management/client-conversations/managing-volatility/bear-markets.html):

- 27 S&P 500 bear markets since 1928, one every ~3.5 years on average, or one every ~5.1 years since WWII.
- The average bear market lasts 289 days (~41 weeks) and falls ~35%.
- The average bull market lasts 988 days (~141 weeks) and gains ~112%.
- Stocks were rising about 78% of the time.
- About 42% of the S&P 500's best days in the last 20 years happened during a bear market, and another 36% in the first two months of a bull market.

Named crashes, from [History of Market drawdown table](https://historyofmarket.com/sp500/drawdown/), [Morningstar's 150 years of crashes](https://www.morningstar.com/economy/what-weve-learned-150-years-stock-market-crashes), and [the Wall Street Courier drawdown analysis](https://www.wallstreetcourier.com/spotlights/navigating-stock-market-volatility-sp-500-drawdowns-analysis-strategies-1928-2023/):

| Episode | Peak-to-trough | Time falling | Time to recover prior peak | Game template name |
| --- | --- | --- | --- | --- |
| 1929-32 Great Depression | -82% (price) | ~996 days | 20+ years nominal (much less with dividends reinvested) | "The Great Bust" (rare, optional) |
| 1973-74 oil shock / stagflation | ~-48% to -52% | ~21 months | ~7 years nominal | "Stagflation Squeeze" |
| 1987 Black Monday | ~-34% (-20.5% in one day) | ~54 days to bottom | ~2 years | "Flash Crash" |
| 2000-02 dot-com | -49% | ~685 days | price back to 2000 peak in 2007, above for good in 2013 | "Dot-Bomb" (inspires the AI Bubble Pop) |
| 2007-09 financial crisis | ~-57% (close to close, Oct 2007 - Mar 2009) | ~17 months | ~4 years (2013) | "Housing Crunch" |
| 2020 COVID | -34% | 32 days | ~5 months | "Pandemic Plunge" |
| 2022 inflation / rate hikes | -25% | ~9 months | ~2 years | "Rate Shock" (bonds fall too) |

Note: one source lists 2008 at -48% over 407 days, which uses a different peak date. The common close-to-close figure is about -57%.
For the game the exact number does not matter; the template ranges below cover both.

Crypto reference for an optional "LarpCoin": Bitcoin drawdowns of -93% (2011), -86% (2015), -84% (2018), and -77% (2022, $69k to $15.5k), each followed by a new high ([bit.com cycle history](https://www.bit.com/knowledge-hub/bitcoin-cycles), [Bitcoin.com price history](https://www.bitcoin.com/get-started/bitcoin/basics/bitcoin-price-history/)).

### (a) Historical replay of real weekly returns

Pros:
- Maximum credibility: "this literally happened."
- Hiding the start year and revealing it at the end ("You just lived through 1998-2018") is a great teaching moment.
- Counterfactuals are trivially honest.
- Almost no modeling work: load JSON, index by week.

Cons:
- Players who recognize the pattern (2008, 2020) can game it.
- We cannot schedule drama around the demo; a random window may have no crash, or three.
- No "AI Bubble Pop" unless we overlay fictional assets.
- Licensing: S&P index data is restricted (see Section 2).
- Only about 100 years of data, so the number of distinct 20-year windows is small.

24h build cost: low (one Python script plus a loader).

### (b) Block bootstrap of historical weeks

This means resampling real 4-13 week blocks so volatility clustering and fat tails survive.

Pros:
- Realistic statistics, and every run is new.
- Players cannot memorize it.

Cons:
- Still needs the data file, so the licensing questions are the same as (a).
- It cannot produce coherent multi-month narratives: a crash block can be followed by a random boom block, which feels arbitrary and cannot be named or explained.
- It is harder to tie to layoffs and other city events.

24h build cost: low to medium.

### (c) Pure stochastic models

- **GBM (geometric Brownian motion):** trivial to code, but normal returns badly understate tails. Under Gaussian assumptions the 1987 one-day crash was a ~20-sigma event and 2008 a ~5-sigma event ([Monte Carlo pitfalls, Kitces and others](https://www.kitces.com/blog/monte-carlo-analysis-risk-fat-tails-vs-safe-withdrawal-rates-rolling-historical-returns/), [Quant Decoded](https://quantdecoded.com/en/when-monte-carlo-fails-retirement-planning-pitfalls)). Crashes would basically never happen, which kills the game.
- **Jump diffusion (Merton):** GBM plus Poisson jumps. It gives flash crashes but not slow grinding bear markets.
- **Regime-switching (Hamilton-style bull/bear Markov chain):** the literature shows a two-state model sorts returns into a "high-return stable" bull state and a "low-return volatile" bear state, and identifies every major downturn in 160 years of monthly data ([Maheu and McCurdy 2000, JBES](https://consensus.app/papers/details/471f8a5d94695a96a1ae20a21bc6e602/?utm_source=claude_desktop)). They also find volatility rises the longer a bear market lasts and the best gains cluster at the start of a bull, which matches the "best days" lesson. A semi-Markov version where regime end probability rises with age reproduces momentum and mean reversion ([Giner et al. 2023](https://consensus.app/papers/details/3fc368d62a1d5a19a8d3c64b8da5ece8/?utm_source=claude_desktop)). Caveat: regime models describe history well but do not reliably predict it ([Kirby 2022](https://consensus.app/papers/details/6cad83591550550cbb7a6c146ef39b16/?utm_source=claude_desktop)), which is fine for a game and is itself a lesson (you cannot time it).
- **GARCH:** volatility clustering. It is realistic but opaque, and a two-regime model already gives most of the clustering.

Pros: no data files, infinite runs, tunable.
Cons: pure randomness gives no narrative, and the AI bubble cannot be scripted.

### (d) Hybrid: stochastic baseline plus scripted shocks (recommended)

- A bull-regime baseline with fat-tailed weekly noise.
- Bear markets are not a hidden coin flip; they start as **named templates** chosen by an event director with a calibrated hazard rate.
- Each template defines depth, fall duration, and recovery shape, drawn from a range based on the history table.
- Fictional stocks (the AI stock) have their own scripted boom-bust arc layered on top of the market beta.

Why this wins for us:
- Every crash gets a name, a news headline, a decision prompt, and a "what happened" explanation.
- Long-run averages still match history, so the lessons are honest.
- We can guarantee at least one crash in a demo seed and pick seeds for a good pitch.
- Bear markets can raise NPC layoff odds, which connects the stock market to the city.

### Calibrated parameters for the recommended model

Weekly log return: `r = mu[regime] + sigma[regime] * z`, where `z` is Student-t with 4 degrees of freedom scaled to unit variance (`z = t4 * sqrt(2/4)`) to give fat tails.

| Parameter | Bull | Bear (generic) |
| --- | --- | --- |
| Weekly log drift `mu` | +0.38% (~ +22%/yr) | -1.05% (so ~41 weeks gives ~-35%) |
| Weekly vol `sigma` | 1.94% (~14%/yr) | 4.16% (~30%/yr) |
| Mean duration | ~224 weeks (post-WWII: one bear every ~5.1 yrs) | ~41 weeks |
| Weekly exit probability | 1/224 = 0.0045 (bear start hazard) | template-driven, ~1/41 = 0.024 if generic |

Check (my derivation from the numbers above):
- Stationary share of time in bull = 0.024 / (0.024 + 0.0045) = ~84%.
- Blended weekly log drift = 0.84 x 0.38% + 0.16 x (-1.05%) = ~0.151%/week, or ~7.9%/yr log, which is ~8.2% geometric. This matches Damodaran.
- Blended vol, including the gap between the two regimes' means, is ~2.5%/week, or ~18%/yr. This matches the 18.5% historical figure.
- Bull drift over 141 weeks is exp(0.0038 x 141) = +71%. The historical average bull gained 112%, but the post-war bulls in our model last longer (224 weeks gives about +134%). That is close enough.

Other assets (weekly):
- **Bonds** (aggregate / 10y): drift 0.09%, vol 1.0-1.4%. Correlation with stocks is -0.2 in "Flash Crash", "Housing Crunch", and "Pandemic Plunge" (flight to safety), but +0.5 and drift -0.25%/week in "Rate Shock", so bonds fall with stocks as in 2022. Teach that bonds are not a guaranteed shelter.
- **Cash / HYSA:** pays `cashRate / 52`, with `cashRate` starting ~4% and moving slowly (falls during crash templates, rises in Rate Shock).
- **Inflation:** 3%/yr baseline (roughly the long-run average of the T-bill-like numbers above), 7-8% during Rate Shock and Stagflation. It drives rent and price increases.

## 2. Free data sources for weekly historical data

| Source | What | Weekly? | Range | Licensing / bundling | Verdict |
| --- | --- | --- | --- | --- | --- |
| [Kenneth French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html) | "Fama/French 3 Factors [Weekly]": Mkt-RF (US total market excess return incl. dividends) plus RF (T-bill) | Yes, CSV | 1926 to present (updated through July 2026) | Free download; page states "Copyright Eugene F. Fama and Kenneth R. French" with no explicit license. Universally used in teaching and research; a non-commercial hackathon bundle with attribution is standard practice, but it is not an open license. | **Best choice** for real historical returns. Total market return = Mkt-RF + RF. |
| [Robert Shiller online data](http://www.econ.yale.edu/~shiller/data.htm) (`ie_data.xls`) | S&P composite price, dividends, earnings, CPI, 10y rate | Monthly only | 1871 to present | Free, widely mirrored (e.g. [Tidy Finance total return reconstruction](https://www.tidy-finance.org/blog/historical-sp-500-total-return/)) | Good for monthly real returns and CPI; would need interpolating to weekly. |
| [FRED](https://fred.stlouisfed.org/series/SP500) | SP500 price | Daily | **Only 10 years**, "Reproduction of S&P 500 in any form is prohibited except with the prior written permission of S&P Dow Jones Indices" | Do **not** bundle SP500. | Use FRED for government series instead: `DGS10` (10y yield), `TB3MS` (3-month bill), `CPIAUCSL` (CPI), `UNRATE`. |
| [Stooq](https://www.quantstart.com/articles/an-introduction-to-stooq-pricing-data/) | `^SPX` price index | Yes, CSV | Back to 1789 (early years reconstructed) | No clear published redistribution terms found | Fine as a cross-check; price-only, so dividends are missing. |
| [Yahoo Finance](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html) / yfinance | Any ticker | Yes | ~1927 for ^GSPC | Personal, non-commercial use only; no redistribution | Avoid for anything we ship. |
| [Alpha Vantage](https://www.alphavantage.co/documentation/) | `TIME_SERIES_WEEKLY_ADJUSTED` for ETFs like SPY/AGG | Yes | 25+ years | Free tier 25 requests/day, 5/min ([Macroption](https://www.macroption.com/alpha-vantage-api-limits/)); redistribution not granted; free unlimited for verified educational/open-source projects per their support page | Handy for a one-off fetch of SPY/AGG/BND history; do not call live at runtime. |
| Nasdaq Data Link (ex-Quandl) | Mixed | Varies | Varies | Not investigated in depth; most useful datasets are premium | Skip for a 24h build. |

For bond returns, use the approximation `r_bond ~ y/52 - D * dy` with duration `D ~ 8` for a 10-year Treasury.
Credit the sources in the About screen.

## 3. Instruments and account rules

### What to offer

Keep the menu short so choices are meaningful.

| Instrument | In-game name idea | Model | Expense ratio | Lesson |
| --- | --- | --- | --- | --- |
| Total US market index fund | "Larp Total Market (LTM)" | Market regime path | 0.03% | Default good choice |
| S&P 500 index fund | "Sprawl 500" | Market path (beta 1.0, tiny tracking noise) | 0.05% ([Vanguard 500 Admiral is 0.05%](https://www.richmondsavers.com/vanguard-funds-and-the-impact-of-fees-on-your-investment/)) | Same as above |
| Actively managed "star" fund | "Gold Star Growth Fund" | Market path minus 1%/yr fee plus random manager noise | 1.00% | Fees compound; stars fade |
| Bond index fund | "City Bond Fund" | Bond model | 0.04% | Lower volatility, not risk-free (Rate Shock) |
| Cash / HYSA | "Savings" / "Emergency Fund" | cashRate/52 | 0 | Liquidity, the emergency-fund lesson |
| Target-date fund (401k default) | "Retire 2065 Fund" | Glide path: 90/10 stocks/bonds at 40+ years out, down to ~50/50 at retirement | 0.08% | Autopilot works |
| Fictional AI stock | "NeuralNest (NNST)" | Beta 1.8 plus 60%/yr idiosyncratic vol plus scripted bubble arc | n/a | Concentration and hype risk |
| Fictional boring stock | "Larp Water & Power (LWP)" | Beta 0.5, 18% vol | n/a | Not all stocks are rockets |
| Optional crypto | "LarpCoin" | 75%/yr vol, 4-year boom/bust arcs with -75% to -90% drawdowns | n/a | Speculation vs investing; keep it tiny or cut it |

Recommendation on crypto: include it only as an event-triggered FOMO temptation ("Your cousin says LarpCoin is going to the moon") rather than a permanent menu item.
It is a good lesson but adds modeling and UI surface.

### Account rules (2026 figures)

- **401(k):** employee limit $24,500; catch-up $8,000 for age 50+; "super catch-up" $11,250 for ages 60-63 ([IRS 2026 limits](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500)). From 2026, high earners (over $150k prior-year wages) must make catch-ups as Roth ([Fidelity](https://www.fidelity.com/learning-center/personal-finance/401k-catch-up-contributions-high-earners)).
- **Employer match:** the average employer match was a record 4.7% of pay; 86% participation; 64% of contributions went to target-date funds; average savings rate 12.1% ([Vanguard How America Saves via Yahoo Finance](https://finance.yahoo.com/news/new-vanguard-report-americans-are-saving-for-retirement-at-record-levels-143530445.html), [Vanguard How America Saves 2026](https://workplace.vanguard.com/insights-and-research/report/how-america-saves-2026.html)). In game, use a common formula like "100% match on the first 4% of pay" or "50% of the first 6%" and make "not contributing enough to get the full match" a visible mistake ("You left $2,100 of free money on the table this year").
- **Roth IRA:** $7,500 limit for 2026, plus $1,100 catch-up at 50+ ([IRS](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500)). Income phase-out for single filers is $153,000-$168,000 MAGI ([Vanguard](https://investor.vanguard.com/investor-resources-education/iras/roth-ira-income-limits)). Contributions (not earnings) can be withdrawn any time tax and penalty free; early earnings withdrawals face tax plus 10% ([IRS Topic 557](https://www.irs.gov/taxtopics/tc557), [IRS IRA distribution FAQ](https://www.irs.gov/retirement-plans/retirement-plans-faqs-regarding-iras-distributions-withdrawals)).
- **Early 401(k) withdrawal:** ordinary income tax plus a 10% additional tax before 59 1/2, with fewer exceptions than IRAs ([IRS early distribution exceptions](https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-exceptions-to-tax-on-early-distributions)). In game, raiding the 401(k) during a layoff should visibly cost "~30-40% of the withdrawal" (10% penalty plus ~22% bracket plus state tax); this is a simplified rule of thumb.
- **Capital gains (brokerage):** 2026 long-term rates for single filers are 0% up to $49,450 of taxable income, 15% to $545,500, and 20% above ([CNBC](https://www.cnbc.com/2025/10/09/capital-gains-tax-2026-federal.html)). Short-term gains (held under 1 year) are taxed as ordinary income. Simplification for the game: apply 15% to long-term gains and 22% to short-term gains when the player sells, charged at the April "tax season" tick. This makes panic-selling after a run-up doubly painful.
- **Dividends:** fold them into total return (the Fama/French and Damodaran numbers already include dividends) rather than simulating payouts. Show a small "dividends reinvested" line for flavor.
- **Fees:** expense ratio deducted weekly as `ER / 52`. A 1% fee vs 0.03% on $10k over 30 years at 10.5% gross is ~$171k vs ~$228k ([fee-drag example](https://financemindshift.com/tools/fee-drag/)), and a 1% fee takes ~25% of a 30-year balance ([AEI analysis](https://www.aei.org/carpe-diem/the-long-run-effect-of-fees-and-expenses-on-stock-market-investing/)).

## 4. Behavioral finance lessons and the mechanics that expose them

| Lesson | Evidence | Mechanic |
| --- | --- | --- |
| Panic selling and missing the best days | Missing the 10 best days over 20 years cut annualized return almost in half: $10k in 2005 grows to $71,750 by 2024 fully invested vs $32,871 missing the 10 best days; missing the best 40 days makes returns negative. 7 of the 10 best days came within 2 weeks of the 10 worst ([J.P. Morgan 2025 Guide to Retirement via StockTitan](https://www.stocktitan.net/news/JPM/j-p-morgan-asset-management-releases-2025-guide-to-q3yprthaeem2.html), [CNBC](https://www.cnbc.com/2025/04/07/selling-out-during-the-markets-worst-days-can-hurt-you-research.html)). | The crash auto-pauses with a Sell all / Sell half / Hold / Buy more modal. The model places the biggest up-weeks right after crash lows (template recovery phase), so sellers miss them. The post-crash recap shows "Best 5 weeks of this cycle: you were in cash for 4 of them." |
| Behavior gap (time in market vs timing) | Morningstar's 2025 Mind the Gap: funds returned 8.2%/yr over 2015-2024 but investors earned 7.0%, a 1.2-point gap, about 15% of returns ([Morningstar](https://www.morningstar.com/business/insights/research/mind-the-gap)). Counterpoint: a 2026 Financial Analysts Journal paper argues the methodology overstates the timing cost ([Fulkerson et al.](https://rpc.cfainstitute.org/research/financial-analysts-journal/2026/bad-timing-does-not-cost-investors-funds-returns)). | Show a persistent "You vs Autopilot" gap on the portfolio screen. Present it as an illustration, not a precise statistic. |
| Dollar-cost averaging / automation | Morningstar recommends automating to narrow the gap; target-date defaults drive 64% of 401(k) contributions (Vanguard, above). | An "Autopilot" toggle on each account: fixed % of paycheck every tick. Autopilot NPCs are the control group. |
| Diversification vs single-stock concentration | Dot-com: the index fell 49%, but many individual tech stocks went to zero. | NNST (AI stock) runs +300% then -80% in the AI Bubble Pop. A "concentration meter" warns when one stock is over 20% of the portfolio. |
| Fees compound | AEI and fee-drag numbers above. | Gold Star fund vs index fund side-by-side on the end screen: "Fees cost you $X, enough for Y years of rent." |
| Emergency fund prevents forced selling | 63% of adults would cover a $400 emergency with cash or equivalent, so 37% could not ([Fed SHED 2025 report](https://www.federalreserve.gov/publications/2025-economic-well-being-of-us-households-in-2024-savings-and-investments.htm)). | Layoffs are more likely during bear templates. Without an emergency fund, the NPC must sell stocks at the bottom or raid the 401(k) (penalty). This is the single strongest cross-system lesson: the crash hurts twice. |
| Lifestyle inflation | Design lesson | Every raise triggers a "treat yourself" prompt (bigger apartment, new car) that permanently raises weekly expenses. The house sprite upgrades (visible reward), but the savings rate drops (visible cost). |
| Sequence of returns / time horizon | [Monte Carlo explainer on sequence risk](https://retirement-lab.com/learn/blog/what-is-a-monte-carlo-retirement-calculator/) | Older NPCs near retirement feel crashes more. Target-date glide path shows why they hold more bonds. |
| FOMO / hot tips | [SIFMA game critique](https://www.advisorperspectives.com/articles/2018/06/25/the-real-losers-in-the-stock-market-game) | "Your coworker tripled his money on NNST" prompt shows up near the bubble peak. |

### Showing counterfactuals ("if you had held...")

- Maintain **shadow portfolios** that tick alongside the real one at almost no cost:
  1. **Actual** (the player's choices).
  2. **Held** (same contributions, never sold).
  3. **Autopilot** (target-date fund plus full 401(k) match plus 3-month emergency fund).
- Shadow portfolios reuse the same market returns each tick, so the comparison is exact and honest.
- This only works if the market RNG stream is independent of player decisions (Section 5).
- On each decision modal and at the end, show a three-line chart: "You", "If you had held", "Autopilot".
- Rewind builds on this: jump back to the decision snapshot, pick the other option, and watch the new line diverge on the same market path.
- Also consider "ghost NPCs": the 50 citizens have personality archetypes (Panicky Pete sells every crash, Steady Sally holds, YOLO Yuri buys NNST). Because the city shares one market, the city itself becomes a living counterfactual.

## 5. Simulation engine design

### Tick loop and speed

Decouple simulation from rendering with a fixed-step accumulator driven by the Pixi ticker:

```ts
const SPEEDS = [0, 2.0, 1.0, 0.5, 0.25]; // seconds of real time per simulated week; 0 = paused
let acc = 0;
app.ticker.add(() => {
  if (state.speed === 0 || state.pendingDecision) return;
  acc += app.ticker.deltaMS / 1000;
  const secPerWeek = SPEEDS[state.speed];
  while (acc >= secPerWeek && !state.pendingDecision) {
    acc -= secPerWeek;
    state = tick(state);          // pure-ish, deterministic
    emitVisualEvents(state);      // sprites, toasts, headlines
  }
});
```

- Speed 1 (2 s/week): 104 s per year. Use for tutorials and tense moments.
- Speed 2 (1 s/week): 52 s per year. Default.
- Speed 3 (0.5 s/week): 26 s per year.
- Speed 4 (0.25 s/week): 13 s per year, for fast-forwarding calm bull runs.
- 10-minute demo budget: ~2 min onboarding plus ~6 decision pauses at ~25 s each leaves ~5.5 min of running time. At speed 3 that is ~12-13 years; mixing speeds 3 and 4 fits 20-25 years. For the pitch, one 20-year career from age 25 to 45 with 3 crashes is the sweet spot.
- **Dramatic slow-down:** when a crash template starts, the engine forces speed down to 1 for ~4 weeks (the "slow motion" drop), then auto-pauses at the decision point. Paradox games pause on events: Crusader Kings pauses single-player events until the player picks an option, and EU4 has a "pause on events" setting ([EU4 wiki settings](https://eu4.paradoxwikis.com/Settings), [Paradox forum](https://forum.paradoxplaza.com/forum/threads/is-there-a-option-for-pause-not-pause-on-event-like-eu4.1077762/)). EU5 players complain about auto-unpausing after accepting a message at high speed ([Steam discussion](https://steamcommunity.com/app/3450310/discussions/0/684112501454980418/)), so after a decision we should resume at the previous speed only if the player chooses it. Default to speed 2.
- Event severity tiers: **minor** (toast only, never pauses), **notable** (slows to speed 1 for 2 weeks, badge on HUD like LEGO's fire/police alerts), **major** (auto-pause plus modal).

### Deterministic seeded RNG

- Use a small fast PRNG (mulberry32 or sfc32), and derive **independent streams** with a hash (e.g. `hash32(seed, "market", week)`):
  - `market`: regime starts, template picks, weekly returns. Depends only on `(seed, week)`, never on player state.
  - `city`: macro events such as the Roth deadline reminder or city-wide news.
  - `npc:<id>`: layoffs, medical bills, car breakdowns. Probabilities can depend on market regime (which is decision-independent), but draws are keyed by `(seed, npcId, week, eventId)`.
- Because draws are keyed, not sequential, a different player choice can never shift later random draws. This avoids the classic "butterfly" bug where selling a stock changes whether the car breaks down.
- Precompute the whole market path at game start: `MarketPath = WeeklyReturns[weeks]`. This is cheap (1,040 weeks for 20 years) and makes charts, shadow portfolios, and rewind trivial.
- Rewind: store `{ seed, decisions: Decision[] }`, plus snapshots every 13 weeks for fast seeking. To rewind, restore the nearest snapshot at or before the target week and re-simulate forward with the decision log truncated or modified.

### Event system

- Event definitions are data (JSON/TS objects) with: `id`, `scope` (market / city / npc), `trigger` (`scheduled` by calendar week, `random` with `weeklyProb`, or `conditional` on a predicate), `cooldownWeeks`, `maxOccurrences` (1 for AI Bubble Pop), `requires` (e.g. NNST up over 200%), `probMultiplier` by regime (layoffs x3 in bear), `severity`, `effects`, and optional `decision`.
- Annual to weekly conversion: `weeklyProb = 1 - (1 - annualProb) ** (1/52)`.
- Scheduled events: paycheck (every tick or biweekly), rent (every 4 weeks), annual raise review, lease renewal, April tax season, Roth deadline.
- A **director** layer adjusts pacing without breaking honesty. For example: guarantee at least one bear template in the first 12 simulated years of a demo seed, and never start two major events within 8 weeks. The director only picks seeds and schedules templates within their calibrated ranges.

### Core TypeScript interfaces

```ts
type Week = number; // 0 = start date; calendar derived via startDate + week * 7 days

type AccountKind = "checking" | "savings" | "emergency" | "roth_ira" | "k401" | "brokerage";
type InstrumentId = "LTM" | "SPRAWL500" | "GOLDSTAR" | "BOND" | "CASH" | "TDF2065" | "NNST" | "LWP" | "LARPCOIN";
type Regime = "bull" | "bear" | "recovery";

interface Instrument {
  id: InstrumentId;
  name: string;
  expenseRatio: number;          // annual, e.g. 0.0003
  beta: number;                  // vs market
  idioVolWeekly: number;         // idiosyncratic weekly vol
  kind: "fund" | "stock" | "cash" | "crypto";
}

interface Holding {
  instrumentId: InstrumentId;
  units: number;
  costBasis: number;             // total dollars paid, for capital gains
  acquiredWeek: Week;            // simplified single lot, or use lots[] for FIFO
}

interface Account {
  kind: AccountKind;
  cash: number;                  // uninvested cash in this account
  holdings: Holding[];
  ytdContributions: number;      // for IRS limits
  autopilot?: { pctOfPaycheck: number; target: InstrumentId };
}

interface Player {                // also used for every NPC
  id: string;
  name: string;
  age: number;
  archetype: "steady" | "panicky" | "yolo" | "spender" | "player";
  job: { title: string; salaryAnnual: number; employed: boolean; matchPct: number; matchCapPct: number };
  expensesWeekly: number;
  accounts: Record<AccountKind, Account>;
  debts: { kind: "credit_card" | "student" | "car"; balance: number; aprAnnual: number }[];
  status: "ok" | "stressed" | "broke" | "homeless";
  history: LedgerEntry[];        // feeds the LLM "what went wrong" post-mortem
}

interface MarketState {
  week: Week;
  regime: Regime;
  activeTemplate?: { id: string; startWeek: Week; depth: number; fallWeeks: number; recoverWeeks: number };
  prices: Record<InstrumentId, number>;
  cashRateAnnual: number;
  inflationAnnual: number;
  headline?: string;
}

interface MarketPath {            // precomputed from seed at game start
  seed: number;
  weeks: MarketState[];
}

interface EventDef {
  id: string;
  scope: "market" | "city" | "npc";
  trigger:
    | { type: "scheduled"; everyWeeks?: number; atWeekOfYear?: number }
    | { type: "random"; weeklyProb: number }
    | { type: "conditional"; when: (s: GameState, npc?: Player) => boolean; weeklyProb: number };
  regimeMultiplier?: Partial<Record<Regime, number>>;
  cooldownWeeks?: number;
  maxOccurrences?: number;       // 1 = one-off (AI Bubble Pop)
  severity: "minor" | "notable" | "major";
  apply: (s: GameState, npc?: Player) => GameState;
  decision?: DecisionDef;
}

interface DecisionDef {
  prompt: string;
  options: { id: string; label: string; apply: (s: GameState, npc?: Player) => GameState; lesson?: string }[];
  defaultOptionId: string;       // used by NPC archetypes and if the timer expires
}

interface Decision {              // recorded for replay/rewind
  week: Week;
  eventId: string;
  npcId?: string;
  optionId: string;
}

interface PendingDecision { eventId: string; npcId?: string; week: Week }

interface GameState {
  seed: number;
  week: Week;
  speed: 0 | 1 | 2 | 3 | 4;
  market: MarketPath;
  npcs: Player[];
  shadows: Record<"held" | "autopilot", Player>; // counterfactual twins of the focused player
  eventCounts: Record<string, number>;
  lastFired: Record<string, Week>;
  pendingDecision?: PendingDecision;
  decisions: Decision[];
  log: LedgerEntry[];
}

interface LedgerEntry { week: Week; npcId?: string; kind: string; amount?: number; note: string }
```

### The tick function

```ts
function tick(s: GameState): GameState {
  const w = s.week + 1;
  const m = s.market.weeks[w];                 // precomputed, decision-independent
  let next = { ...s, week: w };

  for (const npc of next.npcs) {
    payday(npc, w);                            // salary to checking, 401k deferral + employer match
    payBills(npc, w, m.inflationAnnual);       // rent, food, debt minimums; shortfall -> savings -> emergency -> sell brokerage -> 401k (penalty)
    runAutopilot(npc);                         // DCA contributions within IRS limits
    applyReturns(npc, s.market.weeks[w - 1], m); // price change minus expenseRatio/52; cash earns cashRate/52
    updateStatus(npc);                         // ok / stressed / broke / homeless
  }
  updateShadows(next, m);                      // held + autopilot twins, same returns

  for (const ev of EVENTS) {
    for (const target of targetsFor(ev, next)) {
      if (!eligible(ev, next, target)) continue;      // cooldown, maxOccurrences, requires
      const p = effectiveProb(ev, m.regime, target);
      if (rand(next.seed, ev.id, target?.id ?? "city", w) < p) {
        next = ev.apply(next, target);
        if (ev.decision) {
          if (target?.archetype === "player" || ev.scope === "market") {
            next.pendingDecision = { eventId: ev.id, npcId: target?.id, week: w };
            next.speed = 0;                  // auto-pause on major events
          } else {
            next = autoDecide(next, ev, target!); // NPC archetypes decide for themselves
          }
        }
      }
    }
  }
  if (w % 13 === 0) saveSnapshot(next);
  return next;
}
```

## 6. Existing products to learn from

| Product | What it does well | What it does badly | Takeaway for Larp City |
| --- | --- | --- | --- |
| [SIFMA Stock Market Game](https://www.stockmarketgame.org/tour/index.html) | Real prices, classroom adoption, team competition | Short competition windows reward concentrated, high-volatility bets; critics say it teaches that success means picking the one hot stock ([Advisor Perspectives](https://www.advisorperspectives.com/articles/2018/06/25/the-real-losers-in-the-stock-market-game), [Finance Revamp](https://www.financerevamp.com/post/the-pedagogical-casino-why-the-stock-market-game-is-a-gateway-to-disordered-gambling)) | Score on long-run outcomes (net worth at 45, NPCs kept housed), never short-run returns. Compressed time means decades, not weeks. |
| Investopedia Stock Simulator | Real tickers, realistic order types | Same leaderboard and speculation problem; no life context such as bills or jobs | Tie investing to a life with rent, layoffs, and emergencies. |
| [BitLife stock market](https://www.gameskinny.com/tips/bitlife-how-to-use-the-stock-market/) | Fun, fast, news headlines, insider-trading gag | Paywalled ($4.99 pack); opaque RNG where low-risk choices can still lose everything, so no lesson can be learned | Make the model explainable: every crash has a name, a cause, and a recap. |
| [NGPF Payback](https://www.ngpf.org/blog/paying-for-college/ngpf-launches-payback/) | Multiple meters (debt, happiness, academics) force real trade-offs | Short and linear | Track a "wellbeing" meter alongside net worth so hoarding is not the only win. Note: "Payback 2" is an unrelated crime action game ([Wikipedia](https://en.wikipedia.org/wiki/Payback_2)); the team likely means NGPF's Payback. |
| [Spent](https://en.wikipedia.org/wiki/Spent_(video_game)) | Emotional, choices between two bad options, 1M+ plays ([PR Newswire](https://www.prnewswire.com/news-releases/spent-the-online-game-about-surviving-poverty-and-homelessness-reaches-its-millionth-play-and-invites-congress-to-accept-the-challenge-128781258.html)) | Single month, no investing | Borrow the dilemma writing style for decision prompts. |
| Wealthfront / robo-advisor projections | Fan charts showing a range of outcomes, autopilot defaults | Abstract; users never feel a crash | Show a fan chart during onboarding, then make them live through one path of it. |
| Monte Carlo retirement calculators | Many sequences show sequence-of-returns risk | Often assume normal, independent returns and understate tails and clustering ([Quant Decoded](https://quantdecoded.com/en/when-monte-carlo-fails-retirement-planning-pitfalls)); though for long horizons the normal assumption may overstate extreme drawdowns vs history ([Kitces](https://www.kitces.com/blog/monte-carlo-analysis-risk-fat-tails-vs-safe-withdrawal-rates-rolling-historical-returns/)) | Our fat-tailed regime model is a better teaching tool. An end-screen "run 500 more lives with your strategy" fan chart is a cheap, impressive stretch. |

## RECOMMENDED DESIGN

1. **Market:** templated regime switching, fully precomputed from a seed at game start (1,040+ weeks). Bull: +0.38%/wk drift, 1.94%/wk vol, Student-t(4) noise. Bear templates below. Bonds, cash, and inflation respond to the template type. Fictional stocks use `beta * market + idiosyncratic + scripted arc`.
2. **Time:** 1 tick = 1 week. Speeds: pause, 2 s, 1 s, 0.5 s, 0.25 s per week. Major events drop to slow-motion and auto-pause with a modal. The player chooses the resume speed.
3. **RNG:** keyed hash streams (`market`, `city`, `npc:<id>`), so decisions never alter randomness. Decision log plus quarterly snapshots give rewind.
4. **Counterfactuals:** "Held" and "Autopilot" shadow twins tick on the same market path. A three-line chart on every crash recap and on the end screen.
5. **Accounts:** checking, savings/HYSA, emergency fund, Roth IRA ($7,500), 401(k) ($24,500 plus employer match), brokerage. Shortfall waterfall: checking, savings, emergency fund, sell brokerage (capital gains tax), 401(k) (10% penalty plus tax), credit card (high APR), then broke/homeless.
6. **NPC archetypes** decide their own crash responses, so the city demonstrates the lessons even when the player is watching.
7. **Scoring:** net worth at the end age plus citizens kept housed plus a wellbeing meter, never short-term return.
8. **Persistence (Tiger Data, MLH prize):** stream each tick into Tiger Data's Postgres (TimescaleDB) hypertables: `npc_weekly` (accounts and net worth per NPC per week), `market_weekly` (prices and regime), `events`, and `city_weekly` (housed citizens, unemployment, season). Continuous aggregates feed the leaderboard and yearly summaries, and any past week is one query away for rewind and live charts. The browser engine stays the source of truth; the database records the run.

### Bear templates (market director)

A bear starts with weekly hazard 0.0045 in bull (about one every 5 years), picked by weight:

| Template | Weight | Depth | Fall | Recovery to prior peak | Side effects |
| --- | --- | --- | --- | --- | --- |
| Flash Crash (1987) | 15% | -25% to -35% (half in week 1) | 2-8 weeks | 80-110 weeks | Bonds +2%, headline panic |
| Pandemic Plunge (2020) | 15% | -30% to -35% | 4-6 weeks | 20-30 weeks (V-shape, biggest up-weeks right after the low) | Layoff prob x4 for 12 weeks, cash rate drops to ~0.5% |
| Housing Crunch (2008) | 20% | -45% to -57% | 60-75 weeks | 180-220 weeks | Layoff prob x3, home values -20%, credit tightens |
| Rate Shock (2022) | 25% | -20% to -27% | 35-45 weeks | 80-110 weeks | Bonds fall -12% to -15%, inflation 7-8%, cash rate rises to ~5% |
| Stagflation Squeeze (1973) | 10% | -40% to -50% | 80-95 weeks | 250-350 weeks | Inflation 9-11%, rent hikes x2 |
| Generic correction | 15% | -10% to -19% | 6-20 weeks | 15-40 weeks | Notable, not major; no auto-pause |

The template's weekly drift in the fall phase is `ln(1 - depth) / fallWeeks` plus bear-level noise.
The recovery phase drift is set so the path reaches the old peak around the recovery target, with noise.

### 15 concrete events

Weekly probabilities are derived from annual rates (`1 - (1-p)^(1/52)`).
Annual rates for personal events are design choices tuned for drama, not statistics.

| # | Event | Scope | Trigger / probability | Effect | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | Bear market begins (template) | market | 0.45%/wk in bull, cooldown 26 wks after recovery | See templates | Major: Sell all / Sell half / Hold / Buy more |
| 2 | Market correction | market | Via template weight (~1 per 5-7 yrs in the model) | -10% to -19% | Notable toast: "Stay the course?" |
| 3 | AI Boom begins (NNST hype) | market, one-off | Scheduled week 60-200 | NNST drift +2%/wk for 60-120 wks; headlines | Notable: "Buy NNST?" |
| 4 | AI Bubble Pop | market, one-off (`maxOccurrences: 1`) | Requires NNST over +200% since boom; then 1.5%/wk | NNST -70% to -85% over 30 wks; market -20% to -30% (Dot-Bomb template) | Major: Sell / Hold / Buy the dip |
| 5 | Layoff | npc | 4%/yr (0.078%/wk), x3 during bear | Income 0 for 8-26 wks; unemployment benefit ~40% of pay | Major for player: use emergency fund / sell stocks / 401(k) withdrawal / credit card |
| 6 | Medical bill | npc | 10%/yr, $400-$5,000 (skewed low) | Expense | Notable: pay from emergency fund / credit card |
| 7 | Car breakdown | npc | 12%/yr, $600-$2,500 | Expense | Notable |
| 8 | Rent hike at lease renewal | npc, scheduled yearly | Always at lease week; +3% base, +5-10% in inflation templates | Expenses up | Minor or notable: accept / move (moving cost $1,500, cheaper rent) |
| 9 | Annual raise / promotion | npc, scheduled yearly | Raise 2-5%; 10% chance of promotion +10-15% | Income up | Notable: "Lifestyle upgrade?" (bigger place, new car) vs "Save the raise" |
| 10 | New job with better 401(k) match | npc | 5%/yr | Salary +8%, match changes | Choose contribution % ("You are leaving $X of match on the table") |
| 11 | Hot tip / FOMO | npc | 6%/yr, x4 while NNST or LarpCoin is up over 100% | None unless bought | Buy $1k / $5k / pass |
| 12 | Windfall / inheritance | npc | 2%/yr, $5k-$25k | Cash to checking | Lump sum vs DCA over 12 weeks vs spend some |
| 13 | Tax season | city, scheduled week of Apr 15 | Always | Realized gains taxed (15% LT / 22% ST), refunds | Minor |
| 14 | Roth IRA deadline reminder | city, scheduled early April | Always | None | "Contribute up to $7,500 for last year?" |
| 15 | Market new all-time high after a crash | market, conditional | When the index recovers the prior peak | Headline plus counterfactual recap | Minor: shows "Sellers vs holders" chart and a best-days stat |

## Open questions for the team

Update from the 2026-09-11 game design meeting ([../meeting-2026-09-11-game-design.md](../meeting-2026-09-11-game-design.md)): the player lives their own life (question 1), retirement is the end goal (question 7), and 1 tick is now 1 day, not 1 week.
Normal speed was set to 1 in-game week every 10 real seconds (changed to 5 seconds on 2026-09-12, below), which replaces the speed table in Section 5; skips (+1 month, next event, and fast-forward until a goal; the age teleport was removed on 2026-09-12) cover the long stretches.
The weekly calibration above still holds; divide weekly drift by 5 and weekly volatility by sqrt(5) for trading days, and use `dailyProb = 1 - (1 - annualProb) ** (1/365)` for events.

Update from 2026-09-12 (the meeting file's "Follow-up decisions"): 1x is now 1 week every 5 seconds, 2x is 1 week every 2.5 seconds, and +1 month is the only fixed skip (question 6: rewind is unlimited from any circled date on the phone's calendar; changing a decision re-runs from that date and the player continues on the new branch, with the old path as a ghost line).
The score mixes retirement readiness (net worth, credit score, debt) with a wellbeing meter (question 2).
Instead of curated seeds, the AI Boom (event 3) and AI Bubble Pop (event 4) are preset to fixed calendar dates in every run (dates to be picked) and other events stay random (question 5); this overrides their scheduled window and `requires` trigger in the event table.

1. Does the player control one "focus" citizen (their own life from the voice interview) with 49 NPCs as the city backdrop, or does the player manage all 50? This decides who gets decision modals.
2. Is the scoring goal net worth at a fixed age, citizens kept housed, or a mix with a wellbeing meter?
3. Do we ship crypto at all, or only as a FOMO event?
4. How much tax realism do we want: flat simplified rates (recommended) or real brackets?
5. Should demo seeds be curated (guaranteed AI Bubble Pop plus one crash by minute 5) for judging?
6. Rewind UX: free rewind at any decision point, or limited "rewind tokens" to keep choices meaningful?
7. Starting age and time span: a 20-year career (25 to 45) fits the demo; do we want retirement at all?
8. Do bear markets visibly affect the map (shuttered shops, grey palette, fewer cars)? It is cheap and strongly reinforces the message.
9. Who writes the post-crash recap text: templated strings (reliable) or the LLM post-mortem (richer, but adds latency during the demo)?
