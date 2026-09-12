"""Building archetypes. Footprint is w x d tiles from (0, 0) to (w, -d); each
takes (w, d, floors, seed, **opts) and returns its highest point in Blender units."""
import random

from . import materials as M
from . import signs
from .geo import box, face_quad, pyramid, squircle_tower
from .iso import FLOOR_PX, PLINTH_PX, body_top, px

FZ = px(FLOOR_PX)
PLINTH = px(PLINTH_PX)


def _parapet(w, d, z, h, t, mat):
    box("par-n", 0, -t, z, w, 0, z + h, mat)
    box("par-s", 0, -d, z, w, -d + t, z + h, mat)
    box("par-w", 0, -d, z, t, 0, z + h, mat)
    box("par-e", w - t, -d, z, w, 0, z + h, mat)


def _roof(rng, w, d, top, slab_mat, rim_mat, clutter_mat, clutter=True):
    box("roof", 0.01, -d + 0.01, top, w - 0.01, -0.01, top + px(1), slab_mat)
    _parapet(w, d, top, px(4), 0.035, rim_mat)
    peak = top + px(4)
    for i in range(rng.randint(1, 2 + w * d // 2) if clutter else 0):
        sx, sy = rng.uniform(0.14, 0.3), rng.uniform(0.14, 0.3)
        x = rng.uniform(0.12, w - 0.12 - sx)
        y = -rng.uniform(0.12 + sy, d - 0.12)
        h = px(rng.uniform(5, 11))
        box(f"hvac{i}", x, y, top, x + sx, y + sy, top + h, clutter_mat)
        peak = max(peak, top + h)
    return peak


def _hvac():
    return M.flat("hvac", (0.6, 0.61, 0.62, 1), rough=0.5, metal=0.5)


def _brick(rng):
    # Bricks075A is a pale brick; tint it toward SF's red and brown masonry.
    tint = rng.choice([(1.0, 0.58, 0.46, 1), (0.9, 0.62, 0.5, 1), (0.8, 0.5, 0.4, 1)])
    return M.pbr("brick", "Bricks075A", 0.5, tint)


def _punched(w, d, f0, floors, glass, stone, faces=("-Y", "+X"), per=2, tall=0.58):
    """Punched windows with stone sills on the visible faces, floors f0..floors-1."""
    e = 0.012
    for f in range(f0, floors):
        z0 = PLINTH + f * FZ + FZ * (0.8 - tall) / 2 + FZ * 0.1
        z1 = z0 + FZ * tall
        if "-Y" in faces:
            for i in range(w * per):
                u0, u1 = (i + 0.28) / per, (i + 0.72) / per
                box(f"wl{f}.{i}", u0, -d - e, z0, u1, -d + 0.02, z1, glass)
                box(f"sl{f}.{i}", u0 - 0.02, -d - e * 2, z0 - px(1.6), u1 + 0.02, -d + 0.02, z0, stone)
        if "+X" in faces:
            for j in range(d * per):
                v0, v1 = -(j + 0.72) / per, -(j + 0.28) / per
                box(f"wr{f}.{j}", w - 0.02, v0, z0, w + e, v1, z1, glass)
                box(f"sr{f}.{j}", w - 0.02, v0 - 0.02, z0 - px(1.6), w + e * 2, v1 + 0.02, z0, stone)


def glass_tower(w, d, floors, seed, lit=0.35):
    rng = random.Random(seed)
    top = body_top(floors)
    tint = rng.choice([(0.09, 0.16, 0.24, 1), (0.1, 0.19, 0.22, 1), (0.14, 0.16, 0.2, 1)])
    box("tower", 0, -d, 0, w, 0, top, M.windows("curtain", 1 / 3, FZ, lit, tint, frame_frac=0.06))
    metal = M.flat("metal", (0.55, 0.57, 0.6, 1), rough=0.35, metal=0.8)
    return _roof(rng, w, d, top, M.pbr("roofslab", "Concrete034", 1.0, (0.24, 0.25, 0.26, 1)), metal, metal)


def brick_loft(w, d, floors, seed, lit=0.55, mural=None):
    """A masonry loft. mural = {"image", "aspect"} paints the right (+X) face, which is then a blank party wall."""
    rng = random.Random(seed)
    top = body_top(floors)
    box("body", 0, -d, 0, w, 0, top, _brick(rng))
    stone = M.flat("stone", (0.78, 0.74, 0.66, 1), rough=0.85)
    glass = M.windows("win", 0.5, FZ, lit, (0.05, 0.07, 0.09, 1))
    _punched(w, d, 0, floors, glass, stone, faces=("-Y",) if mural else ("-Y", "+X"))
    if mural:
        span, height = d * 0.84, top - PLINTH - px(6)
        width = min(span, height * mural["aspect"])
        u0 = (d - width) / 2
        z0 = PLINTH + (height - width / mural["aspect"]) / 2 + px(2)
        signs.mural(mural["image"], "+X", w, d, u0, u0 + width, z0, mural["aspect"])
    box("cornice", -0.02, -d - 0.02, top - px(3), w + 0.02, 0.02, top, stone)
    tar = M.pbr("tar", "Asphalt026B", 0.8, (0.6, 0.6, 0.6, 1))
    return _roof(rng, w, d, top, tar, stone, _hvac())


def concrete_office(w, d, floors, seed, lit=0.6):
    rng = random.Random(seed)
    top = body_top(floors)
    conc = M.pbr("concrete", "Concrete034", 0.6, (0.95, 0.93, 0.88, 1))
    box("core", 0.01, -d + 0.01, 0, w - 0.01, -0.01, top, M.windows("ribbon", 1 / 4, FZ, lit, (0.1, 0.15, 0.2, 1), frame_frac=0.05))
    e = 0.01
    for f in range(1, floors):  # floor 0 is the glass lobby
        z0 = PLINTH + f * FZ
        box(f"band{f}", -e, -d - e, z0 - FZ * 0.12, w + e, e, z0 + FZ * 0.34, conc)
    # The canopy reaches the lot line but not past it, so the sprite stays on its tiles.
    box("canopy", -e, -d - e, PLINTH + FZ * 0.88, w + e, e, PLINTH + FZ, conc)
    box("crown", -e, -d - e, top - px(5), w + e, e, top, conc)
    return _roof(rng, w, d, top, M.pbr("roofslab", "Concrete034", 1.0, (0.34, 0.34, 0.33, 1)), conc, _hvac())


FACADES = {
    "brick": lambda rng: _brick(rng),
    "stone": lambda rng: M.pbr("stone", "Concrete034", 0.7, (0.72, 0.68, 0.6, 1)),
    "stucco": lambda rng: M.pbr("stucco", "Concrete034", 1.4, (0.84, 0.8, 0.72, 1)),
}


def storefront(w, d, floors, seed, facade="brick", fascia=None, blade=None, atm=False, lit=0.5):
    """A street-corner shop: warm lit shop windows on both faces, a sign band over them, a blade sign, upper-floor windows."""
    rng = random.Random(seed)
    top = body_top(floors)
    wall = FACADES[facade](rng)
    box("body", 0, -d, 0, w, 0, top, wall)
    dark = M.flat("plinth", (0.16, 0.16, 0.17, 1), rough=0.6)
    box("plinth", -0.008, -d - 0.008, 0, w + 0.008, 0.008, PLINTH, dark)
    # Shop glass: a warm lit interior shows through by day (a little emission), fully lit at night.
    shop = M.windows("shop", 1 / 3, FZ, 1.0, (0.62, 0.5, 0.36, 1), frame_frac=0.05, frame_color=(0.1, 0.1, 0.11, 1), strength=1.3)
    g1 = PLINTH + FZ * 0.72
    box("shop-y", 0.03, -d - 0.006, PLINTH, w - 0.03, -d + 0.02, g1, shop)
    box("shop-x", w - 0.02, -d + 0.03, PLINTH, w + 0.006, -0.03, g1, shop)
    band_z, band_h = g1 + px(0.8), PLINTH + FZ * 0.98 - (g1 + px(0.8))
    if fascia:
        signs.fascia(fascia, "-Y", w, d, band_z, band_h)
        signs.fascia(fascia, "+X", w, d, band_z, band_h)
    if atm:
        red = M.flat("atm", signs.srgb((0.843, 0.118, 0.157)), rough=0.4)
        box("atm", w - 0.004, -d + 0.1, PLINTH + FZ * 0.08, w + 0.016, -d + 0.26, PLINTH + FZ * 0.62, red)
        box("atm-screen", w + 0.016, -d + 0.13, PLINTH + FZ * 0.34, w + 0.02, -d + 0.23, PLINTH + FZ * 0.52,
            M.flat("atm-screen", (0.05, 0.12, 0.2, 1), rough=0.2, glow=(0.4, 0.7, 1.0, 1), strength=3.0))
    stone = M.flat("trim", (0.8, 0.77, 0.7, 1), rough=0.85)
    glass = M.windows("win", 0.5, FZ, lit, (0.05, 0.07, 0.09, 1))
    _punched(w, d, 1, floors, glass, stone)
    if blade:
        signs.blade(blade, 0.3, d, PLINTH + FZ * 1.05)
    box("cornice", -0.02, -d - 0.02, top - px(3), w + 0.02, 0.02, top, stone)
    return _roof(rng, w, d, top, M.pbr("tar", "Asphalt026B", 0.8, (0.6, 0.6, 0.6, 1)), stone, _hvac())


def hq_lobby(w, d, floors, seed, logo=None, monument=None, lit=0.4):
    """A glass office tower whose upper floors overhang a double-height glass lobby. A lit logo
    wall stands inside the lobby; an optional monument sign sits in the recess in front."""
    rng = random.Random(seed)
    top = body_top(floors)
    lobby = PLINTH + 2 * FZ
    tint = rng.choice([(0.09, 0.16, 0.24, 1), (0.12, 0.15, 0.19, 1)])
    box("tower", 0, -d, lobby, w, 0, top, M.windows("curtain", 1 / 3, FZ, lit, tint, frame_frac=0.06))
    stone = M.flat("paving", (0.72, 0.7, 0.66, 1), rough=0.85)
    box("plaza", 0, -d, 0, w, 0, px(1), stone)
    soffit = M.flat("soffit", (0.82, 0.8, 0.76, 1), rough=0.7, glow=(1.0, 0.9, 0.75, 1), strength=0.6)
    box("soffit", 0, -d, lobby - px(1.5), w, 0, lobby, soffit)
    recess = 0.22
    glass = M.clear_glass("lobby-glass")
    box("lobby-y", 0.06, -d + recess - 0.012, px(1), w - 0.06, -d + recess, lobby - px(1.5), glass)
    box("lobby-x", w - 0.012, -d + recess, px(1), w, -0.06, lobby - px(1.5), glass)
    interior = M.flat("interior", (0.22, 0.2, 0.18, 1), rough=0.8)
    core_front = -d + recess + 0.3
    box("core", 0.25, core_front, px(1), w - 0.3, -0.3, lobby - px(1.5), interior)
    col = M.flat("column", (0.5, 0.52, 0.55, 1), rough=0.4, metal=0.6)
    for x in (0.0, w - 0.06):
        box(f"col{x}", x, -d, px(1), x + 0.06, -d + 0.06, lobby - px(1.5), col)
    box("col-back", w - 0.06, -0.06, px(1), w, 0, lobby - px(1.5), col)
    if logo:
        lw = min((w - 0.55) * 0.9, (lobby - px(4)) * 2 * 0.9)
        x0 = 0.25 + ((w - 0.55) - lw) / 2
        signs.logo_wall(logo, x0, x0 + lw, core_front - 0.003, px(1) + (lobby - px(2.5) - lw / 2) / 2)
    if monument:
        signs.monument(monument, 0.14, -d + 0.03)
    metal = M.flat("metal", (0.55, 0.57, 0.6, 1), rough=0.35, metal=0.8)
    return _roof(rng, w, d, top, M.pbr("roofslab", "Concrete034", 1.0, (0.24, 0.25, 0.26, 1)), metal, metal)


def salesforce_tower(w, d, floors, seed):
    """415 Mission: a tapered rounded-square tower with white vertical fins, topped by an open
    crown whose LEDs play video at night (the crown material is masked out for the game to animate)."""
    top = body_top(floors)
    crown_h = top * 0.12
    cx, cy = w / 2, -d / 2
    r0 = min(w, d) / 2 * 0.97
    r_mid = r0 * 0.74
    r_top = r0 * 0.66
    # Cells run around the tower (not along x - y), so the fins stay vertical on the curved corners.
    body = M.windows("curtain", 1 / 6, FZ, 0.3, (0.16, 0.22, 0.28, 1), frame_frac=0.18, frame_color=(0.8, 0.8, 0.78, 1), center=(cx, cy, (r0 + r_mid) / 2))
    squircle_tower("tower", cx, cy, r0, r_mid, 0, top - crown_h, body)
    squircle_tower("roofcap", cx, cy, r_mid * 0.98, r_mid * 0.98, top - crown_h, top - crown_h + px(4), M.flat("cap", (0.3, 0.31, 0.33, 1), rough=0.6), cap=True)
    crown = M.flat("crown", (0.56, 0.58, 0.6, 1), rough=0.4, metal=0.7)
    squircle_tower("crown", cx, cy, r_mid, r_top, top - crown_h, top, crown)
    return top


def ferry_building(w, d, floors, seed):
    """The Ferry Building: a long three-story arcaded hall with a clock tower over the middle
    and red "PORT OF SAN FRANCISCO" letters along the roof edge facing the city."""
    top = body_top(3)
    stone = M.pbr("sandstone", "Concrete034", 0.8, (0.84, 0.78, 0.66, 1))
    box("hall", 0, -d, 0, w, 0, top, stone)
    glass = M.windows("arcade", 0.25, FZ, 0.5, (0.07, 0.08, 0.1, 1))
    trim = M.flat("trim", (0.9, 0.86, 0.78, 1), rough=0.8)
    _punched(w, d, 0, 3, glass, trim, per=4, tall=0.66)
    box("cornice", -0.02, -d - 0.02, top - px(3), w + 0.02, 0.02, top, trim)
    box("roof", 0.02, -d + 0.02, top, w - 0.02, -0.02, top + px(2), M.flat("roof", (0.42, 0.44, 0.45, 1), rough=0.6))
    box("skylight", 0.2, -d / 2 - 0.12, top + px(2), w - 0.2, -d / 2 + 0.12, top + px(7), M.clear_glass("skylight", (0.7, 0.8, 0.85, 1)))
    tx, ty, tw = w / 2, -d / 2, 0.42
    shaft = top + px(92)
    box("tower", tx - tw / 2, ty - tw / 2, top, tx + tw / 2, ty + tw / 2, shaft, stone)
    box("belfry", tx - tw * 0.42, ty - tw * 0.42, shaft, tx + tw * 0.42, ty + tw * 0.42, shaft + px(26), stone)
    box("band", tx - tw / 2 - 0.02, ty - tw / 2 - 0.02, shaft - px(3), tx + tw / 2 + 0.02, ty + tw / 2 + 0.02, shaft, trim)
    clock = M.flat("clock", (0.96, 0.95, 0.9, 1), rough=0.5, glow=(1.0, 0.95, 0.8, 1), strength=5.0)
    cz, cs = shaft - px(24), 0.24
    face_quad("clock-y", "-Y", tx + tw / 2, -ty + tw / 2, tx - cs / 2, tx + cs / 2, cz, cz + cs * 1.16, clock, off=0.004)
    face_quad("clock-x", "+X", tx + tw / 2, -ty + tw / 2, tw / 2 - cs / 2, tw / 2 + cs / 2, cz, cz + cs * 1.16, clock, off=0.004)
    pyramid("cap", tx, ty, tw * 0.44, shaft + px(26), px(26), M.flat("cap", (0.45, 0.47, 0.46, 1), rough=0.5, metal=0.3))
    red, glow = (0.85, 0.12, 0.1), (1.0, 0.22, 0.16)
    # The longer line sets the letter size; the shorter one matches it.
    s = signs.letters("SAN FRANCISCO", red, glow, tx + tw / 2 + 0.12, w - 0.2, -d + 0.05, top + px(2), 12)
    signs.letters("PORT OF", red, glow, 0.2, tx - tw / 2 - 0.12, -d + 0.05, top + px(2), 12, max_scale=s)
    return shaft + px(52)


def monopole_lot(w, d, floors, seed, a=None, b=None):
    return signs.monopole(a, b)


def shelter_lot(w, d, floors, seed, image=None, side="sy"):
    return signs.shelter(image, side)


BUILDERS = {
    "glass_tower": glass_tower,
    "brick_loft": brick_loft,
    "concrete_office": concrete_office,
    "storefront": storefront,
    "hq_lobby": hq_lobby,
    "salesforce_tower": salesforce_tower,
    "ferry_building": ferry_building,
    "monopole": monopole_lot,
    "shelter": shelter_lot,
}
