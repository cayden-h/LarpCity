"""Render a city's sprites: blender -b -P art/build.py -- --city san-francisco [--only <id>[,<id>...]] [--missing]"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from catalog import CATALOG  # noqa: E402
from lib import geo, scene as S, signs  # noqa: E402
from lib.archetypes import BUILDERS  # noqa: E402
from lib.iso import FLOOR_PX, PLINTH_PX, Z_PX_PER_BU, body_top  # noqa: E402


def arg(name):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return argv[argv.index(name) + 1] if name in argv else None


def render(spec, out):
    sid, w, d, floors = spec["id"], spec["w"], spec["d"], spec["floors"]
    S.reset()
    S.day_lighting()
    peak = BUILDERS[spec["kind"]](w, d, floors, spec["seed"], **spec["opts"])
    if spec["sign"]:
        peak = max(peak, signs.place(spec["sign"], w, d, body_top(floors)))
    geo.shadow_catcher(w, d)
    top_px = math.ceil(peak * Z_PX_PER_BU)
    fr = S.frame(w, d, top_px, extra=spec["pad"])
    S.render(out / f"{sid}.png")
    S.set_night(True)
    S.render(out / f"{sid}.night.png")
    entry = {
        "id": sid, "w": w, "d": d, "floors": floors, "zones": spec["zones"], "unique": spec["unique"],
        "brand": spec["brand"], "ax": fr["ax"], "ay": fr["ay"], "topZ": max(top_px, PLINTH_PX + floors * FLOOR_PX),
        "day": f"{sid}.png", "night": f"{sid}.night.png",
    }
    if spec["crown"]:
        S.set_mask("crown")
        S.render(out / f"{sid}.crown.png")
        S.mask_to_alpha(out / f"{sid}.crown.png")
        entry["crown"] = f"{sid}.crown.png"
    for key, field in (("entry_kind", "kind"), ("landmark", "landmark"), ("prop", "prop"), ("side", "side")):
        if spec[key]:
            entry[field] = spec[key]
    if not spec["fill"]:
        entry["fill"] = False
    return entry


def main():
    city, only = arg("--city"), arg("--only")
    wanted = set(only.split(",")) if only else None
    out = HERE.parent / "public" / "sprites" / city
    out.mkdir(parents=True, exist_ok=True)
    mpath = out / "sprites.json"
    done = {e["id"]: e for e in json.loads(mpath.read_text())["sprites"]} if mpath.exists() else {}
    ids = [spec["id"] for spec in CATALOG[city]]

    def save():
        # Catalog order, only sprites that exist; written after every render so a crash loses nothing.
        mpath.write_text(json.dumps({"scale": S.SCALE, "sprites": [done[i] for i in ids if i in done]}, indent=1))

    missing = "--missing" in sys.argv  # resume: render only what the manifest doesn't have yet
    for spec in CATALOG[city]:
        if (wanted and spec["id"] not in wanted) or (missing and spec["id"] in done):
            continue
        done[spec["id"]] = render(spec, out)
        save()
        print(f"[art] {spec['id']} done", flush=True)
    save()


main()
