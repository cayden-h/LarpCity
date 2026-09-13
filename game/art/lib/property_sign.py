"""Small double-sided property boards, rendered through the same pixel pass as houses."""
import bpy

from . import materials as M
from .geo import box, quad
from .iso import px


# Three-column capitals, with one empty column between letters. Unlike font
# outlines these have no thin curves or subpixel counters to lose in the pixel pass.
_GLYPHS = {
    "S": ("111", "100", "111", "001", "111"),
    "A": ("010", "101", "111", "101", "101"),
    "L": ("100", "100", "100", "100", "111"),
    "E": ("111", "100", "110", "100", "111"),
    "R": ("110", "101", "110", "101", "101"),
    "N": ("101", "111", "111", "111", "101"),
    "T": ("111", "010", "010", "010", "010"),
}

# The board stands in the lot's front-left corner over about half its width,
# a yard sign rather than a billboard, so the house behind it stays visible.
_X0, _X1 = .04, .56
_Z0, _Z1 = 6, 20


def _label_pixels(label, color):
    """Bottom-up RGBA bitmap: 15 columns of text, 1-column/1-row margins.

    On the board each texel projects to about one screen pixel wide and two
    high, so the 5-row capitals take 10 of the board's 14 pixels.
    """
    width, height = 17, 7
    paper = (0.96, 0.92, 0.77, 1)
    pixels = list(color) * (width * height)
    for letter, char in enumerate(label):
        for row, bits in enumerate(_GLYPHS[char]):
            for col, bit in enumerate(bits):
                if bit == "1":
                    i = ((height - 2 - row) * width + 1 + letter * 4 + col) * 4
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
    box("post", .08, -.94, 0, .11, -.91, px(_Z1), ink)
    box("board", _X0, -.96, px(_Z0), _X1, -.91, px(_Z1), paint)
    # Each whole face has one sign ID, preserving cream strokes against their
    # colored field. Reverse the back's X direction so its text is not mirrored.
    for side, y, left, right in (("front", -.967, _X0, _X1), ("back", -.903, _X1, _X0)):
        quad(f"{side}-{label}", [
            (left, y, px(_Z0)), (right, y, px(_Z0)),
            (right, y, px(_Z1)), (left, y, px(_Z1)),
        ], lettering)
    return px(_Z1)


PROPERTY_BUILDERS = {"property_sign": property_sign}
