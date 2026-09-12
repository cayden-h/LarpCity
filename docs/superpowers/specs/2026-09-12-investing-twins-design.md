# Investing Twins and the Crash Popup - Design Spec

Date: 2026-09-12
Status: Approved in brainstorming, pending spec review.
Branch: `investing-twins`, based on `origin/Tri` (the Express server the team adopted).
Research: [research/03](../../../research/03-stock-market-and-simulation.md) sections 3-4 ("Showing counterfactuals"), [research/12](../../../research/12-credit-desk-ui.md) (Investing tab).

## Problem

The Money desk (`game/debt.html`) lets the player buy and sell LTM, BOND, and NNST on the seeded market, and the AI Bubble Pop is scripted, but nothing shows what a choice cost.
Research/03's core lesson ("panic selling locks in the loss") needs an honest comparison line on the same market, and a moment that asks the player to decide when the crash comes.

## Goals

1. Two shadow portfolios ("twins") tick alongside the player's brokerage on the same prices.
2. A bear market pauses the desk and asks Sell all / Sell half / Hold / Buy more.
3. The Investing chart shows You, If you had held, and Autopilot.
4. The three lines persist to Tiger Data, and Gemini writes a short crash recap.

Out of scope: retirement accounts in the desk, capital gains tax, new funds, projections (later slices).

## 1. Twins in the sim

New file `game/src/sim/life/twins.ts`, owned by `PlayerLife`.

- Every buy that goes through `PlayerLife.fill()` (manual, auto-invest, or the fast-forward crash rule's buy-back) is also applied to both twins at the same day and price, but only its new money: a buy first uses up any sale proceeds still counted on the player's line, because the twins never sold those dollars and would otherwise invest them twice.
- **Held** buys the same instrument and ignores every sell.
- **Autopilot** splits the same dollars 90% LTM and 10% BOND and ignores every sell.
- Sells (manual, Sell all/half from the popup, or the crash rule) never touch the twins.
- Scope is the brokerage only; the 401(k) is identical across the three and would only dilute the gap.
- Twins hold units per instrument, so their value is `units * market.price(id, day)`, exact and O(instruments).
- **You** is the brokerage's value plus the cash the player's sells took out, so the three lines always compare the same dollars put in; brokerage value alone would drop to $0 after a Sell all and read as a total loss.
- `LifeSnapshot` gains `brokerage`, `you`, `held`, and `autopilot` (dollar values at that day's prices).

Because the market path is keyed by (seed, day) and never by player actions, the gap between the lines comes only from the player's choices.

## 2. Bear-market event and the crash popup

- `PlayerLife` tracks the running peak of LTM's daily close.
- When LTM closes 20% or more below that peak (reusing `PANIC_DRAWDOWN` from `sim/skip/crash.ts`) and the player holds LTM or NNST, it emits `{ type: "bear_market", day, drop, stocks }` once.
- It re-arms after LTM sets a new peak, which also emits `{ type: "market_recovered", day, you, held, autopilot }` if a bear event fired in between.
- `needsDecision` includes `bear_market`; headless skips ignore it (the standing crash rule already covers skips).
- The desk opens its existing decision sheet, pausing time:
  - Sell all - lesson: "Locks in the loss. The best days usually come right after the worst."
  - Sell half - lesson: "Halves the pain and halves the rebound."
  - Hold (marked good) - lesson: "Every US bear market has recovered; holders get the rebound."
  - Buy more - $500, or what checking has beyond a month of bills; disabled below $1.
- On `market_recovered`, the feed logs "Market back at its high" and the Investing page shows a card: "You $X vs $Y if you had held" (the difference in plain dollars).
- A concentration card appears on Investing when NNST is over 20% of brokerage value: "One stock is N% of your investments. Funds spread the risk."

## 3. Investing page

- `chart.ts`: replace the single `ghost` option with `lines: { pts, cls, label }[]`; each extra line is drawn with its class and labeled at its right end.
  The debt page's minimums ghost moves onto `lines`.
- Once the player has invested, the Investing chart shows You (solid, tone color), If you had held (dashed), and Autopilot (dotted), starting at $0 per research/12.
- Scrubbing shows the three values for the hovered day under the hero.
- Before the player invests, the page keeps today's S&P 500 chart.

## 4. Backend (Tri's server)

- `server/src/migrations.sql`: `ALTER TABLE player_snapshots ADD COLUMN IF NOT EXISTS` for `you`, `held`, and `autopilot` (double precision).
- `server/src/routes/snapshot.ts`:
  - `snapshotEntry` gains optional finite `you`, `held`, and `autopilot`.
  - The insert becomes an upsert (`ON CONFLICT (run_id, ts) DO UPDATE`), so a resent day overwrites instead of being dropped.
  - `GET /history/:runId` returns `you`, `held`, and `autopilot`.
- `server/src/adapters/gemini.ts`: `generateCrashRecap(facts)` with a `responseSchema` for `{ headline, lesson, mood }` (mood: cheer | warn | console), reusing `callGemini`'s key rotation.
- `server/src/routes/ai.ts`: `POST /api/recap` with a Zod body `{ drop, choice, you, held, autopilot, months }`, an in-memory cache keyed on the rounded facts, 502 on provider failure.
- `game/src/net/runs.ts`: on top of `apiFetch`, starts a run (`POST /api/runs`) lazily, queues history rows, flushes every in-game month and after skips, and swallows network errors so the game never waits on the server.
- The desk shows the Gemini recap under the recovery card when it arrives; without it, the static lesson stays.

## 5. Error handling

- Server unreachable or 5xx: the client drops the batch after logging once to the console; the sim is the source of truth.
- Gemini failure: the desk keeps its built-in lesson text.
- Twins with no buys: value 0, and the chart shows only the You line until the first buy.

## 6. Testing

- `game/tests/twins.test.ts`:
  - Buy and never sell: You equals Held; Autopilot has the same total dollars in.
  - Sell everything at the AI pop's bottom, then run to recovery: Held ends above You.
  - `bear_market` fires once per drawdown and re-arms after a new peak.
  - Recording the same day twice keeps one snapshot.
- Server: extend `snapshot.test.ts` for the Zod schema (held/autopilot optional, non-finite rejected); a mocked-fetch test for `generateCrashRecap` parsing and rotation.
- Verification: `npm test` and typecheck in `game/` and `server/`, then the real desk in a browser: skip to the AI pop, answer the popup, skip to recovery, check the lines and that rows land in Tiger Data.
