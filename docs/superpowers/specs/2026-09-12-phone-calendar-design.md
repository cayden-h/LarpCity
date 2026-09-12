# Phone Calendar and Rewind

Decided with Cayden on 2026-09-12, from the mockups in `.superpowers/brainstorm/` (layouts A and C, and the flow screen).
It implements the meeting's "Calendar in the phone" and "Review and rewind" ([meeting-2026-09-11-game-design.md](../../../meeting-2026-09-11-game-design.md)), with the changes below.

## What the player sees

The phone's Timeline app becomes **Calendar** (same calendar icon).
It opens on the current month, styled like Google Calendar's month view in the pixel theme.

- Each day cell shows its date and up to two short labels ("chips"); more collapse into "+n".
- Past days are light and tappable. Today is the blue pixel square. Future days are grayed out.
- Red chips are money days and events: paydays, rent, living costs, card and loan payments, market moves, missed payments.
- Blue chips are the player's own decisions and milestones: a trade they made, a move, a debt paid off.
- Future days show only scheduled money (red): paydays, rent, living costs, and each open debt's due date.
- The **next decision day** shows as a yellow "?" chip. It never says what the decision is.
- Days before the game started are blank and can't be tapped.
- `‹ ›` move between months; the player can look ahead into future months.
- A speed strip at the bottom: pause, 1×, 2×. The +1 week and +1 month jumps are gone.

Tapping a day slides up a small sheet:

- **Past day:** what happened that day (with amounts), that night's net worth, and one button, "Go back to Oct 5".
- **Today:** what happened today. No button.
- **Future red day:** what's due and how much, and checking right now. No button: the player can't skip to it.
- **Decision day:** "Something will need your call this day", and one button, "Skip to Oct 27".

The back arrow zooms out to a **year view**: 12 mini months with the same colors (red, blue, yellow, today), and a row of year chips from the first year played to next year.
Tapping a month opens it; the back arrow there goes to the phone's home screen.

## Going back (rewind)

"Go back to Oct 5" really rewinds: money, debts, holdings, and credit return to exactly how they were on Oct 5, right after that day's paychecks, bills, and market moves and before anything the player did that day.
Everything after is erased from this run, the city pauses, and the player presses play when ready.
The market and random events replay identically (same seed), so only the player's choices can change the outcome.
If Oct 5 had a decision (a crash, a payment they couldn't cover), the Money desk opens on it again.
Rewinds are unlimited and never penalized. There is no ghost line (the meeting's comparison line) yet.

## Skipping to the decision day

"Skip to" plays the days as a time-lapse (at most about 2.5 seconds, however far away), and the decision opens the Money desk on arrival, the same way it does at normal speed.
The forecast looks up to three years ahead, which always reaches the preset AI Bubble Pop.

## Architecture

### Checkpoints (`game/src/sim/rewind/`)

- `copy.ts`: a deep copy that keeps class prototypes (so a copy of a `PlayerLife` still runs), copies Maps, arrays, and Dates, and shares the seeded `MarketPath` and functions.
- `PlayerLife` gains `log` (every event it emits, in order, beside `history`), `checkpoint()` (a detached copy of its state, with the lengths of the append-only `history` and `log`), `restore(cp)` (puts a copy of that state back into the same instance and truncates `history` and `log`), and `quietly(fn)` (runs days without notifying listeners).
  Restoring in place keeps every reference valid: the Money desk, the recorder, and the bank mirror all read through `life.`.
- `LifeTimeline` subscribes to a life and takes a checkpoint on the first emit of each game day (the `onDay` emit; later emits that day are the player's actions).
  `rewindTo(day)` restores the latest checkpoint at or before `day` and replays the days in between quietly.
  To bound memory, a checkpoint older than a window is dropped only if replaying from the previous kept checkpoint reproduces it exactly, and at least one is kept every 90 days.
  That keeps rewind exact even for desk actions that don't emit events, with no action log.
  Measured: a checkpoint is about 3 KB and takes about 0.01 ms.

### Forecast (`game/src/sim/calendar/forecast.ts`)

`nextDecisionDay(life, dateOf, horizon)` runs a detached copy of the life ahead until `needsDecision` fires (about 3 ms per simulated year).
Because the sim is deterministic, the calendar keeps the result until the life's day or its log changes (a new day, a trade, a rewind), then recomputes it.

### Calendar data (`game/src/sim/calendar/`)

- `marks.ts`: turns logged events into chips and sheet rows (label, color, amount), dropping noise (interest, recurring buys, statements).
- `schedule.ts`: scheduled money for any future day, from the life's pay, rent, living costs, and open debts' due days and payments.

### Rewinding everything else (`game/src/main.ts`)

- Clock: `jumpTo(day)`, paused.
- NPCs: each NPC life has its own `LifeTimeline` (short window), since they never react to the player.
- Recorder: flushes to the old run, then asks the server to fork it through the day before; the new run gets that day's snapshot and events, so the coach and the newspaper read the new branch. The old run stays on the server.
  Server: `POST /api/runs/:runId/fork { throughDay }` copies the run's snapshots and events up to that day into a new run for the same player and seed.
- Bank mirror: forgets the unposted months from the rewind day on; its "Transfers and other" entry already reconciles Nessie to the sim's balances.
- Money desk: `MoneyHost.onRewind` trims its feed, bank statement, and crash and recovery cards to the rewind day and re-renders.
- Phone: drops parked decisions, then parks that day's decisions again.

### UI (`game/src/ui/calendar.ts`, `calendar.css`)

A self-contained component mounted in the phone's app view, with its dependencies passed in (the clock, the life, `firstDay`, `rewindTo`, `skipTo`, and `onHome`).
It re-renders when shown, and the phone's once-a-second status tick redraws it whenever the day, the log, or the speed changed.

## Testing

Node tests (no DOM) for the copy, checkpoint and restore (exact state after a manual trade, after thinning, after a fast-forward), the marks, the schedule, the forecast (matches the first decision of a live run), the recorder fork (fake fetch), and the mirror rewind; a server test for the fork route's body and, with `TEST_DATABASE_URL`, the fork query.
Then an end-to-end pass in the browser: go back to a past day and check the money matches that day, skip to the decision day, and pixel-check every sheet.

## Changed during the build

- Chips are one short word (Pay, Rent, Bills, Card, Car, Loan, Buy, Sell), since a month cell fits about five letters at the phone's narrowest; the sheet says the rest.
- A card falls due on its statement's due day (the statement closes on its day of the month and is due `GRACE_DAYS` later), matching the debt engine, not on the day the statement closes.
- The months the player can page through reach the next decision day's month, which for the sample life is the crash after the AI Bubble Pop in November 2028.
- The decision day's sheet says how far off it is in days, then months, then years.
- The year row scrolls sideways instead of wrapping.
- Pixelify Sans had four glyphs whose openings close up at small sizes (2 read as 8, 5 as S, C and c as O and o); `game/scripts/fix_pixelify_glyphs.py` redraws them on the font's grid, and the pixel theme turns off its "fi" and "fl" ligatures, which read as "A".

