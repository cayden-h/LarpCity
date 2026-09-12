# Investing Twins and the Crash Decision - Design Spec

Date: 2026-09-12
Status: Implemented.
Branch: `investing-twins`, based on `origin/Tri` (the Express server the team adopted).
Research: [research/03](../../../research/03-stock-market-and-simulation.md) sections 3-4 ("Showing counterfactuals"), [research/12](../../../research/12-credit-desk-ui.md) (Investing tab).

## Problem

The Money desk (`game/debt.html`) lets the player buy and sell LTM, BOND, and NNST on the seeded market, and the AI Bubble Pop is scripted, but nothing showed what a choice cost.
Research/03's core lesson ("panic selling locks in the loss") needs an honest comparison line on the same market, and a moment that asks the player to decide when the crash comes.

## Goals

1. Two shadow portfolios ("twins") tick alongside the player's brokerage on the same prices.
2. A bear market pauses time and asks the player what to do.
3. The Investing chart shows You, If you had held, and Autopilot.
4. The three lines persist to Tiger Data, and the Gemini coach's `recovery` trigger writes the lesson when stocks get back to their high.

Out of scope: retirement accounts in the desk, capital gains tax, new funds, projections (later slices).

## 1. Twins in the sim

`game/src/sim/life/twins.ts` holds the twins; `PlayerLife` owns them.

- Every buy that goes through `PlayerLife.fill()` (manual, auto-invest, or the fast-forward crash rule's buy-back) feeds the twins only its new money, at the same day and price.
- Sale proceeds reinvest first: a buy uses up any `cashOut` still counted on the player's line before any of it counts as new money, because the twins never sold those dollars and would otherwise invest them twice.
- **Held** buys the same instrument with the new money and never sells.
- **Autopilot** splits the same new money 90% LTM and 10% BOND and never sells.
- Sells (manual, Sell everything or Sell half from the decision, or the crash rule) only add their proceeds to `cashOut`; they never change the twins' units.
- `invested` counts the new money the player has put in.
- **You** is the brokerage's value plus `cashOut`, so the three lines always compare the same dollars; brokerage value alone would drop to $0 after Sell everything and read as a total loss.
- Scope is the brokerage only; the 401(k) is identical across the three and would only dilute the gap.
- Twins hold units per instrument, so their value is `units * market.price(id, day)`, exact and O(instruments).
- `LifeSnapshot` carries `brokerage`, `you`, `held`, and `autopilot` (dollar values at that day's prices).

Every life starts with `STARTER_PORTFOLIO` (LTM $6,000 and NNST $800, bought a year before the game starts).
`Twins.seedHolding(id, units, day)` seeds all three lines at its value on the life's first day: Held gets the same units, Autopilot gets the same dollars at 90/10 at that day's prices, and `invested` grows by that value.
What the player paid a year earlier doesn't enter the comparison.
For the days before the life began, `pastSnapshots` sets `held` and `autopilot` equal to `you`, since the comparison starts on day 0.

Because the market path is keyed by (seed, day) and never by player actions, and every line starts equal, the gap between the lines comes only from the player's choices.

## 2. Bear market, recovery, and the decision

- `PlayerLife` tracks the running peak of LTM's daily close.
- When LTM closes 20% or more below that peak (`PANIC_DRAWDOWN` from `sim/skip/crash.ts`) and the player holds stocks (LTM or NNST), it emits `{ type: "bear_market", day, drop, stocks }` once.
- It re-arms when LTM sets a new peak, which also emits `{ type: "market_recovered", day, you, held, autopilot }` if a bear market fired in between.
- `PlayerLife.needsDecision(events)` is true for `bear_market`, `cannot_cover`, and `bankruptcy_eligible`.
  Goal fast-forwards (`sim/skip/run.ts`) run `life.onDay` headless and never ask; the standing crash rule resolves crashes there.

The decision sheet ("Time is paused") titled "Stocks are down N% from their high" says "Your stocks are worth $X now. This is a bear market. What do you do?" and offers:

- Sell everything: "Locks in the loss. The best days usually come right after the worst."
- Sell half: "Halves the pain and halves the rebound."
- Hold (marked good): "So far, every US bear market has recovered, and holders got the whole rebound."
- Buy $N more, only when checking has at least $1 beyond a month of bills, with N the smaller of $500 and that spare cash: "Stocks are on sale. It works if you won't need this money for years."

Selling sells each stock holding (LTM and NNST), skipping legs under the $1 minimum.
The feed logs the choice ("In the crash, you sold everything ($X)", "held", "bought $N more").

### Decisions in the city

Inside the city, the city owns decision moments; the desk is an iframe that may be hidden or not loaded yet.

- In `game/src/main.ts`, `clock.onDay` checks `player.needsDecision(events)`: it stops the time-lapse skip and calls `phone.showDecision(...)` with the decision events.
  Bankruptcy still stops skips and pauses time as before.
- `Phone.showDecision` parks the events and opens the Money window, which pauses the city clock.
- The desk reads the city through `window.parent.larpMoney` (`MoneyHost`): `life()`, `clock`, `takeDecisions()` (returns and clears the parked events), `onShow(fn)` (called each time the window is shown), and `recorder()` (the city's `RunRecorder`, passed in through `PhoneDeps`).
- Each time the window is shown, and once when the desk first loads, the desk takes the parked events and opens the most important one (bankruptcy, then a payment it can't cover, then the crash); the rest go to the feed.
- The desk's own listener still logs these events in the city, but opens decisions from it only when standalone.
- Answering a decision in the city leaves time paused, as the window says ("City time is paused until you press play"); the standalone desk resumes its clock.
- `Phone.showDecision` sets `resumeSpeed` to 0 right after opening the desk, so a decision keeps the city paused until the player presses play even if the window is closed and reopened before it's answered.
- If a decision arrives while the desk already has one open, the desk hands it back to the phone with `MoneyHost.parkDecisions` instead of just logging it, so the next time the window is shown it's asked in the usual priority order.

## 3. Investing page

- `chart.ts` takes `lines: { pts, cls, label }[]`; each extra line is drawn under the main line with its class, and every line with a label (plus the main line's `mainLabel`) is labeled just above its right end, nudged apart so labels never overlap.
  The debt page's "Minimums only" line uses the same option.
- The Investing chart always shows the twins, since every life starts invested: You (solid, tone color), If you had held (dashed), and Autopilot (dotted), zero-based per research/12 and labeled You, If you had held, and Autopilot.
- The line under the hero reads "+$X vs if you had held" (or "Even with if you had held" within 50 cents), then "· autopilot $Y", plus the date while scrubbing.
- The recovery card appears for a year after `market_recovered`, titled "Stocks are back at their high" with built-in text: "Selling cost you $X. Holding would be worth $Y; you have $Z.", "You came out $X ahead of holding. Most sellers don't: the rebound often comes fast.", "You held, so you got the whole rebound.", or "You came out about where holding would have left you.", followed by "In the crash, you ...".
  When the coach answers, the card shows only the coach's headline and lesson.
- The concentration card appears when NNST is over 20% of the brokerage's value: "NeuralNest is N% of your investments" with "One company can fall 80%. A fund spreads the risk across hundreds."

## 4. Backend (Tri's server)

- `server/src/migrations.sql` adds `you`, `held`, and `autopilot` (double precision) to `player_snapshots`; daily rows only, the weekly and monthly aggregates don't carry them.
- `POST /api/snapshot` accepts optional finite `you`, `held`, and `autopilot`, and upserts one row per day; on a resend that omits them, the stored lines are kept (`COALESCE`).
  `GET /history/:runId` returns them.
- `POST /api/feedback` takes the trigger `recovery` with `{ runId, trigger, day }`.
  The server reads the run's stored `bear_market` and `market_recovered` events (10 years back) and the trades between them, and answers 409 until that day's recovery is stored.
  The coach compares You with Held and Autopilot and names what the choice cost or earned; when Gemini fails, a template answer from the same facts stands in.
  Headlines are sentence case (for example "Selling cost you $550", "You rode it out", "Buying the dip paid off").
- `game/src/net/recap.ts` (`fetchRecoveryLesson`) sends only the run and the day, with a timeout on each attempt (the server may try two Gemini models) and one retry after a 409; it returns null on any other failure.
- The run recorder (`game/src/sim/record/index.ts`) sends the three lines with every daily snapshot.
- The standalone desk records its own run with a `RunRecorder`; inside the city, the desk asks the coach about the city's run through `MoneyHost.recorder()`.
  Before asking, the desk flushes the recorder so the recovery is stored.

## 5. Error handling

- Server unreachable or failing: the recorder keeps unsent days and retries later; the sim is the source of truth and the game never waits on the server.
- No run recorded, a 409 that doesn't clear on retry, a timeout, or a coach failure: the recovery card keeps its built-in text.
- A coach answer that arrives after a newer recovery (or a standalone reset) is dropped.

## 6. Testing

- `game/tests/twins.test.ts`:
  - Twins copy buys at the same price and ignore sells; sale proceeds bought back don't feed the twins twice.
  - Buy and never sell: You equals Held.
  - Sell everything at the AI pop's bottom, then run to recovery: Held ends above You.
  - `bear_market` fires once per drawdown and alternates with `market_recovered`; no stocks, no bear market.
  - Two trades on one day keep one snapshot.
  - The starter portfolio starts You, Held, and Autopilot at the brokerage's value on day 0, with `invested` equal to it and equal lines on every past day.
- `game/tests/record.test.ts` checks the lines in snapshots; `game/tests/recap.test.ts` checks the recovery client (the body, the timeout, the 409 retry, and null on failure).
- Server: the snapshot schema (lines optional, non-finite rejected), the store's lines and `COALESCE` on resend against the local database (`TEST_DATABASE_URL`), and the `recovery` facts, template, and prompt (`ai/facts.test.ts`, `ai/coach.test.ts`).
- Verification: `npm test` and typecheck in `game/` and `server/`, then the real desk and city in a browser: skip to the AI pop, answer the decision, skip to the recovery, check the lines and the coach's card, and that rows land in Tiger Data.
