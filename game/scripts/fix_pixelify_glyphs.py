"""Redraws the Pixelify Sans Bold glyphs whose openings close up at small
sizes, so they read as another character. All keep the font's pixel grid (86-unit bars, 127-unit stems) and run from
the bottom-left clockwise, like the font's own outlines. Idempotent.

- "five" was the "S" outline with a rounded top, so 5 read as S. The lower
  bowl is kept; the top becomes a flat bar, a square corner, and a stem.
- "two" was an "8" with two 35-unit notches that close up below about 20px,
  so 2 read as 8 (the year 2026 looked like 8086). The top hook is kept; the
  middle becomes a stepped diagonal down to a full-width base.
- "C" and "c" were an "O" and "o" with a 34-unit slit, so "Card" read as
  "Oard" and "October" as "Ootober". The opening is now 205 and 137 units.

Usage: python3 scripts/fix_pixelify_glyphs.py public/fonts/pixelify-sans-bold.ttf"""

import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen

GLYPHS = {
    "five": [
        (149, -11), (149, 74), (61, 74), (61, 211), (188, 211), (188, 125),
        (414, 125), (414, 246), (149, 246), (149, 331), (61, 331),
        (61, 638), (542, 638), (542, 552), (188, 552), (188, 381),
        (453, 381), (453, 297), (542, 297), (542, 74), (453, 74), (453, -11),
    ],
    "two": [
        (61, -11), (61, 211), (188, 211), (188, 297), (327, 297), (327, 381),
        (414, 381), (414, 501), (188, 501), (188, 416), (61, 416), (61, 552),
        (149, 552), (149, 638), (453, 638), (453, 552), (542, 552), (542, 297),
        (414, 297), (414, 211), (237, 211), (237, 74), (542, 74), (542, -11),
    ],
    "C": [
        (149, -11), (149, 74), (61, 74), (61, 552), (149, 552), (149, 638),
        (453, 638), (453, 552), (542, 552), (542, 416), (414, 416), (414, 501),
        (188, 501), (188, 125), (414, 125), (414, 211), (542, 211), (542, 74),
        (453, 74), (453, -11),
    ],
    "c": [
        (149, -11), (149, 74), (61, 74), (61, 381), (149, 381), (149, 467),
        (453, 467), (453, 381), (542, 381), (542, 297), (414, 297), (414, 331),
        (188, 331), (188, 125), (414, 125), (414, 160), (542, 160), (542, 74),
        (453, 74), (453, -11),
    ],
}

path = sys.argv[1]
font = TTFont(path)
for name, points in GLYPHS.items():
    pen = TTGlyphPen(font.getGlyphSet())
    pen.moveTo(points[0])
    for pt in points[1:]:
        pen.lineTo(pt)
    pen.closePath()
    glyph = pen.glyph()
    glyph.recalcBounds(font["glyf"])
    font["glyf"][name] = glyph
    width, _ = font["hmtx"][name]
    font["hmtx"][name] = (width, glyph.xMin)
font.save(path)
print("redrew", ", ".join(GLYPHS), "in", path)
