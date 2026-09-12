# Realistic Sprites Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Downtown San Francisco renders with textured, Blender-rendered building sprites (glass tower, brick loft, concrete office) carrying real Salesforce and Capital One signage, day and night, with the toy studs removed everywhere.

**Architecture:** A headless Blender script (`game/art/build.py`) builds each catalog entry in 3D with CC0 photo textures, renders a day pass and a night emissive pass from an orthographic camera matched to the game's 2:1 projection, and writes PNGs plus `sprites.json` into `game/public/sprites/<city>/`.
The game loads that manifest when a city opens; `populate.ts` picks a sprite per lot (pure logic in `sprite-pick.ts`), and `sprites.ts` returns the same `Built` shape `bricks.ts` does, so `scene.ts` depth sorting, tinting, and the night fade keep working.
Cities without sprites fall back to the procedural builder.

**Tech Stack:** Blender 5.2.1 (Cycles, Metal GPU, bpy), Python 3.13 + Pillow, PixiJS v8, TypeScript, Vite, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-12-realistic-sprites-design.md`.
Milestone deviation from the spec: sprites ship as individual PNGs instead of one atlas (few files for now; atlas packing comes with the full set).

**Repo note:** `Larp City/` is not a git repository, so there are no commit steps; each task ends with a verification step instead.

**Calibration (already measured):** a 1x1 tile, one floor tall, rendered through this camera measures 66 x 54 px (64 x 52 expected plus antialiasing).

---

## File map

| File | Responsibility |
| --- | --- |
| `game/art/fetch_textures.sh` | Download the CC0 ambientCG textures into `art/textures/` (idempotent) |
| `game/art/make_ads.py` | Draw billboard ad art with Pillow into `art/ads/` |
| `game/art/lib/iso.py` | Projection constants shared with `src/engine/iso.ts` |
| `game/art/lib/scene.py` | Reset, render settings, camera framing, day lighting, night switch, render |
| `game/art/lib/geo.py` | World-space box, cylinder, shadow catcher |
| `game/art/lib/materials.py` | PBR texture, flat, window-glass, and image materials, each with a night switch |
| `game/art/lib/archetypes.py` | `glass_tower`, `brick_loft`, `concrete_office` |
| `game/art/lib/signs.py` | `channel_letters`, `billboard` |
| `game/art/catalog.py` | Which sprites each city gets |
| `game/art/build.py` | Blender entry point: render the catalog, write the manifest |
| `game/art/check_register.py` | Fail if any sprite is off its tile diamond by more than one game pixel |
| `game/src/engine/sprite-pick.ts` | Pure: manifest types, sprite choice, sprite origin |
| `game/src/engine/sprites.ts` | Load a sprite set; build a `Built` from an entry |
| `game/tests/sprites.test.ts` | Tests for `sprite-pick.ts` |
| Modify `game/src/engine/bricks.ts` | `Built.lights` widened to `Container`; roof studs removed |
| Modify `game/src/engine/populate.ts` | Use sprites when the city has them |
| Modify `game/src/engine/scene.ts` | Accept a sprite set |
| Modify `game/src/main.ts` | Load the sprite set before building the scene |
| Modify `game/src/engine/ground.ts` | Remove studs and `drawStuds` |
| Modify `game/src/cities/features/rural.landmarks.ts` | Drop its `drawStuds` call |
| Modify `game/package.json`, `game/README.md` | `art:sf` script and pipeline docs |

---

### Task 1: Textures and ad art

**Files:**
- Create: `game/art/fetch_textures.sh`
- Create: `game/art/make_ads.py`

- [ ] **Step 1: Write the texture fetcher**

```sh
#!/bin/sh
# Downloads the CC0 ambientCG textures the sprite pipeline uses (1K JPG:
# color, OpenGL normal, roughness) into art/textures/<id>/. Safe to rerun.
set -e
cd "$(dirname "$0")"
mkdir -p textures
for id in Bricks075A Concrete034 Asphalt026B; do
  [ -f "textures/$id/${id}_1K-JPG_Color.jpg" ] && continue
  zip="$(mktemp -t "$id").zip"
  curl -sfL -o "$zip" "https://ambientcg.com/get?file=${id}_1K-JPG.zip"
  mkdir -p "textures/$id"
  unzip -oq "$zip" "*_Color.jpg" "*_NormalGL.jpg" "*_Roughness.jpg" -d "textures/$id"
  rm -f "$zip"
done
```

- [ ] **Step 2: Write the ad generator**

```python
"""Billboard ad art for the sprite pipeline, drawn with Pillow into art/ads/."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent / "ads"
SERIF = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
SANS = "/System/Library/Fonts/Supplemental/Arial.ttf"


def capital_one(path: Path) -> None:
    im = Image.new("RGB", (880, 400), (0, 72, 121))
    g = ImageDraw.Draw(im)
    g.arc((60, 70, 820, 520), start=200, end=335, fill=(210, 46, 30), width=26)
    g.text((440, 215), "Capital One", font=ImageFont.truetype(SERIF, 128), fill="white", anchor="mm")
    g.text((440, 330), "What's in your wallet?", font=ImageFont.truetype(SANS, 48), fill=(207, 224, 238), anchor="mm")
    im.save(path)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    capital_one(OUT / "capital-one.png")
```

- [ ] **Step 3: Run both and verify**

Run: `cd game && sh art/fetch_textures.sh && python3 art/make_ads.py && ls art/textures/* art/ads`
Expected: three texture folders with `_Color`, `_NormalGL`, `_Roughness` JPGs each, and `capital-one.png`.

### Task 2: Projection, scene, and geometry helpers

**Files:**
- Create: `game/art/lib/__init__.py` (empty)
- Create: `game/art/lib/iso.py`
- Create: `game/art/lib/scene.py`
- Create: `game/art/lib/geo.py`

- [ ] **Step 1: Write `iso.py`**

```python
"""The game's projection (src/engine/iso.ts), for Blender.

Game tile (gx, gy) maps to Blender (gx, -gy) with z up. The orthographic
camera looks down 30 degrees from the (+X, -Y) side, so a tile renders as a
64 x 32 px diamond, the game's left face is Blender's -Y face, and its right
face is Blender's +X face.
"""
import math

from mathutils import Vector

HALF_W, HALF_H = 32, 16
PX_PER_BU = HALF_W / math.cos(math.radians(45))       # screen px per unit along the ground
Z_PX_PER_BU = PX_PER_BU * math.cos(math.radians(30))  # screen px per unit of height
FLOOR_PX = 20  # bricks.ts FLOOR_H
PLINTH_PX = 4  # bricks.ts PLINTH
VIEW_DIR = Vector((1, -1, math.sqrt(2) * math.tan(math.radians(30)))).normalized()


def px(v: float) -> float:
    """Screen pixels of height to Blender units."""
    return v / Z_PX_PER_BU


def body_top(floors: int) -> float:
    return px(PLINTH_PX + floors * FLOOR_PX)


def ground_at_screen(sx: float, sy: float) -> Vector:
    """The ground point drawn sx, sy game pixels from tile (0, 0)'s top corner."""
    a, b = sx / HALF_W, sy / HALF_H  # a = gx - gy, b = gx + gy
    return Vector(((a + b) / 2, -(b - a) / 2, 0))
```

- [ ] **Step 2: Write `scene.py`**

```python
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
    sc.view_settings.view_transform = "AgX"
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
    sun.data.energy = 4.0
    sun.data.angle = math.radians(1.5)
    # Light travels mostly toward +Y: the game's left face (-Y) is lit, the right face (+X) is in half shade.
    sun.rotation_euler = Vector((-0.35, 1.0, -1.1)).normalized().to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(sun)


def frame(w: int, d: int, top_px: float) -> dict:
    """Aim the camera so tile (0, 0)'s top corner lands at a known pixel (ax, ay), in game px."""
    left, right = -d * HALF_W - PAD, w * HALF_W + PAD + SHADOW_PAD
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


def render(path) -> None:
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
```

- [ ] **Step 3: Write `geo.py`**

```python
"""Geometry in world coordinates (object at the origin), so box-projected textures line up across objects."""
import bmesh
import bpy


def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def box(name, x0, y0, z0, x1, y1, z1, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1
        v.co.y = y0 if v.co.y < 0 else y1
        v.co.z = z0 if v.co.z < 0 else z1
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))


def cylinder(name, cx, cy, r, z0, z1, mat, verts=12):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy, (z0 + z1) / 2))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return _link(bpy.data.objects.new(name, me))


def shadow_catcher(w, d, margin=1.2):
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    for x, y in [(-margin, margin), (w + margin, margin), (w + margin, -d - margin), (-margin, -d - margin)]:
        bm.verts.new((x, y, 0))
    bm.faces.new(bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = _link(bpy.data.objects.new("ground", me))
    ob.is_shadow_catcher = True
    ob["shadow_catcher"] = True
    return ob
```

- [ ] **Step 4: Verify calibration with a test cube**

Create `game/art/tests/calibrate.py`:

```python
"""Renders a 1x1 tile one floor tall through lib.scene.frame and prints its anchor; check_register-style bbox check follows."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib import geo, materials as M, scene as S  # noqa: E402
from lib.iso import body_top  # noqa: E402

S.reset()
S.day_lighting()
geo.box("cube", 0, -1, 0, 1, 0, body_top(1), M.flat("grey", (0.6, 0.6, 0.6, 1)))
fr = S.frame(1, 1, 24)
out = Path(sys.argv[sys.argv.index("--") + 1])
S.render(out)
print("ANCHOR", fr["ax"], fr["ay"])
```

Run: `cd game && blender -b -P art/tests/calibrate.py -- /tmp/cal.png 2>&1 | grep ANCHOR && python3 -c "from PIL import Image; a=Image.open('/tmp/cal.png').getchannel('A').point(lambda v:255 if v>230 else 0); print(a.getbbox())"`
Expected: `ANCHOR 40 32`; bbox about `(16, 32..34, 144, 136)` at 2x: left = (40 - 32) * 2 = 16, right = (40 + 32) * 2 = 144, bottom = (32 + 32) * 2 = 128 plus the plinth-free edge, within 2 px.
(This step needs `materials.flat` from Task 3; run it after Task 3 Step 1 if doing tasks strictly in order.)

### Task 3: Materials

**Files:**
- Create: `game/art/lib/materials.py`

- [ ] **Step 1: Write the materials module**

```python
"""Materials. Every material mixes its day surface with a night surface through
a Value node named "is_night": black at night, or emission where it glows."""
from pathlib import Path

import bpy

TEX = Path(__file__).resolve().parent.parent / "textures"
WARM_A, WARM_B = (1.0, 0.74, 0.42, 1), (1.0, 0.9, 0.72, 1)


def _base(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return m, nt, nt.nodes.new("ShaderNodeOutputMaterial")


def _math(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, v in enumerate((a, b)):
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


def _finish(nt, out, day_shader, glow=None, strength=0.0):
    is_night = nt.nodes.new("ShaderNodeValue")
    is_night.name = "is_night"
    is_night.outputs[0].default_value = 0.0
    em = nt.nodes.new("ShaderNodeEmission")
    if glow is None:
        em.inputs["Color"].default_value = (0, 0, 0, 1)
    elif isinstance(glow, tuple):
        em.inputs["Color"].default_value = glow
    else:
        nt.links.new(glow, em.inputs["Color"])
    em.inputs["Strength"].default_value = strength
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(is_night.outputs[0], mix.inputs["Fac"])
    nt.links.new(day_shader, mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


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
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / tile_bu,) * 3
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    def img(kind, data):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(str(TEX / tex_id / f"{tex_id}_1K-JPG_{kind}.jpg"), check_existing=True)
        if data:
            n.image.colorspace_settings.name = "Non-Color"
        n.projection = "BOX"
        n.projection_blend = 0.15
        nt.links.new(mapping.outputs["Vector"], n.inputs["Vector"])
        return n.outputs["Color"]

    nt.links.new(_mix_rgb(nt, 1.0, img("Color", False), tint, "MULTIPLY"), bsdf.inputs["Base Color"])
    nt.links.new(img("Roughness", True), bsdf.inputs["Roughness"])
    nrm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(img("NormalGL", True), nrm.inputs["Color"])
    nt.links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])
    _finish(nt, out, bsdf.outputs[0])
    return m


def windows(name, cell_u, cell_z, lit_share, tint=(0.08, 0.14, 0.2, 1), frame_frac=0.0, frame_color=(0.62, 0.64, 0.66, 1)):
    """Glass that reflects the sky by day. Cells are cell_u wide along either
    visible facade (u = x - y) and cell_z tall; at night a random lit_share of
    cells glows warm. frame_frac of each cell edge is a metal mullion."""
    m, nt, out = _base(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.6
    bsdf.inputs["Roughness"].default_value = 0.08
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nt.nodes.new("ShaderNodeTexCoord").outputs["Object"], sep.inputs[0])
    cu = _math(nt, "DIVIDE", _math(nt, "SUBTRACT", sep.outputs[0], sep.outputs[1]), cell_u)
    cz = _math(nt, "DIVIDE", sep.outputs[2], cell_z)
    fu, fz = _math(nt, "FLOOR", cu), _math(nt, "FLOOR", cz)
    cell = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(fu, cell.inputs[0])
    nt.links.new(fz, cell.inputs[1])
    noise = nt.nodes.new("ShaderNodeTexWhiteNoise")
    noise.noise_dimensions = "3D"
    nt.links.new(cell.outputs[0], noise.inputs["Vector"])
    frame = _math(nt, "MAXIMUM",
                  _math(nt, "LESS_THAN", _math(nt, "SUBTRACT", cu, fu), frame_frac),
                  _math(nt, "LESS_THAN", _math(nt, "SUBTRACT", cz, fz), frame_frac * 1.5))
    nt.links.new(_mix_rgb(nt, frame, tint, frame_color), bsdf.inputs["Base Color"])
    lit = _math(nt, "MULTIPLY", _math(nt, "LESS_THAN", noise.outputs["Value"], lit_share), _math(nt, "SUBTRACT", 1.0, frame))
    warm = _mix_rgb(nt, noise.outputs["Value"], WARM_A, WARM_B)
    _finish(nt, out, bsdf.outputs[0], _mix_rgb(nt, lit, (0, 0, 0, 1), warm), 3.0)
    return m


def image(name, path, strength=1.2):
    """An image on a UV-mapped plane (billboard art); glows with its own colors at night."""
    m, nt, out = _base(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.5
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(path), check_existing=True)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    _finish(nt, out, bsdf.outputs[0], tex.outputs["Color"], strength)
    return m
```

- [ ] **Step 2: Run the calibration from Task 2 Step 4**

Expected: the ANCHOR line and bbox described there.

### Task 4: Archetypes

**Files:**
- Create: `game/art/lib/archetypes.py`

- [ ] **Step 1: Write the three archetypes**

```python
"""Building archetypes. Footprint is w x d tiles from (0, 0) to (w, -d); each returns its highest point in Blender units."""
import random

from . import materials as M
from .geo import box
from .iso import FLOOR_PX, PLINTH_PX, body_top, px


def _parapet(w, d, z, h, t, mat):
    box("par-n", 0, -t, z, w, 0, z + h, mat)
    box("par-s", 0, -d, z, w, -d + t, z + h, mat)
    box("par-w", 0, -d, z, t, 0, z + h, mat)
    box("par-e", w - t, -d, z, w, 0, z + h, mat)


def _roof(rng, w, d, top, slab_mat, rim_mat, clutter_mat):
    box("roof", 0.01, -d + 0.01, top, w - 0.01, -0.01, top + px(1), slab_mat)
    _parapet(w, d, top, px(4), 0.035, rim_mat)
    peak = top + px(4)
    for i in range(rng.randint(1, 2 + w * d // 2)):
        sx, sy = rng.uniform(0.14, 0.3), rng.uniform(0.14, 0.3)
        x = rng.uniform(0.12, w - 0.12 - sx)
        y = -rng.uniform(0.12 + sy, d - 0.12)
        h = px(rng.uniform(5, 11))
        box(f"hvac{i}", x, y, top, x + sx, y + sy, top + h, clutter_mat)
        peak = max(peak, top + h)
    return peak


def glass_tower(w, d, floors, seed, lit=0.65):
    rng = random.Random(seed)
    top = body_top(floors)
    tint = rng.choice([(0.09, 0.16, 0.24, 1), (0.1, 0.19, 0.22, 1), (0.14, 0.16, 0.2, 1)])
    box("tower", 0, -d, 0, w, 0, top, M.windows("curtain", 1 / 3, px(FLOOR_PX), lit, tint, frame_frac=0.06))
    metal = M.flat("metal", (0.55, 0.57, 0.6, 1), rough=0.35, metal=0.8)
    return _roof(rng, w, d, top, M.pbr("roofslab", "Concrete034", 1.0, (0.55, 0.56, 0.57, 1)), metal, metal)


def brick_loft(w, d, floors, seed, lit=0.55):
    rng = random.Random(seed)
    top = body_top(floors)
    tint = rng.choice([(1, 1, 1, 1), (0.85, 0.8, 0.78, 1), (1.05, 0.92, 0.85, 1)])
    box("body", 0, -d, 0, w, 0, top, M.pbr("brick", "Bricks075A", 0.5, tint))
    stone = M.flat("stone", (0.78, 0.74, 0.66, 1), rough=0.85)
    glass = M.windows("win", 0.5, px(FLOOR_PX), lit, (0.05, 0.07, 0.09, 1))
    fz, e, per = px(FLOOR_PX), 0.012, 2
    for f in range(floors):
        z0 = px(PLINTH_PX) + f * fz + fz * 0.22
        z1 = z0 + fz * 0.58
        for i in range(w * per):  # the game's left face (-Y)
            u0, u1 = (i + 0.28) / per, (i + 0.72) / per
            box(f"wl{f}.{i}", u0, -d - e, z0, u1, -d + 0.02, z1, glass)
            box(f"sl{f}.{i}", u0 - 0.02, -d - e * 2, z0 - px(1.6), u1 + 0.02, -d + 0.02, z0, stone)
        for j in range(d * per):  # the game's right face (+X)
            v0, v1 = -(j + 0.72) / per, -(j + 0.28) / per
            box(f"wr{f}.{j}", w - 0.02, v0, z0, w + e, v1, z1, glass)
            box(f"sr{f}.{j}", w - 0.02, v0 - 0.02, z0 - px(1.6), w + e * 2, v1 + 0.02, z0, stone)
    box("cornice", -0.02, -d - 0.02, top - px(3), w + 0.02, 0.02, top, stone)
    tar = M.pbr("tar", "Asphalt026B", 0.8, (0.6, 0.6, 0.6, 1))
    return _roof(rng, w, d, top, tar, stone, M.flat("hvac", (0.6, 0.61, 0.62, 1), rough=0.5, metal=0.5))


def concrete_office(w, d, floors, seed, lit=0.6):
    rng = random.Random(seed)
    top = body_top(floors)
    conc = M.pbr("concrete", "Concrete034", 0.6, (0.95, 0.93, 0.88, 1))
    box("core", 0.01, -d + 0.01, 0, w - 0.01, -0.01, top, M.windows("ribbon", 1 / 4, px(FLOOR_PX), lit, (0.1, 0.15, 0.2, 1), frame_frac=0.05))
    fz, e = px(FLOOR_PX), 0.01
    for f in range(1, floors):  # floor 0 is the glass lobby
        z0 = px(PLINTH_PX) + f * fz
        box(f"band{f}", -e, -d - e, z0 - fz * 0.12, w + e, e, z0 + fz * 0.34, conc)
    box("canopy", -0.06, -d - 0.06, px(PLINTH_PX) + fz * 0.88, w + 0.06, 0.06, px(PLINTH_PX) + fz, conc)
    box("crown", -e, -d - e, top - px(5), w + e, e, top, conc)
    return _roof(rng, w, d, top, M.pbr("roofslab", "Concrete034", 1.0, (0.62, 0.62, 0.6, 1)), conc, M.flat("hvac", (0.66, 0.67, 0.68, 1), rough=0.5, metal=0.5))


BUILDERS = {"glass_tower": glass_tower, "brick_loft": brick_loft, "concrete_office": concrete_office}
```

- [ ] **Step 2: Verify by rendering one of each** (after Task 6 exists): `blender -b -P art/build.py -- --city san-francisco --only glass-2x2-f14` and open the PNG.

### Task 5: Signs

**Files:**
- Create: `game/art/lib/signs.py`

- [ ] **Step 1: Write channel letters and billboard**

```python
"""Brand signage: 3D channel letters on a roof edge, and a rooftop billboard."""
import math

import bpy

from . import materials as M
from .geo import box, cylinder
from .iso import px

FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
ART = __import__("pathlib").Path(__file__).resolve().parent.parent / "ads"


def channel_letters(text, color, glow, w, d, z, face="+X", height_px=12):
    """Extruded letters standing on the roof edge above one visible facade, reading left to right on screen."""
    cu = bpy.data.curves.new("letters", "FONT")
    cu.body = text
    cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    cu.size = px(height_px) * 1.35  # cap height is about 0.72 of the font size
    cu.extrude = 0.018
    cu.align_x = "CENTER"
    ob = bpy.data.objects.new("letters", cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(M.flat("letters", color, rough=0.3, glow=glow, strength=6.0))
    if face == "+X":  # right face: reads toward +Y, faces +X
        ob.rotation_euler = (math.pi / 2, 0, math.pi / 2)
        ob.location = (w - 0.06, -d / 2, z)
        span = d
    else:  # left face: reads toward +X, faces -Y
        ob.rotation_euler = (math.pi / 2, 0, 0)
        ob.location = (w / 2, -d + 0.06, z)
        span = w
    bpy.context.view_layer.update()
    s = min(1.0, span * 0.86 / ob.dimensions.x)
    ob.scale = (s, s, s)
    return z + px(height_px) * s * 1.3


def billboard(image_name, w, d, z):
    """A steel billboard on posts across the roof, facing the game's left face (-Y)."""
    bw = min(w, 2) * 0.82
    bh = bw * 400 / 880
    lift = px(10)
    cx, cy = w / 2, -d / 2
    steel = M.flat("steel", (0.3, 0.32, 0.34, 1), rough=0.5, metal=0.8)
    for k in (-0.4, 0, 0.4):
        cylinder(f"post{k}", cx + k * bw, cy + 0.08, 0.018, z, z + lift + bh * 0.5, steel)
    box("catwalk", cx - bw / 2, cy - 0.06, z + lift - px(1.5), cx + bw / 2, cy + 0.02, z + lift, steel)
    box("backing", cx - bw / 2 - 0.02, cy + 0.005, z + lift, cx + bw / 2 + 0.02, cy + 0.04, z + lift + bh + 0.03, M.flat("frame", (0.84, 0.86, 0.87, 1), rough=0.6))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, z + lift + bh / 2 + 0.015))
    face = bpy.context.object
    face.name = "ad"
    face.scale = (bw, bh, 1)
    face.rotation_euler = (math.pi / 2, 0, 0)
    face.data.materials.append(M.image("ad", ART / image_name))
    return z + lift + bh + 0.05


def place(sign, w, d, z):
    if sign["type"] == "letters":
        return channel_letters(sign["text"], sign["color"], sign["glow"], w, d, z + px(2), sign.get("face", "+X"))
    if sign["type"] == "billboard":
        return billboard(sign["image"], w, d, z)
    raise ValueError(f"unknown sign type {sign['type']}")
```

### Task 6: Catalog, build script, registration check

**Files:**
- Create: `game/art/catalog.py`
- Create: `game/art/build.py`
- Create: `game/art/check_register.py`
- Modify: `game/package.json` (scripts)

- [ ] **Step 1: Write the catalog**

```python
"""Which sprites each city gets. Unique entries carry a brand and are placed once, first."""

SALESFORCE = {"type": "letters", "text": "salesforce", "color": (0.0, 0.63, 0.88, 1), "glow": (0.45, 0.85, 1.0, 1)}
CAPITAL_ONE_CROWN = {"type": "letters", "text": "Capital One", "color": (0.0, 0.28, 0.47, 1), "glow": (0.92, 0.95, 1.0, 1), "face": "-Y"}
CAPITAL_ONE_BOARD = {"type": "billboard", "image": "capital-one.png"}

DOWNTOWN, MIXED = ["downtown"], ["downtown", "midtown"]


def _e(kind, w, d, floors, seed, zones, sign=None, brand=None):
    tag = {"glass_tower": "glass", "brick_loft": "loft", "concrete_office": "office"}[kind]
    sid = f"{tag}-{w}x{d}-f{floors}" + (f"-{brand}" if brand else f"-{seed}")
    return {"id": sid, "kind": kind, "w": w, "d": d, "floors": floors, "seed": seed, "zones": zones, "sign": sign, "brand": brand, "unique": brand is not None}


CATALOG = {
    "san-francisco": [
        _e("glass_tower", 2, 2, 16, 11, DOWNTOWN, SALESFORCE, "salesforce"),
        _e("glass_tower", 2, 2, 13, 12, DOWNTOWN, CAPITAL_ONE_CROWN, "capital-one"),
        _e("brick_loft", 2, 1, 5, 13, MIXED, CAPITAL_ONE_BOARD, "capital-one-billboard"),
        _e("glass_tower", 2, 2, 14, 1, DOWNTOWN),
        _e("glass_tower", 2, 2, 10, 2, DOWNTOWN),
        _e("glass_tower", 1, 1, 12, 3, DOWNTOWN),
        _e("glass_tower", 1, 1, 8, 4, DOWNTOWN),
        _e("glass_tower", 2, 1, 11, 5, DOWNTOWN),
        _e("glass_tower", 1, 2, 9, 6, DOWNTOWN),
        _e("concrete_office", 2, 2, 7, 7, MIXED),
        _e("concrete_office", 2, 1, 6, 8, MIXED),
        _e("concrete_office", 1, 2, 6, 9, MIXED),
        _e("concrete_office", 1, 1, 5, 10, MIXED),
        _e("brick_loft", 1, 1, 3, 14, MIXED),
        _e("brick_loft", 1, 1, 4, 15, MIXED),
        _e("brick_loft", 2, 1, 4, 16, MIXED),
        _e("brick_loft", 1, 2, 4, 17, MIXED),
    ],
}
```

- [ ] **Step 2: Write the build script**

```python
"""Render a city's sprites: blender -b -P art/build.py -- --city san-francisco [--only <id>]"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from catalog import CATALOG  # noqa: E402
from lib import geo, scene as S, signs  # noqa: E402
from lib.archetypes import BUILDERS  # noqa: E402
from lib.iso import FLOOR_PX, PLINTH_PX, Z_PX_PER_BU, body_top  # noqa: E402


def arg(name):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return argv[argv.index(name) + 1] if name in argv else None


def main():
    city, only = arg("--city"), arg("--only")
    out = HERE.parent / "public" / "sprites" / city
    out.mkdir(parents=True, exist_ok=True)
    mpath = out / "sprites.json"
    old = {e["id"]: e for e in json.loads(mpath.read_text())["sprites"]} if mpath.exists() else {}
    entries = []
    for spec in CATALOG[city]:
        sid = spec["id"]
        if only and sid != only:
            if sid in old:
                entries.append(old[sid])
            continue
        S.reset()
        S.day_lighting()
        w, d, floors = spec["w"], spec["d"], spec["floors"]
        peak = BUILDERS[spec["kind"]](w, d, floors, spec["seed"])
        if spec["sign"]:
            peak = max(peak, signs.place(spec["sign"], w, d, body_top(floors)))
        geo.shadow_catcher(w, d)
        top_px = math.ceil(peak * Z_PX_PER_BU)
        fr = S.frame(w, d, top_px)
        S.render(out / f"{sid}.png")
        S.set_night(True)
        S.render(out / f"{sid}.night.png")
        entries.append({
            "id": sid, "w": w, "d": d, "floors": floors, "zones": spec["zones"], "unique": spec["unique"],
            "brand": spec["brand"], "ax": fr["ax"], "ay": fr["ay"], "topZ": max(top_px, PLINTH_PX + floors * FLOOR_PX),
            "day": f"{sid}.png", "night": f"{sid}.night.png",
        })
        print(f"[art] {sid} done")
    mpath.write_text(json.dumps({"scale": S.SCALE, "sprites": entries}, indent=1))


main()
```

- [ ] **Step 3: Write the registration check**

```python
"""Fail if any sprite's opaque body is off its tile diamond by more than one game pixel."""
import json
import sys
from pathlib import Path

from PIL import Image

city = sys.argv[1]
root = Path(__file__).resolve().parent.parent / "public" / "sprites" / city
m = json.loads((root / "sprites.json").read_text())
s, bad = m["scale"], 0
for e in m["sprites"]:
    alpha = Image.open(root / e["day"]).getchannel("A").point(lambda v: 255 if v > 230 else 0)
    l, _, r, b = alpha.getbbox()
    want = ((e["ax"] - e["d"] * 32) * s, (e["ax"] + e["w"] * 32) * s, (e["ay"] + (e["w"] + e["d"]) * 16) * s)
    err = max(abs(l - want[0]), abs(r - want[1]), abs(b - want[2]))
    ok = err <= 2 * s
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} {e['id']:32} off by {err / s:.1f} px")
sys.exit(1 if bad else 0)
```

The body's widest points are its left corner (x = ax - d * 32), right corner (ax + w * 32), and front corner (y = ay + (w + d) * 16); the cast shadow is under the 230 alpha threshold.
Signs never reach past those corners.

- [ ] **Step 4: Add the npm script**

In `game/package.json` scripts add:

```json
"art:sf": "sh art/fetch_textures.sh && python3 art/make_ads.py && blender -b -P art/build.py -- --city san-francisco && python3 art/check_register.py san-francisco"
```

- [ ] **Step 5: Render and check**

Run: `cd game && npm run art:sf`
Expected: 17 `[art] ... done` lines, then 17 `ok` lines and exit 0; `public/sprites/san-francisco/` holds 34 PNGs and `sprites.json`.
Then open the three branded day PNGs and one night PNG and look at them.

### Task 7: Sprite choice (TDD)

**Files:**
- Create: `game/src/engine/sprite-pick.ts`
- Test: `game/tests/sprites.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// Sprite choice tests. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSprite, spriteOrigin, type SpriteEntry, type SpriteManifest } from "../src/engine/sprite-pick.ts";

const entry = (id: string, w: number, d: number, floors: number, zones: string[], unique = false): SpriteEntry => ({
  id, w, d, floors, zones, unique, brand: unique ? id : null, ax: 72, ay: 400, topZ: 330, day: `${id}.png`, night: `${id}.night.png`,
});

const manifest: SpriteManifest = {
  scale: 2,
  sprites: [
    entry("hero", 2, 2, 16, ["downtown"], true),
    entry("tall", 2, 2, 14, ["downtown"]),
    entry("short", 2, 2, 7, ["downtown", "midtown"]),
    entry("small", 1, 1, 5, ["midtown"]),
  ],
};

const always = (v: number) => () => v;

test("a unique branded sprite is placed first, then never again", () => {
  const used = new Set<string>();
  const lot = { zone: "downtown", w: 2, d: 2, maxFloors: 8, cap: Infinity };
  assert.equal(pickSprite(manifest, lot, used, always(0))?.id, "hero");
  assert.notEqual(pickSprite(manifest, lot, used, always(0))?.id, "hero");
});

test("generic sprites respect the zone's height and the footprint", () => {
  const used = new Set(["hero"]);
  assert.equal(pickSprite(manifest, { zone: "downtown", w: 2, d: 2, maxFloors: 8, cap: Infinity }, used, always(0))?.id, "short");
  assert.equal(pickSprite(manifest, { zone: "midtown", w: 1, d: 1, maxFloors: 6, cap: Infinity }, used, always(0))?.id, "small");
  assert.equal(pickSprite(manifest, { zone: "midtown", w: 2, d: 1, maxFloors: 9, cap: Infinity }, used, always(0)), null);
});

test("the sightline cap applies to heroes too", () => {
  const lot = { zone: "downtown", w: 2, d: 2, maxFloors: 20, cap: 8 };
  assert.equal(pickSprite(manifest, lot, new Set(), always(0))?.id, "short");
});

test("the sprite's anchor pixel sits on the tile's top corner", () => {
  const e = manifest.sprites[0];
  assert.deepEqual(spriteOrigin(e, 3, 1), { x: (3 - 1) * 32 - 72, y: (3 + 1) * 16 - 400 });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd game && node --test tests/sprites.test.ts`
Expected: FAIL, cannot find module `sprite-pick.ts`.

- [ ] **Step 3: Implement**

```ts
// Which pre-rendered sprite goes on a lot. Pure (no Pixi), so it runs under
// Node's test runner; sprites.ts does the loading and drawing.

export interface SpriteEntry {
  id: string;
  w: number;
  d: number;
  floors: number;
  zones: string[];
  /** Branded hero sprites are placed once per city, before anything generic. */
  unique: boolean;
  brand: string | null;
  /** Pixel (in game px) of tile (0, 0)'s top corner inside the image. */
  ax: number;
  ay: number;
  /** Highest point above the ground, in game px. */
  topZ: number;
  day: string;
  night: string;
}

export interface SpriteManifest {
  /** Images are rendered at this multiple of game pixels. */
  scale: number;
  sprites: SpriteEntry[];
}

export interface Lot {
  zone: string;
  w: number;
  d: number;
  /** How tall a generic sprite may be here (the zone's style). */
  maxFloors: number;
  /** Hard limit so landmarks stay visible (populate.ts sightlineCap). */
  cap: number;
}

export function pickSprite(m: SpriteManifest, lot: Lot, used: Set<string>, rng: () => number): SpriteEntry | null {
  const fits = m.sprites.filter((s) => s.w === lot.w && s.d === lot.d && s.zones.includes(lot.zone) && s.floors <= lot.cap);
  const heroes = fits.filter((s) => s.unique && !used.has(s.id));
  const pool = heroes.length ? heroes : fits.filter((s) => !s.unique && s.floors <= lot.maxFloors);
  if (!pool.length) return null;
  const s = pool[Math.floor(rng() * pool.length)];
  if (s.unique) used.add(s.id);
  return s;
}

/** Where a sprite's top-left goes for a building on tile (x, y); matches iso() in iso.ts (32 x 16 px half-tile). */
export function spriteOrigin(e: SpriteEntry, x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * 32 - e.ax, y: (x + y) * 16 - e.ay };
}
```

- [ ] **Step 4: Run to see them pass**

Run: `cd game && node --test tests/sprites.test.ts`
Expected: 4 passing.

### Task 8: Sprites in the game

**Files:**
- Create: `game/src/engine/sprites.ts`
- Modify: `game/src/engine/bricks.ts` (the `Built` interface)
- Modify: `game/src/engine/populate.ts`
- Modify: `game/src/engine/scene.ts:87,113`
- Modify: `game/src/main.ts:50-56`

- [ ] **Step 1: Write `sprites.ts`**

```ts
// Pre-rendered building sprites (game/art/): loading a city's set and turning
// one entry into the same Built shape the brick builder returns.

import { Assets, Container, Sprite, type Texture } from "pixi.js";
import type { Built } from "./bricks";
import { spriteOrigin, type SpriteEntry, type SpriteManifest } from "./sprite-pick";

export interface SpriteSet {
  manifest: SpriteManifest;
  textures: Map<string, Texture>;
}

/** A city's sprites, or null when it has none yet (it then uses the brick builder). */
export async function loadSpriteSet(cityId: string): Promise<SpriteSet | null> {
  const base = `${import.meta.env.BASE_URL}sprites/${cityId}/`;
  try {
    const res = await fetch(`${base}sprites.json`);
    // Vite answers unknown paths with index.html, so check the type too.
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    const manifest = (await res.json()) as SpriteManifest;
    const files = manifest.sprites.flatMap((s) => [s.day, s.night]);
    const loaded: Record<string, Texture> = await Assets.load(files.map((f) => base + f));
    return { manifest, textures: new Map(files.map((f) => [f, loaded[base + f]])) };
  } catch (err) {
    console.warn(`[larp] no sprites for ${cityId}`, err);
    return null;
  }
}

export function buildSprite(set: SpriteSet, e: SpriteEntry, x: number, y: number): Built {
  const o = spriteOrigin(e, x, y);
  const k = 1 / set.manifest.scale;
  const day = new Sprite(set.textures.get(e.day));
  const lights = new Sprite(set.textures.get(e.night));
  for (const s of [day, lights]) {
    s.position.set(o.x, o.y);
    s.scale.set(k);
  }
  // The night pass is black wherever nothing glows, so adding it only lights windows and signs.
  lights.blendMode = "add";
  lights.alpha = 0;
  const view = new Container();
  view.addChild(day, lights);
  return { view, lights, blinkers: [], topZ: e.topZ };
}
```

- [ ] **Step 2: Widen `Built.lights`**

In `bricks.ts`, change `lights: Graphics;` in `interface Built` to `lights: Container;` (scene.ts only sets its alpha).

- [ ] **Step 3: Use sprites in `populate.ts`**

Change the signature and the building loop:

```ts
export function populate(grid: CityGrid, city: CityDef, seed: number, sprites: SpriteSet | null = null): { buildings: Placed[] } {
  const rng = rngFor(seed, city.id, "populate");
  const used = new Set<string>();
```

and replace the three lines after `const spec = styleFor(...)` with:

```ts
      const spec = styleFor(zone, city, rng, x, y, w, d, seed);
      const cap = sightlineCap(city, x, y, w, d);
      spec.floors = Math.max(1, Math.min(spec.floors, cap));
      const entry = sprites ? pickSprite(sprites.manifest, { zone, w, d, maxFloors: spec.floors + 3, cap }, used, rng) : null;
      const built = entry && sprites ? buildSprite(sprites, entry, x, y) : buildBrick(spec);
      buildings.push({ built, x, y, w, d });
```

with imports `import { pickSprite } from "./sprite-pick";` and `import { buildSprite, type SpriteSet } from "./sprites";`.

- [ ] **Step 4: Thread the set through `scene.ts` and `main.ts`**

`scene.ts` constructor: `constructor(app: Application, city: CityDef, clock: Clock, factories: Record<string, LandmarkFactory>, sprites: SpriteSet | null = null, seed = 7)` and `this.buildings = populate(this.grid, this.city, seed, sprites).buildings;` (import the type from `./sprites`).

`main.ts` in `open()`:

```ts
  const city = cityFor(next);
  const sprites = await loadSpriteSet(city.id);
  scene = new CityScene(app, city, clock, LANDMARKS, sprites);
```

with `import { loadSpriteSet } from "./engine/sprites";`.

- [ ] **Step 5: Typecheck and test**

Run: `cd game && npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

### Task 9: Remove the studs

**Files:**
- Modify: `game/src/engine/ground.ts:158-159,310-331`
- Modify: `game/src/engine/bricks.ts:162-165`
- Modify: `game/src/cities/features/rural.landmarks.ts:8,48`

- [ ] **Step 1: Ground** - delete the two `drawStuds` branches (grass and rock) so the `else if (c === "f" ...)` branch becomes the first `if`, remove the now-empty `studs` Graphics and its `addChild`, and delete `OCT`, `octagon`, and `drawStuds`.
- [ ] **Step 2: Roofs** - in `bricks.ts` `flatTop`, keep only the roof fill; drop the `drawStuds` import.
- [ ] **Step 3: Rural landmark** - delete line 48's stud loop and the import.
- [ ] **Step 4: Verify** - `npx tsc --noEmit` clean, `grep -rn drawStuds src` empty.

### Task 10: Look at it

- [ ] **Step 1:** With `npm run dev` running, open `http://localhost:5173/#CA` in Chrome.
- [ ] **Step 2:** Screenshot at the default zoom, zoomed in on downtown, and zoomed out; then scrub the sky slider to night and screenshot again.
- [ ] **Step 3:** Check: sprites sit exactly on their lots (no gaps or overlap with roads), depth order is right against traffic and neighbors, Salesforce and Capital One read clearly, night windows and letters glow, no console errors.
- [ ] **Step 4:** Fix anything off (pixel perfection), rerender affected sprites with `--only`, recheck.
- [ ] **Step 5:** Add an "Art pipeline" section to `game/README.md` (how to run `npm run art:sf`, where textures and sprites live, texture credits: ambientCG, CC0).
