# Pixel art city: Blender houses and the home choice

## Goal

Turn San Francisco's world art into pixel art, replace its procedural brick houses with detailed pixel-art house sprites modeled in Blender, give every residential and suburb lot in SF a sprite, and make the player's home a real housing decision with its own lot per tier.

This is the first of four sub-projects from the 2026-09-12 brainstorm, in this order:

1. Pixel art city, houses, and the home choice (this spec).
2. Commercial fill: every remaining SF lot gets a sprite (warehouses, mid-rises, corner shops; reference: a stepped pixel office tower with balconies).
3. Water: texture and animation.
4. Streets: traffic lights, crosswalks, cars obeying signals, and pedestrians crossing. This moved to the roads effort ([2026-09-12-roads-traffic-design.md](2026-09-12-roads-traffic-design.md), branch `roads-traffic`), which also widens some SF streets; SF's hand-placed home lots (Milestone 2) are placed against that new layout once it lands.

Each of the others gets its own spec, plan, and build, and each follows the art direction below (water, boats, cars, and props included).

## Decisions (from brainstorming, 2026-09-12)

- Art direction: pixel art everywhere in the world, matching Eric's pixel UI. This replaces the textured-realism direction of [2026-09-12-realistic-sprites-design.md](2026-09-12-realistic-sprites-design.md).
- The existing SF sprites are re-rendered in the pixel style before houses are added, so the city never mixes styles.
- Pixel density: 1 art pixel = 1 game pixel at zoom 1 (a 1x1 house is about 64 px wide).
- House styles for SF: Victorians and Edwardians, Sunset/Richmond stucco rows, suburban detached homes, and small walk-up apartments.
- The player's home tiers get hero-quality, one-of-a-kind models.
- Variety comes from four facings per model plus a runtime wall-color mask, not baked color variants or mirrored sprites.
- Choosing a home is a real money decision, gated by cash, credit, and debt-to-income.
- Each tier lives on its own lot in a different part of the city.

## Art direction

The reference is a sheet of cozy pixel houses: chunky readable shapes, a dark outline around every building, two or three flat tones per surface (lit top, mid left face, shaded right face), a small warm palette, visible roof courses and siding lines, and bright little windows.

- Blender stays the modeling tool: shapes, rotation, lighting, and shadows are rendered, then turned into pixel art by a post pass. Nothing is hand-painted, so every sprite, facing, and future city comes from the same script.
- Materials are flat colors with pixel-scale procedural patterns (siding and clapboard lines, brick courses, shingle and tile rows, window mullions) aligned to the 1 px grid, instead of photo textures, which quantize into noise.
- Every sprite has a 1 px outline in a dark ink color (`#2b2233`, a warm near-black like the reference), on its silhouette and on the edges between faces and parts.
- Shading is stepped: each surface gets at most three tones.
- The game draws sprites with nearest-neighbor sampling, so zooming in shows crisp square pixels.

## Milestone 0: the pixel pass

### Render (`game/art/lib/scene.py`)

- Render at 4x the final size (`SCALE = 4` during the render), with the camera and framing unchanged.
- Materials switch to a toon setup: the lit color goes through three constant steps by light amount, so faces come out as flat bands.
- An extra render pass writes object index and normals, used to find the edges between faces and parts.

### Post (`game/art/lib/pixel.py`, run by `build.py` after each render)

1. Downsample 4x to 1x by majority color per 4 x 4 block (never averaging, so no blurred in-between colors); alpha is kept only where most of the block is opaque.
2. Quantize to the city palette (`art/palettes/<city>.json`, about 32 colors), with no dithering.
3. Draw the outline: every opaque pixel next to transparency, and every pixel on an object or normal edge from the extra pass, becomes the ink color. Glass edges and emissive signs are exempt, so logos stay readable.
4. Night pass: the same downsample and quantize, with no outline, so lit windows stay clean single pixels.
5. Walls pass (houses, Milestone 1): the same downsample and quantize, with outline pixels removed so the outline drawn in the day layer stays on top.

Output files are now at 1x, so `sprites.json` gets `"scale": 1`.

### Engine

- `loadSpriteSet` sets `scaleMode = "nearest"` on every sprite texture.
- Nothing else changes: anchors, `topZ`, and `Built` stay the same.

### Re-render the current catalog

- Re-render all 43 SF sprites (landmarks, branded buildings, shelters, generic buildings) through the pixel pass.
- Sign and ad art (`art/make_ads.py`) keeps its layout, but the images are drawn at the sign's final pixel size with a pixel font (Pixelify Sans, which the UI already uses), so logos and text read as crisp pixels instead of blurring.
- `art/check_register.py` keeps its 1 px rule; at scale 1 that means a sprite's body must land exactly on its diamond.

## Milestone 1: house sprites

### Blender archetypes (`game/art/lib/houses.py`)

Seeded functions beside the existing archetypes, using the pixel materials.

| Archetype | Footprint | Floors | Variants | Details |
|---|---|---|---|---|
| `victorian` | 1x1 | 2-3 | 3: Italianate flat-front, Stick with square bay, Queen Anne with corner turret | Angled bay window to the roof, false-front cornice or gable, stoop with 6-8 steps to a recessed door, spindle trim, garage under some |
| `edwardian` | 1x1 | 2-3 | 2 | Simpler box, round bay, heavier cornice, flat roof |
| `stucco_row` | 1x1 | 2 | 4 | Garage door at street level, picture window above, Spanish tile parapet or flat Streamline Moderne roof; built wall to wall, no side gaps |
| `suburban` | 1x1 | 1-2 | 4: ranch, split-level, two-story colonial, craftsman bungalow | House set back behind a lawn, driveway, fence, mailbox, sometimes a parked car |
| `walkup` | 1x1 and 2x1 | 3-4 | 3 | Fire escapes, stacked bays, buzzer door, rooftop water heaters |

That is 16 models (64 sprites in four facings).
Every model is finished on all four sides, because rotation shows each side as the front in one of the facings.
Painted surfaces (siding, stucco, painted trim panels) use materials named `paint*`, rendered in neutral greys so the palette tint reads as paint; trim, glass, roofs, stairs, and yards keep their colors.

### Facings

- Each model renders four times, rotated 0, 90, 180, and 270 degrees about its lot center.
- The camera and sun stay fixed, so every shadow matches the rest of the city's sprites.
- Mirroring sprites is rejected: in the 2:1 projection it puts doors and the light on the wrong side.

### Layers per render

- `day`: the pixel render with its outline.
- `night`: black except what glows (windows, porch lights, garage lamps), drawn with additive blending as today.
- `walls`: only the painted surfaces in their grey tones, transparent elsewhere, outline pixels removed; same size and anchor as `day`.

### Manifest (`sprites.json`)

`SpriteEntry` gains:

- `facing?: "n" | "e" | "s" | "w"`: the side the front door faces; missing for non-houses.
- `walls?: string`: the walls layer file.
- `style?: "victorian" | "edwardian" | "stucco" | "suburban" | "walkup"`: the style family used for coherent rows.

### Engine (`game/src/engine/sprites.ts`)

- For an entry with `walls`, `view.children[0]` becomes a container holding `[day, walls]`.
- The walls sprite is tinted with a color from `city.palette.walls`, picked by the lot's seeded rng; because the walls layer holds only a few grey tones, the tint gives a few flat tones of that color, which stays pixel art.
- The scene already tints `view.children[0]` with the time-of-day color, and PixiJS v8 multiplies a container's tint into its children, so dusk and night reach the walls with no `scene.ts` change.
- `loadSpriteSet` loads `walls` files alongside `day`, `night`, and `crown`.

### Placement (`sprite-pick.ts`, `populate.ts`)

- A residential lot's facing is the side its nearest road is on; ties go to the camera-facing sides (`s`, then `e`) so more fronts are seen.
- `pickSprite` only considers entries whose `facing` matches when the entry has one.
- Style by area:
  - Residential zones may list their house styles in the city definition (`Zone.houses`); SF lists stucco rows for the Sunset zone around 11,25, Victorians and Edwardians for the Alamo Square zone, and suburban homes for the Marin headlands.
  - A residential zone without a list gets Victorian and Edwardian.
  - The generated suburb ring (lots outside the hand-made core) gets suburban detached.
- Rows stay coherent: a lot takes the style family of the previous lot on the same street side when that family fits, so a block reads as one street.
- Walk-ups replace about 1 in 8 lots in the core's residential areas.
- Suburb-ring lots go through the same sprite pick; the brick builder stays only as the fallback when no sprite fits.
- `Lot` gains `facing` and `style`; `populate.ts` computes both, using the core rectangle that `expandWorld` records on the expanded city.

### Home tier models (`game/art/lib/homes.py`)

Six baked models, no wall mask, four facings, day and night, through the same pixel pass.
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

The multipliers live in one table in `sim/life/homes.ts` next to the home math, so they are easy to tune.

### Sim (`game/src/sim/life/`)

- New `PlayerLife.chooseHome(tier, day, options)`, returning the result and emitting a `home` life event.
- Renting a tier replaces the rent line with that tier's rent.
- Buying a tier:
  - checks cash with `houseMath` (down payment, closing, moving costs), counting the proceeds of selling the current home;
  - underwrites with `applyForLoan({ kind: "mortgage" })` (credit score floor and the 43% DTI limit);
  - opens the mortgage with `openLoan`, takes the cash, and stops rent;
  - adds a monthly bill for property tax and insurance, plus PMI under 20% down, using the constants in `sim/skip/goals.ts`.
- Leaving an owned home sells it at its value minus 6% selling costs; the mortgage is paid off and the rest goes to cash.
- The down payment defaults to 20% and the player can pick 3.5%, 10%, or 20%.
- Net worth counts the home's value minus its mortgage; home value stays flat (no appreciation model in this spec).
- The tier is whatever the player chose; `HOME_TIER_NET_WORTH` and the net-worth rule in `homeTier()` are removed.
- Bankruptcy, or a mortgage 120 or more days past due (foreclosure; the debt engine never sends a secured mortgage to collections), forces the tent, and so does a rent bill paid short two months running (eviction); each emits a `home` event.
- Onboarding sets the starting home: a stated rent at or under 1x the state median starts in the studio; a higher one starts renting the townhouse. Either way the stated rent stays the rent anchor, so the starting rent is what the player said.
- `setPlace` (moving states) sells an owned home with the same selling costs and starts the player renting the studio in the new state.
- `RunRecorder` records the `home` event like every other life event, and the server's coach facts (`server/src/ai/facts.ts`) describe it.

### City (`game/src/cities/`, `game/src/engine/`)

- `CityDef` gains `homes?: { tier: number; x: number; y: number; where?: string }[]`; tiers a city leaves out are placed by rule.
- SF places five lots by hand at the locations in the table, each next to a road and kept clear of landmarks' sightlines; the large house is placed by rule, because the suburb ring is generated outside the hand-made core.
- The rule, for every tier a city does not place: studio in midtown near the core, townhouse in the inner residential zone, small house on the existing `h` lot, large house in the suburb ring, villa on a coast or edge lot, tent at a park edge beside a road.
- Every home lot shows its tier's hero model; the ones the player does not live in carry a small pixel "For sale" or "For rent" sign (a sign prop rendered through the pixel pass).
- The current home has the ring and the pin; the yard-clearing rule in `scene.ts` applies to every home lot.

### UI (`game/src/ui/`)

- The "Your home" card's +/- buttons are replaced by a home picker opened from the card or by clicking any home lot.
- Time pauses while the picker is open.
- Each tier row shows the neighborhood, the monthly cost, the cash needed, the pre-qualified mortgage odds, and, when locked, the reasons from `applyForLoan` and `houseMath` (for example "this payment would put your debt-to-income at 51%; the limit is 43%").
- Confirming pans the camera to the new lot, moves the ring and pin, drops the house in with the existing bounce, puts the sign back on the old lot, and cues the narrator's `home_up` or `home_down`.
- The Money desk needs no special work: the mortgage and housing bills are ordinary debts and bills in the same `PlayerLife`.
- The picker follows Eric's pixel theme (`pixel-theme.css`, Pixelify Sans).

## Verification

- `art/check_register.py` covers every render and also fails when:
  - a sprite has semi-transparent pixels or colors outside its city palette (pixel pass not applied);
  - a walls layer has pixels outside the day layer's opaque pixels;
  - a model's four facings do not share its footprint diamond within 1 game pixel.
- Contact sheets, `art/_contact-<city>.png` and `art/houses/_contact.png`, show every sprite (and every house in four facings with sample tints) at 1x and 4x nearest, reviewed before engine work.
- `tests/sprites.test.ts`: facing from the road, style family by area, walk-up mixing, row coherence, and a headless populate of SF in which no residential or suburb lot falls back to bricks.
- New sim tests: renting, buying (approved and denied for cash, score, and DTI), selling with costs, foreclosure and eviction to the tent, moving states with an owned home, and onboarding's starting tier.
- In the browser: downtown, the Sunset, Alamo Square and the Painted Ladies, and the suburb ring at three zoom levels, day and night, checking crisp pixels at every zoom; stepping through all six homes with the picker.
- Asset budget: all SF and home sprites together stay under 8 MB (1x pixel art is far smaller than today's 2x renders).
- `npm run build` and `npm test` stay green.

## Out of scope

- Commercial fill, water, and streets (their own specs, in the same pixel style).
- Pixel conversion of the procedural parts (ground, roads, trees, cars, people); they follow in the water and streets specs.
- House sprite sets for cities other than SF (the shared home tiers are the exception).
- Home appreciation, renovation, and renting out a home.
