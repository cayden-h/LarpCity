# SF brands: progress

Spec: [2026-09-13-sf-brands-design.md](../specs/2026-09-13-sf-brands-design.md).
Plan: [2026-09-13-sf-brands.md](2026-09-13-sf-brands.md).

## Done

- Roster as data: `game/art/brands.py` holds all 37 brands (the 17 first brands, with their hand-drawn art kept byte for byte, and the 20 new companies).
  `catalog.py` builds every branded entry from it, and `make_ads.py` draws every sign file the catalog names, by hand (`CUSTOM`) for the first brands and with shared layouts and a mark library (`MARKS`) for the rest.
- New sign surfaces: wall boards on the blank right wall of low offices and lofts (`signs.wall_board`), HQ name bands over the lobby on both faces (`signs.name_band`), storefronts on 1x1 and 1x2 lots (each face takes the band that fits its span), and HQs in any footprint.
- Placement: branded buildings are placed first, each on the best free lot of its footprint (`brandLots` in `lots.ts`), preferring its area (`areas` in `san-francisco.ts`: SoMa and the Embarcadero), then its zone's core.
  Google, Meta, and Goldman Sachs, which never appeared before, now do.
- Freeway V boards are props placed beside the highway stretch nearest downtown (`placeVBoards`), no longer on midtown lots.
- Palette: 52 day colors with 24 reserved for signs (was 40 and 12), rebuilt once for the whole SF set.
- Tests: `art/tests/test_brands.py` (art coverage both ways, letter contrast, capital heights at 1x per surface), `tests/brands.test.ts` (every brand placed once in its zones for three seeds; area preference), and a `placeVBoards` test.

## Performance

Measured as in the [pixel world progress doc](2026-09-13-pixel-world-progress.md): Chrome, full SF world, 40 synchronous renders with a one-pixel readback after each.

PERF_TABLE

## Deviations from the spec

- Goldman Sachs and Meta moved from 2x1 to 2x2 HQs, because downtown has only two 2x1 lots and the Capital One Café needs one; their sprite ids changed with the footprint.
- The brand-colored entrance canopy was left out: the lit name band spans the facade right over the lobby and does the same job, and a second brand-colored slab below it read as clutter.
- Freeway placement uses the highway tiles themselves rather than a named `freeway` area, since the highway ring lies outside the hand-made core that areas are drawn in.
- Tiger Data's bulletin stacks its name on two lines ("TIGER / DATA") so its capitals reach 7 px; the spec's "TIGER DATA" on one line came out at 6.3 px.
- Bulletins, V boards, and wall boards share one 2:1 art file per brand (`bb-<id>.png`).
- The Goldman Sachs monument file is now `mo-goldman-sachs.png` (named from the brand id like every other sign); its art is unchanged.
