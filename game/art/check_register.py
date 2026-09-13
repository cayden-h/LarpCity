"""Fail if any sprite is off its tile diamond by more than one game pixel, or skipped the pixel pass
(semi-transparent pixels other than the flat cast shadow, or colors outside the city palette).

Run from game/:  python3 art/check_register.py san-francisco
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.pixel import SHADOW  # noqa: E402

city = sys.argv[1]
here = Path(__file__).resolve().parent
root = here.parent / "public" / "sprites" / city
m = json.loads((root / "sprites.json").read_text())
palette = {tuple(c) for c in json.loads((here / "palettes" / f"{city.replace('/', '-')}.json").read_text())["day"]}
s, bad = m["scale"], 0


def fail(sid, why):
    global bad
    bad += 1
    print(f"BAD {sid:36} {why}")


for e in m["sprites"]:
    a = np.asarray(Image.open(root / e["day"]).convert("RGBA"))
    # The flat cast shadow (lib/pixel.py SHADOW) is the one allowed translucent color.
    is_shadow = (a[..., 3] == SHADOW[3]) & np.all(a[..., :3] == SHADOW[:3], axis=-1)
    soft = int(((a[..., 3] > 0) & (a[..., 3] < 255) & ~is_shadow).sum())
    if soft:
        fail(e["id"], f"{soft} semi-transparent pixels")
        continue
    stray = {tuple(c) for c in a[a[..., 3] == 255][:, :3].tolist()} - palette
    if stray:
        fail(e["id"], f"{len(stray)} colors outside the palette")
        continue
    if e.get("fill") is False:  # rounded towers, freeway boards and shelters don't fill their lot
        print(f"--  {e['id']:36} (not a full-lot box)")
        continue
    ys, xs = np.nonzero(a[..., 3] == 255)  # the building only; the shadow may run past the diamond
    l, r, b = xs.min(), xs.max() + 1, ys.max() + 1
    want = ((e["ax"] - e["d"] * 32) * s, (e["ax"] + e["w"] * 32) * s, (e["ay"] + (e["w"] + e["d"]) * 16) * s)
    err = max(abs(l - want[0]), abs(r - want[1]), abs(b - want[2])) / s
    if err > 1:
        fail(e["id"], f"off by {err:.1f} px")
    else:
        print(f"ok  {e['id']:36} off by {err:.1f} px")
sys.exit(1 if bad else 0)
