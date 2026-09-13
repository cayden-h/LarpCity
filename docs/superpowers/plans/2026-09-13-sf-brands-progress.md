# SF brands: progress

Spec: [2026-09-13-sf-brands-design.md](../specs/2026-09-13-sf-brands-design.md).
Plan: [2026-09-13-sf-brands.md](2026-09-13-sf-brands.md).

## Done

- Roster as data: `game/art/brands.py` holds all 37 brands (the 17 first brands, their hand-drawn art kept byte for byte, and the 20 new companies).
  `catalog.py` builds every branded entry from it, and `make_ads.py` draws every sign file the catalog names: by hand (`CUSTOM`) for the first brands, and with shared layouts and a mark library (`MARKS`) for the rest.
- New sign surfaces: wall boards on the blank right wall of low offices and lofts (`signs.wall_board`); HQ name bands over the lobby and across the top floor on both faces (`signs.name_band`); storefronts on 1x1 and 1x2 lots, each face taking the band that fits its span, with the bands repeated across the top floor; and HQs in any footprint.
- Placement (`brandLots` in `lots.ts`): branded buildings are placed before any generic lot, the hardest to fit first, each on the best free lot of its footprint.
  A sign face kept clear of the next lot and of landmark footprints comes first (painted walls and wall boards need their right face clear, storefronts one of their two faces), then the brand's area (`areas` in `san-francisco.ts`: SoMa and the Embarcadero), then towers toward the back of their zone and low buildings toward the front.
  Google, Meta, and Goldman Sachs, which never appeared before, now do, and every brand is placed on every tested seed.
- V boards stand on open ground beside the highway nearest downtown (`placeVBoards`, with `roadTiles`), or beside the four-lane arterials in a city with no highway, no longer on midtown lots.
- Palette: 60 day colors with 32 reserved for signs (was 40 and 12), rebuilt once for the whole SF set; the build's warning about merged brand colors is clear.
- Tests: `art/tests/test_brands.py` (art coverage both ways, letter contrast, capital heights at 1x per surface), `tests/brands.test.ts` (every brand placed once in its zones on three seeds, sign faces clear, area preference), `roadTiles` and `placeVBoards` tests, and the palette-warning test made independent of the slot count.

## Performance

Measured as in the [pixel world progress doc](2026-09-13-pixel-world-progress.md): Chrome, full SF world (seed 7), 40 synchronous renders with a one-pixel readback after each, canvas 1440 x 900 at device pixel ratio 2, midday.
Before is `origin/main` (6f2f426) served from a separate worktree in the same window; after is this branch.
Each column is the range of two runs after a warm-up run.

| Zoom | Before (ms per frame) | After (ms per frame) |
|---|---|---|
| Max zoom-out (0.47) | 7.29 to 7.33 | 6.76 to 7.33 |
| 1 | 5.65 to 6.04 | 5.53 to 6.11 |
| 2 | 5.00 to 5.07 | 4.51 to 5.00 |

Branded sprites replace generic ones one for one and the four V boards are the only added sprites, so frame cost stays within run-to-run noise.

## Browser check

Local server on :3117 and Vite on :5187 against the local `larp_dev` database, seed 7, at 0.72, 1, 2, and 4, by day, at night, and in rain and fog.
The 20 new companies, each read in the screenshots: Tiger Data, Vultr, Solana, Gemini, Backboard, GoDaddy, MathWorks, Presage, Stripe, Visa, Schwab, Robinhood, Plaid, Airbnb, Dropbox, Lyft, DoorDash, Ghirardelli, Blue Bottle, and Gap; so are the Google, Meta, and Goldman Sachs HQs that never appeared before.
At the default zoom the HQ top-floor bands, rooftop bulletins, wall boards, painted walls, and V boards read; the storefronts' top-floor bands read from zoom 1.
At night every lit band, board, and fascia glows in the night layer; painted walls stay unlit.

## Deviations from the spec

- HQ towers carry their name band twice, over the lobby (close up) and across the top floor under the parapet, because at the default zoom the towers in front hid every street-level band downtown (decided with Cayden after the first browser check); still no rooftop signs or crowns.
- Storefronts repeat their bands across the top floor, under the cornice: from the default camera, houses or towers across the street hide a ground-floor band. These are low buildings, not towers, so the tower-top rule is untouched; the first brands' shops (the Capital One Café, Wells Fargo, Jeni's) gained the upper bands too.
- The palette reserves 32 sign colors, not the spec's 24: at 24, and at 28, the build still warned that more than 5% of sign pixels landed far from every palette color.
- Placement goes beyond the spec's "area, then zone core": a clear sign face comes first (painted walls, wall boards, and shops were hidden by the building next door or a landmark), and towers stand toward the back, low buildings toward the front, so each brand faces the camera.
- Freeway placement uses road tiles, not a named `freeway` area; San Francisco's world has no highway (its outskirts set `beltway: false`), so its V boards stand beside the Embarcadero and the main avenue, SF's stand-in for the freeway.
- Goldman Sachs and Meta moved from 2x1 to 2x2 HQs, because downtown has only two 2x1 lots and the Capital One Café needs one; their sprite ids changed with the footprint.
- Gap's shop has five floors, not three: at three its top-floor band sat below the offices beside it.
- Blue Bottle's shop is 1x2 rather than 1x1, so its 2-tile side band spells the name; a 1x1 shop has only 1-tile bands, which carry just the bottle.
- The brand-colored entrance canopy was left out: the lit name band spans the facade right over the lobby entrance in the brand's color, which is the job the canopy was meant to do.
- Tiger Data's bulletin stacks its name on two lines ("TIGER / DATA") so its capitals reach 7 px; on one line they came out at 6.3 px.
- Backboard's wall board is its wordmark alone: with the pinned-board mark beside it the 9-letter name came out at 5.7 px on the 2-tile board, under the 6 px rule; without it, 6.9 px. The `board` mark stays in the library.
- HQ name bands carry the name alone (a mark beside it only shrank the width-bound lettering), and a 1-tile band carries the mark alone; MathWorks' band is 6.9 px, the most nine letters get across a 2-tile face, so the size test allows a tenth of a pixel.
- Blades are about 12 px wide on screen, so a roster blade carries the brand's mark (Blue Bottle's bottle) or a one-letter monogram (Gap's G, Schwab's S); the name reads on the shop's bands. A 1-tile band carries at most four letters (GAP), else the mark or the monogram.
- Ghirardelli is a solid painted panel (cream letters on chocolate brown, "GHIRAR- / DELLI" on two lines) rather than a faded ghost sign: at 7 px, eleven faded 1 px letters on brick broke apart in the pixel pass, where the Levi's sign's six letters hold. The ghost layout stays in `make_ads.py` for a short name.
- Lobby logo walls are close-up detail behind glass and are not held to the 1x size rule; the name bands are an HQ's sign from afar.
- The size test measures each sign's wordmark (its largest text); a tagline is ornament.
- Bulletins, V boards, and wall boards share one 2:1 art file per brand (`bb-<id>.png`).
- The Goldman Sachs monument file is now `mo-goldman-sachs.png`, named from the brand id like every other sign; its art is unchanged.
