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
