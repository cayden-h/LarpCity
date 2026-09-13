"""Signs: billboards (rooftop and freeway monopole), storefront fascias, blade
signs, facade panels, lobby logo walls, monuments, painted murals, and bus
shelters. Every image goes on a face with exactly the image's aspect ratio, so
art drawn inside its safe area can never run off the sign."""
from pathlib import Path

import bpy

from . import materials as M
from .geo import box, cylinder, face_quad, quad
from .iso import px

ADS = Path(__file__).resolve().parent.parent / "ads"
# Board height / width. A real 14 x 48 ft bulletin (14/48 = 0.29) draws a strip too shallow to hold a legible
# wordmark at 1x once it's downsized to a rooftop prop; 0.5 keeps the board landscape but tall enough that its
# art (make_ads.py's BB_ASPECT, kept equal to 1 / BULLETIN) can fill it with one big brand mark and still read
# at a handful of pixels tall.
BULLETIN = 0.5
# Board width as a fraction of the lot span it stands across: as wide as the lot allows while clearing the
# roof parapet on both sides.
BULLETIN_W_FRAC = 0.94
# How far (Blender units) each kind of sign face stands off the wall it is on, so it never z-fights what lies under
# it: paint and the clock sit just off bare stone, a panel clears the facade's pattern, and a fascia clears its
# raceway, which stands 0.012 proud of the wall.
FACE_OFFSET = {"mural": 0.003, "clock": 0.004, "panel": 0.006, "fascia": 0.014}


def srgb(c):
    """Brand colors are given in sRGB; Blender shades in linear."""
    lin = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c[:3]]
    return (*lin, 1)


def _steel():
    return M.flat("steel", (0.28, 0.3, 0.32, 1), rough=0.5, metal=0.8)


def _lamp():
    return M.flat("lamp", (0.2, 0.2, 0.22, 1), rough=0.4, metal=0.6, glow=(1.0, 0.93, 0.8, 1), strength=12.0)


class Frame:
    """A local frame on the ground: u along a board, n out of its face (toward the viewer)."""

    def __init__(self, face, cx, cy):
        self.along = (1, 0) if face == "-Y" else (0, 1)
        self.normal = (0, -1) if face == "-Y" else (1, 0)
        self.c = (cx, cy)

    def at(self, u, n):
        return (self.c[0] + self.along[0] * u + self.normal[0] * n, self.c[1] + self.along[1] * u + self.normal[1] * n)

    def box(self, name, u0, u1, n0, n1, z0, z1, mat):
        (xa, ya), (xb, yb) = self.at(u0, n0), self.at(u1, n1)
        return box(name, min(xa, xb), min(ya, yb), z0, max(xa, xb), max(ya, yb), z1, mat)

    def quad(self, name, u0, u1, n, z0, z1, mat):
        a, b = self.at(u0, n), self.at(u1, n)
        return quad(name, [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], mat)


def _board(f, image_name, bw, z0, steel, lamp, tag):
    """One bulletin face on frame f, centered at u = 0, bottom at z0. Returns its top."""
    bh = bw * BULLETIN
    z1 = z0 + bh
    f.box(f"{tag}-back", -bw / 2 - 0.015, bw / 2 + 0.015, -0.002, -0.03, z0 - 0.015, z1 + 0.015, M.flat("frame", (0.85, 0.86, 0.86, 1), rough=0.6))
    f.box(f"{tag}-truss", -bw / 2, bw / 2, -0.03, -0.07, z0 + bh * 0.2, z0 + bh * 0.3, steel)
    f.quad(f"{tag}-ad", -bw / 2, bw / 2, 0.001, z0, z1, M.image(f"ad-{image_name}", ADS / image_name, strength=1.5, top_lit=True, rough=0.6))
    f.box(f"{tag}-walk", -bw / 2, bw / 2, 0.0, 0.07, z0 - px(1.6), z0 - px(0.8), steel)
    for k in (-0.34, 0.0, 0.34):
        f.box(f"{tag}-arm{k}", k * bw - 0.01, k * bw + 0.01, 0.0, 0.1, z1 + px(0.6), z1 + px(1.2), steel)
        f.box(f"{tag}-lamp{k}", k * bw - 0.03, k * bw + 0.03, 0.08, 0.12, z1 + px(0.2), z1 + px(1.4), lamp)
    return z1 + px(1.4)


def bulletin(image_name, w, d, z, face="-Y"):
    """A steel rooftop bulletin standing across the roof, facing one visible facade."""
    span = w if face == "-Y" else d
    bw = min(span, 2) * BULLETIN_W_FRAC
    f = Frame(face, w / 2, -d / 2)
    steel, lamp = _steel(), _lamp()
    lift = px(9)
    for k in (-0.38, 0.0, 0.38):
        a = f.at(k * bw, -0.08)
        cylinder(f"post{k}", a[0], a[1], 0.016, z, z + lift + bw * BULLETIN * 0.5, steel)
    return _board(f, image_name, bw, z + lift, steel, lamp, "bb")


def monopole(image_a, image_b, height_px=46, bw=1.6):
    """A freeway V: two bulletins on one pole at the lot's front corner, one facing each way."""
    steel, lamp = _steel(), _lamp()
    h = px(height_px)
    apex = (0.92, -0.92)
    cylinder("pole", apex[0] - 0.08, apex[1] + 0.08, 0.05, 0, h + bw * BULLETIN * 0.5, steel, verts=16)
    box("footing", apex[0] - 0.2, apex[1] - 0.04, 0, apex[0] + 0.04, apex[1] + 0.2, px(1.5), M.flat("concrete", (0.6, 0.6, 0.58, 1), rough=0.9))
    # Board A faces the game's left (-Y) and runs back along x; board B faces right (+X) and runs back along y.
    top_a = _board(Frame("-Y", apex[0] - bw / 2, apex[1]), image_a, bw, h, steel, lamp, "A")
    top_b = _board(Frame("+X", apex[0], apex[1] + bw / 2), image_b, bw, h, steel, lamp, "B")
    return max(top_a, top_b)


def _aspect(image_name):
    """An ad image's width / height, read from the file, so a sign face always matches its art."""
    w, h = bpy.data.images.load(str(ADS / image_name), check_existing=True).size
    return w / h


def fascia(image_name, face, w, d, z0, max_h, strength=1.6, u_min=0.0):
    """A storefront sign band over a dark raceway that spans the whole front: as wide as fits (92% of the facade
    from u_min on) at most max_h tall, with the art's own aspect, centered on that stretch. u_min keeps the art clear
    of something in front of the facade's start (a blade sign), which would otherwise hide its first letters."""
    span = w if face == "-Y" else d
    aspect = _aspect(image_name)
    room = span - u_min
    width = min(room * 0.92, max_h * aspect)
    h = width / aspect
    u0 = u_min + (room - width) / 2
    raceway = M.flat("raceway", (0.06, 0.06, 0.07, 1), rough=0.5)
    if face == "-Y":
        box("raceway-y", 0, -d - 0.012, z0 - 0.004, w, -d + 0.01, z0 + h + 0.004, raceway)
    else:
        box("raceway-x", w - 0.01, -d, z0 - 0.004, w + 0.012, 0, z0 + h + 0.004, raceway)
    face_quad(f"fascia{face}", face, w, d, u0, u0 + width, z0, z0 + h, M.image(f"fa-{image_name}", ADS / image_name, strength=strength), off=FACE_OFFSET["fascia"])
    return z0 + h


def panel(image_name, face, w, d, z0, h, strength=1.0):
    """A flat sign board on a facade, h tall with the art's aspect, centered along the face."""
    span = w if face == "-Y" else d
    width = h * _aspect(image_name)
    u0 = (span - width) / 2
    return face_quad(f"panel{face}", face, w, d, u0, u0 + width, z0, z0 + h,
                     M.image(f"pa-{image_name}", ADS / image_name, strength=strength), off=FACE_OFFSET["panel"])


def blade(image_name, bx, d, z0, depth=0.26, strength=1.8):
    """A projecting blade sign (2:3 art) sticking out of the game's left face at x = bx, readable on its right side."""
    y_out, y_in = -d - depth, -d - 0.035
    h = (y_in - y_out) * 1.5
    frame = M.flat("blade-frame", (0.12, 0.12, 0.13, 1), rough=0.4, metal=0.5)
    box("blade", bx - 0.012, y_out - 0.01, z0 - 0.01, bx + 0.012, y_in + 0.01, z0 + h + 0.01, frame)
    box("bracket", bx - 0.006, y_in, z0 + h * 0.85, bx + 0.006, -d, z0 + h * 0.92, frame)
    box("bracket2", bx - 0.006, y_in, z0 + h * 0.08, bx + 0.006, -d, z0 + h * 0.15, frame)
    x = bx + 0.013
    quad("blade-art", [(x, y_out, z0), (x, y_in, z0), (x, y_in, z0 + h), (x, y_out, z0 + h)], M.image(f"bl-{image_name}", ADS / image_name, strength=strength))
    return z0 + h


def logo_wall(image_name, x0, x1, y, z0, strength=1.3):
    """A lit logo wall (2:1 art) facing -Y at depth y, seen through two layers of lobby glass and a recessed
    plaza, which by day leaves it starved of light; day_glow keeps the mark bright and legible in daylight too."""
    h = (x1 - x0) / 2
    quad("logo-wall", [(x0, y, z0), (x1, y, z0), (x1, y, z0 + h), (x0, y, z0 + h)],
         M.image(f"lw-{image_name}", ADS / image_name, strength=strength, day_glow=1.6))
    return z0 + h


def monument(image_name, x0, y_front, width=0.46):
    """A low stone monument sign (3:1 art) on a plinth, face toward -Y."""
    h = width / 3
    base = px(1.5)
    stone = M.flat("monument", (0.78, 0.76, 0.72, 1), rough=0.8)
    box("monument", x0 - 0.02, y_front, 0, x0 + width + 0.02, y_front + 0.06, base + h + 0.02, stone)
    quad("monument-art", [(x0, y_front - 0.002, base), (x0 + width, y_front - 0.002, base), (x0 + width, y_front - 0.002, base + h), (x0, y_front - 0.002, base + h)],
         M.image(f"mo-{image_name}", ADS / image_name, strength=0.9))
    return base + h + 0.02


def wall_board(image_name, w, d, top):
    """A lit 2:1 board flat on the right (+X) wall, as wide as the wall allows (up to 2 tiles), its top 8 px under
    the building's top, in a steel frame with two gooseneck lamps over it."""
    bw = min(d, 2) * 0.86
    bh = bw * BULLETIN
    z1 = top - px(8)
    z0 = z1 - bh
    u0 = (d - bw) / 2  # along the face from its front corner (y = -d), so the board spans y = u0 - d .. u0 + bw - d
    v0 = u0 - d
    steel, lamp = _steel(), _lamp()
    box("wb-frame", w - 0.005, v0 - 0.02, z0 - 0.02, w + 0.02, v0 + bw + 0.02, z1 + 0.02, M.flat("frame", (0.85, 0.86, 0.86, 1), rough=0.6))
    face_quad("wall-board", "+X", w, d, u0, u0 + bw, z0, z1,
              M.image(f"wb-{image_name}", ADS / image_name, strength=1.5, top_lit=True, rough=0.6), off=0.022)
    for k in (0.25, 0.75):
        y = v0 + k * bw
        box(f"gooseneck{k}", w, y - 0.01, z1 + px(0.4), w + 0.1, y + 0.01, z1 + px(1.2), steel)
        box(f"wb-lamp{k}", w + 0.07, y - 0.03, z1 + px(0.2), w + 0.12, y + 0.03, z1 + px(1.4), lamp)
    return z1 + px(1.4)


# An HQ's name band is 12 game px tall, so 8 px capitals fit with a pixel of field above and below.
BAND_PX = 12


def name_band(image_name, face, w, d, z0):
    """A lit name band spanning 92% of a face (the art's aspect fits it: catalog.BAND_ASPECT) over a dark raceway."""
    return fascia(image_name, face, w, d, z0, px(BAND_PX), strength=1.6)


def mural(image_name, face, w, d, u0, u1, z0, aspect):
    """Paint on a wall: transparent art whose height is (u1 - u0) / aspect. Flat paint, with no brick relief:
    sign regions keep their detail in the pixel pass, so relief would come out as speckle."""
    z1 = z0 + (u1 - u0) / aspect
    face_quad(f"mural{face}", face, w, d, u0, u1, z0, z1, M.image(f"mu-{image_name}", ADS / image_name, glow=False, alpha=True, rough=0.9), off=FACE_OFFSET["mural"])
    return z1


def shelter(image_name, side):
    """A Muni bus shelter at the curb edge of a 1x1 tile, with a backlit 2:3 ad panel on its visible end."""
    glass = M.clear_glass("shelter-glass")
    metal = M.flat("shelter-metal", (0.55, 0.57, 0.6, 1), rough=0.35, metal=0.8)
    art = M.image(f"sh-{image_name}", ADS / image_name, strength=2.4)
    # Drawn about 1.5x real size so the panel reads at game zoom; the 2:3 panel matches its art exactly.
    pw = 0.26
    ph = pw * 1.5
    z0 = px(2)
    roof_z = z0 + ph + px(3)
    if side == "sy":  # along the edge toward y + 1 (Blender y = -1)
        box("roof", 0.2, -0.98, roof_z, 0.84, -0.7, roof_z + px(1.5), metal)
        box("back", 0.22, -0.74, px(1), 0.8, -0.73, roof_z, glass)
        for x in (0.22, 0.8):
            box(f"post{x}", x - 0.012, -0.96, 0, x + 0.012, -0.94, roof_z, metal)
        box("panel", 0.8, -0.98, 0, 0.83, -0.98 + pw, z0 + ph + 0.012, metal)
        quad("ad", [(0.832, -0.98, z0), (0.832, -0.98 + pw, z0), (0.832, -0.98 + pw, z0 + ph), (0.832, -0.98, z0 + ph)], art)
    else:  # along the edge toward x + 1 (Blender x = 1)
        box("roof", 0.7, -0.8, roof_z, 0.98, -0.16, roof_z + px(1.5), metal)
        box("back", 0.73, -0.78, px(1), 0.74, -0.18, roof_z, glass)
        for y in (-0.78, -0.18):
            box(f"post{y}", 0.94, y - 0.012, 0, 0.96, y + 0.012, roof_z, metal)
        box("panel", 0.98 - pw, -0.83, 0, 0.98, -0.8, z0 + ph + 0.012, metal)
        quad("ad", [(0.98 - pw, -0.832, z0), (0.98, -0.832, z0), (0.98, -0.832, z0 + ph), (0.98 - pw, -0.832, z0 + ph)], art)
    return roof_z + px(1.5)


def place(sign, w, d, z):
    """A rooftop sign from the catalog."""
    if sign["type"] == "bulletin":
        return bulletin(sign["image"], w, d, z, sign.get("face", "-Y"))
    raise ValueError(f"unknown sign type {sign['type']}")
