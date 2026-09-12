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


if __name__ == "__main__":
    unittest.main()
