# House completion progress

The worktree is `../larp-home-completion`, branch `codex/home-completion`, based on merged roads and pixel-pipeline work at `94e60a5`.
The other session's `larp-houses` worktree and the shared main checkout were left untouched.

## Scope

Milestones 1 and 2 of the approved Blender houses spec: 16 SF house models in four facings, six shared hero homes, tinted walls and complete residential placement, six distinct home lots, and a real home picker backed by housing transactions.
Saves, rewind, named residents, road traffic, and the Money desk are preserved.

## Status: complete, pending PR review

- Art: 107 SF sprites (43 landmark and commercial, 64 houses), 24 hero-home sprites, and 8 property signs, each with day, night, and wall layers.
  All three catalogs pass `check_register.py` with zero errors; `check_houses.py` passes all 22 models; 108 Python art tests pass.
  Every house sprite was rendered after the final geometry change; contact sheets were reviewed at 1x and 4x.
- Game: `npm run build` passes and `npm test` passes 607 of 607.
- Server: `tsc` passes and `npm test` passes 151 of 151, including the database tests, against a local TimescaleDB (never the shared Tiger Data).
- Browser (local server on `larp_dev`): downtown, the Sunset, Alamo Square, Golden Gate Park, the suburb ring, and the Marin headlands, by day and night, at zooms 1, 2 to 2.5, and 4.
  The picker opens from clicking a home lot and shows all six homes with their costs and qualification reasons.

## Fixes made in the final review

- `stucco-3` (flat roof with a planter) painted its whole roof with the wall tint because the parapet was one solid box; it is now a parapet ring around a tar roof.
- Property signs were lot-wide billboards nearly as tall as the small house and hid the house fronts; they are now small corner yard boards with 3x5 pixel lettering, still readable at 1x.
- Home lots could be hidden: the Alamo Square townhouse stood directly behind the Painted Ladies, and the midtown studio was buried behind office blocks.
  The planner now rejects a lot with a landmark standing in front of it, and filler buildings in front of a home lot are capped at 2 floors, rising one floor every 3 rows, out to 8 rows.
- A new test covers the upcoming starting player (22, SF, $45K salary, $25K card debt, $500/month car loan, 600 score, $4K saved): the studio is affordable, and every purchase is locked with the score-floor, 43% DTI, and cash reasons.

## Deviations from the spec

- SF's Alamo Square townhouse lot moved from (29, 26) to (29, 24), two tiles north, so the Painted Ladies landmark no longer hides it.
- The spec says the HUD card and the lot both open the picker; the lot click is the primary entry and does not depend on the HUD card, which is expected to become a player ID card.
- Home value stays flat and property tax and insurance are one combined estimate, as the spec allows.
- The procedural brick fallback remains for cities without residential sprite catalogs and for missing assets; SF has full residential coverage (tested for seeds 1, 7, and 42).
- Contact sheets (`game/art/_contact-*.png`) are local review output and are ignored by git.

## Compatibility with planned changes (2026-09-13 meeting)

- Player ID card: the picker opens from `scene.onHomePick` on a lot click, independent of the HUD.
- Buying as a long-term goal: purchases go through `PlayerLife.quoteHome` and `chooseHome`, which a Goals entry can call without UI changes.
- Save slots and hidden rewind: home state is part of `PlayerLife.toSave`, the whole-game codec, and `LifeTimeline` checkpoints, and is covered by tests.
- Weather and travel removal: nothing new was built on `setPlace`; its existing sell-and-rent behavior is kept and tested.
- Future events: eviction, foreclosure, and bankruptcy move the player to the tent through `home` events, which the Money desk turns into a recovery decision.
