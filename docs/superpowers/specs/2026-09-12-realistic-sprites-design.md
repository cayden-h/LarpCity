# Realistic sprites for Larp City (San Francisco first)

## Goal

Replace the toy-brick (LEGO) look with textured realism.
Buildings and landmarks become pre-rendered Blender sprites with real material textures and real brand signage.
San Francisco is the pilot; once the look is approved, other states get their own palettes and brand lists.

## Decisions (from brainstorming, 2026-09-12)

- Art direction: textured realism (option B), pushed further with sprites.
- Sign types: all five - rooftop billboard, 3D channel letters on tower crowns, wall lightbox with branded lobby, blade sign plus painted wall ad, and night lighting for all of them.
- Brands: HackRice 16 sponsors in hero spots, filled out with companies really based in SF.
- Production: Blender renders, scripted and headless (Blender 5.2.1 installed via Homebrew at `/opt/homebrew/bin/blender`).

## What becomes a sprite

- Sprites: generic buildings in every zone, SF landmarks, trees, and sign pieces.
- Stays procedural but re-skinned: ground, roads, water, and sidewalks lose their studs and get tiling textures; traffic, people, weather, and the day/night tint stay as they are.

## Engine integration

- `bricks.ts` returns `Built` (`view`, `lights`, `blinkers`, `topZ`), and `scene.ts` only uses that interface.
- New `engine/sprites.ts` returns the same shape: `view` is the day sprite, `lights` is the matching night emissive sprite (the existing night fade drives its alpha).
- Depth sorting (`depthOf`) and tinting (`view.children[0].tint`) keep working unchanged.
- `populate.ts` picks a sprite by zone and footprint; the procedural builder stays only as a fallback for cities without sprites.

## Blender pipeline (`game/art/`)

- `build.py` runs headless: `blender -b -P art/build.py -- --city sf`.
- Orthographic camera matched to the game's projection: 2:1 tiles, 64 px per tile width, 30 degree elevation, 45 degree azimuth.
- Scene units are tiles, so a 2x2 sprite fits a 2x2 lot exactly; one floor is 20 screen pixels, as in `bricks.ts`.
- Archetypes are seeded functions: `glass_tower`, `brick_loft`, `concrete_office`, `victorian_row`, `warehouse`.
- Materials use CC0 photo textures (ambientCG, Poly Haven) stored in `art/textures/`.
- Signs are functions too: `billboard(brand)`, `channel_letters(brand)`, `lightbox(brand)`, `blade(brand)`, `wall_paint(brand)`, with official logos in `art/logos/`.
- Each sprite renders a day pass and a night emissive pass, packed into an atlas under `public/sprites/<city>/` with a `sprites.json` manifest (footprint, anchor, `topZ`).

## Brands for SF

- Capital One: the biggest billboard and a tower crown.
- Goldman Sachs: a tower crown.
- ElevenLabs, Persona, Lovable, MathWorks, Nord Security: channel letters and lightboxes downtown.
- Jeni's, BobaTalks: blade signs at street level.
- MLH: a billboard.
- Salesforce keeps its real tower; Google, Uber, Meta, and Wells Fargo get lightboxes; Levi's gets a painted wall ad.
- `brands.ts` maps brand to building and sign type per city.

## Verification

- Every sprite must register to its tile diamond within 1 px; a check script overlays the grid on each render and fails otherwise.
- Screenshots of SF at three zoom levels, day and night, compared against the approved mockups in `.superpowers/brainstorm/`.
- `npm run build` and `npm test` stay green.

## First milestone

- Three archetypes (glass tower, brick loft, concrete office), day and night.
- Two sign types (channel letters, billboard) with Capital One and Salesforce.
- Downtown SF buildings swapped to sprites, studs removed.
- The user reviews it in the dev server, then we widen the set.

## Out of scope for the milestone

- Other states, landmark sprites, trees, and ground textures (they follow once the look is approved).
