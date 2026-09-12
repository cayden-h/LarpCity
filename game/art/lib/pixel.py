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
# A cast shadow is one flat, unoutlined shape: the ink at a fixed alpha, so it darkens whatever ground
# it lands on the same way everywhere, instead of the render's soft gradient.
SHADOW = (*INK, 96)
# The render's cast shadow sits near alpha 175, but the shadow catcher also leaves a faint haze (alpha under
# 32) over the whole frame; only pixels above this alpha count as shadow, so the haze never becomes stray marks.
SHADOW_MIN_ALPHA = 64


def load(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8).copy()


def save(a: np.ndarray, path) -> None:
    Image.fromarray(a, "RGBA").save(path, optimize=True)


def _opaque(img: np.ndarray) -> np.ndarray:
    """The one opacity rule the whole pass shares: a pixel counts as opaque above half alpha."""
    return img[..., 3] > 127


def _lum(rgb):
    rgb = np.asarray(rgb, dtype=np.float32)
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def _key(rgb):
    rgb = np.asarray(rgb)
    return (rgb[..., 0].astype(np.int64) << 16) | (rgb[..., 1].astype(np.int64) << 8) | rgb[..., 2].astype(np.int64)


SIGN_KEY = int(_key(np.array(SIGN_ID)))


def flatten(day: np.ndarray, ids: np.ndarray) -> np.ndarray:
    """Every id region becomes at most three flat tones of its median color; sign regions, and any pixel
    transparent in the day or the ids render, are left alone. Safe on an empty (0-size) image."""
    out = day.copy()
    keys = _key(ids[..., :3])
    keys[~_opaque(day)] = -1
    keys[~_opaque(ids)] = -1
    flat = keys.ravel()
    order = np.argsort(flat, kind="stable")
    sorted_keys = flat[order]
    groups = np.split(order, np.flatnonzero(np.diff(sorted_keys)) + 1)
    rgb = day[..., :3].reshape(-1, 3)
    lum = _lum(rgb)
    out_rgb = out[..., :3].reshape(-1, 3)
    for g in groups:
        if g.size == 0:
            continue
        k = flat[g[0]]
        if k < 0 or k == SIGN_KEY:
            continue
        base = np.median(rgb[g].astype(np.float32), axis=0)
        ratio = lum[g] / max(float(_lum(base)), 1.0)
        tone = np.where(ratio < DARK, TONES[0], np.where(ratio > LIGHT, TONES[2], TONES[1]))
        out_rgb[g] = np.clip(np.rint(base[None, :] * tone[:, None]), 0, 255).astype(np.uint8)
    out[..., :3] = out_rgb.reshape(out.shape[0], out.shape[1], 3)
    return out


def downsample(img: np.ndarray, s: int = RAW_SCALE) -> np.ndarray:
    """Shrink by s with no blending: a block is opaque when at least half of it is, and takes the color shared
    by the most of its opaque pixels; a tie goes to the lowest packed RGB key, so it stays deterministic.
    Fully vectorized: no per-block Python loop."""
    h, w = img.shape[0] // s, img.shape[1] // s
    m = s * s
    blocks = img[: h * s, : w * s].reshape(h, s, w, s, 4).transpose(0, 2, 1, 3, 4).reshape(h, w, m, 4)
    opaque = _opaque(blocks)
    keep = opaque.sum(axis=2) * 2 >= m
    keys = np.where(opaque, _key(blocks[..., :3]), -1)
    valid = keys >= 0
    # for each pixel in the block, how many valid pixels in the block (itself included) share its key
    eq = (keys[..., :, None] == keys[..., None, :]) & valid[..., None, :]
    counts = np.where(valid, eq.sum(axis=-1), -1)
    # highest count wins; ties go to the lowest key. BIG exceeds any 24-bit packed RGB key, so it dominates.
    BIG = 1 << 25
    score = counts.astype(np.int64) * BIG - keys
    best = np.take_along_axis(keys, score.argmax(axis=-1, keepdims=True), axis=-1)[..., 0]
    best = np.where(keep, best, 0)  # a dropped block must be exactly (0, 0, 0, 0), not -1 & 255 = 255
    out = np.zeros((h, w, 4), np.uint8)
    out[..., 0] = (best >> 16) & 255
    out[..., 1] = (best >> 8) & 255
    out[..., 2] = best & 255
    out[..., 3] = np.where(keep, 255, 0)
    return out


def split_shadow(day: np.ndarray, ids: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Separate the cast shadow from the building. Every pixel the day render covers but the ids render does
    not (the ids render has no shadow catcher) is cleared to (0, 0, 0, 0), so it is never part of the building;
    the shadow mask is the part of that above SHADOW_MIN_ALPHA. Returns the cleared day render and the mask."""
    outside = (day[..., 3] > 0) & ~_opaque(ids)
    building = day.copy()
    building[outside] = 0
    return building, outside & (day[..., 3] > SHADOW_MIN_ALPHA)


def downsample_mask(mask: np.ndarray, s: int = RAW_SCALE) -> np.ndarray:
    """Shrink a bool mask by s the way downsample() treats opacity: a block is set when at least half of it is."""
    h, w = mask.shape[0] // s, mask.shape[1] // s
    blocks = mask[: h * s, : w * s].reshape(h, s, w, s)
    return blocks.sum(axis=(1, 3)) * 2 >= s * s


def add_shadow(img: np.ndarray, shadow: np.ndarray) -> np.ndarray:
    """Paint SHADOW where the mask is set and the image is transparent; building pixels are never overwritten."""
    out = img.copy()
    out[shadow & ~_opaque(img)] = SHADOW
    return out


def build_palette(images, n: int, ink: bool = True) -> list:
    """A shared palette: median cut over the opaque pixels of every image, sampled down to at most 200,000
    pixels with a fixed seed so the result stays deterministic. Returns up to n unique colors, deduped in
    first-seen order; when ink=True, INK is appended as the last color, exactly once, always last, even if
    the median cut itself produced an INK-colored region. Requires n >= 2 with ink=True (n >= 1 otherwise).
    Raises ValueError if images is empty or none of the images has an opaque pixel."""
    if ink and n < 2:
        raise ValueError("build_palette needs n >= 2 when ink=True (there must be room for a non-ink color)")
    if not ink and n < 1:
        raise ValueError("build_palette needs n >= 1")
    if not images:
        raise ValueError("build_palette needs at least one image")
    px = np.concatenate([im[_opaque(im)][:, :3] for im in images])
    if len(px) == 0:
        raise ValueError("build_palette needs at least one opaque pixel across the images")
    if len(px) > 200_000:
        idx = np.random.default_rng(0).choice(len(px), 200_000, replace=False)
        px = px[idx]
    k = n - 1 if ink else n
    strip = Image.fromarray(np.ascontiguousarray(px.reshape(1, -1, 3)), "RGB")
    q = strip.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    colors = [tuple(int(v) for v in c) for c in np.array(q.getpalette()[: k * 3]).reshape(-1, 3)]
    seen = []
    for c in colors:
        if c not in seen and not (ink and c == INK):
            seen.append(c)
    if ink:
        seen.append(INK)
    return seen[:n]


def _nearest(rgb, palette) -> np.ndarray:
    """Nearest palette color by squared distance. Meant for 1x images: it builds an (H*W*len(palette), 3)
    int32 distance table, so don't call it on a still-4x-scale render."""
    pal = np.array(palette, np.int32)
    d = ((np.asarray(rgb, np.int32)[..., None, :] - pal) ** 2).sum(-1)
    return pal[d.argmin(-1)].astype(np.uint8)


def quantize(img: np.ndarray, palette) -> np.ndarray:
    """Snap every opaque pixel to its nearest palette color; alpha becomes 0 or 255."""
    out = np.zeros_like(img)
    opaque = _opaque(img)
    out[opaque, :3] = _nearest(img[opaque, :3], palette)
    out[opaque, 3] = 255
    return out


def outline(img: np.ndarray, ids: np.ndarray, palette) -> tuple[np.ndarray, np.ndarray]:
    """Ink on the silhouette; a darker palette tone on pixels whose right or lower neighbor has another id
    (never against a sign, and never where the ids render itself is transparent). An inner line never
    overwrites a silhouette pixel. Returns the image and the mask of every line pixel."""
    out = img.copy()
    a = _opaque(img)
    pad = np.pad(a, 1)
    edge = a & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    k = _key(ids[..., :3])
    k[~a] = -1
    k[~_opaque(ids)] = -1
    inner = np.zeros_like(a)
    for dy, dx in ((0, 1), (1, 0)):
        nb = np.full_like(k, -1)
        nb[: k.shape[0] - dy, : k.shape[1] - dx] = k[dy:, dx:]
        inner |= a & (nb >= 0) & (nb != k) & (k != SIGN_KEY) & (nb != SIGN_KEY)
    inner &= ~edge
    out[edge, :3] = INK
    if inner.any():
        out[inner, :3] = _nearest(np.rint(img[inner, :3].astype(np.float32) * EDGE_DARKEN), palette)
    return out, edge | inner
