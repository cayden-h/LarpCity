# Pixel World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every non-house world asset in SF drawn as pixel art matching the houses ([spec](../specs/2026-09-13-pixel-world-design.md)).

**Architecture:** A shared pixel kit (`game/src/engine/pixel/`) rasterizes hard-edged art at 1x into RGBA buffers, outlines it, and packs it into nearest-sampled atlases; each family (trees, ground, water, vehicles, boats, people, props) swaps its Graphics drawing for kit sprites or pattern fills. The Painted Ladies become a Blender landmark sprite built from the existing `victorian` archetype.

**Tech Stack:** TypeScript, PixiJS 8.20, Node test runner, Blender + Python pixel pass.

The plan is deliberately compact (the user asked to conserve tokens): each task names files, interfaces, and tests; code is written during execution.

---

### Task 0: Baseline

- [ ] Run server (`PORT=3100`, local `DATABASE_URL`) and Vite (`--port 5190`); measure FPS and draw calls with full SF at max zoom-out and at 2x; record in the progress doc.

### Task 1: Pixel kit

**Files:** Create `game/src/engine/pixel/{canvas,tones,atlas}.ts`; test `game/tests/pixel-canvas.test.ts`.

- [ ] Tests first: `PixelCanvas(w,h)`; `poly(pts,color)`, `rect`, `ellipse`, `line` fill pixels by center with no partial alpha; `outline(ink)` marks opaque pixels touching transparency (and `part` boundaries); same inputs give same bytes; `ramp(base)` returns `[lit, mid, shade]`; `snap` returns the nearest palette color.
- [ ] Implement; `atlas.ts`: `pixelTexture(key, make: () => PixelCanvas): Texture` packs into 2048² `CanvasSource`/`BufferImageSource` pages, `scaleMode: "nearest"` for magnification; anchor stored per frame.
- [ ] `npm test` green, commit.

### Task 2: Trees and plants

**Files:** Create `game/src/engine/pixel/plants.ts`; modify `engine/bricks.ts` (`buildTree`, `buildGrove`), `engine/populate.ts` (cactus, boulder, reeds); test `tests/pixel-plants.test.ts`.

- [ ] Tests: 4 variants per species differ; each sprite has an ink outline, at most 3 leaf tones plus trunk tones, ink, and the shadow tone; bare and snow states render.
- [ ] Implement species oak, cypress, pine, palm, bush; cactus, boulder, reeds. Views become Sprites (anchor at the trunk foot) in the existing per-tile containers.
- [ ] Commit.

### Task 3: Ground patterns

**Files:** Create `game/src/engine/pixel/ground-tiles.ts`; modify `engine/ground.ts`.

- [ ] 8x8 three-tone patterns per terrain (grass, sand, soil, forest, rock, asphalt, plaza, lot, marsh), from the look's colors; fills use `{ texture, textureSpace: "global" }`.
- [ ] Crop rows, curbs, rails, marks on whole pixels; banks and plate edges two tones plus an ink top line; bridges' railings as pixel rects.
- [ ] Commit.

### Task 4: Water and shorelines

**Files:** modify `engine/ground.ts`; create `engine/pixel/water.ts`.

- [ ] Deep and shallow water patterns; 2 px foam on land-water edges; wet-sand band on beaches.
- [ ] Replace shimmer with 3-frame pixel ripple sprites stepping at 4 fps (seeded phase); foam with 2 frames. Commit.

### Task 5: Vehicles

**Files:** modify `engine/traffic.ts`; create `engine/pixel/vehicles.ts`; test `tests/pixel-vehicles.test.ts`.

- [ ] Port `box()` to `PixelCanvas`; `vehicleTexture(look, facing)` and `lampTexture(facing)`; CarView body and lamps become Sprites. Tests: 8 facings for every kind, outlined, deterministic.
- [ ] Commit.

### Task 6: Boats

- [ ] `boatTexture(kind, dir, frame)` in `engine/pixel/boats.ts`, four directions, 2 wake frames; whole-pixel bob. Commit.

### Task 7: People

- [ ] `personFrames(look)` in `engine/pixel/people.ts`: 10x20, two walk frames plus standing; `drawPerson` returns a Sprite; walk cycle swaps frames; pixel resident ring. Keep `pickAt` offsets. Commit.

### Task 8: Street props

- [ ] Signal heads (one frame per light state), stop and yield signs, overpass decks in `engine/pixel/props.ts`; modify `roads/draw.ts`. Commit.

### Task 9: Painted Ladies sprite

**Files:** modify `game/art/catalog.py`, `game/art/lib/houses.py` (row builder), tests in `game/art/tests/test_catalog.py`.

- [ ] Landmark entry `painted-ladies` -> `sf-painted-ladies`, six victorian models, fixed pastel paints, white trim.
- [ ] `build.py --only`, `pixelize.py --only`, `check_register.py`, contact sheet review at 1x and 4x. Commit sprite + manifest.

### Task 10: Zoom, crispness, contact sheet

- [ ] `MAX_ZOOM = 4`; round object positions to world pixels; `npm run art:contact-code` script (`scripts/pixel-contact.ts`) writing every generated family at 1x and 4x to `art/_contact-code.png` (not committed). Review and fix.

### Task 11: Verification and docs

- [ ] FPS after; `npm run build`, `npm test` in game; `npm test` with `TEST_DATABASE_URL` local and `tsc` in server.
- [ ] Browser E2E on :5190: downtown, the Sunset, Alamo Square, Golden Gate Park, the bay and bridge, the suburb ring, farms and terrain; day and night; zooms 1, 2, 4; rain.
- [ ] Progress doc with deviations; `game/README.md` section; rebase on origin/main; open PR; ask before merging.
