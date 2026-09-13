"""The pixel pass (docs/superpowers/specs/2026-09-12-blender-houses-design.md): turns a render made at
RAW_SCALE x the final size into 1x pixel art. Pure numpy and Pillow, so it runs and tests outside Blender.

A sprite arrives as a day render plus an id render in which every object face direction is one flat
color (each sign object gets sign_id(ordinal); glass faces carry GLASS_BLUE in the id's blue channel). flatten()
gives each id region at most three tones of its median color, downsample() shrinks by majority color (never
averaging, with a stroke rule inside signs), quantize() snaps to the city palette, and outline() draws the ink
silhouette and darker lines where the id changes.
"""
import numpy as np
from PIL import Image

RAW_SCALE = 4
INK = (0x2B, 0x22, 0x33)       # the outline: a warm near-black
SIGN_ID = (255, 0, 255)        # the id of a sign (sign_id(255)); signs keep their detail
# Glass tones follow the brightness of the glass around them, averaged over a window this many raw pixels wide (16
# game px, a few window cells and floors, so the pattern of glass and mullions averages out): a curved or tall glass
# face reflects a smooth sky gradient, and against one median that gradient crosses DARK partway down and breaks
# into shade patches. Walls keep one median, so a cast shadow on them stays shape.
GLASS_SPAN = 16 * RAW_SCALE
# A sign palette color stands for the most common color among its pixels, binned this finely (out of 255), rather
# than their average: the average of a brand color and its anti-aliased blends is a dull in-between (gold on red
# averages to tan), which every stroke then snaps to.
SNAP_BIN = 8
# Snapped colors closer than this (RGB distance) are one color: a large area (lit shop glass) splits into several
# median-cut boxes that all snap to the same color, and without merging them it crowds small brand colors out.
SNAP_MERGE = 24
# A sign pixel farther than this (RGB distance) from every palette color comes out as a different color, not a
# near shade of its own (pixelize.py warns when too many do).
SIGN_MISS = 40
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
# Glass lit by day (a shop interior glowing through its window) adds 16: its warm glow covers little area, so like a
# sign's colors it gets reserved palette colors, which a shared median cut would merge into the cream roofs.
LIT_BLUE = (64 + 32 + 16, 64 + 127 + 32 + 16)
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


def sign_id(k: int) -> tuple:
    """The id color of the sign object with ordinal k (0..255): R 255 and G 0 mark a sign, since no other object's G
    is ever 0 (scene.py), and B tells the sprite's signs apart."""
    return (255, 0, k)


def is_sign(ids: np.ndarray) -> np.ndarray:
    """Where the ids render is an opaque sign."""
    return (ids[..., 0] == 255) & (ids[..., 1] == 0) & opaque(ids)


def sign_labels(ids: np.ndarray) -> np.ndarray:
    """Per pixel, 0 off signs, else 1 + the sign object's ordinal, so each sign is judged against its own field."""
    return np.where(is_sign(ids), ids[..., 2].astype(np.int32) + 1, 0)


def is_glass(ids: np.ndarray) -> np.ndarray:
    """Where the ids render is a glass face, lit or not (never a sign, whose G is 0)."""
    return np.isin(ids[..., 2], GLASS_BLUE + LIT_BLUE) & (ids[..., 1] != 0)


def is_lit(ids: np.ndarray) -> np.ndarray:
    """Where the ids render is glass lit by day."""
    return np.isin(ids[..., 2], LIT_BLUE) & (ids[..., 1] != 0)


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


def _window_mean(values: np.ndarray, mask: np.ndarray, k: int) -> np.ndarray:
    """Per pixel, the mean of values over the mask's pixels in the k x k window centered on it (0 where it has none)."""
    r = k // 2
    pad = ((r, k - 1 - r), (r, k - 1 - r))

    def sums(a):
        c = np.pad(np.pad(a, pad).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
        return c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]

    return sums(np.where(mask, values, 0.0)) / np.maximum(sums(mask.astype(np.float64)), 1.0)


def _glass_gain(lum: np.ndarray, g: np.ndarray, width: int) -> np.ndarray:
    """Per pixel of one glass region (lum per pixel, g its flat indices in an image width wide), how much brighter
    the glass around it is than the region on average: its mean over GLASS_SPAN, which follows a reflection gradient
    but not the pattern of glass and mullions, over the region's whole mean. Smooth, so it never leaves a seam."""
    ys, xs = g // width, g % width
    y0, x0 = ys.min(), xs.min()
    mask = np.zeros((ys.max() - y0 + 1, xs.max() - x0 + 1), bool)
    vals = np.zeros(mask.shape)
    mask[ys - y0, xs - x0] = True
    vals[ys - y0, xs - x0] = lum
    local = _window_mean(vals, mask, GLASS_SPAN)[ys - y0, xs - x0]
    return np.maximum(local / max(float(lum.mean()), 1.0), 1e-3)


def flatten(day: np.ndarray, ids: np.ndarray) -> np.ndarray:
    """Every id region becomes at most three flat tones of its median color, saturated by SATURATION. A pixel's tone
    comes from its luminance against the region's median, on glass scaled by how bright the glass around it is
    (_glass_gain); on
    glass, light patches at least SHEEN_PATCH wide take the base tone. Signs, and any pixel transparent in the day or
    the ids render, are left alone. Safe on an empty (0-size) image."""
    out = day.copy()
    keys = _key(ids[..., :3])
    keys[~opaque(day)] = -1
    keys[~opaque(ids)] = -1
    keys[is_sign(ids)] = -1
    glass = is_glass(ids).ravel()
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
        if flat[g[0]] < 0:
            continue
        median = np.median(rgb[g].astype(np.float32), axis=0)
        ref = max(float(_lum(median)), 1.0)
        ratio = lum[g] / (ref * _glass_gain(lum[g], g, keys.shape[1]) if glass[g[0]] else ref)
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
    sign (at img's size: sign_labels, or a bool mask for one sign): blocks mostly inside a sign follow _sign_blocks
    instead, so strokes survive, each judged against the field tone of the sign most of its pixels belong to.
    Vectorized over blocks: the only Python loop is over the sprite's few signs."""
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
        labels = np.asarray(sign).astype(np.int32)
        lb = labels[: h * s, : w * s].reshape(h, s, w, s).transpose(0, 2, 1, 3).reshape(h, w, m)
        sb = (lb > 0) & solid
        sel = keep & (sb.sum(axis=2) * 2 > solid.sum(axis=2))
        if sel.any():
            out[sel, :3] = _sign_blocks(blocks[sel], solid[sel], _block_fields(img, labels, lb[sel], sb[sel]))
    return out


def _block_fields(img: np.ndarray, labels: np.ndarray, lb: np.ndarray, member: np.ndarray) -> np.ndarray:
    """Per sign block (lb: its pixels' labels (N, m), member: which are opaque sign pixels), the field tone of the
    sign most of its pixels belong to: the luminance of that sign's median color over the whole image."""
    solid = opaque(img)
    names = np.unique(lb[member])
    counts = np.stack([((lb == n) & member).sum(axis=1) for n in names], axis=1)
    fields = np.array([_lum(np.median(img[(labels == n) & solid][:, :3].astype(np.float32), axis=0)) for n in names])
    return fields[counts.argmax(axis=1)]


def _nearest_member(rgb, member) -> np.ndarray:
    """Per block (rgb (N, m, 3), member (N, m)), the member pixel nearest the members' per-channel median: a
    color the render really has, never a blend."""
    med = np.nanmedian(np.where(member[..., None], rgb, np.nan), axis=1)
    d = np.where(member, ((rgb - med[:, None]) ** 2).sum(-1), np.inf)
    return np.take_along_axis(rgb, d.argmin(axis=1)[:, None, None], axis=1)[:, 0]


def _sign_blocks(px: np.ndarray, valid: np.ndarray, field) -> np.ndarray:
    """The color of each sign block (px (N, m, 4), valid (N, m)): its pixels split at the middle of the block's
    luminance range into a light and a dark group. The group farther in luminance from its sign's field tone (field:
    one per block, or one for all) is
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


def _dominant(px: np.ndarray) -> tuple:
    """The most common color among px (N, 3), binned by SNAP_BIN: the median of the most populous bin's pixels."""
    bins = _key(px // SNAP_BIN)
    names, counts = np.unique(bins, return_counts=True)
    top = names[counts.argmax()]
    return tuple(int(v) for v in np.rint(np.median(px[bins == top].astype(np.float32), axis=0)))


def _snapped(px: np.ndarray, strip: Image.Image, n: int) -> list:
    """Up to n _dominant colors of px (strip: the same pixels as a Pillow image), most populous first, no two within
    SNAP_MERGE: a median cut into more and more boxes (up to 4 n) until n distinct colors come out."""
    kept = []
    for boxes in range(n, min(4 * n, 256) + 1):
        which = np.asarray(strip.quantize(colors=boxes, method=Image.Quantize.MEDIANCUT)).ravel()
        found = [(int((which == i).sum()), _dominant(px[which == i])) for i in range(boxes) if (which == i).any()]
        kept = []
        for _, c in sorted(found, key=lambda f: -f[0]):
            if all(sum((a - b) ** 2 for a, b in zip(c, k)) >= SNAP_MERGE ** 2 for k in kept):
                kept.append(c)
        if len(kept) >= n or len(found) < boxes:  # enough colors, or the pixels have no more to give
            break
    return kept[:n]


def build_palette(images, n: int, ink: bool = True, snap: bool = False) -> list:
    """A shared palette: median cut over the opaque pixels of every image, sampled down to at most 200,000
    pixels with a fixed seed so the result stays deterministic. Returns up to n unique colors, deduped in
    first-seen order; when ink=True, INK is appended as the last color, exactly once, always last, even if
    the median cut itself produced an INK-colored region. snap: each color is the _dominant color of the pixels
    it stands for rather than their average, and no two are within SNAP_MERGE (_snapped). Requires n >= 2 with
    ink=True (n >= 1 otherwise).
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
    if snap:
        colors = _snapped(px, strip, k)
    else:
        q = strip.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
        colors = [tuple(int(v) for v in c) for c in np.array(q.getpalette()[: k * 3]).reshape(-1, 3)]
    seen = []
    for c in colors:
        if c not in seen and not (ink and c == INK):
            seen.append(c)
    if ink:
        seen.append(INK)
    return seen[:n]


# Three reserved green tones cover sunlit lawn, shaded grass, and darker hedges.
# This is a color-family heuristic: the face IDs do not identify material semantics.
VEGETATION_COLORS = 3
VEGETATION_GREEN_MARGIN = 12


def build_day_palette(images, signs, n: int, n_sign: int) -> list:
    """Allocate sign and vegetation colors before the area-weighted building palette.

    Sign masks include lit shop glass and take priority over green surface detection.
    Up to VEGETATION_COLORS green-dominant, opaque, non-sign colors survive even when
    lawns cover very little of a tower-heavy city's pixels. Reserved colors snap to
    actual source shades; unused slots return to buildings. INK is unique and last,
    and every reservation comes out of n, never on top of it.
    """
    if n < 2 or n_sign < 0:
        raise ValueError("day palette needs n >= 2 and n_sign >= 0")
    if len(images) != len(signs):
        raise ValueError("each day image needs a sign mask")
    sign_masks = [m & opaque(im) for im, m in zip(images, signs)]
    green_masks = []
    for im, sign in zip(images, sign_masks):
        rgb = im[..., :3].astype(np.int16)
        green_masks.append(opaque(im) & ~sign &
                           (rgb[..., 1] > np.maximum(rgb[..., 0], rgb[..., 2]) + VEGETATION_GREEN_MARGIN))
    if not any(m.any() for m in sign_masks + green_masks):
        return build_palette(images, n)
    sign_slots = min(n_sign, n - 2)  # retain room for a building color and ink
    sign_colors = []
    if sign_slots and any(m.any() for m in sign_masks):
        only = [np.where(m[..., None], im, 0) for im, m in zip(images, sign_masks)]
        sign_colors = build_palette(only, sign_slots, ink=False, snap=True)
    green_slots = min(VEGETATION_COLORS, n - len(sign_colors) - 2)
    green_colors = []
    if green_slots and any(m.any() for m in green_masks):
        only = [np.where(m[..., None], im, 0) for im, m in zip(images, green_masks)]
        green_colors = build_palette(only, green_slots, ink=False, snap=True)
    reserved = list(dict.fromkeys(c for c in sign_colors + green_colors if c != INK))
    # Only remove families whose colors were actually reserved (small budgets may skip one).
    rest = [np.where(((sm if sign_colors else False) | (gm if green_colors else False))[..., None], 0, im)
            for im, sm, gm in zip(images, sign_masks, green_masks)] if reserved else images
    base = build_palette(rest, n - len(reserved)) if any(opaque(im).any() for im in rest) else [INK]
    return base[:-1] + [c for c in reserved if c not in base] + [INK]


def sign_misfit(images, signs, palette) -> float:
    """The share of sign pixels (signs: one bool mask per image) farther than SIGN_MISS from every palette color;
    0 with no sign pixels."""
    px = np.concatenate([im[opaque(im) & m][:, :3] for im, m in zip(images, signs)]).astype(np.int32)
    if len(px) == 0:
        return 0.0
    pal = np.array(palette, np.int32)
    d = ((px[:, None, :] - pal[None]) ** 2).sum(-1).min(axis=1)
    return float((d > SIGN_MISS * SIGN_MISS).mean())


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
    SIGN = -2  # any sign, whichever object: no line runs against one
    k = _key(ids[..., :3])
    k[~a] = -1
    k[~opaque(ids)] = -1
    k[is_sign(ids)] = SIGN
    inner = np.zeros_like(a)
    for dy, dx in ((0, 1), (1, 0)):
        nb = np.full_like(k, -1)
        nb[: k.shape[0] - dy, : k.shape[1] - dx] = k[dy:, dx:]
        inner |= a & (nb >= 0) & (nb != k) & (k != SIGN)
    inner &= ~edge
    out[edge, :3] = INK
    if inner.any():
        out[inner, :3] = _nearest(np.rint(img[inner, :3].astype(np.float32) * EDGE_DARKEN), palette)
    return out, edge | inner
