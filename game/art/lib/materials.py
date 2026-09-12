"""Materials. Every material mixes its day surface with a night surface through
a Value node named "is_night": black at night, or emission (node "emit") where
it glows. Clear glass turns transparent at night so lit lobbies show through."""
from pathlib import Path

import bpy

TEX = Path(__file__).resolve().parent.parent / "textures"
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


def _photo(nt, tex_id, tile_bu):
    """Box-projected photo texture maps in world space; returns a function kind -> color socket."""
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / tile_bu,) * 3
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    def img(kind):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(str(TEX / tex_id / f"{tex_id}_1K-JPG_{kind}.jpg"), check_existing=True)
        if kind != "Color":
            n.image.colorspace_settings.name = "Non-Color"
        n.projection = "BOX"
        n.projection_blend = 0.15
        nt.links.new(mapping.outputs["Vector"], n.inputs["Vector"])
        return n.outputs["Color"]

    return img


def _normal(nt, photo, bsdf):
    nrm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(photo("NormalGL"), nrm.inputs["Color"])
    nt.links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])


def flat(name, color, rough=0.6, metal=0.0, glow=None, strength=0.0):
    m, nt, out = _base(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    _finish(nt, out, bsdf.outputs[0], glow, strength)
    return m


def pbr(name, tex_id, tile_bu=1.0, tint=(1, 1, 1, 1)):
    """Photo texture, box-projected in world space; tile_bu is how many Blender units one texture repeat covers."""
    m, nt, out = _base(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    photo = _photo(nt, tex_id, tile_bu)
    nt.links.new(_mix_rgb(nt, 1.0, photo("Color"), tint, "MULTIPLY"), bsdf.inputs["Base Color"])
    nt.links.new(photo("Roughness"), bsdf.inputs["Roughness"])
    _normal(nt, photo, bsdf)
    _finish(nt, out, bsdf.outputs[0])
    return m


def windows(name, cell_u, cell_z, lit_share, tint=(0.08, 0.14, 0.2, 1), frame_frac=0.0, frame_color=(0.62, 0.64, 0.66, 1), strength=1.6, center=None):
    """Glass that reflects the sky by day. Cells are cell_u wide along either
    visible facade (u = x - y) and cell_z tall; at night a random lit_share of
    cells glows warm. frame_frac of each cell edge is a metal mullion.
    center = (cx, cy, r): a rounded tower, where u runs around the tower instead."""
    m, nt, out = _base(name)
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
    _finish(nt, out, bsdf.outputs[0], _mix_rgb(nt, lit, (0, 0, 0, 1), warm), strength)
    return m


def clear_glass(name, tint=(0.86, 0.92, 0.95, 1)):
    """See-through glass (lobbies, shelters). Transparent in the night pass, so what glows behind it shows."""
    m, nt, out = _base(name)
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


def image(name, path, strength=1.2, glow=True, alpha=False, rough=0.5, top_lit=False):
    """An image on a UV-mapped face (ad, sign, mural). Glows with its own colors at night unless glow=False.
    alpha: transparent where the image is. top_lit: brighter at the top, like a billboard under floodlights."""
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
    shader = _finish(nt, out, bsdf.outputs[0], tex.outputs["Color"] if glow else None, strength if glow else 0.0,
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
