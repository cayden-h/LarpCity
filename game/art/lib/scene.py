"""Scene setup and rendering for one sprite at a time."""
import math

import bpy
from mathutils import Vector

from .iso import HALF_H, HALF_W, PX_PER_BU, VIEW_DIR, ground_at_screen

SCALE = 2          # render at 2x; the game draws sprites at 1 / SCALE
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
    sc.cycles.samples = 64
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
