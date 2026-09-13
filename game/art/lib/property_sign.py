"""Small double-sided property boards, rendered through the same pixel pass as houses."""
import bpy

from . import materials as M
from .geo import box, quad
from .iso import px


# Five-column capitals, with one empty column between letters. Unlike font
# outlines these have no thin curves or subpixel counters to lose in the pixel pass.
_GLYPHS = {
    "S": ("11111", "10000", "10000", "11111", "00001", "00001", "11111"),
    "A": ("01110", "11011", "10001", "11111", "10001", "10001", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "N": ("10001", "11001", "11001", "10101", "10011", "10011", "10001"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
}


def _label_pixels(label, color):
    """Bottom-up RGBA bitmap: 23 columns of text, 3-column/2-row margins.

    On the existing board each texel projects to about one screen pixel wide
    and two high. The 7-row capitals thus occupy 14 of the board's 22 pixels.
    """
    width, height = 29, 11
    paper = (0.96, 0.92, 0.77, 1)
    pixels = list(color) * (width * height)
    for letter, char in enumerate(label):
        for row, bits in enumerate(_GLYPHS[char]):
            for col, bit in enumerate(bits):
                if bit == "1":
                    i = ((height - 3 - row) * width + 3 + letter * 6 + col) * 4
                    pixels[i:i + 4] = paper
    return width, height, pixels


def property_sign(w, d, floors, seed, label="SALE"):
    if label not in ("SALE", "RENT"):
        raise ValueError(f"Unsupported property label: {label}")
    ink = M.flat("sign-ink", (0.12, 0.13, 0.18, 1), rough=0.8)
    color = (0.62, 0.12, 0.13, 1) if label == "SALE" else (0.08, 0.32, 0.26, 1)
    paint = M.flat("sign-color", color, rough=0.8)
    paint["sign"] = True
    lettering = M.flat(f"sign-label-{label}", color, rough=0.8)
    lettering["sign"] = True
    width, height, pixels = _label_pixels(label, color)
    bitmap = bpy.data.images.new(f"property-{label}", width=width, height=height, alpha=True)
    # The material colors above are linear, so do not apply another sRGB decode.
    bitmap.colorspace_settings.name = "Non-Color"
    bitmap.pixels[:] = pixels
    bitmap.pack()
    nodes = lettering.node_tree.nodes
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bitmap
    texture.interpolation = "Closest"
    texture.extension = "EXTEND"
    bsdf = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Specular IOR Level"].default_value = 0
    lettering.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    box("post", .14, -.94, 0, .18, -.90, px(26), ink)
    box("board", .03, -.96, px(6), .95, -.90, px(28), paint)
    # Each whole face has one sign ID, preserving cream strokes against their
    # colored field. Reverse the back's X direction so its text is not mirrored.
    for side, y, left, right in (("front", -.967, .03, .95), ("back", -.893, .95, .03)):
        quad(f"{side}-{label}", [
            (left, y, px(6)), (right, y, px(6)),
            (right, y, px(28)), (left, y, px(28)),
        ], lettering)
    return px(28)


PROPERTY_BUILDERS = {"property_sign": property_sign}
