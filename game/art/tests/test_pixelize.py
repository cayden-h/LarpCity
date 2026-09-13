"""End-to-end tests of art/pixelize.py on a synthetic raw render. Run from game/:  python3 -m unittest discover -s art/tests -v"""
import colorsys
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pixelize  # noqa: E402
from lib import pixel as P  # noqa: E402

CITY = "testville"
S = P.RAW_SCALE


def building(name, crown=False):
    """A 4x render of a 2-face box with a cast shadow to its right, faint haze over the rest, a lit window at
    night, and optionally a crown mask. Returns the raw layers and the raw.json entry."""
    h, w = 16 * S, 16 * S
    day = np.zeros((h, w, 4), np.uint8)
    ids = np.zeros((h, w, 4), np.uint8)
    day[..., 3] = 10                                     # the shadow catcher's haze
    day[4 * S:12 * S, 2 * S:6 * S] = (200, 160, 120, 255)  # left face
    day[4 * S:12 * S, 6 * S:10 * S] = (150, 110, 80, 255)  # right face
    ids[4 * S:12 * S, 2 * S:6 * S] = (10, 0, 0, 255)
    ids[4 * S:12 * S, 6 * S:10 * S] = (0, 10, 0, 255)
    day[8 * S:12 * S, 10 * S:15 * S] = (10, 10, 10, 175)  # the cast shadow, in the day render only
    night = np.zeros((h, w, 4), np.uint8)
    night[4 * S:12 * S, 2 * S:10 * S] = (0, 0, 0, 255)
    night[6 * S:7 * S, 3 * S:4 * S] = (255, 220, 120, 255)
    layers = {"day": day, "ids": ids, "night": night}
    entry = {"id": name, "w": 1, "d": 1, "day": f"{name}.png", "night": f"{name}.night.png"}
    if crown:
        c = np.zeros((h, w, 4), np.uint8)
        c[3 * S:4 * S, 2 * S:10 * S] = (255, 255, 255, 255)
        layers["crown"] = c
        entry["crown"] = f"{name}.crown.png"
    entry["raw"] = {k: f"{name}.{k}.png" for k in layers}
    return layers, entry


class SignColors(unittest.TestCase):
    def test_warns_when_signs_need_more_colors_than_are_reserved(self):
        # a sign in far more distinct brand colors than SIGN_COLORS: the palette build says so instead of
        # quietly remapping the brand colors the median cut had no room for
        layers, entry = building("rainbow")
        n = pixelize.SIGN_COLORS * 2
        for i in range(n):
            r, g, b = colorsys.hsv_to_rgb(i / n, 1.0, 1.0)
            x = 2 * S + (i % 8) * S
            y = 4 * S + (i // 8) * S
            layers["day"][y:y + S, x:x + S] = (round(r * 255), round(g * 255), round(b * 255), 255)
            layers["ids"][y:y + S, x:x + S] = (*P.sign_id(0), 255)
        with tempfile.TemporaryDirectory() as tmp:
            art, public = Path(tmp) / "art", Path(tmp) / "public"
            raw = art / ".raw" / CITY
            raw.mkdir(parents=True)
            for k, a in layers.items():
                P.save(a, raw / entry["raw"][k])
            (raw / "raw.json").write_text(json.dumps({"scale": S, "sprites": [entry]}))
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                pixelize.main([CITY], art_dir=art, public_dir=public)
        self.assertIn("SIGN_COLORS", err.getvalue())


class Pixelize(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.art = Path(tmp.name) / "art"
        self.public = Path(tmp.name) / "public" / "sprites"
        raw = self.art / ".raw" / CITY
        raw.mkdir(parents=True)
        entries = []
        for name, crown in (("box-a", False), ("box-b", True)):
            layers, entry = building(name, crown)
            for k, a in layers.items():
                P.save(a, raw / entry["raw"][k])
            entries.append(entry)
        (raw / "raw.json").write_text(json.dumps({"scale": S, "sprites": entries}))
        self.entries = entries
        self.out = self.public / CITY

    def run_main(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pixelize.main([CITY, *args], art_dir=self.art, public_dir=self.public)

    def manifest(self):
        return json.loads((self.out / "sprites.json").read_text())

    def test_day_is_palette_colors_and_one_flat_shadow_never_over_the_building(self):
        self.run_main()
        pal = {tuple(c) for c in json.loads((self.art / "palettes" / f"{CITY}.json").read_text())["day"]}
        for e in self.entries:
            day = P.load(self.out / e["day"])
            self.assertEqual(set(np.unique(day[..., 3]).tolist()), {0, 96, 255})
            opaque = {tuple(c) for c in day[day[..., 3] == 255][:, :3]}
            self.assertLessEqual(opaque, pal)
            self.assertEqual({tuple(c) for c in day[day[..., 3] == 96]}, {P.SHADOW})
            body = P.downsample(P.load(self.art / ".raw" / CITY / e["raw"]["ids"]))[..., 3] == 255
            self.assertTrue((day[body, 3] == 255).all())
            self.assertTrue((day[~body, 3] != 255).all())

    def test_night_and_crown_have_hard_alpha(self):
        self.run_main()
        for name in ("box-a.night.png", "box-b.night.png", "box-b.crown.png"):
            self.assertLessEqual(set(np.unique(P.load(self.out / name)[..., 3]).tolist()), {0, 255})

    def test_manifest_is_the_raw_entries_minus_raw(self):
        self.run_main()
        m = self.manifest()
        self.assertEqual(m["scale"], 1)
        self.assertEqual(m["sprites"], [{k: v for k, v in e.items() if k != "raw"} for e in self.entries])

    def test_only_still_lists_every_entry(self):
        self.run_main()
        (self.out / "sprites.json").unlink()
        self.run_main("--only", "box-b")
        self.assertEqual([e["id"] for e in self.manifest()["sprites"]], ["box-a", "box-b"])

    def test_new_palette_with_only_is_an_error(self):
        with self.assertRaises(SystemExit) as cm:
            self.run_main("--new-palette", "--only", "box-a")
        self.assertNotEqual(cm.exception.code, 0)
        self.assertFalse((self.art / "palettes").exists())

    def test_a_missing_output_is_reported(self):
        self.run_main()
        (self.out / "box-a.night.png").unlink()
        with self.assertRaises(SystemExit) as cm:
            self.run_main("--only", "box-b")
        self.assertIn("box-a", str(cm.exception.code))
        self.assertNotIn("box-b", str(cm.exception.code))

    def test_an_output_older_than_its_raw_is_reported(self):
        self.run_main()
        raw = self.art / ".raw" / CITY / "box-a.day.png"
        later = (self.out / "box-a.png").stat().st_mtime_ns + 10**9
        os.utime(raw, ns=(later, later))
        with self.assertRaises(SystemExit) as cm:
            self.run_main("--only", "box-b")
        self.assertIn("box-a", str(cm.exception.code))
        self.assertNotIn("box-b", str(cm.exception.code))

    def test_a_missing_raw_outside_only_is_reported_not_raised(self):
        self.run_main()
        (self.art / ".raw" / CITY / "box-a.night.png").unlink()
        with self.assertRaises(SystemExit) as cm:
            self.run_main("--only", "box-b")
        self.assertIn("box-a", str(cm.exception.code))

    def test_a_wrong_render_scale_is_an_error(self):
        raw = self.art / ".raw" / CITY / "raw.json"
        raw.write_text(json.dumps({"scale": S + 1, "sprites": self.entries}))
        with self.assertRaises(SystemExit) as cm:
            self.run_main()
        self.assertIn("scale", str(cm.exception.code))


if __name__ == "__main__":
    unittest.main()
