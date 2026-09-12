"""Fail if any sprite's opaque body is off its tile diamond by more than one game pixel."""
import json
import sys
from pathlib import Path

from PIL import Image

city = sys.argv[1]
root = Path(__file__).resolve().parent.parent / "public" / "sprites" / city
m = json.loads((root / "sprites.json").read_text())
s, bad = m["scale"], 0
for e in m["sprites"]:
    if e.get("fill") is False:  # rounded towers, freeway boards and shelters don't fill their lot
        print(f"--  {e['id']:32} (not a full-lot box)")
        continue
    alpha = Image.open(root / e["day"]).getchannel("A").point(lambda v: 255 if v > 230 else 0)
    l, _, r, b = alpha.getbbox()
    want = ((e["ax"] - e["d"] * 32) * s, (e["ax"] + e["w"] * 32) * s, (e["ay"] + (e["w"] + e["d"]) * 16) * s)
    err = max(abs(l - want[0]), abs(r - want[1]), abs(b - want[2]))
    ok = err <= 2 * s
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} {e['id']:32} off by {err / s:.1f} px")
sys.exit(1 if bad else 0)
