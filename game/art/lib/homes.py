"""The player's six home tiers (docs/superpowers/specs/2026-09-12-blender-houses-design.md): one-of-a-kind
models with baked colors, through the same pixel pass. Tier 0 is a tent; the others dress up the house
archetypes. They are shared by every city (public/sprites/common/home/)."""
import math
import random
from functools import wraps

import bpy

from . import materials as M
from .geo import _mesh, box, cylinder, hip
from .houses import FZ, beam, car, door, lot, mats, suburban, victorian, walkup, windows_on
from .iso import px


def _inset(builder):
    """Keep hero structures inside 80% of the lot, leaving the registration plate full size."""
    @wraps(builder)
    def build(w, d, floors, seed):
        before = set(bpy.context.scene.objects)
        builder(w, d, floors, seed)
        created = set(bpy.context.scene.objects) - before
        for ob in created:
            if ob.type != "MESH" or ob.name.split(".")[0] == "lot":
                continue
            for v in ob.data.vertices:
                v.co.x = w / 2 + (v.co.x - w / 2) * 0.8
                v.co.y = -d / 2 + (v.co.y + d / 2) * 0.8
        return max(v.co.z for ob in created if ob.type == "MESH" for v in ob.data.vertices)
    return build


@_inset
def home_tent(w, d, floors, seed):
    """Tier 0: a worn dome tent with a tarp, a shopping cart of belongings, a camp stool, and a lantern."""
    m = mats(random.Random(seed))
    lot(w, d, m, "lawn")
    box("dirt", 0.18, -0.84, 0, 0.84, -0.2, px(1.5), M.flat("dirt", (0.52, 0.42, 0.3, 1), rough=1.0))
    canvas = M.flat("tent", (0.9, 0.48, 0.16, 1), rough=0.8)
    seam = M.flat("tent-seam", (0.5, 0.24, 0.12, 1), rough=0.9)
    # Three curved rings and one apex form a dome, with no coincident pole vertices.
    verts = []
    for radius, z in ((0.26, px(1.5)), (0.245, px(10)), (0.16, px(19))):
        verts.extend((0.44 + radius * math.cos(math.tau * i / 12),
                      -0.54 + radius * math.sin(math.tau * i / 12), z) for i in range(12))
    verts.append((0.44, -0.54, px(23)))
    faces = [tuple(reversed(range(12)))]
    for ring in range(2):
        for i in range(12):
            j = (i + 1) % 12
            faces.append((ring * 12 + i, ring * 12 + j, (ring + 1) * 12 + j, (ring + 1) * 12 + i))
    faces.extend((24 + i, 24 + (i + 1) % 12, 36) for i in range(12))
    _mesh("tent", verts, faces, [canvas])
    for i in (0, 3, 6, 9):
        for ring in range(2):
            beam(f"tent-rib{i}-{ring}", verts[ring * 12 + i], verts[(ring + 1) * 12 + i], 0.012, seam)
        beam(f"tent-rib{i}-top", verts[24 + i], verts[36], 0.012, seam)
    flap = [(0.36, -0.785, px(2)), (0.52, -0.785, px(2)),
            (0.49, -0.758, px(10)), (0.44, -0.707, px(18)), (0.39, -0.758, px(10))]
    # Closed thin shell over the front of the dome: a dark zippered opening.
    _mesh("tent-door", flap + [(x, y + 0.012, z) for x, y, z in flap],
          [(4, 3, 2, 1, 0), (5, 6, 7, 8, 9)] + [(i, (i + 1) % 5, (i + 1) % 5 + 5, i + 5) for i in range(5)], [seam])
    box("tarp", 0.16, -0.82, px(1.5), 0.72, -0.24, px(2), M.flat("tarp", (0.2, 0.4, 0.62, 1), rough=0.7))
    box("cart-base", 0.64, -0.38, px(3), 0.84, -0.22, px(4), m["metal"])
    for x in (0.64, 0.83):
        for y in (-0.38, -0.23):
            box(f"cart-wheel{x}{y}", x, y, px(1), x + 0.025, y + 0.025, px(3), m["metal"])
    for z in (px(6), px(10)):
        for y in (-0.38, -0.22):
            beam(f"basket-rail{y}{z}", (0.64, y, z), (0.84, y, z), 0.012, m["metal"])
        for x in (0.64, 0.84):
            beam(f"basket-end{x}{z}", (x, -0.38, z), (x, -0.22, z), 0.012, m["metal"])
    for i in range(5):
        for y in (-0.38, -0.22):
            x = 0.64 + 0.05 * i
            beam(f"basket-wire{i}{y}", (x, y, px(4)), (x, y, px(10)), 0.008, m["metal"])
    beam("cart-handle", (0.64, -0.2, px(12)), (0.84, -0.2, px(12)), 0.015, m["metal"])
    box("bags", 0.66, -0.36, px(10), 0.82, -0.24, px(14), M.flat("bags", (0.22, 0.32, 0.26, 1), rough=0.8))
    box("stool", 0.22, -0.8, px(4), 0.3, -0.72, px(5), m["accent"])
    for y in (-0.79, -0.73):
        beam(f"stool-leg{y}a", (0.22, y, 0), (0.3, y, px(4)), 0.014, m["metal"])
        beam(f"stool-leg{y}b", (0.3, y, 0), (0.22, y, px(4)), 0.014, m["metal"])
    box("lantern", 0.34, -0.84, 0, 0.38, -0.8, px(5), m["lamp"])
    return px(24)


@_inset
def home_studio(w, d, floors, seed):
    """Tier 1: a narrow brick walk-up; the player's window is the only one lit at night."""
    return walkup(w, d, 4, seed, variant=0, hero_window=True)


@_inset
def home_bungalow(w, d, floors, seed):
    """Tier 2: a sage craftsman bungalow with a porch swing, a small lawn, and a mailbox."""
    return suburban(w, d, 1, seed, "craftsman", car_parked=False, color=(0.56, 0.72, 0.58, 1), porch_swing=True)


@_inset
def home_townhouse(w, d, floors, seed):
    """Tier 3: a sky-blue three-floor Stick Victorian with flower boxes and a car at the curb."""
    peak = victorian(w, d, 3, seed, "stick", color=(0.55, 0.7, 0.88, 1))
    m = mats(random.Random(seed))
    for f in range(1, 3):
        z = px(12) + f * FZ + FZ * 0.2
        box(f"flowers{f}", 0.62, -0.84, z - px(3), 0.82, -0.8, z, m["hedge"])
        box(f"blooms{f}", 0.64, -0.845, z - px(1), 0.8, -0.81, z + px(1), M.flat(f"blooms{f}", (0.9, 0.3, 0.4, 1), rough=0.8))
    return max(peak, car("car", 0.06, -0.99, along="x", color=(0.75, 0.16, 0.14, 1)))


@_inset
def home_colonial(w, d, floors, seed):
    """Tier 4: a cream two-story colonial with a two-car garage, a hedge, an SUV, and a lit porch."""
    return suburban(w, d, 2, seed, "colonial", car_parked=True, color=(0.96, 0.93, 0.85, 1), garage2=True, hedge=True)


def home_villa(w, d, floors, seed):
    """Tier 5: a Mediterranean villa: two stucco wings under tile, a lit pool, palms, a pergola, a golf cart."""
    m = mats(random.Random(seed), (0.96, 0.9, 0.78, 1), lit=0.8)
    lot(w, d, m, "lawn")
    box("terrace", 0.0, -1.0, 0, 0.5, -0.5, px(2), m["stair"])
    box("wing-a", 0.04, -0.5, 0, 0.62, -0.04, 2 * FZ, m["stucco"])
    box("wing-b", 0.62, -0.36, 0, 0.96, -0.04, FZ, m["stucco"])
    windows_on("a", 0.04, -0.5, 0.62, -0.04, 0, 2, m)
    windows_on("b", 0.62, -0.36, 0.96, -0.04, 0, 1, m)
    door("villa-door", "-Y", -0.5, 0.36, 0.49, px(2), m)
    hip("roof-a", 0.04, -0.5, 0.62, -0.04, 2 * FZ, px(16), m["tile"])
    hip("roof-b", 0.62, -0.36, 0.96, -0.04, FZ, px(12), m["tile"])
    water = M.flat("pool", (0.3, 0.72, 0.86, 1), rough=0.1, glow=(0.3, 0.8, 1.0, 1), strength=1.5)
    box("pool-edge", 0.54, -0.96, 0, 0.96, -0.6, px(3), m["trim"])
    box("pool", 0.57, -0.93, px(1), 0.93, -0.63, px(3.2), water)
    trunk = M.flat("trunk", (0.5, 0.36, 0.22, 1), rough=0.9)
    fronds = M.flat("fronds", (0.22, 0.52, 0.26, 1), rough=0.8)
    for i, (x, y) in enumerate(((0.44, -0.56), (0.86, -0.46))):
        cylinder(f"palm{i}", x, y, 0.018, 0, px(40), trunk, verts=6)
        for j in range(6):
            a = math.tau * j / 6
            dx, dy = math.cos(a), math.sin(a)
            # Broad tapered leaves with a raised center rib, not a conical canopy.
            pts = [(x, y, px(40)), (x + dx * 0.065 - dy * 0.025, y + dy * 0.065 + dx * 0.025, px(43)),
                   (x + dx * 0.13, y + dy * 0.13, px(36)),
                   (x + dx * 0.065 + dy * 0.025, y + dy * 0.065 - dx * 0.025, px(43)),
                   (x + dx * 0.06, y + dy * 0.06, px(44))]
            _mesh(f"frond{i}-{j}", pts, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], [fronds])
    for i, (x, y) in enumerate(((0.05, -0.95), (0.3, -0.95), (0.05, -0.62), (0.3, -0.62))):
        box(f"post{i}", x, y, 0, x + 0.03, y + 0.03, FZ * 0.9, m["trim"])
    for i in range(5):
        x = 0.05 + i * 0.07
        box(f"slat{i}", x, -0.96, FZ * 0.9, x + 0.02, -0.58, FZ * 0.95, m["trim"])
    box("cart", 0.68, -0.56, px(2), 0.84, -0.42, px(8), M.flat("golfcart", (0.95, 0.95, 0.92, 1), rough=0.5))
    box("cart-roof", 0.68, -0.56, px(14), 0.84, -0.42, px(15), m["trim"])
    for x in (0.69, 0.82):
        for y in (-0.54, -0.43):
            box(f"cart-wheel{x}{y}", x - 0.015, y - 0.018, px(1), x + 0.015, y + 0.018, px(4), m["metal"])
            beam(f"cart-upright{x}{y}", (x, y, px(8)), (x, y, px(14)), 0.009, m["metal"])
    box("cart-seat", 0.7, -0.48, px(8), 0.82, -0.43, px(10), m["accent"])
    return max(2 * FZ + px(16), px(44))


HOME_BUILDERS = {
    "home_tent": home_tent,
    "home_studio": home_studio,
    "home_bungalow": home_bungalow,
    "home_townhouse": home_townhouse,
    "home_colonial": home_colonial,
    "home_villa": home_villa,
}
