# Pixel world: everything that is not a house

## Goal

Bring every non-house part of the world up to the pixel-art look of the SF houses (PR #23): trees and plants, grass and ground, water and shorelines, beaches, roads and street props, vehicles, boats, people, and the Painted Ladies.
The look is the one approved in [2026-09-12-blender-houses-design.md](2026-09-12-blender-houses-design.md): one warm key light (top lightest, left face lit, right face shaded), a 1 px ink outline `#2b2233`, at most three flat tones per surface, flat translucent shadows (ink at alpha 96), no blur, no gradients, no anti-aliased edges, nearest-neighbor magnification.

## Where each family comes from

| Family | Source | Why |
|---|---|---|
| Painted Ladies | Blender sprite through the pixel pass | It is a building. A row of six `victorian` models from `art/lib/houses.py` in fixed pastel paints gives it the exact look of the houses around it for free, and the landmark path (`spriteLandmark`) already exists. |
| Trees, bushes, palms, cacti, reeds, boulders | Pixel sprites generated in code | They need seeded variants, four seasons, bare and snowy states, and leaf colors that follow the city palette. That is thousands of combinations, cheap to generate at 1x and impossible to pre-render. |
| Cars, buses, cable cars | Pixel sprites generated in code | They are 20 to 40 px at 1x. The pixel pass downsamples 4x by majority color, which erases details this small (wheels, windshields, light bars), while drawing at 1x keeps every pixel intended. Eight facings times ten kinds times body colors are made on demand. |
| Boats | Pixel sprites generated in code | Same size argument; six kinds in four directions, and the wake animates. |
| People | Pixel sprites generated in code | 10 x 20 px figures with two walk frames and swapped skin, hair, shirt, and pants colors. |
| Street props (signals, stop and yield signs, overpass decks, bridge railings) | Pixel sprites generated in code | Tiny, and signal lamps change color every few seconds. |
| Grass, sand, forest floor, fields, rock, lots, plazas, roads, water | Pixel pattern textures generated in code | The ground tiles across the whole map and changes with season, snow, and drought; patterns are regenerated when the look changes. |
| Shorelines and water animation | Pixel pattern textures and animated pixel sprites in code | Foam and ripples need frames, not renders. |

Code-generated art follows the same rules as the pixel pass, enforced by one shared module rather than by each drawing.

## The pixel kit (`game/src/engine/pixel/`)

- `canvas.ts`: `PixelCanvas`, a small software rasterizer at 1x into an RGBA buffer.
  Polygons, rectangles, ellipses, and lines are filled with hard edges (a pixel is in or out, by its center), so nothing is ever anti-aliased.
  `outline()` draws the ink outline on every opaque pixel next to transparency, and on edges between parts marked as separate, like the pixel pass does.
  It runs in Node with no DOM, so the art is unit-tested.
- `tones.ts`: `ramp(base)` gives the lit, mid, and shaded tones from one base color, with the same key-light factors as the pixel pass (top lightest, left lit, right shaded), and `snap(color, palette)` snaps a fixed color to the city palette.
  Cars, boats, people, and props use colors from `art/palettes/san-francisco.json`; seasonal leaf and ground colors build their ramps at runtime from the season color, since the palette has no seasons.
- `atlas.ts`: packs generated canvases into shared 2048 x 2048 atlas textures on first use, keyed by what they show (for example `tree:oak:2:summer:0x5db43f`), with nearest magnification like the building sprites.
  Everything drawn from one atlas batches into a few draw calls, which is where the performance comes from.
- Everything is seeded from the world seed, so a tile's trees and a car's look replay identically.

## Families

### Trees and plants

- Species: round deciduous (oak), Monterey cypress (flat-topped, wind-shaped), cone pine, palm (Dolores and the Embarcadero), and a bush; four seeded variants each.
- Canopies are clusters of pixel blobs lit from the upper left, three tones, outlined; trunks are two tones.
- Seasons change the leaf ramp; fall mixes in orange, winter deciduous trees are bare branches, and snow adds a white cap on the lit side.
- Groves stay one container per tile, now holding sprites instead of Graphics.
- Cacti, reeds, and boulders get the same treatment.

### Ground

- Each terrain type gets an 8 x 8 px pattern texture in three tones (grass tufts, sand speckle and ripple lines, soil furrows, forest-floor litter, rock cracks, asphalt grain, plaza paving joints, lot gravel), filled in world space so the pattern runs seamlessly across tiles.
- The chunked drawing, culling, and redraw-on-look-change stay as they are.
- Crop rows become 2 px pixel rows; curbs, lane marks, and tram rails snap to whole pixels.
- Plate edges and banks become two flat tones with an ink line on the top edge.

### Water and shorelines

- Water gets a deep and a shallow tone: tiles next to land are shallow, the rest deep, each with a sparse pixel ripple pattern.
- A 2 px foam line runs along every land-water edge, and sand beaches get a wet-sand band.
- Animation: the smooth shimmer strips become pixel ripple sprites (3 frames) that step at 4 frames per second at seeded phases, and the foam line alternates between two frames.
  Stepped, never faded, so there is never a half-transparent pixel.

### Vehicles

- The existing box geometry (`vehicleContext` in `traffic.ts`) is rasterized into a `PixelCanvas` instead of a Graphics context, at 8 facings, then outlined.
- Wheels become 2 x 2 px dark blocks, windows get one light pixel of glare, and the shadow is one flat ink tone.
- Headlights and tail lights are single bright pixels plus a small stepped glow, drawn additively at night as now.
- Cars stay one sprite each, all from the vehicle atlas.

### Boats

- Tanker, cruise ship, ferry, tug, sailboat, speedboat, and kayak as pixel sprites in four directions.
- The wake is a 2-frame pixel foam trail; the night lamp is one pixel with a stepped glow.
- The bob moves in whole pixels.

### People

- 10 x 20 px figures: head, hair or cap, shirt, arms, and pants in two tones each, outlined, with two walk frames swapped as they move (replacing the leg-scaling animation).
- The resident marker becomes a pixel ring.

### Street props and bridges

- Signal heads, stop and yield signs, overpass decks, and the ground bridges become pixel sprites and pixel-pattern fills; each signal state is a separate frame from the atlas.

### Painted Ladies

- A new landmark entry in `art/catalog.py`, `painted-ladies`, for landmark `sf-painted-ladies`: six `victorian` models side by side, in the six current pastel paints with white trim, facing the park.
- Rendered and pixelized with the rest of the SF set, checked by `check_register.py`, and drawn through `spriteLandmark`, so the vector factory remains only as the fallback for cities without sprites.

## Day, night, and rain

- The scene's time-of-day tint multiplies every family as it does today, so the art stays crisp at night.
- Lit things (car lights, boat lamps, signal lamps, the Painted Ladies' windows) use the additive night layer or additive sprites as now.
- Rain and storms keep using the existing weather layer; the check is that nothing looks wrong under it.

## Zoom and crispness

- `MAX_ZOOM` is 3 today; it becomes 4, so the art can be seen (and checked) at 4x.
- Sprites and pattern textures use nearest magnification, and object positions round to whole world pixels, so edges stay square at 1x, 2x, 3x, and 4x.
- The ground's polygon edges between tiles fall on the tile diamond, so the canvas anti-aliasing setting can stay on.

## Performance

- Baseline and after: FPS and draw calls with the full SF world at max zoom-out and at 2x, measured the same way before any change and after the last one, written in the progress doc.
- Trees, cars, and people move from one Graphics each to atlas sprites, which should cut draw calls; the target is at least today's FPS.

## Testing

- Unit tests (Node) for `PixelCanvas`: hard-edged fills, outline placement, no pixel with partial alpha except the shadow tone, and determinism (same seed, same bytes).
- Art tests per family: every generated sprite uses at most three tones per part plus ink and shadow, and has an outline.
- `check_register.py` and the Python art tests stay green with the Painted Ladies sprite added.
- A contact sheet script (`npm run art:contact-code`) writes every generated family at 1x and 4x to a local PNG for review.

## Out of scope

- The procedural buildings in the other five cities (`bricks.ts`), the weather app, and interstate travel; `setPlace` is not used.
- Golden Gate Bridge, Transamerica Pyramid, Coit Tower, and Alcatraz are also still drawn as vector shapes today; they are landmarks, not in the list for this pass, and are recorded as the next step in the progress doc.

## Progress and deviations

`docs/superpowers/plans/2026-09-13-pixel-world-progress.md` records what was built, the FPS numbers, and every place the result deviates from this spec.
