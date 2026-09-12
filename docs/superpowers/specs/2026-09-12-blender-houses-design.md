# Blender houses and the home choice

## Goal

Replace San Francisco's procedural brick houses with detailed Blender sprites, give every residential and suburb lot in SF a sprite, and make the player's home a real housing decision with its own lot per tier.

This is the first of four sub-projects from the 2026-09-12 brainstorm, in this order:

1. Blender houses and the home choice (this spec).
2. Commercial fill: every remaining SF lot gets a sprite (warehouses, mid-rises, corner shops).
3. Water: texture and animation.
4. Streets: traffic lights, crosswalks, cars obeying signals, and pedestrians crossing.

Each of the others gets its own spec, plan, and build.

## Decisions (from brainstorming, 2026-09-12)

- House styles for SF: Victorians and Edwardians, Sunset/Richmond stucco rows, suburban detached homes, and small walk-up apartments.
- The player's home tiers get hero-quality, one-of-a-kind models.
- Variety comes from four facings per model plus a runtime wall-color mask (approach A), not baked color variants or mirrored sprites.
- Choosing a home is a real money decision, gated by cash, credit, and debt-to-income.
- Each tier lives on its own lot in a different part of the city.

## Milestone 1: house sprites

### Blender archetypes (`game/art/lib/houses.py`)

Seeded functions beside the existing archetypes, using CC0 ambientCG textures (wood siding, stucco, shingle, clay tile) fetched by `art/fetch_textures.sh`.

| Archetype | Footprint | Floors | Variants | Details |
|---|---|---|---|---|
| `victorian` | 1x1 | 2-3 | 3: Italianate flat-front, Stick with square bay, Queen Anne with corner turret | Angled bay window to the roof, false-front cornice or gable, stoop with 6-8 steps to a recessed door, spindle trim, garage under some |
| `edwardian` | 1x1 | 2-3 | 2 | Simpler box, round bay, heavier cornice, flat roof |
| `stucco_row` | 1x1 | 2 | 4 | Garage door at street level, picture window above, Spanish tile parapet or flat Streamline Moderne roof; built wall to wall, no side gaps |
| `suburban` | 1x1 | 1-2 | 4: ranch, split-level, two-story colonial, craftsman bungalow | House set back behind a lawn, driveway, fence, mailbox, sometimes a parked car |
| `walkup` | 1x1 and 2x1 | 3-4 | 3 | Fire escapes, stacked bays, buzzer door, rooftop water heaters |

That is 19 models.
Painted surfaces (siding, stucco, painted trim panels) render in a light neutral grey; trim, glass, roofs, stairs, and yards keep their baked colors.

### Facings

- Each model renders four times, rotated 0, 90, 180, and 270 degrees about its lot center.
- The camera and sun stay fixed, so every shadow matches the rest of the city's sprites.
- Mirroring sprites is rejected: in the 2:1 projection it puts doors and the light on the wrong side.

### Layers per render

- `day`: the normal render.
- `night`: black except what glows (windows, porch lights, garage lamps), drawn with additive blending as today.
- `walls`: only the painted surfaces, shaded, transparent elsewhere; same size and anchor as `day`.

### Manifest (`sprites.json`)

`SpriteEntry` gains:

- `facing?: "n" | "e" | "s" | "w"`: the side the front door faces; missing for non-houses.
- `walls?: string`: the walls layer file.
- `style?: "victorian" | "edwardian" | "stucco" | "suburban" | "walkup"`: the style family used for coherent rows.

### Engine (`game/src/engine/sprites.ts`)

- For an entry with `walls`, `view.children[0]` becomes a container holding `[day, walls]`.
- The walls sprite is tinted with a color from `city.palette.walls`, picked by the lot's seeded rng.
- The scene already tints `view.children[0]` with the time-of-day color, and PixiJS v8 multiplies a container's tint into its children, so dusk and night reach the walls with no `scene.ts` change.
- `loadSpriteSet` loads `walls` files alongside `day`, `night`, and `crown`.

### Placement (`sprite-pick.ts`, `populate.ts`)

- A residential lot's facing is the side its nearest road is on; ties go to the camera-facing sides (`s`, then `e`) so more fronts are seen.
- `pickSprite` only considers entries whose `facing` matches when the entry has one.
- Style by area:
  - Inner residential zones: Victorian, Edwardian, and walk-up.
  - Outer residential zones (the Sunset, around 11,25): stucco rows.
  - The generated suburb ring (lots outside the hand-made core): suburban detached.
- Rows stay coherent: a lot takes the style family of the previous lot on the same street side when that family fits, so a block reads as one street.
- Walk-ups replace about 1 in 8 lots in the inner and outer residential areas.
- Suburb-ring lots go through the same sprite pick; the brick builder stays only as the fallback when no sprite fits.
- `Lot` gains `facing` and `area: "core" | "suburb"`; `populate.ts` computes both.

### Home tier models (`game/art/lib/homes.py`)

Six baked models, no wall mask, four facings, day and night.
They live in a shared set, `public/sprites/common/home/` with its own `sprites.json`, so every city gets them, including template cities without a sprite set.

| Tier | Model |
|---|---|
| 0 Tent | Worn dome tent, tarp, shopping cart of belongings, camp stool, a lantern that glows at night |
| 1 Studio apartment | Narrow 4-floor walk-up; one window on the player's floor warm-lit with a plant on the sill, the only lit window at night |
| 2 Small house | Craftsman bungalow, porch swing, small lawn, mailbox |
| 3 Townhouse | 3-floor Victorian, bay window, stoop, flower boxes, car at the curb |
| 4 Large house | Two-story colonial, two-car garage, hedge, SUV in the driveway, lit porch |
| 5 Retirement villa | Mediterranean, tile roof, lit pool, palms, pergola, golf cart; fills its lot edge to edge |

Tiers 0-4 sit inside the lot at about 0.8 of the tile, like today's models.
`HeroHome.build()` uses the sprite's `Built` in the slot the brick builder fills today, so the drop-in bounce, the ring, and the pin are unchanged.
If the common set fails to load, it falls back to today's brick models.

## Milestone 2: the home choice

### Tiers, places, and costs

| Tier | SF location | Tenure | Monthly cost or price |
|---|---|---|---|
| Tent | Edge of Golden Gate Park | Forced only | $0 |
| Studio apartment | A walk-up in SoMa or midtown | Rent | 0.6x the state's median rent |
| Small house | The Sunset, near the ocean edge | Buy | 0.7x `homePrice(state)` |
| Townhouse | A Victorian by Alamo Square | Buy | 1.3x `homePrice(state)` |
| Large house | The suburb ring | Buy | 1.8x `homePrice(state)` |
| Retirement villa | The Marin headlands above the water | Buy | 4x `homePrice(state)` |

The multipliers live in one table in `sim/life/` next to `homePrice` and `houseMath`, so they are easy to tune.

### Sim (`game/src/sim/life/player.ts`)

- New `PlayerLife.chooseHome(tier, day, options)`, returning the result and emitting a `home` life event.
- Renting a tier replaces the rent line with that tier's rent.
- Buying a tier:
  - checks cash with `houseMath` (down payment, closing, moving costs);
  - underwrites with `applyForLoan({ kind: "mortgage" })` (credit score floor and the 43% DTI limit);
  - opens the mortgage with `openLoan`, takes the cash, and stops rent;
  - adds a monthly bill for property tax and insurance, plus PMI under 20% down, using the constants in `sim/skip/goals.ts`.
- Leaving an owned home sells it at its value minus 6% selling costs; the mortgage is paid off and the rest goes to cash.
- The down payment defaults to 20% and the player can pick 3.5%, 10%, or 20%.
- Net worth counts the home's value minus its mortgage; home value stays flat (no appreciation model in this spec).
- The tier is whatever the player chose; `HOME_TIER_NET_WORTH` and the net-worth rule in `homeTier()` are removed.
- Bankruptcy or a mortgage in collections forces the tent (foreclosure), and so does a `cannot_cover` rent bill in two months running (eviction); both emit a `home` event.
- Onboarding sets the starting home: a stated rent at or under 1x the state median starts in the studio; a higher one starts renting the townhouse at the stated rent, which stays the rent anchor.
- `setPlace` (moving states) sells an owned home with the same selling costs and starts the player renting the studio in the new state.
- `RunRecorder` records the `home` event like every other life event.

### City (`game/src/cities/`, `game/src/engine/`)

- `CityDef` gains `homes: { tier: number; x: number; y: number }[]`, replacing the single `h` layout tile.
- SF's six lots are placed by hand at the locations in the table, each next to a road and kept clear of landmarks' sightlines.
- Template cities place them automatically: studio in midtown near the core, townhouse in the inner residential zone, small house at the outer residential edge, large house in the suburb ring, villa on a coast or edge lot, tent at a park edge beside a road.
- Every home lot shows its tier's hero model; the ones the player does not live in carry a small "For sale" or "For rent" sign (a sign prop rendered in Blender).
- The current home has the ring and the pin; the yard-clearing rule in `scene.ts` applies to every home lot.

### UI (`game/src/ui/`)

- The "Your home" card's +/- buttons are replaced by a home picker opened from the card or by clicking any home lot.
- Time pauses while the picker is open.
- Each tier row shows the neighborhood, the monthly cost, the cash needed, the pre-qualified mortgage odds, and, when locked, the reasons from `applyForLoan` and `houseMath` (for example "this payment would put your debt-to-income at 51%; the limit is 43%").
- Confirming pans the camera to the new lot, moves the ring and pin, drops the house in with the existing bounce, puts the sign back on the old lot, and cues the narrator's `home_up` or `home_down`.
- The Money desk needs no special work: the mortgage and housing bills are ordinary debts and bills in the same `PlayerLife`.
- The picker follows Eric's pixel theme (`pixel-theme.css`, Pixelify Sans).

## Verification

- `art/check_register.py` covers every new render and also fails when:
  - a walls layer has pixels outside the day layer's opaque pixels;
  - a model's four facings do not share its footprint diamond within 1 game pixel.
- A contact sheet, `art/houses/_contact.png`, shows every model in four facings with sample tints, reviewed before engine work.
- `tests/sprites.test.ts`: facing from the road, style family by area, walk-up mixing, row coherence, and a headless populate of SF in which no residential or suburb lot falls back to bricks.
- New sim tests: renting, buying (approved and denied for cash, score, and DTI), selling with costs, foreclosure to the tent, moving states with an owned home, and onboarding's starting tier.
- In the browser: the Sunset, Alamo Square and the Painted Ladies, and the suburb ring at three zoom levels, day and night; stepping through all six homes with the picker; comparing against today's look.
- Asset budget: the house and home sets together stay under 8 MB; pack an atlas if the PNG count slows loading.
- `npm run build` and `npm test` stay green.

## Out of scope

- Commercial fill, water, and streets (their own specs).
- House sprite sets for cities other than SF (the shared home tiers are the exception).
- Home appreciation, renovation, and renting out a home.
