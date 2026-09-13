# Pixel Pass Implementation Plan (Milestone 0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every pre-rendered San Francisco sprite into pixel art (1 art px = 1 game px, dark outline, at most three flat tones per surface, a shared city palette) and draw it crisp in the game.

**Architecture:** Blender keeps modeling and lighting, but renders at 4x into a raw folder, plus an "id" pass where every object face direction is one flat color. A separate Python script (`art/pixelize.py`, system `python3` with numpy and Pillow) flattens each id region to three tones, shrinks 4x to 1x by majority color, snaps to the city palette, and draws the outline, writing the game's PNGs and `sprites.json` (`scale: 1`). The game samples sprite textures nearest-neighbor when zoomed in.

**Tech Stack:** Blender 5.2 (headless, Cycles), Python 3 with numpy 2 and Pillow 12 (`unittest`), PixiJS v8, TypeScript, Node's test runner.

**Spec:** `docs/superpowers/specs/2026-09-12-blender-houses-design.md` (Art direction, Milestone 0).

**Where to work:** the worktree `../larp-houses` on branch `blender-houses` (other sessions push to `main` in the main checkout). All paths below are relative to that worktree. Run `cd game && npm install` once.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `game/art/lib/pixel.py` | Create | Pure numpy and Pillow functions of the pixel pass: `downsample`, `flatten`, `build_palette`, `quantize`, `outline` |
| `game/art/tests/test_pixel.py` | Create | Unit tests for `pixel.py` |
| `game/art/pixelize.py` | Create | CLI: raw renders to final sprites, palette file, `sprites.json` |
| `game/art/contact.py` | Create | Contact sheet of a city's sprites at 1x and 4x |
| `game/art/palettes/san-francisco.json` | Generated | The city palette (kept across rerenders) |
| `game/art/lib/scene.py` | Modify | Render at 4x, id pass (`set_ids`) |
| `game/art/lib/materials.py` | Modify | Mark image materials as signs |
| `game/art/build.py` | Modify | Write raw renders and `raw.json` to `art/.raw/<city>/` |
| `game/art/make_ads.py` | Modify | Pixelify Sans everywhere, flat paint wear |
| `game/art/fonts/PixelifySans[wght].ttf` | Add | The UI's pixel font (OFL) |
| `game/art/check_register.py` | Modify | 1 game px registration at scale 1, palette and hard-alpha check |
| `game/src/engine/sprites.ts` | Modify | Nearest-neighbor magnification |
| `game/README.md` | Modify | The sprite pipeline section |
| `.gitignore` | Modify | Ignore `game/art/.raw/` |

---

### Task 1: The pixel pass functions (TDD)

**Files:**
- Create: `game/art/lib/pixel.py`
- Test: `game/art/tests/test_pixel.py`

- [ ] **Step 1: Write the failing tests**

Create `game/art/tests/test_pixel.py`:

```python
"""Pixel pass tests. Run from game/:  python3 -m unittest discover -s art/tests -v"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib import pixel as P  # noqa: E402


def img(h, w, rgba=(0, 0, 0, 0)):
    a = np.zeros((h, w, 4), np.uint8)
    a[:] = rgba
    return a


class Downsample(unittest.TestCase):
    def test_majority_color_wins_with_no_blending(self):
        a = img(4, 4, (200, 10, 10, 255))
        a[0, :3] = (10, 10, 200, 255)  # 3 of 16 pixels blue
        out = P.downsample(a)
        self.assertEqual(out.shape, (1, 1, 4))
        self.assertEqual(tuple(out[0, 0]), (200, 10, 10, 255))

    def test_mostly_transparent_block_is_dropped(self):
        a = img(4, 4)
        a[0, :2] = (255, 255, 255, 255)
        self.assertEqual(P.downsample(a)[0, 0, 3], 0)

    def test_size_shrinks_by_raw_scale(self):
        self.assertEqual(P.downsample(img(8, 12, (1, 2, 3, 255))).shape, (2, 3, 4))


class Flatten(unittest.TestCase):
    def test_region_gets_at_most_three_tones(self):
        rng = np.random.default_rng(1)
        day = img(8, 8, (0, 0, 0, 255))
        day[..., :3] = rng.integers(90, 160, (8, 8, 3))
        ids = img(8, 8, (10, 20, 30, 255))
        out = P.flatten(day, ids)
        tones = {tuple(p) for p in out[..., :3].reshape(-1, 3).tolist()}
        self.assertLessEqual(len(tones), 3)

    def test_two_regions_flatten_separately(self):
        day = img(2, 4, (100, 100, 100, 255))
        day[:, 2:] = (30, 60, 90, 255)
        ids = img(2, 4, (1, 1, 1, 255))
        ids[:, 2:] = (2, 2, 2, 255)
        out = P.flatten(day, ids)
        self.assertEqual(tuple(out[0, 0, :3]), (100, 100, 100))
        self.assertEqual(tuple(out[0, 3, :3]), (30, 60, 90))

    def test_sign_region_keeps_its_detail(self):
        day = img(4, 4, (0, 0, 0, 255))
        day[..., 0] = (np.arange(16).reshape(4, 4) * 10).astype(np.uint8)
        ids = img(4, 4, (*P.SIGN_ID, 255))
        np.testing.assert_array_equal(P.flatten(day, ids), day)


class Palette(unittest.TestCase):
    def test_palette_has_n_colors_and_ends_with_the_ink(self):
        rng = np.random.default_rng(2)
        a = img(16, 16, (0, 0, 0, 255))
        a[..., :3] = rng.integers(0, 255, (16, 16, 3))
        pal = P.build_palette([a], 8)
        self.assertEqual(len(pal), 8)
        self.assertEqual(pal[-1], P.INK)

    def test_night_palette_has_no_ink(self):
        a = img(4, 4, (250, 200, 120, 255))
        self.assertNotIn(P.INK, P.build_palette([a], 4, ink=False))

    def test_quantize_uses_only_palette_colors_and_hard_alpha(self):
        a = img(2, 2, (120, 130, 140, 200))
        a[0, 0] = (0, 0, 0, 40)
        pal = [(0, 0, 0), (128, 128, 128), (255, 255, 255)]
        out = P.quantize(a, pal)
        self.assertEqual(tuple(out[1, 1]), (128, 128, 128, 255))
        self.assertEqual(tuple(out[0, 0]), (0, 0, 0, 0))


class Outline(unittest.TestCase):
    PAL = [(200, 180, 160), (110, 99, 88)]

    def shape(self, right_id):
        day = img(5, 6)
        day[1:4, 1:5] = (200, 180, 160, 255)
        ids = img(5, 6)
        ids[1:4, 1:3] = (1, 1, 1, 255)
        ids[1:4, 3:5] = (*right_id, 255)
        return day, ids

    def test_silhouette_is_ink_and_an_id_change_darkens(self):
        day, ids = self.shape((2, 2, 2))
        out, lines = P.outline(day, ids, self.PAL + [P.INK])
        self.assertEqual(tuple(out[2, 1, :3]), P.INK)            # left edge of the shape
        self.assertEqual(tuple(out[2, 2, :3]), (110, 99, 88))     # left of the id change
        self.assertEqual(tuple(out[2, 3, :3]), (200, 180, 160))   # right of it, inside
        self.assertTrue(lines[2, 1] and lines[2, 2] and not lines[2, 3])

    def test_no_inner_line_against_a_sign(self):
        day, ids = self.shape(P.SIGN_ID)
        out, _ = P.outline(day, ids, self.PAL + [P.INK])
        self.assertEqual(tuple(out[2, 2, :3]), (200, 180, 160))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd game && python3 -m unittest discover -s art/tests -v`
Expected: ERROR, `ImportError: cannot import name 'pixel' from 'lib'`.

- [ ] **Step 3: Write `pixel.py`**

Create `game/art/lib/pixel.py`:

```python
"""The pixel pass (docs/superpowers/specs/2026-09-12-blender-houses-design.md): turns a render made at
RAW_SCALE x the final size into 1x pixel art. Pure numpy and Pillow, so it runs and tests outside Blender.

A sprite arrives as a day render plus an id render in which every object face direction is one flat
color (signs share SIGN_ID). flatten() gives each id region at most three tones of its median color,
downsample() shrinks by majority color (never averaging), quantize() snaps to the city palette, and
outline() draws the ink silhouette and darker lines where the id changes.
"""
import numpy as np
from PIL import Image

RAW_SCALE = 4
INK = (0x2B, 0x22, 0x33)       # the outline: a warm near-black
SIGN_ID = (255, 0, 255)        # id color of image-mapped signs, which keep their detail
TONES = (0.72, 1.0, 1.18)      # shade, base, and light, as multiples of a region's median color
DARK, LIGHT = 0.82, 1.14       # luminance ratios (to the median) below which a pixel is shade, above which light
EDGE_DARKEN = 0.55             # an inner line is the face's color at this brightness


def load(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8).copy()


def save(a: np.ndarray, path) -> None:
    Image.fromarray(a, "RGBA").save(path, optimize=True)


def _lum(rgb):
    rgb = np.asarray(rgb, dtype=np.float32)
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def _key(rgb):
    rgb = np.asarray(rgb)
    return (rgb[..., 0].astype(np.int64) << 16) | (rgb[..., 1].astype(np.int64) << 8) | rgb[..., 2].astype(np.int64)


SIGN_KEY = int(_key(np.array(SIGN_ID)))


def flatten(day: np.ndarray, ids: np.ndarray) -> np.ndarray:
    """Every id region becomes at most three flat tones of its median color; sign regions are left alone."""
    out = day.copy()
    keys = _key(ids[..., :3])
    keys[day[..., 3] <= 127] = -1
    flat = keys.ravel()
    order = np.argsort(flat, kind="stable")
    sorted_keys = flat[order]
    groups = np.split(order, np.flatnonzero(np.diff(sorted_keys)) + 1)
    rgb = day[..., :3].reshape(-1, 3)
    lum = _lum(rgb)
    out_rgb = out[..., :3].reshape(-1, 3)
    for g in groups:
        k = flat[g[0]]
        if k < 0 or k == SIGN_KEY:
            continue
        base = np.median(rgb[g].astype(np.float32), axis=0)
        ratio = lum[g] / max(float(_lum(base)), 1.0)
        tone = np.where(ratio < DARK, TONES[0], np.where(ratio > LIGHT, TONES[2], TONES[1]))
        out_rgb[g] = np.clip(base[None, :] * tone[:, None], 0, 255).astype(np.uint8)
    out[..., :3] = out_rgb.reshape(out.shape[0], out.shape[1], 3)
    return out


def downsample(img: np.ndarray, s: int = RAW_SCALE) -> np.ndarray:
    """Shrink by s with no blending: a block is opaque when at least half of it is, and takes its most common opaque color."""
    h, w = img.shape[0] // s, img.shape[1] // s
    blocks = img[: h * s, : w * s].reshape(h, s, w, s, 4).transpose(0, 2, 1, 3, 4).reshape(h, w, s * s, 4)
    opaque = blocks[..., 3] > 127
    keep = opaque.sum(axis=2) * 2 >= s * s
    keys = _key(blocks[..., :3])
    out = np.zeros((h, w, 4), np.uint8)
    for y, x in zip(*np.nonzero(keep)):
        vals, counts = np.unique(keys[y, x][opaque[y, x]], return_counts=True)
        best = int(vals[np.argmax(counts)])
        out[y, x] = ((best >> 16) & 255, (best >> 8) & 255, best & 255, 255)
    return out


def build_palette(images, n: int, ink: bool = True) -> list:
    """A shared palette: median cut over the opaque pixels of every image, plus the ink as the last color."""
    px = np.concatenate([im[im[..., 3] > 127][:, :3] for im in images])
    px = px[:: max(1, len(px) // 200_000)]
    k = n - 1 if ink else n
    strip = Image.fromarray(np.ascontiguousarray(px.reshape(1, -1, 3)), "RGB")
    q = strip.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    colors = [tuple(int(v) for v in c) for c in np.array(q.getpalette()[: k * 3]).reshape(-1, 3)]
    return colors + [INK] if ink else colors


def _nearest(rgb, palette) -> np.ndarray:
    pal = np.array(palette, np.int32)
    d = ((np.asarray(rgb, np.int32)[..., None, :] - pal) ** 2).sum(-1)
    return pal[d.argmin(-1)].astype(np.uint8)


def quantize(img: np.ndarray, palette) -> np.ndarray:
    """Snap every opaque pixel to its nearest palette color; alpha becomes 0 or 255."""
    out = np.zeros_like(img)
    opaque = img[..., 3] > 127
    out[opaque, :3] = _nearest(img[opaque, :3], palette)
    out[opaque, 3] = 255
    return out


def outline(img: np.ndarray, ids: np.ndarray, palette):
    """Ink on the silhouette; a darker palette tone on pixels whose right or lower neighbor has another id
    (never against a sign). Returns the image and the mask of every line pixel."""
    out = img.copy()
    a = img[..., 3] > 0
    pad = np.pad(a, 1)
    edge = a & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    k = _key(ids[..., :3])
    k[~a] = -1
    inner = np.zeros_like(a)
    for dy, dx in ((0, 1), (1, 0)):
        nb = np.full_like(k, -1)
        nb[: k.shape[0] - dy, : k.shape[1] - dx] = k[dy:, dx:]
        inner |= a & (nb >= 0) & (nb != k) & (k != SIGN_KEY) & (nb != SIGN_KEY)
    inner &= ~edge
    out[edge, :3] = INK
    if inner.any():
        out[inner, :3] = _nearest(img[inner, :3].astype(np.float32) * EDGE_DARKEN, palette)
    return out, edge | inner
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd game && python3 -m unittest discover -s art/tests -v`
Expected: `Ran 11 tests ... OK`.

- [ ] **Step 5: Commit**

```bash
git add game/art/lib/pixel.py game/art/tests/test_pixel.py
git commit -m "Art: the pixel pass functions (flatten, majority downsample, palette, outline)"
```

---

### Task 2: Blender renders raw 4x layers and an id pass

**Files:**
- Modify: `game/art/lib/scene.py`
- Modify: `game/art/lib/materials.py:180-186`
- Modify: `game/art/build.py`
- Modify: `.gitignore`

- [ ] **Step 1: Render at 4x and add the id pass in `scene.py`**

In `game/art/lib/scene.py`, change the scale and samples (the pixel pass averages nothing, so fewer samples do):

```python
SCALE = 4          # render at 4x; art/pixelize.py shrinks to 1x game pixels
```

and in `reset()` replace `sc.cycles.samples = 64` with `sc.cycles.samples = 32`.

Add at the end of the file:

```python
SIGN_ID = (1.0, 0.0, 1.0, 1.0)  # lib/pixel.py SIGN_ID after the Standard view transform


def _id_material(name: str, index: int, sign: bool):
    """Flat emission for the id pass. Signs get SIGN_ID. Anything else: red from the object's index,
    green from whether the face points right (+X) or left (-Y), blue from whether it points up."""
    m = bpy.data.materials.new(f"id-{name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    if sign:
        em.inputs["Color"].default_value = SIGN_ID
        return m
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
    color.inputs[0].default_value = ((index * 37) % 251 + 2) / 256
    nt.links.new(node("ADD", node("MULTIPLY", right, 0.5), 0.25), color.inputs[1])
    nt.links.new(node("ADD", node("MULTIPLY", up, 0.5), 0.25), color.inputs[2])
    nt.links.new(color.outputs[0], em.inputs["Color"])
    return m


def set_ids() -> None:
    """Id pass, always the last render of a sprite (it replaces every material): each object's faces glow one
    flat color per face direction, with no lights, sky, shadow catcher, noise, or anti-aliasing."""
    set_night(True)
    sc = bpy.context.scene
    sc.view_settings.exposure = 0.0
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    sc.cycles.filter_width = 0.01
    meshes = sorted((o for o in sc.objects if o.type == "MESH" and not o.get("shadow_catcher")), key=lambda o: o.name)
    for i, o in enumerate(meshes):
        sign = any(s.material and s.material.get("sign") for s in o.material_slots)
        mat = _id_material(o.name, i, sign)
        o.data.materials.clear()
        o.data.materials.append(mat)
```

Why these ids: splitting faces only by "points right or left" and "points up or not" gives a round tower two flat side bands (one vertical line, like pixel art) instead of a line between every cylinder segment, while a gable's two slopes and a box's two visible walls still get a line between them.

- [ ] **Step 2: Mark sign materials in `materials.py`**

In `image()` (`game/art/lib/materials.py`), right after `m, nt, out = _base(name)`, add:

```python
    m["sign"] = True  # the pixel pass keeps sign detail and draws no inner lines across it
```

- [ ] **Step 3: Write raw layers from `build.py`**

Replace `render()` and `main()` in `game/art/build.py` with:

```python
RAW = HERE / ".raw"


def render(spec, raw):
    """Render one sprite's raw 4x layers into raw/ and return its manifest entry (final 1x file names,
    plus the raw files under "raw" for art/pixelize.py)."""
    sid, w, d, floors = spec["id"], spec["w"], spec["d"], spec["floors"]
    S.reset()
    S.day_lighting()
    peak = BUILDERS[spec["kind"]](w, d, floors, spec["seed"], **spec["opts"])
    if spec["sign"]:
        peak = max(peak, signs.place(spec["sign"], w, d, body_top(floors)))
    geo.shadow_catcher(w, d)
    top_px = math.ceil(peak * Z_PX_PER_BU)
    fr = S.frame(w, d, top_px, extra=spec["pad"])
    files = {"day": f"{sid}.day.png", "night": f"{sid}.night.png", "ids": f"{sid}.ids.png"}
    S.render(raw / files["day"])
    S.set_night(True)
    S.render(raw / files["night"])
    entry = {
        "id": sid, "w": w, "d": d, "floors": floors, "zones": spec["zones"], "unique": spec["unique"],
        "brand": spec["brand"], "ax": fr["ax"], "ay": fr["ay"], "topZ": max(top_px, PLINTH_PX + floors * FLOOR_PX),
        "day": f"{sid}.png", "night": f"{sid}.night.png",
    }
    if spec["crown"]:
        files["crown"] = f"{sid}.crown.png"
        S.set_mask("crown")
        S.render(raw / files["crown"])
        S.mask_to_alpha(raw / files["crown"])
        entry["crown"] = f"{sid}.crown.png"
    S.set_ids()  # last: it replaces every material
    S.render(raw / files["ids"])
    for key, field in (("entry_kind", "kind"), ("landmark", "landmark"), ("prop", "prop"), ("side", "side")):
        if spec[key]:
            entry[field] = spec[key]
    if not spec["fill"]:
        entry["fill"] = False
    entry["raw"] = files
    return entry


def main():
    city, only = arg("--city"), arg("--only")
    wanted = set(only.split(",")) if only else None
    raw = RAW / city
    raw.mkdir(parents=True, exist_ok=True)
    mpath = raw / "raw.json"
    done = {e["id"]: e for e in json.loads(mpath.read_text())["sprites"]} if mpath.exists() else {}
    ids = [spec["id"] for spec in CATALOG[city]]

    def save():
        # Catalog order, only sprites that exist; written after every render so a crash loses nothing.
        mpath.write_text(json.dumps({"sprites": [done[i] for i in ids if i in done]}, indent=1))

    missing = "--missing" in sys.argv  # resume: render only what the raw manifest doesn't have yet
    for spec in CATALOG[city]:
        if (wanted and spec["id"] not in wanted) or (missing and spec["id"] in done):
            continue
        done[spec["id"]] = render(spec, raw)
        save()
        print(f"[art] {spec['id']} done", flush=True)
    save()
    print(f"[art] raw renders in {raw}; now run: python3 art/pixelize.py {city}", flush=True)
```

Also update the module docstring on line 1:

```python
"""Render a city's raw sprite layers: blender -b -P art/build.py -- --city san-francisco [--only <id>[,<id>...]] [--missing]
Then run art/pixelize.py to turn them into the game's pixel-art sprites."""
```

- [ ] **Step 4: Ignore raw renders**

Append to the repo-root `.gitignore`:

```gitignore
# Raw 4x Blender layers; art/pixelize.py turns them into game/public/sprites/
game/art/.raw/
```

- [ ] **Step 5: Render two sprites to check the pipeline**

Run: `cd game && sh art/fetch_textures.sh && blender -b -P art/build.py -- --city san-francisco --only loft-1x1-f3-14,glass-1x1-f12-3`
Expected: two `[art] ... done` lines; `ls art/.raw/san-francisco` lists `loft-1x1-f3-14.day.png`, `.night.png`, `.ids.png` and the same for the glass tower.

Open `art/.raw/san-francisco/loft-1x1-f3-14.ids.png` with the Read tool and check: flat, unshaded colors; each wall of the loft is one color; the two visible walls and the roof differ; windows and sills are separate colors. If a surface shows noise or gradients, `set_ids` is not replacing that object's material; fix before moving on.

- [ ] **Step 6: Commit**

```bash
git add .gitignore game/art/build.py game/art/lib/scene.py game/art/lib/materials.py
git commit -m "Art: render raw 4x layers and a flat id pass for the pixel pass"
```

---

### Task 3: `pixelize.py` and the contact sheet

**Files:**
- Create: `game/art/pixelize.py`
- Create: `game/art/contact.py`

- [ ] **Step 1: Write `pixelize.py`**

Create `game/art/pixelize.py`:

```python
"""Pixel pass over a city's raw renders (art/.raw/<city>/) into the game's sprites (public/sprites/<city>/).

Run from game/:  python3 art/pixelize.py san-francisco [--only <id>[,<id>...]] [--new-palette]

The city palette lives in art/palettes/<city>.json. It is built from all renders the first time
(or with --new-palette) and then kept, so rerendering one sprite never shifts the others' colors.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lib import pixel as P  # noqa: E402

DAY_COLORS, NIGHT_COLORS = 32, 16


def main(argv):
    city = argv[0]
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    raw = HERE / ".raw" / city
    out = HERE.parent / "public" / "sprites" / city
    out.mkdir(parents=True, exist_ok=True)
    entries = json.loads((raw / "raw.json").read_text())["sprites"]
    ppath = HERE / "palettes" / f"{city.replace('/', '-')}.json"

    cache = {}

    def shrunk(e):
        """The day render flattened and shrunk to 1x, and its id render shrunk the same way."""
        if e["id"] not in cache:
            r = e["raw"]
            day4, ids4 = P.load(raw / r["day"]), P.load(raw / r["ids"])
            cache[e["id"]] = (P.downsample(P.flatten(day4, ids4)), P.downsample(ids4))
        return cache[e["id"]]

    if "--new-palette" in argv or not ppath.exists():
        days = [shrunk(e)[0] for e in entries]
        nights = [P.downsample(P.load(raw / e["raw"]["night"])) for e in entries]
        ppath.parent.mkdir(exist_ok=True)
        ppath.write_text(json.dumps({"day": P.build_palette(days, DAY_COLORS), "night": P.build_palette(nights, NIGHT_COLORS, ink=False)}))
        print(f"[pixel] new palette {ppath.name}", flush=True)
    pal = json.loads(ppath.read_text())
    day_pal = [tuple(c) for c in pal["day"]]
    night_pal = [tuple(c) for c in pal["night"]]

    manifest = []
    for e in entries:
        final = {k: v for k, v in e.items() if k != "raw"}
        manifest.append(final)
        if only and e["id"] not in only:
            continue
        r = e["raw"]
        day1, ids1 = shrunk(e)
        day, _lines = P.outline(P.quantize(day1, day_pal), ids1, day_pal)
        P.save(day, out / final["day"])
        P.save(P.quantize(P.downsample(P.load(raw / r["night"])), night_pal), out / final["night"])
        if "crown" in r:
            P.save(P.downsample(P.load(raw / r["crown"])), out / final["crown"])
        print(f"[pixel] {e['id']}", flush=True)
    (out / "sprites.json").write_text(json.dumps({"scale": 1, "sprites": manifest}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
```

- [ ] **Step 2: Write `contact.py`**

Create `game/art/contact.py`:

```python
"""Contact sheet of a city's sprites at 1x and 4x (nearest), on the reference sheet's blue-grey.

Run from game/:  python3 art/contact.py san-francisco [id-prefix]
Writes art/_contact-<city>[-<prefix>].png. Sprites with a walls layer are shown three times, with
the walls tinted pink, mint, and butter, the way the game tints them.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
BG = (138, 148, 173, 255)
TINTS = [(246, 184, 200), (191, 230, 208), (251, 231, 161)]
GAP = 12


def tinted(day, walls, color):
    layer = ImageChops.multiply(walls, Image.new("RGBA", walls.size, (*color, 255)))
    out = day.copy()
    out.alpha_composite(layer)
    return out


def main(argv):
    city, prefix = argv[0], argv[1] if len(argv) > 1 else ""
    root = HERE.parent / "public" / "sprites" / city
    m = json.loads((root / "sprites.json").read_text())
    rows = []
    for e in m["sprites"]:
        if not e["id"].startswith(prefix):
            continue
        day = Image.open(root / e["day"]).convert("RGBA")
        variants = [day]
        if e.get("walls"):
            walls = Image.open(root / e["walls"]).convert("RGBA")
            variants = [tinted(day, walls, c) for c in TINTS]
        rows.append((e["id"], variants))
    one_w = max(v[0].width for _, v in rows)
    row_h = [max(v[0].height * 4, 16) for _, v in rows]
    width = GAP + (one_w + GAP) + max(len(v) for _, v in rows) * (one_w * 4 + GAP)
    sheet = Image.new("RGBA", (width, sum(row_h) + GAP * (len(rows) + 1) + 14 * len(rows)), BG)
    draw = ImageDraw.Draw(sheet)
    y = GAP
    for (sid, variants), h in zip(rows, row_h):
        draw.text((GAP, y), sid, fill=(20, 20, 30, 255))
        y += 14
        sheet.alpha_composite(variants[0], (GAP, y + h - variants[0].height))
        x = GAP + one_w + GAP
        for v in variants:
            big = v.resize((v.width * 4, v.height * 4), Image.NEAREST)
            sheet.alpha_composite(big, (x, y))
            x += one_w * 4 + GAP
        y += h + GAP
    name = f"_contact-{city.replace('/', '-')}{'-' + prefix if prefix else ''}.png"
    sheet.save(HERE / name)
    print(HERE / name)


if __name__ == "__main__":
    main(sys.argv[1:])
```

- [ ] **Step 3: Run the pass on the two test renders**

Run: `cd game && python3 art/pixelize.py san-francisco --only loft-1x1-f3-14,glass-1x1-f12-3 --new-palette && python3 art/contact.py san-francisco`
Expected: `[pixel] new palette san-francisco.json`, two `[pixel]` lines, and the contact sheet path.

The raw manifest only holds the two test sprites at this point, so `sprites.json` now lists only those two. That's expected; Task 8 re-renders everything.

- [ ] **Step 4: Commit**

```bash
git add game/art/pixelize.py game/art/contact.py
git commit -m "Art: pixelize.py writes 1x pixel sprites and the city palette; contact sheets"
```

---

### Task 4: Look-development checkpoint (user review)

**Files:**
- Modify (tuning only): `game/art/lib/pixel.py` constants `TONES`, `DARK`, `LIGHT`, `EDGE_DARKEN`, and `DAY_COLORS` in `pixelize.py`

- [ ] **Step 1: Look at the sheet**

Read `game/art/_contact-san-francisco.png` with the Read tool. Compare it to the reference sheet (cozy pixel houses: dark outline, flat 2-3 tone faces, readable windows):

- Outline: 1 px, continuous around the silhouette, and at the corner between the two visible walls and along the roof edge.
- Faces: the lit wall, the shaded wall, and the roof each read as one flat color, with window rows as a second tone.
- Windows: separate, readable pixels, not a blur.
- No stray single pixels of odd colors inside flat faces.

- [ ] **Step 2: Tune if needed**

Too noisy (speckles inside faces): lower `LIGHT` to 1.1 and raise `DARK` to 0.86 so fewer pixels leave the base tone.
Window rows lost: lower `DARK` to 0.78.
Lines too heavy: raise `EDGE_DARKEN` to 0.65.
Colors too few (banding on the glass tower): raise `DAY_COLORS` to 40.
After each change: `python3 -m unittest discover -s art/tests && python3 art/pixelize.py san-francisco --new-palette && python3 art/contact.py san-francisco`.

- [ ] **Step 3: Ask the user**

Send the contact sheet to the user (SendUserFile) and ask whether the look is right before re-rendering the city. Do not continue to Task 8 without their yes; Tasks 5-7 can proceed meanwhile.

- [ ] **Step 4: Commit any tuning**

```bash
git add game/art/lib/pixel.py game/art/pixelize.py
git commit -m "Art: tune the pixel pass after look review"
```

---

### Task 5: Pixel font and flat paint on sign art

**Files:**
- Add: `game/art/fonts/PixelifySans[wght].ttf`
- Modify: `game/art/make_ads.py:35-45` (fonts), `game/art/make_ads.py:244-257` (`weather`)

- [ ] **Step 1: Add the font**

Run:

```bash
mkdir -p game/art/fonts
curl -sfL -o "game/art/fonts/PixelifySans[wght].ttf" "https://github.com/google/fonts/raw/main/ofl/pixelifysans/PixelifySans%5Bwght%5D.ttf"
curl -sfL -o game/art/fonts/OFL.txt "https://github.com/google/fonts/raw/main/ofl/pixelifysans/OFL.txt"
```

Expected: both files exist and the TTF is over 50 KB.

- [ ] **Step 2: Use it for every sign**

In `game/art/make_ads.py`, directly after the `ROUNDED_BOLD = ...` line, add:

```python
# Pixel art (docs/superpowers/specs/2026-09-12-blender-houses-design.md): every sign is lettered in Pixelify Sans,
# the UI's pixel font, so text survives the sprite pixel pass as crisp pixels. The names above stay so call sites read the same.
PIXEL = font_spec((str(Path(__file__).resolve().parent / "fonts" / "PixelifySans[wght].ttf"), 0, b"Bold"))
ARIAL = ARIAL_BOLD = ARIAL_BLACK = HELV_BOLD = GEORGIA = GEORGIA_BOLD = SCRIPT = FUTURA = ROUNDED = ROUNDED_BOLD = PIXEL
```

- [ ] **Step 3: Flat wear instead of soft patches and grain**

Replace the body of `Sign.weather` with:

```python
    def weather(self, lo, hi, seed_size=(40, 28)):
        """Fade paint evenly to the middle of lo..hi. Pixel art has no soft wear patches or grain,
        which the pixel pass would turn into speckles."""
        mid = (lo + hi) / 2
        self.im.putalpha(self.im.getchannel("A").point(lambda v: round(v * mid)))
```

- [ ] **Step 4: Redraw the art**

Run: `cd game && python3 art/make_ads.py`
Expected: it finishes with no safe-area error. If a sign raises because the wider pixel font leaves its safe area, lower that call's `max_size` until it fits (the error names the sign and element).
Read `game/art/ads/_contact.png` and check every sign is legible in the pixel font.

- [ ] **Step 5: Commit**

```bash
git add game/art/fonts game/art/make_ads.py game/art/ads
git commit -m "Art: sign art in Pixelify Sans with flat paint wear, for the pixel pass"
```

---

### Task 6: Crisp pixels in the game

**Files:**
- Modify: `game/src/engine/sprites.ts:22-24`

- [ ] **Step 1: Set the texture filters**

In `loadSpriteSet`, after `const loaded: Record<string, Texture> = await Assets.load(...)`, add:

```ts
    // Pixel art: square pixels when zoomed in; smooth when zoomed out, so small sprites don't shimmer while panning.
    for (const t of Object.values(loaded)) {
      t.source.style.magFilter = "nearest";
      t.source.style.minFilter = "linear";
      t.source.style.update();
    }
```

- [ ] **Step 2: Typecheck and test**

Run: `cd game && npm run build && npm test`
Expected: the build succeeds and all tests pass.

- [ ] **Step 3: Commit**

```bash
git add game/src/engine/sprites.ts
git commit -m "Engine: draw sprite textures with nearest magnification"
```

---

### Task 7: `check_register.py` for pixel sprites

**Files:**
- Modify: `game/art/check_register.py` (rewrite)

- [ ] **Step 1: Rewrite the check**

Replace `game/art/check_register.py` with:

```python
"""Fail if any sprite is off its tile diamond by more than one game pixel, or skipped the pixel pass
(semi-transparent pixels, or colors outside the city palette).

Run from game/:  python3 art/check_register.py san-francisco
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.pixel import SHADOW  # noqa: E402

city = sys.argv[1]
here = Path(__file__).resolve().parent
root = here.parent / "public" / "sprites" / city
m = json.loads((root / "sprites.json").read_text())
palette = {tuple(c) for c in json.loads((here / "palettes" / f"{city.replace('/', '-')}.json").read_text())["day"]}
s, bad = m["scale"], 0


def fail(sid, why):
    global bad
    bad += 1
    print(f"BAD {sid:36} {why}")


shadow_rgb, shadow_alpha = SHADOW[:3], SHADOW[3]

for e in m["sprites"]:
    a = np.asarray(Image.open(root / e["day"]).convert("RGBA"))
    # The flat cast shadow (lib/pixel.py SHADOW) is the one allowed translucent color.
    is_shadow = (a[..., 3] == shadow_alpha) & np.all(a[..., :3] == shadow_rgb, axis=-1)
    soft = int(((a[..., 3] > 0) & (a[..., 3] < 255) & ~is_shadow).sum())
    if soft:
        fail(e["id"], f"{soft} semi-transparent pixels")
        continue
    stray = {tuple(c) for c in a[a[..., 3] == 255][:, :3].tolist()} - palette
    if stray:
        fail(e["id"], f"{len(stray)} colors outside the palette")
        continue
    if e.get("fill") is False:  # rounded towers, freeway boards and shelters don't fill their lot
        print(f"--  {e['id']:36} (not a full-lot box)")
        continue
    ys, xs = np.nonzero(a[..., 3] == 255)  # the building only; the shadow may run past the diamond
    l, r, b = xs.min(), xs.max() + 1, ys.max() + 1
    want = ((e["ax"] - e["d"] * 32) * s, (e["ax"] + e["w"] * 32) * s, (e["ay"] + (e["w"] + e["d"]) * 16) * s)
    err = max(abs(l - want[0]), abs(r - want[1]), abs(b - want[2])) / s
    if err > 1:
        fail(e["id"], f"off by {err:.1f} px")
    else:
        print(f"ok  {e['id']:36} off by {err:.1f} px")
sys.exit(1 if bad else 0)
```

- [ ] **Step 2: Run it on the two test sprites**

Run: `cd game && python3 art/check_register.py san-francisco`
Expected: two `ok` lines, exit code 0. If the loft is off by more than 1 px, the outline or the shadow sits outside its diamond: the silhouette ink is part of the sprite, so compare against a render from before this plan (git stash is not needed; `git show HEAD~6:game/public/sprites/san-francisco/loft-1x1-f3-14.png`) and fix the framing before continuing.

- [ ] **Step 3: Commit**

```bash
git add game/art/check_register.py
git commit -m "Art: check_register checks pixel sprites (1 px, hard alpha, city palette)"
```

---

### Task 8: Re-render the San Francisco catalog

Needs the user's yes from Task 4.

- [ ] **Step 1: Render every sprite**

Run (about 43 sprites; it resumes with `--missing` if interrupted):

```bash
cd game && blender -b -P art/build.py -- --city san-francisco
```

Expected: 43 `[art] ... done` lines, then the "now run" hint.

- [ ] **Step 2: Pixelize with a fresh palette from the whole city**

Run: `cd game && python3 art/pixelize.py san-francisco --new-palette && python3 art/check_register.py san-francisco && python3 art/contact.py san-francisco`
Expected: 43 `[pixel]` lines, every register line `ok` or `--`, exit 0.

- [ ] **Step 3: Review the full sheet**

Read `game/art/_contact-san-francisco.png`. Check especially the Salesforce Tower (round tower: its two sides should be two flat tone bands with one vertical line), the Ferry Building letters, every branded sign (readable), and the shelters.

- [ ] **Step 4: Check size**

Run: `du -sh game/public/sprites/san-francisco`
Expected: well under the previous 11 MB (1x pixel art).

- [ ] **Step 5: Commit**

```bash
git add game/public/sprites/san-francisco game/art/palettes game/art/_contact-san-francisco.png
git commit -m "Sprites: San Francisco re-rendered as pixel art"
```

---

### Task 9: See it in the game

- [ ] **Step 1: Run the game**

Run in the background: `cd game && npm run dev -- --port 5199 --strictPort`
Open `http://localhost:5199/#san-francisco` in Chrome (Claude in Chrome), click "Skip and use a sample life".

- [ ] **Step 2: Check downtown at three zooms, day and night**

Take screenshots at the default zoom, zoomed in two steps (mouse wheel over downtown), and zoomed out fully. For night, run `larp.scene()` in the console to find the clock helpers, or advance time with the phone's Calendar app (its speed controls) until night. Check:

- Zoomed in: square pixels, no blur, outlines intact.
- Default and zoomed out: no shimmer while dragging, no seams between sprites and the ground.
- Night: lit windows are clean pixels; signs glow.
- The time-of-day tint (dusk, overcast) still reaches every sprite.

Fix anything that looks off before continuing, even if unrelated (the repo's rule).

- [ ] **Step 3: Close the tab and stop the dev server**

---

### Task 10: Document the pipeline

**Files:**
- Modify: `game/README.md` ("Building sprites (Blender)" section)

- [ ] **Step 1: Update the section**

Replace the bullet list under "## Building sprites (Blender)" so it describes the current pipeline. Keep the existing sign bullets; change these:

```markdown
Cities with a sprite set draw their buildings from pre-rendered pixel-art sprites instead of the procedural builder (`src/engine/bricks.ts`, still used for lots no sprite fits and for cities without sprites).
San Francisco is the first city with a set ([design](../docs/superpowers/specs/2026-09-12-blender-houses-design.md)).

```sh
brew install --cask blender                                   # once; the scripts run it headless
blender -b -P art/build.py -- --city san-francisco            # raw 4x layers into art/.raw/ (gitignored)
python3 art/pixelize.py san-francisco                         # the pixel pass: public/sprites/<city>/ at 1x
python3 art/check_register.py san-francisco                   # 1 px registration, hard alpha, city palette
python3 art/contact.py san-francisco                          # review sheet at 1x and 4x
python3 -m unittest discover -s art/tests                     # pixel pass tests
```

- The pixel pass (`art/lib/pixel.py`): Blender renders at 4x plus an id pass (every object face direction one flat color). Each id region is flattened to at most three tones, shrunk to 1x by majority color, snapped to the city palette (`art/palettes/<city>.json`, kept across rerenders; `--new-palette` rebuilds it), and outlined in ink (`#2b2233`) with darker lines where faces meet. Signs keep their detail.
- Sign art is lettered in Pixelify Sans (`art/fonts/`, OFL), the UI's font.
- The game magnifies sprites nearest-neighbor, so zooming in shows square pixels.
```

- [ ] **Step 2: Commit**

```bash
git add game/README.md
git commit -m "Docs: the pixel-art sprite pipeline"
```

---

## Self-review notes

- Spec coverage: render at 4x (Task 2), flatten, majority downsample, palette, no dithering, outline, sign exemption (Task 1), night pass (Task 3), palette file (Task 3), scale 1 manifest (Task 3), nearest textures (Task 6), re-render of all 43 (Task 8), pixel font (Task 5), check_register rules (Task 7), contact sheet (Task 3), browser check (Task 9). The walls layer is Milestone 1 (`2026-09-12-houses.md`).
- The spec says "nearest-neighbor"; this plan uses nearest for magnification and linear for minification to avoid shimmer at zoom below 1. Tell the user in the Task 9 report.
