# Pixel world: progress and deviations

Spec: [2026-09-13-pixel-world-design.md](../specs/2026-09-13-pixel-world-design.md).
Plan: [2026-09-13-pixel-world.md](2026-09-13-pixel-world.md).

## Built

- Pixel kit (`game/src/engine/pixel/`): a hard-edged 1x rasterizer with ink outlines and flat shadows, the three-tone ramp, and shared atlas pages.
- Trees and plants: oak, Monterey cypress, pine, palm, and bush in four seeded variants, with fall color, bare winter limbs, and snow; cacti, boulders, and reeds.
- Ground: seamless 16 x 16 three-tone patterns for every terrain, laid in world space.
- Water: deep and shallow tones, stepped 3-frame glints, a 2-frame foam line, and wet sand on beaches.
- Vehicles in eight facings with additive lamps; boats in four directions with a 2-frame wake and a whole-pixel bob.
- People with three walk frames per side; signals with per-state lamps, stop and yield signs, patterned overpass decks.
- The Painted Ladies as pastel-painted house sprites.
- Max zoom raised from 3 to 4.

## Performance

Measured in Chrome on the full SF world (seed 20260912), canvas about 2400 x 1900 at device pixel ratio 2.
The window was in the background during testing, so `requestAnimationFrame` did not run; frame cost is measured instead by rendering the stage 40 times synchronously and reading back one pixel after each render so the GPU finishes.
The after column is the range of two runs.

| Zoom | Before (ms per frame) | After (ms per frame) |
|---|---|---|
| Max zoom-out (0.47, 0.45 after) | 12.59 | 8.35 to 8.73 |
| 1 | 7.67 | 6.66 to 6.74 |
| 2 | 8.21 | 6.05 to 6.22 |

Trees, cars, boats, people, and props moved from one Graphics object each to atlas sprites, which batch; every zoom is faster than before.

## Deviations from the spec

- Painted Ladies: instead of a new Blender row entry, the landmark places five of the existing SF Victorian house sprites (Queen Anne, Stick, and Italianate, facing south) with pastel wall tints through the walls layer.
  They are the same pixel-pass renders as the houses around them, so no new render or palette slots were needed; the vector model remains only as the fallback when no sprite set is loaded.
- Outlines: the Blender pass inks the outer ring of a sprite's own pixels; the code-drawn families draw the ink just outside the silhouette instead, because at 2 to 7 px wide (trunks, legs, poles, fronds) an inside outline would turn the whole shape to ink.
  Edges between parts are still inked inside, as in the pixel pass.
- Palette: the code-drawn families build their tones from the key-light ramp of each base color rather than snapping to the 40-color SF palette, because seasons, snow, drought, and car and clothing colors vary at runtime; the art tests cap each sprite at 16 colors (five surfaces of three tones plus ink).
- Ground edges: the tile polygons keep the renderer's anti-aliasing at their boundaries (the spec allowed this); the pattern inside each tile is pixel-exact.
- Thin marks (lane lines, crop rows, bridge railings, tram rails) stay as drawn lines; they read as paint and rails rather than objects.
- Out of scope and unchanged: Golden Gate Bridge, Transamerica Pyramid, Coit Tower, and Alcatraz are still vector landmarks and are the next step; so are the procedural buildings in the other five cities (`bricks.ts`).
- The rate limiter (120 requests a minute) trips on repeated reloads of the local game, which shows the "couldn't open your save" notice; browser checks used "Play without saving".
