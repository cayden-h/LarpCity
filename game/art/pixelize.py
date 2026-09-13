"""Pixel pass over a city's raw renders (art/.raw/<city>/) into the game's sprites (public/sprites/<city>/).

Run from game/:  python3 art/pixelize.py san-francisco [--only <id>[,<id>...]] [--new-palette]

The city palette lives in art/palettes/<city>.json. It is built from all renders the first time
(or with --new-palette) and then kept, so rerendering one sprite never shifts the others' colors.
Cast shadows are cut out before the pass and drawn back as one flat SHADOW shape, never outlined
and never part of the palette. After writing, every file the manifest names must exist and be newer
than its raw renders; the run fails listing the ids that are missing or stale. That check guards against
forgetting to rerun this after Blender; it cannot catch teammates' sprites pulled from git.
"""
import argparse
import json
import sys
from functools import cached_property
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lib import pixel as P  # noqa: E402

DAY_COLORS, NIGHT_COLORS = 40, 16
# Of the day colors, this many are cut from sign and lit-glass pixels alone (P.build_day_palette), so brand reds,
# golds, and oranges, and the shop windows' warm glow, survive next to the glass towers' many blues.
SIGN_COLORS = 12
# Past this share of sign pixels landing on a clearly different palette color (P.SIGN_MISS), the signs need more
# than SIGN_COLORS colors: the median cut is merging brand colors, so the palette build warns.
SIGN_MISS_SHARE = 0.05
PUBLIC = HERE.parent / "public" / "sprites"
OUTPUTS = ("day", "night", "crown", "walls")  # manifest keys that name a file in public/sprites/<city>/


class RawSprite:
    """One sprite's raw 4x layers, each loaded once, and the 1x layers derived from them.

    A layer added later (the walls) reads ids4 and lines1 from here, so it needs no reload of its own."""

    def __init__(self, raw_dir: Path, entry: dict):
        self.dir, self.entry, self.id = raw_dir, entry, entry["id"]
        self._layers = {}
        self.lines1 = None  # the day's outline mask at 1x, set by outlined()

    def layer4(self, name: str) -> np.ndarray:
        """A raw 4x layer by its raw.json key ("day", "night", "ids", "crown")."""
        if name not in self._layers:
            self._layers[name] = P.load(self.dir / self.entry["raw"][name])
        return self._layers[name]

    @property
    def ids4(self) -> np.ndarray:
        return self.layer4("ids")

    @cached_property
    def split4(self):
        """The building (the day render without its cast shadow) and the 4x shadow mask."""
        return P.split_shadow(self.layer4("day"), self.ids4)

    @cached_property
    def day1(self) -> np.ndarray:
        return P.downsample(P.flatten(self.split4[0], self.ids4), sign=self.sign4)

    @cached_property
    def sign4(self) -> np.ndarray:
        """Which sign object each 4x pixel belongs to (P.sign_labels), so its strokes survive the downsample."""
        return P.sign_labels(self.ids4)

    @cached_property
    def ids1(self) -> np.ndarray:
        return P.downsample(self.ids4)

    @cached_property
    def accent1(self) -> np.ndarray:
        """Where the 1x ids are a sign or glass lit by day: the pixels that get the reserved palette colors."""
        return P.is_sign(self.ids1) | P.is_lit(self.ids1)

    @cached_property
    def shadow1(self) -> np.ndarray:
        # the building joins the mask, so a block that is part shadow and part building never becomes a gap
        # between the two; add_shadow never paints over the building itself
        building4, shadow4 = self.split4
        return P.downsample_mask(shadow4 | P.opaque(building4))

    @cached_property
    def night1(self) -> np.ndarray:
        return P.downsample(self.layer4("night"), sign=self.sign4)

    def shrink(self) -> "RawSprite":
        """Derive every 1x layer, then drop the 4x ones, so a whole-city palette build never holds every raw
        render at once (a later layer may reload ids4 once)."""
        # reading a cached property computes and keeps it
        self.day1
        self.ids1
        self.accent1
        self.shadow1
        self.night1
        self.release()
        return self

    def release(self) -> None:
        """Drop the 4x layers; the 1x ones stay."""
        self._layers.clear()
        self.__dict__.pop("split4", None)
        self.__dict__.pop("sign4", None)

    def outlined(self, day_pal) -> np.ndarray:
        """The day quantized and outlined; its line mask is kept as lines1."""
        day, self.lines1 = P.outline(P.quantize(self.day1, day_pal), self.ids1, day_pal)
        return day


def pixelize_one(src: RawSprite, day_pal, night_pal) -> dict[str, np.ndarray]:
    """Every final 1x layer of one sprite, keyed by its manifest key."""
    layers = {
        "day": P.add_shadow(src.outlined(day_pal), src.shadow1),
        "night": P.quantize(src.night1, night_pal),
    }
    if "crown" in src.entry["raw"]:
        # the crown is a white mask the game tints and animates itself, so it is shrunk but not quantized
        layers["crown"] = P.downsample(src.layer4("crown"))
    return layers


def stale(raw_dir: Path, out: Path, entries) -> list[str]:
    """Ids of raw entries whose manifest files are missing from out or older than any of their raw renders.
    An entry missing one of its raw renders counts as stale too."""
    bad = []
    for e in entries:
        raws = [raw_dir / f for f in e["raw"].values()]
        if not all(f.exists() for f in raws):
            bad.append(e["id"])
            continue
        newest = max(f.stat().st_mtime_ns for f in raws)
        files = [out / e[k] for k in OUTPUTS if e.get(k)]
        if any(not f.exists() or f.stat().st_mtime_ns < newest for f in files):
            bad.append(e["id"])
    return bad


def parse(argv):
    ap = argparse.ArgumentParser(prog="art/pixelize.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("city", help="the city folder, e.g. san-francisco")
    ap.add_argument("--only", type=lambda s: set(s.split(",")), metavar="ID[,ID...]",
                    help="rewrite only these sprites (the manifest still lists every one)")
    ap.add_argument("--new-palette", action="store_true", help="rebuild the city palette from every render")
    args = ap.parse_args(argv)
    if args.only and args.new_palette:
        ap.error("--new-palette changes every sprite's colors, so it cannot run with --only; drop --only")
    return args


def main(argv, art_dir: Path = HERE, public_dir: Path = PUBLIC):
    args = parse(argv)
    raw = art_dir / ".raw" / args.city
    out = public_dir / args.city
    rawinfo = json.loads((raw / "raw.json").read_text())
    if rawinfo.get("scale") != P.RAW_SCALE:
        sys.exit(f"[pixel] {raw / 'raw.json'} was rendered at scale {rawinfo.get('scale')}, "
                 f"but the pixel pass expects {P.RAW_SCALE}; rerun art/build.py")
    entries = rawinfo["sprites"]
    unknown = (args.only or set()) - {e["id"] for e in entries}
    if unknown:
        sys.exit(f"[pixel] not in raw.json: {', '.join(sorted(unknown))}")
    sources = {e["id"]: RawSprite(raw, e) for e in entries}
    ppath = art_dir / "palettes" / f"{args.city.replace('/', '-')}.json"

    if args.new_palette or not ppath.exists():
        print(f"[pixel] building palette from {len(sources)} sprites", flush=True)
        shrunk = [s.shrink() for s in sources.values()]
        pal = {"day": P.build_day_palette([s.day1 for s in shrunk], [s.accent1 for s in shrunk], DAY_COLORS, SIGN_COLORS),
               "night": P.build_palette([s.night1 for s in shrunk], NIGHT_COLORS, ink=False)}
        ppath.parent.mkdir(parents=True, exist_ok=True)
        ppath.write_text(json.dumps(pal, indent=1))
        print(f"[pixel] new palette {ppath.name}", flush=True)
        miss = P.sign_misfit([s.day1 for s in shrunk], [s.accent1 for s in shrunk], pal["day"])
        if miss > SIGN_MISS_SHARE:
            print(f"[pixel] warning: {miss:.0%} of sign pixels land more than {P.SIGN_MISS} from every palette color; "
                  f"the signs need more than SIGN_COLORS ({SIGN_COLORS}) colors, so the median cut is merging brand "
                  "colors", file=sys.stderr, flush=True)
    pal = json.loads(ppath.read_text())
    day_pal = [tuple(c) for c in pal["day"]]
    night_pal = [tuple(c) for c in pal["night"]]

    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for e in entries:
        final = {k: v for k, v in e.items() if k != "raw"}
        manifest.append(final)
        if args.only and e["id"] not in args.only:
            continue
        src = sources[e["id"]]
        for key, layer in pixelize_one(src, day_pal, night_pal).items():
            P.save(layer, out / final[key])
        src.release()
        print(f"[pixel] {e['id']}", flush=True)
    (out / "sprites.json").write_text(json.dumps({"scale": 1, "sprites": manifest}, indent=1))

    bad = stale(raw, out, entries)
    if bad:
        sys.exit(f"[pixel] missing, or older than their raw renders (rerun them): {', '.join(bad)}")


if __name__ == "__main__":
    main(sys.argv[1:])
