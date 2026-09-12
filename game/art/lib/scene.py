"""Scene setup and rendering for one sprite at a time."""
import math

import bpy
from mathutils import Vector

from .iso import HALF_H, HALF_W, PX_PER_BU, VIEW_DIR, ground_at_screen

SCALE = 4          # render at 4x; art/pixelize.py shrinks to 1x game pixels
PAD = 8            # game px of air around the footprint
SHADOW_PAD = 28    # extra room on the right and bottom for the cast shadow
SKY_STRENGTH = 0.35


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
    sc.view_settings.exposure = -0.35
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
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = SKY_STRENGTH
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.2
    sun.data.angle = math.radians(1.5)
    # Light travels mostly toward +Y: the game's left face (-Y) is lit, the right face (+X) is in half shade.
    sun.rotation_euler = Vector((-0.35, 1.0, -1.1)).normalized().to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(sun)


def frame(w: int, d: int, top_px: float, extra: int = 0) -> dict:
    """Aim the camera so tile (0, 0)'s top corner lands at a known pixel (ax, ay), in game px.
    extra widens the canvas for things that overhang the lot (a freeway V board)."""
    left, right = -d * HALF_W - PAD - extra, w * HALF_W + PAD + SHADOW_PAD + extra
    top, bottom = -math.ceil(top_px) - PAD, (w + d) * HALF_H + PAD + SHADOW_PAD // 2
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


SIGN_ID = (1.0, 0.0, 1.0, 1.0)  # lib/pixel.py SIGN_ID (255, 0, 255); no object id can equal it, since its G is never 0


def _id_material(name: str, index: int, sign: bool, alpha_image: str | None = None):
    """Flat emission for the id pass, in exact bytes under the Raw view transform. Signs get SIGN_ID (where an
    alpha image is painted, if alpha_image; clear elsewhere). Anything else encodes the object's index and the
    face direction: R = index % 256, G = 1 + index // 256, plus 128 if the face points right (+X) rather than
    left (-Y), B = 191 if the face points up, else 64."""
    m = bpy.data.materials.new(f"id-{name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    if sign:
        em.inputs["Color"].default_value = SIGN_ID
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
    nt.links.new(node("ADD", node("MULTIPLY", up, 127 / 255), 64 / 255), color.inputs[2])
    nt.links.new(color.outputs[0], em.inputs["Color"])
    return m


def set_ids() -> None:
    """Id pass, always the last render of a sprite (it replaces every material): each object's faces glow one
    flat color per face direction, with no lights, sky, shadow catcher, noise, or anti-aliasing.
    "Sign" is decided per object: any sign material slot (and any text) marks the whole object."""
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
    for i, o in enumerate(objs):
        mats = [s.material for s in o.material_slots if s.material]
        sign = o.type == "FONT" or any(m.get("sign") for m in mats)
        alpha = next((m["sign_alpha"] for m in mats if m.get("sign_alpha")), None)
        mat = _id_material(o.name, i, sign, alpha)
        o.data.materials.clear()
        o.data.materials.append(mat)
    print(f"[art] id pass: {len(objs)} objects", flush=True)
