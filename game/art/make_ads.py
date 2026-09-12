"""Sign and ad artwork for Larp City buildings, drawn with Pillow into art/ads/.

Blender maps each PNG onto a sign face with exactly the image's aspect ratio, so every
element has to sit inside a safe area. Each image is drawn at SS x resolution into
per-element masks, composited, and downscaled with LANCZOS. Every draw call records its
bounding box, and Sign.finish() raises if anything leaves the safe rect.

Run from game/:  python3 art/make_ads.py
"""
import math
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / "ads"
SS = 4  # supersampling factor
SUP = "/System/Library/Fonts/Supplemental/"
SYS = "/System/Library/Fonts/"


# ---------------------------------------------------------------- fonts

def font_spec(*candidates):
    """First existing (path, index, variation) candidate."""
    for cand in candidates:
        path, index, *var = cand
        if Path(path).exists():
            return (path, index, var[0] if var else None)
    raise FileNotFoundError(f"no font found among {candidates}")


ARIAL = font_spec((SUP + "Arial.ttf", 0), (SYS + "Helvetica.ttc", 0))
ARIAL_BOLD = font_spec((SUP + "Arial Bold.ttf", 0), (SYS + "Helvetica.ttc", 1))
ARIAL_BLACK = font_spec((SUP + "Arial Black.ttf", 0), (SUP + "Arial Bold.ttf", 0))
HELV_BOLD = font_spec((SYS + "Helvetica.ttc", 1), (SUP + "Arial Bold.ttf", 0))
GEORGIA = font_spec((SUP + "Georgia.ttf", 0), (SUP + "Georgia Bold.ttf", 0))
GEORGIA_BOLD = font_spec((SUP + "Georgia Bold.ttf", 0), (SUP + "Georgia.ttf", 0))
SCRIPT = font_spec((SUP + "SnellRoundhand.ttc", 2), (SUP + "SnellRoundhand.ttc", 0),
                   (SUP + "Georgia Bold Italic.ttf", 0))
FUTURA = font_spec((SUP + "Futura.ttc", 0), (SYS + "Helvetica.ttc", 0))
ROUNDED = font_spec((SYS + "SFNSRounded.ttf", 0, b"Black"), (SUP + "Arial Black.ttf", 0))
ROUNDED_BOLD = font_spec((SYS + "SFNSRounded.ttf", 0, b"Bold"), (SYS + "Helvetica.ttc", 1))

# Pixel art (docs/superpowers/specs/2026-09-12-blender-houses-design.md): every sign is lettered in the game's own
# bold Pixelify Sans (game/public/fonts, glyphs fixed for small sizes), so text survives the sprite pixel pass as
# crisp pixels and matches the UI. The names above stay so call sites read the same.
PIXEL = font_spec((str(Path(__file__).resolve().parents[1] / "public" / "fonts" / "pixelify-sans-bold.ttf"), 0))
ARIAL = ARIAL_BOLD = ARIAL_BLACK = HELV_BOLD = GEORGIA = GEORGIA_BOLD = SCRIPT = FUTURA = ROUNDED = ROUNDED_BOLD = PIXEL


@lru_cache(maxsize=4096)
def load(spec, size):
    path, index, var = spec
    f = ImageFont.truetype(path, size, index=index)
    if var:
        f.set_variation_by_name(var)
    return f


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

    def __init__(self, name, w, h, bg):
        self.name, self.w, self.h, self.bg = name, w, h, bg
        self.transparent = bg is None
        self.flat = not self.transparent  # solid background: enables the pixel check
        self.inset = 0.04 if self.transparent else 0.06
        self.im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0) if bg is None else rgba(bg))
        self.scratch = ImageDraw.Draw(Image.new("L", (1, 1)))
        self.boxes = []

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

    def weather(self, lo, hi, seed_size=(40, 28)):
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

def billboard(name, bg, headline, color, logo, font=HELV_BOLD, paint=None):
    s = Sign(name, 1372, 400, bg)
    if paint:
        paint(s)
    x0, y0, x1, y1 = s.safe
    s.text(headline, font, (x0, y0, s.w * 0.72, y1), color, max_size=150, spacing=0.18)
    logo(s, (s.w * 0.76, y1 - 84, x1, y1))
    s.finish()
    return s


def shelter(name, bg, headline, color, logo, font=HELV_BOLD):
    s = Sign(name, 600, 900, bg)
    x0, y0, x1, y1 = s.safe
    s.text(headline, font, (x0, y0 + 20, x1, y1 - 170), color, max_size=150, spacing=0.12)
    logo(s, (x0, y1 - 80, x1, y1), align="left")
    s.finish()


def bb_lovable():
    s = Sign("bb-lovable", 1372, 400, "#FE7B02")
    s.background(hgradient((1372, 1), ["#FE7B02", "#F9449E", "#4B73FF"]))
    x0, y0, x1, y1 = s.safe
    s.text("Build a\nROI calculator", HELV_BOLD, (x0, y0, s.w * 0.72, y1), "white", max_size=150, spacing=0.18)
    logo_lovable("white", "white")(s, (s.w * 0.76, y1 - 84, x1, y1))
    s.finish()


def bb_anthropic():
    s = Sign("bb-anthropic", 1372, 400, "#FAF9F5")
    x0, y0, x1, y1 = s.safe
    text = "Keep thinking."
    pl = s.fit(text, GEORGIA, (x0, y0, s.w * 0.72, y1), max_size=170)
    s.draw_text(pl, ["#141413"] * (len(text) - 1) + ["#D97757"])
    wordmark("ANTHROPIC", HELV_BOLD, "#141413", text_h=0.5)(s, (s.w * 0.76, y1 - 84, x1, y1))
    s.finish()


def fascia(name, bg, draw):
    s = Sign(name, 1600, 200, bg)
    draw(s, s.safe)
    s.finish()


def fa_capital_one(s, safe):
    x0, y0, x1, y1 = safe
    capital_one_lockup(s, (x0, y0 + 6, x1, y1 - 6), word="Capital One Café", align="center")


def fa_jenis(s, safe):
    x0, y0, x1, y1 = safe
    s.text("jeni's", SCRIPT, (x0, y0, x1, y1), "#FA4616", align="center")


def fa_wells(s, safe):
    x0, y0, x1, y1 = safe
    s.text("WELLS FARGO", GEORGIA_BOLD, (x0, y0 + 26, x1, y1 - 26), "#FFCD41", align="center")


def bl_capital_one():
    s = Sign("bl-capital-one", 300, 450, "#004879")
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
    pl = s.fit("Boba\nTalks", ROUNDED, (70, 380, 930 - 18, 930 - 18), align="center",
               stroke=0.07, spacing=-0.04)
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

def main():
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()

    # bulletins
    billboard("bb-elevenlabs", "white", "Your voice.\nAny language.", "black", logo_elevenlabs("black"))
    billboard("bb-persona", "black", "Verify humans,\nnot bots.", "white", logo_persona("#7379FD", "white"))
    billboard("bb-nordvpn", "#4687FF", "Public Wi-Fi?\nNot your problem.", "white",
              logo_nord("white", "#4687FF", "white"))
    billboard("bb-capital-one", "#004879", "What's in\nyour wallet?", "white",
              lambda s, box: capital_one_lockup(s, (box[0], box[1] - 40, box[2], box[3])))
    bb_lovable()
    bb_anthropic()
    billboard("bb-openai", "black", "Plan the trip.\nAsk ChatGPT.", "white", wordmark("OpenAI", HELV_BOLD, "white"))

    # bus shelters
    shelter("sh-persona", "white", "Verify\nhumans,\nnot bots.", "black", logo_persona("#7379FD", "black"))
    shelter("sh-nordvpn", "#4687FF", "Public\nWi-Fi?\nNot your\nproblem.", "white",
            logo_nord("white", "#4687FF", "white"))
    shelter("sh-elevenlabs", "white", "Your\nvoice.\nAny\nlanguage.", "black", logo_elevenlabs("black"))

    # storefront fascias and blades
    fascia("fa-capital-one-cafe", "#004879", fa_capital_one)
    fascia("fa-jenis", "#2F2F30", fa_jenis)
    fascia("fa-wells-fargo", "#D71E28", fa_wells)
    bl_capital_one()
    bl_jenis()
    bl_wells()

    # lobby logo walls
    centered("lw-uber", 800, 400, "white",
             lambda s, b: s.text("Uber", HELV_BOLD, inner(b, 0.24, 0.25), "black", align="center"))
    centered("lw-google", 800, 400, "white", lambda s, b: google_word(s, inner(b, 0.16, 0.22)))
    centered("lw-meta", 800, 400, "white", lambda s, b: logo_meta()(s, inner(b, 0.1, 0.3)))
    centered("lw-openai", 800, 400, "black",
             lambda s, b: s.text("OpenAI", HELV_BOLD, inner(b, 0.2, 0.3), "white", align="center"))

    # monuments
    centered("mo-google", 600, 200, "#E8E5DE", lambda s, b: google_word(s, inner(b, 0.12, 0.1)))
    centered("mo-meta", 600, 200, "#E8E5DE", lambda s, b: logo_meta()(s, inner(b, 0.06, 0.18)))
    centered("mo-goldman", 600, 200, "#7399C6", mo_goldman)

    # murals
    mu_mlh()
    mu_notability()
    mu_bobatalks()
    mu_levis_ghost()

    contact_sheet()


if __name__ == "__main__":
    main()
