# 05 - City Visuals, States Map, and Art Pipeline

How each Larp City city looks and moves: generated backgrounds with day, night, and weather, plus live SVG and Pixi layers for buildings, landmarks, water, and traffic.
Written 2026-09-11, building on the team's Notion updates (specialized cities, "view other cities for free, pay to move", seasons, and the event list) and the [game design meeting](../docs/meetings/2026-09-11-game-design.md) (daily calendar, one player life, retirement goal, LCOL/MCOL/HCOL tiers).
Where this conflicts with the meeting, the meeting wins.

## TL;DR

- Every city is a **toy-brick diorama floating on a baseplate**, seen in isometric view like the LEGO reference game.
  The generated image is the world around and behind the baseplate (sky, horizon, distant skyline, sea); everything on the baseplate is live code.
- **Backgrounds come from ChatGPT Images 2.0 (`gpt-image-2` in the API).**
  Each city gets 4 plates: day, golden hour, night, and overcast.
  Rain, snow, fog, storms, and smoke are runtime effects layered on top, so we don't need 20 images per city.
- **Everything that moves or changes is code:** procedural brick buildings (the player's home upgrades or decays with their net worth), SVG landmarks with animated parts, SVG water, road and bridge graphs, cars, boats, and weather particles.
- **The sky runs its own clock:** normal speed is 1 game week per 5 real seconds since 2026-09-12 (about 0.7 s per game day; it was 10 s), which would strobe as a real day/night cycle, so the prototype gives the sky a cosmetic 72-second day; skips hold a steady daytime look.
  Seasons follow the calendar; weather is rolled per city per day from a climate table with the seeded RNG, and events such as Hurricane or Snow Storm force the matching weather.
- **Prototype:** a working build of all of this lives in [game/](../game/) (see its README); section 11 lists what it does today.
- **Scope:** 6 hand-made cities (Houston home base, San Francisco, New York, Dallas, Austin, Miami) plus 7 regional templates that cover the other 44 states and DC.
  About 52 background plates in total.
- **The states map** is a real US map (`us-atlas` TopoJSON + `d3-geo`) shaded by the meeting's LCOL / MCOL / HCOL tiers.
  Browsing any state is free; moving there costs money, matching the team's update.

## 1. Scene layers

Back to front, with who owns each layer.

| # | Layer | Made with | Changes at runtime |
| --- | --- | --- | --- |
| 0 | Sky and horizon plate | ChatGPT Images 2.0, 4 plates per city | Crossfades between day, golden hour, night, and overcast |
| 1 | Clouds and fog | Pixi sprites (a few soft cloud PNGs) | Drift speed and density follow weather |
| 2 | Water (bay, river, ocean) | SVG polygons per city, drawn in Pixi | Shimmer lines, boats, storm waves, night reflections |
| 3 | Baseplate and ground | Pixi Graphics, iso tiles with studs | Grass color by season, snow cover, drought brown |
| 4 | Roads, bridges, parks | Road graph JSON plus SVG bridge decks | Traffic lights, bridge lights at night |
| 5 | Buildings | Procedural brick builder (Pixi Graphics, cached to textures) | Grow, upgrade, decay, "for sale" signs, lit windows at night |
| 6 | Landmarks | SVG per landmark, rasterized at 2x on load | Blinking lights, flags, rotating signs, spotlights |
| 7 | Vehicles and people | Small sprites (4 directions) | Follow road and water paths; count follows the economy |
| 8 | Weather particles | Pixi ParticleContainer | Rain, snow, embers, leaves, lightning flash |
| 9 | Grade and light overlay | ColorMatrixFilter plus an additive light layer | Tint matched to the current plate; bear-market desaturation |

Why this split:

- A generated image can't animate or respond to the sim, but it gives rich, specific atmosphere (fog rolling past the Golden Gate, a Miami sunset) that would take days to draw by hand.
- SVG and procedural shapes are cheap to animate, recolor, and tie to data, so anything the simulation touches lives there.
- Weather as overlays means the same 4 plates cover every weather combination.

## 2. Backgrounds with ChatGPT Images 2.0

### What the model supports (checked 2026-09-11)

- The ChatGPT app's "Images 2.0" is `gpt-image-2` in the API (snapshot `gpt-image-2-2026-04-21`), with `images.generate` and `images.edits` (edits take reference images and an optional mask).
- Sizes are custom: both edges multiples of 16, the longest edge up to 3840 px, aspect ratio at most 3:1, and 655,360 to 8,294,400 total pixels.
  We use **2048 x 1152** (16:9).
- `gpt-image-2` does not document transparent backgrounds, and third-party guides report that `background: "transparent"` requests fail.
  The newer `gpt-image-2.5` models in OpenAI's image guide do support transparency, so use one of those or a flat magenta chroma key if we ever need cut-out sprites.
  Plates are opaque, so this doesn't affect backgrounds.
- Rough price: about $0.05 (medium) to $0.21 (high) per 1024 x 1024 image, according to third-party price checks; a 2048 x 1152 plate costs more.
  All 52 plates at high quality are well under $30, and generating them in the ChatGPT app with a Plus account costs nothing extra.
- Tier 1 API accounts are limited to 5 images per minute, so a batch script needs a small queue.

### Plate set per city

| Plate | When it shows | Notes |
| --- | --- | --- |
| `day.webp` | Clear daytime | The master; generate this first |
| `golden.webp` | Dawn and dusk | Edit of the master: warm low sun, long shadows |
| `night.webp` | Night | Edit of the master: dark blue sky, lit windows in the distant skyline, moon |
| `overcast.webp` | Rain, snow, fog, storm, smoke, and pandemic weeks | Edit of the master: flat grey sky; runtime particles add the actual weather |

Consistency rule: **generate only the day master from text, then make the other 3 as edits of that image** ("keep the composition identical, change only the lighting and sky").
This keeps the skyline in the same place in all 4 plates, so crossfades don't jump.

### Composition rules for every plate

- 16:9 panorama, 2048 x 1152.
- Top 55%: sky.
- A horizon band at 45-60% of the height with the city's far skyline and terrain, small and hazy.
- Bottom 40%: water or land that fades to soft blur, because the baseplate diorama covers the bottom middle.
- No text, no logos, no brand names, no people up close.
- The camera pans the plate at 0.1x map speed for parallax, so leave about 10% margin on each side.

### Prompt template (master)

```
Wide 16:9 panoramic background for an isometric toy city-builder game.
Style: bright, clean, stylized plastic toy-brick world, soft gradients, gentle
ambient occlusion, cheerful saturated colors, like a premium kids' building-toy
game backdrop. Not photorealistic. No text, no logos, no brand marks.
Scene: the view beyond the edge of {CITY}. {BACKDROP_DESCRIPTION}.
Composition: sky fills the top half. A thin horizon band at 45-60% height shows
{FAR_SKYLINE}, small and slightly hazy with atmospheric perspective. The lower
40% is {FOREGROUND_SURFACE}, calm, fading to a soft out-of-focus blur at the
bottom center (a game board will sit there). Keep 10% empty margin at the left
and right edges. Time: clear midday, soft white clouds.
```

Avoid the word "LEGO" in prompts: it can trip IP filters and push the model toward the trademark look, which we can't ship.
"Toy-brick" and "plastic building-toy" get the same feel.

### Edit prompts (variants of the master)

```
golden:   Keep the composition and every shape identical. Change only the lighting
          to golden hour: low warm sun near the horizon, orange-pink sky, long soft
          shadows, windows catching light.
night:    Keep the composition and every shape identical. Change to night: deep
          blue-violet sky with a few stars and a moon, the distant skyline windows
          lit warm yellow, water reflecting the lights.
overcast: Keep the composition and every shape identical. Change to an overcast
          day: flat soft grey clouds covering the sky, muted colors, no sun,
          slightly lower contrast, wet-looking water.
```

### Per-city backdrop descriptions

| City | `BACKDROP_DESCRIPTION` | `FAR_SKYLINE` | `FOREGROUND_SURFACE` |
| --- | --- | --- | --- |
| Houston (home) | Flat Gulf Coast prairie with bayous and oak trees under a huge sky | A distant downtown cluster of glass towers and the silhouette of refinery stacks by the ship channel | Calm bayou water with reeds |
| San Francisco | Hilly peninsula with fog banks rolling over the Pacific side | Distant hills, a red suspension bridge silhouette in the fog, and the East Bay hills | Blue bay water with small sailboats |
| New York | Harbor mouth with open water | A dense skyline of Art Deco spires and modern glass towers across the river, a green copper statue on a small island | Grey-blue harbor water with ferry wakes |
| Dallas | Flat North Texas plains with big cumulus clouds | A spread-out skyline with a tower topped by a lit sphere, and a white arched bridge | Dry golden grass and a slow river |
| Austin | Green Texas Hill Country with limestone bluffs | A mid-size skyline with a pink granite capitol dome and an owl-faced tower | A calm lake with kayaks |
| Miami | Tropical coast with turquoise water | Pastel Art Deco hotels, palm trees, and white high-rise condos along a barrier island, cruise ships at port | Turquoise shallow water with a sandbar |

Landmark-like silhouettes in the far background are fine because they're small and stylized; the close-up landmarks are our own SVGs.

### Regional templates for the other 44 states and DC

Each template gets the same 4 plates plus a generic capitol-dome landmark and a state sign, and pulls its costs from `states.json`.

| Template | Backdrop | States |
| --- | --- | --- |
| Pacific Coast | Evergreen hills, rocky coast, rain | OR, WA, AK |
| Desert Southwest | Red mesas, saguaro, big sun | AZ, NM, NV, UT |
| Mountain West | Snowy peaks, pine forest | CO, ID, MT, WY |
| Great Plains | Wheat fields, grain elevators, thunderheads | KS, NE, ND, SD, OK |
| Great Lakes and Midwest | Lake shore, red-brick towns, maple trees | IL, IN, IA, MI, MN, MO, OH, WI |
| Northeast | Rolling hills, church steeples, fall color | CT, DE, MA, MD, ME, NH, NJ, PA, RI, VT, DC |
| Southeast | Pine forest, rivers, Spanish moss | AL, AR, GA, KY, LA, MS, NC, SC, TN, VA, WV |
| Island (reuse Miami) | Volcano and beach | HI |

Hawaii can reuse the Miami template with a volcano prompt, so this is 7 new templates.

## 3. Time of day, seasons, and weather

### Clock

- The meeting chose a daily calendar (Stardew Valley style); since 2026-09-12, 1x is 1 game week per 5 real seconds (a game day lasts about 0.7 s) and 2x is 1 week per 2.5 s.
  A day/night cycle that fast would strobe, so the sky runs on its own cosmetic clock (72 real seconds per visual day, `Clock.visualDaySeconds`), while seasons and weather follow game days.
- While a decision modal is open, the clock pauses but clouds, water, and cars keep moving, so the city still feels alive.
- **Fast-forward and skips become a time-lapse:** at "next week" or "next month" speed the sky stops crossfading every day and instead holds a blended daytime look, while the sun sweeps quickly and seasons change on the ground.
  During "skip to next event" and goal fast-forwards, the city visibly ages: seasons flash by, the player's home rebuilds tier by tier, cranes put up new towers in boom years, and the newspaper headlines scroll past, so skipping 36 years feels like watching a life happen.
- The cycle crossfades plates: night, golden (dawn), day, golden (dusk), night.
- Each plate stores a matching tint for the live layers in `city.json`, applied with a `ColorMatrixFilter`, so SVG buildings don't look pasted onto a night sky.
- At night: building windows turn on in a staggered way (a random delay per building), bridges and landmarks light up, and cars show headlights (small additive glow sprites).

### Seasons

- The season comes from the game calendar week.
- Tree and grass colors swap palettes (spring green, summer, fall orange, winter bare).
- Northern cities and templates (NYC, Northeast, Great Lakes, Mountain, Plains) get snow ground cover in winter weeks; Miami and Houston never do.

### Weather

Weather is rolled once per city per day with the same seeded RNG as everything else (key: seed, day, city, "weather"), with a bias to repeat yesterday's weather so it comes in spells instead of flickering.
Rewind and skips replay the same weather.

| Weather | Plate | Runtime effect |
| --- | --- | --- |
| Clear | Follows the clock | None |
| Cloudy | Overcast during the day | More drifting clouds |
| Rain | Overcast | Rain streaks, wet road sheen, puddle ripples on water |
| Snow | Overcast | Snowflakes, snow on roofs and ground |
| Fog | Overcast | Low fog sprites crawling across the map (SF's signature) |
| Heat or drought | Day, warm grade | Brown grass, heat shimmer filter |

A small climate table per city gives monthly odds (for example Miami rain 45% in August, SF fog 50% in summer, NYC snow 30% in January).

### Events force the weather

This ties the team's event list straight to the visuals:

| Event | Look |
| --- | --- |
| Hurricane (Miami, Houston) | Storm plate, heavy rain, wind-bent palms, big waves, lightning flashes, fewer cars, boarded windows on hit buildings |
| Snow Storm (NYC, Northeast, Great Lakes) | Heavy snow, empty roads, a snowplow vehicle |
| Forest Fire (CA, Pacific, Mountain) | Orange smoke grade, drifting embers, ash on the sky |
| Drought (Texas, Southwest, Plains) | Dry brown ground, dropping water levels, heat shimmer |
| Pandemic | Normal weather but almost no cars or people, closed signs on shops |
| Market crash or bear market | Desaturated grade, fewer cars, "for lease" signs, cranes stop moving |
| AI Bubble Pop | Tech-office landmarks go dark and their rooftop signs flicker off |

## 4. Buildings: the procedural brick builder

The one piece that must be code, because buildings show finances.
The meeting settled on one player life, so the hero building is the player's own home; whether the ~50 NPCs stay as a backdrop is still open, and the builder works either way (backdrop buildings just use a fixed or slowly drifting tier).

- A building is a small set of numbers: footprint (for example 2 x 2 tiles), floors, main color, trim color, roof type (flat, gable, dome, antenna), and window pattern.
- The builder draws iso boxes with a light top face, medium left face, dark right face, round studs on top, and a window grid.
  It caches each result as a texture, so the player's home plus about 150 backdrop buildings stay cheap.
- **Wealth tier sets the look of the player's home:** tent or car (bankrupt), studio apartment, small house, townhouse, large house, retirement home by the water.
  Goals from the meeting show up on the map too: buying a house moves the player's marker into a new house on its own lot.
  When net worth crosses a tier, the building rebuilds brick by brick with a short stacking animation, like the LEGO game's quick-build.
- **Decay:** missed payments add cracks, a "past due" sign, and a grey tint; eviction removes the building brick by brick.
- City flavor comes from palette and roof mix: Miami pastels and flat roofs, SF Victorian gables, NYC brownstones and water towers, Texas stucco and big lots.
- Palette: bright primaries and pastels on light grey baseplates, matching the toy-brick look without using LEGO's trademarked minifigure or logo designs.

## 5. Landmarks

Each landmark is one SVG in isometric view, authored by hand or with an AI assistant, and rasterized at 2x on load (`Assets.load({ src, data: { resolution: 2 } })`).
Animated parts (lights, flags, cars on bridges) are separate child sprites or Graphics layered on top, so the SVG itself stays static and fast.

| City | Landmarks | Animated parts |
| --- | --- | --- |
| Houston | Downtown towers, Rice University's Lovett Hall arches, a space-center rocket, the ship-channel cable-stayed bridge, Buffalo Bayou | Rocket launch easter egg, ship-channel tankers, bridge cable lights |
| San Francisco | Red suspension bridge, pyramid tower, tallest glass tower, Victorian row houses, cable cars on hills, island prison | Fog through the bridge towers, cable cars climbing, bay ferries |
| New York | Art Deco spire tower, Empire-style tower, stone suspension bridge, green statue on an island, park block | Yellow taxis, ferries, spire lights changing color at night |
| Dallas | Tower with a lit sphere, white arch bridge, big stadium, river | Sphere lights pulsing, stadium lights on game nights |
| Austin | Pink granite capitol, campus tower, lake with a bridge, food-truck lot | Bat swarm leaving the bridge at dusk (a particle burst), kayaks |
| Miami | Art Deco hotel strip, palm-lined beach, causeway bridge, cruise port, Brickell condo towers | Cruise ships leaving port, neon at night, palms swaying |
| Templates | State capitol dome, a water tower, a grain elevator or lighthouse per template | Flag on the capitol |

Landmarks follow the same rule as the backgrounds: our own stylized shapes, no logos or trademarked signage.
Real landmark shapes (a suspension bridge, a capitol dome) are fine to depict.

## 6. Roads, bridges, water, and traffic

### Road graph

- Each city has a `roads.json`: nodes on iso tile corners and edges between them, each edge tagged `road`, `bridge`, `highway`, or `tram`.
- Roads follow the two iso axes only, so vehicles need just 4 sprite directions (not 8).
- Bridges are edges with an elevation and an SVG deck, drawn above the water layer and below the vehicles on them.

### Vehicles

- Each vehicle has an edge, a position along it, and a speed.
  At a node it picks a random next edge (seeded), and it slows down if another vehicle is within about 1.5 car lengths ahead on the same edge.
  About 120 lines of TypeScript, and no pathfinding library needed.
- **Vehicle count follows the economy:** roughly 40 cars in a normal week, down to 15 in a bear market or pandemic, up in a boom.
  This answers the open question about whether bear markets should change the map: yes, and it's nearly free with this setup.
- City-specific vehicles: SF cable cars on `tram` edges, NYC yellow taxis, Houston pickup trucks, Miami convertibles, and boats on water paths (ferries, sailboats, cruise ships, tankers).
- A delivery van or moving truck drives to an NPC's house when they move in or out, which is a nice visual for the "moving costs money" lesson.
- Night: headlights and taillights as additive glow sprites.

### Water

- Water is an SVG polygon per city: SF Bay, the Hudson and East rivers, Biscayne Bay, Buffalo Bayou and the ship channel, Lady Bird Lake, and the Trinity River.
- Shimmer comes from a few thin highlight lines scrolling slowly, plus a light `DisplacementFilter` on storm weeks.
- Boats follow paths across the water, the same way cars follow roads.

## 7. States map and moving between cities

- **Map:** `us-atlas` (`states-10m.json`, TopoJSON built from Census boundaries) drawn with `d3-geo`'s `geoAlbersUsa` projection, which already places Alaska and Hawaii.
  Render it as SVG in the DOM overlay, not in Pixi.
- **Color:** each state is shaded by the meeting's three tiers (LCOL, MCOL, HCOL), computed from BEA RPP in `states.json`, with the 6 specialized cities marked as pins.
  A good starting cut is RPP below 95 for LCOL, 95-105 for MCOL, and above 105 for HCOL; on the sample data that puts Ohio (92.8) in LCOL, Texas (97.1) and Florida (103.4) in MCOL, and California (110.7) and New York (107.9) in HCOL.
  Rent is where the tiers really bite (Ohio 73, Texas 97, Florida and New York 122, California 154), so the move screen should show rent separately from the tier.
- **Goal link:** a "move to San Francisco" goal from the meeting shows as a dotted arc on this map from the current state, with the savings target and the year the game expects it to be reachable.
- **Browse for free:** hovering or clicking a state shows a card with rent, take-home pay for the player's job, taxes, and a thumbnail of that city's day plate.
  The player can "visit" and see the diorama and its economy without moving, as the team's update proposes.
- **Pay to move:** the confirmation screen shows the full move cost breakdown from the states research (movers, deposit, first month, lease break, DMV, unpaid time off).
  After moving, the player's choices affect that city's economy (for example, their business or home purchase shows up on that map).
- **Transition:** the camera zooms out of the diorama, a small plane or moving truck flies along an arc over the US map, and the new city's baseplate drops in brick by brick.

## 8. Data and file layout

```
public/cities/
  houston/
    plates/day.webp golden.webp night.webp overcast.webp
    landmarks/rice-lovett-hall.svg ship-channel-bridge.svg rocket.svg ...
    city.json      // layout, tints, climate, vehicles, landmark placement
    roads.json     // road graph
  san-francisco/ ...
  _templates/
    great-plains/plates/... landmarks/capitol.svg
src/data/states.json   // from the states research
src/data/us-states-10m.json
```

```ts
interface CityVisuals {
  id: string;                       // "houston"
  stateAbbr: string;                // "TX"
  template?: string;                // regional template id for non-specialized states
  plates: Record<"day" | "golden" | "night" | "overcast", string>;
  tints: Record<"day" | "golden" | "night" | "overcast", number[]>; // 5x4 color matrix
  climate: { month: number; rain: number; snow: number; fog: number; heat: number }[];
  water: { svg: string; boatPaths: [number, number][][] };
  landmarks: { svg: string; tile: [number, number]; lights?: [number, number][] }[];
  vehicles: { kind: string; weight: number; edgeTag?: "road" | "tram" | "water" }[];
  palette: { walls: string[]; roofs: string[]; roofTypes: string[] };
  snowInWinter: boolean;
}
```

## 9. 24-hour build plan for visuals

| Hours | Task | Owner |
| --- | --- | --- |
| 0-2 | Generate Houston's 4 plates in ChatGPT; lock the style prompt | Art |
| 0-3 | Pixi scene with layers 0-9, camera pan and zoom, plate crossfade on the clock | Frontend |
| 2-5 | Brick builder with wealth tiers and the rebuild animation | Frontend |
| 3-6 | Houston road graph, water, and 3 landmark SVGs | Art + frontend |
| 5-7 | Vehicles on the road graph, headlights at night | Frontend |
| 6-8 | Weather overlays (rain, fog, snow, storm) and event-forced weather | Frontend |
| 7-10 | The other 5 specialized cities: plates, water, 2 landmarks each | Art |
| 8-10 | US map with RPP shading, browse card, and move confirmation | Frontend |
| 10-12 | Regional templates (7 x 4 plates) and the capitol landmark | Art |

Cut order if time runs short: regional templates become one generic plate set, then boats, then seasons.
Never cut Houston or the vehicles, because the moving city is what makes the demo feel like the LEGO game.

## 10. Risks

- **Style mismatch** between painted plates and flat vector buildings.
  Fix: prompt the plates as "stylized toy-brick, soft gradients, not photorealistic", pick the SVG palette from the day plate, and apply the per-plate tint to the live layers.
- **Plate drift** between the 4 variants.
  Fix: always edit from the day master and reject any variant whose skyline moved.
- **Performance** with many SVGs.
  Fix: rasterize each SVG once on load, cache procedural buildings as textures, and use a ParticleContainer for weather.
- **IP:** no LEGO logos, minifigure faces, or brand signage anywhere; the reference game is only a reference.
- **Rate limits:** 5 images per minute on a Tier 1 API key, so generate in the ChatGPT app during the first hours, or queue the script.

## 11. Prototype status (2026-09-11)

The prototype in [game/](../game/) implements this doc:

- All 51 states (50 plus DC) are playable: 6 specialized cities and 7 regional templates plus a Hawaii island set, each with 4 generated plates (56 images in `game/public/cities/*/plates/`).
- All six specialized cities are hand-made:
  - Houston: Buffalo Bayou, the Ship Channel with a cable-stayed bridge to the port, a beacon tower, Lovett Hall, the domed stadium, the space-center rocket, and a refinery with a flare.
  - San Francisco: the Golden Gate across the strait, the island prison with its lighthouse, Coit Tower, the pyramid and glass towers, the Painted Ladies, and a cable car line.
  - New York: Manhattan between two rivers, Art Deco spires, a glass tower, the stone bridge to Brooklyn, and the statue on its harbor island.
  - Dallas: the Trinity River with the white arch bridge, the sphere tower, a neon-outlined tower, the stadium, and the giant boots.
  - Austin: Lady Bird Lake, the pink capitol, the campus clock tower, the owl tower, food trucks, and bats pouring from the bridge at dusk.
  - Miami: Brickell condos, Biscayne Bay causeways, the cruise terminal, the Art Deco hotel strip, lifeguard huts, and palms that bend in hurricanes.
- Landmarks stay visible from the default camera: buildings in a landmark's line of sight are capped in height (`sightlineCap` in `game/src/engine/populate.ts`).
- Cost-of-living tiers for every state come from BEA Regional Price Parities 2024 ([data/build_states_rpp.py](data/build_states_rpp.py), [data/states-rpp.json](data/states-rpp.json)): 22 LCOL, 22 MCOL, 7 HCOL (CA, DC, HI, MA, NJ, NY, WA).
- Plates are generated with `python3 game/scripts/gen_plates.py <city>` through the Codex CLI, which uses the ChatGPT login (ChatGPT Images 2.0), so no API key is needed; prompts live in `game/scripts/plate-prompts.json`.
- Events in the prototype's dev panel (hurricane, snowstorm, wildfire, drought, fog, pandemic, crash, boom) only appear where they are real hazards for that city.

## 12. Full-screen world and NPCs (2026-09-12)

After the first prototype, the team asked for the game to fill the whole screen (no generated background image), more roads and areas to drag around, states that differ from each other, and NPCs.

- **No background plates in the game.**
  The city is the whole screen; day, night, and weather come from tinting, lights, and the weather overlays.
  The generated plates are kept only as thumbnails on the states map.
- **A world around every city** (`game/src/engine/world.ts`).
  The hand-made or template core sits in the middle of a generated world about 7,000 tiles in size.
  Water and through-roads keep going past the core's edge; a suburban ring with a street grid and a beltway wraps it; beyond are country roads, farm patchwork, forest, ponds, and the state's terrain (mountains, desert, marsh, tundra, island).
  The world's outline is a rectangle on screen (a rotated square in tile space), so every tile can be reached by dragging and the camera never shows past the edge.
- **Each state is different** (`game/src/cities/vibes.ts`).
  Every non-specialized state has its own terrain, water shape, street grid, density, and signature features, for example wind farms and grain elevators in Kansas, oil pumpjacks in Oklahoma and North Dakota, a casino strip in Nevada, adobe missions and saguaros in New Mexico and Arizona, ski lifts and peaks in Colorado and Utah, a volcano in Hawaii, a glacier harbor in Alaska, riverboats and music row in Louisiana and Tennessee, lighthouses and fishing harbors in Maine, a racetrack in Indiana, and the obelisk in DC.
  The feature library (18 animated landmarks) is in `game/src/cities/features/`.
- **NPCs** (`game/src/engine/people.ts`).
  Little toy-brick people walk the sidewalks and stroll plazas and parks; foot traffic thins at night, in storms, and in a pandemic.
  Clicking one shows their name, age, job, and a thought that follows the economy and weather ("Should I sell my stocks?" in a crash, "Hope my insurance covers flood damage" in a storm).
  This is the visible hook for the planned NPC system (the "~50 NPCs as a city backdrop" open question); the simulation can later drive them with real finances.
- **Performance.** The ground is drawn in 16 x 16-tile chunks, off-screen objects are culled by precomputed bounds, and studs are octagons; a large city renders in about 12 ms per frame on a laptop.

## Sources

- OpenAI image generation guide (sizes, edits, masks, transparency on newer models): https://developers.openai.com/api/docs/guides/image-generation
- OpenAI `gpt-image-2` model page (snapshot, edits endpoint, rate limits): https://developers.openai.com/api/docs/models/gpt-image-2
- GPT Image 2 API guide (transparent background failing on gpt-image-2): https://wavespeed.ai/blog/posts/gpt-image-2-api-guide/
- GPT Image 2 pricing breakdown (per-image cost estimates): https://www.pixazo.ai/blog/gpt-image-2-api-cheapest-pricing
- PixiJS v8 SVG guide (SVG as texture with resolution, `Graphics.svg()`): https://pixijs.com/8.x/guides/components/assets/svg
- PixiJS discussion on textures from generated SVG: https://github.com/pixijs/pixijs/discussions/10953
