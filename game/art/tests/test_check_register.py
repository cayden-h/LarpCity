"""Final registration checks against a catalog and real temporary PNG layers."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_register
from lib import pixel as P


class Registration(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.art = Path(temp.name) / "art"
        self.public = Path(temp.name) / "public"
        self.root = self.public / "testville"
        self.root.mkdir(parents=True)
        (self.art / "palettes").mkdir(parents=True)
        self.color = (180, 140, 100)
        self.night_color = (255, 220, 120)
        (self.art / "palettes/testville.json").write_text(
            json.dumps({"day": [self.color], "night": [(0, 0, 0), self.night_color]}))
        self.catalog = {"testville": [
            {"id": f"house-{f}", "w": 1, "d": 1, "facing": f, "walls": True, "fill": True}
            for f in ("s", "e")
        ]}
        self.entries = []
        for spec in self.catalog["testville"]:
            sid = spec["id"]
            entry = {"id": sid, "w": 1, "d": 1, "facing": spec["facing"], "ax": 32, "ay": 0,
                     "day": f"{sid}.png", "night": f"{sid}.night.png", "walls": f"{sid}.walls.png"}
            self.entries.append(entry)
            day = np.full((32, 64, 4), (*self.color, 255), np.uint8)
            P.save(day, self.root / entry["day"])
            P.save(np.zeros_like(day), self.root / entry["night"])
            walls = np.zeros_like(day)
            walls[4:8, 4:8] = (128, 128, 128, 255)
            P.save(walls, self.root / entry["walls"])
        self.scale = 1

    def run_check(self, *args):
        (self.root / "sprites.json").write_text(json.dumps({"scale": self.scale, "sprites": self.entries}))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = check_register.main(["testville", *args], art_dir=self.art,
                                         public_dir=self.public, catalog=self.catalog)
        return status, output.getvalue()

    def test_complete_set_accepts_neutral_walls_outside_day_palette(self):
        self.assertEqual(self.run_check()[0], 0)

    def test_nonfill_anchors_must_be_finite_in_full_and_partial_sets(self):
        self.entries[0]["fill"] = False
        self.catalog["testville"][0]["fill"] = False
        for args in ((), ("--allow-partial",)):
            if args:
                self.entries.pop()
            for key in ("ax", "ay"):
                for value in (float("nan"), float("inf"), float("-inf"), None):
                    with self.subTest(args=args, key=key, value=value):
                        original = self.entries[0][key]
                        self.entries[0][key] = value
                        code, output = self.run_check(*args)
                        self.assertEqual(code, 1)
                        self.assertIn(f"invalid {key} anchor", output)
                        self.entries[0][key] = original

    def test_nonfill_only_exempts_diamond_edges(self):
        self.entries[0].update(fill=False, ax=100, ay=-100)
        self.catalog["testville"][0]["fill"] = False
        self.assertEqual(self.run_check()[0], 0)

    def test_night_rejects_day_palette_color_in_full_and_partial_sets(self):
        path = self.root / self.entries[0]["night"]
        night = P.load(path)
        night[4, 4] = (*self.color, 255)
        P.save(night, path)
        for args in ((), ("--allow-partial",)):
            if args:
                self.entries.pop()
            with self.subTest(args=args):
                code, output = self.run_check(*args)
                self.assertEqual(code, 1)
                self.assertIn("night colors outside the palette", output)

    def test_night_palette_does_not_apply_to_transparency_walls_or_crown(self):
        path = self.root / self.entries[0]["night"]
        night = P.load(path)
        night[4, 4] = (*self.night_color, 255)
        night[5, 5] = (*self.color, 0)
        P.save(night, path)
        self.entries[0]["crown"] = "crown.png"
        self.catalog["testville"][0]["crown"] = True
        crown = np.zeros_like(night)
        crown[4, 4] = (255, 255, 255, 255)
        P.save(crown, self.root / "crown.png")
        self.assertEqual(self.run_check()[0], 0)

    def test_missing_facing_fails_by_default(self):
        self.entries.pop()
        code, output = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("house-e", output)
        self.assertIn("missing", output)

    def test_partial_samples_require_explicit_option(self):
        self.entries.pop()
        self.assertEqual(self.run_check("--allow-partial")[0], 0)

    def test_partial_does_not_allow_empty_set(self):
        self.entries.clear()
        self.assertEqual(self.run_check("--allow-partial")[0], 1)

    def test_partial_does_not_allow_unknown_or_duplicate_ids(self):
        for sid in ("unknown", "house-s"):
            with self.subTest(sid=sid):
                self.entries[1]["id"] = sid
                self.assertEqual(self.run_check("--allow-partial")[0], 1)

    def test_partial_still_requires_scale_one(self):
        self.scale = 4
        self.assertEqual(self.run_check("--allow-partial")[0], 1)

    def test_wrong_facing_is_not_hidden_by_correct_id(self):
        self.entries[0]["facing"] = "n"
        self.assertEqual(self.run_check()[0], 1)

    def test_rectangular_facing_requires_rotated_footprint(self):
        self.catalog["testville"][1]["w"] = 2
        self.assertEqual(self.run_check()[0], 1)

    def test_required_walls_cannot_be_omitted_from_manifest(self):
        del self.entries[0]["walls"]
        self.assertEqual(self.run_check("--allow-partial")[0], 1)

    def test_required_night_file_must_exist(self):
        (self.root / self.entries[0]["night"]).unlink()
        code, output = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("night", output)

    def test_catalog_crown_requires_layer(self):
        self.catalog["testville"][0]["crown"] = True
        self.assertEqual(self.run_check()[0], 1)

    def test_layer_dimensions_must_match_day(self):
        P.save(np.zeros((1, 1, 4), np.uint8), self.root / self.entries[0]["night"])
        self.assertEqual(self.run_check()[0], 1)

    def test_colored_wall_pixels_fail_even_if_they_match_day_palette(self):
        f = self.root / self.entries[0]["walls"]
        walls = P.load(f)
        walls[4, 4] = (*self.color, 255)
        P.save(walls, f)
        code, output = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("neutral", output)

    def test_wall_translucency_and_pixels_outside_day_fail(self):
        f = self.root / self.entries[0]["walls"]
        walls = P.load(f)
        walls[4, 4, 3] = 128
        P.save(walls, f)
        self.assertEqual(self.run_check()[0], 1)
        walls[4, 4, 3] = 255
        P.save(walls, f)
        f = self.root / self.entries[0]["day"]
        day = P.load(f)
        day[4, 4] = (0, 0, 0, 0)
        P.save(day, f)
        self.assertEqual(self.run_check()[0], 1)


if __name__ == "__main__":
    unittest.main()
