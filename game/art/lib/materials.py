"""Materials. Every material mixes its day surface with a night surface through
a Value node named "is_night": black at night, or emission (node "emit") where
it glows. Clear glass turns transparent at night so lit lobbies show through.

Walls are pixel materials: flat colors whose patterns (courses, brick joints) are laid out on the sprite's
1x pixel grid, so the 4x render's majority downsample turns them into exact one-pixel lines."""
import bpy

from .iso import HALF_H, HALF_W, Z_PX_PER_BU

# Material colors are linear, but the render is viewed in sRGB, where the pixel pass measures brightness: a
# pattern line meant to be dark x as bright on screen is dark ** SRGB_GAMMA as bright in linear.
SRGB_GAMMA = 2.2
WARM_A, WARM_B = (1.0, 0.62, 0.28, 1), (1.0, 0.82, 0.55, 1)


def _base(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return m, nt, nt.nodes.new("ShaderNodeOutputMaterial")


def _math(nt, op, a, b=None, c=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _mix_rgb(nt, fac, a, b, blend="MIX"):
    """Color mix; a and b are sockets or RGBA tuples."""
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    for sock, v in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(v, (int, float, tuple)):
            sock.default_value = v
        else:
            nt.links.new(v, sock)
    return n.outputs[2]


def _finish(nt, out, day_shader, glow=None, strength=0.0, gradient=None, night=None, link=True):
    """Day surface mixed with the night surface; returns the mixed shader socket."""
    is_night = nt.nodes.new("ShaderNodeValue")
    is_night.name = "is_night"
    is_night.outputs[0].default_value = 0.0
    if night is None:
        em = nt.nodes.new("ShaderNodeEmission")
        em.name = "emit"
        if glow is None:
            em.inputs["Color"].default_value = (0, 0, 0, 1)
        elif isinstance(glow, tuple):
            em.inputs["Color"].default_value = glow
        else:
            nt.links.new(glow, em.inputs["Color"])
        if gradient is None:
            em.inputs["Strength"].default_value = strength
        else:
            nt.links.new(_math(nt, "MULTIPLY", gradient, strength), em.inputs["Strength"])
        night = em.outputs[0]
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(is_night.outputs[0], mix.inputs["Fac"])
    nt.links.new(day_shader, mix.inputs[1])
    nt.links.new(night, mix.inputs[2])
    if link:
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return mix.outputs[0]


def flat(name, color, rough=0.6, metal=0.0, glow=None, strength=0.0):
    m, nt, out = _base(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    _finish(nt, out, bsdf.outputs[0], glow, strength)
    return m


def _grid(nt):
    """The shading point's 1x screen pixel, from its world-space position (the Geometry node's), so the pattern stays
    on the screen grid whatever the object's transform, a rotated parent (a facing turn) included; the normal is
    world space too. Returns (column, row along the face's courses) as integer-valued sockets. A world point lands
    at screen ((x + y) * HALF_W, (x - y) * HALF_H - z * Z_PX_PER_BU) game px from tile (0, 0)'s top corner, and
    the framing puts that corner on a pixel corner, so floor() of it is the 1x pixel, the same for every raw
    pixel of a 4 x 4 block. Along a left (-Y) face a course climbs half a pixel per column, along a right (+X)
    face it drops half a pixel, so the course row is row -+ floor(column / 2): 2:1 pixel-art lines."""
    geometry = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geometry.outputs["Position"], sep.inputs[0])
    x, y, z = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    col = _math(nt, "FLOOR", _math(nt, "MULTIPLY", _math(nt, "ADD", x, y), HALF_W))
    row = _math(nt, "FLOOR", _math(nt, "SUBTRACT", _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", x, y), HALF_H),
                                   _math(nt, "MULTIPLY", z, Z_PX_PER_BU)))
    normal = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geometry.outputs["Normal"], normal.inputs[0])
    # the id pass's rule for a right face: the normal leans more toward +X than toward -Y
    right = _math(nt, "GREATER_THAN", normal.outputs[0], _math(nt, "MULTIPLY", normal.outputs[1], -1.0))
    sign = _math(nt, "MULTIPLY_ADD", right, 2.0, -1.0)  # +1 on a right face, -1 on a left one
    half = _math(nt, "FLOOR", _math(nt, "MULTIPLY", col, 0.5))
    return col, _math(nt, "MULTIPLY_ADD", half, sign, row)


def _every(nt, v, period):
    """1 where the integer-valued v is a multiple of period, else 0."""
    return _math(nt, "LESS_THAN", _math(nt, "FLOORED_MODULO", v, period), 0.5)


def _patterned(name, color, line, dark, rough):
    """color, with a line color dark times as bright on screen wherever the socket line is 1."""
    m, nt, out = _base(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = rough
    # no specular: its even white sheen lifts line and wall alike and washes out the line's contrast
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    shade = tuple(c * dark ** SRGB_GAMMA for c in color[:3]) + (1,)
    nt.links.new(_mix_rgb(nt, line(nt), color, shade), bsdf.inputs["Base Color"])
    _finish(nt, out, bsdf.outputs[0])
    return m


def lined(name, color, period_px=3, dark=0.75, rough=0.7):
    """A flat color with a darker line every period_px screen pixels of height: siding, shingle and tile rows,
    stone courses. The line is exactly one 1x pixel tall and follows the face in 2:1 steps. dark is the line's
    brightness on screen relative to the wall; it stays under lib/pixel.py DARK (0.82), so the pixel pass keeps
    the line as the face's shade tone."""
    return _patterned(name, color, lambda nt: _every(nt, _grid(nt)[1], period_px), dark, rough)


# Running-bond brick at 1x: a mortar course every BRICK_COURSE px of height and a head joint every BRICK_LEN px
# along the course, shifted half a brick every other course. Three px (a mortar line and two px of brick) is
# the smallest course that still reads as brick rather than stripes; eight px keeps bricks long like the real ones.
BRICK_COURSE, BRICK_LEN = 3, 8


def brick(name, color, dark=0.62, rough=0.85):
    """Running-bond brick on the 1x grid (see BRICK_COURSE). Its mortar is darker than a lined course: the
    head joints leave less wall between them, so a mortar line needs a wider margin under lib/pixel.py DARK."""
    def line(nt):
        col, row = _grid(nt)
        course = _math(nt, "FLOOR", _math(nt, "DIVIDE", row, BRICK_COURSE))
        shift = _math(nt, "MULTIPLY", _math(nt, "FLOORED_MODULO", course, 2), BRICK_LEN // 2)
        head = _every(nt, _math(nt, "ADD", col, shift), BRICK_LEN)
        return _math(nt, "MAXIMUM", _every(nt, row, BRICK_COURSE), head)
    return _patterned(name, color, line, dark, rough)


def paint(name, color=(0.8, 0.8, 0.78, 1), period_px=3):
    """A painted surface (siding with period_px courses, or smooth stucco with period_px=0).
    The name must start with "paint": the walls pass keeps only these, and the game tints them."""
    assert name.startswith("paint"), name
    return lined(name, color, period_px) if period_px else flat(name, color, rough=0.8)


def windows(name, cell_u, cell_z, lit_share, tint=(0.08, 0.14, 0.2, 1), frame_frac=0.0, frame_color=(0.62, 0.64, 0.66, 1), strength=1.6, center=None, day_glow=0.0):
    """Glass that reflects the sky by day. Cells are cell_u wide along either
    visible facade (u = x - y) and cell_z tall; at night a random lit_share of
    cells glows warm. frame_frac of each cell edge is a metal mullion.
    center = (cx, cy, r): a rounded tower, where u runs around the tower instead.
    day_glow: the lit cells also glow warm by day at this strength (a lit shop interior seen through its window).
    The cells ride with the mesh (object space), unlike _grid's pixel patterns, which must sit on the screen grid."""
    m, nt, out = _base(name)
    m["glass"] = True  # the pixel pass drops sky reflections (large light patches) on glass only
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.6
    bsdf.inputs["Roughness"].default_value = 0.08
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nt.nodes.new("ShaderNodeTexCoord").outputs["Object"], sep.inputs[0])
    if center:
        cx, cy, r = center
        angle = _math(nt, "ARCTAN2", _math(nt, "SUBTRACT", sep.outputs[1], cy), _math(nt, "SUBTRACT", sep.outputs[0], cx))
        u = _math(nt, "MULTIPLY", angle, r)
    else:
        u = _math(nt, "SUBTRACT", sep.outputs[0], sep.outputs[1])
    cu = _math(nt, "DIVIDE", u, cell_u)
    cz = _math(nt, "DIVIDE", sep.outputs[2], cell_z)
    fu, fz = _math(nt, "FLOOR", cu), _math(nt, "FLOOR", cz)
    # Hash (column, floor, which face) so the two facades don't mirror each other at the corner.
    normal = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nt.nodes.new("ShaderNodeNewGeometry").outputs["Normal"], normal.inputs[0])
    cell = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(fu, cell.inputs[0])
    nt.links.new(fz, cell.inputs[1])
    nt.links.new(_math(nt, "MULTIPLY", normal.outputs[0], 7.31), cell.inputs[2])
    noise = nt.nodes.new("ShaderNodeTexWhiteNoise")
    noise.noise_dimensions = "3D"
    nt.links.new(cell.outputs[0], noise.inputs["Vector"])
    frame = _math(nt, "MAXIMUM",
                  _math(nt, "LESS_THAN", _math(nt, "SUBTRACT", cu, fu), frame_frac),
                  _math(nt, "LESS_THAN", _math(nt, "SUBTRACT", cz, fz), frame_frac * 1.5))
    nt.links.new(_mix_rgb(nt, frame, tint, frame_color), bsdf.inputs["Base Color"])
    lit = _math(nt, "MULTIPLY", _math(nt, "LESS_THAN", noise.outputs["Value"], lit_share), _math(nt, "SUBTRACT", 1.0, frame))
    # Only walls glow; a glass box's top face (a sliver around the roof slab) stays dark.
    wall = _math(nt, "LESS_THAN", _math(nt, "ABSOLUTE", normal.outputs[2]), 0.5)
    lit = _math(nt, "MULTIPLY", lit, wall)
    warm = _mix_rgb(nt, noise.outputs["Value"], WARM_A, WARM_B)
    glow = _mix_rgb(nt, lit, (0, 0, 0, 1), warm)
    day = bsdf.outputs[0]
    if day_glow:
        m["lit"] = True  # the id pass flags it, so the pixel pass reserves palette colors for its glow (lib/pixel.py is_lit)
        # not named "emit": set_mask and set_night only touch the night emission
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(glow, em.inputs["Color"])
        em.inputs["Strength"].default_value = day_glow
        add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(day, add.inputs[0])
        nt.links.new(em.outputs[0], add.inputs[1])
        day = add.outputs[0]
    _finish(nt, out, day, glow, strength)
    return m


def clear_glass(name, tint=(0.86, 0.92, 0.95, 1), see_through=False):
    """See-through glass (lobbies, shelters). Transparent in the night pass, so what glows behind it shows.
    see_through: for glass with something behind it worth keeping legible (a lobby's logo wall) — the id pass
    renders it as an actual hole instead of its own opaque "glass" id, so what it fronts keeps its own id and
    the pixel pass's sign-preserving stroke rule, rather than being hidden behind a flat glass tone and washed
    out. Everywhere else (nothing meaningful behind the pane) it stays a normal glass id."""
    m, nt, out = _base(name)
    m["see_through" if see_through else "glass"] = True
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = tint
    bsdf.inputs["Roughness"].default_value = 0.03
    for key in ("Transmission Weight", "Transmission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 1.0
            break
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    _finish(nt, out, bsdf.outputs[0], night=clear.outputs[0])
    return m


def image(name, path, strength=1.2, glow=True, alpha=False, rough=0.5, top_lit=False, day_glow=0.0):
    """An image on a UV-mapped face (ad, sign, mural). Glows with its own colors at night unless glow=False.
    alpha: transparent where the image is. top_lit: brighter at the top, like a billboard under floodlights.
    day_glow: also lit by day at this emission strength, for a sign recessed behind glass (a lobby logo wall)
    that would otherwise read as a dark smear under the scene's ambient light."""
    m, nt, out = _base(name)
    m["sign"] = True  # the pixel pass keeps sign detail and draws no inner lines across it
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = rough
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(path), check_existing=True)
    tex.extension = "CLIP"
    tex.interpolation = "Cubic"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    gradient = None
    if top_lit:
        uv = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(nt.nodes.new("ShaderNodeTexCoord").outputs["UV"], uv.inputs[0])
        gradient = _math(nt, "MULTIPLY_ADD", uv.outputs[1], 0.7, 0.3)
    day = bsdf.outputs[0]
    if day_glow:
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
        em.inputs["Strength"].default_value = day_glow
        add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(day, add.inputs[0])
        nt.links.new(em.outputs[0], add.inputs[1])
        day = add.outputs[0]
    shader = _finish(nt, out, day, tex.outputs["Color"] if glow else None, strength if glow else 0.0,
                     gradient=gradient, link=not alpha)
    if alpha:
        m["sign_alpha"] = tex.image.name  # the id pass is a sign only where the image is painted
        clear = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(tex.outputs["Alpha"], mix.inputs["Fac"])
        nt.links.new(clear.outputs[0], mix.inputs[1])
        nt.links.new(shader, mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m
