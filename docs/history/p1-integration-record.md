# extraP2: P1 integration record (resolved)

The P2 plan assumed a "P1: Player Identity" milestone had already merged. It hadn't. This file
originally inventoried the placeholder P2 built to stand in for it (a free-text name, a two-emoji
male/female avatar toggle) and what to change once P1 landed.

**P1 has since merged into `main`** (`Merge branch 'p1'`, commit `6199961`). Its actual avatar
system turned out to be almost identical in shape to P2's placeholder — a fixed male/female preset
with no further customization, the same 🧑/👩 emoji, chosen on its own dedicated onboarding screen
before the money form. The reconciliation is done; this file now records what changed and what, if
anything, is still open.

## What was reconciled

Both branches independently added an `avatar: "male" | "female"` field to `IntakeAnswers`,
`LifeOptions`, `LifeSave`, and `PlayerLife`. Kept P1's copy everywhere (it owns the concept now,
including default age 22, the fixed 600 starting credit score, and the whole 6-screen onboarding
sequence — Plaid mock, avatar, insurance, beginner card, sliders, expenses). Removed P2's
duplicate declarations and its own redundant avatar picker.

**`src/ui/intake.ts`** — P2's goal screen used to have its own avatar toggle
(`avatarChoice`, `data-avatar`, `pickAvatar()`) in addition to the goal sliders. Removed entirely:
P1's dedicated avatar screen (`avatarScreen()` / `chooseAvatar()`, shown right after "Talk to the
Narrator" / "Type it instead") already asks this once, earlier in the flow, and `finish()` already
read from `this.avatar` (P1's field) when building the final answers — so nothing downstream
needed to change once the duplicate was removed. The goal screen (now: name + the 4 goal sliders +
the marriage flavor toggle) is inserted after P1's expenses screen and before `finish()`, matching
its original "right before finish" design intent, now at the *end* of P1's longer onboarding
sequence rather than immediately after the money form.

**`src/sim/life/intake.ts` / `src/sim/life/player.ts`** — merged the two `IntakeAnswers`/
`LifeOptions`/`LifeSave` field lists (P1's `insurancePlanId`/`selectedCardId`/`expenseTiers`/etc.
alongside P2's `name`/`goals`), keeping exactly one `avatar` field throughout. `completeAnswers`
now validates money fields AND the 4 required goals, and carries every P1 optional field through
unchanged. `answersFromProfile` still returns `DEFAULT_GOALS`/`name: "You"` for a resumed profile
(a server profile stores neither goals nor P1's onboarding extras).

**`tests/main-home-sync.test.ts`** (pre-existing, unrelated to either P1 or P2) — sandboxes a slice
of `main.ts`'s orchestration code in a VM context with a hand-built mock of every external object
it touches (`phone`, `narrator`, `saver`, etc.). It didn't yet mock `hud`/`happiness`, which P2's
final-review fix wave started calling from inside that slice (`hud.setPlayer(...)` on every day
tick, `happiness.update(...)` on rewind). Added minimal mocks (`hud: { setPlayer() {} }`,
`happiness: { update() {} }`) alongside the existing ones — no production code changed.

Final state: 699/699 tests passing, `tsc --noEmit` clean, `npm run build` clean.

## What's still open (unchanged from before, not P1-blocked)

The happiness meter's 3 expression faces (`src/ui/happiness.ts`) remain deliberately
**gender-neutral pixel faces**, not crossed with `avatar`. Now that P1's confirmed to be a
permanent 2-preset system (not evolving toward richer character art), this is very likely the
final shape — but if a future milestone ever adds real per-character art, the same two options
from before still apply: keep the mood face and the avatar portrait as two separate HUD elements
(the current setup), or key `happiness.ts`'s `ICON_FOR` by `[avatar][expression]` instead of just
`[expression]` to show mood on the player's own character.

`This file` can be deleted once this record is no longer useful — nothing in it is a live TODO.
