# Slices the owl sheets (game/art/owl/owl1-5.png: 8 frames x 3 animations each,
# on a flat ground with a baked-in drop shadow) into transparent animation
# strips for the game (game/public/owl/*.webp plus owl.json).
#
#   python3 game/art/owl/slice.py game/art/owl game/public/owl [preview.jpg]
#
# Frames are found as connected shapes rather than a fixed grid, so wings,
# sparkles, and laptops that cross a cell edge stay whole and neighbours never
# bleed in: each cell's biggest shape is that frame's owl, and every smaller
# shape joins the nearest owl (detached shadow pieces are dropped, and shadow
# pooled under the feet is cleared). Each animation shares one frame box, and the
# manifest records an anchor (the head's centre over the feet) so the game can
# keep the owl in place when it switches animations.

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
PREVIEW = sys.argv[3] if len(sys.argv) > 3 else None
SHEETS = {
    "owl1.png": ["idle", "talk", "wave"],
    "owl2.png": ["think", "cheer", "magic"],
    "owl3.png": ["step", "run", "fly"],
    "owl4.png": ["hop", "tip-hat", "proud"],
    "owl5.png": ["read", "type", "sleep"],
}
COLS, ROWS = 8, 3
BG_TOL = 34  # colour distance that still counts as the flat ground
SHADOW_TOL = 120  # the drop shadow: a darker tint of the ground, touching it
MIN_PART = 25  # smaller specks are noise from the cut
PAD = 3  # transparent margin around every frame, so neighbours never show when scaled


def cut_ground(a):
    """Foreground mask (everything not connected to the border ground or shadow), and the shadow-tint mask."""
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    w = np.array([0.299, 0.587, 0.114])
    lum, bg_lum = a @ w, float(bg @ w)
    cb = bg - bg.mean()
    c = a - a.mean(axis=2, keepdims=True)
    cos = (c * cb).sum(axis=2) / (np.linalg.norm(c, axis=2) * np.linalg.norm(cb) + 1e-6)
    groundish = (dist < BG_TOL) | ((dist < SHADOW_TOL) & (lum > bg_lum - 95) & (cos > 0.6))
    lab, _ = ndimage.label(groundish)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    # The drop shadow is a strong tint of the ground: the same hue, somewhat darker. Where it pools
    # under the feet it doesn't touch the open ground, so it's cleared separately (see below).
    shadowish = (cos > 0.9) & (bg_lum - lum > 35) & (bg_lum - lum < 105) & (dist < 160)
    return ~np.isin(lab, edge[edge != 0]), shadowish


def rect_dist(p, box):
    y, x = p
    y0, x0, y1, x1 = box
    dy = max(y0 - y, 0, y - y1)
    dx = max(x0 - x, 0, x - x1)
    return (dy * dy + dx * dx) ** 0.5


os.makedirs(OUT, exist_ok=True)
manifest = {"animations": {}}
previews, warnings = [], []

for sheet, names in SHEETS.items():
    a = np.asarray(Image.open(os.path.join(SRC, sheet)).convert("RGB")).astype(np.int32)
    H, W, _ = a.shape
    cw, ch = W / COLS, H / ROWS
    fg, shadowish = cut_ground(a)
    rgba = np.dstack([a.astype(np.uint8), (fg * 255).astype(np.uint8)])
    lab, n = ndimage.label(fg, structure=np.ones((3, 3)))
    ids = list(range(1, n + 1))
    sizes = ndimage.sum(fg, lab, ids)
    slices = ndimage.find_objects(lab)
    keep = [i for i in ids if sizes[i - 1] >= MIN_PART]
    cents = dict(zip(keep, ndimage.center_of_mass(fg, lab, keep)))
    boxes = {i: (slices[i - 1][0].start, slices[i - 1][1].start, slices[i - 1][0].stop, slices[i - 1][1].stop) for i in keep}

    body = {}
    for i in keep:
        cy, cx = cents[i]
        cell = (min(int(cy // ch), ROWS - 1), min(int(cx // cw), COLS - 1))
        if cell not in body or sizes[i - 1] > sizes[body[cell] - 1]:
            body[cell] = i
    missing = [(r, c) for r in range(ROWS) for c in range(COLS) if (r, c) not in body]
    if missing:
        raise SystemExit(f"{sheet}: no owl found in cells {missing}")
    for cell, i in body.items():
        y0, x0, y1, x1 = boxes[i]
        if x1 - x0 > cw * 1.15 or y1 - y0 > ch * 1.1:
            warnings.append(f"{sheet} {cell}: owl shape {x1 - x0}x{y1 - y0} is bigger than a cell (touching a neighbour?)")
    parts = {cell: [i] for cell, i in body.items()}
    owls = set(body.values())
    for i in keep:
        if i in owls:
            continue
        # A detached piece that is nearly all shadow tint (a flying owl's ground shadow) is dropped.
        piece = lab[slices[i - 1]] == i
        if shadowish[slices[i - 1]][piece].mean() > 0.6:
            fg[lab == i] = False
            continue
        parts[min(body, key=lambda k: rect_dist(cents[i], boxes[body[k]]))].append(i)
    # Shadow pooled between the feet isn't touching the open ground, so the cut misses it:
    # clear shadow-tinted pixels in the bottom band of each owl.
    for i in owls:
        y0, x0, y1, x1 = boxes[i]
        band = slice(y1 - max(4, (y1 - y0) // 8), y1), slice(x0, x1)
        clear = shadowish[band] & (lab[band] == i)
        fg[band][clear] = False
    rgba[:, :, 3] = fg * 255

    for r, name in enumerate(names):
        frames = []
        for c in range(COLS):
            ox, oy = round(c * cw), round(r * ch)
            ps = parts[(r, c)]
            fy0 = min(boxes[i][0] for i in ps) - oy
            fx0 = min(boxes[i][1] for i in ps) - ox
            fy1 = max(boxes[i][2] for i in ps) - oy
            fx1 = max(boxes[i][3] for i in ps) - ox
            y0, x0, y1, x1 = boxes[body[(r, c)]]
            m = lab[y0:y1, x0:x1] == body[(r, c)]
            top = m[: max(1, (y1 - y0) // 5)]
            head_x = x0 + np.where(top)[1].mean() - ox
            frames.append({"ox": ox, "oy": oy, "parts": ps, "box": (fy0, fx0, fy1, fx1), "feet": y1 - oy, "head": head_x})
        uy0 = min(f["box"][0] for f in frames) - PAD
        ux0 = min(f["box"][1] for f in frames) - PAD
        uy1 = max(f["box"][2] for f in frames) + PAD
        ux1 = max(f["box"][3] for f in frames) + PAD
        fw, fh = ux1 - ux0, uy1 - uy0
        strip = np.zeros((fh, fw * COLS, 4), np.uint8)
        for c, f in enumerate(frames):
            sy0, sx0 = f["oy"] + uy0, f["ox"] + ux0
            ya, xa = max(sy0, 0), max(sx0, 0)
            yb, xb = min(sy0 + fh, H), min(sx0 + fw, W)
            region = (slice(ya, yb), slice(xa, xb))
            mask = np.isin(lab[region], f["parts"]) & fg[region]
            dst = strip[ya - sy0 : yb - sy0, c * fw + xa - sx0 : c * fw + xb - sx0]
            dst[mask] = rgba[region][mask]
        anchor_x = float(np.median([f["head"] for f in frames])) - ux0
        anchor_y = float(np.median([f["feet"] for f in frames])) - uy0
        im = Image.fromarray(strip, "RGBA")
        im.save(os.path.join(OUT, f"{name}.webp"), "WEBP", quality=90, alpha_quality=100, method=6)
        manifest["animations"][name] = {
            "file": f"{name}.webp",
            "frameWidth": int(fw),
            "frameHeight": int(fh),
            "frames": COLS,
            "anchorX": round(anchor_x, 1),
            "anchorY": round(anchor_y, 1),
        }
        previews.append((name, im, anchor_x, anchor_y, fw))

with open(os.path.join(OUT, "owl.json"), "w") as f:
    json.dump(manifest, f, indent=1)
    f.write("\n")

if PREVIEW:
    width = max(p[1].width for p in previews)
    sheet = Image.new("RGB", (width, sum(p[1].height for p in previews)), "white")
    y = 0
    for k, (name, im, ax, ay, fw) in enumerate(previews):
        ground = Image.new("RGBA", (width, im.height), (31, 78, 156, 255) if k % 2 else (232, 236, 242, 255))
        ground.alpha_composite(im)
        d = ImageDraw.Draw(ground)
        for c in range(COLS):
            x = c * fw + ax
            d.line([(x - 6, ay), (x + 6, ay)], fill=(230, 40, 40, 255), width=2)
            d.line([(x, ay - 6), (x, ay)], fill=(230, 40, 40, 255), width=2)
            d.line([(c * fw, 0), (c * fw, im.height)], fill=(120, 120, 120, 255), width=1)
        sheet.paste(ground.convert("RGB"), (0, y))
        y += im.height
    sheet.save(PREVIEW, quality=88)

print(json.dumps({k: [v["frameWidth"], v["frameHeight"], v["anchorX"], v["anchorY"]] for k, v in manifest["animations"].items()}))
print("KB:", {k: os.path.getsize(os.path.join(OUT, v["file"])) // 1024 for k, v in manifest["animations"].items()})
print("warnings:", len(warnings), *warnings[:12], sep="\n")
