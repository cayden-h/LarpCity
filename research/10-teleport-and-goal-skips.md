# 10 - Teleport and Goal Skips

How the age teleport ("jump from 24 to 60") and goal skips ("skip until I can buy a house") should work: the setup screen before the jump, how decisions get made while skipping, what interrupts a skip, what the player sees afterwards, and how to build it on the code we have.
Written 2026-09-12 during HackRice 2026.
It follows the meeting file ([../meeting-2026-09-11-game-design.md](../meeting-2026-09-11-game-design.md)), especially "Goal skips and the age teleport" in the 2026-09-12 follow-up decisions; where this doc conflicts with the meeting, the meeting wins.
It builds on the event table and determinism rules in [03-stock-market-and-simulation.md](03-stock-market-and-simulation.md), the debt strategy input from [06-debt-and-credit.md](06-debt-and-credit.md) and [07-debt-system-design.md](07-debt-system-design.md), and the "no new applications during skips" rule from [08-cards-loans-accounts.md](08-cards-loans-accounts.md).
A later decision on 2026-09-12 (now in the meeting file's "Review and rewind") lets the player tap any red or blue circled date and change that decision; time rewinds to that date and re-simulates on the same seed, the old path stays as a ghost line, and rewinds are unlimited.
Section 10 designs for that.
Later decisions the same day (meeting file, "Fast-forward to goals"): **the age teleport is removed entirely**, so everything below about teleporting to an age applies only to fast-forwarding until a goal.
The setup screen is pre-filled with current habits, the AI Bubble Pop does not interrupt a fast-forward, and the score always reflects the current branch with no penalty for rewinds (open questions 1, 2, and 11 are answered).

## TL;DR

- **The setup screen is a Football Manager "holiday" screen for your money.**
  Before a teleport or goal skip, the player sets standing orders in five groups: saving and investing (the recurring investment deposit, 401(k) %, match capture, Roth IRA, auto-escalation), portfolio (stock/bond mix, glide path, rebalancing, single-stock cap, crash rule), safety net (emergency fund months, surplus sweep), spending and housing (lifestyle level, share of each raise saved, rent-hike tolerance, housing plan), and debt (strategy, extra payment, card and offer rules).
  Each input is pre-filled with what the player is doing now, and a one-tap "Recommended" preset shows the difference it makes.
- **A live preview answers "what will this get me?"** with a fan chart (10th, 50th, and 90th percentile net worth), the odds and year the goal is reached, and the goal's price tag, the same way Fidelity, Empower, Boldin, and ProjectionLab do.
  The preview runs on other seeds, never the run's own seed, so it cannot leak the hidden future.
- **Standing orders decide every choice the skip passes through.**
  Market events never interrupt by default, because a pre-committed "hold" rule is the lesson (panic selling is what the preview is protecting against).
  Three interrupt levels: **Autopilot** (only bankruptcy and the goal stop it), **Big life moments** (default: also layoff, marriage, divorce, kids, and a move-or-buy confirmation), and **Hands-on** (also every market crash, the AI Bubble Pop, windfalls, and payments that can't be covered).
- **Afterwards:** a full-screen newspaper digest of the skipped years, red and blue calendar circles written into every skipped year (each auto-decision is reviewable and shows the rule that made it), a snapshot on every Jan 1 and at every milestone, and one AI feedback call at the stop, whose "you could have reached this N years sooner" number comes from re-running the same seed with one input changed.
- **Rewinds work across skips.**
  Every skipped day is a real day on the branch, with the standing orders in force logged by day, so a rewind can land inside a teleport, change one auto-decision or the whole plan from that day, and branch.
  The old branch keeps only a small monthly ghost series (about 10 KB for 40 years), a new branch shares its parent's history up to the fork, and seeking costs at most one year of re-simulation from a Jan 1 checkpoint (a few ms).
- **Performance is not a problem.**
  Today's `PlayerLife.runHeadless` runs 40 years (14,600 days) in 14-17 ms in Node 26 on the dev Mac.
  With the market, investments, and event director it should still be around 50-150 ms, so the real skip runs the exact daily engine on the main thread; only the preview's Monte Carlo uses a monthly fast path (and later a Web Worker).
- **Hackathon MVP:** one setup modal with 7 inputs, a 3-line preview band from 100 monthly paths, `runSkip` with a stop predicate, auto-resolution for the events that exist by Sunday, a digest overlay, and the AI call at the stop.

## 1. What exists in the code today

This is the state of `main` at commit `745c737`.

### The money life (`game/src/sim/life/player.ts`)

- `PlayerLife` owns a `Ledger` (checking, high-yield savings, emergency fund, brokerage), a `DebtBook`, a `Place` (state price parities), `employed`, `age`, and `monthlyTakeHome`.
- `onDay(day, date)` does, in order: settle pending transfers, pay half the take-home on the 1st and 15th (40% while unemployed, minus garnishment), pay rent on the 1st and living costs on the 15th through the wallet, run the debt engine's `tickDay`, then pay savings interest on the 1st.
  It records a `LifeSnapshot` (cash, investments, debt, net worth, score) every day and calls `onEvents` listeners.
- `runHeadless(fromDay, days, startDate)` loops `onDay` and returns `{ daysRun, stoppedBy: "bankruptcy" | null, events }`.
  It stops on the first `bankruptcy_eligible` event through `stopsSkip(events)`.
  Everything else resolves by the book's standing debt strategy and the ledger's shortfall waterfall (checking, then savings, then the emergency fund, never investments).
- `needsDecision(events)` flags `cannot_cover` and `bankruptcy_eligible`, but nothing in the UI uses it yet.
- Not there yet: gross salary, taxes, raises, age advancing with the date, 401(k) and Roth accounts in the default ledger (the `AccountKind` type has them), investment returns (the brokerage balance never moves), a market path, and an event director.

### The debt engine (`game/src/sim/debt/`)

- `tickDay(book, ctx)` accrues interest, closes card statements, pays through the `Wallet`, walks the delinquency ladder, and on the 1st routes `book.extraMonthly + book.rollover` to debts in `book.strategy` order (`minimums`, `avalanche`, `snowball`).
- The bankruptcy stop is `monthly()`: when unsecured debt is 90+ days late and minimums exceed half of take-home, it emits `bankruptcy_eligible` with a plain-language `reason`, at most once every 90 days.
- `strategy.ts` has the monthly `project(debts, strategy, extra)` and `compareStrategies`, which already give a debt-free month and interest for the setup screen's debt input.
- Recovery actions the auto-resolver can call: `enrollHardship`, `switchToRap`, `payNow`, and `fileBankruptcy` in `bankruptcy.ts`.

### Money (`game/src/sim/money/`)

- `Ledger.transfer` with real rails (ACH in 2 business days, instant at 1.75%, early 401(k) withdrawal penalty plus 22% tax), `payInterest`, and `wallet(order)`.
- Applications (`applyForCard`, `applyForLoan`, DTI limits per loan kind in `DTI_LIMIT`) are pure functions, so the housing goal can call `applyForLoan` for a mortgage.

### The clock, HUD, and phone

- `engine/clock.ts` still has `SECONDS_PER_GAME_WEEK = 10` and `SPEEDS = [0, 1, 2, 4]`, and `ui/hud.ts` still shows 4x and "+1 week".
  The 2026-09-12 decision is 5 s per week with pause, 1x, 2x, and +1 month only, so both files are out of date (not changed by this doc).
- `main.ts` plays HUD skips as a time-lapse: `setInterval` calls `clock.advanceDays(1)` every `max(40, 1400 / days)` ms, and each day fires `clock.onDay`, which runs `player.onDay`.
  A `bankruptcy_eligible` event sets `skipping = 0` and `clock.speed = 0`.
  At 40 ms per day a 36-year teleport would take about 9 minutes, so the teleport must not use this path.
- `Clock.advanceDays` always fires listeners, so a headless run followed by moving the clock forward would run every day twice.
  The teleport needs a `clock.jumpTo(day)` that sets the day without firing `onDay`.
- `ui/phone.ts` has a working Stocks app and "Soon" placeholders for News, Mail, and Bank; there is no Calendar app yet.

## 2. How real planning tools handle it

| Tool | Inputs it exposes | How it shows uncertainty | Takeaway for Larp City |
| --- | --- | --- | --- |
| Vanguard retirement calculators | Age, retirement age, current savings, annual contribution, expected return, income replacement; the nest egg tool runs 5,000 simulations and reports the share that last ([Bogleheads wiki](https://www.bogleheads.org/wiki/Retirement_calculators_and_spending), [Vanguard](https://investor.vanguard.com/tools-calculators/retirement-income-calculator)) | "Your portfolio lasted in 4,000 of 5,000 simulations = 80%" | A single percentage is easy to read; say what it counts |
| Fidelity Planning & Guidance | Expenses, Social Security, other income, start and end dates | Plans against a "significantly below average market": the 10th percentile, where 90 of 100 scenarios did at least as well ([Fidelity](https://nb.fidelity.com/public/nb/default/resourceslibrary/articles/WorkspaceAboutYourScore), [Bogleheads thread](https://www.bogleheads.org/forum/viewtopic.php?t=315144)) | Show a "bad luck" line, not only the median |
| Fidelity guidelines | Save 15% of income including the match; 1x salary by 30, 3x by 40, 6x by 50, 8x by 60, 10x by 67 ([Fidelity](https://www.fidelity.com/viewpoints/retirement/how-much-money-should-I-save), [Fidelity roadmap](https://www.fidelity.com/learning-center/personal-finance/retirement/retirement-roadmap)) | None | Good "Recommended" preset and age checkpoints |
| FIRECalc and cFIREsim | Portfolio, spending, years, allocation; cFIREsim supports about 80 adjustments | Runs every historical start year since 1871; "94.3% success" means 100 of 106 cycles never hit $0 ([FIRECalc](https://www.firecalc.com/intro.php), [cFIREsim](https://alistair-marshall.github.io/cFIREsim-open/), [Bogleheads blog](https://www.bogleheads.org/blog/portfolio/cfiresim/)) | Success = "never went broke", which is exactly our bankruptcy stop |
| Empower (Personal Capital) | Linked accounts plus major events | Monte Carlo likelihood of success ([Empower](https://www.empower.com/the-currency/money/how-to-calculate-your-retirement-number)) | Life events on the timeline |
| Boldin (NewRetirement) | Income, assets, Social Security, spending; PlannerPlus runs 1,000 scenarios and up to 10 side-by-side scenarios ([Boldin](https://www.boldin.com/retirement/boldin-vs-empower/)) | "Chance of Success" score | Side-by-side "your plan vs recommended" |
| ProjectionLab | Full plan with milestones (retirement, debt freedom) | The Plan tab is one fixed path; "Chance of Success" re-runs it over historical and random trials, where milestones can land on different dates ([ProjectionLab](https://projectionlab.com/help/plan-vs-chance-of-success), [ProjectionLab Monte Carlo](https://projectionlab.com/monte-carlo)) | Separate the one path you live from the spread of paths you might have lived |
| Monarch | Save-up goals with growth rates, target dates, and statuses (on track, ahead, at risk), plus a recommended monthly contribution ([Monarch](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals), [Monarch forecasting](https://help.monarch.com/hc/en-us/articles/48344305092244-Forecasting-in-Monarch)) | Deterministic | "Needed per month to hit it by 2031" is the right goal sentence |

What makes them teach well, and what to copy:

- **Show a range, not a line.**
  Fan charts with a median, a 25-75 band, and a 10-90 band are standard, and the width of the fan is itself a picture of sequence-of-returns risk ([Ryan O'Connell's calculator notes](https://ryanoconnellfinance.com/calculators/retirement-monte-carlo-calculator/)).
- **Be careful with the success percentage.**
  Kitces shows that a plan that adjusts as it goes can start at a much lower success probability without failing more often, so "70%" means "you may need to adjust", not "30% chance of ruin" ([Kitces](https://www.kitces.com/blog/monte-carlo-retirement-projection-probability-success-adjustment-minimum-odds/)).
  Our label should say "in 78 of 100 futures the house was affordable by 2031".
- **Sequence risk peaks around retirement.**
  The "red zone" is about 10 years before and after retirement, when the portfolio is biggest and there is the least time to recover; Kitces's "bond tent" raises bonds into retirement and lowers them again afterwards ([Kitces](https://www.kitces.com/blog/retirement-date-risk-how-sequence-of-returns-risk-impacts-a-pre-retirement-accumulator/), [Financial Planning](https://www.financial-planning.com/news/kitces-avoid-the-retirement-danger-zone)).
  That gives the glide path input a concrete lesson: a teleport to 60 that ends in a crash hurts an all-stock player much more.
- **Monte Carlo tools often understate fat tails** ([Kitces on fat tails](https://www.kitces.com/blog/monte-carlo-analysis-risk-fat-tails-vs-safe-withdrawal-rates-rolling-historical-returns/)); our regime model with named crashes (doc 03) is fatter-tailed, so the preview should use the same model.

## 3. How games handle skipping and auto-resolving

| Game | What skipping looks like | How choices get made | When it interrupts |
| --- | --- | --- | --- |
| Football Manager "holiday" | Pick a length (a date or end of season) | A setup screen before leaving: keep my tactics and team selection, let the assistant handle transfers or not, accept offers for players or not ([FM wiki](https://footballmanager.fandom.com/wiki/Holiday), [FM-Arena](https://fm-arena.com/thread/3269-playing-on-vacation-holiday/)) | Returns at the set date; players are advised to set tactics first because otherwise the assistant's judgement decides |
| Paradox (Stellaris, Crusader Kings III, EU4) | Speed 1-5 plus pause | The player picks an option on each event | Stellaris has separate "Event Auto-Pause" and "Event Auto-Unpause" settings; CK3 pauses on events in single player, and players mod in finer pause rules ([Paradox forum](https://forum.paradoxplaza.com/forum/threads/is-autopause-on-events-a-setting.1445451/), [Steam workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=2906586207)) |
| BitLife | "Age" button: +1 year (or +6 months) | Random events fire as the year passes and pop up a choice ([BitLife wiki: Age](https://bitlife-life-simulator.fandom.com/wiki/Age), [Events](https://bitlife-life-simulator.fandom.com/wiki/Events)) | Every decision pops up, so a long skip is many taps |
| The Sims 4 | Lifespan short / normal / long | "Auto Age" settings for played and unplayed households decide whether others age off-screen ([Carl's guide](https://www.carls-sims-4-guide.com/tutorials/sims.php)) | None; aging is a setting, not an event |
| Stardew Valley | Sleep ends the day | Overnight, shipped goods are sold and an earnings screen shows the tally ([Stardew wiki](https://stardewvalleywiki.com/Shipping)) | Festivals and birthdays sit on the calendar ahead of time |
| Cities: Skylines | 1x / 2x / 3x (a day takes several seconds at top speed) | The simulation runs on; the player acts when they want ([Steam discussion](https://steamcommunity.com/app/949230/discussions/0/3877096256094421100/)) | Notifications only |
| Idle games (for example Melvor Idle) | Offline time | The same simulator and the same RNG and drop tables run for the time away, capped around 24 hours | A "while you were away" summary on return ([Tideward](https://tideward.app/offline-progression/)) |

Lessons:

- **Set the rules before leaving, not during** (Football Manager).
  That is exactly our setup screen, and it is what makes the skip a decision the player owns.
- **Interrupt settings belong to the player** (Stellaris's auto-pause and auto-unpause toggles), but the defaults matter more than the options.
- **BitLife's "every event pops up" breaks long skips**, which is why only a short list of events interrupts ours.
- **The summary is the reward** (Stardew's overnight tally, the idle-game "while you were away" screen).
  The newspaper digest is our version, and it has to show numbers that changed, not just headlines.
- **Honest offline simulation uses the same engine and RNG as live play** (Melvor), which is already our rule.
- Doc 03 already notes that auto-resuming after a decision annoys players, so after an interrupt the skip waits for a "Continue skip" tap.

## 4. Behavioral research for the setup screen

- **Defaults are sticky, and people read them as advice.**
  After a company switched to automatic enrollment, most new hires kept both the 3% default rate and the money market default fund, even though almost nobody hired before chose that combination ([Madrian and Shea 2001, QJE](https://academic.oup.com/qje/article-abstract/116/4/1149/1903159), [NBER working paper](https://www.nber.org/papers/w7682)).
  So the pre-fill we choose will largely be what players teleport with.
- **Plans have moved to better defaults.**
  61% of Vanguard plans auto-enrolled in 2024, 61% of those at 4% or more and 30% at 6% or more, and nearly 7 in 10 auto-enrollment plans add yearly automatic increases ([Vanguard How America Saves 2025](https://corporate.vanguard.com/content/corporatesite/us/en/corp/articles/how-america-saves-2025-key-trends-insights.html)).
- **Save More Tomorrow:** committing now to save part of future raises took savers from 3.5% to 13.6% of pay over four raises, and take-home pay never dropped ([Benartzi and Thaler 2004, via UCLA](https://www.anderson.ucla.edu/faculty/shlomo.benartzi/savemore.htm), [DOL CLEAR summary](https://clear.dol.gov/study/save-more-tomorrow%E2%84%A2-using-behavioral-economics-increase-employee-saving-thaler-benartzi-2004)).
  This is the "share of each raise you save" input, and it is the most painless lever to show.
- **The future self:** people who saw age-progressed renderings of themselves put more than twice as much into a hypothetical retirement account ($172 vs $80), and working adults about 33% more of their paychecks ([Hershfield et al. 2011](https://journals.sagepub.com/doi/10.1509/jmkr.48.SPL.S23), [NYU Stern](https://www.stern.nyu.edu/experience-stern/faculty-research/hershfield-retirement-savings)).
  A field test with about 50,000 savers in Mexico raised one-time contributions by 16% (1.5% to 1.7% of account holders) ([Robalino et al. 2023](https://journals.sagepub.com/doi/10.1177/23794607231190607)).
  The effect is real but modest in the field, so the aged avatar is a nudge, not the whole screen.

How that shapes the screen:

1. **Pre-fill with the player's current behavior**, labeled "What you're doing now", so the teleport is honest about their habits.
2. **Offer one tap to "Recommended"** (match captured, 15% total savings, 3-6 month emergency fund, avalanche, hold through crashes, a target-date glide path, and half of every raise saved), and show the difference in the preview: "+$212,000 at 60, and the house 4 years sooner".
   This uses the default effect for good without hiding the choice.
3. **Show "you at 60"**: the aged avatar standing in front of the median home tier the plan reaches, with a monthly retirement income number, framed hopefully (doc 04 warns that a gloomy future self backfires).
4. **Frame changes as future commitments** where possible ("save 50% of future raises"), which is what made Save More Tomorrow work.

## 5. The goal math

The meeting's rule: "the game works out the realistic amount needed and the age or year when the goal becomes reachable."
Every goal is a pure predicate on the life state plus a price tag, so the preview, the skip's stop condition, and the review all use the same function.

### Buy a house

Inputs come from the destination state (the current state unless the player picks another): typical home value (Zillow ZHVI in `research/data/states-sample.json`, for example $301,806 in Texas and $773,735 in California), the mortgage rate from `offeredApr("mortgage", score, cashRate)` in `sim/debt/rates.ts`, and the state's property tax rate from doc 02.

- **Cash needed** = down payment + closing costs + moving + reserves.
  - Down payment: the player picks 20% (no PMI) or a lower amount; first-time buyers' median is about 9%, and under 20% adds PMI of roughly $50-$250 a month until 20% equity ([The Motley Fool](https://www.fool.com/money/mortgages/articles/heres-the-median-down-payment-on-a-home-in-2025), [iAdviser](https://iadviser.com/wave2-buying-first-home-costs-guide/)).
    Default: 10%.
  - Closing costs: 2-5% of the loan ([Rocket Mortgage](https://www.rocketmortgage.com/learn/28-36-rule)); use 3%.
  - Moving: about $2,300 in-city (doc 02's AMSA figure).
  - Reserves: the emergency fund target must still be full after closing, so it is not counted as available cash.
- **Qualification** uses the 28/36 rule: the monthly housing payment (principal, interest, property tax, insurance, PMI) at most 28% of gross monthly income, and all debt payments including housing at most 36% ([Chase](https://www.chase.com/personal/mortgage/education/buying-a-home/28-36-rule), [Rocket Mortgage](https://www.rocketmortgage.com/learn/28-36-rule)).
  Real lenders often approve above 36% ([Mortgage Daily](https://www.mortgagedaily.com/rates/28-36-rule-why-lenders-approve-dti-well-above-it/)), which `applyForLoan`'s `DTI_LIMIT` can model; the goal screen teaches 28/36 as the comfortable line and shows the lender's limit as the hard one.
- **Credit score** must clear the lender's floor in `applyForLoan` (the approval odds already come from the score).
- **Reachable** = the first month where available cash (checking + savings + brokerage, after taxes on any gains) is at least the cash needed, the 28/36 test passes, and the score clears the floor.
- **The sentence the player sees:** "A typical Texas home is $301,806. You need $41,600 in cash (10% down $30,180, closing $8,150, moving $2,300, while keeping your $12,000 emergency fund) and about $7,860 a month of gross income to stay under 28%. At your current plan: reachable around 2031 (age 29); with bad luck 2034."
- **Stop behavior:** the skip stops on the month the predicate first holds and asks the player to confirm the purchase (the D7 decision from doc 06), unless the housing plan says "buy automatically when ready".

### Move to another state

From doc 02's `move_cost` formula: movers (about $4,300 for 1,000+ miles, AMSA via [Lugg](https://lugg.com/blog/moving-cost-calculator)), the destination's first month's rent plus a one-month deposit, 1-2 months of rent to break the origin lease, DMV fees, a week of unpaid time, and a 2-8 week job search unless the job is remote or a transfer.

- **Affordability** also needs the destination to work month to month: take-home at the destination (salary re-banded by the BLS wage ratio for a transfer, or the destination wage for a new job) minus destination rent and living costs (`US_MEDIAN_RENT * rpp.housing / 100`, `US_LIVING * rpp.goods / 100`, which `PlayerLife` already computes) minus debt minimums must stay positive, with the player's savings rate still possible.
- **Reachable** = cash (outside the emergency fund) covers the move cost plus 3 months of destination expenses, and the destination budget is positive.
- **The sentence:** "Moving to San Francisco costs about $14,900 up front, and rent there is about $2,800 a month. On a transfer your pay rises 18%, but your monthly surplus falls from $900 to $240. Reachable around 2028; your savings rate there would drop from 14% to 4%."

### Become debt-free

- Already built: `project(book.debts, orders.debtStrategy, orders.extraMonthly)` returns the months, the interest, and each debt's payoff month.
- The preview shows all three strategies from `compareStrategies`, and the skip stops on the day the last `paid_off` event fires.

### Retire (the age teleport's default target)

- **Target nest egg** = 25 times the yearly spending the player wants in retirement (the 4% rule the Vanguard calculator uses), minus an estimated Social Security benefit, in today's dollars.
- **Checkpoints** from Fidelity (1x salary by 30, 3x by 40, 6x by 50, 8x by 60, 10x by 67) are shown as dots on the fan chart, so "am I on track at 40?" has an answer.
- **Success** = the share of preview paths where the portfolio reaches the target at the target age and never triggers bankruptcy on the way, the FIRECalc definition.

### Other goals

- Emergency fund of N months, first $100k of net worth, a target net worth, and a credit score band are single-number predicates that reuse the same machinery.

## 6. The pre-skip setup screen

### Where it opens

The HUD speed controls are fixed at pause, 1x, 2x, and +1 month, so the teleport and goal skips open from the phone (a new "Future" app, or the Calendar app's goal list) and from a goal card when a goal is set.
The screen has three columns on desktop (target, standing orders, preview) and stacks on narrow screens.

### The target

- **Teleport to an age:** a slider from the current age + 1 to 100, default 60 (the meeting's example), with the target date shown.
- **Skip until a goal:** pick one set goal (buy a house, move to a state, debt-free, emergency fund, net worth, retire), with a cap: "stop at age 67 if not reached" (default: retirement age).
- The target box always shows the preset AI Boom and AI Bubble Pop dates if they fall inside the skip, since they are scheduled and already on the calendar.

### The standing orders

Each input shows its current value, the recommended value, and what changes if the player moves it.
Defaults below say "current" where they come from the player's state.

| Group | Input | Default | Range and validation | Notes |
| --- | --- | --- | --- | --- |
| Saving and investing | **Recurring investment deposit** (brokerage, $ per month) | Current (0 today) | $0 up to the monthly surplus; warn above it | The meeting's headline input |
| | 401(k) contribution (% of gross) | Current, or the match cap if the player has not set one | 0-75%; clamped to the 2026 limit of $24,500, plus $8,000 catch-up at 50+ or $11,250 at 60-63 (doc 03) | A red line: "You're leaving $2,100 of match on the table this year" |
| | Capture the full employer match | On | Toggle; when on, the % can't go below the match cap | Keeps the most common mistake visible |
| | Roth IRA ($ per month) | Current | $0 to $625 a month ($7,500 a year; $8,600 at 50+); warn above the $153k-$168k phase-out | |
| | Auto-escalation | +1 point a year | 0-3 points a year, up to a cap of 10-20% (default 15%) | Vanguard plans' most common feature |
| | Share of each raise saved | 50% | 0-100% | Save More Tomorrow |
| Portfolio | Stocks vs bonds | Current mix, or 90/10 if none | 0-100% stocks | Hidden when a glide path is chosen |
| | Glide path | Target-date | None (fixed mix) / target-date (90/10 falling to about 50/50 at retirement, doc 03) / bond tent | Shows the red-zone lesson |
| | Rebalancing | Yearly | Never / yearly / when off by 5 points | |
| | Single-stock cap (NNST and other fictional stocks) | Current share, or 0% | 0-50%; warn above 20% (doc 03's concentration meter) | Decides the AI Boom |
| | Crash rule | Hold | Hold / rebalance (buy the dip back to target) / sell half / sell all | Every bear template uses it |
| Safety net | Emergency fund target | 3 months of expenses | 0-12 months; warn below 1 | Topped up before investing |
| | Surplus cash sweep | Invest above 1 month of expenses | Keep in checking / to savings / to investments | Stops idle cash piling up |
| | Allow 401(k) withdrawals in an emergency | Off | Toggle; shows the ~30-40% cost from doc 03 | Last step of the waterfall |
| Spending and housing | Lifestyle level | Current (Normal) | Frugal (x0.85 living costs) / Normal / Comfortable (x1.25) / Lavish (x1.5) | Feeds the wellbeing meter (doc 09) |
| | Rent-hike tolerance | Accept up to 7% | 0-20%; above it, move to a cheaper place in the same state | |
| | Housing plan | Rent | Rent / buy when ready (down payment %, 15 or 30 years) / ask me when ready | Drives the house goal |
| Debt | Payoff strategy | Current (`book.strategy`) | Minimums / avalanche / snowball | Doc 06's teleport input |
| | Extra payment ($ per month) | Current (`book.extraMonthly`) | $0 up to the surplus | Shows the debt-free date from `project()` |
| | Card payments | Pay the statement balance | Statement / minimum | Maps to `Debt.autopay` |
| | New credit offers | Decline | Decline / accept limit increases only / accept balance transfers that save money | Doc 08: no new applications during skips |
| | Can't cover a payment | Ask the lender for a hardship plan | Hardship / let it go late | Uses `enrollHardship` |
| Life plan (only shown at Autopilot) | Marriage | Say yes if it comes up | Yes / no; prenup yes / no | Otherwise these interrupt |
| | Kids | None planned | 0-3, by about what age | Adds to cost of living (meeting rule) |
| Interrupts | How interruptible | Big life moments | Autopilot / Big life moments / Hands-on | Section 7 |

Validation rules, checked live:

- **Budget check:** 401(k) (from gross) + deposits + Roth + extra debt payment + rent + living (times lifestyle) + minimums must fit take-home.
  If not, the screen shows "You'd run $340 a month short; the skip would drain your cash" in red, and the Start button needs a second tap, because letting a player walk into bankruptcy is a lesson, not a bug.
- **Limits:** IRS limits clamp silently with a note; they can't be exceeded.
- **Goal already met:** the Start button becomes "Already reachable - buy now?".
- **Unreachable goal:** if fewer than 5% of preview paths reach it before the cap, say so and point at the biggest lever ("Raising your deposit to $600 makes it reachable by 2036 in 70% of futures").
- **Orders are logged by day:** changing them from the setup screen applies from today; changing them for a past day is a rewind (Section 10), which starts a new branch from that day.
  Each change is stored with its day, so reviews show which rule applied and a rewind knows which orders were in force.

### The live preview

- **Fan chart** of net worth (in today's dollars, with a nominal toggle) from now to the target: the 10th, 50th, and 90th percentile, with the Fidelity checkpoints as dots and the goal's price tag as a horizontal line.
- **Headline numbers:** "Typical: $1.21M at 60. Bad luck (1 in 10): $640k. Goal reached in 78 of 100 futures; typical year 2031, bad luck 2034."
- **Retirement income:** "About $4,000 a month in today's dollars at 67" (4% of the nest egg plus Social Security), next to the aged avatar.
- **Debt line:** the debt-free date from `project()`.
- **Diff against Recommended:** a ghost fan and one sentence of difference.
- **Preset events:** vertical markers for the AI Boom and AI Bubble Pop dates, which are in every preview path.
- **What the preview never shows:** the run's own random events.
  It uses 100-200 other seeds, so a player can't see a crash coming by fiddling with inputs.
  The digest later says where the lived path landed in the fan ("You got a 23rd-percentile market").

## 7. Auto-resolution policy and the interrupt list

### Rules that apply to every skip

- Auto-resolution is a pure function `resolve(event, life, orders) -> { optionId, reason }`, so the same event and orders always pick the same option, and the reason string shows in the calendar review ("Held, because your crash rule is Hold").
- Paychecks run through the orders each payday in this order: 401(k) (from gross), debt minimums, emergency fund top-up to target, extra debt payment, Roth IRA, the recurring deposit, then the surplus sweep.
- When cash runs short, the existing waterfall runs (checking, savings, emergency fund), then the deposit and Roth pause, then investments are sold (with capital gains tax), then the 401(k) only if allowed, then a card.
- Live play also uses the orders for anything the player hasn't answered, so they are the same "autopilot" for live play, skips, and NPCs.

### Each event

Event numbers are from doc 03 (1-15) and doc 06 (D1-D15); the meeting's life events are added.

| Event | What the standing orders decide | Interrupts at |
| --- | --- | --- |
| 1 Bear market (template) | Crash rule: hold (default), rebalance into stocks, sell half, or sell all; deposits keep running | Hands-on |
| 2 Correction | Nothing to decide; logged | Never |
| 3 AI Boom (preset date) | Buy NNST up to the single-stock cap; trim above the cap at rebalance | Hands-on |
| 4 AI Bubble Pop (preset date) | Crash rule plus the cap | Hands-on (see open question 2) |
| 5 Layoff | Waterfall; deposits and 401(k) stop with the paycheck; job search 8-26 weeks from the seeded draw; the new job restarts the same % | Big life moments |
| 6 Medical bill | Emergency fund first; above it, a 0% 12-month payment plan (doc 06), never "ignore it" | Hands-on if it can't be covered |
| 7 Car breakdown | Repair from the emergency fund; if not worth fixing (D6), a used car with a 60-month loan at the score's APR | Hands-on |
| 8 Rent hike | Accept up to the tolerance; above it, move within the state ($1,500, doc 03) | Hands-on |
| 9 Raise or promotion | "Share of each raise saved" goes to the 401(k) % and the deposit; the rest raises lifestyle spending | Never |
| 10 New job with a better match | Take it if the salary is at least the current one and it's in the same state; bump the 401(k) % to the new match cap if "capture the match" is on | Never |
| 11 Hot tip / FOMO | Decline unless it fits under the single-stock cap | Never |
| 12 Windfall | Emergency fund to target, then debts above 8% APR, then invest the rest | Hands-on if over $10,000 |
| 13 Tax season | Automatic | Never |
| 14 Roth deadline | Covered by the monthly Roth order | Never |
| 15 New all-time high | Nothing to decide; a digest story with the "sellers vs holders" chart | Never |
| D1 Can't cover a payment | Waterfall, then the "can't cover" order (hardship plan by default) | Hands-on |
| D2 Card offer | Declined (doc 08's rule) unless offers are allowed | Never |
| D3 Credit limit increase | Accept if allowed (lower utilization) | Never |
| D4 BNPL at checkout | Pay now if cash allows, otherwise skip the purchase | Never |
| D5 Payday storefront | Always declined (doc 06) | Never |
| D6 Buy a car | As event 7 | Hands-on |
| D7 Buy a house | Housing plan: buy automatically, or stop and ask | Every level when the plan is "ask me", and always when it is the goal |
| D8 Refinance window | Refinance if the rate is 1+ point lower and the savings pay back the closing costs within 3 years | Never |
| D9 Balance transfer | Accept if allowed and the fee is less than the interest saved over the promo | Never |
| D10 Collector call | Part of the ladder; the "can't cover" order applies | Hands-on |
| D11 Wage garnishment | Switch to RAP automatically (`switchToRap`) | Never |
| D12 Co-sign request | Always declined | Never |
| D13 Debt paid off | Rollover into the next debt (the engine already does this); a blue circle | Never, unless it is the goal |
| D14 Bankruptcy eligible | Nothing is auto-filed | **Always stops** |
| D15 Student loan plan | Keep the current plan; RAP if the payment is more than 10% of take-home | Never |
| Marriage | Life plan (Autopilot only); prenup choice | Big life moments |
| Divorce | Splits by the prenup choice made at marriage | Big life moments |
| Kids | Life plan (Autopilot only); cost of living rises | Big life moments |
| Big portfolio swing | Nothing to decide; collected for the AI feedback at the stop | Never (feedback arrives at the stop) |
| Goal or target age reached | - | **Always stops** |

### The interrupt list

**Always stops, at every level (the player cannot turn these off):**

1. Bankruptcy becomes an option (`bankruptcy_eligible`).
2. The goal is reached, or the target age.
3. Buying a house when the housing plan is "ask me" (it's a 30-year decision).

**Big life moments (the default) also stops for:**

4. Layoff.
5. Marriage proposal.
6. Divorce.
7. A child.

**Hands-on also stops for:**

8. Every bear market start, including the AI Bubble Pop, and the AI Boom.
9. A payment that can't be covered (D1, D10).
10. A windfall over $10,000.
11. A medical bill, car breakdown, or rent hike the emergency fund can't cover.

Why markets don't interrupt by default: the teleport is the one place the game can show that a rule decided in calm times beats a decision made mid-crash.
The default "Hold" rule is a commitment device, and interrupting at the bottom would invite exactly the panic sale the game is trying to teach against.
The crash still shows in the digest with the "you held, here's what selling would have cost" line from the shadow portfolios in doc 03.

After an interrupt, the player decides in the normal decision modal, the choice is logged, and a "Continue skip" button resumes with the same orders and target.
The setup screen can also be reopened at that point, so a layoff can lead to "lower my deposit, then continue".

## 8. What happens after the skip

### The newspaper digest

It unfolds full screen over the city (the meeting's paper effect) and is saved to the News app.

- **Front page:** the stop reason as the headline ("YOU CAN BUY A HOUSE: Austin, March 2031, age 29" or "BANKRUPT AT 41: how it happened"), with the aged avatar and the new home tier.
- **Your life in numbers:** age from and to, net worth then and now (today's dollars), the portfolio's high and low with dates, the biggest drawdown, credit score change, debt paid and interest paid, total contributed versus total growth, and where the lived path landed in the preview fan.
- **Markets:** each named crash with its depth and recovery time, the AI Boom and Bubble Pop with what the player's NNST did, and the "held vs sold" line.
- **Where you live:** rent hikes, moves, and the state's cost-of-living news (the meeting's "what, where, what it affects" rule).
- **Decisions made for you:** every auto-resolution in the skip, grouped by type, each with the rule that decided it and a link to its calendar day ("7 rent hikes accepted under your 7% rule; 1 move").
- **Ghost lines:** "Held", "Autopilot", and (for debt) "Minimums only" and "Avalanche + $X" on the same seed, as in docs 03 and 06.
- **Coming up:** the next scheduled blue and red circles.

### Calendar circles for the skipped years

- **Red** on every day an event happened (market, world, or life), including the ones the orders resolved.
- **Blue** on every decision (auto-resolved decisions get a small "auto" badge), every milestone (first $100k, debt-free, home bought, a checkpoint met), and the goal.
- Tapping a day opens the review: what happened, what was decided and by which rule, the outcome, and a recommendation.
  The recommendation can say "a Rebalance rule would have added $18,000 by 60" because it re-runs the same seed with that rule, and a "Change this decision" button rewinds to that day (Section 10).

### Snapshots

- A `YearSnapshot` on every Jan 1 and at every milestone and stop: age, place, home tier, accounts and holdings (stock/bond/NNST split), debts, score, and the orders in force.
  40 years is about 40-60 records.
- The bankruptcy stop keeps one at the stop day, so the player can look at their portfolio and housing at bankruptcy (a meeting requirement).
- They also power the stretch "travel back through your milestones" at retirement.

### AI feedback

The meeting's three triggers apply, once per skip, at the stop:

- **Goal or target reached:** "You could have reached this sooner if..." with a real number.
  Before calling the model, the game re-runs the skip on the same seed with each of 3-4 single changes (deposit +$100, capture the full match, avalanche instead of minimums, crash rule Hold) and passes the best result, so the model explains a number it did not invent.
- **Bankruptcy:** the ladder events leading up to the stop, the reason string from the engine, and the same re-runs ("with a 3-month emergency fund you would not have missed the March payment").
- **Big portfolio swings:** swings during the skip are collected and the single largest (for example NNST at 40% of the portfolio in the boom) is included in the stop's feedback, rather than a separate call per swing.
- A templated fallback string covers every case in case the model is slow during judging.

## 9. Engineering plan against the actual code

### New types

```ts
// game/src/sim/skip/types.ts
import type { Strategy } from "../debt/types.ts";

export type InterruptLevel = "autopilot" | "life" | "hands_on";

export interface StandingOrders {
  version: 1;
  // Saving and investing
  depositMonthly: number;          // the recurring brokerage deposit
  k401Pct: number;                 // of gross
  captureMatch: boolean;
  rothMonthly: number;
  escalatePtsPerYear: number;
  escalateCapPct: number;
  raiseSaveShare: number;          // 0..1, Save More Tomorrow
  // Portfolio
  stockPct: number;                // used when glidePath is "none"
  glidePath: "none" | "target_date" | "bond_tent";
  rebalance: "never" | "yearly" | "band5";
  singleStockCapPct: number;
  crashRule: "hold" | "rebalance" | "sell_half" | "sell_all";
  // Safety net
  emergencyMonths: number;
  sweep: "keep" | "savings" | "invest";
  allowRetirementWithdrawals: boolean;
  // Spending and housing
  lifestyle: "frugal" | "normal" | "comfortable" | "lavish";
  rentHikeTolerance: number;       // 0.07 = accept up to 7%
  housing: { plan: "rent" | "buy_auto" | "ask"; downPct: number; termYears: 15 | 30 };
  // Debt
  debtStrategy: Strategy;
  extraMonthly: number;
  cardAutopay: "statement" | "minimum";
  creditOffers: "decline" | "limit_increases" | "helpful_transfers";
  cannotCover: "hardship" | "let_late";
  // Life plan (used at "autopilot")
  life: { marry: boolean; prenup: boolean; kids: number };
  interrupt: InterruptLevel;
}

export type SkipTarget =
  | { kind: "age"; age: number }
  | { kind: "goal"; goal: Goal; capAge: number };

export type Goal =
  | { kind: "house"; state: string; downPct: number }
  | { kind: "move"; to: string; job: "transfer" | "new" | "remote" }
  | { kind: "debt_free" }
  | { kind: "emergency_fund"; months: number }
  | { kind: "net_worth"; amount: number }
  | { kind: "retire"; spendMonthly: number };

export interface Resolution { eventId: string; day: number; optionId: string; reason: string; auto: boolean }

export interface SkipResult {
  fromDay: number;
  daysRun: number;
  stoppedBy: "target" | "goal" | "bankruptcy" | "interrupt" | "cap";
  interrupt?: { eventId: string; day: number };
  events: LifeEvent[];             // for the digest and the calendar
  resolutions: Resolution[];       // blue "auto" circles
  snapshots: YearSnapshot[];       // Jan 1, milestones, the stop
  extremes: { high: LifeSnapshot; low: LifeSnapshot; maxDrawdown: number };
}
```

### Where it hooks in

- **`sim/skip/run.ts`: `runSkip(life, orders, target, env): SkipResult`.**
  It is `runHeadless` generalized: the same `onDay` loop, but the stop test becomes a predicate that checks bankruptcy (always), the target or goal, and `shouldInterrupt(event, orders.interrupt)`.
  `runHeadless` stays as a thin wrapper so the existing test keeps passing.
- **`PlayerLife.onDay(day, date, orders?)`.**
  The paycheck branch gains the order-driven allocation (401(k), minimums, emergency fund, extra, Roth, deposit, sweep); the book's `strategy` and `extraMonthly` are copied from the orders when a skip starts.
  Live play passes the same orders, so live and skipped days are one code path.
- **New `PlayerLife` state the skip needs:** `grossAnnual` (for the match, IRS limits, and 28/36), `birthDate` (so age follows the date), 401(k) and Roth accounts in `defaultAccounts`, and holdings (stock, bond, NNST units) that the market path moves.
- **Market and events:** the precomputed seeded market path (doc 03) exposes `returnsOn(day)` and `cashRateOn(day)`, replacing the FRED hold in `sim/life/rates.ts` past the snapshot.
  The event director draws with `hash(seed, stream, day, eventId)`, and the AI Boom and Bubble Pop are fixed days in the director's schedule.
- **`sim/skip/resolve.ts`: `resolve(event, life, orders)`** holds the table in Section 7, and **`sim/skip/goals.ts`** holds each goal's `isMet(life)` and `priceTag(life)`, shared by the preview, the stop, and the review.
- **`Clock.jumpTo(day)`** sets `day` without firing `onDay`; `main.ts` calls it after `runSkip`, then updates the hero's tier and opens the digest.
  The existing `+1 month` time-lapse can stay as is.
- **UI:** `ui/skip-setup.ts` (the screen), `ui/digest.ts` (the newspaper), and the calendar and News apps in `ui/phone.ts`.

### Performance

- **Measured today:** `PlayerLife.runHeadless` for 40 years (14,600 days, 2,677 events, 14,601 daily snapshots) took 14-17 ms in Node 26 on the dev Mac (a scratch benchmark, not committed).
- **Estimated with everything:** the market path is a precomputed `Float64Array` lookup, the director is about 20 event definitions times one keyed hash each per day (about 300,000 hashes over 40 years, a few ms), and holdings are a few multiplies a day.
  Allowing 5-10x overhead, the full daily skip lands around 50-150 ms, well under the 1-2 s budget, so it runs synchronously on the main thread.
- **Keep it fast:**
  - No listeners, DOM updates, or `hud.render` during the loop; `onEvents` listeners fire once with the batch at the end.
  - Record `LifeSnapshot`s monthly during a skip instead of daily (daily history grows by 14,600 objects per 40 years otherwise); keep daily extremes in running variables.
  - The "calendar pages flipping" animation (1.5-2.5 s, skippable) plays over the precomputed yearly snapshots, so it is purely cosmetic.
- **The preview is the expensive part:** 100-200 futures times 40 years is too much for the daily engine (up to 30 s), so it uses a **monthly fast path**: the same regime model aggregated to months, the same order allocation, and the same goal predicates, about 200 x 480 = 96,000 steps, which should be well under 50 ms.
  It re-runs on input changes, debounced by 150 ms.
  Later it moves to a Web Worker: the inputs are plain JSON (`StandingOrders` plus a life snapshot) and the percentile arrays come back as transferable `ArrayBuffer`s ([MDN: postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage), [MDN: transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)).
  A worker for the real skip would need `PlayerLife` to serialize (its `Ledger` holds a `Map` and listeners), which isn't worth it at 150 ms.
- **The AI feedback re-runs** (3-4 extra daily skips on the same seed) cost another 200-600 ms, and they run while the digest animation plays.

### Determinism

- No `Math.random` or `Date.now` anywhere in `sim/`; all draws are keyed by `(seed, stream, day, id)` so a different choice can't shift a later draw (doc 03).
- Resolution is a pure function of the event, the life state, and the orders.
- The preview seeds are `hash(seed, "preview", i)`, never the run's seed, so the preview cannot reveal the lived future.
- Standing orders are logged with their start day (`ordersLog`), and every decision (the player's or an auto-resolution) is logged with its source, so any day can be re-simulated exactly, which is what makes rewinds and branches (Section 10) honest.

### Tests to write (`game/tests/skip.test.ts`)

1. The same seed, life, and orders give identical `SkipResult`s (deep equal).
2. Chunking doesn't matter: one 10-year skip equals ten 1-year skips equals 3,652 live `onDay` calls with the same orders.
3. The market path is identical under two very different orders (decision independence).
4. Random life events land on the same days under different orders, except those conditioned on state.
5. A crafted over-indebted life stops at the bankruptcy month at every interrupt level, with the engine's reason string and a snapshot on the stop day.
6. The house goal stops on the first month `isMet` holds, and not a day before (check the predicate on the previous day).
7. Interrupt levels: Autopilot passes through a layoff, Big life moments stops at it, Hands-on stops at a bear start; "Continue skip" after an interrupt reaches the same end as an Autopilot run when the player picks the option the orders would have picked.
8. One test per row of the resolution table (event and orders in, option out).
9. The preview never uses the run's seed.
10. The paycheck allocation respects IRS limits, the match cap, and the order of the waterfall.
11. A performance guard: a 40-year skip finishes in under 500 ms in Node.
12. The monthly fast path's median at 40 years is within a few percent of the median of 20 daily-engine runs on the same seeds (keeps the preview honest).
13. The rewind tests in Section 10.

## 10. Rewinds into and across skips

The later decision: tap any red or blue circled date, see the review, change the decision, and time rewinds to that day and re-simulates on the same seed with the new choice.
The player continues on the new branch, the old path stays as a ghost line, and rewinds are unlimited.
The point is to let players see what actually works and learn to trust it, so the rewind must be exact (same market, same random events) and cheap.

### What a skip looks like to a rewind

- A skip is not a special block of time: every skipped day ran the same `onDay` and is a normal day on the branch.
  Its red and blue circles are normal calendar circles, and each auto-decision is a normal logged decision with `source: "orders"`.
- The branch also records a `SkipRecord` (start day, end day, target, the orders at the start, and why it stopped), so the digest, the calendar, and the rewind UI know which days belong to which jump.
- **The orders in force on any day** are the last `ordersLog` entry at or before that day.
  The review of a skipped day shows them ("Your plan for the jump to 60: $400 a month deposit, 90/10, Hold").

### The three kinds of rewind a skip needs

1. **Change one auto-decision inside a skip** (for example, the Bubble Pop was held and the player wants to see "sell half").
   The game rewinds to that day, applies the new option, and forks.
   Then it asks: "Finish the jump to 60 with the same plan?"
   Yes runs `runSkip` from that day with the same orders and target (about 150 ms) and opens a digest that compares the new branch with the ghost ("Selling half cost you $96,000 by 60").
   No leaves the player on that day in live play.
2. **Change the plan for the rest of a skip from a day inside it** ("from 2034 on, raise my deposit").
   This rewinds to the day, opens the setup screen pre-filled with the orders in force then, adds a new `ordersLog` entry on the new branch, and offers to finish the jump.
3. **Redo a whole jump with a different plan** ("Change the plan for this jump" on the skip's start day or digest).
   This rewinds to the skip's start day and reopens the setup screen with the old orders; because the seed is the same, the new digest's comparison with the ghost is exact.
   This is the strongest teaching loop in the game: same life, same market, different standing orders.

A rewind to a day before a skip started simply leaves that skip on the old branch; the new branch never ran it unless the player skips again.

Hindsight: after one rewind the player knows when this seed's crash comes and can "time" it.
That is the price of letting players see what works; the ghost comparison still shows it, and scoring is an open question below.

### Data model

```ts
// game/src/sim/run/types.ts
export interface Run {
  seed: number;
  startDay: number;
  init: LifeState;                 // the onboarding state, day 0
  branches: Map<string, Branch>;
  activeId: string;
}

export interface Branch {
  id: string;
  parentId: string | null;
  forkDay: number;                 // first day that differs from the parent (0 for the root)
  label: string;                   // "First try", "Sold half in the Bubble Pop"
  decisions: LoggedDecision[];     // only days >= forkDay; earlier ones come from the parent chain
  ordersLog: { day: number; orders: StandingOrders }[];   // same inheritance rule
  skips: SkipRecord[];
  checkpoints: Map<number, LifeState>;  // Jan 1 of each year, skip starts and ends, the fork day
  ghost: GhostSeries;              // kept when the branch is not active
  endDay: number;                  // last simulated day
}

export interface LoggedDecision {
  day: number;
  eventId: string;
  optionId: string;
  source: "player" | "orders" | "default";
  reason: string;
}

export interface LifeState {       // a PlayerLife serialized to plain data (structuredClone-safe)
  day: number;
  ledger: { accounts: Account[]; pending: Transfer[] };
  book: DebtBook;
  place: Place;
  employed: boolean;
  grossAnnual: number;
  holdings: { stock: number; bond: number; nnst: number };
  director: { counts: Record<string, number>; lastFired: Record<string, number> };
}

export interface GhostSeries {     // one value per month from startDay to endDay
  netWorth: Float32Array;
  investments: Float32Array;
  debt: Float32Array;
  score: Uint16Array;
}
```

- **Inheritance, not copying.**
  A branch's effective decisions and orders are its parent's entries before `forkDay` plus its own, so a fork costs nothing up front and unlimited rewinds make a tree, not copies of 40 years.
- **The market path is shared.**
  It depends only on the seed, so it is computed once per run and used by every branch.
- **`PlayerLife` needs `toState()` and `PlayerLife.fromState(state)`.**
  Today it holds a `Ledger` with a `Map`, listeners, and a daily `history` array; the state excludes listeners and history, and the director's cooldowns and occurrence counts move into the state so a restored day behaves exactly like the original.

### Seeking and re-simulating

1. Find the nearest checkpoint at or before the target day on the active branch's chain (its own, or an ancestor's before `forkDay`).
2. Restore it and run `onDay` to the day before the target, applying the logged decisions and orders.
3. On the target day, apply the new decision, create the branch (`parentId` = the old branch, `forkDay` = the day), make it active, and call `Clock.jumpTo(day)`.

With Jan 1 checkpoints the worst case is replaying 364 days: about 0.4 ms with today's engine, a few ms with everything, so seeking feels instant.
Even with no checkpoints, replaying a whole 40-year run is about 150 ms, so checkpoints are for scale, not for correctness.
Doc 03's "snapshot every 13 weeks" is finer than needed at these speeds.

### Memory and limits

- A `LifeState` is a few KB of JSON (6 accounts, under 10 debts, the credit profile, holdings, the director).
  About 40 Jan 1 checkpoints plus skip and fork checkpoints is roughly 100-250 KB for a 40-year branch.
- **Only the active branch and its ancestors keep checkpoints.**
  When a branch becomes a ghost, its own checkpoints are dropped (kept in a small least-recently-used cache of about 5 branches) and only its `GhostSeries` stays: 480 months x 4 series is about 7-10 KB.
  Returning to an old branch rebuilds its checkpoints by replaying from the nearest shared one, which is exact because the run is deterministic.
- So 1,000 rewinds cost about 10 MB of ghosts, and the chart shows only a few: the parent branch, the best branch, and the last 2-3 the player made, with a branch list in the calendar for the rest.
- Persistence: a branch is small enough to save to IndexedDB (and later Tiger Data) as its decisions, orders, and ghost, without checkpoints.

### Rewind tests

1. Seeking to day N from a checkpoint gives exactly the same `LifeState` as running from day 0 to N.
2. Forking with the same decision the parent made gives a branch identical to the parent (a no-op branch).
3. Forking inside a skip and finishing the jump with the same orders and target gives the same end state as the original skip when no decision changed.
4. The market path and the days of random events are identical across branches.
5. Rebuilding a dropped ghost's checkpoints reproduces its `GhostSeries` exactly.
6. 100 rewinds into a 40-year run stay under a memory and time guard (for example 20 MB and 2 s in total).

## 11. Minimal version for the deadline vs later

Devpost closes Sunday 9/13 at 9:00 AM, so the MVP has to fit in roughly one person's Saturday.

### MVP (build now)

1. **Setup modal** opened from the phone, with a target (age slider, or the goals debt-free and buy a house) and 7 inputs: recurring deposit, 401(k) % with the match hint, stocks vs bonds, debt strategy plus extra, emergency fund months, lifestyle level, and crash rule.
   Pre-filled from the current state, with a "Recommended" button.
   Interrupt level fixed at Big life moments (no setting).
2. **Preview:** a p10/p50/p90 band from 100 monthly paths, the goal's price tag and typical year, and the debt-free date from `project()`.
3. **`runSkip`** with the stop predicate (bankruptcy, target age, goal met), `Clock.jumpTo`, and the paycheck allocation for the deposit, 401(k), and emergency fund.
   If the full market path isn't in by Saturday night, a seeded monthly regime return with the AI Boom and Bubble Pop on fixed dates is enough to make balances move.
4. **Auto-resolution** only for the events that exist by then: the debt engine's (already resolved by the waterfall and strategy), plus layoff and the market templates if the event director lands.
5. **Digest overlay:** headline, 6-8 number lines, the named crashes, and the "decisions made for you" count.
6. **AI feedback at the stop** with one re-run (deposit +$100) for the "sooner" number, and a templated fallback.
7. Tests 1, 5, 6, and 11.
8. **"Redo this jump with a different plan"** (rewind kind 3 in Section 10): keep one `LifeState` from the skip's start day (a `structuredClone` of the life), restore it, reopen the setup screen, and draw the first try as a ghost line in the new digest.
   It needs `toState`/`fromState` but no branch tree, and it shows the rewind idea in the demo.

For the demo, the teleport from the player's age to 60 should cross the preset AI Bubble Pop, so the digest's front page always has a named crash and the "you held" line.

### Later refinements

- The full input list, the interrupt setting, and the life plan.
- Glide path and bond tent, rebalancing bands, auto-escalation, and raise saving.
- Move-state goals with the full `move_cost`, and the house purchase flow with PMI and refinancing.
- The preview in a Web Worker, with 500 paths and a recommended-plan ghost fan.
- Calendar circles with "auto" badges and per-day reviews for skipped years.
- The full branch tree from Section 10: rewinds to any circled day, ghost lines, the branch list, and checkpoint caching.
- The aged avatar on the setup screen (Gemini, doc 01).
- Milestone replay at retirement.
- Every test in Section 9.

## Sources

- Vanguard: [retirement income calculator](https://investor.vanguard.com/tools-calculators/retirement-income-calculator), [How America Saves 2025](https://corporate.vanguard.com/content/corporatesite/us/en/corp/articles/how-america-saves-2025-key-trends-insights.html); nest egg calculator method via the [Bogleheads wiki](https://www.bogleheads.org/wiki/Retirement_calculators_and_spending).
- Fidelity: ["About your score" (significantly below average market)](https://nb.fidelity.com/public/nb/default/resourceslibrary/articles/WorkspaceAboutYourScore), [how much to save](https://www.fidelity.com/viewpoints/retirement/how-much-money-should-I-save), [retirement roadmap](https://www.fidelity.com/learning-center/personal-finance/retirement/retirement-roadmap), [Bogleheads discussion](https://www.bogleheads.org/forum/viewtopic.php?t=315144).
- [FIRECalc](https://www.firecalc.com/intro.php), [cFIREsim](https://alistair-marshall.github.io/cFIREsim-open/), [Bogleheads on cFIREsim](https://www.bogleheads.org/blog/portfolio/cfiresim/).
- [Empower](https://www.empower.com/the-currency/money/how-to-calculate-your-retirement-number), [Boldin vs Empower](https://www.boldin.com/retirement/boldin-vs-empower/), [ProjectionLab: plan vs chance of success](https://projectionlab.com/help/plan-vs-chance-of-success), [ProjectionLab Monte Carlo](https://projectionlab.com/monte-carlo), [Monarch save-up goals](https://help.monarch.com/hc/en-us/articles/44373182867476-Using-Save-Up-Goals), [Monarch forecasting](https://help.monarch.com/hc/en-us/articles/48344305092244-Forecasting-in-Monarch).
- Kitces: [probability of adjustment](https://www.kitces.com/blog/monte-carlo-retirement-projection-probability-success-adjustment-minimum-odds/), [retirement date risk and sequence of returns](https://www.kitces.com/blog/retirement-date-risk-how-sequence-of-returns-risk-impacts-a-pre-retirement-accumulator/), [fat tails](https://www.kitces.com/blog/monte-carlo-analysis-risk-fat-tails-vs-safe-withdrawal-rates-rolling-historical-returns/); [Financial Planning on the red zone](https://www.financial-planning.com/news/kitces-avoid-the-retirement-danger-zone); fan chart percentiles via [Ryan O'Connell](https://ryanoconnellfinance.com/calculators/retirement-monte-carlo-calculator/).
- Games: [Football Manager holiday (wiki)](https://footballmanager.fandom.com/wiki/Holiday), [FM-Arena](https://fm-arena.com/thread/3269-playing-on-vacation-holiday/), [Paradox forum on auto-pause](https://forum.paradoxplaza.com/forum/threads/is-autopause-on-events-a-setting.1445451/), [CK3 auto-pause mod](https://steamcommunity.com/sharedfiles/filedetails/?id=2906586207), [BitLife age](https://bitlife-life-simulator.fandom.com/wiki/Age) and [events](https://bitlife-life-simulator.fandom.com/wiki/Events), [The Sims 4 lifespan and auto age](https://www.carls-sims-4-guide.com/tutorials/sims.php), [Stardew shipping](https://stardewvalleywiki.com/Shipping), [Cities: Skylines II speed](https://steamcommunity.com/app/949230/discussions/0/3877096256094421100/), [Tideward on offline progression](https://tideward.app/offline-progression/).
- Behavioral: [Madrian and Shea 2001](https://academic.oup.com/qje/article-abstract/116/4/1149/1903159) ([NBER](https://www.nber.org/papers/w7682)), [Save More Tomorrow](https://www.anderson.ucla.edu/faculty/shlomo.benartzi/savemore.htm) ([DOL CLEAR](https://clear.dol.gov/study/save-more-tomorrow%E2%84%A2-using-behavioral-economics-increase-employee-saving-thaler-benartzi-2004)), [Hershfield et al. 2011](https://journals.sagepub.com/doi/10.1509/jmkr.48.SPL.S23), [NYU Stern summary](https://www.stern.nyu.edu/experience-stern/faculty-research/hershfield-retirement-savings), [Robalino et al. 2023 field test](https://journals.sagepub.com/doi/10.1177/23794607231190607).
- Housing and moving: [Chase on 28/36](https://www.chase.com/personal/mortgage/education/buying-a-home/28-36-rule), [Rocket Mortgage on 28/36 and closing costs](https://www.rocketmortgage.com/learn/28-36-rule), [Mortgage Daily on lenders above 36%](https://www.mortgagedaily.com/rates/28-36-rule-why-lenders-approve-dti-well-above-it/), [median down payment (The Motley Fool)](https://www.fool.com/money/mortgages/articles/heres-the-median-down-payment-on-a-home-in-2025), [PMI and closing costs (iAdviser)](https://iadviser.com/wave2-buying-first-home-costs-guide/), [AMSA moving costs via Lugg](https://lugg.com/blog/moving-cost-calculator); state home values from Zillow ZHVI in `research/data/states-sample.json` (doc 02).
- Engineering: [MDN Worker.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage), [MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects); timings from a scratch benchmark of `PlayerLife.runHeadless` on commit `745c737`.

## Open questions for the team

1. **Pre-fill:** do we pre-fill the setup screen with what the player is doing now (honest, recommended here) or with the recommended plan (better outcomes, but players learn less about their own habits)?
2. **The AI Bubble Pop in the demo:** should the preset pop interrupt a teleport even at the default level, so judges see the decision modal, or stay auto-resolved with the "you held" story in the digest?
3. **Entry point:** a new "Future" phone app, the Calendar app's goal list, or a goal card, given the HUD speed controls are fixed?
4. **Success odds:** show a percentage ("78 of 100 futures") or only the band and the typical and bad-luck years, to avoid false precision?
5. **Life events at Autopilot:** is it OK for standing orders to decide marriage and kids, or should those always stop the skip?
6. **Gross salary:** onboarding collects take-home today; the match, IRS limits, and 28/36 need gross pay, so should onboarding ask for gross and derive take-home with our tax function?
7. **Dollars:** show the digest in today's dollars (recommended) or nominal?
8. **Cap for goal skips:** stop at retirement age when a goal is never reached, or at a fixed 20 years?
9. **Aged avatar:** does the teleport show the Gemini aged avatar at the stop, and is it fast enough to generate during the digest animation?
10. **Dates:** which exact dates do the AI Boom and AI Bubble Pop get, so the demo teleport always crosses them?
11. **Scoring with rewinds:** once a player has rewound, they know this seed's crash dates; does the score count the first try, the best branch, or the active branch, and should hindsight moves be flagged?
12. **Ghost lines:** how many ghosts should charts show at once (proposed: parent, best, and the last 2-3), and do old branches' newspapers stay in the News app?
13. **After changing an auto-decision inside a skip:** should the game finish the jump automatically with the same plan, or always ask (proposed: ask, with "Finish the jump" as the default button)?
