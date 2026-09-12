# Larp City - Game Design Meeting (2026-09-11)

Decisions from the team's game design meeting on Friday night of HackRice.
Sources: the team's AI meeting notes (kept verbatim at the bottom) and the Granola notes for the meeting (https://notes.granola.ai/t/5ae65b87-db4a-4f75-887e-deb43fba1331).
Where these decisions conflict with the earlier research docs, this file wins.

## Decisions

### Game overview

- Retirement is the end goal.
  "Just die" was floated as an alternate ending, but retirement stayed.
- The player lives one life, their own, and learns different ways of handling money along the way.
- The game is personalized: players enter their real finances, so the challenge scales to them.
  Players who just want to play can make up a scenario instead.
- Preset jobs and salaries were rejected.
  Even high earners can be financially illiterate, so a preset isn't needed to make the game hard.

### Calendar and time scaling

- The default pace is daily, like Stardew Valley.
  This replaces the one-week tick from the research.
- Time skips: fast-forward to the next day, week, or month.
- A "Skip to next event" button, so players don't skip past live events.
- A future-age teleport: jump ahead to a chosen age, for example from 24 to 60.
  - Inputs: annual contribution, current return rate, bond allocation, and so on.
  - The skip still runs the event (gacha) system along the way.
  - While skipping, the player sees the news for events during the skipped years, portfolio highs and lows, best cases, and an overall score.
  - If the player goes bankrupt before the target age, the skip stops at the bankruptcy year and explains why.
    The player can look at their stock portfolio and housing situation as they were at bankruptcy.

### Speed, skipping, and news (follow-up, same night)

- **Normal speed: 1 in-game week every 10 real seconds.**
  The calendar still ticks daily, so a day passes about every 1.4 seconds.
  That makes a year about 8.7 minutes and 40 years about 6 hours, so normal speed is for living through the moments that matter, and skipping is how players cover decades.
- **Skipping** is a first-class control, not a cheat:
  - Next day, next week, next month.
  - Skip to next event, which stops when something needs a decision.
  - Skip until a goal is met.
  - Teleport to a future age.
  Every skip stops early for bankruptcy and for major events that need a decision.
- **Detailed news.**
  Each story in the newspaper says what happened, where it happened (which state, city, or sector), and what it affects for the player (their stocks, job, rent, or their state's cost of living).
  A story about a hurricane in Florida matters more if you live in Miami or own Florida real estate; a chip shortage matters if you hold the AI stock.
  After a skip, the paper is a digest of the skipped stretch: the biggest stories, portfolio highs and lows, and what changed for the player.
  The newspaper reports; the AI feedback coaches (see below).
- Still to decide: whether there are faster run speeds beyond 1 week per 10 seconds (for example 2x and 4x), or whether the skip buttons cover that.

### Goals and milestones

- The player sets goals such as buying a house or moving to another state (for example "enough money to move to San Francisco", with cost of living factored in).
- The game works out the realistic amount needed and the age or year when the goal becomes reachable.
- The player can skip ahead until a goal is met, and the game shows the year and why it was reached.
- Goals double as milestones.
- On retirement, the player can travel back through their milestones to see how they got there, with a stock portfolio snapshot at each one.
  The team called this "extra", so it is a stretch goal.

### AI feedback

The AI gives feedback at three kinds of moments, not after every event (every event was considered and rejected as too frequent):

- **Goal reached (and end of game):** tips and tricks, like "You could have reached this sooner if you had done X."
- **Bankruptcy:** what went wrong and what could have been done differently.
- **Big portfolio swings, up or down:** for example one stock goes crazy, so the AI prompts the player to diversify, even when the swing was a lucky gain.

The newspaper is separate from feedback.
It sums up what happened over the past few days.

### Life-changing events

Life-changing events are personal, and they are separate from general market or world events such as a pandemic.

- Laid off.
- Married / family.
  - Divorce, with a prenup as an in-game option.
  - Kids add to cost of living rather than being tracked separately; kids' schooling won't be modeled in detail.
- Car crashes were rejected ("not a car crash simulator").

### Cost of living

- Three tiers: low (LCOL), medium (MCOL), high (HCOL).
- Moving states changes cost of living, so we need per-state data to place each state in a tier.

## Next steps

No owners were assigned in the meeting.

- [ ] **Research cost-of-living data by state** and map every state to LCOL / MCOL / HCOL.
  A head start already exists: [research/02-states-cost-of-living.md](research/02-states-cost-of-living.md) lists the free data sources, and [research/data/states-sample.json](research/data/states-sample.json) has 5 sample states.
- [ ] **Define the event system (gacha / random events)** and how it works with the time skips, the "skip to next event" button, the age teleport, and goal skips.

## How this changes the earlier research

- **Daily ticks, not weekly.**
  The market calibration in [research/03-stock-market-and-simulation.md](research/03-stock-market-and-simulation.md) is written per week.
  At a daily tick it converts to about 252 trading days a year: daily drift is the weekly drift divided by 5, and daily volatility is the weekly volatility divided by the square root of 5.
  Event probabilities convert the same way: `dailyProb = 1 - (1 - annualProb) ** (1/365)`.
- **Skips reuse the seeded engine.**
  Because the market and events come from a seeded, decision-independent path, the age teleport is just the same tick loop run headless, with the teleport inputs acting as the player's standing decisions.
  Decision events during a skip get auto-resolved by those inputs, except bankruptcy, which stops the skip.
- **One player life.**
  This answers most of the old "focus citizen vs. all 50 NPCs" question: the game is about the player's own life.
  Whether the ~50 NPCs stay as a city backdrop is still open.
- **Retirement is in scope,** which answers the old "20-year career from 25 to 45" question: the game runs from the player's current age to retirement.
- **No preset jobs.**
  The player enters their own salary; the BLS occupation wages in the states research are still useful for estimating a new salary after a move.
- **Life events join the event table:** layoff (already there), marriage, divorce (with a prenup decision), and kids as a cost-of-living change.

## Still open

- The exact event system behavior during skips (see next steps).
- How much of the milestone replay to build.
- Whether the ~50 NPCs stay in the city as a backdrop.
- How much life detail to model beyond the cost-of-living tiers.

## Original AI meeting notes (verbatim)

```markdown
# Game Overview

- Retirement is the end goal
- Throughout the game, players learn different ways of handling their finances
- Keep it personalized: players input their own real finances so the challenge scales to them
  - Rejected preset jobs/salaries: even high earners can be financially illiterate, so presets aren't needed

# Calendar and Time Scaling

- Daily pacing (Stardew Valley style) as the default
- Time skip options:
  - Fast-forward to next day, week, or month
  - "Skip to next event" button so players don't miss live events
- Teleport/skip-ahead feature: jump to a future age (e.g., 24 to 60)
  - Inputs: annual contribution, current return rate, bond allocation, etc.
  - If bankrupt before the target year, game stops at bankruptcy and explains the reasons
  - Player can view stock portfolio and housing situation at time of bankruptcy

# Goals and Milestones

- Player can skip ahead until a goal is met; game shows the year and why the goal was reached
- Example goals: buy a house, move states (cost of living factored in)
- Goals function as milestones
- On retirement, player can travel back through milestones to see how they got there
  - Includes stock portfolio snapshots at each milestone

# AI Feedback

- Triggered at:
  - Goals: "You could have reached this sooner if you did X" (tips and tricks)
  - Bankruptcy: what went wrong and what could have been done differently
  - Big portfolio swings (up or down): e.g., one stock goes crazy, prompt to diversify
- Newspaper: summary of what happened over the past few days, not the feedback mechanism

# Quick-Time Events and Life-Changing Moments

- Life-changing events (distinct from general market/pandemic events):
  - Laid off
  - Married/family
    - Divorce (prenup as an in-game option)
    - Kids (cost factored into cost of living rather than tracked separately)
- Cost of living tiers:
  - Low (LCOL), Medium (MCOL), High (HCOL)
- States: need to research cost-of-living differences per state

# Next Steps

- **Research cost-of-living data by state**
- **Define the event system (gacha/random events) and how it interacts with the time-skip and goal-skip features**
```
