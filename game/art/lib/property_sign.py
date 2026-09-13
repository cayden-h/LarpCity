"""Small double-sided property boards, rendered through the same pixel pass as houses."""
import math
from pathlib import Path

import bpy

from . import materials as M
from .geo import box
from .iso import px


def property_sign(w, d, floors, seed, label="SALE"):
    ink = M.flat("sign-ink", (0.12, 0.13, 0.18, 1), rough=0.8)
    paper = M.flat("sign-paper", (0.96, 0.92, 0.77, 1), rough=0.8)
    paint = M.flat("sign-color", (0.62, 0.12, 0.13, 1) if label == "SALE" else (0.08, 0.32, 0.26, 1), rough=0.8)
    paint["sign"] = True
    font_path = Path(__file__).resolve().parents[2] / "public/fonts/pixelify-sans-bold.ttf"
    font = bpy.data.fonts.load(str(font_path))
    box("post", .14, -.94, 0, .18, -.90, px(26), ink)
    box("board", .03, -.96, px(6), .95, -.90, px(28), paint)
    for side, y, rot in (("front", -.967, math.pi / 2), ("back", -.893, math.pi / 2)):
        for word, z, size in (("FOR", 19, 8), (label, 8, 10)):
            curve = bpy.data.curves.new(f"{side}-{word}", "FONT")
            curve.body = word
            curve.font = font
            curve.align_x = "CENTER"
            curve.size = px(size)
            curve.extrude = 0
            obj = bpy.data.objects.new(f"{side}-{word}", curve)
            bpy.context.scene.collection.objects.link(obj)
            obj.location = (.49, y, px(z))
            obj.rotation_euler = (rot, 0, 0 if side == "front" else math.pi)
            curve.materials.append(paper)
    return px(28)


PROPERTY_BUILDERS = {"property_sign": property_sign}
