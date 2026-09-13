"""House archetypes for residential lots (docs/superpowers/specs/2026-09-12-blender-houses-design.md).

Each builds on a w x d lot from (0, 0) to (w, -d) with its front on -Y, the game's lower-left side
("s"); build.py turns the finished model to face e, n, and w. Every side is finished, because each is
the front in some facing. A 1 px plate covers the whole lot (yard or paving), so every house registers
to its diamond. Painted surfaces use paint* materials, which the walls pass keeps so the game can tint
them; color= bakes a color instead (the player's hero homes). Each returns its highest point.
"""
import math
import random

from . import materials as M
from .geo import box, cone, cylinder, gable, hip, prism
from .iso import FLOOR_PX, px

FZ = px(FLOOR_PX)
E = 0.012  # how far trim stands off a wall
GREY = (0.8, 0.8, 0.78, 1)
ACCENTS = [(0.18, 0.22, 0.32, 1), (0.46, 0.14, 0.14, 1), (0.14, 0.32, 0.24, 1), (0.22, 0.22, 0.24, 1)]
DOORS = [(0.5, 0.16, 0.14, 1), (0.16, 0.24, 0.4, 1), (0.34, 0.22, 0.12, 1), (0.12, 0.3, 0.22, 1)]
SHINGLES = [(0.34, 0.37, 0.42, 1), (0.42, 0.3, 0.26, 1), (0.28, 0.3, 0.3, 1)]
CARS = [(0.75, 0.16, 0.14, 1), (0.14, 0.34, 0.62, 1), (0.9, 0.9, 0.88, 1), (0.2, 0.22, 0.24, 1), (0.85, 0.66, 0.2, 1)]


def mats(rng, color=None, lit=0.6):
    """The materials one house draws from. color=None: neutral grey paint for the game to tint."""
    wall = color or GREY
    return {
        "siding": M.paint("paint-siding", wall, period_px=3) if color is None else M.lined("home-siding", wall, period_px=3),
        "stucco": M.paint("paint-stucco", wall, period_px=0) if color is None else M.flat("home-stucco", wall, rough=0.8),
        "trim": M.flat("trim", (0.95, 0.94, 0.9, 1), rough=0.7),
        "accent": M.flat("accent", rng.choice(ACCENTS), rough=0.6),
        "door": M.flat("door", rng.choice(DOORS), rough=0.5),
        "glass": M.windows("win", 0.2, FZ, lit, (0.14, 0.24, 0.34, 1)),
        "shingle": M.lined("shingle", rng.choice(SHINGLES), period_px=2, dark=0.72),
        "tile": M.lined("claytile", (0.74, 0.34, 0.2, 1), period_px=2, dark=0.7),
        "tar": M.flat("tar", (0.36, 0.36, 0.38, 1), rough=0.9),
        "brick": M.brick("brick", (0.62, 0.3, 0.24, 1)),
        "stair": M.lined("stair", (0.72, 0.7, 0.66, 1), period_px=2, dark=0.8),
        "lawn": M.flat("lawn", (0.38, 0.62, 0.3, 1), rough=0.9),
        "paving": M.flat("paving", (0.68, 0.67, 0.64, 1), rough=0.9),
        "metal": M.flat("metal", (0.2, 0.21, 0.23, 1), rough=0.5, metal=0.6),
        "lamp": M.flat("lamp", (1.0, 0.9, 0.7, 1), rough=0.4, glow=(1.0, 0.78, 0.45, 1), strength=6.0),
        "hedge": M.flat("hedge", (0.2, 0.42, 0.22, 1), rough=0.9),
    }


# ------------------------------------------------------------------ parts

def _grow(pts, k):
    """Push a 2D outline k units away from its center (glass and sills around a bay)."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    out = []
    for x, y in pts:
        dx, dy = x - cx, y - cy
        n = math.hypot(dx, dy) or 1
        out.append((x + dx / n * k, y + dy / n * k))
    return out


def _slab(tag, face, plane, u0, u1, out0, out1, z0, z1, mat):
    """A box on a wall. face is the wall's outward side ("-Y", "+Y", "-X", "+X"), plane its y or x,
    u0..u1 runs along the wall, out0..out1 outward from it."""
    s = 1 if face in ("+X", "+Y") else -1
    a, b = sorted((plane + s * out0, plane + s * out1))
    if face in ("-Y", "+Y"):
        return box(tag, u0, a, z0, u1, b, z1, mat)
    return box(tag, a, u0, z0, b, u1, z1, mat)


def window(tag, face, plane, u0, u1, z0, z1, m):
    """A framed window with a sill."""
    _slab(f"{tag}-frame", face, plane, u0 - 0.02, u1 + 0.02, -0.005, E, z0 - 0.02, z1 + 0.02, m["trim"])
    _slab(f"{tag}-glass", face, plane, u0, u1, -0.005, E + 0.004, z0, z1, m["glass"])
    _slab(f"{tag}-sill", face, plane, u0 - 0.035, u1 + 0.035, -0.005, E + 0.02, z0 - px(1.5), z0, m["trim"])
    mid = (u0 + u1) / 2
    _slab(f"{tag}-mullion", face, plane, mid - 0.008, mid + 0.008, E + 0.004, E + 0.01, z0, z1, m["trim"])
    _slab(f"{tag}-sash", face, plane, u0, u1, E + 0.004, E + 0.01, (z0 + z1) / 2, (z0 + z1) / 2 + px(0.7), m["trim"])


def door(tag, face, plane, u0, u1, z0, m, h=None):
    """A framed door with a porch lamp beside it."""
    h = h or FZ * 0.78
    _slab(f"{tag}-frame", face, plane, u0 - 0.025, u1 + 0.025, -0.005, E, z0, z0 + h + 0.025, m["trim"])
    _slab(tag, face, plane, u0, u1, -0.005, E + 0.004, z0, z0 + h, m["door"])
    _slab(f"{tag}-panel", face, plane, u0 + 0.02, u1 - 0.02, E + 0.004, E + 0.008, z0 + h * 0.18, z0 + h * 0.55, m["accent"])
    _slab(f"{tag}-handle", face, plane, u1 - 0.025, u1 - 0.012, E + 0.008, E + 0.02, z0 + h * 0.48, z0 + h * 0.55, m["metal"])
    _slab(f"{tag}-lamp", face, plane, u1 + 0.04, u1 + 0.07, -0.005, E + 0.03, z0 + h * 0.7, z0 + h * 0.85, m["lamp"])


def windows_on(tag, x0, y0, x1, y1, z0, floors, m, faces=("-Y", "+Y", "-X", "+X"), per=2, tall=0.5):
    """Evenly spaced windows on the listed walls of a box x0..x1, y0..y1 (y0 < y1), one row per floor."""
    for f in range(floors):
        wz0 = z0 + f * FZ + FZ * 0.28
        for face in faces:
            lo, hi = (x0, x1) if face in ("-Y", "+Y") else (y0, y1)
            plane = {"-Y": y0, "+Y": y1, "-X": x0, "+X": x1}[face]
            n = max(1, round((hi - lo) * per))
            step = (hi - lo) / n
            for i in range(n):
                c = lo + step * (i + 0.5)
                window(f"{tag}{f}{face}{i}", face, plane, c - step * 0.22, c + step * 0.22, wz0, wz0 + FZ * tall, m)


def stoop(tag, x0, x1, y_front, y_wall, top, m, steps=6):
    """Steps from y_front up to a door at height top in the wall at y_wall (the front is -Y), with rails."""
    depth = (y_wall - y_front) / steps
    for i in range(steps):
        box(f"{tag}{i}", x0, y_front + i * depth, 0, x1, y_wall, top * (i + 1) / steps, m["stair"])
    for side, x in enumerate((x0 - 0.02, x1)):
        for i in range(steps):
            y = y_front + (i + 0.5) * depth
            z = top * (i + 1) / steps
            box(f"{tag}-spindle{side}-{i}", x, y, z, x + 0.018, y + 0.012, z + px(6), m["trim"])
        beam(f"{tag}-handrail{side}", (x + 0.009, y_front, top / steps + px(6)),
             (x + 0.009, y_wall, top + px(6)), 0.02, m["trim"])


def beam(tag, start, end, width, mat):
    """A square beam between points, with baked coordinates for facing-safe shaders."""
    from mathutils import Vector
    a, b = Vector(start), Vector(end)
    direction = b - a
    ob = box(tag, -width / 2, -width / 2, 0, width / 2, width / 2, direction.length, mat)
    rotation = direction.to_track_quat("Z", "Y")
    for v in ob.data.vertices:
        v.co = rotation @ v.co + a
    return ob


def garage_door(tag, face, plane, u0, u1, z0, height, m):
    """Inset paneled garage door with horizontal courses and a handle."""
    _slab(tag + "-frame", face, plane, u0 - 0.018, u1 + 0.018, 0, E, z0, z0 + height + 0.018, m["trim"])
    _slab(tag, face, plane, u0, u1, 0, E + 0.004, z0, z0 + height, m["accent"])
    for i in range(1, 5):
        z = z0 + height * i / 5
        _slab(f"{tag}-course{i}", face, plane, u0, u1, E + 0.004, E + 0.008, z, z + px(0.6), m["trim"])


def bay_trim(tag, pts, z0, z1, m):
    """Vertical corner trim separates the glass on every exposed bay face."""
    for i, (x, y) in enumerate(_grow(pts, 0.012)):
        box(f"{tag}-post{i}", x - 0.01, y - 0.01, z0, x + 0.01, y + 0.01, z1, m["trim"])


def chimney(tag, x, y, z0, h, m):
    box(tag, x, y, z0 - px(4), x + 0.1, y + 0.1, z0 + h, m["brick"])
    box(tag + "-cap", x - 0.015, y - 0.015, z0 + h - px(2), x + 0.115, y + 0.115, z0 + h, m["trim"])
    return z0 + h


def lot(w, d, m, kind):
    """The 1 px plate under the whole lot: a yard (lawn) or paving."""
    box("lot", 0, -d, 0, w, 0, px(1), m[kind])


def car(tag, x, y, along="x", color=None, big=False, rng=None, length=None):
    """A parked car with its corner at (x, y), its length along x or y.
    big selects an SUV; length can fit the body to a short driveway."""
    color = color or (rng or random.Random(0)).choice(CARS)
    L, W, H = (0.48, 0.23, px(11)) if big else (0.42, 0.2, px(8))
    if length is not None:
        if length <= 0.2:
            raise ValueError("car length must leave room for the cabin")
        L = length
    dx, dy = (L, W) if along == "x" else (W, L)
    body = M.flat(f"car-{tag}", color, rough=0.35, metal=0.4)
    glass = M.flat(f"carglass-{tag}", (0.1, 0.13, 0.17, 1), rough=0.2)
    box(f"{tag}-body", x, y, px(2), x + dx, y + dy, px(2) + H, body)
    ix, iy = (0.1, 0.02) if along == "x" else (0.02, 0.1)
    box(f"{tag}-cabin", x + ix, y + iy, px(2) + H, x + dx - ix, y + dy - iy, px(7) + H, glass)
    tire = M.flat(f"tire-{tag}", (0.07, 0.07, 0.08, 1), rough=0.9)
    for i, t in enumerate((0.2, 0.8)):
        for side in (0, 1):
            wx = x + dx * t if along == "x" else x + side * dx
            wy = y + side * dy if along == "x" else y + dy * t
            box(f"{tag}-wheel{i}-{side}", wx - 0.035, wy - 0.025, px(1), wx + 0.035, wy + 0.025, px(5), tire)
    for t in (0.16, 0.78):
        if along == "x":
            box(f"{tag}-light{t}", x - 0.005, y + dy * t, px(4), x + 0.01, y + dy * t + 0.025, px(6), body)
        else:
            box(f"{tag}-light{t}", x + dx * t, y - 0.005, px(4), x + dx * t + 0.025, y + 0.01, px(6), body)
    return px(7) + H


# ------------------------------------------------------------------ archetypes

def victorian(w, d, floors, seed, variant="italianate", garage=False, color=None, lit=0.6):
    """A San Francisco Victorian: raised on a garage or brick basement, a stoop up to the door, an angled
    bay to the roof, and one of three tops: Italianate false front, Stick gable, or Queen Anne turret."""
    rng = random.Random(seed)
    m = mats(rng, color, lit)
    lot(w, d, m, "paving")
    x0, x1, yf, yb = 0.04, 0.96, -0.8, -0.06
    base = FZ * 0.9 if garage else px(12)
    top = base + floors * FZ
    box("body", x0, yf, 0, x1, yb, top, m["siding"])
    box("base", x0 - 0.01, yf - 0.01, 0, x1 + 0.01, yb + 0.01, base, m["stucco"] if garage else m["brick"])
    bay = [(0.1, yf), (0.52, yf), (0.44, yf - 0.12), (0.18, yf - 0.12)]
    if variant == "stick":
        bay = [(0.1, yf), (0.52, yf), (0.52, yf - 0.12), (0.1, yf - 0.12)]
    prism("bay", bay, base, top - px(3), m["siding"])
    for f in range(floors):
        z0 = base + f * FZ + FZ * 0.25
        prism(f"bay-glass{f}", _grow(bay, 0.006), z0, z0 + FZ * 0.5, m["glass"])
        prism(f"bay-sill{f}", _grow(bay, 0.014), z0 - px(1.5), z0, m["trim"])
    prism("bay-cap", _grow(bay, 0.02), top - px(3), top, m["trim"])
    bay_trim("bay", bay, base, top, m)
    dx0, dx1 = (0.54, 0.66) if variant == "queen_anne" else (0.64, 0.8)
    door("door", "-Y", yf, dx0, dx1, base, m)
    stoop("stoop", dx0 - 0.03, dx1 + 0.03, -0.99, yf, base, m, steps=7 if garage else 5)
    if garage:
        garage_door("garage", "-Y", yf, 0.12, 0.5, px(1), base - px(4), m)
    for f in range(1, floors):
        z0 = base + f * FZ + FZ * 0.25
        window(f"front{f}", "-Y", yf, dx0, dx1, z0, z0 + FZ * 0.5, m)
    windows_on("back", x0, yf, x1, yb, base, floors, m, faces=("+Y", "-X", "+X"))
    door("rear-door", "+Y", yb, 0.64, 0.78, px(1), m, h=base - px(1))
    for f in range(floors + 1):
        z = base + f * FZ
        for face, plane, lo, hi in (("-X", x0, yf, yb), ("+X", x1, yf, yb), ("+Y", yb, x0, x1)):
            _slab(f"belt{f}{face}", face, plane, lo, hi, 0, E, z, z + px(1.2), m["trim"])
    # The rear door is at ground level, so its threshold must stop at the sill.
    box("back-step-threshold", 0.62, yb, 0, 0.84, yb + 0.05, px(1), m["stair"])
    if variant == "italianate":
        box("false-front", x0 - 0.01, yf - 0.01, top, x1 + 0.01, yf + 0.05, top + px(10), m["siding"])
        box("cornice", x0 - 0.03, yf - 0.05, top + px(7), x1 + 0.03, yf + 0.06, top + px(11), m["trim"])
        for i in range(7):
            x = x0 + 0.04 + i * 0.13
            box(f"cornice-bracket{i}", x, yf - 0.035, top + px(3), x + 0.035, yf + 0.01, top + px(7), m["trim"])
        box("roof", x0 + 0.01, yf + 0.05, top, x1 - 0.01, yb - 0.01, top + px(2), m["tar"])
        return max(top + px(11), chimney("chimney", 0.78, -0.3, top, px(10), m))
    if variant == "stick":
        gable("roof", x0, yf, x1, yb, top, px(26), m["shingle"], ridge="y", end_mat=m["siding"])
        for y in (yf - 0.032, yb + 0.032):
            for x in (x0, x1):
                beam(f"gable-stick{x}{y}", (x, y, top), (0.5, y, top + px(25)), 0.025, m["trim"])
            beam(f"gable-center{y}", (0.5, y, top), (0.5, y, top + px(25)), 0.02, m["trim"])
        return max(top + px(26), chimney("chimney", 0.76, -0.3, top, px(24), m))
    hip("roof", x0, yf, x1, yb, top, px(22), m["shingle"])
    cylinder("turret", 0.83, yf + 0.02, 0.13, base, top + px(8), m["siding"], verts=10)
    for f in range(floors):
        z0 = base + f * FZ + FZ * 0.25
        cylinder(f"turret-glass{f}", 0.83, yf + 0.02, 0.136, z0, z0 + FZ * 0.45, m["glass"], verts=10)
        cylinder(f"turret-sill{f}", 0.83, yf + 0.02, 0.145, z0 - px(1), z0, m["trim"], verts=10)
    for i in range(10):
        a = math.tau * i / 10
        x, y = 0.83 + 0.138 * math.cos(a), yf + 0.02 + 0.138 * math.sin(a)
        box(f"turret-post{i}", x - 0.009, y - 0.009, base, x + 0.009, y + 0.009, top + px(8), m["trim"])
    cone("turret-cap", 0.83, yf + 0.02, 0.17, top + px(8), px(34), m["shingle"], verts=10)
    return top + px(42)


def edwardian(w, d, floors, seed, variant="single", color=None, lit=0.6):
    """An Edwardian flat: a simpler box with one or two round bays, a heavy bracketed cornice, and a flat roof."""
    rng = random.Random(seed)
    m = mats(rng, color, lit)
    lot(w, d, m, "paving")
    x0, x1, yf, yb = 0.04, 0.96, -0.82, -0.06
    base = px(12)
    top = base + floors * FZ
    box("body", x0, yf, 0, x1, yb, top, m["siding"])
    box("base", x0 - 0.01, yf - 0.01, 0, x1 + 0.01, yb + 0.01, base, m["stucco"])
    centers = (0.3,) if variant == "single" else (0.24, 0.76)
    for i, cx in enumerate(centers):
        r = 0.17 if variant == "single" else 0.15
        arc = [(cx + r * math.cos(math.pi * k / 6), yf - r * 0.7 * math.sin(math.pi * k / 6)) for k in range(7)]
        prism(f"bay{i}", arc, base, top - px(4), m["siding"])
        for f in range(floors):
            z0 = base + f * FZ + FZ * 0.25
            prism(f"bay{i}-glass{f}", _grow(arc, 0.006), z0, z0 + FZ * 0.5, m["glass"])
            prism(f"bay{i}-sill{f}", _grow(arc, 0.014), z0 - px(1.5), z0, m["trim"])
        bay_trim(f"bay{i}", arc, base, top - px(4), m)
    dx0, dx1 = (0.6, 0.78) if variant == "single" else (0.43, 0.57)
    door("door", "-Y", yf, dx0, dx1, base, m)
    stoop("stoop", dx0 - 0.03, dx1 + 0.03, -0.99, yf, base, m, steps=5)
    if variant == "single":
        for f in range(1, floors):
            z0 = base + f * FZ + FZ * 0.25
            window(f"front{f}", "-Y", yf, dx0, dx1, z0, z0 + FZ * 0.5, m)
    box("cornice", x0 - 0.03, yf - 0.16, top - px(2), x1 + 0.03, yb + 0.02, top + px(6), m["trim"])
    for i in range(5):
        bx = x0 + 0.06 + i * (x1 - x0 - 0.16) / 4
        box(f"bracket{i}", bx, yf - 0.16, top - px(6), bx + 0.04, yf - 0.1, top - px(2), m["trim"])
    windows_on("back", x0, yf, x1, yb, base, floors, m, faces=("+Y", "-X", "+X"))
    box("roof-membrane", x0 + 0.05, yf + 0.06, top + px(6), x1 - 0.05, yb - 0.05, top + px(6.2), m["tar"])
    return top + px(6.2)


STUCCO_LAYOUT = {  # garage x, door x per variant; the Streamline Moderne one mirrors the plan
    0: ((0.08, 0.52), (0.66, 0.84)),
    1: ((0.46, 0.92), (0.14, 0.3)),
    2: ((0.08, 0.52), (0.66, 0.84)),
    3: ((0.08, 0.52), (0.66, 0.84)),
}


def stucco_row(w, d, floors, seed, variant=0, color=None, lit=0.6):
    """A 1930s-40s Sunset or Richmond row house, built wall to wall: a garage at the sidewalk, the living floor
    above behind one wide picture window. Tops: 0 tile parapet, 1 Streamline Moderne, 2 tile hip roof, 3 flat with a planter."""
    rng = random.Random(seed)
    m = mats(rng, color, lit)
    lot(w, d, m, "paving")
    x0, x1, yf, yb = 0.0, 1.0, -0.94, -0.12
    top = floors * FZ + px(4)
    box("body", x0, yf, 0, x1, yb, top, m["stucco"])
    (gx0, gx1), (dx0, dx1) = STUCCO_LAYOUT[variant]
    garage_door("garage", "-Y", yf, gx0, gx1, px(1), FZ * 0.8 - px(1), m)
    door("door", "-Y", yf, dx0, dx1, px(10), m)
    stoop("steps", dx0 - 0.03, dx1 + 0.03, -0.99, yf, px(10), m, steps=3)
    window("picture", "-Y", yf, 0.12, 0.88, FZ * 1.2, FZ * 1.75, m)
    for f in range(2, floors):
        window(f"upper{f}", "-Y", yf, 0.2, 0.8, f * FZ + FZ * 0.25, f * FZ + FZ * 0.75, m)
    windows_on("back", x0, yf, x1, yb, 0, floors, m, faces=("+Y",))
    # Small side lights finish the party walls when a rotation exposes them.
    for face, plane in (("-X", x0), ("+X", x1)):
        for f in range(floors):
            window(f"side{face}{f}", face, plane, yb - 0.29, yb - 0.1, f * FZ + FZ * 0.3, f * FZ + FZ * 0.75, m)
    box("yard", x0, yb, 0, x1, 0, px(1.5), m["lawn"])
    if variant == 0:
        box("parapet", x0, yf, top, x1, yf + 0.08, top + px(8), m["stucco"])
        gable("tile-hood", 0.08, yf - 0.03, 0.92, yf + 0.08, top + px(8), px(5), m["tile"], ridge="x", over=0.02)
        box("roof", x0, yf + 0.08, top, x1, yb, top + px(2), m["tar"])
        return top + px(13)
    if variant == 1:
        cylinder("corner", 0.92, yf + 0.08, 0.08, 0, top + px(4), m["stucco"], verts=12)
        for i, z in enumerate((FZ * 0.95, FZ * 1.9, top)):
            box(f"band{i}", x0, yf - 0.012, z - px(1.5), x1 - 0.08, yf, z, m["trim"])
        box("roof", x0, yf, top, x1, yb, top + px(2), m["tar"])
        return top + px(4)
    if variant == 2:
        # Outline the opening instead of covering the door with a solid trim block.
        for x in (dx0 - 0.035, dx1 + 0.015):
            box(f"arch-jamb{x}", x, yf - 0.025, px(10), x + 0.02, yf - 0.017, px(10) + FZ * 0.78, m["trim"])
        beam("arch-left", (dx0 - 0.025, yf - 0.02, px(10) + FZ * 0.78), ((dx0 + dx1) / 2, yf - 0.02, px(10) + FZ * 0.9), 0.02, m["trim"])
        beam("arch-right", ((dx0 + dx1) / 2, yf - 0.02, px(10) + FZ * 0.9), (dx1 + 0.025, yf - 0.02, px(10) + FZ * 0.78), 0.02, m["trim"])
        hip("roof", x0, yf, x1, yb, top, px(14), m["tile"], over=0.0)
        return top + px(14)
    # A parapet ring around a tar roof, so the wall tint stops at the coping instead of painting the whole top.
    t = 0.05
    for name, bx in (("parapet-front", (x0, yf, x1, yf + t)), ("parapet-back", (x0, yb - t, x1, yb)),
                     ("parapet-left", (x0, yf + t, x0 + t, yb - t)), ("parapet-right", (x1 - t, yf + t, x1, yb - t))):
        box(name, bx[0], bx[1], top, bx[2], bx[3], top + px(5), m["stucco"])
    box("roof", x0 + t, yf + t, top, x1 - t, yb - t, top + px(2), m["tar"])
    box("planter", 0.12, yf - 0.06, FZ * 1.05, 0.88, yf, FZ * 1.18, m["hedge"])
    return top + px(5)


def suburban(w, d, floors, seed, variant="ranch", car_parked=None, color=None, lit=0.6, garage2=False, hedge=False, porch_swing=False):
    """A detached suburban house behind a lawn, with a driveway, a fence, and a mailbox:
    ranch, split-level, two-story colonial, or craftsman bungalow."""
    rng = random.Random(seed)
    m = mats(rng, color, lit)
    lot(w, d, m, "lawn")
    box("drive", 0.7, -1.0, 0, 1.0 if garage2 else 0.95, -0.3, px(1.5), m["paving"])
    box("walk", 0.4, -1.0, 0, 0.5, -0.6, px(1.5), m["paving"])
    for name, bx in (("fence-back", (0.0, -0.02, 1.0, 0.0)), ("fence-l", (0.0, -0.6, 0.02, 0.0)), ("fence-r", (0.98, -0.3, 1.0, 0.0))):
        box(name, bx[0], bx[1], 0, bx[2], bx[3], px(9), m["trim"])
    box("mailbox-post", 0.07, -0.96, 0, 0.09, -0.94, px(8), m["metal"])
    box("mailbox", 0.055, -0.975, px(8), 0.105, -0.925, px(11), m["accent"])
    if hedge:
        box("hedge", 0.0, -1.0, 0, 0.36, -0.94, px(7), m["hedge"])
    peak = 0.0
    if variant == "ranch":
        box("body", 0.08, -0.6, 0, 0.7, -0.14, FZ, m["siding"])
        box("garage", 0.7, -0.56, 0, 0.94, -0.2, FZ * 0.9, m["siding"])
        garage_door("garage-door", "-Y", -0.56, 0.73, 0.91, px(1), FZ * 0.72 - px(1), m)
        windows_on("ranch", 0.08, -0.6, 0.7, -0.14, 0, 1, m, faces=("+Y", "-X", "+X"), per=3)
        # Reserve the door frame and porch lamp instead of spacing windows across them.
        window("ranch-front-left", "-Y", -0.6, 0.16, 0.32, FZ * 0.28, FZ * 0.78, m)
        window("ranch-front-right", "-Y", -0.6, 0.61, 0.65, FZ * 0.28, FZ * 0.78, m)
        door("door", "-Y", -0.6, 0.4, 0.5, 0, m)
        hip("roof", 0.08, -0.6, 0.94, -0.14, FZ, px(16), m["shingle"])
        peak = FZ + px(16)
    elif variant == "split":
        box("low", 0.08, -0.58, 0, 0.48, -0.14, FZ, m["siding"])
        box("high", 0.48, -0.5, 0, 0.94, -0.1, 2 * FZ, m["siding"])
        garage_door("garage-door", "-Y", -0.5, 0.56, 0.88, px(1), FZ * 0.72 - px(1), m)
        windows_on("low", 0.08, -0.58, 0.48, -0.14, 0, 1, m, faces=("+Y", "-X", "+X"))
        window("split-front-left", "-Y", -0.58, 0.135, 0.215, FZ * 0.28, FZ * 0.78, m)
        windows_on("high", 0.48, -0.5, 0.94, -0.1, FZ, 1, m)
        door("door", "-Y", -0.58, 0.28, 0.38, 0, m)
        gable("roof-low", 0.08, -0.58, 0.48, -0.14, FZ, px(12), m["shingle"], ridge="x", end_mat=m["siding"])
        gable("roof-high", 0.48, -0.5, 0.94, -0.1, 2 * FZ, px(14), m["shingle"], ridge="x", end_mat=m["siding"])
        peak = 2 * FZ + px(14)
    elif variant == "colonial":
        bx1 = 0.72 if garage2 else 0.88
        box("body", 0.1, -0.62, 0, bx1, -0.16, 2 * FZ, m["siding"])
        windows_on("colonial", 0.1, -0.62, bx1, -0.16, 0, 2, m, faces=("+Y", "-X", "+X"))
        cx = (0.1 + bx1) / 2
        for f in range(2):
            z0 = f * FZ + FZ * 0.28
            for i, u in enumerate((0.18, cx - 0.12, cx + 0.12, bx1 - 0.08)):
                if f == 0 and abs(u - cx) < 0.2:
                    continue  # the door and portico take the middle of the ground floor
                window(f"front{f}{i}", "-Y", -0.62, u - 0.05, u + 0.05, z0, z0 + FZ * 0.5, m)
                for side in (-1, 1):
                    _slab(f"shutter{f}{i}{side}", "-Y", -0.62, u + side * 0.075 - 0.02, u + side * 0.075 + 0.02, -0.005, E, z0, z0 + FZ * 0.5, m["accent"])
        door("door", "-Y", -0.62, cx - 0.05, cx + 0.05, 0, m)
        for x in (cx - 0.1, cx + 0.1):
            cylinder(f"column{x:.2f}", x, -0.7, 0.015, 0, FZ * 0.9, m["trim"], verts=8)
        gable("portico", cx - 0.13, -0.73, cx + 0.13, -0.62, FZ * 0.9, px(7), m["trim"], ridge="y", over=0.01)
        gable("roof", 0.1, -0.62, bx1, -0.16, 2 * FZ, px(22), m["shingle"], ridge="x", end_mat=m["siding"])
        peak = 2 * FZ + px(22)
        if garage2:
            box("garage", 0.72, -0.58, 0, 0.98, -0.18, FZ, m["siding"])
            for i, gx in enumerate((0.74, 0.86)):
                garage_door(f"garage-door{i}", "-Y", -0.58, gx, gx + 0.1, px(1), FZ * 0.75 - px(1), m)
            hip("garage-roof", 0.72, -0.58, 0.98, -0.18, FZ, px(10), m["shingle"])
    else:  # craftsman
        box("body", 0.14, -0.56, 0, 0.84, -0.12, FZ, m["siding"])
        box("porch", 0.14, -0.76, 0, 0.84, -0.56, px(6), m["stair"])
        for i, x in enumerate((0.16, 0.47, 0.8)):
            box(f"pier{i}", x, -0.76, px(6), x + 0.05, -0.71, px(12), m["brick"])
            box(f"post{i}", x + 0.01, -0.755, px(12), x + 0.04, -0.725, FZ, m["trim"])
        windows_on("craftsman", 0.14, -0.56, 0.84, -0.12, 0, 1, m, faces=("+Y", "-X", "+X"))
        window("front-l", "-Y", -0.56, 0.2, 0.38, FZ * 0.28, FZ * 0.78, m)
        window("front-r", "-Y", -0.56, 0.6, 0.78, FZ * 0.28, FZ * 0.78, m)
        door("door", "-Y", -0.56, 0.44, 0.54, px(6), m)
        if porch_swing:
            box("swing", 0.2, -0.72, px(10), 0.36, -0.64, px(12), m["accent"])
            box("swing-back", 0.2, -0.655, px(12), 0.36, -0.64, px(17), m["accent"])
            for x in (0.21, 0.35):
                beam(f"swing-chain{x}", (x, -0.68, px(12)), (x, -0.68, FZ), 0.009, m["metal"])
        gable("roof", 0.14, -0.76, 0.84, -0.12, FZ, px(20), m["shingle"], ridge="y", over=0.07, end_mat=m["siding"])
        peak = FZ + px(20)
    if car_parked is None:
        car_parked = rng.random() < 0.5
    if car_parked:
        # The SUV and its tires fit the paved strip, clear of the closed garage at -0.58.
        peak = max(peak, car("car", 0.735 if garage2 else 0.73, -0.96, along="y",
                             big=garage2, rng=rng, length=0.33 if garage2 else None))
    return peak


def walkup(w, d, floors, seed, variant=0, color=None, lit=0.6, hero_window=False):
    """A 3-4 floor walk-up: stacked square bays, a fire escape over the door, a canopy, water heaters on the roof.
    Walls: 0 brick (not tinted), 1 painted siding, 2 stucco. hero_window: one warm window on the second floor and
    every other window dark (the player's studio)."""
    rng = random.Random(seed)
    m = mats(rng, color, 0.0 if hero_window else lit)
    if hero_window:
        m["lamp"] = M.flat("unlit-porch-lamp", (0.65, 0.6, 0.48, 1), rough=0.5)
    lot(w, d, m, "paving")
    wall = (m["brick"], m["siding"], m["stucco"])[variant]
    x0, x1, yf, yb = 0.02, w - 0.02, -0.86, -0.05
    base = px(8)
    top = base + floors * FZ
    box("body", x0, yf, 0, x1, yb, top, wall)
    door_c = w / 2 if w > 1 else 0.72
    bays = [0.3] if w == 1 else [0.35, w - 0.35]
    for i, cx in enumerate(bays):
        box(f"bay{i}", cx - 0.2, yf - 0.1, base + FZ * 0.1, cx + 0.2, yf, top - px(2), wall)
        for f in range(floors):
            z0 = base + f * FZ + FZ * 0.25
            window(f"bay{i}-{f}", "-Y", yf - 0.1, cx - 0.13, cx + 0.13, z0, z0 + FZ * 0.5, m)
            window(f"bay{i}-{f}l", "-X", cx - 0.2, yf - 0.085, yf - 0.025, z0, z0 + FZ * 0.5, m)
            window(f"bay{i}-{f}r", "+X", cx + 0.2, yf - 0.085, yf - 0.025, z0, z0 + FZ * 0.5, m)
    if hero_window:
        glow = M.flat("home-window", (1.0, 0.86, 0.58, 1), rough=0.4, glow=(1.0, 0.8, 0.5, 1), strength=5.0)
        z0 = base + FZ + FZ * 0.25
        _slab("home-window", "-Y", yf - 0.1, bays[0] - 0.13, bays[0] + 0.13, -0.005, E + 0.01, z0, z0 + FZ * 0.5, glow)
        _slab("home-plant", "-Y", yf - 0.1, bays[0] - 0.05, bays[0] + 0.03, E, E + 0.04, z0, z0 + px(4), m["hedge"])
    door("door", "-Y", yf, door_c - 0.08, door_c + 0.08, base, m)
    _slab("buzzer", "-Y", yf, door_c - 0.12, door_c - 0.09, E, E + 0.01, base + FZ * 0.3, base + FZ * 0.55, m["metal"])
    for i in range(3):
        z = base + FZ * 0.33 + i * px(1.3)
        _slab(f"buzzer-button{i}", "-Y", yf, door_c - 0.114, door_c - 0.1, E + 0.01, E + 0.015, z, z + px(0.6), m["trim"])
    stoop("steps", door_c - 0.11, door_c + 0.11, -0.99, yf, base, m, steps=2)
    box("canopy", door_c - 0.13, yf - 0.1, base + FZ * 0.85, door_c + 0.13, yf, base + FZ * 0.92, m["accent"])
    for f in range(1, floors):
        z = base + f * FZ
        window(f"escape-win{f}", "-Y", yf, door_c - 0.07, door_c + 0.07, z + FZ * 0.2, z + FZ * 0.75, m)
        box(f"escape{f}", door_c - 0.14, yf - 0.12, z, door_c + 0.14, yf, z + px(1), m["metal"])
        box(f"escape-rail{f}", door_c - 0.14, yf - 0.125, z + px(6), door_c + 0.14, yf - 0.115, z + px(7), m["metal"])
        for i in range(5):
            x = door_c - 0.14 + i * 0.07
            box(f"escape-spindle{f}-{i}", x, yf - 0.125, z + px(1), x + 0.01, yf - 0.115, z + px(6), m["metal"])
        for side in (-1, 1):
            x = door_c + side * 0.14
            box(f"escape-side{f}-{side}", x, yf - 0.12, z + px(6), x + 0.01, yf, z + px(7), m["metal"])
        for i in range(6):
            rz = z - FZ + px(2) + i * FZ / 6
            box(f"ladder-rung{f}-{i}", door_c + 0.03, yf - 0.11, rz, door_c + 0.11, yf - 0.09, rz + px(0.7), m["metal"])
        box(f"ladder-inner{f}", door_c + 0.03, yf - 0.1, z - FZ + px(1), door_c + 0.04, yf - 0.09, z, m["metal"])
        box(f"ladder{f}", door_c + 0.09, yf - 0.1, z - FZ + px(1), door_c + 0.11, yf - 0.09, z, m["metal"])
    box("cornice", x0 - 0.02, yf - 0.12, top - px(3), x1 + 0.02, yb + 0.02, top + px(3), m["trim"])
    windows_on("sides", x0, yf, x1, yb, base, floors, m, faces=("+Y", "-X", "+X"))
    for i in range(len(bays)):
        cylinder(f"heater{i}", x1 - 0.2 - i * 0.6, -0.3, 0.06, top + px(3), top + px(14), m["metal"], verts=8)
    return top + px(14)


HOUSE_BUILDERS = {
    "victorian": victorian,
    "edwardian": edwardian,
    "stucco_row": stucco_row,
    "suburban": suburban,
    "walkup": walkup,
}
