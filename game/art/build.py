"""Render a city's raw sprite layers: blender -b -P art/build.py -- --city san-francisco [--only <id>[,<id>...]] [--missing]
Then run art/pixelize.py to turn them into the game's pixel-art sprites."""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from catalog import CATALOG  # noqa: E402
from lib import geo, scene as S, signs  # noqa: E402
from lib.archetypes import BUILDERS as ARCHETYPES  # noqa: E402
from lib.houses import HOUSE_BUILDERS  # noqa: E402
from lib.homes import HOME_BUILDERS  # noqa: E402
from lib.property_sign import PROPERTY_BUILDERS  # noqa: E402

BUILDERS = {**ARCHETYPES, **HOUSE_BUILDERS, **HOME_BUILDERS, **PROPERTY_BUILDERS}
from lib.iso import FLOOR_PX, PLINTH_PX, Z_PX_PER_BU, body_top  # noqa: E402


def arg(name):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return argv[argv.index(name) + 1] if name in argv else None


RAW = HERE / ".raw"


def render(spec, raw):
    """Render one sprite's raw 4x layers into raw/ and return its manifest entry (final 1x file names,
    plus the raw files under "raw" for art/pixelize.py)."""
    sid, w, d, floors = spec["id"], spec["w"], spec["d"], spec["floors"]
    S.reset()
    S.day_lighting()
    peak = BUILDERS[spec["kind"]](w, d, floors, spec["seed"], **spec["opts"])
    if spec["sign"]:
        peak = max(peak, signs.place(spec["sign"], w, d, body_top(floors)))
    fw, fd = S.turn(w, d, spec["facing"]) if spec["facing"] else (w, d)
    geo.shadow_catcher(fw, fd, S.CATCHER_MARGIN)
    top_px = math.ceil(peak * Z_PX_PER_BU)
    fr = S.frame(fw, fd, top_px, extra=spec["pad"])
    files = {"day": f"{sid}.day.png", "night": f"{sid}.night.png", "ids": f"{sid}.ids.png"}
    S.render(raw / files["day"])
    S.set_night(True)
    S.render(raw / files["night"])
    entry = {
        "id": sid, "w": fw, "d": fd, "floors": floors, "zones": spec["zones"], "unique": spec["unique"],
        "brand": spec["brand"], "ax": fr["ax"], "ay": fr["ay"], "topZ": max(top_px, PLINTH_PX + floors * FLOOR_PX),
        "day": f"{sid}.png", "night": f"{sid}.night.png",
    }
    if spec["crown"]:
        files["crown"] = f"{sid}.crown.png"
        S.set_mask("crown")
        S.render(raw / files["crown"])
        S.mask_to_alpha(raw / files["crown"])
        entry["crown"] = f"{sid}.crown.png"
    if spec["walls"]:
        files["walls"] = f"{sid}.walls.png"
        S.set_night(False)
        S.set_walls()
        S.render(raw / files["walls"])
        entry["walls"] = f"{sid}.walls.png"
    S.set_ids()  # last: it replaces every material
    S.render(raw / files["ids"])
    for key, field in (("entry_kind", "kind"), ("landmark", "landmark"), ("prop", "prop"), ("side", "side"),
                       ("facing", "facing"), ("style", "style"), ("tier", "tier"), ("area", "area"),
                       ("sign_face", "signFace")):
        if spec[key] is not None:
            entry[field] = spec[key]
    if not spec["fill"]:
        entry["fill"] = False
    entry["raw"] = files
    return entry


def main():
    city, only = arg("--city"), arg("--only")
    wanted = set(only.split(",")) if only else None
    raw = RAW / city
    raw.mkdir(parents=True, exist_ok=True)
    mpath = raw / "raw.json"
    done = {e["id"]: e for e in json.loads(mpath.read_text())["sprites"]} if mpath.exists() else {}
    ids = [spec["id"] for spec in CATALOG[city]]

    def save():
        # Catalog order, only sprites that exist; written after every render so a crash loses nothing.
        mpath.write_text(json.dumps({"scale": S.SCALE, "sprites": [done[i] for i in ids if i in done]}, indent=1))

    def complete(sid):
        return sid in done and "raw" in done[sid] and all((raw / f).exists() for f in done[sid]["raw"].values())

    missing = "--missing" in sys.argv  # resume: render only what the raw manifest and folder don't have yet
    for spec in CATALOG[city]:
        if (wanted and spec["id"] not in wanted) or (missing and complete(spec["id"])):
            continue
        done[spec["id"]] = render(spec, raw)
        save()
        print(f"[art] {spec['id']} done", flush=True)
    save()
    print(f"[art] raw renders in {raw}; now run: python3 art/pixelize.py {city}", flush=True)

main()
