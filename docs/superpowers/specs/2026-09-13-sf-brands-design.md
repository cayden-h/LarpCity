# SF brands: a busy commercial downtown

Status: approved 2026-09-13 (tower-top rule kept; 24 sign slots).

Goal: about 20 more companies on San Francisco's buildings and billboards, so downtown, SoMa, the Embarcadero, and the freeway read as a busy commercial city and every company is recognizable at the default zoom (0.72).
It follows the approved pixel look ([houses spec, "Look check"](2026-09-12-blender-houses-design.md)) and the SF signage research in the [realistic-sprites spec](2026-09-12-realistic-sprites-design.md).

## What exists and what is wrong today

- 15 brands on 19 branded sprites, each drawn by its own function in `game/art/make_ads.py` and listed by hand in `game/art/catalog.py`.
- Downtown has only 28 lots (12 of 2x2, 6 of 1x2, 8 of 1x1, 2 of 2x1); midtown has 53 (35 of 1x1).
- Placement is a chance draw per lot, so with the default seed the Google, Meta, and Goldman Sachs HQs never appear (downtown has two 2x1 lots and other entries win them).
- The day palette has 12 colors reserved for signs, already shared by about 25 brand colors.

## Roster (20 new companies)

HackRice sponsors come first, then well-known SF and Bay Area companies, leaning toward finance because this is the Finance track.
Wordmarks are lettered in Pixelify Sans; the mark is a simple drawn shape in brand colors, never the real logotype.

| # | Company | Wordmark | Colors (field / letters / mark) | Mark shape | Surface | Where |
|---|---|---|---|---|---|---|
| 1 | Tiger Data (sponsor) | TIGER DATA | black / white / yellow | three tiger-stripe chevrons | rooftop bulletin on a brick loft | SoMa |
| 2 | Vultr (sponsor) | vultr | blue / white / white | stacked V chevrons | freeway V board | freeway |
| 3 | Solana (sponsor) | SOLANA | black / white / purple and green | three slanted bars | freeway V board (paired with Vultr) | freeway |
| 4 | Gemini (Google, sponsor prize) | Gemini | white / blue / blue and purple | four-point sparkle | rooftop bulletin | SoMa |
| 5 | Backboard (sponsor) | Backboard | dark green / white / white | board with a pin | wall board on an office | downtown |
| 6 | GoDaddy Registry (sponsor) | GoDaddy | teal / black on a light panel | none (wordmark only) | painted wall ad on a loft | SoMa |
| 7 | MathWorks (sponsor) | MathWorks | white / blue / orange | peaked membrane | HQ: lobby logo wall and name band | downtown |
| 8 | Presage (sponsor) | presage | navy / white / cyan | eye ring | wall board on an office | downtown |
| 9 | Stripe | stripe | purple / white / white | none | HQ: lobby logo wall and name band | downtown |
| 10 | Visa | VISA | navy / white / gold bar | gold underline bar | rooftop bulletin | SoMa |
| 11 | Charles Schwab | SCHWAB | blue / white / white | none | bank storefront with a blade sign | downtown |
| 12 | Robinhood | Robinhood | lime / black / black | feather | freeway V board | freeway |
| 13 | Plaid | PLAID | black / white / white | tartan grid square | wall board on a loft | SoMa |
| 14 | Airbnb | airbnb | white / coral / coral | loop arch | HQ: name band and logo wall (a low SoMa office) | SoMa |
| 15 | Dropbox | Dropbox | white / blue / blue | open box of four diamonds | HQ: lobby logo wall and name band | downtown |
| 16 | Lyft | lyft | pink / white / white | none | freeway V board (paired with Robinhood) | freeway |
| 17 | DoorDash | DOORDASH | red / white / white | dash chevron | rooftop bulletin | SoMa |
| 18 | Ghirardelli | GHIRARDELLI | cream letters on the brick, faded | none | painted ghost sign, like the Levi's one | SoMa |
| 19 | Blue Bottle Coffee | BLUE BOTTLE | white / blue / blue | bottle silhouette | storefront, fascia and blade | Embarcadero |
| 20 | Gap | GAP | navy / white / white | none | storefront, fascia and blade | downtown |

The three HQs that never place today (Google, Meta, Goldman Sachs) are fixed too, so downtown shows 23 more companies than it does now.
Brand colors come from each company's public brand guide; where a guide was not available (Backboard, Presage), the colors come from the company's site.

## Sign surfaces and how each stays readable

Readability rules for every surface, checked on the 1x sprite:

- Capitals at least 7 game px tall on bulletins, V boards, name bands, and painted walls, and at least 6 px on fascias, blades, and wall boards (at 0.72 that is 5 and 4 screen px, doubled on retina).
- Wordmarks of at most 9 characters on anything smaller than a painted wall; longer names shorten (SCHWAB, BLUE BOTTLE on two lines on the blade).
- Marks at least 8 x 8 game px; a mark that cannot reach that size is dropped, never shrunk.
- Two or three flat tones per surface plus the dark outline around the sign's frame; lettering never touches the frame (make_ads.py's safe-area check).
- High field-to-letter contrast (luminance difference of at least 96 of 255), checked by a new test.

Surfaces:

- **Rooftop bulletin** (exists): a lit steel board on an old SoMa loft, one big mark and wordmark (2:1 art). Only in SoMa, never downtown.
- **Wall board** (new): the same 2:1 lit board, mounted flat on a building's windowless side wall at the third floor or above, facing one visible side, with two gooseneck lamps above it. For low offices and lofts where a rooftop board would read as a tower-top sign.
- **Freeway V board** (exists as the monopole): two boards on one tall pole. They move from ordinary midtown lots to the freeway: a new placement puts two to four V boards on open ground beside the highway ring's stretch nearest downtown, like the Muni shelters (a prop, no lot taken). The existing Lovable/OpenAI and Anthropic/ElevenLabs poles move there too.
- **Painted wall ad** (exists as murals): flat paint on a loft's side wall, unlit, with the flat wear used on the Levi's ghost sign.
- **Storefront fascia and blade** (exist): a 6 to 7 px tall band across the front and a 2:3 blade sign; now also on 1x1 and 1x2 lots so downtown's small lots can hold shops.
- **Name band** (new): a lit horizontal sign over an HQ's entrance at the second floor, spanning most of the facade, 8 px capitals. It is the HQ's main readable sign from far away; the lobby logo wall stays for close-up zoom.
- **Lobby logo wall and monument** (exist).
- **Branded HQ** (exists as `hq_lobby`): gains the name band and a brand-colored entrance canopy, and comes in 2x2, 1x2, and 1x1, so HQs fit the lots downtown really has.

Night: bulletins, wall boards, V boards, name bands, fascias, blades, and logo walls are lit and glow in the night layer; painted walls are unlit and fade with the building like the Levi's sign.
Rain: no change to the sprites; the check is that wet-weather tint keeps the contrast rule (verified in the browser).

## Tower tops

The earlier rule (SF bans rooftop signs downtown, so towers carry no brand names) stays as written: no brand ever goes on a tower's top or crown.
Downtown brands live at street level and at the second floor (name bands, lobbies, storefronts, monuments), and on wall boards on low buildings; big boards stay in SoMa and on the freeway.
The skyline still reads as branded because the name bands are big and lit, and downtown's low buildings carry wall boards.
Breaking the rule (for example lit crown letters on two or three towers for HackRice sponsors) is an open question for you; the spec does not do it unless you say so.

## Palette (flag)

12 reserved sign colors are not enough: the 20 new brands add about 15 colors that no current slot is near (purple, lime, pink, coral, teal, gold, and several distinct blues).
Proposal: raise the sign slots from 12 to 24 and the SF day palette from 40 to 52 colors, rebuild the palette once with `--new-palette`, and re-render the whole SF set so every sprite uses it.
Buildings and houses keep their current colors within the quantizer's error (the 28 building slots stay 28); `check_register.py` and the palette warning (`SIGN_MISS_SHARE`) must pass.

## Roster as data

- New `game/art/brands.py` holds `BRANDS`: one entry per company with its id, display name, wordmark text, colors, mark (a named shape from a small library in make_ads.py, with its colors), whether it is a HackRice sponsor, and its placements (surface, footprint, floors, zone, area).
- `catalog.py` builds the branded catalog entries from `BRANDS`; `make_ads.py` draws every surface a brand's placements need from the same entry with shared layouts (bulletin, wall board, V board, fascia, side band, blade, name band, logo wall, monument, painted wall, shelter).
- The existing 15 brands move into `BRANDS` too; their art keeps its current look, and a brand whose sign needs a special drawing (the Capital One swoosh lockup, the Wells Fargo stagecoach, the Jeni's neon cone, the Levi's ghost sign) names a custom draw function in its entry.
- Adding a company later is one `BRANDS` entry plus, only if it needs a new shape, one mark function.

## Placement

- Branded sprites are placed first, in roster order, and every one is guaranteed a lot when a lot of its footprint exists in its zone: the planner assigns them before generic lots, preferring lots in the brand's area (hero spots in the zone's core come next), all from the seeded RNG so the city stays deterministic.
- Areas are named circles in the city definition (`areas` in `san-francisco.ts`): `soma` (the midtown zone south of downtown), `embarcadero` (downtown lots along the bay road), and `freeway` (the highway ring nearest downtown, for V boards).
- A test checks that every SF branded entry is placed, in its zone, for several seeds, and that a brand never appears twice.
- Downtown keeps about half its lots for generic towers, so the skyline stays a skyline.

## Performance and determinism

- Branded sprites replace generic sprites one for one; V boards add at most four sprites; the atlas budget test (8 MB) stays green.
- Frame cost is measured as in the [pixel world progress doc](../plans/2026-09-13-pixel-world-progress.md) (40 synchronous renders, full SF world, seed 20260912) at max zoom-out, 1, and 2, before and after; after must be no slower.
- No new randomness outside the seeded RNGs.

## Verification

- `make_ads.py` (safe area), `check_register.py` (registration, palette, alpha), the art unit tests, and new tests for the roster (every placement has its art, every art has a brand, readable sizes and contrast) and for placement.
- Contact sheets at 1x and 4x reviewed by eye.
- `npm run build` and `npm test` in `game/`; `npm test` and `tsc` in `server/` against a local database only.
- Browser: downtown, SoMa, the Embarcadero, and the freeway, day and night, at 0.72, 1, and 4, on its own ports; every new company named from the screenshots.

## Out of scope

The Golden Gate, Transamerica, Coit Tower, and Alcatraz landmarks; the other five cities; the weather app; interstate travel; `setPlace`.
