"""Redraws Pixelify Sans Bold's "five", which is the "S" outline with a rounded
top, so it reads as a 5: flat top bar, square top-left corner, straight stem.
The lower bowl is kept from the original. Idempotent."""

import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen

FIVE = [
    (149, -11), (149, 74), (61, 74), (61, 211), (188, 211), (188, 125),
    (414, 125), (414, 246), (149, 246), (149, 331), (61, 331),
    (61, 638), (542, 638), (542, 552), (188, 552), (188, 381),
    (453, 381), (453, 297), (542, 297), (542, 74), (453, 74), (453, -11),
]

path = sys.argv[1]
font = TTFont(path)
pen = TTGlyphPen(font.getGlyphSet())
pen.moveTo(FIVE[0])
for pt in FIVE[1:]:
    pen.lineTo(pt)
pen.closePath()
glyph = pen.glyph()
glyph.recalcBounds(font["glyf"])
font["glyf"]["five"] = glyph
width, _ = font["hmtx"]["five"]
font["hmtx"]["five"] = (width, glyph.xMin)
font.save(path)
print("five redrawn in", path)
