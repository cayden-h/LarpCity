# Save, profile, and connected apps

Status: approved design, 2026-09-12.

## Problem

The owl intake is only kept in the browser (`localStorage["larp.intake.v1"]`) and never reaches the server.
Game progress is never restored: every page load builds a fresh `PlayerLife` on day 0 and starts a new server run, whose id lives only in `RunRecorder` memory.
Several surfaces show mock or dead data: the Stocks app's frozen FRED watchlist, the unanswered `/api/market/quotes` fetch, the placeholder News, Mail, and Bank apps, and the standalone `/debt.html` sample household.

## Goals

- A player who closes the tab and comes back on the same browser resumes on the same game day with the same money, holdings, debts, orders, and inbox.
- The confirmed intake is a server-side profile.
- Every phone app and the Money desk read the one live, saved life.
- The data model is ready for account creation, which comes next: an account will point at an existing `players` row, so saves and profiles need no change.

## Non-goals

- Accounts, login, and cross-device resume (next project).
- Multiple save slots in the UI (the schema allows them).
- Rewind or replay from a decision log.

## Approach

Full-state snapshot.
Each stateful sim class gets an encode/decode pair; the whole game encodes to one JSON document stored in one database row per player.
A decision log (replay from seed) was rejected: it would route about 25 mutation sites through a new decision system, and loading a 30-year life would re-simulate about 11,000 days for the player and every NPC.
Rebuilding from `player_snapshots` was rejected because those rows hold only balances.

## Data model

Additive, idempotent statements in `server/src/migrations.sql`.
Everything keys on `players.id`, which today comes from the `larp_session` cookie and later from an account.

`profiles`, one row per player, the confirmed intake:

| column | type |
| --- | --- |
| `player_id` | uuid primary key, references `players` |
| `display_name` | text, nullable |
| `job` | text |
| `salary`, `rent`, `debt`, `savings` | numeric |
| `state` | text (two-letter abbreviation) |
| `source` | text: `voice`, `typed`, or `skipped` |
| `created_at`, `updated_at` | timestamptz |

`saves`, one row per player and slot:

| column | type |
| --- | --- |
| `player_id` | uuid, references `players` |
| `slot` | text, default `'main'` |
| `run_id` | uuid, references `runs` |
| `seed` | bigint |
| `version` | int, the save format version |
| `game_day` | int |
| `state` | jsonb |
| `rev` | int, bumped on every write |
| `updated_at` | timestamptz, informational |

Primary key `(player_id, slot)`.
The server treats `state` as opaque: it checks only a size cap and that `version` is an integer.
Only the game knows the shape, so the sim's types are not duplicated on the server.

`runs` is unchanged.
A save points at its run, so snapshots, events, history, the newspaper, and the leaderboard continue one run across reloads.

## API

New `server/src/routes/save.ts`, using `handle`, `parse`, and `HttpError`, keyed by the session's player:

- `GET /api/me` returns `{ player, profile, save }` (profile and save may be null).
- `PUT /api/profile` upserts the confirmed intake.
- `PUT /api/save` takes `{ runId, seed, version, gameDay, state, baseRev }` and returns the new `rev`.
  `baseRev` is null for a new life's first save.
  If the stored `rev` is not `baseRev` (or a save already exists when `baseRev` is null), it returns 409 so a second tab (or, later, a second device) cannot silently overwrite progress.
  The `runId` must belong to the player.
- `DELETE /api/save` removes the save and the profile, for "New life".

## Game: save format

`game/src/sim/save/`:

- `codec.ts`: `encodeGame(game): SaveState` and `decodeGame(state, seed): Game`, plus `SAVE_VERSION`.
- Encode/decode functions next to each stateful class: `Ledger` (accounts map, pending, history, seq), `Twins` (invested, cashOut, held and autopilot units), `PlayerLife` (book, place, age, pay, job, orders, recurring, today, history, private fields such as `lastFirst` and `ltmPeak`), and `NpcTown`.
- The clock day, the Money desk's local state (feed, bank statement, crash, recovery, and the recovery lesson), and the Mail inbox are part of `SaveState`.
- `restoreGame` decodes the life, the NPC town, and the inbox together and exercises the life once; any failure is a `SaveFormatError`, so a save loads whole or not at all.
- `MarketPath` is not stored; it is rebuilt from the seed.
- An unknown `version` decodes to an error the boot flow handles, never a crash.
- Saved `history` is compacted: every day in the last 400 days, and every 7th day before that; NPC lives keep their last 30 days.
  The server caps `state` at 1.5 MB.

## Game: boot flow

In `game/src/main.ts`:

1. `GET /api/me`.
2. Save present: decode it into `PlayerLife`, `NpcTown`, and the clock; `RunRecorder` resumes the saved `runId`; skip the intake; the owl greets the player by name with the game date.
3. Profile but no save: build the life from the profile (`lifeFromIntake`) on day 0.
4. Neither: run the owl intake; on confirm, `PUT /api/profile`, then build the life.

`localStorage["larp.intake.v1"]` is removed; the server is the source of truth.
`?intake=1` stays as a dev override.

Standalone `/debt.html` uses the same `GET /api/me` and loads the saved life.
With no save it links to the city to do the intake instead of showing the sample household.

## Game: autosave

A `SaveManager` in `game/src/sim/save/manager.ts` saves:

- after every player decision: trade, payment, transfer, card application, move, employment change, standing-order or recurring-buy change;
- on each new game month, so long fast-forwards save too;
- after a skip finishes;
- on `pagehide` and `visibilitychange` to hidden, with `fetch(..., { keepalive: true })`.

Writes are debounced so a burst of decisions sends one request.
The Money desk calls the same manager through `window.larpMoney`, so decisions made in the desk window save too.
The `pagehide` save uses `keepalive` only when the body is under the browser's 64 KB keepalive limit; otherwise the last decision or month save stands.

## Failure handling

- Server unreachable at boot: play a fresh, unsaved life and show an "Offline, not saving" chip in the HUD.
- Save fails mid-game: retry with backoff and show the chip; never drop a save silently.
- 409 on save: stop autosaving and show "This life is open somewhere else. Reload to continue."
- Unknown save version: offer "Start a new life".

## Connected apps

- **Stocks**: the Markets list and home widget show `player.market` on the current game day (LTM, BOND, NNST, sponsor stocks) with the day's change and a 30-game-day sparkline.
  The `/api/market/quotes` fetch is deleted.
  Any rates the sim does not model stay, labeled "real rate, as of <date>".
- **News**: a pixel newspaper for the last game month from `POST /api/news`, cached per game month, with the server's template fallback.
- **Mail**: an inbox built from `LifeEvent`s, saved with the game, with an unread badge on the phone icon; a decision mail opens the Money desk on that decision.
  Letters come from: pay stubs, a rent or living-costs bill that came up short, missed payments, late marks, penalty rates, collections, repossession, loan default, a debt paid off, credit score moves of 10 points or more, moves, layoffs and rehires, and market recoveries.
  Decision letters come from a payment the player can't cover, bankruptcy eligibility, and a bear market.
  A paycheck writes a pay stub only when pay changes: the first paycheck, a take-home change of more than $1, garnishment starting or stopping, or unemployment starting or ending.
  Routine days (a bill paid in full, a normal payment) send nothing; there are no statement or bills-due letters.
  The inbox keeps 200 letters, evicting read routine letters first and decision letters last, and a rewind drops the letters after the day it lands on.
- **Bank**: the player's Nessie mirror statement from `GET /api/bank/:entity`, falling back to the server's local mirror.
- **Profile everywhere**: the HUD card shows name and job; the coach and newspaper read the profile from the database on the server; the owl greets returning players by name.
- **New life**: a Timeline app button that confirms, calls `DELETE /api/save`, and reruns the intake.

## Testing

- Round-trip test in `game/tests/`: for several seeds and intakes, play decisions and skips, save and restore at random days, continue N days, and assert the restored game equals an unsaved control (every balance, event, and score).
- Codec edge cases: `Map` state, bankruptcy, an unknown version.
- Server database tests: profile and save upserts, 409 on a stale `baseRev`, the size cap, and that one player cannot read or write another's save or run.
- End-to-end in the browser: intake, play a few months with a trade and a card application, reload and see the same day and money; open standalone `/debt.html` and see the same life; open two tabs and see the conflict notice; stop the server and see the offline chip.
