"""Sign and ad artwork for Larp City buildings, drawn with Pillow into art/ads/.

Blender maps each PNG onto a sign face with exactly the image's aspect ratio, so every
element has to sit inside a safe area. Each image is drawn at SS x resolution into
per-element masks, composited, and downscaled with LANCZOS. Every draw call records its
bounding box, and Sign.finish() raises if anything leaves the safe rect.

Run from game/:  python3 art/make_ads.py
"""
import json
import math
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / "ads"
SS = 4  # supersampling factor


# ---------------------------------------------------------------- fonts

def font_spec(*candidates):
    """First existing (path, index) candidate."""
    for path, index in candidates:
        if Path(path).exists():
            return (path, index)
    raise FileNotFoundError(f"no font found among {candidates}")


# Pixel art (docs/superpowers/specs/2026-09-12-blender-houses-design.md): every sign is lettered in the game's own
# bold Pixelify Sans (game/public/fonts, glyphs fixed for small sizes), so text survives the sprite pixel pass as
# crisp pixels and matches the UI. The names below stay so call sites read the same as when each sign carried its
# own system font.
PIXEL = font_spec((str(Path(__file__).resolve().parents[1] / "public" / "fonts" / "pixelify-sans-bold.ttf"), 0))
ARIAL = ARIAL_BOLD = ARIAL_BLACK = HELV_BOLD = GEORGIA = GEORGIA_BOLD = SCRIPT = FUTURA = ROUNDED = ROUNDED_BOLD = PIXEL


@lru_cache(maxsize=4096)
def load(spec, size):
    path, index = spec
    return ImageFont.truetype(path, size, index=index)


def fit_text(draw, text, font_path, box, max_size=10_000, align="left", valign="center",
             stroke=0.0, spacing=0.12):
    """Largest font (<= max_size) whose rendered bbox fits box. Returns (font, xy).

    stroke and spacing are fractions of the font size; the bbox includes both, plus
    ascenders and descenders, exactly as draw.textbbox reports them.
    """
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0

    def measure(size):
        f = load(font_path, size)
        return f, draw.textbbox((0, 0), text, font=f, spacing=round(size * spacing),
                                stroke_width=round(size * stroke), align=align)

    lo, hi, best = 1, int(max_size), None
    while lo <= hi:
        mid = (lo + hi) // 2
        _, (l, t, r, b) = measure(mid)
        if r - l <= bw and b - t <= bh:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    if best is None:
        raise ValueError(f"{text!r} cannot fit {box}")
    f, (l, t, r, b) = measure(best)
    dx = {"left": 0, "center": (bw - (r - l)) / 2, "right": bw - (r - l)}[align]
    dy = {"top": 0, "center": (bh - (b - t)) / 2, "bottom": bh - (b - t)}[valign]
    return f, (x0 - l + dx, y0 - t + dy)


def rgba(color, alpha=255):
    return ImageColor.getrgb(color)[:3] + (alpha,)


def hgradient(size, stops):
    """Horizontal multi-stop gradient image (RGB)."""
    w, h = size
    cols = [ImageColor.getrgb(c) for c in stops]
    row = Image.new("RGB", (w, 1))
    for x in range(w):
        t = x / max(w - 1, 1) * (len(cols) - 1)
        i = min(int(t), len(cols) - 2)
        f = t - i
        row.putpixel((x, 0), tuple(round(a + (b - a) * f) for a, b in zip(cols[i], cols[i + 1])))
    return row.resize((w, h))


# ---------------------------------------------------------------- drawing

class Pen:
    """Draws 0-255 coverage into an L mask using final-pixel coordinates."""

    def __init__(self, size):
        self.m = Image.new("L", size, 0)
        self.d = ImageDraw.Draw(self.m)

    @staticmethod
    def _pts(pts):
        return [(x * SS, y * SS) for x, y in pts]

    @staticmethod
    def _box(box):
        """Pillow boxes are inclusive, so the far edge stops one supersampled pixel short."""
        x0, y0, x1, y1 = box
        return [x0 * SS, y0 * SS, x1 * SS - 1, y1 * SS - 1]

    def rect(self, box, v=255, r=0):
        self.d.rounded_rectangle(self._box(box), radius=r * SS, fill=v)

    def ellipse(self, box, v=255):
        self.d.ellipse(self._box(box), fill=v)

    def ring(self, box, width, v=255):
        self.d.ellipse(self._box(box), outline=v, width=round(width * SS))

    def arc(self, box, start, end, width, v=255):
        self.d.arc(self._box(box), start, end, fill=v, width=round(width * SS))

    def polygon(self, pts, v=255):
        self.d.polygon(self._pts(pts), fill=v)

    def line(self, pts, width, v=255, caps=True):
        self.d.line(self._pts(pts), fill=v, width=round(width * SS), joint="curve")
        if caps:
            for x, y in (pts[0], pts[-1]):
                self.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), v)


class Placed:
    """A fitted text element: font and xy in supersampled units."""

    def __init__(self, text, font, xy, spacing, stroke, align):
        self.text, self.font, self.xy = text, font, xy
        self.spacing, self.stroke, self.align = spacing, stroke, align

    def kw(self, with_stroke):
        return dict(font=self.font, spacing=self.spacing, align=self.align,
                    stroke_width=self.stroke if with_stroke else 0)


class Sign:
    outputs = []  # (name, path)
    caps_by_name = {}  # name: the wordmark's (largest text's) capital height / image height, for ads/_caps.json

    def __init__(self, name, w, h, bg):
        self.name, self.w, self.h, self.bg = name, w, h, bg
        self.transparent = bg is None
        self.flat = not self.transparent  # solid background: enables the pixel check
        self.inset = 0.04 if self.transparent else 0.06
        self.im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0) if bg is None else rgba(bg))
        self.scratch = ImageDraw.Draw(Image.new("L", (1, 1)))
        self.boxes = []
        self.caps = []  # each text's capital height as a share of the image height (the readability test)

    @property
    def safe(self):
        i = self.inset
        return (self.w * i, self.h * i, self.w * (1 - i), self.h * (1 - i))

    def track(self, label, ss_box):
        self.boxes.append((label, tuple(c / SS for c in ss_box)))

    def background(self, image):
        self.im.paste(image.resize(self.im.size).convert("RGBA"), (0, 0))
        self.flat = False

    def composite(self, mask, fill, label):
        bb = mask.getbbox()
        if not bb:
            return
        if isinstance(fill, Image.Image):
            layer = fill.resize(self.im.size).convert("RGBA")
        else:
            layer = Image.new("RGBA", self.im.size, rgba(fill))
        layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
        self.im.alpha_composite(layer)
        self.track(label, bb)

    @contextmanager
    def paint(self, fill, label):
        pen = Pen(self.im.size)
        yield pen
        self.composite(pen.m, fill, label)

    # -- text

    def fit(self, text, font, box, max_size=10_000, align="left", valign="center",
            stroke=0.0, spacing=0.12):
        f, xy = fit_text(self.scratch, text, font, [c * SS for c in box], max_size * SS,
                         align, valign, stroke, spacing)
        return Placed(text, f, xy, round(f.size * spacing), round(f.size * stroke), align)

    def bbox(self, pl, with_stroke=False, offset=(0, 0)):
        x, y = pl.xy[0] + offset[0] * SS, pl.xy[1] + offset[1] * SS
        bb = self.scratch.textbbox((x, y), pl.text, **pl.kw(with_stroke))
        return tuple(c / SS for c in bb)

    def draw_text(self, pl, fill, stroke_fill=None, offset=(0, 0)):
        """Paint a Placed text. fill is a color, or one color per character (single line)."""
        x, y = pl.xy[0] + offset[0] * SS, pl.xy[1] + offset[1] * SS
        _, top, _, bottom = pl.font.getbbox("H")
        self.caps.append((bottom - top) / (self.h * SS))
        if stroke_fill and pl.stroke:
            with self.paint(stroke_fill, pl.text + " (stroke)") as p:
                p.d.text((x, y), pl.text, fill=255, stroke_fill=255, **pl.kw(True))
        if isinstance(fill, (list, tuple)):
            assert len(fill) == len(pl.text) and "\n" not in pl.text
            for color in dict.fromkeys(fill):
                with self.paint(color, pl.text) as p:
                    for i, ch in enumerate(pl.text):
                        if fill[i] == color:
                            dx = self.scratch.textlength(pl.text[:i], font=pl.font)
                            p.d.text((x + dx, y), ch, fill=255, font=pl.font)
        else:
            with self.paint(fill, pl.text) as p:
                p.d.text((x, y), pl.text, fill=255, **pl.kw(False))
        return self.bbox(pl, bool(stroke_fill), offset)

    def text(self, text, font, box, fill, max_size=10_000, **kw):
        return self.draw_text(self.fit(text, font, box, max_size, **kw), fill)

    # -- finishing

    def weather(self, lo, hi):
        """Fade paint evenly to the middle of lo..hi. Pixel art has no soft wear patches or grain,
        which the pixel pass would turn into speckles."""
        mid = (lo + hi) / 2
        self.im.putalpha(self.im.getchannel("A").point(lambda v: round(v * mid)))

    def finish(self):
        sx0, sy0, sx1, sy1 = self.safe
        tol = 0.01
        for label, (x0, y0, x1, y1) in self.boxes:
            if x0 < sx0 - tol or y0 < sy0 - tol or x1 > sx1 + tol or y1 > sy1 + tol:
                raise ValueError(f"{self.name}: {label!r} bbox {tuple(round(c, 1) for c in (x0, y0, x1, y1))}"
                                 f" leaves safe rect {tuple(round(c, 1) for c in self.safe)}")
        ss_safe = tuple(round(c * SS) for c in self.safe)
        if self.transparent:
            bb = self.im.getchannel("A").getbbox()
            if bb and (bb[0] < ss_safe[0] or bb[1] < ss_safe[1] or bb[2] > ss_safe[2] or bb[3] > ss_safe[3]):
                raise ValueError(f"{self.name}: alpha bbox {[c / SS for c in bb]} leaves safe rect")
        elif self.flat:
            diff = ImageChops.difference(self.im.convert("RGB"), Image.new("RGB", self.im.size, rgba(self.bg)[:3]))
            diff.paste((0, 0, 0), ss_safe)
            if diff.getbbox():
                raise ValueError(f"{self.name}: pixels drawn outside safe rect at {[c / SS for c in diff.getbbox()]}")
        out = self.im.resize((self.w, self.h), Image.LANCZOS)
        if not self.transparent:
            out = out.convert("RGB")
        path = OUT / f"{self.name}.png"
        out.save(path)
        Sign.outputs.append((self.name, path))
        if self.caps:
            Sign.caps_by_name[self.name] = max(self.caps)
        print(f"ok {self.name} {self.w}x{self.h}")


# ---------------------------------------------------------------- logo marks
# Each mark draws inside box = (x0, y0, x1, y1) in final pixels.

def mark_elevenlabs(s, box, color):
    x0, y0, x1, y1 = box
    bar = (x1 - x0) * 0.36
    with s.paint(color, "II") as p:
        p.rect((x0, y0, x0 + bar, y1))
        p.rect((x1 - bar, y0, x1, y1))


ELEVEN_ASPECT = 0.56


def mark_persona(s, box, color):
    """Rounded six-point asterisk above an underline bar."""
    x0, y0, x1, y1 = box
    h = y1 - y0
    w = 0.18 * h  # stroke width
    r = 0.38 * h - w / 2  # arm length to cap centre
    cx, cy = (x0 + x1) / 2, y0 + 0.38 * h
    with s.paint(color, "persona mark") as p:
        for deg in (90, 30, 150):
            dx, dy = r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg))
            p.line([(cx - dx, cy - dy), (cx + dx, cy + dy)], w)
        p.rect((x0, y1 - 0.13 * h, x1, y1), r=0.065 * h)


PERSONA_ASPECT = 2 * (0.866 * (0.38 - 0.09) + 0.09) + 0.02  # small margin for stroke rounding


def mark_nord(s, box, circle, peak):
    x0, y0, x1, y1 = box
    r = (x1 - x0) / 2
    cx, cy = x0 + r, y0 + r
    ridge = [(-0.62, 0.42), (-0.02, -0.56), (0.62, 0.42), (0.36, 0.42), (0.1, -0.02),
             (-0.04, 0.2), (-0.16, 0.06), (-0.38, 0.42)]
    with s.paint(circle, "nord circle") as p:
        p.ellipse(box)
    with s.paint(peak, "nord peak") as p:
        p.polygon([(cx + u * r * 0.92, cy + v * r * 0.92) for u, v in ridge])


def heart_points(box, n=240):
    """Classic parametric heart scaled to fill box."""
    raw = [(16 * math.sin(t) ** 3,
            -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)))
           for t in (2 * math.pi * i / n for i in range(n))]
    xs, ys = [p[0] for p in raw], [p[1] for p in raw]
    x0, y0, x1, y1 = box
    sx, sy = (x1 - x0) / (max(xs) - min(xs)), (y1 - y0) / (max(ys) - min(ys))
    return [(x0 + (x - min(xs)) * sx, y0 + (y - min(ys)) * sy) for x, y in raw]


HEART_ASPECT = 32 / 29.1


def mark_heart(s, box, fill):
    with s.paint(fill, "heart") as p:
        p.polygon(heart_points(box))


def mark_meta(s, box, color):
    """Infinity loop: a stretched lemniscate stroked thick."""
    x0, y0, x1, y1 = box
    sw = (y1 - y0) * 0.24
    ax, ay = (x1 - x0 - sw) / 2, (y1 - y0 - sw) / 2 / 0.3536
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    pts = []
    for i in range(361):
        t = 2 * math.pi * i / 360
        d = 1 + math.sin(t) ** 2
        pts.append((cx + ax * math.cos(t) / d, cy + ay * math.sin(t) * math.cos(t) / d))
    with s.paint(color, "meta loop") as p:
        p.line(pts, sw, caps=False)


META_ASPECT = 1.75


def swoosh(s, box, color="#D22E1E"):
    """Capital One arch: crescent between two stacked ellipses, cut level at its tips."""
    x0, y0, x1, y1 = box
    k = 0.34  # crown thickness as a fraction of the arch radius
    R = (y1 - y0) / (1 + k / 2)
    t = k * R
    with s.paint(color, "swoosh") as p:
        p.ellipse((x0, y0, x1, y0 + 2 * R))
        p.ellipse((x0, y0 + t, x1, y0 + t + 2 * R), 0)
        p.rect((x0 - 1, y1, x1 + 1, y0 + 3 * R), 0)


def capital_one_lockup(s, box, color="white", word="Capital One", align="right"):
    """Serif wordmark with the red swoosh arcing above it."""
    x0, y0, x1, y1 = box
    h = y1 - y0
    pl = s.fit(word, GEORGIA_BOLD, (x0, y0 + 0.38 * h, x1, y1), align=align, valign="bottom")
    tx0, ty0, tx1, _ = s.bbox(pl)
    s.draw_text(pl, color)
    swoosh(s, (tx0 + 0.05 * (tx1 - tx0), y0, tx1 - 0.05 * (tx1 - tx0), ty0 - 0.06 * h))


def wells_stagecoach(s, box, color, bg):
    """Gold stagecoach silhouette on a 200x100 design grid, horses galloping left."""
    x0, y0, x1, y1 = box
    k = min((x1 - x0) / 200, (y1 - y0) / 100)
    ox, oy = x0 + ((x1 - x0) - 200 * k) / 2, y0 + ((y1 - y0) - 100 * k) / 2

    def P(x, y):
        return (ox + x * k, oy + y * k)

    def B(a, b, c, d):
        return (*P(a, b), *P(c, d))

    def horse(pen, dx, dy, v=255):
        def H(x, y):
            return P(x + dx, y + dy)
        pen.ellipse((*H(16, 16), *H(52, 33)), v)
        pen.polygon([H(22, 19), H(13, 3), H(9, 1), H(1, 7), H(1, 11), H(5, 12), H(11, 10), H(20, 28)], v)
        pen.polygon([H(11, 3), H(13, -3), H(15, 3)], v)
        for leg in ([(21, 29), (10, 37), (3, 35)], [(25, 30), (17, 42), (12, 47)],
                    [(46, 29), (55, 38), (62, 39)], [(43, 30), (48, 43), (54, 48)]):
            pen.line([H(*q) for q in leg], 3.6 * k, v)
        pen.line([H(51, 19), H(58, 18), H(62, 27)], 3.2 * k, v)

    with s.paint(color, "stagecoach") as p:
        # coach body, roof rail, driver box and draw pole
        p.rect(B(108, 20, 176, 62), r=5 * k)
        p.rect(B(112, 12, 172, 17))
        p.rect(B(96, 32, 110, 38))
        p.rect(B(98, 38, 104, 54))
        p.line([P(96, 60), P(60, 56)], 3 * k)
        # windows and door panel cut back to the sign colour
        p.rect(B(116, 27, 138, 44), 0, r=2 * k)
        p.rect(B(146, 27, 168, 44), 0, r=2 * k)
        # wheels: ring, hub, spokes
        for cx, cy, r in ((160, 78, 18), (118, 81, 14)):
            p.ellipse(B(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2), 0)
            p.ring(B(cx - r, cy - r, cx + r, cy + r), 4.5 * k)
            p.ellipse(B(cx - 4, cy - 4, cx + 4, cy + 4))
            for a in range(0, 180, 45):
                dx, dy = r * math.cos(math.radians(a)), r * math.sin(math.radians(a))
                p.line([P(cx - dx, cy - dy), P(cx + dx, cy + dy)], 2 * k, caps=False)
        horse(p, 38, 18)
    # the lead horse gets a thin gap in the sign colour so the pair reads as two animals
    lead = Pen(s.im.size)
    horse(lead, 8, 30)
    s.composite(lead.m.filter(ImageFilter.MaxFilter(2 * round(2.2 * k * SS) + 1)), bg, "horse gap")
    s.composite(lead.m, color, "lead horse")


def neon_cone(s, box, color="white"):
    """Ice-cream cone outline with a soft neon glow, drawn in a 300x450 design grid."""
    x0, y0, x1, y1 = box
    k = min((x1 - x0) / 220, (y1 - y0) / 330)
    ox, oy = (x0 + x1) / 2 - 110 * k, (y0 + y1) / 2 - 165 * k

    def P(x, y):
        return (ox + x * k, oy + y * k)

    def B(a, b, c, d):
        return (*P(a, b), *P(c, d))

    w = 8 * k
    pen = Pen(s.im.size)
    # scoop: arc over the top, then a scalloped rim of four bumps
    r = 82
    cx, cy = 110, 92
    a0 = 162
    pen.arc(B(cx - r, cy - r, cx + r, cy + r), a0, 360 + 180 - a0, w)
    ex = r * math.cos(math.radians(180 - a0))
    rim_y = cy + r * math.sin(math.radians(180 - a0))
    bump = 2 * ex / 4
    for i in range(4):
        bx = cx - ex + i * bump
        pen.arc(B(bx, rim_y - bump / 2, bx + bump, rim_y + bump / 2), 0, 180, w)
    # cone and waffle lines
    tl, tr, tip = (56, 142), (164, 142), (110, 318)
    pen.line([P(*tl), P(*tr), P(*tip), P(*tl)], w)
    for f in (0.33, 0.66):
        a = (tl[0] + (tr[0] - tl[0]) * f, tl[1])
        # line parallel to the right edge from a to the left edge, and mirrored
        pen.line([P(*a), P(tl[0] + (tip[0] - tl[0]) * f, tl[1] + (tip[1] - tl[1]) * f)], w * 0.7)
        b = (tr[0] - (tr[0] - tl[0]) * f, tl[1])
        pen.line([P(*b), P(tr[0] + (tip[0] - tr[0]) * f, tr[1] + (tip[1] - tr[1]) * f)], w * 0.7)
    glow = pen.m.filter(ImageFilter.GaussianBlur(5 * k * SS)).point(lambda v: 0 if v < 4 else min(255, v * 2))
    s.composite(glow.point(lambda v: v * 55 // 100), "#FFE3C8", "neon glow")
    s.composite(pen.m, color, "neon tube")


def lockup(s, box, mark, aspect, word, font, color, mark_h=1.0, text_h=0.62, gap=0.3, align="right"):
    """Mark followed by a wordmark, vertically centred together, inside box."""
    x0, y0, x1, y1 = box
    H = y1 - y0
    mw, g = aspect * mark_h * H, gap * H
    ty0, ty1 = y0 + H * (1 - text_h) / 2, y1 - H * (1 - text_h) / 2
    # if the word is width-bound (shorter than text_h), shrink mark and gap to match it,
    # then refit the word into the freed width; a few passes converge
    base_mh, base_mw, base_g = mark_h, mw, g
    for _ in range(4):
        tb = s.bbox(s.fit(word, font, (x0, ty0, x1 - mw - g, ty1)))
        shrink = min(1.0, (tb[3] - tb[1]) / (ty1 - ty0))
        mark_h, mw, g = base_mh * shrink, base_mw * shrink, base_g * shrink
    tb = s.bbox(s.fit(word, font, (x0, ty0, x1 - mw - g, ty1)))
    total = mw + g + (tb[2] - tb[0])
    sx = {"left": x0, "center": x0 + (x1 - x0 - total) / 2, "right": x1 - total}[align]
    cy = (y0 + y1) / 2
    mark(s, (sx, cy - mark_h * H / 2, sx + mw, cy + mark_h * H / 2))
    s.text(word, font, (sx + mw + g, ty0, sx + total + 0.5, ty1), color)


def logo_elevenlabs(color):
    return lambda s, box, align="right": lockup(
        s, box, lambda s_, b: mark_elevenlabs(s_, b, color), ELEVEN_ASPECT, "ElevenLabs",
        HELV_BOLD, color, mark_h=0.62, gap=0.22, align=align)


def logo_persona(mark_color, word_color):
    return lambda s, box, align="right": lockup(
        s, box, lambda s_, b: mark_persona(s_, b, mark_color), PERSONA_ASPECT, "persona",
        HELV_BOLD, word_color, mark_h=1.0, text_h=0.66, gap=0.24, align=align)


def logo_nord(circle, peak, word):
    return lambda s, box, align="right": lockup(
        s, box, lambda s_, b: mark_nord(s_, b, circle, peak), 1.0, "NordVPN",
        HELV_BOLD, word, mark_h=1.0, text_h=0.56, gap=0.24, align=align)


def logo_lovable(heart, word):
    return lambda s, box, align="right": lockup(
        s, box, lambda s_, b: mark_heart(s_, b, heart), HEART_ASPECT, "Lovable",
        HELV_BOLD, word, mark_h=0.86, text_h=0.66, gap=0.24, align=align)


def logo_meta(align="center"):
    return lambda s, box: lockup(
        s, box, lambda s_, b: mark_meta(s_, b, "#0866FF"), META_ASPECT, "Meta",
        HELV_BOLD, "#1C2B33", mark_h=0.62, text_h=0.62, gap=0.22, align=align)


def wordmark(word, font, color, text_h=0.7):
    def draw(s, box, align="right"):
        x0, y0, x1, y1 = box
        H = y1 - y0
        s.text(word, font, (x0, y0 + H * (1 - text_h) / 2, x1, y1 - H * (1 - text_h) / 2), color, align=align)
    return draw


GOOGLE_COLORS = ["#4285F4", "#EA4335", "#FBBC05", "#4285F4", "#34A853", "#EA4335"]


# ---------------------------------------------------------------- layouts

# Rooftop bulletins and freeway boards carry the brand's own mark and wordmark only, filling almost the whole
# safe area (docs/superpowers/specs/2026-09-12-blender-houses-design.md, "Look check": a tagline shares the box
# with the mark and shrinks both to specks at 1x, where a lot's board is often half a tile wide). BB_ASPECT is
# the art's width / height and must match signs.py's BULLETIN (1 / BULLETIN), so the image tiles the board with
# no letterboxing.
BB_ASPECT = 2.0
BB_W, BB_H = 1200, round(1200 / BB_ASPECT)


def billboard(name, bg, logo, align="center"):
    s = Sign(name, BB_W, BB_H, bg)
    logo(s, s.safe, align=align)
    s.finish()
    return s


def stacked(mark, aspect, word, font, color, mark_frac=0.5, gap_frac=0.05):
    """Mark centered above a wordmark, both sized to the box's width: for a tall panel (a shelter), where
    lockup's side-by-side layout would starve the word of width and shrink everything to fit."""
    def draw(s, box, align="center"):
        x0, y0, x1, y1 = box
        h = y1 - y0
        mh = h * mark_frac
        mw = mh * aspect
        mx0 = x0 + ((x1 - x0) - mw) / 2
        mark(s, (mx0, y0, mx0 + mw, y0 + mh))
        s.text(word, font, (x0, y0 + mh + h * gap_frac, x1, y1), color, align="center")
    return draw


def shelter(name, bg, mark, aspect, word, color):
    s = Sign(name, 600, 900, bg)
    stacked(mark, aspect, word, HELV_BOLD, color)(s, s.safe)
    s.finish()


def bb_lovable():
    s = Sign("bb-lovable", BB_W, BB_H, "#FE7B02")
    s.background(hgradient((BB_W, 1), ["#FE7B02", "#F9449E", "#4B73FF"]))
    logo_lovable("white", "white")(s, s.safe, align="center")
    s.finish()


def bb_anthropic():
    s = Sign("bb-anthropic", BB_W, BB_H, "#FAF9F5")
    wordmark("ANTHROPIC", HELV_BOLD, "#141413", text_h=0.68)(s, s.safe, align="center")
    s.finish()


# Storefront sign bands are sized so their lettering reads at 1x (docs/superpowers/specs/2026-09-12-blender-houses-
# design.md, "Look check"): the band is about 9 game px tall, so the lettering fills the whole safe height (6 to 7
# px of capitals) instead of sharing it with a second line. The front band (fa-) spans a 2-tile facade at 8:1; the
# side band (fs-) spans a 1-tile facade at 4:1 and carries the brand's mark, which reads where a name would not.
def fascia(name, bg, draw, aspect=8):
    s = Sign(name, 200 * aspect, 200, bg)
    draw(s, s.safe)
    s.finish()


def fa_capital_one(s, safe):
    x0, y0, x1, y1 = safe
    lockup(s, safe, lambda s_, b: swoosh(s_, b), 2.0, "Capital One", GEORGIA_BOLD, "white",
           mark_h=0.5, text_h=1.0, gap=0.25, align="center")


def fa_jenis(s, safe):
    s.text("jeni's", SCRIPT, safe, "#FA4616", align="center")


def fa_wells(s, safe):
    s.text("WELLS FARGO", GEORGIA_BOLD, safe, "#FFCD41", align="center")


def fs_capital_one(s, safe):
    swoosh(s, inner(safe, 0.3, 0.12))


def fs_jenis(s, safe):
    s.text("jeni's", SCRIPT, safe, "#FA4616", align="center")


def fs_wells(s, safe):
    wells_stagecoach(s, inner(safe, 0.12, 0.0), "#FFCD41", "#D71E28")


# The Ferry Building's name on its frieze: 10 game px tall with capitals about 7 px, across most of the 4-tile
# front (about 3.7 tiles, so 14.5:1 in Blender units, which signs.panel keeps). Red on the building's cream trim.
FERRY_SIGN_ASPECT = 14.5


def fe_port_of_sf():
    s = Sign("fe-port-of-sf", round(100 * FERRY_SIGN_ASPECT), 100, "#F3EEE2")
    s.text("PORT OF SAN FRANCISCO", GEORGIA_BOLD, s.safe, "#C4251C", align="center", spacing=0.0)
    s.finish()


def bl_capital_one():
    s = Sign("bl-capital-one-cafe", 300, 450, "#004879")
    x0, y0, x1, y1 = s.safe
    swoosh(s, (x0 + 6, 120, x1 - 6, 232))
    s.text("Café", GEORGIA_BOLD, (x0, 262, x1, 330), "white", align="center")
    s.finish()


def bl_jenis():
    s = Sign("bl-jenis", 300, 450, "#FA4616")
    x0, y0, x1, y1 = s.safe
    neon_cone(s, (x0 + 14, y0 + 18, x1 - 14, y1 - 18))
    s.finish()


def bl_wells():
    s = Sign("bl-wells-fargo", 300, 450, "#D71E28")
    x0, y0, x1, y1 = s.safe
    wells_stagecoach(s, (x0 + 4, 70, x1 - 4, 200), "#FFCD41", "#D71E28")
    s.text("WELLS\nFARGO", GEORGIA_BOLD, (x0 + 10, 236, x1 - 10, 380), "#FFCD41",
           align="center", spacing=0.1)
    s.finish()


def centered(name, w, h, bg, draw):
    s = Sign(name, w, h, bg)
    draw(s, s.safe)
    s.finish()


def inner(box, fx, fy):
    """Shrink box by fractions fx, fy of its size on each side."""
    x0, y0, x1, y1 = box
    dx, dy = (x1 - x0) * fx, (y1 - y0) * fy
    return (x0 + dx, y0 + dy, x1 - dx, y1 - dy)


def google_word(s, box):
    pl = s.fit("Google", FUTURA, box, align="center")
    s.draw_text(pl, GOOGLE_COLORS)


def mo_goldman(s, safe):
    s.text("Goldman\nSachs", GEORGIA_BOLD, inner(safe, 0.2, 0.12), "white", align="center", spacing=0.02)


# ---------------------------------------------------------------- murals

def mu_mlh():
    s = Sign("mu-mlh", 1000, 1000, None)
    with s.paint("white", "panel") as p:
        p.rect((60, 60, 940, 940), r=48)
    s.text("mlh", ARIAL_BLACK, (130, 120, 870, 580), "#111111", align="center")
    for i, color in enumerate(("#E73427", "#1D539F", "#F8B92A")):
        with s.paint(color, f"bar {i}") as p:
            p.rect((130, 640 + i * 86, 870, 640 + i * 86 + 70), r=10)
    s.finish()


def mu_notability():
    s = Sign("mu-notability", 1000, 1000, None)
    with s.paint("#F6EBDA", "panel") as p:
        p.rect((60, 60, 940, 940), r=90)
    ix0, iy0, size = 300, 130, 400
    with s.paint("#5498FE", "app icon") as p:
        p.rect((ix0, iy0, ix0 + size, iy0 + size), r=size * 0.23)
    # pencil along the diagonal, tip bottom-left
    cx, cy = ix0 + size / 2, iy0 + size / 2
    L, T = size * 0.74, size * 0.17
    d, n = (math.sqrt(0.5), -math.sqrt(0.5)), (math.sqrt(0.5), math.sqrt(0.5))

    def P(x, y):
        return (cx + x * d[0] + y * n[0], cy + x * d[1] + y * n[1])

    tip, cone = -L / 2, -L / 2 + 0.24 * L
    parts = [
        ("#F6EBDA", [P(tip, 0), P(cone, -T / 2), P(cone, T / 2)]),
        ("#1E2A44", [P(tip, 0), P(tip + 0.08 * L, -T / 2 * 0.33), P(tip + 0.08 * L, T / 2 * 0.33)]),
        ("#FF8F4E", [P(cone, -T / 2), P(L / 2 - 0.16 * L, -T / 2), P(L / 2 - 0.16 * L, T / 2), P(cone, T / 2)]),
        ("#F6EBDA", [P(L / 2 - 0.16 * L, -T / 2), P(L / 2 - 0.1 * L, -T / 2), P(L / 2 - 0.1 * L, T / 2), P(L / 2 - 0.16 * L, T / 2)]),
        ("#E5702F", [P(L / 2 - 0.1 * L, -T / 2), P(L / 2, -T / 2), P(L / 2, T / 2), P(L / 2 - 0.1 * L, T / 2)]),
    ]
    for color, pts in parts:
        with s.paint(color, "pencil") as p:
            p.polygon(pts)
    s.text("Notability", ROUNDED_BOLD, (120, 600, 880, 820), "#1E2A44", align="center")
    s.finish()


def mu_bobatalks():
    s = Sign("mu-bobatalks", 1000, 1000, None)
    # pink speech bubble with three dots
    with s.paint("#FF999B", "speech bubble") as p:
        p.rect((300, 70, 700, 300), r=115)
        p.polygon([(390, 270), (330, 360), (470, 290)])
    for i in range(3):
        cx = 420 + i * 80
        with s.paint("white", "dot") as p:
            p.ellipse((cx - 26, 185 - 26, cx + 26, 185 + 26))
    pl = s.fit("Boba\nTalks", ROUNDED, (70, 380, 930 - 18, 930 - 18), align="center", stroke=0.07)
    s.draw_text(pl, "#A16C6A", stroke_fill="#A16C6A", offset=(18, 18))  # painted depth
    s.draw_text(pl, "#BA8478", stroke_fill="#FFF4EA")
    s.finish()


def mu_levis_ghost():
    s = Sign("mu-levis-ghost", 1000, 700, None)
    cream = "#EFE4CF"
    with s.paint(cream, "border") as p:
        p.rect((60, 44, 940, 656), r=10)
        p.rect((70, 54, 930, 646), 0, r=6)
    s.text("LEVI'S", GEORGIA_BOLD, (130, 110, 870, 440), cream, align="center")
    with s.paint(cream, "rule") as p:
        p.rect((260, 478, 740, 486))
    s.text("OVERALLS · SAN FRANCISCO", GEORGIA_BOLD, (150, 520, 850, 590), cream, align="center")
    s.weather(0.55, 0.80)
    s.finish()


# ---------------------------------------------------------------- roster marks
# Simple drawn shapes for the roster's marks (brands.py "mark": (shape, *colors)), each (draw(s, box, *colors), aspect)
# with aspect = width / height. They are chunky on purpose: a mark is at least 8 game px, so thin strokes would vanish.

def _in(box, pts):
    """Unit-square points (0..1) into box."""
    x0, y0, x1, y1 = box
    return [(x0 + u * (x1 - x0), y0 + v * (y1 - y0)) for u, v in pts]


def mark_stripes(s, box, c):
    """Three tiger stripes: tapered bars leaning right."""
    with s.paint(c, "stripes") as p:
        for i in range(3):
            u = i * 0.34
            p.polygon(_in(box, [(u, 0), (u + 0.22, 0), (u + 0.42, 1), (u + 0.26, 1)]))


def mark_chevrons(s, box, c, c2):
    """Two stacked V chevrons, the top one in the second color."""
    for i, color in enumerate((c2, c)):
        v = i * 0.46
        with s.paint(color, f"chevron {i}") as p:
            p.polygon(_in(box, [(0, v), (0.26, v), (0.5, v + 0.36), (0.74, v), (1, v), (0.5, v + 0.54)]))


def mark_bars(s, box, c, c2):
    """Three slanted bars stacked, alternating colors."""
    for i, color in enumerate((c2, c, c2)):
        v = i * 0.37
        with s.paint(color, f"bar {i}") as p:
            p.polygon(_in(box, [(0.18, v), (1, v), (0.82, v + 0.26), (0, v + 0.26)]))


def mark_sparkle(s, box, c, c2):
    """A four-point sparkle, with a small one in the second color."""
    def star(box_, color, label):
        k = 0.14
        with s.paint(color, label) as p:
            p.polygon(_in(box_, [(0.5, 0), (0.5 + k, 0.5 - k), (1, 0.5), (0.5 + k, 0.5 + k), (0.5, 1),
                                 (0.5 - k, 0.5 + k), (0, 0.5), (0.5 - k, 0.5 - k)]))
    x0, y0, x1, y1 = box
    w = x1 - x0
    star((x0, y0 + 0.2 * w, x1 - 0.2 * w, y1), c, "sparkle")
    star((x1 - 0.36 * w, y0, x1, y0 + 0.36 * w), c2, "small sparkle")


def mark_board(s, box, c, c2):
    """A pinned board: a thick rounded frame with a pin on top."""
    x0, y0, x1, y1 = box
    h = y1 - y0
    with s.paint(c, "board") as p:
        p.rect((x0, y0 + 0.22 * h, x1, y1), r=0.1 * h)
        p.rect((x0 + 0.16 * h, y0 + 0.38 * h, x1 - 0.16 * h, y1 - 0.16 * h), 0)
    with s.paint(c2, "pin") as p:
        cx = (x0 + x1) / 2
        p.ellipse((cx - 0.17 * h, y0, cx + 0.17 * h, y0 + 0.34 * h))


def mark_membrane(s, box, c, c2):
    """A peaked membrane: a mountain with its lit left facet in the second color."""
    with s.paint(c, "membrane") as p:
        p.polygon(_in(box, [(0, 1), (0.3, 0.45), (0.55, 0), (1, 1)]))
    with s.paint(c2, "membrane facet") as p:
        p.polygon(_in(box, [(0, 1), (0.3, 0.45), (0.55, 0), (0.45, 1)]))


def mark_eye(s, box, c):
    """A ring with a dot: an eye."""
    x0, y0, x1, y1 = box
    with s.paint(c, "eye") as p:
        p.ring(box, (x1 - x0) * 0.16)
        p.ellipse(inner(box, 0.34, 0.34))


def mark_feather(s, box, c):
    """A feather: a leaf leaning right with a notch cut into its lower edge."""
    with s.paint(c, "feather") as p:
        p.polygon(_in(box, [(0.05, 1), (0.2, 0.55), (0.55, 0.12), (0.95, 0), (0.85, 0.4), (0.5, 0.78), (0.22, 0.86)]))
        p.polygon(_in(box, [(0.42, 0.62), (0.7, 0.44), (0.66, 0.54)]), 0)


def mark_tartan(s, box, c):
    """A tartan square: a thick frame split into four by a cross."""
    x0, y0, x1, y1 = box
    t = (x1 - x0) * 0.16
    with s.paint(c, "tartan") as p:
        p.rect(box)
        for u in (0, 1):
            for v in (0, 1):
                cx0 = x0 + t + u * ((x1 - x0 - t) / 2)
                cy0 = y0 + t + v * ((y1 - y0 - t) / 2)
                p.rect((cx0, cy0, cx0 + (x1 - x0 - 3 * t) / 2, cy0 + (y1 - y0 - 3 * t) / 2), 0)


def mark_loop(s, box, c):
    """A loop arch: a thick teardrop outline with its point at the bottom."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    sw = w * 0.2
    pts = []
    for i in range(121):
        t = 2 * math.pi * i / 120
        # t = 0 is the point (at the bottom); the round end is at the top
        pts.append((x0 + w / 2 + (w - sw) / 2 * math.sin(t) * abs(math.sin(t / 2)) ** 0.6,
                    y0 + sw / 2 + (h - sw) * (math.cos(t) + 1) / 2))
    with s.paint(c, "loop") as p:
        p.line(pts, sw)


def mark_box(s, box, c):
    """An open box of four diamonds (two up, two down)."""
    def diamond(cx, cy, label):
        with s.paint(c, label) as p:
            p.polygon(_in(box, [(cx, cy - 0.2), (cx + 0.25, cy), (cx, cy + 0.2), (cx - 0.25, cy)]))
    for i, (cx, cy) in enumerate(((0.25, 0.2), (0.75, 0.2), (0.25, 0.62), (0.75, 0.62))):
        diamond(cx, cy, f"diamond {i}")
    with s.paint(c, "diamond base") as p:
        p.polygon(_in(box, [(0.5, 0.62), (0.75, 0.8), (0.5, 1), (0.25, 0.8)]))


def mark_dash(s, box, c):
    """A dash: a thick hook opening left, like a stylized D."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    sw = h * 0.24
    r = (h - sw) / 2
    cx, cy = x1 - sw / 2 - r, y0 + h / 2
    pts = [(x0 + sw / 2, y0 + sw / 2), (cx, y0 + sw / 2)]
    pts += [(cx + r * math.sin(math.pi * i / 24), cy - r * math.cos(math.pi * i / 24)) for i in range(25)]
    pts += [(x0 + 0.34 * w, y1 - sw / 2)]
    with s.paint(c, "dash") as p:
        p.line(pts, sw)


def mark_bottle(s, box, c):
    """A bottle: rounded body, shoulders, neck, and cap."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    with s.paint(c, "bottle") as p:
        p.rect((x0, y0 + 0.36 * h, x1, y1), r=0.2 * w)
        p.polygon([(x0, y0 + 0.46 * h), (x0 + 0.3 * w, y0 + 0.24 * h), (x1 - 0.3 * w, y0 + 0.24 * h), (x1, y0 + 0.46 * h)])
        p.rect((x0 + 0.3 * w, y0 + 0.08 * h, x1 - 0.3 * w, y0 + 0.3 * h))
        p.rect((x0 + 0.24 * w, y0, x1 - 0.24 * w, y0 + 0.1 * h))


MARKS = {
    "elevenlabs": (mark_elevenlabs, ELEVEN_ASPECT),
    "persona": (mark_persona, PERSONA_ASPECT),
    "nord": (mark_nord, 1.0),
    "heart": (mark_heart, HEART_ASPECT),
    "meta": (mark_meta, META_ASPECT),
    "swoosh": (swoosh, 2.0),
    "stripes": (mark_stripes, 1.0),
    "chevrons": (mark_chevrons, 1.1),
    "bars": (mark_bars, 1.25),
    "sparkle": (mark_sparkle, 1.0),
    "board": (mark_board, 1.25),
    "membrane": (mark_membrane, 1.2),
    "eye": (mark_eye, 1.0),
    "feather": (mark_feather, 0.9),
    "tartan": (mark_tartan, 1.0),
    "loop": (mark_loop, 0.85),
    "box": (mark_box, 1.0),
    "dash": (mark_dash, 1.3),
    "bottle": (mark_bottle, 0.42),
}
# "underline" is not a side mark: a bar in its color under the wordmark (Visa's gold bar, GoDaddy's teal).
UNDERLINE = "underline"


def roster_mark(b):
    """(draw(s, box), aspect) for a brand's side mark, or None."""
    if not b["mark"] or b["mark"][0] == UNDERLINE:
        return None
    fn, aspect = MARKS[b["mark"][0]]
    return (lambda s, box: fn(s, box, *b["mark"][1:])), aspect


# ---------------------------------------------------------------- roster layouts
# Shared layouts for every roster brand without a hand-drawn sign (brands.py "custom"). Each fills its surface's
# safe area with the brand's mark and wordmark only, no tagline, so the lettering is as tall as the surface allows.

def brand_lockup(b, word=None, text_h=0.62, mark_h=0.9):
    """draw(s, box, align) for a brand's mark and wordmark side by side, its wordmark with an underline bar, or its
    wordmark alone."""
    word = word or b["word"]
    m = roster_mark(b)
    if m:
        return lambda s, box, align="center": lockup(s, box, m[0], m[1], word, PIXEL, b["ink"], mark_h=mark_h,
                                                      text_h=text_h, gap=0.22, align=align)
    if b["mark"] and b["mark"][0] == UNDERLINE:
        def draw(s, box, align="center"):
            x0, y0, x1, y1 = box
            H = y1 - y0
            tb = s.text(word, PIXEL, (x0, y0 + H * (1 - text_h) / 2 - 0.08 * H, x1, y1 - H * (1 - text_h) / 2 - 0.08 * H),
                        b["ink"], align=align)
            with s.paint(b["mark"][1], "underline") as p:
                p.rect((tb[0], tb[3] + 0.06 * H, tb[2], tb[3] + 0.16 * H))
        return draw
    return lambda s, box, align="center": wordmark(word, PIXEL, b["ink"], text_h=text_h + 0.08)(s, box, align=align)


def fitted_word(b, limit=9):
    """The wordmark, or its short form when the wordmark is too long for a small surface."""
    return b["word"] if len(b["word"]) <= limit else b["short"]


def draw_roster(name, b, surface, span=None):
    """Draw one roster sign file (name without .png) for brand b."""
    if surface == "bb":  # bulletins, wall boards, and V boards share the 2:1 art
        billboard(name, b["field"], brand_lockup(b, fitted_word(b, 10), text_h=0.8))
    elif surface == "sh":
        m = roster_mark(b)
        s = Sign(name, 600, 900, b["field"])
        if m:
            stacked(m[0], m[1], b["short"], PIXEL, b["ink"])(s, s.safe)
        else:
            s.text(b["short"], PIXEL, s.safe, b["ink"], align="center")
        s.finish()
    elif surface == "fa":  # the 8:1 band on a 2-tile face
        fascia(name, b["field"], lambda s, safe: brand_lockup(b, fitted_word(b, 12), text_h=0.92, mark_h=0.95)(s, safe))
    elif surface == "fs":  # the 4:1 band on a 1-tile face: a short name, or the mark where a name would not read
        m = roster_mark(b)
        word = b["short"]
        if m:
            fascia(name, b["field"], lambda s, safe: m[0](s, _centered_box(inner(safe, 0.0, 0.04), m[1])), aspect=4)
        else:  # four letters fill a 1-tile band; a longer name would shrink below 6 px, so it becomes a monogram
            word = word if len(word) <= 4 and "\n" not in word else word[0]
            fascia(name, b["field"], lambda s, safe: s.text(word, PIXEL, safe, b["ink"], align="center"), aspect=4)
    elif surface == "bl":  # the 2:3 blade, about 12 px wide on screen: the mark alone, or a one-letter monogram
        s = Sign(name, 300, 450, b["field"])
        m = roster_mark(b)
        if m:
            m[0](s, _centered_box(inner(s.safe, 0.1, 0.08), m[1]))
        else:
            s.text(b["short"][0], PIXEL, inner(s.safe, 0.08, 0.1), b["ink"], align="center")
        s.finish()
    elif surface == "nb":  # the name band over an HQ lobby, 3:1 on a 1-tile face, 6:1 on a 2-tile face
        # The band is 12 px tall and its lettering width-bound, so a mark beside the name only shrinks it: a 2-tile
        # band carries the name alone; a 1-tile band carries the mark, which reads where a name would not.
        m = roster_mark(b)
        if span == 1 and m:
            fascia(name, b["field"], lambda s, safe: m[0](s, _centered_box(inner(safe, 0.0, 0.05), m[1])), aspect=3)
        else:
            word = fitted_word(b) if span == 2 else b["short"]
            fascia(name, b["field"], lambda s, safe: wordmark(word, PIXEL, b["ink"], text_h=0.92)(s, safe, align="center"),
                   aspect={1: 3, 2: 6}[span])
    elif surface == "lw":
        centered(name, 800, 400, b["field"], lambda s, box: brand_lockup(b, fitted_word(b))(s, inner(box, 0.08, 0.22)))
    elif surface == "mo":
        centered(name, 600, 200, "#E8E5DE", lambda s, box: brand_lockup(b, fitted_word(b), text_h=0.8)(s, inner(box, 0.06, 0.1)))
    elif surface == "mu":
        mural_panel(name, b) if not b.get("tagline") else mural_ghost(name, b)
    else:
        raise ValueError(f"{name}: no roster layout for {surface}")


def _centered_box(box, aspect):
    """The largest box of this width / height centered in box."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w / h > aspect:
        cw = h * aspect
        return (x0 + (w - cw) / 2, y0, x0 + (w + cw) / 2, y1)
    ch = w / aspect
    return (x0, y0 + (h - ch) / 2, x1, y0 + (h + ch) / 2)


def mural_panel(name, b):
    """A bright painted panel on a loft wall: the wordmark (and its underline or mark above it) on the brand's field."""
    s = Sign(name, 1000, 1000, None)
    with s.paint(b["field"], "panel") as p:
        p.rect((60, 60, 940, 940), r=40)
    m = roster_mark(b)
    if m:
        m[0](s, _centered_box((200, 130, 800, 500), m[1]))
        s.text(b["short"], PIXEL, (110, 560, 890, 860), b["ink"], align="center")
    else:
        brand_lockup(b, b["short"], text_h=0.8)(s, (100, 130, 900, 870))
    s.finish()


def mural_ghost(name, b):
    """A faded painted ghost sign, like the Levi's one: a thin border, the name, a rule, and the tagline."""
    s = Sign(name, 1000, 700, None)
    cream = b["ink"]
    with s.paint(cream, "border") as p:
        p.rect((60, 44, 940, 656), r=10)
        p.rect((74, 58, 926, 642), 0, r=6)
    s.text(b["word"], PIXEL, (88, 110, 912, 430), cream, align="center")  # just inside the border: 11 letters are width-bound
    with s.paint(cream, "rule") as p:
        p.rect((240, 470, 760, 480))
    s.text(b["tagline"], PIXEL, (140, 515, 860, 600), cream, align="center")
    s.weather(0.55, 0.80)
    s.finish()


# ---------------------------------------------------------------- contact sheet

def contact_sheet():
    cell_w, cell_h, pad, label_h, cols = 440, 300, 24, 26, 4
    rows = math.ceil(len(Sign.outputs) / cols)
    sheet = Image.new("RGB", (cols * cell_w + pad, rows * (cell_h + label_h) + pad), (128, 128, 128))
    g = ImageDraw.Draw(sheet)
    lf = load(HELV_BOLD, 17)
    for i, (name, path) in enumerate(Sign.outputs):
        im = Image.open(path).convert("RGBA")
        im.thumbnail((cell_w - pad, cell_h - pad), Image.LANCZOS)
        cx = (i % cols) * cell_w + pad
        cy = (i // cols) * (cell_h + label_h) + pad
        ox, oy = cx + (cell_w - pad - im.width) // 2, cy + (cell_h - pad - im.height) - 6
        g.rectangle((ox - 1, oy - 1, ox + im.width, oy + im.height), outline=(60, 60, 60))
        sheet.paste(im, (ox, oy), im)
        w, h = Image.open(path).size
        g.text((ox, cy + cell_h - pad + 2), f"{name}  {w}x{h}", font=lf, fill=(20, 20, 20))
    sheet.save(OUT / "_contact.png")
    print(f"ok _contact {sheet.width}x{sheet.height}")


# ---------------------------------------------------------------- main

# The first brands' signs, drawn by hand and approved on 2026-09-12 (brands.py "custom" names them). Every other sign
# file the catalog names is drawn from its brand's roster entry by draw_roster().
CUSTOM = {
    # bulletins: brand mark and wordmark only, no tagline (see billboard() above)
    "bb-elevenlabs": lambda: billboard("bb-elevenlabs", "white", logo_elevenlabs("black")),
    "bb-persona": lambda: billboard("bb-persona", "black", logo_persona("#7379FD", "white")),
    "bb-nordvpn": lambda: billboard("bb-nordvpn", "#4687FF", logo_nord("white", "#4687FF", "white")),
    "bb-capital-one": lambda: billboard("bb-capital-one", "#004879",
                                        lambda s, box, align="center": capital_one_lockup(s, box, align=align)),
    "bb-lovable": bb_lovable,
    "bb-anthropic": bb_anthropic,
    "bb-openai": lambda: billboard("bb-openai", "black", wordmark("OpenAI", HELV_BOLD, "white", text_h=0.6)),
    # bus shelters: brand mark stacked over its wordmark, no tagline
    "sh-persona": lambda: shelter("sh-persona", "white", lambda s, b: mark_persona(s, b, "#7379FD"), PERSONA_ASPECT,
                                  "persona", "black"),
    "sh-nordvpn": lambda: shelter("sh-nordvpn", "#4687FF", lambda s, b: mark_nord(s, b, "white", "#4687FF"), 1.0,
                                  "NordVPN", "white"),
    "sh-elevenlabs": lambda: shelter("sh-elevenlabs", "white", lambda s, b: mark_elevenlabs(s, b, "black"),
                                     ELEVEN_ASPECT, "ElevenLabs", "black"),
    # storefront fascias and blades
    "fa-capital-one-cafe": lambda: fascia("fa-capital-one-cafe", "#004879", fa_capital_one),
    "fa-jenis": lambda: fascia("fa-jenis", "#2F2F30", fa_jenis),
    "fa-wells-fargo": lambda: fascia("fa-wells-fargo", "#D71E28", fa_wells),
    "fs-capital-one-cafe": lambda: fascia("fs-capital-one-cafe", "#004879", fs_capital_one, aspect=4),
    "fs-jenis": lambda: fascia("fs-jenis", "#2F2F30", fs_jenis, aspect=4),
    "fs-wells-fargo": lambda: fascia("fs-wells-fargo", "#D71E28", fs_wells, aspect=4),
    "bl-capital-one-cafe": bl_capital_one,
    "bl-jenis": bl_jenis,
    "bl-wells-fargo": bl_wells,
    # landmark signs
    "fe-port-of-sf": fe_port_of_sf,
    # lobby logo walls, monuments, and Google's name band in its four colors
    "lw-uber": lambda: centered("lw-uber", 800, 400, "white",
                                lambda s, b: s.text("Uber", HELV_BOLD, inner(b, 0.24, 0.25), "black", align="center")),
    "lw-google": lambda: centered("lw-google", 800, 400, "white", lambda s, b: google_word(s, inner(b, 0.16, 0.22))),
    "lw-meta": lambda: centered("lw-meta", 800, 400, "white", lambda s, b: logo_meta()(s, inner(b, 0.1, 0.3))),
    "lw-openai": lambda: centered("lw-openai", 800, 400, "black",
                                  lambda s, b: s.text("OpenAI", HELV_BOLD, inner(b, 0.2, 0.3), "white", align="center")),
    "mo-google": lambda: centered("mo-google", 600, 200, "#E8E5DE", lambda s, b: google_word(s, inner(b, 0.12, 0.1))),
    "mo-meta": lambda: centered("mo-meta", 600, 200, "#E8E5DE", lambda s, b: logo_meta()(s, inner(b, 0.06, 0.18))),
    "mo-goldman-sachs": lambda: centered("mo-goldman-sachs", 600, 200, "#7399C6", mo_goldman),
    "nb-google-2": lambda: fascia("nb-google-2", "white", lambda s, safe: google_word(s, safe), aspect=6),
    # murals
    "mu-mlh": mu_mlh,
    "mu-notability": mu_notability,
    "mu-bobatalks": mu_bobatalks,
    "mu-levis-ghost": mu_levis_ghost,
}


def roster_owner(stem, brands):
    """(brand, surface, span) for a sign file stem such as "fa-schwab", "nb-airbnb-1", or "mu-levis-ghost"."""
    surface, rest = stem.split("-", 1)
    span = None
    if surface == "nb":
        rest, span = rest.rsplit("-", 1)
        span = int(span)
    by_art = {}
    for b in brands:
        by_art[b["id"]] = b
        for p in b["places"]:
            if p.get("art"):
                by_art[p["art"]] = b
    if rest not in by_art:
        raise ValueError(f"{stem}: no roster brand for {rest!r}")
    return by_art[rest], surface, span


def main():
    import catalog
    from brands import BRANDS

    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    wanted = [n.removesuffix(".png") for n in catalog.SIGN_FILES]
    claimed = {c for b in BRANDS for c in b["custom"]} | {"fe-port-of-sf"}
    if claimed != set(CUSTOM):
        raise ValueError(f"brands.py custom and make_ads.CUSTOM disagree: {sorted(claimed ^ set(CUSTOM))}")
    for stem in wanted:
        if stem in CUSTOM:
            CUSTOM[stem]()
        else:
            draw_roster(stem, *roster_owner(stem, BRANDS))
    unused = set(CUSTOM) - set(wanted)
    if unused:
        raise ValueError(f"hand-drawn signs no catalog entry uses: {sorted(unused)}")

    (OUT / "_caps.json").write_text(json.dumps(Sign.caps_by_name, indent=1, sort_keys=True))
    contact_sheet()


if __name__ == "__main__":
    main()
