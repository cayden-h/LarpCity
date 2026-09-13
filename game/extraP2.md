# extraP2: work P2 stubbed out because "P1" was never built

The P2 plan (`docs/superpowers/plans/2026-09-13-p2-goals-phone-ui.md`) said it "Depends on
P1: `LifeOptions.age` (player ID card), P1's onboarding output feeding the 4 goal choices at
intake" and told P2 to "rebase onto P1's merged commit before starting."

When P2 actually started, no branch, commit, or plan file for a "P1: Player Identity" milestone
existed anywhere in this repo (checked `git log --all`, `docs/superpowers/plans/`, and the
codebase itself). Two of the three things P1 was assumed to deliver turned out to already exist
independently:

- `LifeOptions.age` / `PlayerLife.age` — **already existed**, unrelated to P1. Nothing to do here.
- The 4-goal onboarding flow, goal tracking, and progress bars — **P2 built this itself**
  (`sim/skip/types.ts`'s `Goal` union, `sim/skip/goals.ts`'s `isMet`/`priceTag`/`progressOf`, the
  intake goal screen, the phone's Goals app view). Nothing further depends on P1 here either.

What P1 was actually expected to deliver and never did: **a player name and a real avatar/character
identity system.** P2 needed *some* value in those fields to build the HUD ID card and the
happiness meter's avatar, so it added the smallest possible placeholder rather than block. This
file is the inventory of that placeholder and exactly what to replace when P1 (or whoever owns
player identity) actually gets built.

## What P2 built as a stand-in

**`IntakeAnswers.avatar: "male" | "female"`** (`src/sim/life/intake.ts`) — a binary choice with no
real character art behind it. Threaded through `LifeOptions`/`LifeSave`/`PlayerLife` exactly like
`name` (see below), same optional-with-`??`-default pattern as every other "GameEngine addition"
in `player.ts`.

**The picker UI** (`src/ui/intake.ts`, the onboarding goal screen, around line 434 "Goals (name,
avatar, and the 4 permanent goals)"): two buttons showing raw emoji, no styling beyond the existing
`.in-toggle-opt` pixel-button chrome:
```ts
<button type="button" class="in-toggle-opt active" data-avatar="male" role="radio" aria-checked="true">🧑</button>
<button type="button" class="in-toggle-opt" data-avatar="female" role="radio" aria-checked="false">👩</button>
```
The comment directly above it says as much: `/** Toggles the pixel avatar picker; a placeholder
for a future real character. */`

**Everywhere the emoji gets shown back to the player** — there is exactly one lookup table, and
everything reads from it:
```ts
// src/ui/hud.ts
/** Matches the avatar picker in intake.ts so the same pixel character shows here. */
const AVATAR_EMOJI: Record<"male" | "female", string> = { male: "🧑", female: "👩" };
```
used in `Hud.setPlayer()`'s `this.q("[data-player-avatar]").textContent = AVATAR_EMOJI[avatar];`,
which fills the HUD ID card's avatar slot (`<div class="id-card-avatar" data-player-avatar></div>`,
`src/ui/hud.ts` around line 33).

**`IntakeAnswers.name: string`** — a plain text input, defaults to `"You"` if left blank
(`completeAnswers` in `src/sim/life/intake.ts`: `name: p.name?.trim() || "You"`). This one is a
reasonable placeholder even long-term (a typed name field is fine) — it's listed here for
completeness, not because it needs replacing, unless P1's real design wants something richer
(e.g. name validation, profanity filtering, a character limit beyond what the form already
enforces).

**The happiness meter's 3 expression faces** (`src/ui/happiness.ts`) are deliberately
**gender-neutral pixel faces** (`face-happy`/`face-neutral`/`face-sad` in `src/ui/pixel-icons.ts`'s
icon registry), not crossed with the `avatar` choice. This was an explicit scope ruling made while
building P2 (avoiding 6 face×gender combinations the plan never asked for) — see "What to decide"
below for what changes once real avatar art exists.

## Files to touch when P1's real avatar/character system lands

1. **`src/sim/life/intake.ts`** — widen `IntakeAnswers.avatar`'s type from the `"male" | "female"`
   literal union to whatever P1's real avatar identifier type is (a character id, a sprite-set key,
   etc.). `completeAnswers`'s default (`p.avatar ?? "male"`) needs a new default value matching the
   new type. `DEFAULT_GOALS`'s sibling defaults in `answersFromProfile` (`name: "You", avatar:
   "male"`) need the same update.
2. **`src/sim/life/player.ts`** — `LifeOptions.avatar?`, `LifeSave.avatar?`, and
   `PlayerLife.avatar`'s type all need the same widening, plus their `?? "male"` defaults (three
   call sites: the fresh-life constructor branch, the `saved` constructor branch, and nowhere
   else — `toSave()` just passes `this.avatar` through untyped).
3. **`src/ui/intake.ts`** — replace the two-emoji-button picker (search `data-avatar` — 3 call
   sites: the click handler, the reset-on-screen-open line `this.avatarChoice = "male";`, and the
   markup itself) with whatever real character-select UI P1 builds. Keep the same event contract
   if possible (`this.avatarChoice` feeding into `completeAnswers({..., avatar: this.avatarChoice,
   ...})`) so the rest of the pipeline doesn't need to change.
4. **`src/ui/hud.ts`** — replace `AVATAR_EMOJI` and the `id-card-avatar` div's `textContent`
   assignment with however P1 wants to render a real character portrait (an `<img>`, a sprite
   `pixelIcon`-style SVG, a Pixi texture reference, etc.). `Hud.setPlayer(name, age, avatar)`'s
   third parameter's type needs to follow the same widening as above.
5. **`src/ui/happiness.ts` / `src/ui/pixel-icons.ts`** — see "What to decide" immediately below.

## What to decide once real avatar art exists

The happiness meter currently shows one shared face per mood, independent of which avatar the
player picked. Once P1 delivers real character art, decide between:

- **(a) Keep it separate.** The happiness meter stays a small abstract mood icon (a face, a heart,
  a gauge — whatever), and the player's real avatar/portrait shows only on the HUD ID card. No
  code change needed to `happiness.ts` beyond whatever visual polish P1's art style calls for.
- **(b) Merge them.** The happiness meter becomes an expression *on the player's own character*
  (their real portrait with a happy/neutral/sad face baked in per character, or a mood overlay on
  top of the base portrait). This means `expressionFor`'s three states need three (or
  `3 × number-of-characters`) actual art assets, wired through `mountHappinessMeter`'s
  `deps: { life: PlayerLife }` (it already has `life.avatar` available, just isn't using it for
  icon selection — `ICON_FOR: Record<HappinessExpression, string>` in `happiness.ts` would need to
  become keyed by `[avatar][expression]` instead of just `[expression]`).

Neither is implemented; P2 deliberately scoped to (a)'s "do nothing extra" version to avoid
building character-crossed art that might not match whatever P1 ships.

## What is NOT blocked and does not need revisiting

- Goal types, progress tracking, the Goals app view, the retire/endgame flow — fully built by P2,
  no P1 dependency ever existed for these despite the plan's header claiming otherwise.
- `PlayerLife.age` and everywhere it's displayed (HUD ID card, Goals app price-tag text, the
  endgame screen) — pre-existing field, already correctly floored for display as of P2's final
  review fix wave. No P1 dependency.
- The happiness/wellbeing pulse system (`vacation`, `familyTime`, `triggerPulse`) — fully built,
  independent of avatar/name.
