"""The pixel pass (docs/superpowers/specs/2026-09-12-blender-houses-design.md): turns a render made at
RAW_SCALE x the final size into 1x pixel art. Pure numpy and Pillow, so it runs and tests outside Blender.

A sprite arrives as a day render plus an id render in which every object face direction is one flat
color (signs share SIGN_ID; glass faces carry GLASS_BLUE in the id's blue channel). flatten() gives each id
region at most three tones of its median color, downsample() shrinks by majority color (never averaging, with
a stroke rule inside signs), quantize() snaps to the city palette, and outline() draws the ink silhouette and
darker lines where the id changes.
"""
import numpy as np
from PIL import Image

RAW_SCALE = 4
INK = (0x2B, 0x22, 0x33)       # the outline: a warm near-black
SIGN_ID = (255, 0, 255)        # id color of image-mapped signs, which keep their detail
TONES = (0.72, 1.0, 1.18)      # shade, base, and light, as multiples of a region's median color
DARK, LIGHT = 0.82, 1.14       # luminance ratios (to the median) below which a pixel is shade, above which light
EDGE_DARKEN = 0.55             # an inner line is the face's color at this brightness
# A region's median color has its spread from grey (at the same luminance) multiplied by this: a physically lit
# render comes out dusty next to the reference's small saturated palette, while greys stay grey.
SATURATION = 1.8
# Light-tone pixels that fill a square this many raw pixels wide, inside one glass region, are sheen (a sky
# reflection) rather than detail, and fall back to the base tone; thinner light marks (mullions, window rows)
# keep it. Only glass: a wide light band elsewhere (a cornice, a trim band, a lit sign) is meant. Dark patches
# stay: a cast shadow is shape.
SHEEN_PATCH = 3 * RAW_SCALE
# The id pass (scene.py) sets B = 64 + 127 * up + 32 * glass, so a glass face's blue is one of these.
GLASS_BLUE = (64 + 32, 64 + 127 + 32)
# Inside a sign a 1 px stroke at 1x is RAW_SCALE raw px wide, and often straddles two blocks, so neither block's
# majority is the stroke and it vanishes. There, a block splits its pixels into a light and a dark group; the
# group farther from the sign's field tone (the stroke) wins once it covers this share of the block and its
# luminance differs from the other group's by at least SIGN_CONTRAST (out of 255; lettering on the signs is
# 70 to 200 apart, paint wear and render noise under 30).
SIGN_STROKE_SHARE = 0.25
SIGN_CONTRAST = 48
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


def opaque(img: np.ndarray) -> np.ndarray:
    """The one opacity rule the whole pass shares: a pixel counts as opaque above half alpha."""
    return img[..., 3] > 127


def _lum(rgb):
    rgb = np.asarray(rgb, dtype=np.float32)
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def _key(rgb):
    rgb = np.asarray(rgb)
    return (rgb[..., 0].astype(np.int64) << 16) | (rgb[..., 1].astype(np.int64) << 8) | rgb[..., 2].astype(np.int64)


SIGN_KEY = int(_key(np.array(SIGN_ID)))


def is_sign(ids: np.ndarray) -> np.ndarray:
    """Where the ids render is an opaque sign."""
    return (_key(ids[..., :3]) == SIGN_KEY) & opaque(ids)


def is_glass(ids: np.ndarray) -> np.ndarray:
    """Where the ids render is a glass face (never a sign: SIGN_ID's blue is 255)."""
    return np.isin(ids[..., 2], GLASS_BLUE)


def _saturate(rgb, k: float) -> np.ndarray:
    """rgb with its distance from the grey of the same luminance scaled by k, or, where that would leave
    0..255, by the largest factor that stays inside it, so luminance and hue never shift."""
    rgb = np.asarray(rgb, dtype=np.float32)
    grey = _lum(rgb)[..., None]
    delta = rgb - grey
    with np.errstate(divide="ignore", invalid="ignore"):
        room = np.where(delta > 0, (255 - grey) / delta, np.where(delta < 0, -grey / delta, np.inf))
    push = np.minimum(k, room.min(axis=-1, keepdims=True))
    return np.clip(grey + delta * push, 0, 255)  # the clip only trims float error


def _box_sum(mask: np.ndarray, k: int) -> np.ndarray:
    """For every k x k window of mask, how many of its pixels are set, keyed by the window's top-left pixel."""
    c = np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    return c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]


def _patches(mask: np.ndarray, k: int) -> np.ndarray:
    """The pixels of mask covered by some k x k square lying wholly inside mask (a morphological opening)."""
    h, w = mask.shape
    if h < k or w < k:
        return np.zeros_like(mask)
    full = np.zeros((h + k - 1, w + k - 1), bool)  # window anchors, padded so every pixel sees k x k of them
    full[k - 1: h, k - 1: w] = _box_sum(mask, k) == k * k
    return _box_sum(full, k) > 0


def flatten(day: np.ndarray, ids: np.ndarray) -> np.ndarray:
    """Every id region becomes at most three flat tones of its median color, saturated by SATURATION; on glass,
    light patches at least SHEEN_PATCH wide take the base tone. Sign regions, and any pixel transparent in the day or
    the ids render, are left alone. Safe on an empty (0-size) image."""
    out = day.copy()
    keys = _key(ids[..., :3])
    keys[~opaque(day)] = -1
    keys[~opaque(ids)] = -1
    flat = keys.ravel()
    order = np.argsort(flat, kind="stable")
    sorted_keys = flat[order]
    groups = np.split(order, np.flatnonzero(np.diff(sorted_keys)) + 1)
    rgb = day[..., :3].reshape(-1, 3)
    lum = _lum(rgb)
    base = np.zeros((flat.size, 3), np.float32)
    tone = np.full(flat.size, -1, np.int8)  # 0 shade, 1 base, 2 light; -1 left alone
    for g in groups:
        if g.size == 0:
            continue
        k = flat[g[0]]
        if k < 0 or k == SIGN_KEY:
            continue
        median = np.median(rgb[g].astype(np.float32), axis=0)
        ratio = lum[g] / max(float(_lum(median)), 1.0)
        base[g] = _saturate(median, SATURATION)
        tone[g] = np.where(ratio < DARK, 0, np.where(ratio > LIGHT, 2, 1))
    tone = tone.reshape(keys.shape)
    # a pixel on a region's border never belongs to a patch, so no square spans two regions
    inside = np.ones(keys.shape, bool)
    inside[:-1] &= keys[:-1] == keys[1:]
    inside[1:] &= keys[1:] == keys[:-1]
    inside[:, :-1] &= keys[:, :-1] == keys[:, 1:]
    inside[:, 1:] &= keys[:, 1:] == keys[:, :-1]
    light = (tone == 2) & is_glass(ids)
    tone[light & _patches(light & inside, SHEEN_PATCH)] = 1
    tone = tone.ravel()
    done = tone >= 0
    factor = np.asarray(TONES, np.float32)[tone[done]]
    out_rgb = out[..., :3].reshape(-1, 3)
    out_rgb[done] = np.clip(np.rint(base[done] * factor[:, None]), 0, 255).astype(np.uint8)
    out[..., :3] = out_rgb.reshape(out.shape[0], out.shape[1], 3)
    return out


def downsample(img: np.ndarray, s: int = RAW_SCALE, sign: np.ndarray | None = None) -> np.ndarray:
    """Shrink by s with no blending: a block is opaque when at least half of it is, and takes the color shared
    by the most of its opaque pixels; a tie goes to the lowest packed RGB key, so it stays deterministic.
    sign (a bool mask at img's size): blocks mostly inside it follow _sign_blocks instead, so strokes survive.
    Fully vectorized: no per-block Python loop."""
    h, w = img.shape[0] // s, img.shape[1] // s
    m = s * s
    blocks = img[: h * s, : w * s].reshape(h, s, w, s, 4).transpose(0, 2, 1, 3, 4).reshape(h, w, m, 4)
    solid = opaque(blocks)
    keep = solid.sum(axis=2) * 2 >= m
    keys = np.where(solid, _key(blocks[..., :3]), -1)
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
    if sign is not None:
        sb = sign[: h * s, : w * s].reshape(h, s, w, s).transpose(0, 2, 1, 3).reshape(h, w, m) & solid
        sel = keep & (sb.sum(axis=2) * 2 > solid.sum(axis=2))
        if sel.any():
            field = _lum(np.median(img[sign & opaque(img)][:, :3].astype(np.float32), axis=0))
            out[sel, :3] = _sign_blocks(blocks[sel], solid[sel], float(field))
    return out


def _nearest_member(rgb, member) -> np.ndarray:
    """Per block (rgb (N, m, 3), member (N, m)), the member pixel nearest the members' per-channel median: a
    color the render really has, never a blend."""
    med = np.nanmedian(np.where(member[..., None], rgb, np.nan), axis=1)
    d = np.where(member, ((rgb - med[:, None]) ** 2).sum(-1), np.inf)
    return np.take_along_axis(rgb, d.argmin(axis=1)[:, None, None], axis=1)[:, 0]


def _sign_blocks(px: np.ndarray, valid: np.ndarray, field: float) -> np.ndarray:
    """The color of each sign block (px (N, m, 4), valid (N, m)): its pixels split at the middle of the block's
    luminance range into a light and a dark group. The group farther in luminance from the sign's field tone is
    the stroke; it wins when it covers SIGN_STROKE_SHARE of the block and stands SIGN_CONTRAST apart from the
    other group, and otherwise the larger group wins. Each group is shown by its _nearest_member."""
    rgb = px[..., :3].astype(np.float32)
    lum = _lum(rgb)
    lo = np.where(valid, lum, np.inf).min(axis=1, keepdims=True)
    hi = np.where(valid, lum, -np.inf).max(axis=1, keepdims=True)
    light = valid & (lum > (lo + hi) / 2)
    dark = valid & ~light
    # a flat block puts every pixel in one group; the empty group then stands for the same color
    light_c = _nearest_member(rgb, np.where(light.any(axis=1)[:, None], light, dark))
    dark_c = _nearest_member(rgb, np.where(dark.any(axis=1)[:, None], dark, light))
    ll, dl = _lum(light_c), _lum(dark_c)
    stroke_light = np.abs(ll - field) >= np.abs(dl - field)
    stroke_n = np.where(stroke_light, light.sum(axis=1), dark.sum(axis=1))
    stroke_wins = (stroke_n >= SIGN_STROKE_SHARE * px.shape[1]) & (np.abs(ll - dl) >= SIGN_CONTRAST)
    light_wins = np.where(stroke_wins, stroke_light, light.sum(axis=1) > dark.sum(axis=1))
    return np.rint(np.where(light_wins[:, None], light_c, dark_c)).astype(np.uint8)


def split_shadow(day: np.ndarray, ids: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Separate the cast shadow from the building. Every pixel the day render covers but the ids render does
    not (the ids render has no shadow catcher) is cleared to (0, 0, 0, 0), so it is never part of the building;
    the shadow mask is the part of that above SHADOW_MIN_ALPHA. Returns the cleared day render and the mask."""
    outside = (day[..., 3] > 0) & ~opaque(ids)
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
    out[shadow & ~opaque(img)] = SHADOW
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
    px = np.concatenate([im[opaque(im)][:, :3] for im in images])
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


def build_day_palette(images, signs, n: int, n_sign: int) -> list:
    """The day palette: n_sign of its n colors are cut from the sign pixels alone (signs: one bool mask per
    image), the rest from everything else, with INK last. Brand colors cover little area next to walls and
    glass, so a shared median cut spends every color on the buildings and remaps a sign's red to brown. Sign
    slots the signs do not need (fewer distinct colors than n_sign) go back to the buildings. With no sign
    pixels at all it is build_palette(images, n)."""
    if not any(m.any() for m in signs):
        return build_palette(images, n)
    rest = [np.where(m[..., None], 0, im) for im, m in zip(images, signs)]
    only = [np.where(m[..., None], im, 0) for im, m in zip(images, signs)]
    sign = build_palette(only, n_sign, ink=False)
    base = build_palette(rest, n - len(sign))
    return base[:-1] + [c for c in sign if c not in base] + [INK]


def _nearest(rgb, palette) -> np.ndarray:
    """Nearest palette color by squared distance. Meant for 1x images: it builds an (H*W*len(palette), 3)
    int32 distance table, so don't call it on a still-4x-scale render."""
    pal = np.array(palette, np.int32)
    d = ((np.asarray(rgb, np.int32)[..., None, :] - pal) ** 2).sum(-1)
    return pal[d.argmin(-1)].astype(np.uint8)


def quantize(img: np.ndarray, palette) -> np.ndarray:
    """Snap every opaque pixel to its nearest palette color; alpha becomes 0 or 255."""
    out = np.zeros_like(img)
    solid = opaque(img)
    out[solid, :3] = _nearest(img[solid, :3], palette)
    out[solid, 3] = 255
    return out


def outline(img: np.ndarray, ids: np.ndarray, palette) -> tuple[np.ndarray, np.ndarray]:
    """Ink on the silhouette; a darker palette tone on pixels whose right or lower neighbor has another id
    (never against a sign, and never where the ids render itself is transparent). An inner line never
    overwrites a silhouette pixel. Returns the image and the mask of every line pixel."""
    out = img.copy()
    a = opaque(img)
    pad = np.pad(a, 1)
    edge = a & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    k = _key(ids[..., :3])
    k[~a] = -1
    k[~opaque(ids)] = -1
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
