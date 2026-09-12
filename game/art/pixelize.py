"""Pixel pass over a city's raw renders (art/.raw/<city>/) into the game's sprites (public/sprites/<city>/).

Run from game/:  python3 art/pixelize.py san-francisco [--only <id>[,<id>...]] [--new-palette]

The city palette lives in art/palettes/<city>.json. It is built from all renders the first time
(or with --new-palette) and then kept, so rerendering one sprite never shifts the others' colors.
Cast shadows are cut out before the pass and drawn back as one flat SHADOW shape, never outlined
and never part of the palette.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lib import pixel as P  # noqa: E402

DAY_COLORS, NIGHT_COLORS = 32, 16


def main(argv):
    if not argv or argv[0].startswith("--"):
        sys.exit(__doc__)
    city = argv[0]
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    raw = HERE / ".raw" / city
    out = HERE.parent / "public" / "sprites" / city
    rawinfo = json.loads((raw / "raw.json").read_text())
    if rawinfo.get("scale") != P.RAW_SCALE:
        sys.exit(f"[pixel] {raw / 'raw.json'} was rendered at scale {rawinfo.get('scale')}, "
                 f"but the pixel pass expects {P.RAW_SCALE}; rerun art/build.py")
    entries = rawinfo["sprites"]
    if only and only - {e["id"] for e in entries}:
        sys.exit(f"[pixel] not in raw.json: {', '.join(sorted(only - {e['id'] for e in entries}))}")
    out.mkdir(parents=True, exist_ok=True)
    ppath = HERE / "palettes" / f"{city.replace('/', '-')}.json"

    cache = {}

    def shrunk(e):
        """The building flattened and shrunk to 1x, its id render shrunk the same way, and its 1x shadow mask."""
        if e["id"] not in cache:
            r = e["raw"]
            day4, ids4 = P.load(raw / r["day"]), P.load(raw / r["ids"])
            building4, shadow4 = P.split_shadow(day4, ids4)
            cache[e["id"]] = (P.downsample(P.flatten(building4, ids4)), P.downsample(ids4), P.downsample_mask(shadow4))
        return cache[e["id"]]

    if "--new-palette" in argv or not ppath.exists():
        days = [shrunk(e)[0] for e in entries]
        nights = [P.downsample(P.load(raw / e["raw"]["night"])) for e in entries]
        ppath.parent.mkdir(exist_ok=True)
        ppath.write_text(json.dumps({"day": P.build_palette(days, DAY_COLORS), "night": P.build_palette(nights, NIGHT_COLORS, ink=False)}))
        print(f"[pixel] new palette {ppath.name}", flush=True)
    pal = json.loads(ppath.read_text())
    day_pal = [tuple(c) for c in pal["day"]]
    night_pal = [tuple(c) for c in pal["night"]]

    manifest = []
    for e in entries:
        final = {k: v for k, v in e.items() if k != "raw"}
        manifest.append(final)
        if only and e["id"] not in only:
            continue
        r = e["raw"]
        day1, ids1, shadow1 = shrunk(e)
        day, _lines = P.outline(P.quantize(day1, day_pal), ids1, day_pal)
        P.save(P.add_shadow(day, shadow1), out / final["day"])
        P.save(P.quantize(P.downsample(P.load(raw / r["night"])), night_pal), out / final["night"])
        if "crown" in r:
            P.save(P.downsample(P.load(raw / r["crown"])), out / final["crown"])
        print(f"[pixel] {e['id']}", flush=True)
    (out / "sprites.json").write_text(json.dumps({"scale": 1, "sprites": manifest}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
