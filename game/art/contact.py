"""Contact sheet of a city's sprites at 1x and 4x (nearest), on the reference sheet's blue-grey.

Run from game/:  python3 art/contact.py san-francisco [id-prefix]
Writes art/_contact-<city>[-<prefix>].png. Sprites with a walls layer are shown three times, with
the walls tinted pink, mint, and butter, the way the game tints them.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
BG = (138, 148, 173, 255)
TINTS = [(246, 184, 200), (191, 230, 208), (251, 231, 161)]
GAP = 12
LABEL = 14  # height of the id line above each row


def tinted(day, walls, color):
    layer = ImageChops.multiply(walls, Image.new("RGBA", walls.size, (*color, 255)))
    out = day.copy()
    out.alpha_composite(layer)
    return out


def main(argv):
    if not argv:
        sys.exit(__doc__)
    city, prefix = argv[0], argv[1] if len(argv) > 1 else ""
    root = HERE.parent / "public" / "sprites" / city
    m = json.loads((root / "sprites.json").read_text())
    rows = []
    for e in m["sprites"]:
        if not e["id"].startswith(prefix):
            continue
        day = Image.open(root / e["day"]).convert("RGBA")
        variants = [day]
        if e.get("walls"):
            walls = Image.open(root / e["walls"]).convert("RGBA")
            variants = [tinted(day, walls, c) for c in TINTS]
        rows.append((e["id"], variants))
    if not rows:
        sys.exit(f"[contact] no sprites in {root / 'sprites.json'} start with {prefix!r}")
    one_w = max(v[0].width for _, v in rows)
    row_h = [max(v[0].height * 4, 16) for _, v in rows]
    width = GAP + (one_w + GAP) + max(len(v) for _, v in rows) * (one_w * 4 + GAP)
    sheet = Image.new("RGBA", (width, sum(row_h) + GAP * (len(rows) + 1) + LABEL * len(rows)), BG)
    draw = ImageDraw.Draw(sheet)
    y = GAP
    for (sid, variants), h in zip(rows, row_h):
        draw.text((GAP, y), sid, fill=(20, 20, 30, 255))
        y += LABEL
        sheet.alpha_composite(variants[0], (GAP, y + h - variants[0].height))
        x = GAP + one_w + GAP
        for v in variants:
            big = v.resize((v.width * 4, v.height * 4), Image.NEAREST)
            sheet.alpha_composite(big, (x, y))
            x += one_w * 4 + GAP
        y += h + GAP
    name = f"_contact-{city.replace('/', '-')}{'-' + prefix if prefix else ''}.png"
    sheet.save(HERE / name)
    print(HERE / name)


if __name__ == "__main__":
    main(sys.argv[1:])
