"""Scene setup and rendering for one sprite at a time."""
import math

import bpy
from mathutils import Vector

from .iso import HALF_H, HALF_W, PX_PER_BU, VIEW_DIR, Z_PX_PER_BU, ground_at_screen

SCALE = 4          # render at 4x; art/pixelize.py shrinks to 1x game pixels
PAD = 8            # game px of air around the footprint
SKY_STRENGTH = 0.12  # a faint, cool fill: shaded faces stay dark enough that the three face tones read
EXPOSURE = -0.6
# The one key light, as the direction its light travels. Toward +Y it lights the game's left face (-Y);
# toward +X the right face (+X) turns away into shade; about 60 degrees up, so the top is the lightest.
# Shadows fall back and to the right, like the procedural buildings' shading (bricks.ts).
SUN_DIR = (0.5, 1.0, -1.9)
SUN_ENERGY = 5.0
SUN_COLOR = (1.0, 0.88, 0.72)  # warm afternoon light, for the reference's warm palette
CATCHER_MARGIN = 1.2  # how far (Blender units) the shadow catcher reaches past the lot; a shadow ends there
SHADOW_BLUR = 2       # game px of room past the geometric shadow for its soft edge


def shadow_reach(w: int, d: int, top_px: float) -> tuple[float, float, float, float]:
    """Screen bounds (left, top, right, bottom, in game px from tile (0, 0)'s top corner) of the cast shadow of
    a w x d lot's box top_px tall: its footprint swept along SUN_DIR to the ground, cut off at the catcher."""
    sx, sy, sz = SUN_DIR
    h = top_px / Z_PX_PER_BU
    dx, dy = -sx / sz * h, -sy / sz * h
    x0 = max(min(0, dx), -CATCHER_MARGIN)
    x1 = min(max(w, w + dx), w + CATCHER_MARGIN)
    y0 = max(min(-d, -d + dy), -d - CATCHER_MARGIN)
    y1 = min(max(0, dy), CATCHER_MARGIN)
    # Blender (x, y) on the ground lands at screen ((x + y) * HALF_W, (x - y) * HALF_H)
    xs = [(x + y) * HALF_W for x in (x0, x1) for y in (y0, y1)]
    ys = [(x - y) * HALF_H for x in (x0, x1) for y in (y0, y1)]
    return min(xs), min(ys), max(xs), max(ys)


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        # Blender 5.2 can crash while specializing Metal kernels in a background
        # thread (MetalKernelPipeline::compile); the generic kernels are fast enough here.
        if hasattr(prefs, "kernel_optimization_level"):
            prefs.kernel_optimization_level = "OFF"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:  # CPU still works, just slower
        print("[art] GPU unavailable:", e)
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"  # AgX washes out brand colors
    sc.view_settings.exposure = EXPOSURE
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.clip_end = 1000
    sc.collection.objects.link(cam)
    sc.camera = cam


def day_lighting() -> None:
    world = bpy.data.worlds.new("sky")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    # The sky is only the soft fill: its own sun disc (low, from the +X side) would outshine the key light,
    # light the right face instead of the left, and throw long shadows the wrong way.
    sky.sun_disc = False
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = SKY_STRENGTH
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = SUN_ENERGY
    sun.data.color = SUN_COLOR
    sun.data.angle = math.radians(1.5)
    sun.rotation_euler = Vector(SUN_DIR).normalized().to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(sun)


def frame(w: int, d: int, top_px: float, extra: int = 0) -> dict:
    """Aim the camera so tile (0, 0)'s top corner lands at a known pixel (ax, ay), in game px.
    extra widens the canvas for things that overhang the lot (a freeway V board). The canvas also takes in
    the whole cast shadow (shadow_reach), and no more, so no side carries padding it does not need."""
    sl, st, sr, sb = shadow_reach(w, d, top_px)
    left = min(-d * HALF_W - PAD - extra, math.floor(sl) - SHADOW_BLUR)
    right = max(w * HALF_W + PAD + extra, math.ceil(sr) + SHADOW_BLUR)
    top = min(-math.ceil(top_px) - PAD, math.floor(st) - SHADOW_BLUR)
    bottom = max((w + d) * HALF_H + PAD, math.ceil(sb) + SHADOW_BLUR)
    width, height = right - left, bottom - top
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = width * SCALE, height * SCALE
    cam = sc.camera
    cam.data.ortho_scale = max(width, height) / PX_PER_BU
    target = ground_at_screen(left + width / 2, top + height / 2)
    cam.location = target + VIEW_DIR * 200
    cam.rotation_euler = (-VIEW_DIR).to_track_quat("-Z", "Y").to_euler()
    return {"ax": -left, "ay": -top}


def set_night(on: bool) -> None:
    """Night pass: every surface goes black except what glows, lights and the shadow catcher off."""
    for m in bpy.data.materials:
        n = m.node_tree.nodes.get("is_night") if m.node_tree else None
        if n:
            n.outputs[0].default_value = 1.0 if on else 0.0
    sc = bpy.context.scene
    for o in sc.objects:
        if o.type == "LIGHT" or o.get("shadow_catcher"):
            o.hide_render = on
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0 if on else SKY_STRENGTH


def set_mask(prefix: str) -> None:
    """Mask pass: materials named prefix* glow plain white, everything else is black (glass stays clear)."""
    set_night(True)
    bpy.context.scene.view_settings.exposure = 0.0
    for m in bpy.data.materials:
        nt = m.node_tree
        em = nt.nodes.get("emit") if nt else None
        if not em:
            continue
        for sock in (em.inputs["Color"], em.inputs["Strength"]):
            for link in list(sock.links):
                nt.links.remove(link)
        on = m.name.startswith(prefix)
        em.inputs["Color"].default_value = (1, 1, 1, 1) if on else (0, 0, 0, 1)
        em.inputs["Strength"].default_value = 1.0 if on else 0.0


def mask_to_alpha(path) -> None:
    """Turn a white-on-black mask render into white with the mask in alpha."""
    import numpy as np

    img = bpy.data.images.load(str(path))
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    a = px[:, :3].max(axis=1) * px[:, 3]
    px[:, :3] = 1.0
    px[:, 3] = np.clip(a / max(float(a.max()), 1e-6), 0.0, 1.0)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()


def render(path) -> None:
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def _sign_color(ordinal: int) -> tuple:
    """lib/pixel.py sign_id(ordinal) as a linear emission color: R 255 and G 0 mark a sign, B is the sign's ordinal."""
    return (1.0, 0.0, ordinal / 255, 1.0)


def _id_material(name: str, index: int, sign: int | None, alpha_image: str | None = None, glass: bool = False,
                 lit: bool = False):
    """Flat emission for the id pass, in exact bytes under the Raw view transform. A sign (sign = its ordinal among
    the sprite's signs) gets _sign_color(sign), where an alpha image is painted if alpha_image, and is clear
    elsewhere; each sign keeps its own id, so the pixel pass judges its strokes against its own field. Anything else
    encodes the object's index, the face direction, and glass: R = index % 256, G = 1 + index // 256, plus 128 if
    the face points right (+X) rather than left (-Y), B = 64 + 127 if the face points up + 32 if the object is glass
    + 16 if it is glass lit by day (lib/pixel.py GLASS_BLUE and LIT_BLUE). G is never 0, so no object id is a sign's."""
    m = bpy.data.materials.new(f"id-{name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    if sign is not None:
        em.inputs["Color"].default_value = _sign_color(sign)
        if alpha_image:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images[alpha_image]
            tex.extension = "CLIP"
            tex.interpolation = "Closest"
            painted = nt.nodes.new("ShaderNodeMath")  # a hard edge: ghost paint is only half opaque
            painted.operation = "GREATER_THAN"
            painted.inputs[1].default_value = 0.4
            nt.links.new(tex.outputs["Alpha"], painted.inputs[0])
            mix = nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(painted.outputs[0], mix.inputs["Fac"])
            nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
            nt.links.new(em.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(em.outputs[0], out.inputs["Surface"])
        return m
    if index // 256 > 126:
        raise ValueError(f"id pass: object index {index} does not fit in the id encoding (at most {127 * 256} objects)")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    normal = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nt.nodes.new("ShaderNodeNewGeometry").outputs["Normal"], normal.inputs[0])

    def node(op, a, b):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    right = node("GREATER_THAN", normal.outputs[0], node("MULTIPLY", normal.outputs[1], -1.0))
    up = node("GREATER_THAN", normal.outputs[2], 0.5)
    color = nt.nodes.new("ShaderNodeCombineColor")
    color.inputs[0].default_value = (index % 256) / 255
    nt.links.new(node("ADD", node("MULTIPLY", right, 128 / 255), (1 + index // 256) / 255), color.inputs[1])
    nt.links.new(node("ADD", node("MULTIPLY", up, 127 / 255), (64 + 32 * glass + 16 * (glass and lit)) / 255), color.inputs[2])
    nt.links.new(color.outputs[0], em.inputs["Color"])
    return m


def _see_through_id_material(name):
    """A hole in the id pass: a bare transparent BSDF, so the camera ray keeps going and the id pass shows
    whatever real, opaque object (a sign, an interior wall) sits behind this see-through glass, exactly as
    the day pass's own ray-traced transmission already does."""
    m = bpy.data.materials.new(f"id-{name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs[0], out.inputs["Surface"])
    return m


def set_ids() -> None:
    """Id pass, always the last render of a sprite (it replaces every material): each object's faces glow one
    flat color per face direction, with no lights, sky, shadow catcher, noise, or anti-aliasing.
    "Sign" is decided per object: any sign material slot (and any text) marks the whole object; so is "glass"
    (a glass material slot, materials.windows), which scopes the pixel pass's sheen rule. A see_through object
    (materials.clear_glass) gets no id of its own at all; it is a hole the id pass's camera ray passes through."""
    set_night(True)
    sc = bpy.context.scene
    sc.view_settings.view_transform = "Raw"  # emission v / 255 renders to exactly byte v
    sc.view_settings.exposure = 0.0
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    sc.cycles.filter_width = 0.01
    sc.render.dither_intensity = 0.0  # the 8-bit dither would scatter +-1 neighbors around every id
    kinds = ("MESH", "FONT", "CURVE")
    objs = sorted((o for o in sc.objects if o.type in kinds and not o.get("shadow_catcher")), key=lambda o: o.name)
    signs = 0
    for i, o in enumerate(objs):
        mats = [s.material for s in o.material_slots if s.material]
        if any(m.get("see_through") for m in mats):
            mat = _see_through_id_material(o.name)
        else:
            sign = None
            if o.type == "FONT" or any(m.get("sign") for m in mats):
                if signs > 255:
                    raise ValueError(f"id pass: more than 256 signs in one sprite ({o.name}); a sign's ordinal is one byte")
                sign, signs = signs, signs + 1
            alpha = next((m["sign_alpha"] for m in mats if m.get("sign_alpha")), None)
            mat = _id_material(o.name, i, sign, alpha, glass=any(m.get("glass") for m in mats),
                               lit=any(m.get("lit") for m in mats))
        o.data.materials.clear()
        o.data.materials.append(mat)
    print(f"[art] id pass: {len(objs)} objects", flush=True)


TURNS = {"s": 0, "e": 90, "n": 180, "w": 270}


def turn(w: int, d: int, facing: str) -> tuple:
    """Turn everything built so far about the lot center so its front (built on -Y, facing "s") faces `facing`.
    The camera and sun stay put, so shadows match the rest of the city. Returns the footprint after the turn."""
    fw, fd = (w, d) if facing in ("s", "n") else (d, w)
    sc = bpy.context.scene
    pivot = bpy.data.objects.new("pivot", None)
    sc.collection.objects.link(pivot)
    pivot.location = (w / 2, -d / 2, 0)
    bpy.context.view_layer.update()
    inv = pivot.matrix_world.inverted()
    for o in sc.objects:
        if o.type in ("MESH", "FONT", "CURVE"):
            o.parent = pivot
            o.matrix_parent_inverse = inv
    pivot.rotation_euler = (0, 0, math.radians(TURNS[facing]))
    pivot.location = (fw / 2, -fd / 2, 0)
    bpy.context.view_layer.update()
    return fw, fd


def set_walls(prefix: str = "paint") -> None:
    """Walls pass: the day render with every material not named prefix* held out (transparent, still hiding
    what is behind it) and no shadow catcher, so only the painted surfaces remain, lit as by day."""
    for m in bpy.data.materials:
        if m.name.startswith(prefix) or not m.node_tree:
            continue
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        nt.links.new(nt.nodes.new("ShaderNodeHoldout").outputs[0], out.inputs["Surface"])
    for o in bpy.context.scene.objects:
        if o.get("shadow_catcher"):
            o.hide_render = True
