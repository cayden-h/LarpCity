# Larp City - Game Design Meeting (2026-09-11)

Decisions from the team's game design meeting on Friday night of HackRice.
Sources: the team's AI meeting notes (kept verbatim at the bottom) and the Granola notes for the meeting (https://notes.granola.ai/t/5ae65b87-db4a-4f75-887e-deb43fba1331).
Where these decisions conflict with the earlier research docs, this file wins.
The later revamp meeting ([meeting-2026-09-13-revamp.md](meeting-2026-09-13-revamp.md)) wins where it conflicts with this file (for example the preset avatar, and going back only in the end-of-game review).

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
  (Removed on 2026-09-12 in favor of fast-forwarding to goals; see "Follow-up decisions" below.)
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
- Run speeds were decided on 2026-09-12 (see "Follow-up decisions" below): normal speed is now 1 week every 5 seconds, with a 2x and a +1 month button.

### Follow-up decisions (2026-09-12)

These replace the earlier notes where they conflict.

#### Speed controls

- The HUD speed controls are exactly: pause, 1x, 2x, and +1 month.
  They stay where they are on the HUD today.
- 1x is 1 in-game week every 5 real seconds (the old 2x): about 0.7 s per day, 4.3 min per year, and about 3 hours for 40 years.
- 2x is 1 week every 2.5 seconds (the old 4x).
- The old 4x button and the +1 week button are removed.

#### Calendar in the phone

- The phone gets a Calendar app with a year view, styled like a standard 12-month calendar grid.
- **Red circle** around a date: an event (market, world, or life event).
- **Blue circle** around a date: a big decision, a milestone, or a goal reached.
- Upcoming dates are circled only for scheduled things: bills and loan payments, the preset AI Bubble Pop, and goal dates the forecast reaches.
  Random events (a layoff, a medical bill) stay hidden until they happen.

#### Review and rewind

- Tapping a past circled date opens a review of that day: what happened, what the player decided, the outcome, and a recommendation for how to handle it better next time.
- **The player can change a past decision.**
  This lets them see the actual truth of what works, on the same market and the same luck, so they learn which choices they can trust.
- Changing a decision rewinds time to that date and re-runs the seeded engine with the new choice, and the player keeps playing the new branch.
- The old path stays as a ghost line on the charts, so "what I did" and "what I changed" can be compared side by side.
- Rewinds are unlimited: any red or blue circled date can be changed any number of times.
- Because random draws are keyed by seed and date, changing a choice never changes the market or which events happen, only their effect on the player.

#### Skip to next event

- "Skip to next event" jumps to the next red circle on the calendar, plays that event's animation, and shows the outcome based on the player's current and forecasted situation.
- A random event that happens before the next scheduled one stops the skip there instead, the same way bankruptcy does.

#### News during skips

- Every event that happens during a skip goes into the news.
- After a skip or an event, a newspaper unfolds full screen over the city with a paper effect.
- The paper is then kept in the phone's News app so the player can reread it.

#### Scoring and win condition

The final score is a mix of two parts:

- **Retirement readiness:** net worth and retirement savings, credit score, and debt.
- **Wellbeing meter:** marital status and relationships, financial stability, salary and job, how close the player is to retirement, and other life factors still to be listed.

#### Demo timeline

- There is no demo button or special demo mode.
- Every run has the AI Boom and then the AI Bubble Pop preset to fixed dates on the calendar, so both always show up in the demo.
  The exact dates are still to be picked.
- All other events stay random.

#### Fast-forward to goals (the age teleport is removed)

- **The age teleport ("jump from 24 to 60") is removed entirely.**
  Long stretches are covered by fast-forwarding to a goal (buy a house, move states, become debt-free, retire), plus 1x, 2x, +1 month, and "skip to next event".
- The calendar and unlimited rewind stay.
- Before a goal fast-forward, a setup screen lets the player change their standing inputs, starting with the recurring investment deposit and the settings around it.
  The screen is pre-filled with the player's current habits ("What you're doing now"), not the recommended settings.
- Those inputs decide the choices the fast-forward passes through; bankruptcy and reaching the goal stop it.
- The AI Bubble Pop does not interrupt a fast-forward; the pre-set "hold" rule decides it and the newspaper digest tells the story.
- The proposed input list, the other interrupts, and the hackathon-sized version are in [research/10-teleport-and-goal-skips.md](research/10-teleport-and-goal-skips.md); read its teleport parts as applying to goal fast-forwards only.

#### Scoring is for learning

- The score always reflects the player's current branch: what they changed and where they stand now.
- Rewinds are never penalized, because Larp City is a learning game and players are supposed to get better.
- Every rewind branches off the path the player left (which stays as a ghost line), so they can see and compare what changed.

#### Onboarding inputs

- Onboarding asks for gross salary, current age, job category, marital status, and location.
- The game infers a job level (for example entry, mid, senior) from the salary and real salary ranges for that job category.
- From the category and level, the game projects a realistic future salary path (raises, promotions, plateaus, layoff risk) from real salary progression data.
  This is being researched in [research/11-jobs-and-salary-progression.md](research/11-jobs-and-salary-progression.md).

#### Wellbeing research

- The remaining wellbeing factors and their weights should come from real data, not guesses.
  A data-backed proposal (9 weighted factors, and a final score of 60% retirement readiness and 40% lifetime wellbeing) is in [research/09-wellbeing-meter.md](research/09-wellbeing-meter.md), not yet decided.

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
- [x] **Define the event system (gacha / random events)** and how it works with the time skips, the "skip to next event" button, the age teleport, and goal skips.
  Answered in the 2026-09-12 follow-up decisions (the age teleport was removed; the details of goal fast-forwards are proposed in research/10).

## How this changes the earlier research

- **Daily ticks, not weekly.**
  The market calibration in [research/03-stock-market-and-simulation.md](research/03-stock-market-and-simulation.md) is written per week.
  At a daily tick it converts to about 252 trading days a year: daily drift is the weekly drift divided by 5, and daily volatility is the weekly volatility divided by the square root of 5.
  Event probabilities convert the same way: `dailyProb = 1 - (1 - annualProb) ** (1/365)`.
- **Skips reuse the seeded engine.**
  Because the market and events come from a seeded, decision-independent path, the age teleport is just the same tick loop run headless, with the teleport inputs acting as the player's standing decisions.
  Since 2026-09-12 this applies to goal fast-forwards, because the age teleport was removed.
  Decision events during a skip get auto-resolved by those inputs, except bankruptcy, which stops the skip.
- **One player life.**
  This answers most of the old "focus citizen vs. all 50 NPCs" question: the game is about the player's own life.
  Whether the ~50 NPCs stay as a city backdrop is still open.
- **Retirement is in scope,** which answers the old "20-year career from 25 to 45" question: the game runs from the player's current age to retirement.
- **No preset jobs.**
  The player enters their own salary; the BLS occupation wages in the states research are still useful for estimating a new salary after a move.
- **Life events join the event table:** layoff (already there), marriage, divorce (with a prenup decision), and kids as a cost-of-living change.

## Still open

- Answered 2026-09-12: events during skips (they go into the news, and "skip to next event" follows the calendar's red circles), scoring, rewind (unlimited; changing a past decision starts a new branch), run speeds, and demo seeds (a preset AI Bubble Pop date).
- The exact dates of the preset AI Boom and AI Bubble Pop (both are preset; the dates come later).
- Approving the wellbeing factors, weights, and 60/40 score split proposed in research/09.
- Approving the pre-skip setup inputs and the skip interrupt list proposed in research/10 (for goal fast-forwards; the age teleport was removed on 2026-09-12).
- The job categories, level inference, and salary progression model (research/11).
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
