"""Validate a complete catalog's final 1x sprite set and tile registration.

Run from game/: python3 art/check_register.py san-francisco
For an intentionally incomplete sample set, add --allow-partial.
Partial mode only permits missing catalog IDs; present sprites still receive every check.
"""
import argparse
from collections import Counter
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from catalog import CATALOG  # noqa: E402
from lib.pixel import SHADOW  # noqa: E402

PUBLIC = HERE.parent / "public" / "sprites"


def check_entry(entry, spec, root, palette, night_palette):
    """Return a diagnostic, or None for a valid sprite. Walls use neutral RGB, not the day palette."""
    facing = spec.get("facing")
    w, d = spec["w"], spec["d"]
    if facing in ("e", "w"):
        w, d = d, w
    if (entry.get("w"), entry.get("d")) != (w, d):
        return "footprint differs from the rotated catalog footprint"
    for field in ("facing", "style", "tier"):
        if spec.get(field) is not None and entry.get(field) != spec[field]:
            return f"{field} differs from catalog"
    if entry.get("fill", True) != spec.get("fill", True):
        return "fill differs from catalog"
    required = {"day", "night"} | {key for key in ("walls", "crown") if spec.get(key)}
    layers = {}
    for key in ("day", "night", "walls", "crown"):
        filename = entry.get(key)
        if not filename:
            if key in required:
                return f"missing required {key} layer in manifest"
            continue
        if not isinstance(filename, str):
            return f"invalid {key} filename"
        try:
            with Image.open(root / filename) as image:
                layers[key] = np.asarray(image.convert("RGBA"))
        except (OSError, ValueError) as exc:
            return f"cannot read {key} layer {filename}: {exc}"
    day = layers["day"]
    for key, layer in layers.items():
        if layer.shape != day.shape:
            return f"{key} dimensions differ from day"
        if key != "day" and np.any((layer[..., 3] != 0) & (layer[..., 3] != 255)):
            return f"{key} contains translucent pixels"
    is_shadow = (day[..., 3] == SHADOW[3]) & np.all(day[..., :3] == SHADOW[:3], axis=-1)
    soft = int(((day[..., 3] > 0) & (day[..., 3] < 255) & ~is_shadow).sum())
    if soft:
        return f"{soft} semi-transparent day pixels"
    opaque = day[..., 3] == 255
    if not opaque.any():
        return "day has no opaque body"
    stray = {tuple(c) for c in day[opaque, :3]} - palette
    if stray:
        return f"{len(stray)} day colors outside the palette"
    night = layers["night"]
    stray = {tuple(c) for c in night[night[..., 3] == 255, :3]} - night_palette
    if stray:
        return f"{len(stray)} night colors outside the palette"
    if "walls" in layers:
        walls = layers["walls"]
        painted = walls[..., 3] > 0
        if np.any(painted & ~opaque):
            return "walls pixels outside opaque body"
        rgb = walls[painted, :3]
        if np.any(rgb[:, 0] != rgb[:, 1]) or np.any(rgb[:, 1] != rgb[:, 2]):
            return "walls must be neutral greys (R=G=B)"
    for key in ("ax", "ay"):
        if not isinstance(entry.get(key), (int, float)) or not np.isfinite(entry[key]):
            return f"missing or invalid {key} anchor"
    # Rounded towers, boards and shelters are exempt only from diamond edge alignment.
    if spec.get("fill") is False:
        return None
    ys, xs = np.nonzero(opaque)
    left, right, bottom = xs.min(), xs.max() + 1, ys.max() + 1
    want = (entry["ax"] - d * 32, entry["ax"] + w * 32, entry["ay"] + (w + d) * 16)
    error = max(abs(left - want[0]), abs(right - want[1]), abs(bottom - want[2]))
    if error > 1:
        return f"off by {error:.1f} px"
    return None


def main(argv=None, art_dir=HERE, public_dir=PUBLIC, catalog=CATALOG):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("city", choices=sorted(catalog))
    parser.add_argument("--allow-partial", action="store_true", help="allow missing catalog IDs for sample review")
    args = parser.parse_args(argv)
    root = public_dir / args.city
    try:
        manifest = json.loads((root / "sprites.json").read_text())
        saved_palette = json.loads(
            (art_dir / "palettes" / f"{args.city.replace('/', '-')}.json").read_text())
        palette = {tuple(c) for c in saved_palette["day"]}
        night_palette = {tuple(c) for c in saved_palette["night"]}
    except (OSError, ValueError, KeyError) as exc:
        print(f"BAD {args.city}: cannot load manifest/palette: {exc}")
        return 1
    if manifest.get("scale") != 1:
        print("BAD manifest: final sprite scale must be 1")
        return 1
    entries = manifest.get("sprites")
    if not isinstance(entries, list) or not entries:
        print("BAD manifest: sprites must be a nonempty list")
        return 1
    if any(not isinstance(e, dict) or not isinstance(e.get("id"), str) for e in entries):
        print("BAD manifest: every sprite needs a string id")
        return 1
    expected = {spec["id"]: spec for spec in catalog[args.city]}
    counts = Counter(entry["id"] for entry in entries)
    bad = 0

    def fail(sid, why):
        nonlocal bad
        bad += 1
        print(f"BAD {sid:36} {why}")

    for sid, count in sorted(counts.items()):
        if count > 1:
            fail(sid, "duplicate manifest id")
        if sid not in expected:
            fail(sid, "id not in catalog")
    missing = set(expected) - set(counts)
    if not args.allow_partial:
        for sid in sorted(missing):
            fail(sid, "missing catalog sprite")
    elif missing:
        print(f"--  partial sample: {len(missing)} catalog IDs omitted")
    for entry in entries:
        sid = entry["id"]
        if sid not in expected:
            continue
        why = check_entry(entry, expected[sid], root, palette, night_palette)
        if why:
            fail(sid, why)
        else:
            print(f"ok  {sid:36}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
