"""Contact sheets of a city's sprites at 1x and 4x (nearest), on the reference sheet's blue-grey.

Run from game/:  python3 art/contact.py san-francisco [id-prefix]
Writes art/_contact-<city>[-<prefix>]-<n>.png: sprites sit in a grid that wraps at MAX_W pixels and starts
a new page past MAX_H, and each page's path is printed. Sprites with a walls layer are shown three times,
with the walls tinted pink, mint, and butter, the way the game tints them.
"""
import argparse
import json
import re
from math import ceil
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BG = (138, 148, 173, 255)
TINTS = [(246, 184, 200), (191, 230, 208), (251, 231, 161)]
GAP = 12
LABEL = 14            # height of the id line above each sprite
MAX_W = MAX_H = 4000  # a page's size limit; a sprite bigger than that gets a row or a page to itself
FONT = ImageFont.load_default()  # the labels' font, also used to measure them


def tinted(day, walls, color):
    layer = ImageChops.multiply(walls, Image.new("RGBA", walls.size, (*color, 255)))
    out = day.copy()
    out.alpha_composite(layer)
    return out


def cell_size(label, variants):
    """A sprite's cell: its label, then the 1x sprite and each variant at 4x in a row, bottoms aligned. It is
    never narrower than the label, so a label never runs into the next cell."""
    w, h = variants[0].size
    return max(w + len(variants) * (w * 4 + GAP), ceil(FONT.getlength(label))), LABEL + max(h * 4, 16)


def layout(sizes, max_w=MAX_W, max_h=MAX_H):
    """Pack cells of the given (w, h) sizes, in order, into rows that wrap at max_w and pages that end at max_h.
    Returns one (cells, width, height) per page, where cells are (index, x, y)."""
    rows, row, x = [], [], GAP
    for i, (w, _) in enumerate(sizes):
        if row and x + w + GAP > max_w:
            rows.append(row)
            row, x = [], GAP
        row.append((i, x))
        x += w + GAP
    rows.append(row)
    pages, page, y, width = [], [], GAP, 0
    for row in rows:
        h = max(sizes[i][1] for i, _ in row)
        if page and y + h + GAP > max_h:
            pages.append((page, width, y))
            page, y, width = [], GAP, 0
        page += [(i, x, y) for i, x in row]
        width = max(width, max(x + sizes[i][0] for i, x in row) + GAP)
        y += h + GAP
    pages.append((page, width, y))
    return pages


def main(argv=None):
    ap = argparse.ArgumentParser(prog="art/contact.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("city", help="the city folder, e.g. san-francisco")
    ap.add_argument("prefix", nargs="?", default="", help="only sprites whose id starts with this")
    args = ap.parse_args(argv)
    root = HERE.parent / "public" / "sprites" / args.city
    m = json.loads((root / "sprites.json").read_text())
    cells = []
    for e in m["sprites"]:
        if not e["id"].startswith(args.prefix):
            continue
        day = Image.open(root / e["day"]).convert("RGBA")
        variants = [day]
        if e.get("walls"):
            walls = Image.open(root / e["walls"]).convert("RGBA")
            variants = [tinted(day, walls, c) for c in TINTS]
        cells.append((e["id"], variants))
    if not cells:
        ap.exit(1, f"[contact] no sprites in {root / 'sprites.json'} start with {args.prefix!r}\n")

    base = f"_contact-{args.city.replace('/', '-')}{'-' + args.prefix if args.prefix else ''}"
    for old in HERE.glob(f"{base}-*.png"):  # last run's pages, so a shorter run leaves no stale page behind
        if re.fullmatch(re.escape(base) + r"-\d+\.png", old.name):
            old.unlink()
    (HERE / f"{base}.png").unlink(missing_ok=True)  # the single sheet contact.py wrote before it had pages
    sizes = [cell_size(sid, v) for sid, v in cells]
    for n, (placed, width, height) in enumerate(layout(sizes), 1):
        sheet = Image.new("RGBA", (width, height), BG)
        draw = ImageDraw.Draw(sheet)
        for i, x, y in placed:
            sid, variants = cells[i]
            bottom = y + sizes[i][1]
            one = variants[0]
            draw.text((x, y), sid, fill=(20, 20, 30, 255), font=FONT)
            sheet.alpha_composite(one, (x, bottom - one.height))
            vx = x + one.width + GAP
            for v in variants:
                big = v.resize((v.width * 4, v.height * 4), Image.NEAREST)
                sheet.alpha_composite(big, (vx, bottom - big.height))
                vx += big.width + GAP
        path = HERE / f"{base}-{n}.png"
        sheet.save(path)
        print(path)


if __name__ == "__main__":
    main()
