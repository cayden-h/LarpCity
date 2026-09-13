"""Pixel pass tests. Run from game/:  python3 -m unittest discover -s art/tests -v"""
import colorsys
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


GLASS = (5, 5, 96, 255)  # an id of a glass face pointing sideways (scene.py: B = 64 + 32 for glass)


def hue(rgb):
    r, g, b = (float(v) / 255 for v in rgb)
    return colorsys.rgb_to_hsv(r, g, b)[0] * 360


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

    def test_dropped_block_is_fully_zero(self):
        a = img(4, 4)
        a[0, :2] = (255, 255, 255, 255)
        self.assertEqual(tuple(P.downsample(a)[0, 0]), (0, 0, 0, 0))

    def test_size_shrinks_by_raw_scale(self):
        self.assertEqual(P.downsample(img(8, 12, (1, 2, 3, 255))).shape, (2, 3, 4))

    def test_exactly_half_opaque_block_is_kept(self):
        a = img(4, 4)
        a[:2, :] = (50, 60, 70, 255)  # 8 of 16 pixels opaque
        out = P.downsample(a)
        self.assertEqual(out[0, 0, 3], 255)
        self.assertEqual(tuple(out[0, 0, :3]), (50, 60, 70))

    def test_crops_a_size_not_a_multiple_of_the_scale(self):
        self.assertEqual(P.downsample(img(9, 10, (1, 2, 3, 255))).shape, (2, 2, 4))

    def test_a_2_2_color_tie_picks_the_lower_rgb_key(self):
        a = img(2, 2)
        a[0, 0] = (10, 0, 0, 255)
        a[0, 1] = (10, 0, 0, 255)
        a[1, 0] = (0, 0, 10, 255)
        a[1, 1] = (0, 0, 10, 255)
        out = P.downsample(a, s=2)
        self.assertEqual(tuple(out[0, 0, :3]), (0, 0, 10))


class SignStrokes(unittest.TestCase):
    """A thin stroke on a sign, split across two 4 x 4 blocks, must survive the majority downsample."""
    BG, STROKE = (200, 40, 30), (250, 240, 220)

    def sign(self, stroke_cols, stroke=None, jitter=True, width=12):
        a = img(4, width, (*self.BG, 255))
        a[:, stroke_cols, :3] = stroke or self.STROKE
        if jitter:  # a rendered sign is continuous tone: no two pixels share an exact color
            rng = np.random.default_rng(3)
            a[..., :3] = np.clip(a[..., :3].astype(int) + rng.integers(-3, 4, a[..., :3].shape), 0, 255)
        return a

    def near(self, px, rgb, tol=6):
        return int(np.abs(px[:3].astype(int) - np.array(rgb)).max()) <= tol

    def test_a_quarter_block_stroke_wins_inside_a_sign(self):
        a = self.sign(slice(3, 6))  # 1 column in block 0 (a quarter), 2 in block 1 (half)
        out = P.downsample(a, sign=np.ones(a.shape[:2], bool))
        self.assertTrue(self.near(out[0, 0], self.STROKE))
        self.assertTrue(self.near(out[0, 1], self.STROKE))
        self.assertTrue(self.near(out[0, 2], self.BG))

    def test_the_winner_is_a_rendered_color_not_a_blend(self):
        a = self.sign(slice(3, 6))
        out = P.downsample(a, sign=np.ones(a.shape[:2], bool))
        colors = {tuple(c) for c in a[..., :3].reshape(-1, 3).tolist()}
        for x in range(3):
            self.assertIn(tuple(out[0, x, :3].tolist()), colors)

    def test_less_than_a_quarter_loses(self):
        a = self.sign([3], jitter=False, width=8)
        a[0, 3, :3] = self.BG  # 3 of 16 pixels
        out = P.downsample(a, sign=np.ones(a.shape[:2], bool))
        self.assertTrue(self.near(out[0, 0], self.BG))

    def test_a_low_contrast_minority_loses(self):
        close = (215, 55, 45)
        a = self.sign(slice(3, 6), stroke=close)
        out = P.downsample(a, sign=np.ones(a.shape[:2], bool))
        self.assertTrue(self.near(out[0, 0], self.BG))

    def test_outside_a_sign_the_majority_rule_holds(self):
        a = self.sign(slice(3, 6), jitter=False)
        out = P.downsample(a)
        self.assertEqual(tuple(out[0, 0, :3]), self.BG)

    def test_dark_strokes_on_a_light_sign_survive_too(self):
        a = img(4, 12, (240, 230, 210, 255))
        a[:, 3:6, :3] = (180, 30, 25)
        out = P.downsample(a, sign=np.ones(a.shape[:2], bool))
        self.assertEqual(tuple(out[0, 0, :3]), (180, 30, 25))
        self.assertEqual(tuple(out[0, 1, :3]), (180, 30, 25))

    def test_a_half_and_half_block_goes_to_the_stroke_not_the_field(self):
        # the field is the sign's most common tone overall; in an even split the other tone is the stroke
        for field, stroke in (((200, 40, 30), (250, 240, 220)), ((240, 230, 210), (180, 30, 25))):
            a = img(4, 12, (*field, 255))
            a[:, 2:4, :3] = stroke
            a[:, 4:6, :3] = stroke
            out = P.downsample(a, sign=np.ones(a.shape[:2], bool))
            self.assertEqual(tuple(out[0, 0, :3]), stroke)


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
        day[:, 2:] = (40, 40, 40, 255)
        ids = img(2, 4, (1, 1, 1, 255))
        ids[:, 2:] = (2, 2, 2, 255)
        out = P.flatten(day, ids)
        self.assertEqual(tuple(out[0, 0, :3]), (100, 100, 100))
        self.assertEqual(tuple(out[0, 3, :3]), (40, 40, 40))

    def test_base_color_is_saturated_at_the_same_brightness(self):
        day = img(2, 2, (120, 100, 80, 255))
        ids = img(2, 2, (5, 5, 5, 255))
        out = P.flatten(day, ids)[0, 0, :3].astype(int)
        self.assertEqual(out.max() - out.min(), round(40 * P.SATURATION))  # the spread grows by SATURATION
        self.assertAlmostEqual(float(P._lum(out)), float(P._lum((120, 100, 80))), delta=1.0)
        self.assertGreater(out[0], out[1])  # the hue stays: red over green over blue
        self.assertGreater(out[1], out[2])

    def test_grey_stays_grey(self):
        day = img(2, 2, (90, 90, 90, 255))
        ids = img(2, 2, (5, 5, 5, 255))
        self.assertEqual(tuple(P.flatten(day, ids)[0, 0, :3]), (90, 90, 90))

    def test_saturating_never_leaves_the_rgb_range(self):
        day = img(2, 2, (250, 20, 10, 255))
        ids = img(2, 2, (5, 5, 5, 255))
        out = P.flatten(day, ids)[0, 0, :3].astype(int)
        self.assertEqual(out[0], 255)  # pushed as far as the range allows, and no further
        self.assertGreater(out[2], 0)

    def test_saturating_keeps_the_hue_when_the_push_would_clip(self):
        for rgb in ((240, 60, 30), (250, 20, 10), (30, 200, 240)):
            out = P._saturate(np.array(rgb, np.float32), P.SATURATION)
            self.assertTrue(((out >= 0) & (out <= 255)).all())
            self.assertAlmostEqual(hue(out), hue(rgb), delta=0.5)
            self.assertAlmostEqual(float(P._lum(out)), float(P._lum(rgb)), delta=0.5)

    def test_saturating_is_the_full_push_when_nothing_clips(self):
        out = P._saturate(np.array((120, 100, 80), np.float32), 1.5)
        grey = float(P._lum((120, 100, 80)))
        np.testing.assert_allclose(out, grey + (np.array((120, 100, 80)) - grey) * 1.5, atol=1e-3)

    def sheen(self, side):
        """A 4-patch-wide grey region with a light square of the given side in one corner and a light line
        two pixels wide along its bottom; the light pixels stay under half, so the median is the base."""
        n = 4 * P.SHEEN_PATCH
        day = img(n, n, (100, 100, 100, 255))
        day[:side, :side] = (150, 150, 150, 255)
        day[-2:, :] = (150, 150, 150, 255)
        return P.flatten(day, img(n, n, GLASS))

    def test_a_large_light_patch_falls_back_to_the_base_tone(self):
        out = self.sheen(P.SHEEN_PATCH)
        self.assertEqual(tuple(out[0, 0, :3]), (100, 100, 100))
        self.assertEqual(tuple(out[P.SHEEN_PATCH - 1, P.SHEEN_PATCH - 1, :3]), (100, 100, 100))

    def test_thin_light_details_keep_the_light_tone(self):
        out = self.sheen(P.SHEEN_PATCH - 1)
        self.assertEqual(tuple(out[0, 0, :3]), (118, 118, 118))    # a square just too small to count as a patch
        self.assertEqual(tuple(out[-1, 5 * 1, :3]), (118, 118, 118))  # the thin line

    def test_a_patch_is_measured_inside_one_region(self):
        # two regions side by side, each with a light strip too thin to be a patch on its own, which together
        # would be wide enough: they stay light
        n = 4 * P.SHEEN_PATCH
        h = P.SHEEN_PATCH // 2 + 1
        day = img(n, n, (100, 100, 100, 255))
        day[:P.SHEEN_PATCH, n // 2 - h: n // 2 + h] = (150, 150, 150, 255)
        ids = img(n, n, GLASS)
        ids[:, n // 2:] = (6, 6, GLASS[2], 255)
        out = P.flatten(day, ids)
        self.assertEqual(tuple(out[0, n // 2 - 1, :3]), (118, 118, 118))
        self.assertEqual(tuple(out[0, n // 2, :3]), (118, 118, 118))

    def test_a_large_light_patch_off_glass_stays_light(self):
        # a wide lit cornice or trim band is shape, not a reflection
        n = 4 * P.SHEEN_PATCH
        day = img(n, n, (100, 100, 100, 255))
        day[:P.SHEEN_PATCH, :P.SHEEN_PATCH] = (150, 150, 150, 255)
        out = P.flatten(day, img(n, n, (5, 5, 64, 255)))
        self.assertEqual(tuple(out[0, 0, :3]), (118, 118, 118))

    def test_glass_is_read_from_the_id_blue_channel(self):
        blues = np.array([[64, 96, 191, 223, 255]], np.uint8)
        ids = img(1, 5, (5, 5, 0, 255))
        ids[..., 2] = blues
        self.assertEqual(P.is_glass(ids).tolist(), [[False, True, False, True, False]])

    def test_a_dark_patch_keeps_the_shade_tone(self):
        # a large dark patch is a cast shadow, which is shape, not sheen
        n = 4 * P.SHEEN_PATCH
        day = img(n, n, (100, 100, 100, 255))
        day[:P.SHEEN_PATCH, :P.SHEEN_PATCH] = (50, 50, 50, 255)
        out = P.flatten(day, img(n, n, GLASS))
        self.assertEqual(tuple(out[0, 0, :3]), (72, 72, 72))

    def test_sign_region_keeps_its_detail(self):
        day = img(4, 4, (0, 0, 0, 255))
        day[..., 0] = (np.arange(16).reshape(4, 4) * 10).astype(np.uint8)
        ids = img(4, 4, (*P.SIGN_ID, 255))
        np.testing.assert_array_equal(P.flatten(day, ids), day)

    def test_handles_an_empty_image_without_crashing(self):
        day = img(0, 0)
        ids = img(0, 0)
        out = P.flatten(day, ids)
        self.assertEqual(out.shape, (0, 0, 4))

    def test_maps_dark_mid_and_light_pixels_to_the_three_tones(self):
        day = img(1, 3, (0, 0, 0, 255))
        day[0, 0] = (50, 50, 50, 255)    # dark: ratio 0.5, below DARK
        day[0, 1] = (100, 100, 100, 255)  # mid: the median itself
        day[0, 2] = (150, 150, 150, 255)  # light: ratio 1.5, above LIGHT
        ids = img(1, 3, (5, 5, 5, 255))
        out = P.flatten(day, ids)
        self.assertEqual(tuple(out[0, 0, :3]), (72, 72, 72))
        self.assertEqual(tuple(out[0, 1, :3]), (100, 100, 100))
        self.assertEqual(tuple(out[0, 2, :3]), (118, 118, 118))

    def test_leaves_low_alpha_pixels_unchanged(self):
        day = img(2, 2, (200, 50, 50, 100))  # alpha 100 <= 127
        ids = img(2, 2, (9, 9, 9, 255))
        np.testing.assert_array_equal(P.flatten(day, ids), day)

    def test_tones_are_rounded_not_truncated(self):
        # median 101: dark tone 0.72 * 101 = 72.72 (rounds to 73, would truncate to 72);
        # light tone 1.18 * 101 = 119.18 (rounds to 119, would truncate to 119 too, but check anyway)
        day = img(1, 3, (0, 0, 0, 255))
        day[0, 0] = (10, 10, 10, 255)
        day[0, 1] = (101, 101, 101, 255)
        day[0, 2] = (200, 200, 200, 255)
        ids = img(1, 3, (5, 5, 5, 255))
        out = P.flatten(day, ids)
        self.assertEqual(tuple(out[0, 0, :3]), (73, 73, 73))
        self.assertEqual(tuple(out[0, 1, :3]), (101, 101, 101))
        self.assertEqual(tuple(out[0, 2, :3]), (119, 119, 119))


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

    def test_returns_fewer_colors_when_the_image_has_fewer(self):
        a = img(4, 4, (0, 0, 0, 255))
        a[:2] = (10, 20, 30, 255)
        a[2:] = (200, 210, 220, 255)
        pal = P.build_palette([a], 8)
        self.assertLess(len(pal), 8)
        self.assertEqual(pal[-1], P.INK)
        self.assertEqual(len(pal), len(set(pal)))
        self.assertIn((10, 20, 30), pal)
        self.assertIn((200, 210, 220), pal)

    def test_all_transparent_image_raises(self):
        a = img(4, 4)
        with self.assertRaises(ValueError):
            P.build_palette([a], 4)

    def test_empty_image_list_raises(self):
        with self.assertRaises(ValueError):
            P.build_palette([], 4)

    def test_an_ink_colored_region_still_ends_up_last_and_once(self):
        a = img(4, 4, (0, 0, 0, 255))
        a[:2] = (*P.INK, 255)
        a[2:] = (200, 210, 220, 255)
        pal = P.build_palette([a], 8)
        self.assertEqual(pal.count(P.INK), 1)
        self.assertEqual(pal[-1], P.INK)

    def test_n_must_leave_room_for_ink(self):
        a = img(4, 4, (0, 0, 0, 255))
        with self.assertRaises(ValueError):
            P.build_palette([a], 1)

    def test_day_palette_reserves_colors_for_signs(self):
        # a large building in many blues and a small red sign: a shared median cut spends every color on the
        # blues, the day palette keeps the sign's red
        rng = np.random.default_rng(4)
        a = img(64, 64, (0, 0, 0, 255))
        a[..., 0] = rng.integers(10, 40, (64, 64))
        a[..., 1] = rng.integers(40, 90, (64, 64))
        a[..., 2] = rng.integers(90, 200, (64, 64))
        sign = np.zeros((64, 64), bool)
        sign[:2, :2] = True
        a[sign, :3] = (215, 30, 40)
        shared = P.build_palette([a], 8)
        self.assertNotIn((215, 30, 40), shared)
        pal = P.build_day_palette([a], [sign], 8, 3)
        self.assertEqual(len(pal), 8)
        self.assertIn((215, 30, 40), pal)
        self.assertEqual(pal[-1], P.INK)
        self.assertEqual(pal.count(P.INK), 1)

    def test_day_palette_without_signs_is_the_shared_palette(self):
        a = img(4, 4, (0, 0, 0, 255))
        a[:2] = (10, 20, 30, 255)
        a[2:] = (200, 210, 220, 255)
        none = np.zeros((4, 4), bool)
        self.assertEqual(P.build_day_palette([a], [none], 8, 3), P.build_palette([a], 8))

    def test_sparse_vegetation_survives_city_palette_and_quantization(self):
        # Tiny lawn/hedge patches must survive even when towers dominate the city's pixels.
        rng = np.random.default_rng(9)
        a = img(256, 256, (0, 0, 0, 255))
        a[..., 0] = rng.integers(20, 100, a.shape[:2])
        a[..., 1] = rng.integers(70, 140, a.shape[:2])
        a[..., 2] = rng.integers(150, 240, a.shape[:2])
        greens = [(65, 118, 44), (113, 161, 85), (158, 224, 118)]
        for i, color in enumerate(greens):
            a[0, i] = (*color, 255)
        signs = np.zeros(a.shape[:2], bool)
        signs[1, 0] = True
        a[1, 0] = (215, 30, 40, 255)
        palette = P.build_day_palette([a], [signs], 40, 12)
        result = P.quantize(a, palette)
        self.assertEqual([tuple(c) for c in result[0, :3, :3]], greens)
        self.assertIn((215, 30, 40), palette)
        self.assertLessEqual(len(palette), 40)
        self.assertEqual(len(palette), len(set(palette)))
        self.assertEqual(palette[-1], P.INK)
        self.assertEqual(palette, P.build_day_palette([a], [signs], 40, 12))

    def test_vegetation_reservation_ignores_transparent_and_sign_pixels(self):
        a = img(4, 4, (160, 150, 140, 255))
        a[0, 0] = (10, 240, 20, 0)
        a[0, 1] = (30, 160, 50, 255)
        signs = np.zeros(a.shape[:2], bool)
        signs[0, 1] = True
        palette = P.build_day_palette([a], [signs], 40, 12)
        self.assertNotIn((10, 240, 20), palette)
        self.assertIn((30, 160, 50), palette)
        self.assertEqual(palette.count((30, 160, 50)), 1)

    def test_n_must_be_at_least_one_without_ink(self):
        a = img(4, 4, (0, 0, 0, 255))
        with self.assertRaises(ValueError):
            P.build_palette([a], 0, ink=False)


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

    def test_darkens_at_a_vertical_id_change(self):
        # the same shape, transposed, so the id boundary runs across rows instead of columns
        day_h, ids_h = self.shape((2, 2, 2))
        day, ids = day_h.transpose(1, 0, 2), ids_h.transpose(1, 0, 2)
        out, lines = P.outline(day, ids, self.PAL + [P.INK])
        self.assertEqual(tuple(out[1, 2, :3]), P.INK)             # top edge of the shape
        self.assertEqual(tuple(out[2, 2, :3]), (110, 99, 88))      # above the id change
        self.assertEqual(tuple(out[3, 2, :3]), (200, 180, 160))    # below it, inside
        self.assertTrue(lines[1, 2] and lines[2, 2] and not lines[3, 2])

    def test_inner_line_never_overwrites_a_silhouette_pixel(self):
        day = img(3, 4)
        day[:, :2] = (200, 180, 160, 255)
        ids = img(3, 4)
        ids[:, 0] = (1, 1, 1, 255)
        ids[:, 1] = (2, 2, 2, 255)
        out, lines = P.outline(day, ids, self.PAL + [P.INK])
        self.assertEqual(tuple(out[1, 0, :3]), P.INK)
        self.assertTrue(lines[1, 0])


class SignObjects(unittest.TestCase):
    """Every sign object has its own id (scene.py: (255, 0, ordinal)), so each sign's strokes are judged against
    its own field tone, never the whole sprite's."""

    def test_labels_tell_signs_apart_and_skip_everything_else(self):
        ids = img(1, 4, GLASS)
        ids[0, 1] = (*P.sign_id(0), 255)
        ids[0, 2] = (*P.sign_id(7), 255)
        ids[0, 3] = (*P.sign_id(7), 0)  # transparent in the ids render
        self.assertEqual(P.sign_labels(ids).tolist(), [[0, 1, 8, 0]])
        self.assertEqual(P.is_sign(ids).tolist(), [[False, True, True, False]])

    def test_each_sign_is_judged_against_its_own_field(self):
        # a large dark sign with light lettering beside a small light sign with dark lettering: against one field
        # for the whole image (the dark sign's), the small sign's light field would pass for its stroke
        big = img(4, 32, (40, 40, 40, 255))
        big[:, 3:6, :3] = (230, 230, 230)
        small = img(4, 12, (230, 225, 215, 255))
        small[:, 2:6, :3] = (120, 40, 35)
        a = np.concatenate([big, small], axis=1)
        labels = np.zeros(a.shape[:2], np.int32)
        labels[:, :32] = 1
        labels[:, 32:] = 2
        out = P.downsample(a, sign=labels)
        self.assertEqual(tuple(out[0, 0, :3]), (230, 230, 230))  # the big sign's quarter-block stroke
        self.assertEqual(tuple(out[0, 1, :3]), (230, 230, 230))
        self.assertEqual(tuple(out[0, 8, :3]), (120, 40, 35))    # the small sign's half-and-half blocks
        self.assertEqual(tuple(out[0, 9, :3]), (120, 40, 35))

    def test_flatten_leaves_every_sign_alone(self):
        day = img(4, 4, (0, 0, 0, 255))
        day[..., 0] = (np.arange(16).reshape(4, 4) * 10).astype(np.uint8)
        ids = img(4, 4, (*P.sign_id(3), 255))
        np.testing.assert_array_equal(P.flatten(day, ids), day)

    def test_no_inner_line_between_two_signs(self):
        day = img(5, 6)
        day[1:4, 1:5] = (200, 180, 160, 255)
        ids = img(5, 6)
        ids[1:4, 1:3] = (*P.sign_id(1), 255)
        ids[1:4, 3:5] = (*P.sign_id(2), 255)
        out, _ = P.outline(day, ids, [(200, 180, 160), (110, 99, 88), P.INK])
        self.assertEqual(tuple(out[2, 2, :3]), (200, 180, 160))


class GlassTones(unittest.TestCase):
    def test_a_smooth_reflection_gradient_on_glass_keeps_one_tone(self):
        # a tall glass face whose glass darkens smoothly from top to bottom (a curved face reflecting the sky),
        # with light mullion rows: the glass takes one tone all the way down and every mullion the light tone,
        # instead of the glass crossing DARK partway and breaking into shade patches
        h, w = 8 * P.GLASS_SPAN, 2 * P.GLASS_SPAN
        lum = np.linspace(110, 60, h)[:, None].repeat(w, 1)
        rows = np.arange(h) % 8 == 0
        lum[rows] *= 1.6
        day = img(h, w, (0, 0, 0, 255))
        day[..., :3] = np.rint(lum)[..., None].astype(np.uint8)
        out = P.flatten(day, img(h, w, GLASS))
        glass = {tuple(p) for p in out[~rows][..., :3].reshape(-1, 3).tolist()}
        mullions = {tuple(p) for p in out[rows][..., :3].reshape(-1, 3).tolist()}
        self.assertEqual(len(glass), 1)
        self.assertEqual(len(mullions), 1)
        self.assertGreater(P._lum(np.array(list(mullions)[0])), P._lum(np.array(list(glass)[0])))

    def test_no_seams_where_the_share_of_mullions_changes(self):
        # light fins over 40% of the columns up top and 60% below (foreshortening packs them on a curved face):
        # judged against a median per patch, the lower patches would take the fins as their base and drop the
        # glass to shade in a block-shaped patch
        h, w = 4 * P.GLASS_SPAN, 2 * P.GLASS_SPAN
        cols = np.arange(w) % 10
        fin = np.zeros((h, w), bool)
        fin[: h // 2] = cols[None] < 4
        fin[h // 2:] = cols[None] < 6
        day = img(h, w, (80, 80, 80, 255))
        day[fin] = (128, 128, 128, 255)
        out = P.flatten(day, img(h, w, GLASS))
        self.assertEqual(len({tuple(p) for p in out[~fin][:, :3].tolist()}), 1)
        self.assertEqual(len({tuple(p) for p in out[fin][:, :3].tolist()}), 1)

    def test_lit_glass_is_glass_and_lit(self):
        ids = img(1, 4, (5, 5, 0, 255))
        ids[0, :, 2] = (96, P.LIT_BLUE[0], P.LIT_BLUE[1], 64)
        self.assertEqual(P.is_glass(ids).tolist(), [[True, True, True, False]])
        self.assertEqual(P.is_lit(ids).tolist(), [[False, True, True, False]])

    def test_a_wall_keeps_its_one_median(self):
        # off glass, tones stay relative to the whole region's median, so a wall's cast shadow stays shape
        h, w = 4 * P.GLASS_SPAN, P.GLASS_SPAN
        day = img(h, w, (100, 100, 100, 255))
        day[: 2 * P.GLASS_SPAN] = (50, 50, 50, 255)  # a shadow over half the wall, several tiles tall
        out = P.flatten(day, img(h, w, (5, 5, 64, 255)))
        self.assertEqual(len({tuple(p) for p in out[: 2 * P.GLASS_SPAN, :, :3].reshape(-1, 3).tolist()}), 1)
        self.assertLess(int(out[0, 0, 0]), int(out[-1, 0, 0]))


class SignPalette(unittest.TestCase):
    GOLD, RED = (232, 186, 72), (215, 30, 40)

    def lettering(self):
        """Gold lettering on red: pure gold (a little render jitter), anti-aliased blends toward the red, and the
        red field, as the downsampled pixels of a sign."""
        rng = np.random.default_rng(5)
        gold = np.array(self.GOLD) + rng.integers(-2, 3, (60, 3))
        t = rng.uniform(0.15, 0.45, (40, 1))
        blends = np.array(self.GOLD) * (1 - t) + np.array(self.RED) * t
        red = np.array(self.RED) + rng.integers(-2, 3, (100, 3))
        px = np.clip(np.rint(np.concatenate([gold, blends, red])), 0, 255).astype(np.uint8)
        a = img(1, len(px), (0, 0, 0, 255))
        a[0, :, :3] = px
        return a

    def near(self, pal, rgb, tol=4):
        return any(max(abs(int(c) - v) for c, v in zip(col, rgb)) <= tol for col in pal)

    def test_a_snapped_color_is_the_brand_color_not_an_average_with_its_blends(self):
        a = self.lettering()
        self.assertFalse(self.near(P.build_palette([a], 2, ink=False), self.GOLD))  # the plain cut's dull tan
        pal = P.build_palette([a], 2, ink=False, snap=True)
        self.assertTrue(self.near(pal, self.GOLD))
        self.assertTrue(self.near(pal, self.RED))

    def test_snapped_colors_are_distinct_so_a_big_color_cannot_crowd_out_small_ones(self):
        # a large amber area (lit shop glass, a little render jitter) beside small gold and red lettering: the median
        # cut splits the amber into several boxes, which all snap to the same amber; the snapped palette keeps its
        # colors apart and spends the freed slots on the gold and the red
        rng = np.random.default_rng(6)
        amber = np.array((252, 200, 128)) + rng.integers(-6, 7, (600, 3))
        gold = np.array(self.GOLD) + rng.integers(-2, 3, (40, 3))
        red = np.array(self.RED) + rng.integers(-2, 3, (40, 3))
        px = np.clip(np.concatenate([amber, gold, red]), 0, 255).astype(np.uint8)
        a = img(1, len(px), (0, 0, 0, 255))
        a[0, :, :3] = px
        pal = P.build_palette([a], 3, ink=False, snap=True)
        self.assertEqual(len(pal), 3)
        for c in ((252, 200, 128), self.GOLD, self.RED):
            self.assertTrue(self.near(pal, c, tol=8), (c, pal))
        for i, c in enumerate(pal):
            for d in pal[i + 1:]:
                self.assertGreaterEqual(sum((x - y) ** 2 for x, y in zip(c, d)) ** 0.5, P.SNAP_MERGE)

    def test_the_day_palette_snaps_its_sign_colors(self):
        a = self.lettering()
        pal = P.build_day_palette([a], [np.ones(a.shape[:2], bool)], 4, 2)
        self.assertTrue(self.near(pal, self.GOLD))

    def test_misfit_is_the_share_of_sign_pixels_far_from_every_palette_color(self):
        a = img(1, 4, (215, 30, 40, 255))
        a[0, :2, :3] = self.GOLD
        sign = np.ones((1, 4), bool)
        self.assertEqual(P.sign_misfit([a], [sign], [self.RED, P.INK]), 0.5)
        self.assertEqual(P.sign_misfit([a], [sign], [self.RED, self.GOLD]), 0.0)
        self.assertEqual(P.sign_misfit([a], [np.zeros((1, 4), bool)], [self.RED]), 0.0)


class Shadow(unittest.TestCase):
    def layers(self):
        """A 1x3 strip: a building pixel, a cast shadow pixel (in the day render only), and empty ground."""
        day = img(1, 3)
        day[0, 0] = (200, 180, 160, 255)
        day[0, 1] = (20, 20, 20, 175)
        ids = img(1, 3)
        ids[0, 0] = (1, 1, 1, 255)
        return day, ids

    def test_split_moves_the_cast_shadow_out_of_the_building(self):
        day, ids = self.layers()
        building, shadow = P.split_shadow(day, ids)
        self.assertEqual(shadow.tolist(), [[False, True, False]])
        self.assertEqual(tuple(building[0, 0]), (200, 180, 160, 255))
        self.assertEqual(tuple(building[0, 1]), (0, 0, 0, 0))
        self.assertEqual(tuple(day[0, 1]), (20, 20, 20, 175))  # the input is left alone

    def test_faint_haze_is_cleared_but_is_not_shadow(self):
        day, ids = self.layers()
        day[0, 1, 3] = P.SHADOW_MIN_ALPHA
        building, shadow = P.split_shadow(day, ids)
        self.assertFalse(shadow[0, 1])
        self.assertEqual(tuple(building[0, 1]), (0, 0, 0, 0))

    def test_add_shadow_fills_only_transparent_pixels(self):
        a = img(1, 2)
        a[0, 1] = (9, 9, 9, 255)
        out = P.add_shadow(a, np.array([[True, True]]))
        self.assertEqual(tuple(out[0, 0]), P.SHADOW)
        self.assertEqual(tuple(out[0, 1]), (9, 9, 9, 255))
        self.assertEqual(tuple(a[0, 0]), (0, 0, 0, 0))  # the input is left alone

    def test_shadow_is_the_ink_color(self):
        self.assertEqual(P.SHADOW[:3], P.INK)

    def test_mask_downsample_keeps_a_half_full_block(self):
        m = np.zeros((4, 8), bool)
        m[:2, :4] = True    # 8 of 16: kept
        m[:1, 4:7] = True   # 3 of 16: dropped
        self.assertEqual(P.downsample_mask(m).tolist(), [[True, False]])

    def test_mask_downsample_crops_like_downsample(self):
        self.assertEqual(P.downsample_mask(np.ones((9, 10), bool)).shape, (2, 2))

    def test_mask_and_image_downsample_to_the_same_grid(self):
        a = img(9, 10)
        a[:4, 4:8] = (1, 2, 3, 255)     # the second block of the first row, fully opaque
        mask = a[..., 3] > 0
        self.assertEqual(P.downsample_mask(mask).tolist(), (P.downsample(a)[..., 3] == 255).tolist())


if __name__ == "__main__":
    unittest.main()
