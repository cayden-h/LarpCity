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
